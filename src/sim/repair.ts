/**
 * SCRAP HEALING — "Damage Control" (RULED by Adam, 2026-10-22):
 * injured ships heal by consuming scrap. The capability is INHERENT
 * (no item, no purchase): heal RATE and heal CAP — the maximum hull
 * a ship may repair TO; damage below the cap is permanent until
 * death — are set by ship TYPE and TIER (src/shipProgression's
 * healCapPctFor / healRateFor; even a Skiff heals, to a small cap).
 * Repair is A CAPTAIN'S TOGGLE (Adam's word on the verb) that
 * DEFAULTS ON (Adam, 2026-10-22): a ship heals whenever it is
 * hurt and carrying, unless its captain has switched the mode
 * OFF — the toggle is scrap discipline (don't burn my cargo on
 * repairs), not a drydock. Damage-control parties work while
 * the ship fights: the guns stay UP. (An earlier build of this
 * slice stood the guns down while repairing — BackGround's own
 * inference, struck when the default landed: with the mode on
 * by default, silent guns would read as a bug to any captain
 * who never touched the toggle.) Healing NEVER draws the bank
 * (Adam's fence, every surface): the hold is the only purse;
 * the bank opens only inside the well, by the ordinary
 * withdraw verb — the wallet law is not reinvented here.
 *
 * This module is the engine the three healing surfaces share: a
 * captain's own ship (purse = its own hold), a harvester DOCKED
 * inside its capital ship (purse = the ship's hold), and an escort
 * DOCKED at its carrier (purse = the carrier's hold). Docking rules
 * live with their steppers (src/sim/drones.ts, src/sim/escorts.ts);
 * the conversion and the spend live here, once.
 *
 * All figures DRAFT for the numbers pass unless a pin says else.
 */

/** Scrap → hull conversion (DRAFT): one scrap repairs this much. */
export const REPAIR_HP_PER_SCRAP = 2;

/** A hull anything repairFrame can work on. */
export interface RepairableHull {
  health: number;
  /** Whole-scrap credit banked from partial spends (see below). */
  repairCredit?: number;
}

/** Anything with a hold the repair can draw from. */
export interface ScrapPurse {
  carrying: number;
}

/**
 * Advance one frame of repair on `hull`, paid from `purse`, toward
 * `ceiling` (the hull's repair cap in absolute health) at
 * `ratePerFrame` health per frame. Returns true when hull actually
 * healed this frame. Scrap spends in WHOLE units into a credit on
 * the hull (1 scrap = REPAIR_HP_PER_SCRAP credit) so a slow rate
 * never burns a whole scrap for a fraction of a point, and an
 * interrupted repair keeps its unspent credit for the next session.
 * A hull at or above its ceiling heals nothing and spends nothing.
 */
export const repairFrame = (
  hull: RepairableHull,
  purse: ScrapPurse,
  ceiling: number,
  ratePerFrame: number,
): boolean => {
  if (hull.health >= ceiling || ratePerFrame <= 0) return false;
  let credit = hull.repairCredit ?? 0;
  const want = Math.min(ceiling - hull.health, ratePerFrame);
  while (credit < want && purse.carrying > 0) {
    purse.carrying -= 1;
    credit += REPAIR_HP_PER_SCRAP;
  }
  const healed = Math.min(want, credit);
  if (healed <= 0) {
    hull.repairCredit = credit;
    return false;
  }
  hull.health += healed;
  hull.repairCredit = credit - healed;
  return true;
};

/**
 * HARVESTER DOCKING (RULED by Adam, 2026-10-22): a workforce
 * harvester hurt below this health abandons its work and flies to
 * its capital ship to dock INSIDE it — out of service and
 * untargetable while docked, vulnerable on the road home. Drones
 * carry no type/tier table of their own: docked, they repair to
 * FULL at this rate (DRAFT), paid from the ship's hold.
 */
// Half the airframe's hull: hurt past halfway, a harvester
// goes home to dock (see DRONE_MAX_HEALTH for the hull pin).
export const DRONE_DOCK_HEALTH = 15;
export const DRONE_DOCK_RATE_PER_SEC = 10;

/**
 * ESCORT DOCKING: an escort seeks its carrier whenever its health
 * is BELOW ITS REPAIR CAP (the kind's cap off the same heal table)
 * — there is healing to be had — and undocks at the cap. The cap
 * IS the threshold: a flat fraction would dock-loop any kind whose
 * cap sits below it (heal to cap, undock still "hurt," seek again).
 */
/** Docking range beyond the carrier's surface (escorts ride alongside). */
export const ESCORT_DOCK_PAD = 28;
