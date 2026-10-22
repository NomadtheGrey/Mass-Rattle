/**
 * STAR FLEET — the star's own harvesters (Adam, 2026-10-21: the
 * star owns a harvester fleet that grows "in number and range";
 * amended 2026-10-22: growth keys on the star's EVOLUTION, not the
 * match clock — "let's allow the harvesters to increase in number
 * AS THE STAR EVOLVES. If destroyed, then the star can slowly
 * respawn them.").
 *
 * The shape:
 *  - TARGET COUNT is a function of the star's LIFECYCLE STAGE —
 *    one fleet harvester per stage (Adam's table pin, 2026-10-22:
 *    "Perhaps 1 max harvester per stage M1-M15" — a soft pin,
 *    recorded with its provenance; the numbers pass can revisit):
 *    RED DWARF 1, RED GIANT 2, YELLOW 3, WHITE 4, NEUTRON 5. The
 *    black hole ends the match, so the fleet question ends at 5.
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
 * Flagged for the numbers pass: a full fleet feeding unattended
 * is a real late-game milestone engine (the interval and cap are
 * its dials), and the entity ledger grows by up to 4 extra drones
 * per seat beyond the birth drone every seat always had.
 */
import { milestonesForInfused } from './starGrowth';
import { stageForMilestones } from './sim/starStages';
import type { StarStage } from './net/protocol';
import type { Star } from './types';

/** The fleet's ceiling: one per stage through NEUTRON — no star
 *  fields more harvesters than this (Adam's table, 2026-10-22). */
export const STAR_DRONE_CAP = 5;
/** The leash of a newborn fleet (distance from the home star). */
export const STAR_DRONE_BASE_RANGE = 500;
/** Leash growth per fleet step (the range face of the growth). */
export const STAR_DRONE_RANGE_PER_STEP = 150;
/** Birth/regrowth cadence in sim frames (~45 s at 60 fps): one
 *  drone per interval while the fleet is below its target. */
export const STAR_DRONE_RESPAWN_FRAMES = 2700;

/** Lifecycle order, for reading a stage as a count. The stage
 *  BANDS themselves live in sim/starStages.ts — this list only
 *  orders them. */
const STAGE_ORDER: readonly StarStage[] = [
  'red_dwarf',
  'red_giant',
  'yellow',
  'white',
  'neutron',
  'black_hole',
];

/** How many fleet harvesters a star at this milestone count fields:
 *  its stage's index + 1 (RED DWARF 1 … NEUTRON 5), capped. */
export const starDroneTargetForMilestones = (milestones: number): number =>
  Math.min(
    STAR_DRONE_CAP,
    STAGE_ORDER.indexOf(stageForMilestones(milestones)) + 1,
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
