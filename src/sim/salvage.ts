/**
 * WRECK SALVAGE (RULED by Adam 2026-10-22, ReadMeFiles/
 * WRECK_SALVAGE.md): what a death drops. The flat one-piece
 * death drop retires everywhere — a destroyed hull relinquishes
 * its CARGO WHOLE (plain pieces, called by the death sites) plus
 * SALVAGE rolled once on the ladder against its INVESTED VALUE:
 * the chart pays only on what death actually destroys.
 *
 * The basis fence (capital ships): cumulative type price +
 * hull-step prices + turret mounts at curve prices + arsenal
 * tiers at prices paid (EXCEPT the starter Bolt Cannon's first
 * tier — free, and kept through death) + the five upgrade
 * tracks at prices paid. Cargo, bank, deployed drones/escorts,
 * and sunk fees (tolls, swaps, repurchases) never count.
 * Drones roll vs their purchase price (75; a defense-mode
 * drone 100); escorts vs their kind price alone.
 */
import { COLORS, PHYSICS } from '../constants';
import type { Harvester, Scrap, Ship } from '../types';
import {
  DEFENSE_DRONE_PRICE,
  DRONE_PRICE,
  ESCORT_KIND_DEFS,
  escortKindOf,
  hullStepPrice,
  turretMountPriceFor,
  typeStepPrice,
} from '../shipProgression';
import { getLoadoutItem, itemTierCost } from '../loadout';

/** The ladder (RULED): one roll per wreck, % of basis. The 10%
 *  floor is guaranteed — it is the fat remainder (61.8%), not a
 *  decay step; the tail decays ≈ ×0.7 per rung below it. The
 *  table sums to 100.0; expected value ≈ 20.8% of basis. The
 *  90% freak, in Adam's fiction: the hit penetrated the weakest
 *  spot and took out the crew, with minimal ship damage. */
export const SALVAGE_LADDER: readonly { pct: number; chance: number }[] = [
  { pct: 0.10, chance: 0.618 },
  { pct: 0.20, chance: 0.122 },
  { pct: 0.30, chance: 0.085 },
  { pct: 0.40, chance: 0.060 },
  { pct: 0.50, chance: 0.042 },
  { pct: 0.60, chance: 0.029 },
  { pct: 0.70, chance: 0.020 },
  { pct: 0.80, chance: 0.014 },
  { pct: 0.90, chance: 0.010 },
];

/** How long a capital wreck's tombstone marker stands (the
 *  dressing fades by age inside it). DRAFT. */
export const WRECK_MARKER_MS = 120_000;
/** A single shard carries at most this much value before the
 *  roll chunks further. DRAFT. */
export const WRECK_SHARD_VALUE_CAP = 25;
/** A wreck scatters into at most this many shards, so a crown
 *  wreck doesn't flood the field with entities. DRAFT. */
export const WRECK_SHARD_MAX_COUNT = 12;
/** Wreck shards drift gently apart from the destruction point
 *  (Adam: too fast and it's practically not worth collecting).
 *  Speed is units per frame at scatter; the decay bleeds it.
 *  Both DRAFT. */
export const WRECK_DRIFT_SPEED = 0.45;
export const WRECK_DRIFT_DECAY = 0.995;

const SCRAP_COLORS = COLORS.SCRAP;

/** Roll the ladder once against a basis. Rounding (RULED):
 *  nearest unit; never below one unit when a roll pays. A
 *  zero basis pays zero — a free Skiff's wreck is just its hold. */
export const rollSalvageValue = (basis: number): number => {
  if (basis <= 0) return 0;
  let r = Math.random();
  for (const rung of SALVAGE_LADDER) {
    if (r < rung.chance) return Math.max(1, Math.round(basis * rung.pct));
    r -= rung.chance;
  }
  return Math.max(1, Math.round(basis * SALVAGE_LADDER[0].pct));
};

/** A capital ship's INVESTED VALUE as it died — the destroyed
 *  set only, priced by the same tables that charged for it. */
