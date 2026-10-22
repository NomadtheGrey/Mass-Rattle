/**
 * THE SEAT SHOP — every economy verb as a seat-level core
 * (B2, 2026-10-22; ReadMeFiles/BOTS.md + ECONOMY_AND_THE_WELL.md).
 *
 * The workshop's laws were born as useCallbacks over the LOCAL
 * seat's state in useGameLoop. Two more callers need the same
 * laws, honestly applied: B2's bot policy (a bot buys like
 * anyone, from its own bank, at real prices — Adam's fairness
 * doctrine, PINNED) and networked GUESTS (the per-seat economy
 * follow-on: a guest's purchase intent is applied by the host
 * to the SENDER's seat, against the sender's own bank).
 *
 * So the verbs live here, once, operating on a SeatSimState:
 * the wallet (hold first, then bank), the well gate (the team
 * dock is shared; the wallet is always the acting seat's own),
 * the price tables, the forced sell (reconcileSwitch) — the
 * local callbacks in useGameLoop remain the shipped surface
 * for the local captain and read the same tables; walletPay
 * and inTeamWell MOVED here from the loop so all three callers
 * share one text of the law.
 *
 * Every function returns a SeatShopChange on success and null
 * on refusal — silent and total, the wire's philosophy: an
 * unaffordable or ungated purchase simply does not happen.
 */
import { PHYSICS } from '../constants';
import type { EscortShip, Harvester, SeatSimState, Ship, Star } from '../types';
import {
  typeFor, capsFor, typeStepPrice, hullStepPrice, hullSizeFor, HULL_STEP_HEALTH,
  switchToll, autoGunCapFor, turretMountPriceFor, DRONE_PRICE, DEFENSE_DRONE_PRICE,
  DRONE_MAX_HEALTH, ESCORT_KIND_DEFS, escortCapFor, escortKindOf, canOrderWorkforce,
  type ShipLine, type TypeTier, type EscortKind,
} from '../shipProgression';
import { getLoadoutItem, itemTierCost, swapCostForTier, canMountWeapon, MAX_ITEM_TIER } from '../loadout';
import { inBankWell } from '../bank';
import { effectiveRadiusForStar } from './starStages';
import { areTeammates } from './teams';
import { reconcileSwitch } from '../switchReconcile';
import { infuseStar } from '../starGrowth';
import { applyDeliveryHeal } from '../starDefense';
import { createStarterShip } from './seatState';

/**
 * The VAC radius a ship carries: the base physics formula plus
 * the line/type's flat vacBonus, recomputed wherever the track,
 * line, or tier changes. (Moved from useGameLoop, B2.)
 */
export const attractRadiusForShip = (attractorLvl: number, line: ShipLine | null, tier: TypeTier): number =>
  PHYSICS.BASE_ATTRACT_RADIUS + attractorLvl * 35 + typeFor(line, tier).vacBonus;

/**
 * The combined wallet: a purchase draws from the cargo hold
 * first, then the bank — but the BANK is only accessible inside
 * the well (Adam, 2026-10-19). Returns null when the accessible
 * wallet cannot cover the cost. (Moved from useGameLoop, B2.)
 */
export const walletPay = (carrying: number, banked: number, cost: number, bankAccessible: boolean) => {
  const accessible = carrying + (bankAccessible ? banked : 0);
  if (accessible < cost) return null;
  const fromHold = Math.min(carrying, cost);
  return { carrying: carrying - fromHold, banked: banked - (cost - fromHold) };
};

/**
 * TEAMS dock gate (Adam's pin, 2026-10-21: "the team works
 * together to build the star"): a seat is AT A DOCK when its
 * ship sits in the bank well (effective radius, P2-4) of ANY
 * star on its own team — its own included, so SP and
 * all-default matches read exactly the own-well predicate.
 * (Moved from useGameLoop, B2.)
 */
