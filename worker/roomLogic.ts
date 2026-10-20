/**
 * Mass Rattle — pure room/seat logic for the Phase 2 RoomDO.
 *
 * Dependency-free (imports only the wire contract from
 * src/net/protocol.ts) and free of I/O, wall-clock reads, and ambient
 * randomness: time and RNG are parameters. The Durable Object
 * (worker/room.ts) delegates EVERY seat/phase decision here so the
 * logic can be sanity-executed under tsx without a Cloudflare runtime.
 *
 * Functions mutate the passed RoomRecord; the DO persists it after
 * each operation.
 *
 * P2-1 scope notes:
 * - Election on membership change lives here (host = first human in
 *   joinedOrder). MID-MATCH MIGRATION PROMOTION (heartbeat-timeout
 *   watch, hostMigrating/hostMigrated) is P2-3 — this module records
 *   the host heartbeat timestamp and never promotes on it.
 * - Disconnect frees the seat (occupant flips back to bot). The
 *   bot-hold + reclaim-any-time model of design §6 is P2-3; the
 *   'reconnect_grace' / 'disconnected' connection states exist in the
 *   contract for that slice and are not produced here.
 */

import {
  CLIENT_VERSION,
  SEAT_COLORS,
  SEAT_CUES,
} from '../src/net/protocol';
import type {
  RoomMeta,
  RoomPhase,
  RoomState,
  Seat,
  StarCount,
} from '../src/net/protocol';

/** The DO's stored record: the contract RoomState fields plus the
 *  bookkeeping the wire never sees (derived fields — capacity,
 *  hostPlayerId, clientVersion — are computed by toRoomState). */
export interface RoomRecord {
  roomId: string;
  code: string;
  name: string;
  starCount: StarCount;
  phase: RoomPhase;
  seed: number;
  private: boolean;
  seats: Seat[];
  createdAt: number;
  /** Last host heartbeat (ms epoch); recorded for P2-3's migration
   *  watch. Null until the host's first heartbeat. */
  hostLastHeartbeatAt: number | null;
  /** Next joinedOrder to hand out (1-based; humans only). */
  nextJoinedOrder: number;
}

export interface CreateRoomSpec {
  name: string;
  starCount: StarCount;
  private?: boolean;
}

/** 6-char room codes from an unambiguous alphabet: no 0/O, no 1/I/L
 *  (contract). 31 symbols → 31^6 ≈ 8.9e8 codes. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

/** rng: () => number in [0, 1) — injected so tests can seed it. */
export function generateRoomCode(rng: () => number): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const idx = Math.min(
      ROOM_CODE_ALPHABET.length - 1,
      Math.floor(rng() * ROOM_CODE_ALPHABET.length),
    );
    code += ROOM_CODE_ALPHABET[idx];
  }
  return code;
}

/** Default callsign for a bot-held seat. (Unpinned presentation; the
 *  wire carries callsigns, so the value lives in exactly one place.) */
export function botCallsign(starIndex: number): string {
  return `BOT-${starIndex + 1}`;
}

function botSeat(starIndex: number): Seat {
  return {
    starIndex,
    starId: `star-${starIndex}`,
    ownerId: `seat-${starIndex}`,
    occupant: {
      kind: 'bot',
      playerId: null,
      callsign: botCallsign(starIndex),
      color: SEAT_COLORS[starIndex % SEAT_COLORS.length],
      cue: SEAT_CUES[starIndex % SEAT_CUES.length],
    },
    connection: 'bot',
    isHost: false,
    eliminated: false,
    joinedOrder: null,
  };
}

/** Seats are born bot-held (draft ruling 5: bot fill from match start;
 *  the lobby shows the same seats). ownerIds exist from creation. */
export function createRoomRecord(
  spec: CreateRoomSpec,
  code: string,
  seed: number,
  now: number,
): RoomRecord {
  const seats: Seat[] = [];
  for (let i = 0; i < spec.starCount; i++) seats.push(botSeat(i));
  return {
    roomId: code, // v1: the code IS the DO name (contract)
    code,
    name: spec.name,
    starCount: spec.starCount,
    phase: 'lobby',
    seed,
    private: spec.private ?? false,
    seats,
    createdAt: now,
    hostLastHeartbeatAt: null,
    nextJoinedOrder: 1,
  };
}

function cloneSeat(seat: Seat): Seat {
  return { ...seat, occupant: { ...seat.occupant } };
}

/** The contract full-sync projection. hostPlayerId is derived from the
 *  host seat so it can never disagree with Seat.isHost. */
export function toRoomState(record: RoomRecord): RoomState {
  const host = hostSeat(record);
  return {
    roomId: record.roomId,
    code: record.code,
    name: record.name,
    starCount: record.starCount,
    capacity: record.starCount,
    phase: record.phase,
    seed: record.seed,
    private: record.private,
    hostPlayerId: host ? host.occupant.playerId : null,
    seats: record.seats.map(cloneSeat),
    clientVersion: CLIENT_VERSION,
  };
}

export function occupiedSeatCount(record: RoomRecord): number {
  return record.seats.filter((s) => s.occupant.kind === 'human').length;
}

export function roomMeta(record: RoomRecord): RoomMeta {
  return {
    code: record.code,
    name: record.name,
    starCount: record.starCount,
    capacity: record.starCount,
    private: record.private,
    phase: record.phase,
    seatsTaken: occupiedSeatCount(record),
  };
}

export function findSeatByPlayerId(
  record: RoomRecord,
  playerId: string,
): Seat | null {
  return (
    record.seats.find(
      (s) => s.occupant.kind === 'human' && s.occupant.playerId === playerId,
    ) ?? null
  );
}

