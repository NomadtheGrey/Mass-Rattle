/**
 * PROGRESSION STATUS — the one text of the progression law for surfaces.
 *
 * WHY THIS MODULE EXISTS (Option C, struck by Adam 2026-10-23 on the
 * BackGround + UI joint read): the climb was untaught and its signals
 * were silent — no 'you start in a T1 SKIFF', no frame-maxed moment,
 * no affordable-climb nudge, and the ship's own tier had no readout
 * that wasn't the star's M-number or the weapon's T-number. Every fact
 * those surfaces need already exists in the progression tables; this
 * module derives them in ONE place so the strip, the workshop, the
 * manual and any nudge can never disagree with each other — or with
 * the shop. Each derivation reads the same tables and the same funds
 * the workshop itself charges (seatShop / walletPay), so a surface
 * built on this file can never promise what the shop won't sell.
 *
 * Pure functions only: no state, no sim writes, no wire shape. Prices
 * and caps come from the tables at call time — the numbers are DRAFT
 * for Adam's numbers pass and teaching built on this file survives
 * repricing untouched.
 */
import {
  SHIP_LINES, typeFor, capsFor, typeStepPrice, healCapPctFor, healRateFor,
  escortWingSize,
  type ShipLine, type TypeTier, type TrackCaps,
} from './shipProgression';
import { MOUNT_ACCESS, type WeaponClass } from './loadout';
import { harborCapacityFor } from './sim/harbor';
import { isStealthShip } from './sim/stealth';
import type { Ship } from './types';

/** The ship fields every derivation here reads — nothing else is asked. */
export type ProgressionShip = Pick<Ship, 'line' | 'typeTier' | 'hullSteps' | 'upgrades'>;

/** Upgrade track keys as they live on the ship (see types.ts upgrades). */
export type TrackKey = keyof Ship['upgrades'];

/**
 * Track-key mapping, stated once: the CAPS table (TrackCaps) names the
 * vacuum track 'vac' and the fuel track 'fuel'; the SHIP's upgrades
 * record names them 'attractor' and 'fuelCap'. Every cross-walk in the
 * game goes through this table — a surface must never pair them by
 * eye.
 */
const TRACK_CAP_KEY: Record<TrackKey, keyof TrackCaps> = {
  thrust: 'thrust',
  handling: 'handling',
  attractor: 'vac',
  fuelCap: 'fuel',
  cargo: 'cargo',
};

const TRACK_ORDER: TrackKey[] = ['thrust', 'handling', 'attractor', 'fuelCap', 'cargo'];

export interface TrackStatus {
  track: TrackKey;
  level: number;
  cap: number;
  atCap: boolean;
}

/** Per-track standing against the CURRENT frame's caps. */
export const trackStatus = (ship: ProgressionShip): TrackStatus[] => {
  const caps = capsFor(ship.line, ship.typeTier);
  return TRACK_ORDER.map(track => {
    const cap = caps[TRACK_CAP_KEY[track]];
    const level = ship.upgrades[track];
    return { track, level, cap, atCap: level >= cap };
  });
};

/**
 * FRAME MAXED — every track at the current frame's cap AND the hull
 * grown to the frame's step cap. This is 'the frame has nothing left
 * to sell you'; the climb is the only headroom left. (The climb itself
 * is NOT gated on this — buyType asks only for the well, the tier and
 * the wallet. Maxed is a signal, never a lock.)
 */
export const frameMaxed = (ship: ProgressionShip): boolean => {
  const def = typeFor(ship.line, ship.typeTier);
  if (ship.hullSteps < def.hullStepCap) return false;
  return trackStatus(ship).every(t => t.atCap);
};

export interface NextStepOption {
  line: ShipLine;
  /** The T2 frame's name on that line (typeFor(line, 2)). */
  toName: string;
  price: number;
  affordable: boolean;
}

export type NextStep =
  | {
      kind: 'firstStep';
      /** Every line's T2 offer, in SHIP_LINES order — the honest
       * per-line form from the SKIFF, whose step price varies by line. */
      options: NextStepOption[];
      anyAffordable: boolean;
      /** [cheapest, dearest] across the five lines — the plate's
       * range form of the same offers, never a single fake price. */
      priceRange: [number, number];
    }
  | {
      kind: 'climb';
      line: ShipLine;
      toTier: TypeTier;
      toName: string;
      price: number;
      affordable: boolean;
    };

