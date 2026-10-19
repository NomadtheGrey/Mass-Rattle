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
