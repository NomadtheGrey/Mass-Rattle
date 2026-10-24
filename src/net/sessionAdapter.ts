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

import type { EscortShip, GameState, Harvester, SeatSimState } from '../types';
import type { NetInputPayload } from './useNetClient';
import { tryRepurchase } from '../sim/deathEconomy';
import { starIdForSeat } from '../sim/ownership';
import { isValidTarget, nextTargetId } from '../sim/targeting';
import type { EventFeedEntry } from '../sim/eventFeed';
import {
  seatBuyTrack, seatBuyItem, seatEquipItem, seatBuyType, seatBuyHullStep,
  seatBuyTurretMount, seatSwitchLine, seatBuildDrone, seatBuildDefenseDrone,
  seatBuildEscort, seatFeedCargo, seatDepositBank, seatWithdrawBank,
  seatSetDeliveryMode, seatSetRepairing,
  type SeatShopCtx, type SeatShopChange, type UpgradeTrack,
} from '../sim/seatShop';
import type { ShipLine, EscortKind } from '../shipProgression';
import { canDockAt, HARBOR_DOCK_RANGE } from '../sim/harbor';

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
  /** DUMP ALL (J): the whole hold overboard behind the ship. */
  wantsJettisonAll: boolean;
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
  jettisonAll?: boolean;
  fire: boolean;
  analogStick: { x: number; y: number } | null;
}

const stickDistOf = (stick: { x: number; y: number } | null): number =>
  stick ? Math.sqrt(stick.x * stick.x + stick.y * stick.y) : 0;

/**
 * The LOCAL seat's input, resolved from the same key set + touch ref
 * the shipped SP input phase reads — the expressions are the frame's
 * own (ArrowUp/KeyW/thrust/stick for thrust, KeyF for fire, Space for
 * jettison, Q for VAC — E and R left the VAC read when the
 * settled key map (CONTROLS.md) made them ITEM and REPAIR), so the local ship's routine receives
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
    wantsJettisonAll: keys.has('KeyJ') || !!touch.jettisonAll,
    rotateLeft:
      keys.has('ArrowLeft') || keys.has('KeyA') || touch.rotateLeft,
    rotateRight:
      keys.has('ArrowRight') || keys.has('KeyD') || touch.rotateRight,
    vac: keys.has('KeyQ') || touch.vac,
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
    wantsJettisonAll: payload.jettisonAll ?? false,
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
  wantsJettisonAll: false,
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
 * Economy ACTION intents from remote seats were NOT applied in
 * v1: per-seat banks/wallets were not sim-wired beyond the local
 * seat (P2-2b). B2 LANDED the per-seat economy (2026-10-22):
 * consumeEconomyIntents (below) applies the economy kinds to the
 * sender's seat through the seat shop, and 'repurchase' has been
 * consumed since the P2-5 follow-on. What remains counted here
 * is what is still genuinely unapplied — 'decoy' (a combat verb,
 * not economy) and 'toggleShop' (the guest's own UI state) —
 * module-level and greppable, so the remainder is measured, not
 * silent.
 */
export let droppedRemoteActionIntents = 0;

const CONSUMED_ACTION_KINDS = new Set([
  'repurchase',
  'buyTrack', 'buyItem', 'equipItem', 'buyType', 'buyHull',
  'buyTurretMount', 'switchLine', 'buildDrone', 'buildDefenseDrone',
  'buildEscort', 'bankDeposit', 'bankWithdraw', 'feed',
  'setDeliveryMode', 'setRepairing',
  'cycleTarget', 'setTarget',
]);

/** Apply a remote seat's TARGET intents (the Controls
 *  follow-on contract): cycle advances through the lock law's
 *  seat-order track; set names a specific ship and lands only
 *  while it is a valid target — anything else (including an
 *  absent targetOwnerId) clears the lock. Runs inside the same
 *  seq gate as repurchase and the economy, against the SENDER's
 *  seat; locks die per-frame by stepTargetLocks in the loop. */
export const consumeTargetIntents = (
  seat: SeatSimState,
  payload: NetInputPayload,
  seats: SeatSimState[],
): void => {
  const actions = payload.actions;
  if (!actions || actions.length === 0 || !seat.ship) return;
  for (const action of actions) {
    if (action.kind === 'cycleTarget') {
      seat.ship.targetId = nextTargetId(seats, seat.ship) ?? undefined;
    } else if (action.kind === 'setTarget') {
      seat.ship.targetId =
        action.targetOwnerId && isValidTarget(seats, seat.ship, action.targetOwnerId)
          ? action.targetOwnerId
          : undefined;
    }
  }
};

export const countDroppedActions = (payload: NetInputPayload): number => {
  // Consumed kinds are NOT counted (see the set above). The
  // remainder — decoy, toggleShop, anything unknown — is.
  const n = (payload.actions ?? []).filter(a => !CONSUMED_ACTION_KINDS.has(a.kind)).length;
  droppedRemoteActionIntents += n;
  return n;
};

/* ------------------------------------------------------------------ */
/* Guest economy consumption (B2 per-seat economy follow-on)           */
/* ------------------------------------------------------------------ */

export interface GuestEconomyResult {
  /** Replacement arrays when a reconcile changed them. */
  drones?: Harvester[];
  escorts?: EscortShip[];
  /** Newly built units for the caller to append. */
  addDrones: Harvester[];
  addEscorts: EscortShip[];
}