export function hostSeat(record: RoomRecord): Seat | null {
  return record.seats.find((s) => s.isHost) ?? null;
}

export function isHost(record: RoomRecord, playerId: string): boolean {
  const host = hostSeat(record);
  return !!host && host.occupant.playerId === playerId;
}

/**
 * Host election: the seated human with the lowest joinedOrder hosts.
 * Runs on every membership change (claim / release / kick). This is
 * lobby-grade election — NOT migration promotion (P2-3): nobody is
 * promoted mid-match by a timeout here, and bots never host.
 */
export function electHost(record: RoomRecord): Seat | null {
  let best: Seat | null = null;
  for (const seat of record.seats) {
    if (seat.occupant.kind !== 'human' || seat.joinedOrder === null) {
      continue;
    }
    if (best === null || seat.joinedOrder < (best.joinedOrder ?? Infinity)) {
      best = seat;
    }
  }
  for (const seat of record.seats) seat.isHost = seat === best;
  return best;
}

export interface ClaimResult {
  seat: Seat;
  /** True when this hello took a bot seat; false when the playerId
   *  already held the seat (re-hello / early reconnect). */
  isNewClaim: boolean;
}

/**
 * Seat a human. If playerId already holds a seat, refresh it
 * (connection back to 'connected', callsign updated if a non-empty one
 * was presented) and report isNewClaim = false. Otherwise take the
 * first bot-held seat in starIndex order. Returns null when the room
 * is full (every seat human-held).
 */
export function claimSeat(
  record: RoomRecord,
  playerId: string,
  callsign: string,
): ClaimResult | null {
  const existing = findSeatByPlayerId(record, playerId);
  if (existing) {
    if (callsign.trim()) existing.occupant.callsign = callsign.trim();
    existing.connection = 'connected';
    return { seat: existing, isNewClaim: false };
  }
  const seat = record.seats.find((s) => s.occupant.kind === 'bot');
  if (!seat) return null; // room full
  seat.occupant = {
    kind: 'human',
    playerId,
    callsign: callsign.trim() || `PLAYER-${seat.starIndex + 1}`,
    // color/cue are the seat's, assigned by starIndex for the match —
    // a takeover flips kind/playerId/callsign ONLY (contract).
    color: seat.occupant.color,
    cue: seat.occupant.cue,
  };
  seat.connection = 'connected';
  seat.joinedOrder = record.nextJoinedOrder++;
  electHost(record);
  return { seat, isNewClaim: true };
}

/**
 * Free a human's seat: occupant flips back to bot (P2-1 disconnect /
 * leave / kick all land here — see the module header on P2-3 reclaim),
 * joinedOrder clears, host re-elects. The seat's match state
 * (eliminated) is seat-scoped and stays. Returns the freed seat, or
 * null if the player held no seat.
 */
export function releaseSeat(
  record: RoomRecord,
  playerId: string,
): Seat | null {
  const seat = findSeatByPlayerId(record, playerId);
  if (!seat) return null;
  const { color, cue } = seat.occupant;
  seat.occupant = {
    kind: 'bot',
    playerId: null,
    callsign: botCallsign(seat.starIndex),
    color,
    cue,
  };
  seat.connection = 'bot';
  seat.joinedOrder = null;
  seat.isHost = false;
  electHost(record);
  return seat;
}

/** Host-only kick: frees the target's seat. Returns the freed seat,
 *  or null if the requester isn't host or the target holds no seat. */
export function kickPlayer(
  record: RoomRecord,
  requesterPlayerId: string,
  targetPlayerId: string,
): Seat | null {
  if (!isHost(record, requesterPlayerId)) return null;
  if (requesterPlayerId === targetPlayerId) return null;
  return releaseSeat(record, targetPlayerId);
}

/** The legal phase graph (contract §3 lifecycle). P2-1 produces only
 *  lobby → live; the rest are defined so later slices transition
 *  through the same gate. results → lobby (rematch) is deliberately
 *  NOT in the graph — rematch flow is unpinned; flagged in the P2-1
 *  report. */
const PHASE_TRANSITIONS: Record<RoomPhase, readonly RoomPhase[]> = {
  lobby: ['live'],
  live: ['cinematic', 'results'],
  cinematic: ['results'],
  results: [],
};

export function canTransitionPhase(
  record: RoomRecord,
  next: RoomPhase,
): boolean {
  return PHASE_TRANSITIONS[record.phase].includes(next);
}

export function transitionPhase(
  record: RoomRecord,
  next: RoomPhase,
): boolean {
  if (!canTransitionPhase(record, next)) return false;
  record.phase = next;
  return true;
}

/** Host-only match start from the lobby (contract: no ready state;
 *  the arena is live immediately). */
export function startMatch(record: RoomRecord, playerId: string): boolean {
  if (record.phase !== 'lobby') return false;
  if (!isHost(record, playerId)) return false;
  return transitionPhase(record, 'live');
}

/** Records the host's heartbeat timestamp (P2-3's migration watch
 *  reads it). Returns true when the sender is the host. Recording is
 *  all P2-1 does with heartbeats — no promotion happens here. */
export function recordHostHeartbeat(
  record: RoomRecord,
  playerId: string,
  now: number,
): boolean {
  if (!isHost(record, playerId)) return false;
  record.hostLastHeartbeatAt = now;
  return true;
}

/** Version gate: the client must speak exactly CLIENT_VERSION. */
export function isClientVersionSupported(version: unknown): boolean {
  return typeof version === 'number' && version === CLIENT_VERSION;
}