export const shipSalvageBasis = (ship: Ship): number => {
  let basis = 0;
  // (a) cumulative type price for the line/tier it died at
  if (ship.line) {
    for (let t = 1; t < ship.typeTier; t++) basis += typeStepPrice(ship.line, t as Ship['typeTier']);
  }
  // (b) hull-step prices
  for (let i = 0; i < ship.hullSteps; i++) basis += hullStepPrice(i);
  // (c) turret mounts at curve prices for its mount count
  for (let i = 0; i < (ship.turretMounts ?? 0); i++) basis += turretMountPriceFor(i);
  // (d) arsenal tiers at prices paid — the starter Bolt
  // Cannon's first tier is free and KEPT, so it counts nothing;
  // paid bolt tiers above it count like anything else.
  for (const [itemId, owned] of Object.entries(ship.arsenal)) {
    if (!owned) continue;
    const def = getLoadoutItem(itemId);
    if (!def) continue;
    const firstPaidTier = itemId === 'bolt_cannon' ? 1 : 0;
    for (let k = firstPaidTier; k < owned; k++) basis += itemTierCost(def, k);
  }
  // (e) the five upgrade tracks, every current level at the
  // price it was bought at (the shop's own step formula).
  const trackLevels: [number, number][] = [
    [PHYSICS.UPGRADE_COSTS.THRUST, ship.upgrades.thrust],
    [PHYSICS.UPGRADE_COSTS.HANDLING, ship.upgrades.handling],
    [PHYSICS.UPGRADE_COSTS.ATTRACTOR, ship.upgrades.attractor],
    [PHYSICS.UPGRADE_COSTS.FUEL, ship.upgrades.fuelCap],
    [PHYSICS.UPGRADE_COSTS.CARGO, ship.upgrades.cargo],
  ];
  for (const [baseCost, level] of trackLevels) {
    for (let k = 0; k < level; k++) basis += baseCost + k * Math.floor(baseCost * 0.5);
  }
  return basis;
};

/** A drone's basis: its purchase price. The star-fleet gleaner
 *  is unpurchased but rolls vs the same airframe price, and a
 *  liquidating drone killed on its last trip dies under this
 *  same law (the caller sweeps every drone uniformly). */
export const droneSalvageBasis = (drone: Harvester): number =>
  drone.mode === 'defense' ? DEFENSE_DRONE_PRICE : DRONE_PRICE;

/** An escort's basis: its kind price alone — escorts carry no
 *  steps, tracks, or arsenal of their own. */
export const escortSalvageBasis = (escort: { line: Ship['line']; typeTier: Ship['typeTier'] }): number => {
  const kind = escortKindOf(escort);
  return kind ? ESCORT_KIND_DEFS[kind].price : 0;
};

/**
 * Scatter a rolled salvage value into a bounded set of
 * value-carrying SHARDS around the destruction point. A shard
 * is a pile: collecting it banks its whole `value` (the
 * collection sites gate on it fitting the hold whole). Shards
 * carry a gentle outward drift velocity; capital wrecks also
 * stamp their tombstone's wreckId so the canvas can draw the
 * pieces as that wreck's cooling shards.
 */
export const wreckShardScrap = (
  pos: { x: number; y: number },
  totalValue: number,
  wreckId?: string,
): Scrap[] => {
  if (totalValue <= 0) return [];
  const count = Math.min(WRECK_SHARD_MAX_COUNT, Math.ceil(totalValue / WRECK_SHARD_VALUE_CAP));
  const base = Math.floor(totalValue / count);
  const remainder = totalValue - base * count;
  const out: Scrap[] = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 6 + Math.random() * 26;
    const speed = WRECK_DRIFT_SPEED * (0.4 + Math.random() * 0.6);
    out.push({
      id: Math.random().toString(),
      pos: { x: pos.x + Math.cos(angle) * dist, y: pos.y + Math.sin(angle) * dist },
      color: SCRAP_COLORS[Math.floor(Math.random() * SCRAP_COLORS.length)],
      value: base + (i < remainder ? 1 : 0),
      wreckId,
      vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
    });
  }
  return out;
};

/** Plain one-unit pieces for a hold that drops WHOLE (cargo is
 *  never inside the basis and never chunked). */
export const cargoDropScrap = (pos: { x: number; y: number }, count: number): Scrap[] => {
  const out: Scrap[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: Math.random().toString(),
      pos: { x: pos.x + (Math.random() - 0.5) * 30, y: pos.y + (Math.random() - 0.5) * 30 },
      color: SCRAP_COLORS[Math.floor(Math.random() * SCRAP_COLORS.length)],
    });
  }
  return out;
};
