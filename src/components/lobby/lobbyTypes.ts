/**
 * Lobby PRESENTATION maps (UI lane) — the labels the client renders
 * from the protocol's enums. The wire types themselves live in ONE
 * place: src/net/protocol.ts (BackGround's P2-1), which mirrors the
 * frozen contract in massrattle-multiplayer-notes.md. No display
 * strings travel on the wire except room name + callsigns, so every
 * string below is ours to render.
 */
import type { StarStage, MatchEndReason, ErrorCode, SeatConnection, Seat } from '../../net/protocol';

/** The non-color identity cue as a glyph (shape name -> shape). */
export const CUE_GLYPHS: Record<string, string> = {
  triangle: '▲',
  diamond: '◆',
  circle: '●',
  square: '■',
};

export const STAGE_LABELS: Record<StarStage, string> = {
  red_dwarf: 'RED DWARF',
  red_giant: 'RED GIANT',
  yellow: 'YELLOW STAR',
  white: 'WHITE STAR',
  neutron: 'NEUTRON STAR',
  black_hole: 'BLACK HOLE',
};

export const END_REASON_LABELS: Record<MatchEndReason, string> = {
  last_survivor: 'CONQUEST',
  critical_mass: 'CRITICAL MASS',
};

export const ERROR_LABELS: Record<ErrorCode, string> = {
  room_not_found: 'NO ROOM WITH THAT CODE — CHECK IT AND TRY AGAIN',
  room_full: 'THAT ROOM IS FULL — EVERY STAR HAS A CARETAKER',
  version_mismatch: 'VERSION MISMATCH — REFRESH THE GAME AND TRY AGAIN',
  kicked: 'YOU WERE REMOVED FROM THAT ROOM',
};

export const SEAT_CONNECTION_LABELS: Record<SeatConnection, string> = {
  connected: 'CONNECTED',
  reconnect_grace: 'RECONNECTING…',
  disconnected: 'DROPPED',
  bot: 'BOT',
};

/* ------------------------------ Teams ------------------------------- */
/* Frozen contract (BackGround, 2026-10-21): TeamId + TEAM_COLORS land
 * in src/net/protocol.ts with their slice; these mirrors carry the
 * same values so the lobby builds in parallel, and re-point there on
 * their landing. Picker order is contractual: red, blue, green, gold. */

export type TeamId = 'red' | 'blue' | 'green' | 'gold';

export const TEAM_ORDER: TeamId[] = ['red', 'blue', 'green', 'gold'];

export const TEAM_COLORS: Record<TeamId, string> = {
  red: '#ff6a5e',
  blue: '#57b6ff',
  green: '#6dffa8',
  gold: '#ffc94d',
};

export const TEAM_LABELS: Record<TeamId, string> = {
  red: 'RED',
  blue: 'BLUE',
  green: 'GREEN',
  gold: 'GOLD',
};

/** Each seat's default team = its own seat color as a solo team, so an
 * untouched lobby is exactly the free-for-all: seat 0 blue, 1 red,
 * 2 gold, 3 green. */
export const DEFAULT_TEAM_BY_SEAT: TeamId[] = ['blue', 'red', 'gold', 'green'];

/** The seat's team. Reads the contract's teamId when the wire carries
 * it and falls back to the seat's contractual default — an untouched
 * lobby is a free-for-all of solo colors either way. */
export const seatTeam = (seat: Seat): TeamId =>
  (seat as Seat & { teamId?: TeamId }).teamId ?? DEFAULT_TEAM_BY_SEAT[seat.starIndex] ?? 'blue';
