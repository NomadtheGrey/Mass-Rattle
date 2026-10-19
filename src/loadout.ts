/**
 * LOADOUT REGISTRY — ship weapons / defenses / hybrids (the "Arsenal")
 * =====================================================================
 * Design record (Adam, Mass Rattle dev chat, 2026-10-19):
 *  - A shop sells WEAPON, DEFENSE and HYBRID items, paid — like the five
 *    base ship upgrades — from scrap IN THE CARGO HOLD. Scrap spent here
 *    is scrap the star never eats; that tension is the economy.
 *  - The ship flies with ONE item equipped per category (its LOADOUT).
 *  - Buying an item's first tier auto-equips it ONLY if that category's
 *    slot is empty (that first equip is part of the purchase).
 *  - SWAPPING an equipped item for a different owned item costs scrap:
 *    60 + 20 per tier beyond the first, priced on the INCOMING item's
 *    tier (Adam's pin). T1 swap = 60, T2 = 80, T3 = 100, T4 = 120, T5 = 140.
 *  - Every item has tiers (levels) bought one at a time, same cost shape
 *    as the base upgrades: base + currentTier x 50% of base.
 *
 * Slice notes: this file is the single source of truth for item identity,
 * category, flavor text and prices. Combat EFFECTS live in the game loop
 * and arrive slice by slice (weapons first); an item can be owned and
 * equipped before its effect slice lands, and the shop says so honestly.
 */

export type ArsenalCategory = 'weapon' | 'defense' | 'hybrid';

export interface LoadoutItemDef {
  id: string;
  category: ArsenalCategory;
  name: string;
  icon: string;
  /** One-line shop description: what it does, in plain words. */
  desc: string;
  /** Scrap cost of tier 1. Higher tiers scale off this (see itemTierCost). */
  baseCost: number;
}

/** Every item tops out at the same tier, so UI pips and swap pricing stay simple. */
export const MAX_ITEM_TIER = 5;

export const LOADOUT_ITEMS: LoadoutItemDef[] = [
  // ---------------------------------------------------------------- WEAPONS
  {
    id: 'bolt_cannon', category: 'weapon', name: 'Bolt Cannon', icon: '🔫',
    desc: 'Fires bolts along the ship\'s nose. The all-purpose starter gun: drones, ships, chipping a star.',
    baseCost: 20,
  },
  {
    id: 'flak_cannon', category: 'weapon', name: 'Flak Cannon', icon: '💥',
    desc: 'Short-range cone of pellets. Weak at distance, murders drones swarming your harvest run.',
    baseCost: 30,
  },
  {
    id: 'rail_lance', category: 'weapon', name: 'Rail Lance', icon: '🔱',
    desc: 'Charge up one piercing long-range shot. The siege gun: snipe a star or its turrets from far out.',
    baseCost: 45,
  },
  {
    id: 'seeker_torpedoes', category: 'weapon', name: 'Seeker Torpedoes', icon: '🚀',
    desc: 'Lock on, then a homing torpedo does the steering. Each torpedo costs 1 cargo scrap to fire.',
    baseCost: 40,
  },
  {
    id: 'mine_layer', category: 'weapon', name: 'Mine Layer', icon: '💣',
    desc: 'Drops proximity mines from your cargo. Guard your star\'s approaches or ambush drone lanes.',
    baseCost: 25,
  },
  {
    id: 'ion_blaster', category: 'weapon', name: 'Ion Blaster', icon: '⚡',
    desc: 'Barely damages, but disables: turrets stutter, drones reboot and drop their scrap, CME timers slip.',
    baseCost: 35,
  },
  // ---------------------------------------------------------------- DEFENSES
  {
    id: 'deflector_shield', category: 'defense', name: 'Deflector Shield', icon: '🛡️',
    desc: 'A bubble that eats bolts until its pool drains, then recharges while you are not being hit.',
    baseCost: 35,
  },
  {
    id: 'armor_plating', category: 'defense', name: 'Armor Plating', icon: '🧱',
    desc: 'More max hull per tier — but plating is mass, so acceleration drops a little. Mass matters.',
    baseCost: 25,
  },
  {
    id: 'pd_zap', category: 'defense', name: 'Point-Defense Zap', icon: '🔆',
    desc: 'A tiny auto-turret of your own: zaps incoming bolts and drones that get very close, on a cooldown.',
    baseCost: 40,
  },
  {
    id: 'cme_hardening', category: 'defense', name: 'CME Hardening', icon: '☀️',
    desc: 'Cuts CME damage and knockback per tier. Top tier: ride out the telegraph and take nothing.',
    baseCost: 30,
  },
  {
    id: 'decoy_beacon', category: 'defense', name: 'Decoy Beacon', icon: '📡',
    desc: 'Drop a beacon that screams "hostile": turrets shoot it, drones chase it, a directed CME eats it instead of you.',
    baseCost: 20,
  },
  {
    id: 'grav_dampers', category: 'defense', name: 'Grav Dampers', icon: '🌀',
    desc: 'Cuts gravity pull and CME knockback on your ship, so you can work close to a fat high-M star.',
    baseCost: 30,
  },
  // ---------------------------------------------------------------- HYBRIDS
  {
    id: 'mirror_sail', category: 'hybrid', name: 'Mirror Sail', icon: '⛵',
    desc: 'Reflects bolts back at whoever fired them — defense that is offense. Near a bright star it also catches light for thrust.',
    baseCost: 45,
  },
  {
    id: 'siphon_vac', category: 'hybrid', name: 'Siphon VAC', icon: '🧲',
    desc: 'Your tractor beam learns to eat incoming projectiles and convert them into a trickle of fuel.',
    baseCost: 35,
  },
  {
    id: 'thorn_hull', category: 'hybrid', name: 'Thorn Hull', icon: '🌵',
    desc: 'Armor that bites: anything that rams you or point-blanks you takes damage back.',
    baseCost: 30,
  },
  {
    id: 'scrap_aegis', category: 'hybrid', name: 'Scrap Aegis', icon: '♻️',
    desc: 'Ablative armor made of your own cargo: damage burns cargo instead of hull until the hold is empty.',
    baseCost: 40,
  },
];

