/**
 * B2 — BOT ECONOMY (RULED, ReadMeFiles/BOTS.md; Adam's fairness
 * doctrine PINNED 2026-10-22: "the game would play fairly,
 * instead of instantly upgrading like Empire Earth did").
 *
 * Bots hold REAL seat accounts and pay REAL prices through the
 * seat shop (src/sim/seatShop.ts) — the same wallet, well gate,
 * and tables a captain's verbs use. Nothing is conjured: a
 * bot's scrap comes from its own harvesters and its own hold,
 * split by policy through the seat's deliveryMode field.
 *
 * POLICY: while the bank cannot cover the NEXT purchase goal,
 * deliveries DEPOSIT; once it can, deliveries FEED (the star
 * grows again) until the purchase lands in the well and a new
 * goal prices. The bot SHIP's own deliveries follow the field
 * (wired in the loop's bot-delivery read); its DRONES follow it
 * through the ordinary delivery read (the hauler bind applies,
 * as for any seat).
 *
 * PURCHASES (priority DRAFT, BOTS.md): paid repurchase is NOT
 * here — the frame's bot buy-back (deathEconomy) already prices
 * it from the bank the moment a bot has one. Then: own-line
 * progression (a line SEEDED per seat, so bot fields don't
 * mirror) → workforce to cap → defense pair → turret mounts →
 * arsenal tiers. Purchases evaluate only at a team dock (the
 * well is the market, for bots as for captains), at most one
 * per cadence per bot.
 *
 * FREEZE SOFTENING (b) (adopted): the purchase walk buys the
 * first AFFORDABLE goal in priority order — an unaffordable top
 * goal never idles the whole economy while cheaper later goals
 * sit unfilled (the freeze (b) exists to kill; its named case,
 * a dead bot's economy locking onto repurchase, cannot occur
 * here at all: the frame's buy-back prices repurchase at 20% of
 * bank, always coverable, the moment its delay elapses).
 */
import type { SeatSimState } from '../types';
import {
  typeFor, typeStepPrice, hullStepPrice, switchToll, autoGunCapFor, turretMountPriceFor,
  DRONE_PRICE, DEFENSE_DRONE_PRICE, type ShipLine,
} from '../shipProgression';
import { LOADOUT_ITEMS, getLoadoutItem, itemTierCost, canMountWeapon, MAX_ITEM_TIER } from '../loadout';
import {
  inTeamWell, walletPay,
  seatBuyType, seatBuyHullStep, seatSwitchLine, seatBuildDrone, seatBuildDefenseDrone,
  seatBuyTurretMount, seatBuyItem,
  type SeatShopCtx, type SeatShopChange,
} from './seatShop';

/** Purchase evaluation cadence per bot (ms of loop clock). DRAFT. */
export const BOT_ECONOMY_CADENCE_MS = 1500;

const LINES: ShipLine[] = ['fighter', 'minelayer', 'hauler', 'drone', 'cruiser'];

const seatHash = (ownerId: string): number => {
  let h = 2166136261;
  for (let i = 0; i < ownerId.length; i++) {
    h = Math.imul(h ^ ownerId.charCodeAt(i), 16777619);
  }
  return h >>> 0;
};

/** The line this seat's bot climbs — seeded, stable, its own. */
export const botLineFor = (ownerId: string): ShipLine => LINES[seatHash(ownerId) % LINES.length];

/** The seat's arsenal shopping order — the item table rotated
 *  by the seat's hash, so bot loadouts diverge like their lines. */
const botItemOrder = (ownerId: string): string[] => {
  const ids = LOADOUT_ITEMS.map(d => d.id);
  const rot = seatHash(ownerId) % ids.length;
  return [...ids.slice(rot), ...ids.slice(0, rot)];
};

interface BotGoal {
  price: number;
  apply: (seat: SeatSimState, ctx: SeatShopCtx) => SeatShopChange | null;
}

/** The priority list, priced against the seat as it stands.
 *  Each entry knows its price AND its purchase, so the policy
 *  (goal pricing) and the walk (buying) read one list. */
