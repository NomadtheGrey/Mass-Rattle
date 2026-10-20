# Mass-Rattle — Star Defense Ladder & Ship Weapons

_Design record. Star defense ladder PINNED by Adam, 2026-10-19. Ship weapons section is
direction + draft, not yet pinned. Current-state facts were read from the code the same day._

## The idea

A star's defenses grow the way electrons fill an atom: **shells**. The inner shell holds
**2** turrets, the next shell out holds **8**. (The pattern is 2n² — a third shell of 18
exists in the mathematics if the game ever grows that far.) Turrets in a farther shell sit
in a **farther-out concentric ring** around the star.

Everything below is driven by one number per star:

> **M = feeding milestones reached.** Milestone costs RISE (Adam's pin,
> 2026-10-20): milestone N costs **100 + 25 × (N−1)** scrap — M1 100,
> M2 125, M3 150, M4 175 … — so M is read off the cumulative thresholds
> (100 / 225 / 375 / 550 / 750 …). The math lives in `src/starGrowth.ts`;
> the full ladder to M18 costs **5,625 scrap** cumulative.

## What feeding already does (stays, in parallel)

The defense ladder runs **in parallel** with the existing feeding benefits — nothing below
replaces them:

- Every **milestone crossed** (costs rise — see above): star **mass × 1.25**, **size × 1.15**.
  Mass is gravity in this game (pull = G · mass ÷ distance²), so a fed star's well deepens.
- The ship is upgraded separately, paid from cargo (thrust / nav / VAC / fuel / cargo).
  **Ship = upgraded, star = fed.**

## The ladder

### Healing — rides every milestone

- Integrity healing per scrap delivered starts at **0**.
- It **increases a bit at every milestone**, through all phases below.
- **IMPLEMENTED (Phase 1c, 2026-10-20):** one symmetric rule for both stars —
  the old enemy-only +0.005/scrap heal is gone. **DRAFT rate, UNPINNED:**
  heal = **min(0.005, 0.0005 × M)** per scrap delivered — 0 at M0, rising each
  milestone, reaching the old enemy-only rate at M10. Tune in play; Adam pins.

### Phase A — fill the inner shell (M1)

- The star starts with **1 turret**.
- At **M1**, a second turret is added. **Inner shell complete: 2 turrets**, riding the
  close orbit, opposite each other.

### Phase B — beef the inner shell (M2–M4)

- The two inner turrets get **beefier over 3 tiers** — one tier per milestone.
- **IMPLEMENTED (Phase 1c):** BOTH inner turrets tier up together (tier 2 at
  M2, 3 at M3, 4 at M4). Per-tier numbers (doc draft): bolt **damage =
  10 + 2 × (tier − 1)**; **fire chance per frame = 1% + 0.2pp × (tier − 1)**;
  bolt speed 8 and range 1200 unchanged at every tier. Each turret rolls and
  fires independently.

### Phase C — fill the outer shell (M5–M12)

- Each milestone adds **one turret in the outer concentric ring**, farther from the star.
- At **M12 the outer shell is complete: 8 turrets** — 10 turrets total.

### Phase D — beef the outer shell (M13 onward)

- The outer eight then improve tier-wise — but **slower than the inner pair did, because
  there are more of them**.
- **IMPLEMENTED AS DRAFT (Phase 1c), still UNPINNED:** round-robin — each
  milestone tiers up one outer turret, cycling 0→7, so lifting the whole ring
  one tier takes 8 milestones. Awaiting Adam's pin (alternative: all eight
  together every few milestones).

### Parity

- The enemy star climbs the same ladder off its own infused total.
- Full ladder ≈ M18+ — **5,625 scrap cumulative** under the rising milestone
  curve — long-game growth. A single-player duel may end before the outer shell
  fills; in the .io arena this is the endgame shape.

## Current state of the code (2026-10-19)

- One auto-turret per star; its damage/fire-rate **never scale** with feeding.
- The ship has **no gun**. Its only offense is the eject-cargo pulse (Space): infuse the
  home star up close, or sabotage the enemy star's integrity.
- All projectiles in the game today are star-fired.
- No networking exists yet — Mass-Rattle is intended as an **.io multiplayer game**;
  what's built is a single-player prototype of the loop (the enemy is AI).

## Ship weapons (direction — Adam, 2026-10-19; shape not yet pinned)

Adam: ship weapons are to be added. Marlowe's draft, for reaction:

- A sixth cargo-paid upgrade track ("Guns"), per-run like the other five — die and it resets.
  - L1: single bolt cannon · L2: faster fire · L3: twin bolts · L4: heavier bolts · L5: three-way spread
- The eject pulse stays the siege tool; the gun is for drones, ships, and harassment.
- Open: one weapon track, or two (bolts + something stranger, e.g. mines laid from cargo)?

## Open questions

1. ~~Turret start count: 1 at spawn or 0?~~ **SETTLED (Adam, 2026-10-19): the starter
   turret is kept — the star spawns with 1 turret, and M1 completes the inner shell at 2.**
2. Phase D: round-robin tiering (implemented as an UNPINNED draft in Phase 1c),
   or all-eight-together every few milestones? — Adam's pin still owed.
3. Heal rate numbers (draft min(0.005, 0.0005 × M) implemented, UNPINNED), and
   the per-tier "beefier" numbers — settle in playtesting.
4. Ship weapons: one track or two? Bought like other ship upgrades, or earned another way?