/** Look up one item definition by id. Returns undefined for unknown ids. */
export const getLoadoutItem = (id: string | null | undefined): LoadoutItemDef | undefined =>
  LOADOUT_ITEMS.find(i => i.id === id);

/**
 * Cost of buying the NEXT tier of an item, given the tier already owned
 * (0 = not owned, so this returns the tier-1 price). Mirrors the base
 * ship upgrades' shape: base + currentTier x 50% of base.
 * Returns Infinity at max tier so callers can treat it as "cannot buy".
 */
export const itemTierCost = (def: LoadoutItemDef, ownedTier: number): number => {
  if (ownedTier >= MAX_ITEM_TIER) return Infinity;
  return def.baseCost + ownedTier * Math.floor(def.baseCost * 0.5);
};

/**
 * Adam's pinned swap price: 60 scrap + 20 per tier beyond the first,
 * priced on the tier of the item being swapped IN.
 * (Equipping into an EMPTY slot is free — see useGameLoop.equipItem.)
 */
export const swapCostForTier = (incomingTier: number): number =>
  60 + 20 * Math.max(0, incomingTier - 1);

/**
 * WEAPON STATS — how each weapon actually behaves when fired (Slice 4).
 * =====================================================================
 * Draft numbers, tuned to feel distinct rather than balanced-perfect;
 * Adam playtests and we adjust. Damage scales per owned tier via
 * damagePerTier so upgrading a weapon is real, not cosmetic.
 *
 * kind:
 *  - 'bolt'   : straight projectiles down the ship's nose (flak = many
 *               pellets with spread; rail = pierce; ion = low damage
 *               but stuns drones and makes them drop their scrap).
 *  - 'seeker' : a homing torpedo that steers toward the nearest enemy
 *               drone. Costs 1 cargo scrap per shot (scrapCost).
 *  - 'mine'   : no projectile — drops a proximity mine at the ship,
 *               also costing 1 cargo scrap (scrapCost).
 */
