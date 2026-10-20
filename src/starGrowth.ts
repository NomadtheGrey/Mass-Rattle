/**
 * STAR GROWTH — RISING MILESTONE COSTS (Adam's pin, 2026-10-20)
 * =============================================================
 * Feeding a star fills it toward its next milestone. Milestone costs
 * are NOT flat: milestone N costs 100 + 25 x (N-1) scrap —
 *
 *   M1 100 · M2 125 · M3 150 · M4 175 · M5 200 ...
 *   cumulative thresholds: 100 / 225 / 375 / 550 / 750 ...
 *
 * Every milestone CROSSED compounds the star's mass x1.25 and its size
 * x1.15 — applied per crossing, in a loop, so one large delivery that
 * crosses two thresholds grows the star twice. (The pre-rising code
 * divided by a flat 100 and applied growth at most once per delivery.)
 *
 * BOTH stars grow through here: home-star deliveries (ship, player
 * drones, deployed cargo) and enemy-drone deliveries to the enemy star
 * alike. The enemy star used to grow x1.01 per delivery with no
 * milestone logic at all; that is retired — its mass/size now move
 * only on milestone crossings, exactly like the home star's. (Its
 * per-delivery integrity heal is a separate system and is NOT handled
 * here; the game loop still applies it at the delivery site.)
 *
 * Milestone count is DERIVED from a star's totalScrapInfused — the
 * Star type carries no separate milestone field — so every reader
 * (game loop, CME strength, HUD, results) must derive it through
 * milestonesForInfused() to stay in agreement.
 */

import { PHYSICS } from './constants';
import { Star } from './types';

/** Scrap cost of milestone `n` (1-indexed): M1 100, M2 125, M3 150 ... */
export const costForMilestone = (n: number): number =>
  PHYSICS.STAR_GROWTH_BASE_COST +
  PHYSICS.STAR_GROWTH_COST_STEP * (Math.max(1, n) - 1);

/**
 * Total infused scrap required to have REACHED `n` milestones:
 * the sum of the first n milestone costs (100 / 225 / 375 / 550 ...).
 */
export const cumulativeCostForMilestones = (n: number): number =>
  n <= 0
    ? 0
    : PHYSICS.STAR_GROWTH_BASE_COST * n +
      (PHYSICS.STAR_GROWTH_COST_STEP * n * (n - 1)) / 2;

/** How many milestones a star with this much total infused scrap has reached. */
export const milestonesForInfused = (totalInfused: number): number => {
  // cumulative(n) = (STEP/2)n^2 + (BASE - STEP/2)n — solve for n, then
  // correct by direct comparison so exact-threshold totals (100, 225,
  // 375 ...) always land on the right side of the crossing.
  const a = PHYSICS.STAR_GROWTH_COST_STEP / 2;
  const b = PHYSICS.STAR_GROWTH_BASE_COST - a;
  let n = Math.floor((-b + Math.sqrt(b * b + 4 * a * totalInfused)) / (2 * a));
  if (!isFinite(n) || n < 0) n = 0;
  while (cumulativeCostForMilestones(n + 1) <= totalInfused) n++;
  while (n > 0 && cumulativeCostForMilestones(n) > totalInfused) n--;
  return n;
};

/** Scrap infused toward the milestone currently being worked on. */
export const progressIntoNextMilestone = (totalInfused: number): number =>
  totalInfused - cumulativeCostForMilestones(milestonesForInfused(totalInfused));

/** Cost of the milestone currently being worked on (e.g. 125 while on M2). */
export const nextMilestoneCost = (totalInfused: number): number =>
  costForMilestone(milestonesForInfused(totalInfused) + 1);

/**
 * Feed `amount` of scrap into a star: adds it to totalScrapInfused and
 * applies EVERY crossed milestone in a loop — mass x STAR_GROWTH_MASS_MULT
 * and size x STAR_GROWTH_SIZE_MULT per crossing, compounding. Returns
 * how many milestones this delivery crossed.
 */
export const infuseStar = (star: Star, amount: number): number => {
  const before = milestonesForInfused(star.totalScrapInfused);
  star.totalScrapInfused += amount;
  const crossed = milestonesForInfused(star.totalScrapInfused) - before;
  for (let i = 0; i < crossed; i++) {
    star.mass *= PHYSICS.STAR_GROWTH_MASS_MULT;
    star.size *= PHYSICS.STAR_GROWTH_SIZE_MULT;
  }
  return crossed;
};
