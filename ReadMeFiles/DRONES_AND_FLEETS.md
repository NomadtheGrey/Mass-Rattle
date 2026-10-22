# DRONES AND FLEETS — the three small-ship populations

Keep them separate; the game has three, and they obey
different laws:

1. **Workforce** — a captain's purchased harvesters
   (`buildDrone`, price 75). Every line fields some: Fighter
   1/2/2/3, Minelayer 1/2/2/3, Cruiser 1/2/3/4, Carrier
   1/2/3/4, **Hauler 2/3/5/7** plus her quality axis (speed
   +10/20/30%, carry +1/+1/+2) and her defense pair (below).
   Slot capacity 5, +Hauler carry bonus (6 at Mammoth, 7 at
   Atlas). Targeting: nearest scrap, NO leash — arena-wide;
   the risk is exposure (loaded drones are shootable the
   whole road home and drop cargo where they die).
2. **Star fleet** — the star's own harvesters (below).
3. **Escorts** — the Carrier's wing of little SHIPS, not
   drones (SHIP_PROGRESSION.md; repair: DAMAGE_CONTROL.md).

## The airframe

PINNED anchor, DRAFT numbers (2026-10-22): **DRONE_MAX_HEALTH
= 30** for every harvester — "about 2½ shots from the standard
gun," drafted exact off the Bolt Cannon's base 12 (two bolts
leave 6 HP; the third kills). One hull across workforce, star
fleet, and defense mode, every birth path. Speed is their
primary armor. Couplings: dock threshold 15 (half hull);
dock heal ceiling reads the constant. FLAGGED: a
defense-mode HP split (tougher pair) is a one-line change if
Adam ever wants it.

**Defense pair** (arsenal slice 3): drone mode for the
Hauler — cap 1 at T2, 2 from T3, other lines 0. Guards fire
light bolts at hostiles within 320, drones first. Price 100
DRAFT (drone 75 + mount step 25). Fielded count excludes
defense drones; their salvage basis differs
(WRECK_SALVAGE.md).

## The star fleet

PINNED shape, DRAFT magnitudes; built on WIP
(`Harvester.starFleet`).

- **Cap = 1 per lifecycle stage** (Adam's amendment,
  2026-10-22 — growth rides STAR EVOLUTION, not the clock):
  Red Dwarf 1, Red Giant 2, Yellow 3, White 4, Neutron 5.
  Adam's balance note, cited in code: star growth requires
  exponentially greater scrap, so linear fleet growth
  "doesn't seem out of line" — the fleet assists the curve;
  it never replaces the captain's hauling.
- **Range rides the same ladder:** 500 at Dwarf, +150 per
  stage, to 1100 at Neutron (DRAFT magnitudes; the axis is
  the pin).
- Destroyed fleet drones **respawn slowly** to the current
  cap (~45 s per drone through one birth channel; DRAFT).
  Fleet drones feed via `infuseStar`, ignore decoys, fly
  baseline speed, never dock, and are EXCLUDED from both
  workforce counts (the birth drone's old occupation of a
  workforce slot ended explicitly in the landing).
- Persistence: a seat asset keyed to the STAR's life — grows
  through captain death and repurchase; ends at seat
  elimination. UI: ⭐ STAR FLEET readout per star; gold ✦
  badge on fleet drones.

## Workforce orders

RULED by Adam 2026-10-22 ("Let's give haulers the ability to
send their harvesters in to the star well to deposit or
feed"); built on WIP (`SeatSimState.deliveryMode`).

- **FEED** — the historic behavior: the drone infuses its
  load (milestones, delivery heal, teamScrap).
- **DEPOSIT** — the load BANKS: no infusion, no delivery
  heal, no teamScrap. *Banking is not nourishment* — banked
  scrap is not food until withdrawn and fed by hand.
- **The order is the Hauler's crown in v1:** only a seat
  whose current ship is a hauler hull may hold an order
  (`canOrderWorkforce`). The order persists on the seat
  across switches and death; off-hull it SHELVES — the
  workforce feeds — and rebinds when a hauler returns.
  Widening the gate is a table change, not a redesign.
- **Distance: no rule.** Adam was undecided; the accepted
  read dissolved it — an order is not a chain on where
  harvesters fly; its price is exposure-time en route, not
  permission.
- **The star's own fleet takes no orders** — it always
  feeds; a depositing fleet would be an unattended bank
  engine.
- Host/SP seats apply instantly; the guest path rides the
  per-seat economy follow-on (BOTS.md, B2) — the same field
  a bot's Feed/Deposit policy sets.
