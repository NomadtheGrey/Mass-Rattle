/**
 * Loop session adapter (Phase 2, P2-3b, BackGround half) — the pure
 * glue between the net session (src/net/useNetClient.ts, UI lane) and
 * the game loop's frame. No React, no hooks, no I/O: input resolution,
 * viewer projection, and snapshot cadence math only, so tsx can
 * sanity-test every helper without a browser.
 *
 * The wire contract is src/net/protocol.ts; the payload shape is the
 * UI lane's NetInputPayload (imported as a type only).
 */

import type { GameState, SeatSimState } from '../types';
import type { NetInputPayload } from './useNetClient';
import { tryRepurchase } from '../sim/deathEconomy';
import { starIdForSeat } from '../sim/ownership';
import type { EventFeedEntry } from '../sim/eventFeed';

/** Host snapshot cadence: one full-state snapshot every 5 frames —
 *  12 Hz at the sim's 60 fps (design draft §1, DRAFT rate). */
export const SNAPSHOT_EVERY_FRAMES = 5;

/** True when the host's frame counter reaches a snapshot boundary. */
export const snapshotDue = (frameCount: number): boolean =>
  frameCount > 0 && frameCount % SNAPSHOT_EVERY_FRAMES === 0;

/* ------------------------------------------------------------------ */
/* Per-ship frame input                                                */
/* ------------------------------------------------------------------ */

/**
 * The wants* shape the frame's per-ship routine consumes — resolved
 * from the local devices for the local seat, or from a relayed
 * NetInputPayload for a remote human seat on the host.
 */
export interface ShipFrameInput {
  wantsThrust: boolean;
  wantsFire: boolean;
  wantsJettison: boolean;
  rotateLeft: boolean;
  rotateRight: boolean;
  vac: boolean;
  /** Analog stick vector driving this ship, or null. */
  stick: { x: number; y: number } | null;
}

/** Structural view of the loop's touch-input ref (the fields the
 *  input resolution reads). */
export interface TouchInputLike {
  thrust: boolean;
  rotateLeft: boolean;
  rotateRight: boolean;
  vac: boolean;
  jettison: boolean;
  fire: boolean;
  analogStick: { x: number; y: number } | null;
}

const stickDistOf = (stick: { x: number; y: number } | null): number =>
  stick ? Math.sqrt(stick.x * stick.x + stick.y * stick.y) : 0;

/**
 * The LOCAL seat's input, resolved from the same key set + touch ref
 * the shipped SP input phase reads — the expressions are the frame's
 * own (ArrowUp/KeyW/thrust/stick for thrust, KeyF for fire, Space for
 * jettison, Q/E/R for VAC), so the local ship's routine receives
 * exactly what the inline code computed.
 */
export const localShipInput = (
  keys: ReadonlySet<string>,
  touch: TouchInputLike,
): ShipFrameInput => {
  const stick = touch.analogStick;
  const stickThrust = stickDistOf(stick) > 0.45;
  return {
    wantsThrust:
      keys.has('ArrowUp') || keys.has('KeyW') || touch.thrust || stickThrust,
    wantsFire: keys.has('KeyF') || touch.fire,
    wantsJettison: keys.has('Space') || touch.jettison,
    rotateLeft:
      keys.has('ArrowLeft') || keys.has('KeyA') || touch.rotateLeft,
    rotateRight:
      keys.has('ArrowRight') || keys.has('KeyD') || touch.rotateRight,
    vac: keys.has('KeyQ') || keys.has('KeyE') || keys.has('KeyR') || touch.vac,
    stick,
  };
};

/**
 * A REMOTE human seat's input on the host, from its relayed payload.
 * `vac` is optional on the wire (older payloads predate the field);
 * absent reads as not-held.
 */
export const remoteShipInput = (payload: NetInputPayload): ShipFrameInput => {
  const stick = payload.stick ?? null;
  const stickThrust = stickDistOf(stick) > 0.45;
  return {
    wantsThrust: payload.thrust || stickThrust,
    wantsFire: payload.fire,
    wantsJettison: payload.jettison,
    rotateLeft: payload.left,
    rotateRight: payload.right,
    vac: payload.vac ?? false,
    stick,
  };
};

/** No input at all — a human seat the host has heard nothing from
 *  yet this match still gets physics (gravity, friction), just no
 *  commands. */
export const idleShipInput = (): ShipFrameInput => ({
  wantsThrust: false,
  wantsFire: false,
  wantsJettison: false,
  rotateLeft: false,
  rotateRight: false,
  vac: false,
  stick: null,
});

/**
 * Stale-frame gate for guest payloads: a payload is NEW when its seq
 * beats the last consumed seq for that seat. (The net hook's
 * guestInputsRef already keeps only the freshest payload per seat;
 * this gate is the loop-side belt-and-braces the contract asks for,
 * and it is what makes the action-intent counting below fire exactly
 * once per payload.)
 */
