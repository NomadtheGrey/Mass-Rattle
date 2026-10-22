# STAR INTEGRITY — how stars are wounded and healed

Code truth, verified 2026-10-22. Every star carries **integrity
1.0**; a seat is eliminated when its star's integrity reaches 0
(`src/sim/seatState.ts`).

## Damage

- **Weapons fire chips stars.** Any hostile projectile reaching
  a star's disc: integrity -= damage × 0.002
  (`src/sim/projectiles.ts`). Bolt Cannon (12) = 0.024/hit
  (~42 hits on a fresh star); Rail Lance (45) = 0.09 and
  pierces, billing each star on the line once; Seekers (30)
  = 0.06; mines (40) = 0.08. Star-killing by gunfire is a
  siege by design — see BOTS.md for who conducts one.
- **Cargo wounds stars.** A deployed scrap pod striking a
  HOSTILE star: integrity −0.01, mass ×0.99, size ×0.995 per
  piece ("each bit of cargo damages it"). The pod itself is
  CARGO_AND_JETTISON.md's subject; the wound is recorded here.
- **Thorn Hull splashback** against a star nibbles integrity
  (thorn × 0.002 rates, `src/sim/physics.ts` /
  `src/sim/projectiles.ts`).

## Healing

- **Delivery heal (symmetric, DRAFT numbers).** Feeding a star
  restores integrity at heal(m) = min(0.005, 0.0005 ×
  milestones) per scrap — 0 at M0, rising per milestone,
  capped at the old enemy-only rate of 0.005 at M10; integrity
  itself caps at 1 (`src/starDefense.ts`, `applyDeliveryHeal`).
  The same pod that wounds a hostile star FEEDS a friendly or
  same-team one. A star being fed out-heals a star being
  pelted — until the feeding stops.
