/**
 * Star lifecycle stages (Phase 2, design draft §5).
 *
 * A star's stage is DERIVED from how much scrap it has been fed, via
 * the milestone ladder in src/starGrowth.ts — this module never
 * re-derives milestone costs, it only bands milestone counts into
 * stages (bands PINNED by Adam 2026-10-21; design draft §5 / contract):
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
import { PHYSICS } from '../constants';
import {
  cumulativeCostForMilestones,
  milestonesForInfused,
} from '../starGrowth';
import type { MatchEndState, Star } from '../types';

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

/* ------------------------------------------------------------------ */
/* Physical state (P2-4 — Adam's decoupling ruling, pinned 2026-10-21) */
/* ------------------------------------------------------------------ */

/**
 * From M12 (NEUTRON) a star's PHYSICAL size leaves the growth curve:
 * it collapses to NEUTRON_COLLAPSE_SIZE and regrows at only
 * NEUTRON_REGROWTH_MULT per milestone past M12. BLACK HOLE (M15+)
 * stays on that same neutron curve — terminal, never resuming the
 * ×1.15 growth. Its MASS keeps compounding ×1.25 per milestone
 * regardless (starGrowth), and gravity is derived from mass alone.
 */
export const NEUTRON_MILESTONE = 12;
export const NEUTRON_COLLAPSE_SIZE = 55;
export const NEUTRON_REGROWTH_MULT = 1.03;

/**
 * The growth-curve radius: baseSize × 1.15^milestones — the size the
 * star would have with no collapse. Before NEUTRON this IS the
 * physical size; at NEUTRON+ it survives as the EFFECTIVE radius.
 */
export const growthRadiusFor = (
  baseSize: number,
  totalInfused: number,
): number =>
  baseSize *
  Math.pow(
    PHYSICS.STAR_GROWTH_SIZE_MULT,
    milestonesForInfused(Math.max(0, totalInfused)),
  );

/** The star's physical (display / body) radius for a fed total. */
export const physicalSizeFor = (
  baseSize: number,
  totalInfused: number,
): number => {
  const total = Math.max(0, totalInfused);
  const milestone = milestonesForInfused(total);
  if (milestone < NEUTRON_MILESTONE) return growthRadiusFor(baseSize, total);
  return (
    NEUTRON_COLLAPSE_SIZE *
    Math.pow(NEUTRON_REGROWTH_MULT, milestone - NEUTRON_MILESTONE)
  );
};

/**
 * The star's EFFECTIVE radius: the un-shrunk growth curve at every
 * stage. The gravity well (its distance floor + repulsion reach,
 * src/sim/physics.ts) and the banking well (src/bank.ts via the game
 * loop) follow THIS radius, so neither lurches when the body
 * collapses at NEUTRON — the well tracks the gravity's reach (mass),
 * not the body's. Identical to the physical size before NEUTRON.
 */
export const effectiveRadiusFor = (
  baseSize: number,
  totalInfused: number,
): number => growthRadiusFor(baseSize, totalInfused);

/** physicalSizeFor over a star record (reads baseSize + fed total). */
export const physicalSizeForStar = (
  star: Pick<Star, 'baseSize' | 'totalScrapInfused'>,
): number => physicalSizeFor(star.baseSize, star.totalScrapInfused);

/** effectiveRadiusFor over a star record (reads baseSize + fed total). */
export const effectiveRadiusForStar = (
  star: Pick<Star, 'baseSize' | 'totalScrapInfused'>,
): number => effectiveRadiusFor(star.baseSize, star.totalScrapInfused);

/* ------------------------------------------------------------------ */
/* Collapse cinematic (P2-4)                                           */
/* ------------------------------------------------------------------ */

/**
 * How long a critical-mass collapse cinematic locks ship input
 * before the results phase may proceed. DRAFT (design draft §5) —
 * presentation timing is the UI lane's; the sim only enforces the
 * lockout window against the matchEnd record's epoch start.
 */
export const CINEMATIC_DURATION_MS = 4000;

/**
 * True while a critical-mass cinematic's input lockout is in force:
 * the matchEnd record says inputs lock, and `nowMs` (ms epoch — the
 * same clock cinematicStartedAt is stamped on) is still inside the
 * window. A `nowMs` BEFORE the start (clock skew between clients)
 * reads as locked: elapsed time is negative, still inside.
 */
export const isInputLocked = (
  matchEnd: MatchEndState | null,
  nowMs: number,
): boolean => {
  if (!matchEnd || matchEnd.endReason !== 'critical_mass') return false;
  if (!matchEnd.inputLockout || matchEnd.cinematicStartedAt == null) {
    return false;
  }
  return nowMs - matchEnd.cinematicStartedAt < CINEMATIC_DURATION_MS;
};
