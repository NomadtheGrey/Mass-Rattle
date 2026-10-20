# Mass-Rattle — Ship Progression: Types, Hulls, and Lines

_Design record. The two-ladder structure, the five lines, the peaks-not-locks rule,
the bundled-pricing rule, and the line-switching toll were PINNED by Adam, 2026-10-20
(Mass Rattle - UI chat). Items marked **reading** are the UI lane's interpretation,
flagged as such. Items under "Open" are not decided. Current-state facts were read
from the code the same day._

## The two ladders

A ship advances on **two separate axes** (Adam's ruling):

- **Ship TYPE (style)** — which kind of ship it is, and which line it belongs to.
- **HULL SIZE** — how big the ship is, grown step by step.

Every type has a **hull-size cap**. A player can max out the hull inside a type;
the next size step **requires a bigger type**. Type is the gate, hull is the grind.

Current state this builds on: the ship spawns at `size 15` and size never changes.
Size is a real mechanic, not just a drawing — enemy bolts hit at `dist < ship.size`,
the weapon muzzle sits at `size + 4`, and every canvas proportion (hull path,
shield bubble at `size + 9`, thrust flame, armor rim) derives from it. So hull
steps scale the whole ship honestly: **a bigger ship is a bigger target.**

## The lines

Five lines are in. Each line's ships grow through types of their own; the
endpoints named by Adam are quoted.

| Line | Specialty | Notes |
| --- | --- | --- |
| **Fighter** | **Hard points** | More hard points as the ships get bigger. |
| **Minelayer** | **Mines per drop** | One drop lays more mines as the line climbs. |
| **Hauler** | **Cargo + VAC reach** | The freighter: hold size and collection reach run highest here. (Line adopted by Adam; the special is as pitched by the UI lane.) |
| **Drone line** | **Drones fielded** | The drone ship "would upgrade eventually into a carrier." Player-owned harvester drones already exist in the game; this line is their force multiplier. |
| **Cruiser line** | **Extra shipboard guns** | "The cruiser would eventually become a Battlestar then a dreadnought." The size line: biggest hull caps in the game. The guns are auto-guns that grow with type (**reading**, confirmed by Adam as "spot on"). |

## Peaks, not locks

A line's specialty is its **highest amount of a thing, not its only thing**
(Adam, 2026-10-20):

> "It can have mines, just not as its specialty, like a minelayer wouldn't
> have as many guns as the cruiser."

So capabilities (guns, mines, drones, hauling) are **per-line amounts that
scale with type**. Nothing is exclusive to a line. A cruiser lays mines one at
a time; a minelayer carpets. Same tools, different quantities.

## Pricing rules

- **Specials are bundled** (Adam): "The extra firepower should be built into
  the price of the ship style upgrade." Nobody pays separately for hard
  points, extra guns, or mines-per-drop — the type's price tag *is* the
  capability's price tag.
- **Switching lines is allowed and tolled** (Adam): "We should have a cost to
  switch ship lines, free at first, but somewhat more costly as the
  progression goes." Lines are not a lifetime commitment.
  **Reading** (UI lane, unconfirmed): the toll scales with the player's
  progression — type depth reached — so experimenting in small ships is
  free and a late respec out of a top-tier hull costs real scrap. The
  loadout swap cost (60 + 20 per tier, pinned 2026-10-19) is the household
  precedent for the *shape* of such a curve, not the numbers.
- Purchases happen where all shop purchases happen: **inside the home
  star's well** (shop gate, pinned 2026-10-19).

## Visuals (UI lane)

- One **silhouette per line** — a carrier should look like a carrier before
  its name is read. Hull steps inside a type scale the drawing for free,
  since all proportions derive from `ship.size`.
- Hard points are drawn as actual mounts on the hull; the cruiser line's
  extra guns are drawn as turret hubs on the ship.
- The existing **welding-sparks effect** (it already plays on a ship
  upgrade) is the natural marker for a type change.

## Open / unpinned

- **What a hard point fires.** With the current one-weapon loadout, the UI
  lane's v1 **reading** is parallel offset shots of the equipped weapon at
  partial damage — not a second equipped weapon.
- **Hull-step compensation.** Growth is a hitbox penalty; the UI lane
  recommends each hull step also grant max health. Not pinned.
- **The ladders themselves.** Type names and step counts per line (beyond
  the endpoints Adam named), hull caps per type, and all prices — dev lane
  drafts, Adam pins.
- **Drone-line details.** How the drone ship / carrier raises the player's
  drone count, and whether lost drones are replaced, bought, or rebuilt.
