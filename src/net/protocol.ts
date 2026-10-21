/**
 * Mass Rattle — Phase 2 wire protocol (single source of truth).
 *
 * Mirrors the frozen contract in
 * ~/workspace/games-audit/massrattle-multiplayer-notes.md
 * ("CONTRACT — Phase 2 wire shapes"). Imported by the Worker / Durable
 * Objects (worker/) and, from P2-2 on, by the client net code.
 *
 * Dependency-free and game-type-free on purpose: nothing here imports
 * src/types.ts or any game module, so the Worker bundle and the test
 * harness can consume the contract without dragging the game in.
 *
 * No display strings travel on the wire except room name + callsigns —
 * clients render their own labels from these enums.
 *
 * Authority model (contract): the HOST's browser simulates and authors
 * standings / stage / match-end events; the room Durable Object only
 * relays them and never simulates. Guests send input intents; the host
 * sends state snapshots; every client applies snapshots wholesale.
 */

/** Protocol version the room speaks. Carried in RoomState.clientVersion
 *  and checked at create + hello; a mismatch is `version_mismatch`. */
export const CLIENT_VERSION = 1;

export type StarCount = 2 | 3 | 4;

export type RoomPhase = 'lobby' | 'live' | 'cinematic' | 'results';

/** Star lifecycle stages (design draft §5; bands are DRAFT pins —
 *  red_giant M3 / yellow M6 / white M9 / neutron M12 / black_hole M15).
 *  The enum itself is contract; P2-4 produces stageChanged. */
export type StarStage =
  | 'red_dwarf'
  | 'red_giant'
  | 'yellow'
  | 'white'
  | 'neutron'
  | 'black_hole';

/** Non-color identity cue, assigned by starIndex for the whole match. */
export type SeatCue = 'triangle' | 'diamond' | 'circle' | 'square';

/**
 * Team identity (TEAMS, Adam 2026-10-21): a seat's team for the whole
 * match, picked by color in the lobby (picker order = declaration
 * order here). Hostility in the sim is keyed on TEAM, not ownership:
 * same-team seats cannot hurt each other (Adam's pin: "No friendly
 * fire") and build one another's stars (Adam's pin: "The team works
 * together to build the star" — cross-feeding/banking at any
 * same-team star). Each seat's DEFAULT team is its own presentation
 * color, so a room where nobody picks plays exactly the pre-teams
 * game: every seat its own team.
 */
export type TeamId = 'red' | 'blue' | 'green' | 'gold';

/** Team display colors — the SEAT_COLORS hexes remapped by name, so
 *  the palette the lobby has always shown gains team names without
 *  changing a single rendered color. */
export const TEAM_COLORS: Record<TeamId, string> = {
  red: '#ff6a5e',
  blue: '#57b6ff',
  green: '#6dffa8',
  gold: '#ffc94d',
};

/** Team picker order (contract): red, blue, green, gold. Also the
 *  order the start-time team resolution scans when it needs the
 *  first color no human picked. */
export const TEAM_PICKER_ORDER: readonly TeamId[] = [
  'red',
  'blue',
  'green',
  'gold',
];

/** The default team for a seat index: the seat's existing
 *  presentation color as its solo team (0 → blue, 1 → red,
 *  2 → gold, 3 → green — SEAT_COLORS order). */
export const DEFAULT_TEAM_BY_SEAT_INDEX: readonly TeamId[] = [
  'blue',
  'red',
  'gold',
  'green',
];

export const defaultTeamForSeatIndex = (starIndex: number): TeamId =>
  DEFAULT_TEAM_BY_SEAT_INDEX[starIndex % DEFAULT_TEAM_BY_SEAT_INDEX.length];

export const isTeamId = (value: unknown): value is TeamId =>
  value === 'red' || value === 'blue' || value === 'green' || value === 'gold';

