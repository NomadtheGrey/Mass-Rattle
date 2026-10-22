# BOTS — B1 postures, B2 economy

Consolidated resolution approved by Adam 2026-10-22 ("Most of
those are good to roll with"); RULED, builds in the tail
after ALLY_DOCKING.md. One program in two halves: B1 gives
bots judgment, B2 gives them wallets.

**Honest baseline:** today's bots consume NONE of the
purchase economy — bank 0 forever, deliveries feed,
repurchase is the structural free floor, starter Skiff +
starter cannon all match. Only their star grows.

## B1 — POSTURES

Flight only; derived per frame in `stepBotShip`, stateless —
a human drop-in inherits a ship, never a posture.

1. **FALLBACK** — hull ≤ 35% (DRAFT) with a hostile engaging:
   retreat under home turrets. With Damage Control this buys
   real recovery — get under the guns, spend the hold, return
   at the cap. An empty-hold bot gets cover only; posture
   weighs what's carried; damage below the repair cap never
   heals (DAMAGE_CONTROL.md).
2. **DEFEND** — hostile within 900 (DRAFT) of home star, or
   engaging the seat's harvesters/fleet: intercept the threat
   NEAREST THE STAR; leash 1200 (DRAFT). Territorial.
3. **HUNT** — the arsenal's offense engine (AGGRO 1000).
4. **SIEGE / HARVEST** — siege at standoff from a hostile
   star; harvest as the default.

- **Catch-up bias:** a seat trailing the field's best star by
  ≥ 2 milestones (DRAFT) takes no VOLUNTARY hunt/siege;
  defense and fallback are absolute at any score.
- **Amendment 3 — REACTIVE HUNT** (adopted): a trailing bot
  cannot INITIATE hunt/siege but still hunts REACTIVELY when
  a player enters its territory or engages its units. Fixes
  the "Milestone Lockdown" farm from the Gemini adversarial
  review (2026-10-22) — a hard cliff would make a trailing
  bot a passive, farmable node.
- **Amendment 4 — SEARCH** (adopted): on losing its target,
  the defender patrols the 900–1200 ring ~30 s before
  returning. Fixes the "Leash Kite" farm from the same review.
- **Acquisition** runs through the same stealth geometry as
  every other system (STEALTH.md), and DEFEND may measure
  from the HOME STAR as observer.
- **Repair disposition** per DAMAGE_CONTROL.md's
  health-graded anchors (95% health → ≈5%, 20% → ≈80%).
- Numbers-pass check owed: stealth detection band vs the
  DEFEND 900. The review's "suspicion trigger" fix was NOT
  adopted — it contradicts STEALTH.md's pin.

## B2 — BOT ECONOMY

Real seat accounts, real prices, no conjured purchases.

- Deliveries split by policy: BANK a share until the next
  purchase goal is priced, FEED the rest — through the same
  `deliveryMode` field a human Hauler flips
  (DRONES_AND_FLEETS.md).
- **Purchase priority DRAFT:** paid repurchase when the bank
  covers it → own line progression (seeded per seat, so bot
  fields don't mirror) → workforce to cap → defense pair →
  turret mounts → arsenal items.
- **FAIRNESS DOCTRINE (Adam, PINNED 2026-10-22):** bots
  decide Feed/Deposit algorithmically on real accounts at
  real prices — *"the game would play fairly, instead of
  instantly upgrading like Empire Earth did."*
- **Economic-Freeze softening (b)** (adopted): surplus above
  the current goal's price spills to the next purchase
  priority. Without it, killing a bot's ship locks its whole
  economy onto repurchase — a readable, farmable timetable.
- Per-seat economy rides with B2 for networked guests too:
  guests buy through the host against their OWN seat bank
  under the same wallet rules (hold first, then bank).