export const inTeamWell = (seats: readonly SeatSimState[], ship: Ship): boolean =>
  seats.some(seat =>
    (seat.ownerId === ship.ownerId || areTeammates(seats, ship.ownerId, seat.ownerId)) &&
    inBankWell(ship.pos, seat.star.pos, effectiveRadiusForStar(seat.star)));

/** The frame context a seat-shop call reads beyond the seat. */
export interface SeatShopCtx {
  seats: readonly SeatSimState[];
  drones: Harvester[];
  escorts: EscortShip[];
  /** The local seat's ownerId — drone/escort `owner` labels are
   *  view-relative ('player' = the local seat's side). */
  localOwnerId: string;
}

/** What a successful verb changed beyond the seat itself. */
export interface SeatShopChange {
  drones?: Harvester[];
  escorts?: EscortShip[];
  drone?: Harvester;
  escort?: EscortShip;
  fedAmount?: number;
}

const ownerLabel = (ctx: SeatShopCtx, ownerId: string): 'player' | 'enemy' =>
  ownerId === ctx.localOwnerId ? 'player' : 'enemy';

/** Pay from the seat's wallet (its ship must be at a team dock —
 *  every caller gates on inTeamWell first). Returns false and
 *  mutates nothing when the wallet cannot cover the cost. */
const pay = (seat: SeatSimState, cost: number, inWell: boolean): boolean => {
  const ship = seat.ship;
  if (!ship) return false;
  const payment = walletPay(ship.carrying, seat.bankedScrap, cost, inWell);
  if (!payment) return false;
  seat.ship = { ...ship, carrying: payment.carrying };
  seat.bankedScrap = payment.banked;
  return true;
};

/* ------------------------------------------------------------------ */
/* The five upgrade tracks (the loop's `upgrade` verb, seated)         */
/* ------------------------------------------------------------------ */

export type UpgradeTrack = 'thrust' | 'handling' | 'attractor' | 'fuel' | 'cargo';

export const seatBuyTrack = (seat: SeatSimState, ctx: SeatShopCtx, type: UpgradeTrack): SeatShopChange | null => {
  const ship = seat.ship;
  if (!ship || !inTeamWell(ctx.seats, ship)) return null;
  const baseCost = type === 'thrust' ? PHYSICS.UPGRADE_COSTS.THRUST :
    type === 'handling' ? PHYSICS.UPGRADE_COSTS.HANDLING :
    type === 'attractor' ? PHYSICS.UPGRADE_COSTS.ATTRACTOR :
    type === 'fuel' ? PHYSICS.UPGRADE_COSTS.FUEL :
    PHYSICS.UPGRADE_COSTS.CARGO;
  const currentLevel = type === 'fuel' ? ship.upgrades.fuelCap : (ship.upgrades as unknown as Record<string, number>)[type];
  const capKey = type === 'attractor' ? 'vac' : type === 'fuel' ? 'fuel' : type;
  if (currentLevel >= capsFor(ship.line, ship.typeTier)[capKey]) return null;
  const cost = baseCost + currentLevel * Math.floor(baseCost * 0.5);
  if (!pay(seat, cost, true)) return null;
  const s = seat.ship!;
  const upgradeKey = type === 'fuel' ? 'fuelCap' : type;
  const upgrades = { ...s.upgrades, [upgradeKey]: (s.upgrades as unknown as Record<string, number>)[upgradeKey] + 1 };
  seat.ship = { ...s, upgrades };
  if (type === 'attractor') {
    seat.ship = { ...seat.ship, attractRadius: attractRadiusForShip(upgrades.attractor, s.line, s.typeTier) };
  }
  if (type === 'fuel') {
    seat.ship = { ...seat.ship, maxFuel: 100 + upgrades.fuelCap * 50, fuel: 100 + upgrades.fuelCap * 50 };
  }
  return {};
};

/* ------------------------------------------------------------------ */
/* Arsenal: buy a tier, equip an owned item                            */
/* ------------------------------------------------------------------ */

