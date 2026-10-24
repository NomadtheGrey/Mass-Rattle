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
 *   A full release (releaseSeat) happens on kick (which also bans
 *   the playerId from the room) or on a voluntary FORFEIT
 *   (forfeitSeat — no ban; the rage-quit door beside step-away
 *   grace, Adam, 2026-10-21).
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
  BotDifficulty,
  RoomMeta,
  RoomPhase,
  RoomState,
  Seat,
  StarCount,
  TeamId,
} from '../src/net/protocol';
import reservedCallsignsData from './reserved-callsigns.json';

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
  /** BOT DIFFICULTY LADDER (Adam, 2026-10-24): one rung per room. */
  difficulty: BotDifficulty;
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
  difficulty?: BotDifficulty;
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
    difficulty: spec.difficulty ?? 'seasoned',
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
    difficulty: record.difficulty,
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
  | { ok: true; seat: Seat; isNewClaim: boolean; reclaimed: boolean; notice?: 'name_reserved' }
  | { ok: false; error: 'room_full' | 'kicked' | 'name_reserved' };

/**
 * Seat a human from a hello. Resolution order:
 *  1. A kicked playerId is refused ('kicked'), in any phase.
 *  2. A playerId already occupying a seat refreshes it (re-hello /
 *     second socket): not a new claim, not a reclaim.
 *  3. A playerId with a grace hold RECLAIMS that exact seat — never
 *     any other — keeping its original joinedOrder precedence.
 *  4. Otherwise a PURE bot seat (never a grace-held one) is claimed.
 *     In 'live' / 'cinematic' this is the takeover path: control
 *     flips, play is not interrupted. In 'lobby' it is the ordinary
 *     join. TEAM PICK (Adam, 2026-10-24): a hello may carry a team
 *     preference from the pre-join board — a team name claims that
 *     team's first open bot seat, 'random' takes a random team that
 *     has one (rng injected, TEAM_PICKER_ORDER order), and absent
 *     keeps the legacy first-open-seat rule. A named team with no
 *     open seat refuses with room_full; the client re-peeks.
 * A 'results' room admits nobody new (flagged reading: the frozen
 * error set has no 'match_over', and a finished room's seats are not
 * takeable — room_full is the honest refusal); a seated player's
 * refresh (case 2) is still answered.
 */
/**
 * Callsigns are unique WITHIN a room (Adam, 2026-10-21 — nameplates
 * make duplicates a real confusion). The taken set is every seated
 * occupant's callsign PLUS every grace-held callsign (a held
 * identity is still in the room; reserving its name means a
 * reclaim never has to rename its owner), excluding the claiming
 * seat's own current occupant/hold. Comparison is case-insensitive
 * ("Nova" and "nova" are the same nameplate); the player's own
 * casing is kept. Collisions take a numeric suffix: Nova, Nova-2,
 * Nova-3… First come keeps the plain name.
 */
/**
 * RESERVED CALLSIGNS (Adam, 2026-10-21: "Nomad" is his — RULING
 * CHANGE the same day, superseding the suffix design below it in
 * git history). The law as it now stands:
 *  - Any callsign CONTAINING a reserved stem (case-insensitive —
 *    "Nomad", "NOMAD-7", "xNomad" alike) is RESERVED. No
 *    derivatives are granted at all.
 *  - A reserved name may be held only by a claimant who proves
 *    its PASSWORD: the hello carries the word, the server hashes
 *    it (SHA-256) and compares against the hash held here — the
 *    raw password exists nowhere server-side. The password is the
 *    SOLE key (dev's rider, relayed to Adam for veto 2026-10-21:
 *    if he vetoes it, the name locks to everyone pending the
 *    hash pin instead).
 *  - A claim WITHOUT valid proof is REFUSED with 'name_reserved'
 *    — an explicit "that name is reserved — pick another", never
 *    a silent suffix. A seated player whose re-hello asks for a
 *    reserved rename they cannot take keeps their current name
 *    and is told via the welcome's notice field instead (they are
 *    already in the room; a refusal must not eject them).
 *  - A proven claim whose plain name is already held by another
 *    seat is refused the same way — the reserved family never
 *    suffixes, for anyone.
 *  - KEEPING is not TAKING: a seated holder keeps the name across
 *    refresh and reclaim without re-proving (playerId continuity).
 *  - Ordinary (non-reserved) collisions keep the suffix behavior
 *    below, untouched.
 * THE DATA IS A FILE, not code (Adam, 2026-10-21):
 * worker/reserved-callsigns.json maps each reserved STEM
 * (lowercase) to its password's SHA-256 hex; an empty value means
 * no password is set yet — the stem is then protected from
 * EVERYONE (refusal-for-all) until the real hash is pinned, a
 * one-line edit to that JSON.
 */
