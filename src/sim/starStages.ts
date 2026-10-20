/**
 * Star lifecycle stages (Phase 2, design draft §5).
 *
 * A star's stage is DERIVED from how much scrap it has been fed, via
 * the milestone ladder in src/starGrowth.ts — this module never
 * re-derives milestone costs, it only bands milestone counts into
 * stages (DRAFT bands, design draft §5 / contract):
 *
 *   RED DWARF from M0 · RED GIANT from M3 · YELLOW from M6
 *   WHITE from M9 · NEUTRON from M12 · BLACK HOLE from M15
 *
 * progressWithinStage is the fraction of the current stage band the
 * star has fed through, measured in infused scrap between the band's
 * cumulative milestone thresholds — so it moves smoothly as scrap
 * arrives, not just on milestone crossings. BLACK HOLE is terminal:
 * progress is 1.
 */

import type { StarStage } from '../net/protocol';
import {
  cumulativeCostForMilestones,
  milestonesForInfused,
} from '../starGrowth';

const BAND_START_MILESTONES = [0, 3, 6, 9, 12, 15] as const;

const STAGES_BY_BAND: readonly StarStage[] = [
  'red_dwarf',
  'red_giant',
  'yellow',
  'white',
  'neutron',
  'black_hole',
];

export const BLACK_HOLE_MILESTONE = 15;

/** The lifecycle stage for a milestone count. */
export const stageForMilestones = (milestone: number): StarStage => {
  const m = Math.max(0, Math.floor(milestone));
  if (m >= BLACK_HOLE_MILESTONE) return 'black_hole';
  const band = Math.floor(m / 3);
  return STAGES_BY_BAND[band];
};

/** Fraction (0..1) of the current stage band fed through. */
export const progressWithinStageForInfused = (
  totalInfused: number,
): number => {
  const total = Math.max(0, totalInfused);
  const milestone = milestonesForInfused(total);
  if (milestone >= BLACK_HOLE_MILESTONE) return 1;
  const bandStart = BAND_START_MILESTONES[Math.floor(milestone / 3)];
  const bandEnd = bandStart + 3;
  const startCost = cumulativeCostForMilestones(bandStart);
  const endCost = cumulativeCostForMilestones(bandEnd);
  const progress = (total - startCost) / (endCost - startCost);
  return Math.min(1, Math.max(0, progress));
};

export interface StarStageState {
  stage: StarStage;
  milestone: number;
  progressWithinStage: number;
}

/** Full stage state for a star with this much total infused scrap. */
export const stageStateForInfused = (
  totalInfused: number,
): StarStageState => {
  const total = Math.max(0, totalInfused);
  const milestone = milestonesForInfused(total);
  return {
    stage: stageForMilestones(milestone),
    milestone,
    progressWithinStage: progressWithinStageForInfused(total),
  };
};