/**
 * THE NEXT CLIMB, priced and judged. `funds` is the shop's own pair —
 * the ship's HOLD (carrying) plus the seat's BANK (bankedScrap) — and
 * nothing else: scrap in cargo pods or drone holds never counts,
 * because walletPay cannot spend it. The bank half is spendable
 * because the climb itself happens in the well, where bank counts; a
 * surface quoting this in flight is quoting what will be payable at
 * the star, in the shop's own arithmetic.
 *
 * Returns null at T5 — the top of the ladder has no next step.
 */
export const nextStep = (
  ship: ProgressionShip,
  carrying: number,
  banked: number,
): NextStep | null => {
  if (ship.typeTier >= 5) return null;
  const funds = Math.max(0, carrying) + Math.max(0, banked);
  if (ship.line === null || ship.typeTier === 1) {
    const options = (Object.keys(SHIP_LINES) as ShipLine[]).map(line => {
      const price = typeStepPrice(line, 1);
      return { line, toName: typeFor(line, 2).name, price, affordable: funds >= price };
    });
    const prices = options.map(o => o.price);
    return {
      kind: 'firstStep',
      options,
      anyAffordable: options.some(o => o.affordable),
      priceRange: [Math.min(...prices), Math.max(...prices)],
    };
  }
  const line = ship.line;
  const toTier = (ship.typeTier + 1) as TypeTier;
  const price = typeStepPrice(line, ship.typeTier);
  return {
    kind: 'climb',
    line,
    toTier,
    toName: typeFor(line, toTier).name,
    price,
    affordable: funds >= price,
  };
};

export interface StepChange {
  from: number;
  to: number;
}

export interface UnlockDiff {
  toTier: TypeTier;
  /** The next frame's name on this line. */
  toName: string;
  /** Only the tracks whose caps move, in track order. */
  trackCaps: { track: TrackKey; from: number; to: number }[];
  hullStepCap: StepChange | null;
  hardPoints: StepChange | null;
  autoGuns: StepChange | null;
  minesPerDrop: StepChange | null;
  dronesFielded: StepChange | null;
  defenseDrones: StepChange | null;
  droneSpeedPct: StepChange | null;
  droneCarryBonus: StepChange | null;
  cargoBonus: StepChange | null;
  vacBonus: StepChange | null;
  /** The carrier wing's shape after the climb (drone line only;
   * totals via escortWingSize — the wing IS that line's headline). */
  escortWing: {
    from: { skiff: number; stinger: number; lancer: number };
    to: { skiff: number; stinger: number; lancer: number };
    fromTotal: number;
    toTotal: number;
  } | null;
  /** Weapon classes this climb newly mounts (MOUNT_ACCESS diff). */
  mountClasses: WeaponClass[];
  /** Repair ceiling / rate after the climb (repair.ts reads these). */
  healCapPct: StepChange | null;
  healRate: StepChange | null;
  /** True when this climb is the one that takes the line underwater
   * (minelayer T1 -> T2; stealth.ts isStealthShip). */
  stealth: boolean;
  /** Host berths after the climb (harbor.ts harborCapacityFor). */
  harborBerths: StepChange | null;
}

const change = (from: number, to: number): StepChange | null =>
  from === to ? null : { from, to };

/**
 * WHAT A CLIMB BUYS — the three-source diff the joint read specified:
 * the ShipTypeDef rows (caps, hull, mounts, workforce, wing, bonuses),
 * MOUNT_ACCESS (weapon classes), and the tier functions (repair
 * ceiling/rate, stealth eligibility, harbor berths). A surface renders
 * what changed and stays silent on what didn't, so unlock copy is
 * computed from the tables and cannot drift when numbers move.
 *
 * Returns null at T5.
 */
