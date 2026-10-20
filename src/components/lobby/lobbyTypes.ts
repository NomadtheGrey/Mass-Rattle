/**
 * Lobby PRESENTATION maps (UI lane) — the labels the client renders
 * from the protocol's enums. The wire types themselves live in ONE
 * place: src/net/protocol.ts (BackGround's P2-1), which mirrors the
 * frozen contract in massrattle-multiplayer-notes.md. No display
 * strings travel on the wire except room name + callsigns, so every
 * string below is ours to render.
 */
import type { StarStage, MatchEndReason, ErrorCode, SeatConnection } from '../../net/protocol';

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