export const RESERVED_CALLSIGNS: ReadonlyMap<string, string> = new Map(
  Object.entries(reservedCallsignsData as Record<string, string>),
);

/** The reserved stem a callsign contains, if any (case-insensitive). */
export function reservedStemFor(callsign: string): string | undefined {
  const name = callsign.trim().toLowerCase();
  for (const stem of RESERVED_CALLSIGNS.keys()) {
    if (name.includes(stem)) return stem;
  }
  return undefined;
}

/** Is this callsign reserved (contains a reserved stem, any case)? */
export function isReservedCallsign(callsign: string): boolean {
  return reservedStemFor(callsign) !== undefined;
}

/** The stored SHA-256 hex for the password of the reserved stem
 *  this callsign contains, or undefined when it contains none. An
 *  empty string means reserved-but-unset: no proof can pass. */
export function reservedPasswordHash(callsign: string): string | undefined {
  const stem = reservedStemFor(callsign);
  return stem === undefined ? undefined : RESERVED_CALLSIGNS.get(stem);
}

export function disambiguateCallsign(
  record: RoomRecord,
  desired: string,
  selfOwnerId: string,
): string {
  const taken = new Set<string>();
  for (const s of record.seats) {
    if (s.ownerId !== selfOwnerId) taken.add(s.occupant.callsign.toLowerCase());
  }
  for (const [ownerId, held] of Object.entries(record.heldIdentities)) {
    if (ownerId !== selfOwnerId) taken.add(held.callsign.toLowerCase());
  }
  // NOTE: reserved names never reach the suffixer — claimSeat
  // refuses or grants them plain before calling here (the reserved
  // law above). What arrives here is an ordinary name, or a
  // reserved name already cleared to be granted plain.
  if (!taken.has(desired.toLowerCase())) return desired;
  let n = 2;
  let candidate = `${desired}-${n}`;
  while (taken.has(candidate.toLowerCase())) {
    n += 1;
    candidate = `${desired}-${n}`;
  }
  return candidate;
}

/** Does THIS player already hold `desired` — in their seat or
 *  their grace hold? Keeping a name is not taking it. */
function playerHoldsName(record: RoomRecord, playerId: string, desired: string): boolean {
  const seat = findSeatByPlayerId(record, playerId);
  if (seat && seat.occupant.callsign.toLowerCase() === desired.toLowerCase()) return true;
  const hold = findHeldIdentity(record, playerId);
  return !!hold && hold.held.callsign.toLowerCase() === desired.toLowerCase();
}

/** Is `desired` carried by any OTHER seat's occupant or grace hold? */
function nameHeldByOther(record: RoomRecord, desired: string, selfOwnerId: string): boolean {
  const wanted = desired.toLowerCase();
  for (const s of record.seats) {
    if (s.ownerId !== selfOwnerId && s.occupant.callsign.toLowerCase() === wanted) return true;
  }
  for (const [ownerId, held] of Object.entries(record.heldIdentities)) {
    if (ownerId !== selfOwnerId && held.callsign.toLowerCase() === wanted) return true;
  }
  return false;
}

/**
 * The reserved gate on TAKING a name (a fresh claim, a reclaim
 * under a changed name, or a rename): blocked when the name is
 * reserved and the claimant neither already holds it nor proves
 * its password — and blocked even WITH proof when another seat
 * already holds the plain name (the reserved family never
 * suffixes, so a taken reserved name refuses rather than minting
 * a derivative).
 */
function reservedTakeBlocked(
  record: RoomRecord,
  desired: string,
  selfOwnerId: string,
  playerId: string,
  reservedProofOk: boolean,
): boolean {
  if (!isReservedCallsign(desired)) return false;
  if (playerHoldsName(record, playerId, desired)) return false;
  if (!reservedProofOk) return true;
  return nameHeldByOther(record, desired, selfOwnerId);
}