export const seatBuyItem = (seat: SeatSimState, ctx: SeatShopCtx, itemId: string): SeatShopChange | null => {
  const def = getLoadoutItem(itemId);
  const ship = seat.ship;
  if (!def || !ship || !inTeamWell(ctx.seats, ship)) return null;
  const owned = ship.arsenal[itemId] || 0;
  if (owned >= MAX_ITEM_TIER) return null;
  if (!canMountWeapon(ship.line, ship.typeTier, itemId)) return null;
  if (!pay(seat, itemTierCost(def, owned), true)) return null;
  const s = seat.ship!;
  const next: Ship = { ...s, arsenal: { ...s.arsenal, [itemId]: owned + 1 } };
  // First purchase auto-equips ONLY into an empty slot (the
  // loop verb's law; a taken slot swaps deliberately, paid).
  if (owned === 0 && !next.loadout[def.category]) {
    next.loadout = { ...next.loadout, [def.category]: itemId };
  }
  seat.ship = next;
  return {};
};

export const seatEquipItem = (seat: SeatSimState, ctx: SeatShopCtx, itemId: string): SeatShopChange | null => {
  const def = getLoadoutItem(itemId);
  const ship = seat.ship;
  if (!def || !ship || !inTeamWell(ctx.seats, ship)) return null;
  const owned = ship.arsenal[itemId] || 0;
  if (owned <= 0) return null;
  if (!canMountWeapon(ship.line, ship.typeTier, itemId)) return null;
  const slot = def.category;
  const current = ship.loadout[slot];
  if (current === itemId) return null;
  if (current !== null && !pay(seat, swapCostForTier(owned), true)) return null;
  seat.ship = { ...seat.ship!, loadout: { ...seat.ship!.loadout, [slot]: itemId } };
  return {};
};

/* ------------------------------------------------------------------ */
/* Feed / bank at the dock                                             */
/* ------------------------------------------------------------------ */

export const seatFeedCargo = (seat: SeatSimState, ctx: SeatShopCtx): SeatShopChange | null => {
  const ship = seat.ship;
  if (!ship || ship.carrying <= 0) return null;
  const amount = ship.carrying;
  const target = ctx.seats.find(s =>
    (s.ownerId === ship.ownerId || areTeammates(ctx.seats, ship.ownerId, s.ownerId)) &&
    inBankWell(ship.pos, s.star.pos, effectiveRadiusForStar(s.star)));
  if (!target) return null;
  infuseStar(target.star, amount);
  applyDeliveryHeal(target.star, amount);
  seat.ship = { ...ship, carrying: 0 };
  return { fedAmount: amount };
};

export const seatDepositBank = (seat: SeatSimState, ctx: SeatShopCtx): SeatShopChange | null => {
  const ship = seat.ship;
  if (!ship || !inTeamWell(ctx.seats, ship) || ship.carrying <= 0) return null;
  seat.bankedScrap += ship.carrying;
  seat.ship = { ...ship, carrying: 0 };
  return {};
};

export const seatWithdrawBank = (seat: SeatSimState, ctx: SeatShopCtx): SeatShopChange | null => {
  const ship = seat.ship;
  if (!ship || !inTeamWell(ctx.seats, ship) || seat.bankedScrap <= 0) return null;
  const regular = PHYSICS.CARGO.BASE_CAPACITY + ship.upgrades.cargo * PHYSICS.CARGO.UPGRADE_BONUS + typeFor(ship.line, ship.typeTier).cargoBonus;
  const total = regular + Math.floor(regular * PHYSICS.CARGO.OVERLOAD_RATIO);
  const moved = Math.min(Math.max(0, total - ship.carrying), seat.bankedScrap);
  if (moved <= 0) return null;
  seat.bankedScrap -= moved;
  seat.ship = { ...ship, carrying: ship.carrying + moved };
  return {};
};

/* ------------------------------------------------------------------ */
/* Progression: types, hull steps, mounts, line switches               */
/* ------------------------------------------------------------------ */

