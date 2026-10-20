/**
 * Match-init arena geometry (Phase 2, design draft §4).
 *
 * Pure and deterministic: given a seed and a star count, stars sit on a
 * ring around the arena center. The seed only rotates the ring phase;
 * the SP default seed (0) applies no rotation and reproduces the
 * shipped two-star layout EXACTLY.
 *
 * Today's shipped layout, in coordinates relative to the two stars'
 * midpoint (the arena center): the home star sits at (-1500, -500) and
 * the enemy star at (+1500, +500) — i.e. the home star is placed at
 * (width/2, height/2) and the enemy at (width/2 + 3000, height/2 + 1000)
 * in the loop's initial state. Their separation is hypot(3000, 1000)
 * ≈ 3162.28, so each sits ≈1581.14 from the center. The two-star ring
 * radius below is that exact hypot, not the rounded 1581 in the draft,
 * so layout(DEFAULT_MATCH_SEED, 2) returns the exact shipped offsets.
 *
 * Positions returned here are RELATIVE to the arena center (0, 0);
 * callers translate by their arena center. The wrap center is the arena
 * center, and the wrap radius is ring radius + 1400 (draft §4), which
 * keeps the worst-case post-wrap distance to a star at ≈1400.
 */

import type { Vector2D } from '../types';
import { ownerIdForSeat, starIdForSeat } from './ownership';

export type MatchStarCount = 2 | 3 | 4;

export interface MatchLayoutStar {
  starIndex: number;
  starId: string;
  ownerId: string;
  /** Position relative to the arena center. */
  pos: Vector2D;
}

export interface MatchLayout {
  seed: number;
  starCount: MatchStarCount;
  arenaCenter: Vector2D;
  wrapCenter: Vector2D;
  wrapRadius: number;
  ringRadius: number;
  stars: MatchLayoutStar[];
  /** The same positions as `stars`, as a bare array for convenience. */
  starPositions: Vector2D[];
}

/** The seed single-player uses: phase 0, the shipped orientation. */
export const DEFAULT_MATCH_SEED = 0;

/** Today's shipped seat-0 offset from the arena center. */
const LEGACY_SEAT_ZERO_OFFSET: Vector2D = { x: -1500, y: -500 };

const LEGACY_RING_RADIUS = Math.hypot(
  LEGACY_SEAT_ZERO_OFFSET.x,
  LEGACY_SEAT_ZERO_OFFSET.y,
);

/** Ring radii by star count (draft §4): 2★ is today's exact spacing. */
const RING_RADII: Record<MatchStarCount, number> = {
  2: LEGACY_RING_RADIUS,
  3: 1800,
  4: 2000,
};

/** Extra radius beyond the ring for the wrap circle (draft §4). */
const WRAP_MARGIN = 1400;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Deterministic ring phase for a seed; seed 0 = no rotation. */
const phaseForSeed = (seed: number): number =>
  Number.isFinite(seed) ? seed * GOLDEN_ANGLE : 0;

const rotate = (point: Vector2D, angle: number): Vector2D => {
  if (angle === 0) return { x: point.x, y: point.y };
  if (angle === Math.PI) return { x: -point.x, y: -point.y };
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
};

/**
 * Build the arena layout for a match. Deterministic in `seed`: the same
 * seed and star count always produce the same layout; changing the seed
 * rotates every star around the arena center by the same phase.
 */
export const createMatchLayout = (
  seed: number = DEFAULT_MATCH_SEED,
  starCount: MatchStarCount = 2,
): MatchLayout => {
  const ringRadius = RING_RADII[starCount];
  const scale = ringRadius / LEGACY_RING_RADIUS;
  const canonicalSeatZero: Vector2D = {
    x: LEGACY_SEAT_ZERO_OFFSET.x * scale,
    y: LEGACY_SEAT_ZERO_OFFSET.y * scale,
  };
  const seatZero = rotate(canonicalSeatZero, phaseForSeed(seed));
  const step = (Math.PI * 2) / starCount;

  const stars: MatchLayoutStar[] = Array.from(
    { length: starCount },
    (_, starIndex) => ({
      starIndex,
      starId: starIdForSeat(starIndex),
      ownerId: ownerIdForSeat(starIndex),
      pos: starIndex === 0 ? seatZero : rotate(seatZero, starIndex * step),
    }),
  );

  const arenaCenter: Vector2D = { x: 0, y: 0 };
  return {
    seed,
    starCount,
    arenaCenter,
    wrapCenter: { ...arenaCenter },
    wrapRadius: ringRadius + WRAP_MARGIN,
    ringRadius,
    stars,
    starPositions: stars.map(star => star.pos),
  };
};
