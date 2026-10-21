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
 * P2-3a scope notes (migration, takeover, reclaim, close):
 * - MIGRATION PROMOTION lives here as a pure decision
 *   (evaluateMigration): a host whose heartbeat is older than
 *   HEARTBEAT_TIMEOUT_MS — or whose seat is no longer held by a
 *   connected human — is replaced by the connected human with the
 *   lowest joinedOrder. Bots never host; a seat in reconnect grace is
 *   not connected, so it is never a candidate. The DO's alarm API
 *   supplies the wake-up; this module supplies the verdict.
 * - Election vs promotion are deliberately separate: ensureHost fills
 *   a VACANT host seat on membership change and never demotes a
 *   sitting, connected host; evaluateMigration is the only path that
 *   demotes one, and only on heartbeat staleness / absence.
 * - DISCONNECT no longer frees a seat: disconnectSeat flips control
 *   to bot and parks the seat in reconnect grace, remembering the
 *   human's identity (heldIdentities) for reclaim. Grace lasts the
 *   whole match (design pin #6: reclaimable all match) — no timer.
 *   A full release (releaseSeat) happens only on kick, which also
 *   bans the playerId from the room.
 * - A reclaimer does NOT retake hosting from a promoted host: reclaim
 *   restores the seat; hosting moves only via vacancy or promotion.
 */

import {
  CLIENT_VERSION,
  SEAT_COLORS,
  SEAT_CUES,
  TEAM_PICKER_ORDER,
  defaultTeamForSeatIndex,
  isTeamId,
} from '../src/net/protocol';
import type {
  RoomMeta,
  RoomPhase,
  RoomState,
  Seat,
  StarCount,
  TeamId,
} from '../src/net/protocol';

/** Host heartbeat cadence (design draft §6, DRAFT numbers): the host
 *  client beats every HEARTBEAT_INTERVAL_MS; the DO promotes after
 *  HEARTBEAT_TIMEOUT_MS of silence. */
export const HEARTBEAT_INTERVAL_MS = 2000;
export const HEARTBEAT_TIMEOUT_MS = 5000;

/** A human identity held by a seat in reconnect grace: the seat plays
 *  on under bot control, but only this playerId may reclaim it. */
export interface HeldIdentity {
  playerId: string;
  callsign: string;
}

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
  /** Last host heartbeat (ms epoch); the migration watch reads it.
   *  Null until the host's first heartbeat (or match start, which
   *  stamps the baseline — see startMatch). */
  hostLastHeartbeatAt: number | null;
  /** Next joinedOrder to hand out (1-based; humans only). */
  nextJoinedOrder: number;
  /** Grace-held human identities, keyed by the seat's ownerId. */
  heldIdentities: Record<string, HeldIdentity>;
  /** playerIds kicked from this room; a re-hello presenting one is
   *  refused with error 'kicked', in any phase. */
  bannedPlayerIds: string[];
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
    // TEAMS: a seat is born on its default color-team (its own
    // presentation color) — pre-teams behavior until someone picks.
    teamId: defaultTeamForSeatIndex(starIndex),
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
    heldIdentities: {},
    bannedPlayerIds: [],
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

/** The grace hold a playerId owns, if any: the seat it may reclaim. */
export function findHeldIdentity(
  record: RoomRecord,
  playerId: string,
): { ownerId: string; held: HeldIdentity } | null {
  for (const [ownerId, held] of Object.entries(record.heldIdentities)) {
    if (held.playerId === playerId) return { ownerId, held };
  }
  return null;
}

export function hostSeat(record: RoomRecord): Seat | null {
  return record.seats.find((s) => s.isHost) ?? null;
}

export function isHost(record: RoomRecord, playerId: string): boolean {
  const host = hostSeat(record);
  return !!host && host.occupant.playerId === playerId;
}

/**
 * Host election among CONNECTED humans: the lowest joinedOrder hosts.
 * Bots never host, and neither do grace seats (not connected). Sets
 * exactly one isHost flag (or none, when no connected human exists).
 */
export function electHost(record: RoomRecord): Seat | null {
  let best: Seat | null = null;
  for (const seat of record.seats) {
    if (
      seat.occupant.kind !== 'human' ||
      seat.connection !== 'connected' ||
      seat.joinedOrder === null
    ) {
      continue;
    }
    if (best === null || seat.joinedOrder < (best.joinedOrder ?? Infinity)) {
      best = seat;
    }
  }
  for (const seat of record.seats) seat.isHost = seat === best;
  return best;
}

/**
 * Fill a VACANT host seat on a membership change. If a connected
 * human already hosts, they keep hosting — membership changes (a new
 * claim, a reclaim) never demote a sitting host; only heartbeat
 * promotion (evaluateMigration) can do that. This is what keeps a
 * reclaimer from retaking hosting from the host they were promoted
 * away to (design: migration is a promotion, never a demotion back).
 */
export function ensureHost(record: RoomRecord): Seat | null {
  const current = hostSeat(record);
  if (
    current &&
    current.occupant.kind === 'human' &&
    current.connection === 'connected'
  ) {
    return current;
  }
  return electHost(record);
}

export type ClaimOutcome =
  | { ok: true; seat: Seat; isNewClaim: boolean; reclaimed: boolean }
  | { ok: false; error: 'room_full' | 'kicked' };

/**
 * Seat a human from a hello. Resolution order:
 *  1. A kicked playerId is refused ('kicked'), in any phase.
 *  2. A playerId already occupying a seat refreshes it (re-hello /
 *     second socket): not a new claim, not a reclaim.
 *  3. A playerId with a grace hold RECLAIMS that exact seat — never
 *     any other — keeping its original joinedOrder precedence.
 *  4. Otherwise the first PURE bot seat (never a grace-held one) is
 *     claimed. In 'live' / 'cinematic' this is the takeover path:
 *     control flips, play is not interrupted. In 'lobby' it is the
 *     ordinary join.
 * A 'results' room admits nobody new (flagged reading: the frozen
 * error set has no 'match_over', and a finished room's seats are not
 * takeable — room_full is the honest refusal); a seated player's
 * refresh (case 2) is still answered.
 */
export function claimSeat(
  record: RoomRecord,
  playerId: string,
  callsign: string,
): ClaimOutcome {
  if (record.bannedPlayerIds.includes(playerId)) {
    return { ok: false, error: 'kicked' };
  }
  const existing = findSeatByPlayerId(record, playerId);
  if (existing) {
    if (callsign.trim()) existing.occupant.callsign = callsign.trim();
    existing.connection = 'connected';
    return { ok: true, seat: existing, isNewClaim: false, reclaimed: false };
  }
  const hold = findHeldIdentity(record, playerId);
  if (hold) {
    if (record.phase === 'results') return { ok: false, error: 'room_full' };
    const seat = record.seats.find((s) => s.ownerId === hold.ownerId);
    if (!seat) return { ok: false, error: 'room_full' };
    delete record.heldIdentities[hold.ownerId];
    const { color, cue } = seat.occupant;
    seat.occupant = {
      kind: 'human',
      playerId,
      callsign: callsign.trim() || hold.held.callsign,
      // color/cue are the seat's, assigned by starIndex for the match.
      color,
      cue,
    };
    seat.connection = 'connected';
    // joinedOrder was preserved through grace; hosting is NOT
    // restored by a reclaim — ensureHost only fills a vacancy.
    ensureHost(record);
    return { ok: true, seat, isNewClaim: false, reclaimed: true };
  }
  if (record.phase === 'results') return { ok: false, error: 'room_full' };
  const seat = record.seats.find(
    (s) => s.occupant.kind === 'bot' && s.connection === 'bot',
  );
  if (!seat) return { ok: false, error: 'room_full' };
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
  ensureHost(record);
  return { ok: true, seat, isNewClaim: true, reclaimed: false };
}

/**
 * A human's last socket went away: the seat does NOT free. Control
 * flips to bot, the seat parks in reconnect grace, and the human's
 * identity is held for reclaim (design §6: the seat plays on; the
 * human may reclaim any time during the match). joinedOrder is kept —
 * it is the held identity's precedence when it returns. isHost is
 * left for reconcileHosting / evaluateMigration to settle, so the DO
 * can report a promotion with its event pair.
 * Returns the seat, or null if the player held none.
 */
export function disconnectSeat(
  record: RoomRecord,
  playerId: string,
): Seat | null {
  const seat = findSeatByPlayerId(record, playerId);
  if (!seat) return null;
  const { color, cue } = seat.occupant;
  record.heldIdentities[seat.ownerId] = {
    playerId,
    callsign: seat.occupant.callsign,
  };
  seat.occupant = {
    kind: 'bot',
    playerId: null,
    callsign: botCallsign(seat.starIndex),
    color,
    cue,
  };
  seat.connection = 'reconnect_grace';
  return seat;
}

/**
 * Full release: the seat forgets the human entirely — occupant flips
 * to bot, any grace hold is erased, joinedOrder clears. This is the
 * kick path (and the only release path in P2-3a: the wire has no
 * voluntary-leave message, so a drop is always grace, never release).
 * Resolves the target as a live occupant OR via a grace hold.
 * Returns the freed seat, or null if the player held nothing.
 */
export function releaseSeat(
  record: RoomRecord,
  playerId: string,
): Seat | null {
  let seat = findSeatByPlayerId(record, playerId);
  if (!seat) {
    const hold = findHeldIdentity(record, playerId);
    if (hold) {
      seat = record.seats.find((s) => s.ownerId === hold.ownerId) ?? null;
    }
  }
  if (!seat) return null;
  delete record.heldIdentities[seat.ownerId];
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
  ensureHost(record);
  return seat;
}

/** Host-only kick: fully releases the target's seat (occupant or
 *  grace-held identity), erases any hold, and BANS the playerId — a
 *  re-hello presenting it is refused 'kicked' in any phase. Returns
 *  the freed seat, or null if the requester isn't host, the target is
 *  the requester, or the target holds nothing. */
export function kickPlayer(
  record: RoomRecord,
  requesterPlayerId: string,
  targetPlayerId: string,
): Seat | null {
  if (!isHost(record, requesterPlayerId)) return null;
  if (requesterPlayerId === targetPlayerId) return null;
  const freed = releaseSeat(record, targetPlayerId);
  if (!freed) return null;
  if (!record.bannedPlayerIds.includes(targetPlayerId)) {
    record.bannedPlayerIds.push(targetPlayerId);
  }
  return freed;
}

export type MigrationOutcome =
  | { action: 'none' }
  | {
      action: 'promote';
      /** The outgoing host's playerId (via the seat's occupant, or
       *  its grace hold when the seat already flipped); null only in
       *  the no-flagged-host edge, where '' goes on the wire. */
      fromPlayerId: string | null;
      toPlayerId: string;
      hostOwnerId: string;
    }
  | { action: 'close' };

/**
 * The migration verdict (pure). Runs while a match is live or in its
 * cinematic; the lobby settles hosting by election on membership
 * change, never by timeout, so other phases return 'none'.
 *
 * The sitting host is HEALTHY only when its seat is held by a
 * connected human whose heartbeat is no older than
 * HEARTBEAT_TIMEOUT_MS. Otherwise the connected human with the
 * lowest joinedOrder is promoted (bots and grace seats are never
 * candidates); promotion restamps the heartbeat baseline to `now` —
 * the promoted client's beats take over from there, and the DO arms
 * its next alarm at the new deadline. When nobody can host, the
 * verdict is 'close' if the room is truly empty of humans, else
 * 'none' (a grace-held identity may still return and be elected).
 */
export function evaluateMigration(
  record: RoomRecord,
  now: number,
): MigrationOutcome {
  if (record.phase !== 'live' && record.phase !== 'cinematic') {
    return { action: 'none' };
  }
  const host = hostSeat(record);
  const hostPlayerId = host
    ? (host.occupant.playerId ??
      record.heldIdentities[host.ownerId]?.playerId ??
      null)
    : null;
  const healthy =
    !!host &&
    host.occupant.kind === 'human' &&
    host.connection === 'connected' &&
    record.hostLastHeartbeatAt !== null &&
    now - record.hostLastHeartbeatAt <= HEARTBEAT_TIMEOUT_MS;
  if (healthy) return { action: 'none' };

  let candidate: Seat | null = null;
  for (const seat of record.seats) {
    if (seat === host) continue;
    if (
      seat.occupant.kind !== 'human' ||
      seat.connection !== 'connected' ||
      seat.joinedOrder === null
    ) {
      continue;
    }
    if (
      candidate === null ||
      seat.joinedOrder < (candidate.joinedOrder ?? Infinity)
    ) {
      candidate = seat;
    }
  }
  if (candidate && candidate.occupant.playerId) {
    for (const seat of record.seats) seat.isHost = seat === candidate;
    record.hostLastHeartbeatAt = now;
    return {
      action: 'promote',
      fromPlayerId: hostPlayerId,
      toPlayerId: candidate.occupant.playerId,
      hostOwnerId: candidate.ownerId,
    };
  }
  if (shouldCloseRoom(record)) return { action: 'close' };
  return { action: 'none' };
}

/**
 * Hosting reconciliation after a membership loss — the DO's one call
 * on socket-gone. In a live/cinematic match the verdict is the
 * migration decision (the departed seat may have been the host);
 * in the lobby it is plain vacancy election.
 */
export function reconcileHosting(
  record: RoomRecord,
  now: number,
): MigrationOutcome {
  if (record.phase === 'live' || record.phase === 'cinematic') {
    return evaluateMigration(record, now);
  }
  ensureHost(record);
  return { action: 'none' };
}

/**
 * Room-close predicate (design §6: if the last human leaves, the
 * room closes). Deliberately conservative: a room closes only when
 * NO human is connected, NO seat has a human occupant, and NO grace
 * hold survives — a held identity means a human may still return,
 * and grace lasts the whole match, so held rooms persist. The DO
 * evaluates this only after membership events (kick / disconnect /
 * alarm verdicts), never at creation.
 */
export function shouldCloseRoom(record: RoomRecord): boolean {
  const anyHumanOccupant = record.seats.some(
    (s) => s.occupant.kind === 'human',
  );
  const anyConnectedHuman = record.seats.some(
    (s) => s.occupant.kind === 'human' && s.connection === 'connected',
  );
  const anyHeld = Object.keys(record.heldIdentities).length > 0;
  return !anyHumanOccupant && !anyConnectedHuman && !anyHeld;
}

/** The legal phase graph (contract §3 lifecycle). The rest of the
 *  graph beyond lobby → live is defined so later slices transition
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
 *  the arena is live immediately). Stamps the migration watch's
 *  first heartbeat baseline when `now` is given: match start counts
 *  as a beat, so a host that dies before its first real heartbeat is
 *  still caught one timeout after the start. */
export function startMatch(
  record: RoomRecord,
  playerId: string,
  now?: number,
): boolean {
  if (record.phase !== 'lobby') return false;
  if (!isHost(record, playerId)) return false;
  // TEAMS: resolve bot seats' teams against the humans' picks
  // before the phase flips, so the live roomState carries the
  // final teams the host sim assembles from.
  resolveTeamsAtStart(record);
  if (!transitionPhase(record, 'live')) return false;
  if (now !== undefined && record.hostLastHeartbeatAt === null) {
    record.hostLastHeartbeatAt = now;
  }
  return true;
}

/**
 * A lobby team pick (TEAMS, pure): the sender sets THEIR OWN seat's
 * team. Legal only in the lobby, only for the seat the sender
 * currently holds (their playerId is the seat's occupant), and only
 * to a palette team — unbalanced splits are legal by Adam's design
 * (free choice, no balancing police). Anything else returns false
 * and changes nothing: the wire's standing philosophy is to ignore
 * what it has no error code for. Returns true when the pick landed
 * (the DO persists + broadcasts the roomState).
 */
export function setSeatTeam(
  record: RoomRecord,
  playerId: string,
  teamId: unknown,
): boolean {
  if (record.phase !== 'lobby') return false;
  if (!isTeamId(teamId)) return false;
  const seat = findSeatByPlayerId(record, playerId);
  if (!seat) return false;
  seat.teamId = teamId;
  return true;
}

/**
 * Start-time team resolution (TEAMS, pure): human-held seats keep
 * the picks they made in the lobby. Bot seats keep their DEFAULT
 * team — with ONE exception: when every human-held seat shares a
 * single team (a stacked co-op), all bot seats take the first
 * picker-order color no human picked, so the stack still faces a
 * single opposing team instead of a rainbow of solo bots. With no
 * humans seated there is nothing to stack against and defaults
 * stand. Runs once, when the host's start lands, before the phase
 * flips (see startMatch) — the resolved seats ride the live
 * roomState broadcast.
 */
export function resolveTeamsAtStart(record: RoomRecord): void {
  const humanTeams = new Set(
    record.seats
      .filter((s) => s.occupant.kind === 'human')
      .map((s) => s.teamId),
  );
  if (humanTeams.size !== 1) return;
  const [stacked] = humanTeams;
  const opposing =
    TEAM_PICKER_ORDER.find((t) => t !== stacked) ?? stacked;
  for (const seat of record.seats) {
    if (seat.occupant.kind === 'bot') seat.teamId = opposing;
  }
}

/** Records the host's heartbeat timestamp (the migration watch reads
 *  it). Returns true when the sender is the host. */
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
