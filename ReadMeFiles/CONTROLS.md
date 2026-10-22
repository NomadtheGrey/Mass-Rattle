# CONTROLS — the settled key map

SETTLED by Adam 2026-10-22 (Adam ↔ dev ↔ UI, three reads
reconciled). Builds as ONE landing — a half-shipped key map is
the failure this document exists to end. The surface half is
UI's; the selection verb and its guest path are BackGround's.

## Weapons

- **1–5 + T — SELECT WEAPON** among OWNED, INSTALLED weapons,
  fixed registry order: **1 Bolt Cannon · 2 Ion Blaster ·
  3 Mine Layer · 4 Flak Cannon · 5 Rail Lance · 6 (T) Seeker
  Torpedoes**. The digit names the WEAPON — learned once, for
  a whole career; the map never renumbers when the arsenal
  grows. (Compaction over owned weapons was considered and
  rejected for exactly that reason; the sixth weapon's letter
  twin is T, the free top-row letter in the cluster's reach.)
- **Selection IS an equip:** it runs the existing swap verb
  and pays the existing swap fee on change — a hotkey is a
  faster hand, not a free re-arm, or the swap pricing dies.
- The loadout strip greys what isn't owned or can't mount on
  the hull being flown (the mount gate is the arsenal's own
  law; the selector inherits it). On the phone, the strip
  itself is the selector: tap a weapon chip.

## Fire and cargo

- **F — FIRE** the selected weapon. Alone. Space does NOT
  fire (CARGO_AND_JETTISON.md carries the fence).
- **SPACE — the scrap key.** One scrap per press, thrown
  along the heading.
- **J — DUMP ALL.** The whole hold, behind the ship
  (CARGO_AND_JETTISON.md).

## System verbs (the letter row)

- **Q — VAC**, alone. (Q, E, and R once all read VAC; the
  redundancy funded the new slots.)
- **E — ITEM:** the equipped defense item's deploy — today
  the Decoy Beacon, the arsenal's ONE active defense.
  Defenses are otherwise passive, and all four hybrids
  (Mirror Sail, Siphon VAC, Thorn Hull, Scrap Aegis) are
  passive modules with no verb; if an active hybrid ever
  ships, it takes a letter in its own slice.
- **R — REPAIR:** the Damage Control toggle
  (DAMAGE_CONTROL.md).
- **C — ABILITY:** the signature slot (SIGNATURE_ABILITIES.md)
  — ghosted on the strip until signatures land; an honest
  reserved seat, so no system steals the key meanwhile.
- **X — RETIRED.** One verb, one letter: the decoy's key is E.

## Buying, targeting, doors

- **Shift+1–5 — BUY the standard upgrade tracks**, in their
  numbered order. Shift is the buying layer, everywhere: the
  same digit means "weapon N" in combat and "track N"
  shifted, never both at once. Text-field sealing keeps
  digits out of chat typing; `e.code` reads Digit1 regardless
  of Shift.
- **TAB — TARGET CYCLE** (the Lightning Lock's tempo key);
  **click/tap** on or near a valid enemy also sets the
  target.
- **U — WORKSHOP alone** (Tab's old toggle duty retires;
  docking at a star is a deliberate act, not a tempo one).
- **G — gauges.**

## Disqualified by the browser, not by taste

- The F-row: **F5 is page reload** — a slipped finger ends a
  match — and F1 is help.
- **Ctrl+digits:** Chrome reads Ctrl+1..8 as TAB SWITCHING,
  and the page cannot reliably prevent it; the player would
  switch OUT of the match mid-keypress.

## The reflection

The loadout strip IS the map: every cell carries its key
chip (digit on weapons, letter on systems), the selected
weapon lit, F's chip reading its verb by content (FIRE / LAY
/ CHARGE); chips update in the same frame as any equip, swap,
or sell, so the chip can never become a second, stale truth.
Empty slots ghost. Phone tiles mirror the same geography —
both maps teach the same ship.