export const botGoals = (seat: SeatSimState, ctx: SeatShopCtx): BotGoal[] => {
  const ship = seat.ship;
  if (!ship) return [];
  const goals: BotGoal[] = [];
  const chosen = botLineFor(seat.ownerId);
  // Own-line progression.
  if (ship.line !== chosen) {
    if (ship.typeTier === 1) {
      goals.push({ price: typeStepPrice(chosen, 1), apply: (s, c) => seatBuyType(s, c, chosen) });
    } else if (ship.line) {
      goals.push({ price: switchToll(ship), apply: (s, c) => seatSwitchLine(s, c, chosen) });
    }
  } else if (ship.typeTier < 5) {
    goals.push({ price: typeStepPrice(chosen, ship.typeTier), apply: (s, c) => seatBuyType(s, c, chosen) });
  } else if (ship.hullSteps < typeFor(ship.line, ship.typeTier).hullStepCap) {
    goals.push({ price: hullStepPrice(ship.hullSteps), apply: (s, c) => seatBuyHullStep(s, c) });
  }
  // Workforce to cap.
  const fielded = ctx.drones.filter(d => d.ownerId === seat.ownerId && d.mode !== 'defense' && !d.starFleet && !d.liquidating).length;
  if (fielded < typeFor(ship.line, ship.typeTier).dronesFielded) {
    goals.push({ price: DRONE_PRICE, apply: (s, c) => seatBuildDrone(s, c) });
  }
  // Defense pair.
  const guards = ctx.drones.filter(d => d.ownerId === seat.ownerId && d.mode === 'defense').length;
  if (guards < typeFor(ship.line, ship.typeTier).defenseDrones) {
    goals.push({ price: DEFENSE_DRONE_PRICE, apply: (s, c) => seatBuildDefenseDrone(s, c) });
  }
  // Turret mounts.
  if (ship.turretMounts < autoGunCapFor(ship.line, ship.typeTier)) {
    goals.push({ price: turretMountPriceFor(ship.turretMounts), apply: (s, c) => seatBuyTurretMount(s, c) });
  }
  // Arsenal tiers, the seat's own order.
  for (const id of botItemOrder(seat.ownerId)) {
    const def = getLoadoutItem(id);
    if (!def) continue;
    const owned = ship.arsenal[id] || 0;
    if (owned >= MAX_ITEM_TIER) continue;
    if (!canMountWeapon(ship.line, ship.typeTier, id)) continue;
    goals.push({ price: itemTierCost(def, owned), apply: (s, c) => seatBuyItem(s, c, id) });
    break; // one arsenal goal at a time; the list re-prices next pass
  }
  return goals;
};

/** Cadence bookkeeping — pacing only, never match state. */
const lastBuyBySeat = new Map<string, number>();

/**
 * One bot-economy pass for a bot seat: set its delivery policy
 * from its next goal, then (at a team dock, on cadence) make at
 * most one purchase — the first goal the wallet covers, in
 * priority order (softening (b)). Returns the purchase's change
 * (the caller adopts any drones/escorts arrays and appends any
 * built drone), or null when nothing was bought.
 */
export const stepBotEconomy = (
  seat: SeatSimState,
  ctx: SeatShopCtx,
  time: number,
): SeatShopChange | null => {
  if (seat.controller !== 'bot' || seat.eliminated) return null;
  const goals = botGoals(seat, ctx);
  const top = goals[0];
  seat.deliveryMode = top && seat.bankedScrap < top.price ? 'deposit' : 'feed';
  const ship = seat.ship;
  if (!ship || !top) return null;
  if (!inTeamWell(ctx.seats, ship)) return null;
  if (time - (lastBuyBySeat.get(seat.ownerId) ?? -Infinity) < BOT_ECONOMY_CADENCE_MS) return null;
  // The walk (softening (b)): the first goal the wallet covers,
  // in priority order — the top goal when it's affordable, else
  // the first later goal that is, so an expensive climb never
  // freezes the cheaper lines of the list.
  for (const goal of goals) {
    if (!walletPay(ship.carrying, seat.bankedScrap, goal.price, true)) continue;
    const change = goal.apply(seat, ctx);
    if (change) {
      lastBuyBySeat.set(seat.ownerId, time);
      return change;
    }
  }
  return null;
};
