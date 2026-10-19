# Mass-Rattle — Star Defense Ladder & Ship Weapons

_Design record. Star defense ladder PINNED by Adam, 2026-10-19. Ship weapons section is
direction + draft, not yet pinned. Current-state facts were read from the code the same day._

## The idea

A star's defenses grow the way electrons fill an atom: **shells**. The inner shell holds
**2** turrets, the next shell out holds **8**. (The pattern is 2n² — a third shell of 18
exists in the mathematics if the game ever grows that far.) Turrets in a farther shell sit
in a **farther-out concentric ring** around the star.

Everything below is driven by one number per star:

> **M = feeding milestones = total scrap infused ÷ 100** (whole milestones only)

## What feeding already does (stays, in parallel)

The defense ladder runs **in parallel** with the existing feeding benefits — nothing below
replaces them:

- Every **100 scrap** delivered: star **mass × 1.25**, **size × 1.15**.
  Mass is gravity in this game (pull = G · mass ÷ distance²), so a fed star's well deepens.
- The ship is upgraded separately, paid from cargo (thrust / nav / VAC / fuel / cargo).
  **Ship = upgraded, star = fed.**

## The ladder

### Healing — rides every milestone

- Integrity healing per scrap delivered starts at **0**.
- It **increases a bit at every milestone**, through all phases below.
- (One symmetric rule for both stars. Today only the enemy star heals from feeding —
  +0.005 integrity per scrap delivered by its drones. The player's star will use the
  milestone-scaled rate instead. Draft rate: heal = M × 0.001 per scrap — tune in play.)

### Phase A — fill the inner shell (M1)

- The star starts with **1 turret**.
- At **M1**, a second turret is added. **Inner shell complete: 2 turrets**, riding the
  close orbit, opposite each other.

### Phase B — beef the inner shell (M2–M4)

- The two inner turrets get **beefier over 3 tiers** — one tier per milestone.
- "Beefier" = some mix of bolt damage, bolt speed, and fire rate per tier
  (baseline today: damage 10, bolt speed 8, range 1200, ~1% fire chance per frame).

### Phase C — fill the outer shell (M5–M12)

- Each milestone adds **one turret in the outer concentric ring**, farther from the star.
- At **M12 the outer shell is complete: 8 turrets** — 10 turrets total.

### Phase D — beef the outer shell (M13 onward)

- The outer eight then improve tier-wise — but **slower than the inner pair did, because
  there are more of them**.
- _Marlowe's reading (unconfirmed): round-robin — each milestone tiers up one outer
  turret, so lifting the whole ring one tier takes 8 milestones._

### Parity

- The enemy star climbs the same ladder off its own infused total.
- Full ladder ≈ M18+ (about 1,800 scrap) — long-game growth. A single-player duel may
  end before the outer shell fills; in the .io arena this is the endgame shape.

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

1. Turret start count: 1 at spawn (this doc's reading) or 0?
2. Phase D: round-robin tiering, or all-eight-together every few milestones?
3. Heal rate numbers, and the per-tier "beefier" numbers — settle in playtesting.
4. Ship weapons: one track or two? Bought like other ship upgrades, or earned another way?