export const unlockDiff = (line: ShipLine, tier: TypeTier): UnlockDiff | null => {
  if (tier >= 5) return null;
  const toTier = (tier + 1) as TypeTier;
  const fromDef = typeFor(line, tier);
  const toDef = typeFor(line, toTier);
  const trackCaps = TRACK_ORDER
    .map(track => ({
      track,
      from: fromDef.trackCaps[TRACK_CAP_KEY[track]],
      to: toDef.trackCaps[TRACK_CAP_KEY[track]],
    }))
    .filter(c => c.from !== c.to);
  const mountBefore = MOUNT_ACCESS[line][tier];
  const mountClasses = MOUNT_ACCESS[line][toTier].filter(c => !mountBefore.includes(c));
  const wingChanged =
    fromDef.escortWing.skiff !== toDef.escortWing.skiff ||
    fromDef.escortWing.stinger !== toDef.escortWing.stinger ||
    fromDef.escortWing.lancer !== toDef.escortWing.lancer;
  return {
    toTier,
    toName: toDef.name,
    trackCaps,
    hullStepCap: change(fromDef.hullStepCap, toDef.hullStepCap),
    hardPoints: change(fromDef.hardPoints, toDef.hardPoints),
    autoGuns: change(fromDef.autoGuns, toDef.autoGuns),
    minesPerDrop: change(fromDef.minesPerDrop, toDef.minesPerDrop),
    dronesFielded: change(fromDef.dronesFielded, toDef.dronesFielded),
    defenseDrones: change(fromDef.defenseDrones, toDef.defenseDrones),
    droneSpeedPct: change(fromDef.droneSpeedPct, toDef.droneSpeedPct),
    droneCarryBonus: change(fromDef.droneCarryBonus, toDef.droneCarryBonus),
    cargoBonus: change(fromDef.cargoBonus, toDef.cargoBonus),
    vacBonus: change(fromDef.vacBonus, toDef.vacBonus),
    escortWing: wingChanged
      ? {
          from: { ...fromDef.escortWing },
          to: { ...toDef.escortWing },
          fromTotal: escortWingSize(line, tier),
          toTotal: escortWingSize(line, toTier),
        }
      : null,
    mountClasses,
    healCapPct: change(healCapPctFor(line, tier), healCapPctFor(line, toTier)),
    healRate: change(healRateFor(line, tier), healRateFor(line, toTier)),
    stealth:
      !isStealthShip({ line, typeTier: tier }) && isStealthShip({ line, typeTier: toTier }),
    harborBerths: change(harborCapacityFor(line, tier), harborCapacityFor(line, toTier)),
  };
};

/** Display names for the formatted lines — the caps table's own words. */
const TRACK_LABEL: Record<TrackKey, string> = {
  thrust: 'THRUST',
  handling: 'HANDLING',
  attractor: 'VAC',
  fuelCap: 'FUEL',
  cargo: 'CARGO',
};

/**
 * WHAT A CLIMB BUYS, pre-formatted — unlockDiff rendered as short
 * lines a surface can join verbatim ('THRUST CAP 6 · HEAVY MOUNTS ·
 * GOES SUBMARINE'). The formatting lives HERE, with the law, so every
 * surface speaks identically; the structured diff stays available for
 * any surface that needs more than words. Only real changes appear,
 * in a stable order: caps, hull, mounts, workforce, wing, specials.
 * Returns null at T5 (no climb, no lines).
 */
export const unlockLines = (line: ShipLine, tier: TypeTier): string[] | null => {
  const d = unlockDiff(line, tier);
  if (!d) return null;
  const lines: string[] = [];
  for (const c of d.trackCaps) lines.push(`${TRACK_LABEL[c.track]} CAP ${c.to}`);
  if (d.hullStepCap) lines.push(`HULL STEPS ${d.hullStepCap.to}`);
  if (d.hardPoints) lines.push(`WEAPON MOUNTS ${d.hardPoints.to}`);
  if (d.autoGuns) lines.push(`TURRET MOUNTS ${d.autoGuns.to}`);
  if (d.mountClasses.includes('heavy')) lines.push('HEAVY MOUNTS');
  if (d.minesPerDrop) lines.push(`MINES ${d.minesPerDrop.to}/DROP`);
  if (d.dronesFielded) lines.push(`WORKFORCE ${d.dronesFielded.to}`);
  if (d.defenseDrones) lines.push(`DEFENSE DRONES ${d.defenseDrones.to}`);
  if (d.droneSpeedPct) lines.push(`DRONE SPEED +${d.droneSpeedPct.to}%`);
  if (d.droneCarryBonus) lines.push(`DRONE CARRY +${d.droneCarryBonus.to}`);
  if (d.escortWing) lines.push(`WING ${d.escortWing.toTotal}`);
  if (d.cargoBonus) lines.push(`HOLD +${d.cargoBonus.to}`);
  if (d.vacBonus) lines.push(`VAC +${d.vacBonus.to}`);
  if (d.healCapPct) lines.push(`HEAL CAP ${Math.round(d.healCapPct.to * 100)}%`);
  if (d.healRate) lines.push(`HEAL RATE ${d.healRate.to}/S`);
  if (d.stealth) lines.push('GOES SUBMARINE');
  if (d.harborBerths) lines.push(`BERTHS ${d.harborBerths.to}`);
  return lines;
};
