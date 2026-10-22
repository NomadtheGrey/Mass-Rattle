# DAMAGE CONTROL — scrap healing and repair docking

RULED by Adam 2026-10-22; engine and surfaces built on WIP
(`src/sim/repair.ts`).

## The engine

- **Ships heal by consuming scrap from the HOLD** — tiered
  heal RATE and heal CAP by ship type and tier; even a Skiff
  heals, to a small cap. Damage below the cap is permanent.
  The player-facing exchange: **1 scrap = 2 HP**. All rate
  and cap values DRAFT for the numbers pass.
- **The toggle is the captain's, and it defaults ON** (Adam's
  word). Opt-out only.
- **Guns stay up while repairing.** (A guns-down gate was
  proposed and withdrawn by its own author: with default-ON
  it would read as a bug.) The costs of healing are the
  scrap and the rate.
- **The bank NEVER pays for healing**, on any surface — the
  wallet law (hold first; bank opens only in the well,
  ECONOMY_AND_THE_WELL.md) makes field healing hold-only by
  construction.
- Credit is whole-scrap: slow rates never burn a scrap for a
  fraction of a hit point.

## Harvester docking

A workforce harvester hurt below the dock threshold (15 —
half the hull, DRONES_AND_FLEETS.md) flies home vulnerable,
then docks INSIDE its capital ship: untargetable — mines,
seekers, bolts, point defense, auto-guns, escorts, and bots
all skip docked drones. It heals from the ship's hold and
relaunches healed. If the ship dies, docked drones spill
back to work. **Star-fleet drones never dock** (no capital
ship to dock in) — and neither do DEFENSE-MODE drones: the
dock gate reads `!drone.starFleet && drone.mode !== 'defense'`
(`src/sim/drones.ts`), which is why the workshop's DEFENSE
block carries no docked state.

## Escort docking

Below its kind's repair cap an escort roads home to its
carrier and rides ALONGSIDE — targetable, unlike
inside-docked drones — healing from the carrier's hold to
its kind's cap. The cap is threshold AND ceiling (no
dock-loops). Docked escorts count in wing composition (no
double-buy). Carrier death mid-repair: the escort undocks
to the star ring, healing paused. UI's MUSTER reads the wing
whole: flying / docked-mending / "N ON THE ROAD HOME"
(below cap, beyond dock range). Surfaces: DAMAGE CONTROL
block in the workshop (switch + cap % + HP/s + the law in
copy), an in-play pill, a phone tile, an amber repair-cap
tick on both hull bars, the BUILD DRONE line's docked count,
and the canvas treatments — docked harvesters undrawn
(inside the hull) and a green cross pip over each
alongside-healing escort.

## Bot disposition

Adam's anchors: bots adopt healing by a **health-graded
chance — at 95% health ≈ 5%, at 20% health ≈ 80%** — with
per-pilot recklessness varying it. Posture integration:
BOTS.md.