export const acceptGuestPayload = (
  lastConsumedSeq: number,
  payload: NetInputPayload,
): boolean => payload.seq > lastConsumedSeq;

/* ------------------------------------------------------------------ */
/* Dropped economy intents (v1 cut — see the P2-3b report)             */
/* ------------------------------------------------------------------ */

/**
 * Economy ACTION intents (buy/equip/feed/bank/shop) from remote
 * seats are NOT applied in v1: per-seat banks/wallets are not
 * sim-wired beyond the local seat (P2-2b), so a remote seat has no
 * wallet for the host to pay from. The intents are counted here —
 * module-level and greppable — so the deferral is measured, not
 * silent, until the per-seat economy lands.
 */
export let droppedRemoteActionIntents = 0;

export const countDroppedActions = (payload: NetInputPayload): number => {
  // 'repurchase' is NOT counted: since the P2-5 follow-on it is
  // consumed (consumeRepurchaseIntent, below), not dropped. Every
  // other economy kind remains counted + dropped, unchanged.
  const n = (payload.actions ?? []).filter(a => a.kind !== 'repurchase').length;
  droppedRemoteActionIntents += n;
  return n;
};

/* ------------------------------------------------------------------ */
/* Guest repurchase consumption (P2-5 follow-on)                       */
/* ------------------------------------------------------------------ */

/**
 * A relayed payload asks for a repurchase when its discrete intents
 * include the bare { kind: 'repurchase' } member (the UI lane's
 * NetActionIntent addition): the host derives the seat from the
 * relay tag, so the intent carries no argument.
 */
export const hasRepurchaseIntent = (payload: NetInputPayload): boolean =>
  (payload.actions ?? []).some(a => a.kind === 'repurchase');

export interface GuestRepurchase {
  /** Scrap the seat actually paid (host-computed; 0 at the floor). */
  cost: number;
  /** The feed record to append — the same shape the bot buy-back
   *  and the local repurchaseShip callback append. */
  record: EventFeedEntry;
}

/**
 * Apply a guest's repurchase intent to the SENDER's seat, through
 * the same sim operation the local callback uses (deathEconomy's
 * tryRepurchase: price from the seat's bank, fresh starter through
 * the assembly placement, shipless stamp cleared). Returns null —
 * and mutates nothing — when the payload carries no repurchase
 * intent or the sim refuses (ship alive, never died, eliminated
 * seat): silent and total, per the wire's no-error-code
 * philosophy; the guest's next snapshot simply shows the seat
 * still shipless. Exactly-once is structural: the caller runs
 * this inside the seq gate (one shot per fresh payload), and a
 * second application would find a live ship and refuse.
 */
export const consumeRepurchaseIntent = (
  seat: SeatSimState,
  payload: NetInputPayload,
  at: number,
): GuestRepurchase | null => {
  if (!hasRepurchaseIntent(payload)) return null;
  const bought = tryRepurchase(seat);
  if (!bought) return null;
  return {
    cost: bought.cost,
    record: {
      type: 'repurchase',
      ownerId: seat.ownerId,
      starId: starIdForSeat(seat.starIndex),
      cost: bought.cost,
      deaths: seat.deaths,
      at,
    },
  };
};

/* ------------------------------------------------------------------ */
/* Viewer projection                                                   */
/* ------------------------------------------------------------------ */

/**
 * Project a host-oriented GameState into a VIEWER's view: the
 * top-level ship/star/enemyStar/bankedScrap/teamScrap become the
 * viewer seat's own (ship/star are the SAME objects as the viewer's
 * seat records — the projection law the loop maintains), enemyStar
 * is the first hostile seat's star (exact for 2 seats), and the
 * win/loss flags are re-derived for the viewer: victory is the
 * match end naming the viewer, game-over is the viewer's own ship
 * at 0 health. Everything else (seats, standings, entities) rides
 * through untouched — the seats array keeps the host's orientation
 * and object references, which is what lets a promoted guest resume
 * hosting from an applied snapshot without re-anchoring surgery.
 *
 * A shipless viewer (ship destroyed, death economy still to come in
 * P2-5) keeps the raw top-level ship as a render fallback — flagged
 * in the P2-3b report.
 */
export const projectStateForViewer = (
  state: GameState,
  viewerOwnerId: string,
): GameState => {
  const viewerSeat = state.seats.find(s => s.ownerId === viewerOwnerId);
  if (!viewerSeat) return state;
  const firstHostile = state.seats.find(s => s.ownerId !== viewerOwnerId);
  return {
    ...state,
    ship: viewerSeat.ship ?? state.ship,
    star: viewerSeat.star,
    enemyStar: firstHostile ? firstHostile.star : state.enemyStar,
    bankedScrap: viewerSeat.bankedScrap,
    teamScrap: viewerSeat.fedTotal,
    isVictory: state.matchEnd
      ? state.matchEnd.winnerOwnerId === viewerOwnerId
      : false,
    isGameOver: viewerSeat.ship ? viewerSeat.ship.health <= 0 : false,
  };
};
