# STEALTH — one geometry, measured from ships and stars alike

PINNED (the base system predates this ledger; the star
generalization is Adam's, 2026-10-22). One geometry lives in
`src/sim/stealth.ts`; every reader — renderer, bots, seekers,
auto-systems, star systems — reads the same truth.

- Minelayer-line ships are **invisible on radar, totally**.
  On-field visibility is a proximity reveal ramp; enemy mines
  hide beyond a reveal radius that shrinks by tier:
  **T2 230, T3 200, T4 165, T5 130**.
- **Periscope rule:** firing or laying a mine while cloaked
  reveals the SHIP for ~2 s — a seconds-remaining countdown on
  the ship (`Ship.cloakReveal`), never host timestamps;
  guest clocks differ.
- **Same-geometry fairness:** no system gets perfect
  information. Bots, seekers, auto-systems, and star systems
  all respect the reveal geometry. **Turrets respect the
  cloak UNCONDITIONALLY** — acquisition is measured from the
  star. (A temporary "star systems respect stealth" switch
  existed and was removed as a contradiction.)
- **The star as observer (Adam's generalization):** stealth
  is absolute in deep space; detection is proximity-graded —
  and the same geometry applies measured from the ENEMY'S
  STAR. The closer a stealthed ship comes to a star, the more
  visible/detected it is BY THE STAR — covering turret reads
  and bot DEFEND acquisition from home (BOTS.md). No
  suspicion trigger; geometry only.
- The renderer-side ghost treatment lives with the geometry:
  in the reveal band, a desaturated hull, dashed sonar
  outline, capped alpha, near-solid close; thrust flare can
  betray; one's own hull is solid.
- **VANISH** (SIGNATURE_ABILITIES.md) is the one purchased
  exception: an area-level instrument whose firing betrays
  the neighborhood, never the hull.
