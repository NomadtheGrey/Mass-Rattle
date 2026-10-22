# INDEX — ReadMeFiles routing table

**Pointers only.** This file asserts nothing about any system;
it gives addresses. If wording here ever seems to disagree
with a document it names, the named document wins and this
line gets fixed (the practice is WORKING_NOTES.md's "The
ledger" section).

**How to look something up:** grep this folder for the term
first; if the hits scatter or the term is ambiguous, find the
question's row below and read the ONE document it names.
One system, one home — do not read around the folder.

## The documents

| Document | Jurisdiction (one line) | Route here when the question is about… |
|---|---|---|
| CODE_MANIFESTO.md | Code-shape law (the tenets + comments) | how code must be written, commented, verified |
| DESIGN_AND_PRACTICES.md | This game's design constitution | laws of the game, numbers doctrine, player trust, this game's own features |
| WORKING_NOTES.md | Repo customs: branches, merges, shipping, lanes | how work lands, builds, ships; who owns what; the ledger practice |
| SHIP_PROGRESSION.md | Lines, tiers, crowns, hull numbers | a ship line's tiers, stats, caps, switch tolls, escort wing composition |
| STAR_DEFENSE_LADDER.md | Star turrets: rings, phases, tiers | turret counts, ring geometry, turret damage/fire law |
| STAR_INTEGRITY.md | How stars are wounded and healed | star integrity, chip damage, the cargo wound, delivery heal |
| ECONOMY_AND_THE_WELL.md | Money law | the well gate, forced sell, the last trip, death tax, repurchase, laundering flag |
| CARGO_AND_JETTISON.md | The two hand-thrown cargo verbs | Space (one scrap, directional), J (dump all, behind) |
| DAMAGE_CONTROL.md | Scrap healing + repair docking | heal rates/caps, the toggle, harvester & escort docking |
| DRONES_AND_FLEETS.md | The three small-ship populations | workforce, defense pair, star fleet, workforce orders (FEED/DEPOSIT) |
| ALLY_DOCKING.md | Harbors | docking with a friendly capital ship, HARBOR consent |
| BOTS.md | B1 postures + B2 bot economy | bot flight judgment, bot bank accounts, the fairness doctrine |
| WRECK_SALVAGE.md | What a death drops | the salvage ladder, the destroyed set, drone/escort bases, wreck markers |
| SIGNATURE_ABILITIES.md | One ability per line (DESIGN stage) | Lightning Lock, VANISH, Gravity Lasso, Reserve Launch, Missile Salvo |
| STEALTH.md | One reveal geometry | cloak, periscope, mine radii, star-as-observer |
| CONTROLS.md | The settled key map | weapon selection keys, system verbs, Shift-tracks, disqualified keys |
| OPEN_REGISTER.md | Pointers to everything still open | what's unbuilt, unruled, flagged, or owed |

## Seams (questions that touch two homes)

- **Death** — the TAX and repurchase price live in
  ECONOMY_AND_THE_WELL; what the wreck DROPS lives in
  WRECK_SALVAGE.
- **Cargo striking a star** — the THROW is CARGO_AND_JETTISON;
  the WOUND's arithmetic is STAR_INTEGRITY.
- **Feeding a star** — the delivery DECISION (FEED/DEPOSIT) is
  DRONES_AND_FLEETS (workforce) or BOTS (bot policy); the
  HEAL it causes is STAR_INTEGRITY.
- **Repair** — the ENGINE and docking are DAMAGE_CONTROL;
  ALLY docking's harbor rules are ALLY_DOCKING; bot repair
  DISPOSITION is DAMAGE_CONTROL's anchors, applied in BOTS.
- **Escorts** — the WING (composition, prices) is
  SHIP_PROGRESSION; their repair docking is DAMAGE_CONTROL;
  their salvage basis is WRECK_SALVAGE.
- **Stealth vs signatures** — the GEOMETRY is STEALTH; VANISH,
  its purchased exception, is SIGNATURE_ABILITIES.
- **Keys** — the MAP is CONTROLS; the verbs themselves live
  with their systems (Space/J in CARGO_AND_JETTISON, R in
  DAMAGE_CONTROL, C in SIGNATURE_ABILITIES).