export function claimSeat(
  record: RoomRecord,
  playerId: string,
  callsign: string,
  reservedProofOk = false,
  // No defaults here, on purpose: this module takes time and RNG as
  // parameters (see the header) — the DO passes Math.random, tests
  // pass a seeded rng. Callers that predate the team pick pass
  // (undefined, Math.random) for the legacy first-seat rule.
  teamPreference: TeamId | 'random' | undefined,
  rng: () => number,
): ClaimOutcome {
  if (record.bannedPlayerIds.includes(playerId)) {
    return { ok: false, error: 'kicked' };
  }
  const existing = findSeatByPlayerId(record, playerId);
  if (existing) {
    // A re-hello asking for a reserved name it cannot take does
    // NOT refuse the hello — the player is already in the room.
    // The rename is refused, the current name stands, and the
    // welcome carries the notice so the lobby can say why.
    let notice: 'name_reserved' | undefined;
    if (callsign.trim()) {
      const desired = callsign.trim();
      if (reservedTakeBlocked(record, desired, existing.ownerId, playerId, reservedProofOk)) {
        notice = 'name_reserved';
      } else {
        existing.occupant.callsign = disambiguateCallsign(record, desired, existing.ownerId);
      }
    }
    existing.connection = 'connected';
    return { ok: true, seat: existing, isNewClaim: false, reclaimed: false, ...(notice ? { notice } : {}) };
  }
  const hold = findHeldIdentity(record, playerId);
  if (hold) {
    if (record.phase === 'results') return { ok: false, error: 'room_full' };
    const seat = record.seats.find((s) => s.ownerId === hold.ownerId);
    if (!seat) return { ok: false, error: 'room_full' };
    // The reserved refusal runs BEFORE the hold is consumed: a
    // refused reclaim leaves the held identity exactly as it was.
    const desired = callsign.trim() || hold.held.callsign;
    if (reservedTakeBlocked(record, desired, seat.ownerId, playerId, reservedProofOk)) {
      return { ok: false, error: 'name_reserved' };
    }
    delete record.heldIdentities[hold.ownerId];
    const { color, cue } = seat.occupant;
    seat.occupant = {
      kind: 'human',
      playerId,
      callsign: disambiguateCallsign(record, desired, seat.ownerId),
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
  // TEAM PICK: open seats are pure bot seats only — a grace-held seat
  // belongs to its human and is never claimable, whatever the pick.
  const open = record.seats.filter(
    (s) => s.occupant.kind === 'bot' && s.connection === 'bot',
  );
  let seat: Seat | undefined;
  if (teamPreference === 'random') {
    const teams = TEAM_PICKER_ORDER.filter((t) =>
      open.some((s) => s.teamId === t),
    );
    if (teams.length === 0) return { ok: false, error: 'room_full' };
    const team = teams[Math.min(teams.length - 1, Math.floor(rng() * teams.length))];
    seat = open.find((s) => s.teamId === team);
  } else if (teamPreference !== undefined) {
    seat = open.find((s) => s.teamId === teamPreference);
    if (!seat) return { ok: false, error: 'room_full' };
  } else {
    seat = open[0];
  }
  if (!seat) return { ok: false, error: 'room_full' };
  const desired = callsign.trim() || `PLAYER-${seat.starIndex + 1}`;
  if (reservedTakeBlocked(record, desired, seat.ownerId, playerId, reservedProofOk)) {
    return { ok: false, error: 'name_reserved' };
  }
  seat.occupant = {
    kind: 'human',
    playerId,
    callsign: disambiguateCallsign(record, desired, seat.ownerId),
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
 * to bot, any grace hold is erased, joinedOrder clears. The callers
 * are the kick path (kickPlayer) and the voluntary forfeit
 * (forfeitSeat); a plain drop is always grace, never release.
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

/**
 * Voluntary FORFEIT (Adam, 2026-10-21): the player releases their
 * OWN seat for good — the rage-quit door beside step-away grace.
 * Same release as a kick but self-imposed and WITHOUT the ban: the
 * player may rejoin later as a fresh claim. Composes releaseSeat
 * with the hosting verdict the DO applies, with one correction to
 * releaseSeat's election: when the freed seat was the host,
 * releaseSeat's ensureHost immediately flags a successor, and that
 * successor would then read as "healthy" on the DEPARTED host's
 * heartbeat baseline — stalling real promotion until the timeout.
 * So a host forfeit VACATES the flag and clears the baseline first:
 * reconciliation then runs exactly as it does for a departed host
 * (immediate promotion of the next connected human in a live match,
 * plain election in the lobby, room close when nobody remains).
 * Returns the freed seat + the hosting outcome, or null when the
 * player held no seat.
 */
export function forfeitSeat(
  record: RoomRecord,
  playerId: string,
  now: number,
): { seat: Seat; outcome: MigrationOutcome } | null {
  const wasHost = isHost(record, playerId);
  const seat = releaseSeat(record, playerId);
  if (!seat) return null;
  if (wasHost) {
    for (const s of record.seats) s.isHost = false;
    record.hostLastHeartbeatAt = null;
  }
  const outcome = reconcileHosting(record, now);
  return { seat, outcome };
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
