// CLOAK GEOMETRY (Adam, 2026-10-21 — the minelayer line is the
// game's submarine): one table of distances that every perceiver
// reads — the canvas reveal, bot perception, seeker tracking, and
// (behind its switch, until Adam rules) star turrets. Shared
// geometry is the fairness ruling: nobody sees the submarine on
// terms another perceiver doesn't get.
//
// DRAFT numbers, first home here on the rendering side. When the
// perception sim lands, it imports THIS table rather than growing
// its own — if the numbers move, they move once, for everyone.

/** A cloaked hull is invisible beyond `shipOuter`, fully revealed
 *  at `shipInner`, and ramps between. */
export const CLOAK = {
  shipOuter: 420,
  shipInner: 140,
  /** Allies are never fully blind to their own submarine: the ghost
   *  floor a friendly minelayer never drops below. */
  allyFloor: 0.4,
  /** A burning engine betrays the boat: reveal floor while thrusting. */
  thrustFloor: 0.55,
  /** Nameplates obey the cloak — a plate shows only at this reveal. */
  plateReveal: 0.85,
} as const;

/** Mine concealment radii by tier (1..5): better mines stay dark
 *  until a hunter is closer. DRAFT. */
export const MINE_REVEAL_BY_TIER: readonly number[] = [260, 230, 200, 165, 130];

/** 0 (invisible) .. 1 (fully revealed) for a cloaked hull at `dist`. */
export function shipRevealFor(dist: number): number {
  if (dist <= CLOAK.shipInner) return 1;
  if (dist >= CLOAK.shipOuter) return 0;
  return (CLOAK.shipOuter - dist) / (CLOAK.shipOuter - CLOAK.shipInner);
}

export function mineRevealRadius(tier: number): number {
  const t = Math.min(5, Math.max(1, Math.floor(tier) || 1));
  return MINE_REVEAL_BY_TIER[t - 1];
}