const SHIP_LINES: ShipLine[] = ['fighter', 'minelayer', 'hauler', 'drone', 'cruiser'];
const UPGRADE_TRACKS: UpgradeTrack[] = ['thrust', 'handling', 'attractor', 'fuel', 'cargo'];
const ESCORT_KINDS: EscortKind[] = ['skiff', 'stinger', 'lancer'];

/**
 * Apply a guest payload's economy intents to the SENDER's seat,
 * in order, through the seat shop (src/sim/seatShop.ts) — the
 * sender buys through the host against their OWN seat bank
 * under the same wallet rules as anyone (hold first, then bank;
 * the well is the market). Refusals are silent and total per
 * intent (an unaffordable buy changes nothing and does not
 * block the rest of the payload). Exactly-once is structural,
 * as with repurchase: the caller runs this inside the seq gate.
 * Returns null when the payload carries no economy intent.
 */
export const consumeEconomyIntents = (
  seat: SeatSimState,
  payload: NetInputPayload,
  ctx: SeatShopCtx,
): GuestEconomyResult | null => {
  const actions = (payload.actions ?? []).filter(a => a.kind !== 'repurchase');
  if (!actions.length) return null;
  const out: GuestEconomyResult = { addDrones: [], addEscorts: [] };
  let applied = false;
  const adopt = (change: SeatShopChange | null): void => {
    if (!change) return;
    applied = true;
    if (change.drones) { out.drones = change.drones; ctx.drones = change.drones; }
    if (change.escorts) { out.escorts = change.escorts; ctx.escorts = change.escorts; }
    if (change.drone) { out.addDrones.push(change.drone); ctx.drones = [...ctx.drones, change.drone]; }
    if (change.escort) { out.addEscorts.push(change.escort); ctx.escorts = [...ctx.escorts, change.escort]; }
  };
  for (const a of actions) {
    switch (a.kind) {
      case 'buyTrack':
        if (UPGRADE_TRACKS.includes(a.track as UpgradeTrack)) adopt(seatBuyTrack(seat, ctx, a.track as UpgradeTrack));
        break;
      case 'buyItem': adopt(seatBuyItem(seat, ctx, a.itemId)); break;
      case 'equipItem': adopt(seatEquipItem(seat, ctx, a.itemId)); break;
      case 'buyType':
        adopt(seatBuyType(seat, ctx, a.line && SHIP_LINES.includes(a.line as ShipLine) ? (a.line as ShipLine) : undefined));
        break;
      case 'buyHull': adopt(seatBuyHullStep(seat, ctx)); break;
      case 'buyTurretMount': adopt(seatBuyTurretMount(seat, ctx)); break;
      case 'switchLine':
        if (SHIP_LINES.includes(a.line as ShipLine)) adopt(seatSwitchLine(seat, ctx, a.line as ShipLine));
        break;
      case 'buildDrone': adopt(seatBuildDrone(seat, ctx)); break;
      case 'buildDefenseDrone': adopt(seatBuildDefenseDrone(seat, ctx)); break;
      case 'buildEscort':
        if (ESCORT_KINDS.includes(a.escortKind as EscortKind)) adopt(seatBuildEscort(seat, ctx, a.escortKind as EscortKind));
        break;
      case 'bankDeposit': adopt(seatDepositBank(seat, ctx)); break;
      case 'bankWithdraw': adopt(seatWithdrawBank(seat, ctx)); break;
      case 'feed': adopt(seatFeedCargo(seat, ctx)); break;
      case 'setDeliveryMode': if (seatSetDeliveryMode(seat, a.mode)) applied = true; break;
      case 'setRepairing': if (seatSetRepairing(seat, a.on)) applied = true; break;
      /* HARBOR VERBS (Adam's commission, 2026-10-24): the host
       * applies each against the SENDER's seat, under the local
       * verbs' own gates — canDockAt's consent (teammates,
       * hosting line, open harbor, capacity) plus the dock
       * range, for berthing; undockGuest only releases a guest
       * docked TO the sender, never another host's guest. */
      case 'dockToHost': {
        const hostSeat = ctx.seats.find(s => s.ownerId === a.hostOwnerId);
        const host = hostSeat?.ship;
        const mine = seat.ship;
        if (host && mine && !mine.dockedTo && canDockAt(ctx.seats, mine, host)) {
          const d = Math.hypot(mine.pos.x - host.pos.x, mine.pos.y - host.pos.y);
          if (d <= host.size + HARBOR_DOCK_RANGE) { mine.dockedTo = a.hostOwnerId; applied = true; }
        }
        break;
      }
      case 'undock':
        if (seat.ship?.dockedTo) { seat.ship.dockedTo = undefined; applied = true; }
        break;
      case 'setHarborOpen':
        if (seat.ship) { seat.ship.harborOpen = a.open; applied = true; }
        break;
      case 'undockGuest': {
        const guest = ctx.seats.find(s => s.ownerId === a.guestOwnerId);
        if (guest?.ship?.dockedTo === seat.ownerId) { guest.ship.dockedTo = undefined; applied = true; }
        break;
      }
      default: break; // decoy / toggleShop / unknown: not economy
    }
  }
  return applied ? out : null;
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
  const bought = tryRepurchase(seat, at);
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