/**
 * Seat presentation, assigned by starIndex (contract: color/cue are
 * assigned by starIndex). UNPINNED presentation data — the contract
 * fixes that the assignment is by starIndex and which cue set exists,
 * but not the hex values or the cue order; both live here, in the one
 * place, so a pin pass is a data edit. Flagged in the P2-1 report.
 */
export const SEAT_COLORS: readonly string[] = [
  '#57b6ff', // seat 0 — blue
  '#ff6a5e', // seat 1 — red
  '#ffc94d', // seat 2 — amber
  '#6dffa8', // seat 3 — green
];
export const SEAT_CUES: readonly SeatCue[] = [
  'triangle',
  'diamond',
  'circle',
  'square',
];

export type SeatConnection =
  | 'connected'
  | 'reconnect_grace'
  | 'disconnected'
  | 'bot';

/** Who currently controls a seat. A takeover flips kind / playerId /
 *  callsign ONLY — ownerId, star, bank, and history stay (contract). */
export interface SeatOccupant {
  kind: 'human' | 'bot';
  /** The human connection's id; null while a bot holds the seat. */
  playerId: string | null;
  callsign: string;
  /** Presentation, assigned by starIndex for the whole match. */
  color: string;
  cue: SeatCue;
}

export interface Seat {
  starIndex: number;
  /** `star-<starIndex>` — the star this seat owns. */
  starId: string;
  /** `seat-<starIndex>` — SEAT-SCOPED (contract §2): issued at room
   *  creation, never changes during the match. Every entity owned by
   *  this seat carries this id; color is presentation only. */
  ownerId: string;
  /** The seat's team (TEAMS): born as the seat's default color-team,
   *  changeable by its human holder in the lobby via `setTeam`,
   *  resolved for bot seats at match start, then fixed for the
   *  match. A takeover flips the occupant only — the team rides
   *  the seat, like ownerId and the star. */
  teamId: TeamId;
  occupant: SeatOccupant;
  connection: SeatConnection;
  isHost: boolean;
  eliminated: boolean;
  /** Humans only, in hello order (1-based); host election + migration
   *  precedence read this. Bots: null. */
  joinedOrder: number | null;
}

/** The full-sync room shape: sent on join and on any membership/phase
 *  change (contract). */
export interface RoomState {
  /** Equals `code` in v1 — the code IS the Durable Object name. */
  roomId: string;
  /** 6 chars, unambiguous alphabet (no 0/O/1/I/L). */
  code: string;
  name: string;
  starCount: StarCount;
  /** Always = starCount. */
  capacity: number;
  phase: RoomPhase;
  /** Arena seed, issued at creation by the Worker/DO — never the
   *  client. Star positions + wrap derive from seed + starCount. */
  seed: number;
  /** True = unlisted; join by code/link only. No passwords in v1. */
  private: boolean;
  /** playerId of the current host occupant; null only before the
   *  first human hello lands. Mirrors Seat.isHost. */
  hostPlayerId: string | null;
  /** Length = starCount, ordered by starIndex. */
  seats: Seat[];
  /** The protocol version the room speaks (= CLIENT_VERSION). */
  clientVersion: number;
}

/** Room-list metadata — mirrors RoomState for the public list. */
export interface RoomMeta {
  code: string;
  name: string;
  starCount: StarCount;
  capacity: number;
  private: boolean;
  phase: RoomPhase;
  /** Seats currently claimed by humans. */
  seatsTaken: number;
}

/**
 * Server `error { code }` values; also the client's `lastError` set.
 * version_mismatch and room_full arrive as the hello answer and the
 * socket closes; kicked arrives before the server closes the kicked
 * socket; room_not_found answers a join to a missing room.
 */
export type ErrorCode =
  | 'room_not_found'
  | 'room_full'
  | 'version_mismatch'
  | 'kicked';

/** One seat's row in a standings snapshot. Host-authored (the host sim
 *  is the authority); clients never reconstruct standings. Final
 *  standings always carry placement + eliminationOrder for ALL seats,
 *  eliminated included; live placement may be null. */
