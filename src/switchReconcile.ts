/**
 * THE FORCED SELL (PINNED by Adam, 2026-10-22): on a hull
 * switch — a line switch, or choosing a line off the Skiff —
 * the NEW hull's caps govern what you may HOLD. Anything over
 * them is SOLD, refunded at FULL PRICE (everything paid for
 * it), on the spot. His reasoning: a hull switch is already
 * increasingly expensive (the toll ladder), so the sell is not
 * where the switch pays its toll.
 *
 * This supersedes slice 4's SHELVE for property: weapons the
 * new hull can't mount, workforce drones over its fielded cap,
 * defense drones over their cap, turret mounts over the mount
 * cap, escort ships over the wing's per-kind composition —
 * all sell. (mountableLoadout's shelve survives only inside
 * the debug jump, a tester tool with no economy.) The
 * workforce ORDER never sells — an order is not property; it
 * goes dormant off the hauler and binds again on return.
 *
 * Refunds land in the BANK (the switch happens at the well,
 * the bank's home ground) — and a sold drone's CARGO BANKS
 * WITH THEM (Adam's correction, 2026-10-22: 'Sold cargo is
 * sold cargo — it gets BANKED'). The cargo is part of the
 * sale, valued at face; it does NOT drop as field scrap.
 * (Drone DEATH is a different system: a wreck still drops
 * what it carried, plus its salvage piece.)
 *
 * Pure: callers (the loop's switch verbs) apply the result —
 * arsenal/loadout/mounts read straight off it, the sold ids
 * filter out of the drone/escort lists, and the refund (sale
 * prices + banked cargo) credits the bank.
 */
import { canMountWeapon, getLoadoutItem, itemTierCost } from './loadout';
import {
  typeFor, autoGunCapFor, turretMountPriceFor, escortCapFor, escortKindOf,
  DRONE_PRICE, DEFENSE_DRONE_PRICE, ESCORT_KIND_DEFS,
  type EscortKind, type ShipLine, type TypeTier,
} from './shipProgression';
import type { EscortShip, Harvester, Ship } from './types';

export interface SwitchSellResult {
  /** The arsenal after the sell (sold weapons removed whole). */
  arsenal: Record<string, number>;
  /** The loadout after the sell (a sold equipped weapon empties its slot). */
  loadout: Ship['loadout'];
  /** Turret mounts after the sell. */
  turretMounts: number;
  soldDroneIds: string[];
  soldEscortIds: string[];
  /** Total refund (sale prices + sold cargo at face), for the bank. */
  refund: number;
  /** A manifest for the surface: what sold, in plain counts. */
  sold: { weapons: string[]; drones: number; defenseDrones: number; mounts: number; escorts: number };
}

const ESCORT_KINDS: EscortKind[] = ['skiff', 'stinger', 'lancer'];

export const reconcileSwitch = (
  ship: Ship,
  drones: readonly Harvester[],
  escorts: readonly EscortShip[],
  newLine: ShipLine | null,
  newTier: TypeTier,
): SwitchSellResult => {
  const def = typeFor(newLine, newTier);
  const sold: SwitchSellResult['sold'] = { weapons: [], drones: 0, defenseDrones: 0, mounts: 0, escorts: 0 };
  let refund = 0;

  // --- Weapons the new hull cannot mount sell at full price --
  const arsenal: Record<string, number> = { ...ship.arsenal };
  const loadout: Ship['loadout'] = { ...ship.loadout };
  for (const [itemId, tier] of Object.entries(ship.arsenal)) {
    if (!tier || tier <= 0) continue;
    const idef = getLoadoutItem(itemId);
    if (!idef || idef.category !== 'weapon') continue; // defenses/hybrids are never gated
    if (canMountWeapon(newLine, newTier, itemId)) continue;
    for (let k = 0; k < tier; k++) refund += itemTierCost(idef, k);
    delete arsenal[itemId];
    if (loadout.weapon === itemId) loadout.weapon = null;
    sold.weapons.push(itemId);
  }

  // --- Workforce drones over the fielded cap sell ------------
  // Sell order: docked first (already out of service), then the
  // lightest-loaded (delivered value is preserved longest),
  // newest first on ties — deterministic, and stated here so a
  // captain can predict which hulls go.
  const soldDroneIds: string[] = [];
  const workforce = drones
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.ownerId === ship.ownerId && !d.starFleet && d.mode !== 'defense');
  const wfExcess = workforce.length - def.dronesFielded;
  if (wfExcess > 0) {
    const ranked = [...workforce].sort((a, b) =>
      (a.d.state === 'docked' ? 0 : 1) - (b.d.state === 'docked' ? 0 : 1)
      || a.d.carrying - b.d.carrying
      || b.i - a.i);
    for (const { d } of ranked.slice(0, wfExcess)) {
      soldDroneIds.push(d.id);
      // The cargo is part of the sale: it banks at face with
      // the refund (Adam's correction — not field scrap).
      refund += DRONE_PRICE + d.carrying;
      sold.drones += 1;
    }
  }

  // --- Defense drones over their cap sell ---------------------
  const guards = drones.filter(d => d.ownerId === ship.ownerId && d.mode === 'defense');
  const defExcess = guards.length - def.defenseDrones;
  if (defExcess > 0) {
    for (const d of guards.slice(guards.length - defExcess)) {
      soldDroneIds.push(d.id);
      refund += DEFENSE_DRONE_PRICE;
      sold.defenseDrones += 1;
    }
  }

  // --- Turret mounts over the mount cap sell ------------------
  // The top mounts go — the ones bought last, at the curve's
  // top prices — so the refund sums exactly what they cost.
  let turretMounts = ship.turretMounts;
  const mountCap = autoGunCapFor(newLine, newTier);
  if (turretMounts > mountCap) {
    for (let k = mountCap; k < turretMounts; k++) refund += turretMountPriceFor(k);
    sold.mounts = turretMounts - mountCap;
    turretMounts = mountCap;
  }

  // --- Escorts over the wing's per-kind composition sell -----
  // The most-damaged of each over-cap kind go first (the wing
  // keeps its healthiest hulls).
  const soldEscortIds: string[] = [];
  for (const kind of ESCORT_KINDS) {
    const ofKind = escorts.filter(e => e.ownerId === ship.ownerId && escortKindOf(e) === kind);
    const excess = ofKind.length - escortCapFor(newLine, newTier, kind);
    if (excess <= 0) continue;
    const ranked = [...ofKind].sort((a, b) => a.health - b.health);
    for (const e of ranked.slice(0, excess)) {
      soldEscortIds.push(e.id);
      refund += ESCORT_KIND_DEFS[kind].price;
      sold.escorts += 1;
    }
  }

  return { arsenal, loadout, turretMounts, soldDroneIds, soldEscortIds, refund, sold };
};