export const seatBuyType = (seat: SeatSimState, ctx: SeatShopCtx, line?: ShipLine): SeatShopChange | null => {
  const ship = seat.ship;
  if (!ship || !inTeamWell(ctx.seats, ship)) return null;
  if (ship.typeTier >= 5) return null;
  const targetLine = ship.typeTier === 1 ? line : ship.line;
  if (!targetLine) return null;
  if (!pay(seat, typeStepPrice(targetLine, ship.typeTier), true)) return null;
  const newTier = (ship.typeTier + 1) as TypeTier;
  const rec = reconcileSwitch(seat.ship!, ctx.drones, ctx.escorts, targetLine, newTier);
  const s = seat.ship!;
  seat.ship = {
    ...s, line: targetLine, typeTier: newTier,
    arsenal: rec.arsenal, loadout: rec.loadout, turretMounts: rec.turretMounts,
  };
  seat.ship = { ...seat.ship, attractRadius: attractRadiusForShip(seat.ship.upgrades.attractor, targetLine, newTier) };
  seat.bankedScrap += rec.refund;
  return {
    drones: ctx.drones
      .filter(d => !rec.soldDroneIds.includes(d.id))
      .map(d => rec.liquidateDroneIds.includes(d.id) ? { ...d, liquidating: true } : d),
    escorts: rec.soldEscortIds.length ? ctx.escorts.filter(e => !rec.soldEscortIds.includes(e.id)) : ctx.escorts,
  };
};

export const seatBuyHullStep = (seat: SeatSimState, ctx: SeatShopCtx): SeatShopChange | null => {
  const ship = seat.ship;
  if (!ship || !inTeamWell(ctx.seats, ship)) return null;
  if (ship.hullSteps >= typeFor(ship.line, ship.typeTier).hullStepCap) return null;
  if (!pay(seat, hullStepPrice(ship.hullSteps), true)) return null;
  const s = seat.ship!;
  const hullSteps = s.hullSteps + 1;
  seat.ship = {
    ...s, hullSteps, size: hullSizeFor(hullSteps),
    maxHealth: s.maxHealth + HULL_STEP_HEALTH, health: s.health + HULL_STEP_HEALTH,
  };
  return {};
};

export const seatBuyTurretMount = (seat: SeatSimState, ctx: SeatShopCtx): SeatShopChange | null => {
  const ship = seat.ship;
  if (!ship || !inTeamWell(ctx.seats, ship)) return null;
  if (ship.turretMounts >= autoGunCapFor(ship.line, ship.typeTier)) return null;
  if (!pay(seat, turretMountPriceFor(ship.turretMounts), true)) return null;
  seat.ship = { ...seat.ship!, turretMounts: seat.ship!.turretMounts + 1 };
  return {};
};

export const seatSwitchLine = (seat: SeatSimState, ctx: SeatShopCtx, line: ShipLine): SeatShopChange | null => {
  const ship = seat.ship;
  if (!ship || !inTeamWell(ctx.seats, ship)) return null;
  if (ship.typeTier < 2 || !ship.line || line === ship.line) return null;
  if (!pay(seat, switchToll(ship), true)) return null;
  const rec = reconcileSwitch(seat.ship!, ctx.drones, ctx.escorts, line, seat.ship!.typeTier);
  const s = seat.ship!;
  seat.ship = {
    ...s, line, lineSwitchesUsed: s.lineSwitchesUsed + 1,
    arsenal: rec.arsenal, loadout: rec.loadout, turretMounts: rec.turretMounts,
  };
  seat.ship = { ...seat.ship, attractRadius: attractRadiusForShip(seat.ship.upgrades.attractor, line, seat.ship.typeTier) };
  seat.bankedScrap += rec.refund;
  return {
    drones: ctx.drones
      .filter(d => !rec.soldDroneIds.includes(d.id))
      .map(d => rec.liquidateDroneIds.includes(d.id) ? { ...d, liquidating: true } : d),
    escorts: rec.soldEscortIds.length ? ctx.escorts.filter(e => !rec.soldEscortIds.includes(e.id)) : ctx.escorts,
  };
};