export interface Standing {
  ownerId: string;
  starId: string;
  /** The seat's team (TEAMS): host-filled from the sim's seat
   *  records. Optional so pre-teams readers/snapshots stay valid. */
  teamId?: TeamId;
  placement: number | null;
  stage: StarStage;
  progressWithinStage: number;
  fedTotal: number;
  mass: number;
  integrity: number;
  alive: boolean;
  eliminated: boolean;
  eliminationOrder: number | null;
  kills: number;
}

export type MatchEndReason = 'last_survivor' | 'critical_mass';

/* ------------------------------------------------------------------ */
/* Host-authored event payloads. Defined here in P2-1; PRODUCED by the */
/* slice that owns the behavior (standings/stageChanged/matchEnded are */
/* authored by the host client and relayed verbatim by the DO).       */
/* ------------------------------------------------------------------ */

export interface StageChangedEvent {
  type: 'stageChanged';
  starId: string;
  ownerId: string;
  stage: StarStage;
  progressWithinStage: number;
  milestone: number;
}

export interface StandingsEvent {
  type: 'standings';
  standings: Standing[];
  seq: number;
}

export interface MatchEndedEvent {
  type: 'matchEnded';
  endReason: MatchEndReason;
  winnerOwnerId: string;
  /** starIndex of the winning seat. */
  winnerSeat: number;
  /** Critical-mass ends only: the collapsing star + when the cinematic
   *  began (ms epoch, shared so every client freezes together). Phase
   *  passes through 'cinematic' (sim frozen, input locked) before
   *  'results'; the winner is recorded as the star's CARETAKERS.
   *  Last-survivor ends go straight to results. */
  collapsingStarId?: string;
  cinematicStartedAt?: number;
  inputLockout: boolean;
  standings: Standing[];
}

/* ------------------------------------------------------------------ */
/* Client → server messages (WebSocket).                              */
/* ------------------------------------------------------------------ */

export type ClientMessage =
  /** First message on the socket (contract join flow). playerId is
   *  issued by the server on first hello and stored by the client;
   *  presenting it again is the reconnect/reclaim path (P2-3
   *  completes reclaim). */
  | {
      type: 'hello';
      clientVersion: number;
      callsign: string;
      playerId?: string;
    }
  /** Host-only, from the lobby: phase → 'live', arena live
   *  immediately. No ready state exists anywhere. */
  | { type: 'start' }
  /** Lobby-only team pick (TEAMS): the sender sets THEIR OWN seat's
   *  team — never another seat's. Lobby phase only; any palette team
   *  is legal (unbalanced splits included). Invalid picks (wrong
   *  phase, not your seat, unknown team) are silently ignored, per
   *  the wire's standing no-error-code philosophy. */
  | { type: 'setTeam'; teamId: TeamId }
  /** Host-only: free the target's seat (they get error 'kicked'). */
  | { type: 'kick'; targetPlayerId: string }
  /** Voluntary FORFEIT (Adam, 2026-10-21, grace-vs-forfeit ruling):
   *  the sender fully releases THEIR OWN seat — no grace hold, no
   *  reclaim; the seat reverts to bot/default and the sender's
   *  socket is closed by the server (clean close, not an error: a
   *  forfeit is a choice, not a punishment, and unlike a kick it
   *  carries NO ban — the player may rejoin later as a fresh claim).
   *  The other leave mode, STEP AWAY, has no message at all: it is
   *  the plain socket close, which has always meant grace (bot
   *  plays on, seat reclaimable) — now deliberately choosable, not
   *  only a disconnect accident. A dropped connection likewise
   *  defaults to grace. */
  | { type: 'forfeit' }
  /** Guest input intent — opaque JSON in P2-1, typed by P2-3. The DO
   *  relays it to the host connection only. */
  | { type: 'input'; payload: unknown }
  /** Host-only full-state snapshot — opaque JSON in P2-1, typed by
   *  P2-3. The DO caches it as the echo (migration starts from the
   *  freshest echo) and broadcasts it to everyone else. */
  | { type: 'snapshot'; state: unknown }
  /** Host liveness ping (design draft: 2s interval, 5s timeout). The
   *  DO records the timestamp; migration promotion is P2-3. */
  | { type: 'heartbeat' }
  /* Host-authored relays — defined in P2-1, relayed by the DO from
   * the slice that produces them (P2-2/P2-3 standings, P2-4 stage +
   * match end). The DO accepts them from the host only. */
  | StandingsEvent
  | StageChangedEvent
  | MatchEndedEvent;

