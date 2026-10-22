/**
 * STAR FLEET — the star's own harvesters (Adam, 2026-10-21: the
 * star owns a harvester fleet that grows "in number and range";
 * amended 2026-10-22: growth keys on the star's EVOLUTION, not the
 * match clock — "let's allow the harvesters to increase in number
 * AS THE STAR EVOLVES. If destroyed, then the star can slowly
 * respawn them.").
 *
 * The shape:
 *  - TARGET COUNT is a function of the star's milestone count —
 *    the birth drone at M0, +1 every two milestones, capped at 6.
 *  - RANGE rides the same axis: the fleet's harvest leash from its
 *    home star grows with the target count (young stars glean
 *    near, old stars sweep far).
 *  - BIRTHS ARE SLOW: growth and regrowth alike arrive one drone
 *    per STAR_DRONE_RESPAWN_FRAMES through the drone step's
 *    channel — damage dents the fleet, evolution sets its ceiling,
 *    and the star patiently rebuilds toward it.
 *  - The fleet is a seat asset keyed to the STAR's life: it is not
 *    bought, not counted in the captain's workforce, and persists
 *    across the ship's death and repurchase.
 *
 * ALL NUMBERS DRAFT for the numbers pass. Flagged there: a full
 * fleet feeding unattended is a real late-game milestone engine
 * (the interval and cap are its dials), and the entity ledger
 * grows by up to 5 extra drones per seat.
 */
import { milestonesForInfused } from './starGrowth';
import type { Star } from './types';

/** The fleet's ceiling: no star fields more harvesters than this. */
export const STAR_DRONE_CAP = 6;
/** Milestones per fleet step: +1 drone per this many milestones. */
export const STAR_DRONE_MILESTONES_PER_STEP = 2;
/** The leash of a newborn fleet (distance from the home star). */
export const STAR_DRONE_BASE_RANGE = 500;
/** Leash growth per fleet step (the range face of the growth). */
export const STAR_DRONE_RANGE_PER_STEP = 150;
/** Birth/regrowth cadence in sim frames (~45 s at 60 fps): one
 *  drone per interval while the fleet is below its target. */
export const STAR_DRONE_RESPAWN_FRAMES = 2700;

/** How many fleet harvesters a star at this milestone count fields. */
export const starDroneTargetForMilestones = (milestones: number): number =>
  Math.min(
    STAR_DRONE_CAP,
    1 + Math.floor(Math.max(0, milestones) / STAR_DRONE_MILESTONES_PER_STEP),
  );

/** The same read off the star itself (the one the sim consumes). */
export const starDroneTargetFor = (star: Star): number =>
  starDroneTargetForMilestones(milestonesForInfused(star.totalScrapInfused));

/** The fleet's harvest leash (from its home star) at a target count. */
export const starDroneRangeForTarget = (target: number): number =>
  STAR_DRONE_BASE_RANGE + STAR_DRONE_RANGE_PER_STEP * (Math.max(1, target) - 1);

/** The same read off the star itself. */
export const starDroneRangeFor = (star: Star): number =>
  starDroneRangeForTarget(starDroneTargetFor(star));