export interface WeaponStats {
  kind: 'bolt' | 'seeker' | 'mine';
  /** Hull damage at tier 1 (drones have 100). */
  damage: number;
  /** Extra damage per tier above the first. */
  damagePerTier: number;
  /** Projectile speed (units/frame). Unused for mines. */
  speed: number;
  /** Minimum milliseconds between shots. */
  cooldownMs: number;
  /** Projectile lifetime in frames (range = speed x life). */
  life: number;
  /** Projectiles per shot (flak). Default 1. */
  pellets?: number;
  /** Total spread cone in radians across the pellets (flak). */
  spread?: number;
  /** True = passes through targets, hitting each once (rail). */
  pierce?: boolean;
  /** Drawn size of the projectile head (canvas). */
  size?: number;
  /** Cargo scrap consumed per shot (seeker, mines). */
  scrapCost?: number;
  /** Explosion radius for mines. */
  radius?: number;
}

export const WEAPON_STATS: Record<string, WeaponStats> = {
  bolt_cannon:     { kind: 'bolt',   damage: 12, damagePerTier: 3,  speed: 14,   cooldownMs: 170, life: 50, size: 3 },
  flak_cannon:     { kind: 'bolt',   damage: 4,  damagePerTier: 1,  speed: 11,   cooldownMs: 430, life: 34, pellets: 6, spread: 0.76, size: 2 },
  rail_lance:      { kind: 'bolt',   damage: 45, damagePerTier: 12, speed: 26,   cooldownMs: 900, life: 50, pierce: true, size: 4 },
  ion_blaster:     { kind: 'bolt',   damage: 3,  damagePerTier: 1,  speed: 13,   cooldownMs: 230, life: 50, size: 3 },
  seeker_torpedoes:{ kind: 'seeker', damage: 30, damagePerTier: 8,  speed: 9.5,  cooldownMs: 750, life: 120, size: 6, scrapCost: 1 },
  mine_layer:      { kind: 'mine',   damage: 40, damagePerTier: 10, speed: 0,    cooldownMs: 500, life: 0, scrapCost: 1, radius: 115 },
};

/** Stats for a weapon at a given owned tier, damage scaled. Null for non-weapons. */
export const weaponStatsFor = (id: string | null, tier: number): (WeaponStats & { damage: number }) | null => {
  if (!id) return null;
  const base = WEAPON_STATS[id];
  if (!base) return null;
  return { ...base, damage: base.damage + base.damagePerTier * Math.max(0, tier - 1) };
};

/**
 * DEFENSE NUMBERS (Slice 6) — one helper per defense, tier-driven, so the
 * game loop never hardcodes an item's behavior. Draft tuning throughout.
 *
 * CME HARDENING note: cmeReductionFor is armed and ready, but nothing
 * consumes it yet — the CME system itself is a separate queued slice.
 * The moment stars start firing CMEs, their damage/knockback to the ship
 * is multiplied by (1 - cmeReductionFor(tier)).
 */

/** Deflector Shield pool: T1 40, +15/tier, T5 100. */
export const shieldMaxFor = (tier: number): number => (tier > 0 ? 25 + 15 * tier : 0);
/** Shield recharge per frame once 2.5 s have passed without a hit. */
export const shieldRechargePerFrame = (tier: number): number => (6 + 2 * tier) / 60;
/** Armor Plating: extra max hull per tier (T5 = +100). */
export const armorHullFor = (tier: number): number => 20 * tier;
/** Armor Plating thrust factor: mass costs 4% acceleration per tier. */
export const armorThrustFactor = (tier: number): number => 1 - 0.04 * tier;
/** Point-Defense Zap reach (units) and cadence. */
export const PD_RANGE = 130;
export const PD_COOLDOWN_MS = 900;
/** PD zap damage to a drone: T1 9, +3/tier, T5 21. (Bolts are destroyed outright.) */
export const pdDamageFor = (tier: number): number => 6 + 3 * tier;
/** CME Hardening: fraction of CME damage/knockback ignored — 20%/tier, T5 immune. */
export const cmeReductionFor = (tier: number): number => Math.min(1, 0.2 * tier);
/** Decoy Beacon hull (enemy bolts can shoot it down): T1 35, +15/tier. */
export const decoyHealthFor = (tier: number): number => 20 + 15 * tier;
/** Decoy Beacon lifetime in frames: T1 16 s, +4 s/tier, T5 32 s. */
export const decoyLifeFramesFor = (tier: number): number => (12 + 4 * tier) * 60;
/** Grav Dampers: gravity on the ship is multiplied by this — T1 0.88, T5 0.40. */
export const gravFactorFor = (tier: number): number => 1 - 0.12 * tier;