/* ------------------------------------------------------------------ */
/* Building: workforce, defense pair, escorts                          */
/* ------------------------------------------------------------------ */

export const seatBuildDrone = (seat: SeatSimState, ctx: SeatShopCtx): SeatShopChange | null => {
  const ship = seat.ship;
  if (!ship || !inTeamWell(ctx.seats, ship)) return null;
  const fielded = ctx.drones.filter(d => d.ownerId === seat.ownerId && d.mode !== 'defense' && !d.starFleet && !d.liquidating).length;
  if (fielded >= typeFor(ship.line, ship.typeTier).dronesFielded) return null;
  if (!pay(seat, DRONE_PRICE, true)) return null;
  const drone: Harvester = {
    id: 'player-drone-' + Math.random().toString(36).substr(2, 9),
    pos: { x: seat.star.pos.x + 100, y: seat.star.pos.y + 100 },
    vel: { x: 0, y: 0 },
    angle: 0,
    targetId: null,
    carrying: 0,
    capacity: PHYSICS.DRONES.CAPACITY + typeFor(ship.line, ship.typeTier).droneCarryBonus,
    owner: ownerLabel(ctx, seat.ownerId),
    ownerId: seat.ownerId,
    state: 'searching',
    health: DRONE_MAX_HEALTH,
  };
  return { drone };
};

export const seatBuildDefenseDrone = (seat: SeatSimState, ctx: SeatShopCtx): SeatShopChange | null => {
  const ship = seat.ship;
  if (!ship || !inTeamWell(ctx.seats, ship)) return null;
  const fielded = ctx.drones.filter(d => d.ownerId === seat.ownerId && d.mode === 'defense').length;
  if (fielded >= typeFor(ship.line, ship.typeTier).defenseDrones) return null;
  if (!pay(seat, DEFENSE_DRONE_PRICE, true)) return null;
  const drone: Harvester = {
    id: 'player-drone-' + Math.random().toString(36).substr(2, 9),
    pos: { x: ship.pos.x + 40, y: ship.pos.y + 40 },
    vel: { x: 0, y: 0 },
    angle: 0,
    targetId: null,
    carrying: 0,
    capacity: 0,
    owner: ownerLabel(ctx, seat.ownerId),
    ownerId: seat.ownerId,
    state: 'searching',
    mode: 'defense',
    health: DRONE_MAX_HEALTH,
  };
  return { drone };
};

export const seatBuildEscort = (seat: SeatSimState, ctx: SeatShopCtx, kind: EscortKind): SeatShopChange | null => {
  const ship = seat.ship;
  if (!ship || !inTeamWell(ctx.seats, ship)) return null;
  const def = ESCORT_KIND_DEFS[kind];
  const fielded = ctx.escorts.filter(e => e.ownerId === seat.ownerId && escortKindOf(e) === kind).length;
  if (fielded >= escortCapFor(ship.line, ship.typeTier, kind)) return null;
  if (!pay(seat, def.price, true)) return null;
  const escort = {
    ...createStarterShip(seat.ownerId, { x: ship.pos.x + 50, y: ship.pos.y + 50 }, { withStarterWeapon: true }),
    id: 'escort-' + Math.random().toString(36).substr(2, 9),
    line: def.line,
    typeTier: def.typeTier,
    arsenal: { bolt_cannon: def.typeTier },
  } as EscortShip;
  return { escort };
};

/* ------------------------------------------------------------------ */
/* Seat flags (the follow-on riders named in the verbs' own comments)  */
/* ------------------------------------------------------------------ */

export const seatSetDeliveryMode = (seat: SeatSimState, mode: 'feed' | 'deposit'): boolean => {
  if (!seat.ship || !canOrderWorkforce(seat.ship.line)) return false;
  seat.deliveryMode = mode;
  return true;
};

export const seatSetRepairing = (seat: SeatSimState, on: boolean): boolean => {
  if (!seat.ship) return false;
  seat.ship = { ...seat.ship, repairing: on };
  return true;
};