/* ------------------------------------------------------------------ */
/* Server → client messages (WebSocket).                              */
/* ------------------------------------------------------------------ */

export type ServerMessage =
  /** Full sync: on join, and on any membership/phase change. */
  | { type: 'roomState'; room: RoomState }
  /** The hello answer: your identity + your seat + the full room. */
  | { type: 'welcome'; playerId: string; seat: Seat; room: RoomState }
  | { type: 'error'; code: ErrorCode }
  /** A human takes a seat (first claim or bot→human flip).
   *  `reclaimed` (P2-3a) is true when the claim restored the seat the
   *  same playerId held before a disconnect — the seat spent the gap
   *  in reconnect grace under bot control. Absent/false = fresh claim
   *  or live-match takeover of a bot seat. */
  | { type: 'seatClaimed'; seat: Seat; reclaimed?: boolean }
  /** A human leaves/disconnects; the seat flips back to bot. */
  | { type: 'seatReleased'; seat: Seat }
  /** Connection / callsign / eliminated change on a claimed seat. */
  | { type: 'seatUpdated'; seat: Seat }
  /** P2-3 produces these: the client renders a brief host-passing
   *  state, never a disconnect spinner. */
  | {
      type: 'hostMigrating';
      fromPlayerId: string;
      toPlayerId: string | null;
      reason: string;
    }
  | { type: 'hostMigrated'; hostPlayerId: string; hostOwnerId: string }
  | StageChangedEvent
  | StandingsEvent
  | MatchEndedEvent
  /** A guest's input intent, relayed to the host only. */
  | {
      type: 'input';
      fromOwnerId: string;
      fromPlayerId: string;
      payload: unknown;
    }
  /** The host's latest snapshot, relayed to everyone but the host. */
  | { type: 'snapshot'; state: unknown };

/* ------------------------------------------------------------------ */
/* HTTP shapes (Worker routes).                                       */
/* ------------------------------------------------------------------ */

/** POST /api/rooms body (contract join flow). `private` is accepted
 *  alongside the contract's three named fields (design draft §3
 *  create payload) and defaults to false — flagged in the P2-1
 *  report as the one brief/contract overlap. */
export interface CreateRoomRequest {
  name: string;
  starCount: StarCount;
  clientVersion: number;
  private?: boolean;
}

/** POST /api/rooms answer. Creating ≠ seated: the creator opens the
 *  WebSocket and says hello like everyone else. */
export interface CreateRoomResponse {
  code: string;
  roomId: string;
  seed: number;
  room: RoomState;
}

/** GET /api/rooms answer: public rooms only (private rooms are
 *  unlisted and join by code/link). */
export interface ListRoomsResponse {
  rooms: RoomMeta[];
}

/* ------------------------------------------------------------------ */
/* Client-side state enums (contract "Client states"). These types    */
/* live here so the client net layer (P2-2+) and the UI lane bind to   */
/* one definition; P2-1 ships the types, not a client.                */
/* ------------------------------------------------------------------ */

export type ClientConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnect_grace'
  | 'desync';

export interface ClientState {
  connection: ClientConnectionState;
  /** Set by server `error { code }` messages. */
  lastError: ErrorCode | null;
  /** Ms epoch; present while connection = 'reconnect_grace'. */
  reconnectGraceEndsAt?: number;
  /** Present while connection = 'desync' (a snapshot sequence gap);
   *  a fresh full snapshot = resync. */
  desync?: { expectedSeq: number; gotSeq: number };
}
