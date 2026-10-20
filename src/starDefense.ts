/**
 * STAR DEFENSE LADDER (Phase 1c) — ELECTRON SHELLS
 * ================================================
 * Pinned by Adam (2026-10-19, ReadMeFiles/STAR_DEFENSE_LADDER.md): a
 * fed star grows defenses the way electrons fill an atom — shells. The
 * INNER shell holds 2 turrets, the OUTER shell holds 8 (the 2n^2
 * pattern). Each star SPAWNS with 1 inner turret (the starter, tier 1).
 *
 *   Phase A (M1):      the 2nd inner turret completes the inner shell.
 *   Phase B (M2-M4):   BOTH inner turrets tier up together — tier 2 at
 *                      M2, 3 at M3, 4 at M4. (Reading implemented here:
 *                      the pair tiers as one, per the design doc's "the
 *                      two inner turrets get beefier over 3 tiers".)
 *   Phase C (M5-M12):  one OUTER turret added per milestone, tier 1,
 *                      until the outer shell is full (8 outer, 10 total).
 *   Phase D (M13+):    outer turrets tier up — DRAFT, UNPINNED: round-
 *                      robin, one outer turret +1 tier per milestone,
 *                      cycling 0..7, so lifting the whole ring one tier
 *                      takes 8 milestones ("slower, because there are
 *                      more of them" — Marlowe's reading in the doc).
 *
 * A star's turret list is a DETERMINISTIC FUNCTION of its milestone
 * count — turretsForMilestones(m) below — and milestone count itself
 * derives from totalScrapInfused (see starGrowth.ts). The game loop
 * reconciles star.turrets to this function every frame, so there is no
 * separate turret bookkeeping to save, sync, or drift. Angles are
 * fixed: inner turrets at -PI/2 (starter) and +PI/2 (the M1 second);
 * outer turrets at even 45-degree steps in creation order (0, 45, 90
 * ... degrees). Angles are ABSOLUTE — no starOrbit rotation is baked
 * in; the canvas draws hubs at these same angles.
 *
 * TURRET TIER STATS (draft numbers from the design doc): damage =
 * PHYSICS.DEFENSE.DAMAGE + 2 x (tier - 1); fire chance per frame =
 * 1% + 0.2pp x (tier - 1). Bolt speed and range never scale with tier.
 * Every turret rolls and fires INDEPENDENTLY in the game loop.
 *
 * INTEGRITY HEAL (pinned shape, numbers UNPINNED — DRAFT): ONE
 * symmetric rule replaces the old enemy-only +0.005/scrap heal. BOTH
 * stars heal on scrap deliveries at healPerScrapForMilestones(m) per
 * scrap, starting at 0 at M0 and rising each milestone:
 *   heal(m) = min(0.005, 0.0005 x m)   — reaches the old enemy-only
 * rate at M10. Draft values for Adam to pin; applied at the delivery
 * sites in useGameLoop via applyDeliveryHeal().
 */

import { PHYSICS } from './constants';
import { Star, StarTurret } from './types';
import { milestonesForInfused } from './starGrowth';

const OUTER_COUNT = 8;
/** Milestone at which Phase C starts adding outer turrets. */
const OUTER_START_M = 5;
/** Milestone at which Phase D starts tiering outer turrets. */
const OUTER_TIER_START_M = 13;

/**
 * The full turret list for a star that has reached `m` milestones.
 * Order: inner turrets first (starter, then the M1 second), then outer
 * turrets in creation order.
 */
export const turretsForMilestones = (m: number): StarTurret[] => {
  const turrets: StarTurret[] = [];

  // Inner shell: the starter exists from spawn (M0). Phase B tiers BOTH
  // inner turrets together: tier 2/3/4 at M2/M3/M4.
  const innerTier = 1 + Math.min(3, Math.max(0, m - 1));
  turrets.push({ shell: 'inner', angle: -Math.PI / 2, tier: innerTier });
  if (m >= 1) {
    turrets.push({ shell: 'inner', angle: Math.PI / 2, tier: innerTier });
  }

  // Outer shell: Phase C adds one per milestone M5..M12 (tier 1 each);
  // Phase D (M13+, DRAFT round-robin) tiers one per milestone, cycling.
  const outerCount = Math.min(OUTER_COUNT, Math.max(0, m - (OUTER_START_M - 1)));
  const phaseDSteps = Math.max(0, m - (OUTER_TIER_START_M - 1));
  for (let i = 0; i < outerCount; i++) {
    // Round-robin bonus tiers: of the phase-D steps 0..phaseDSteps-1,
    // turret i gains one tier for each step s with s % OUTER_COUNT === i.
    const bonus = i < phaseDSteps
      ? Math.floor((phaseDSteps - 1 - i) / OUTER_COUNT) + 1
      : 0;
    turrets.push({
      shell: 'outer',
      angle: (i * Math.PI) / 4,
      tier: 1 + bonus,
    });
  }

  return turrets;
};

/**
 * Ring radius for a turret's shell — THE formula the canvas uses to
 * place hubs, pinned in constants.ts by PHYSICS.STAR_DEFENSE:
 *   radius = star.size + (inner ? INNER_RING_PAD : OUTER_RING_PAD)
 */
export const turretRingRadius = (starSize: number, shell: 'inner' | 'outer'): number =>
  starSize + (shell === 'inner'
    ? PHYSICS.STAR_DEFENSE.INNER_RING_PAD
    : PHYSICS.STAR_DEFENSE.OUTER_RING_PAD);

/** Hull/star damage dealt by one bolt from a turret of this tier. */
export const turretDamageFor = (tier: number): number =>
  PHYSICS.DEFENSE.DAMAGE + PHYSICS.STAR_DEFENSE.TURRET_DAMAGE_PER_TIER * (tier - 1);

/** Per-frame chance that a turret of this tier fires (each rolls alone). */
export const turretFireChanceFor = (tier: number): number =>
  PHYSICS.STAR_DEFENSE.TURRET_BASE_FIRE_CHANCE +
  PHYSICS.STAR_DEFENSE.TURRET_FIRE_CHANCE_PER_TIER * (tier - 1);

/**
 * Integrity healed per scrap delivered to a star at `m` milestones.
 * DRAFT NUMBERS, UNPINNED (see the header): 0 at M0, +0.0005 per
 * milestone, capped at the old enemy-only rate of 0.005 (reached M10).
 */
export const healPerScrapForMilestones = (m: number): number =>
  Math.min(
    PHYSICS.STAR_DEFENSE.HEAL_PER_SCRAP_MAX,
    PHYSICS.STAR_DEFENSE.HEAL_PER_SCRAP_PER_MILESTONE * m,
  );

/**
 * Apply the symmetric delivery heal to a star: `amount` scrap just got
 * infused (call AFTER infuseStar, so the rate uses the star's current
 * milestone count). Integrity stays capped at 1.
 */
export const applyDeliveryHeal = (star: Star, amount: number): void => {
  const rate = healPerScrapForMilestones(milestonesForInfused(star.totalScrapInfused));
  if (rate > 0 && amount > 0) {
    star.integrity = Math.min(1, star.integrity + rate * amount);
  }
};
