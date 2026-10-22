# WRECK SALVAGE — what a death drops

RULED by Adam 2026-10-22 ("OK, I like that. Let's put that
in"); builds in the tail behind BOTS.md. The flat one-piece
death drop retires EVERYWHERE.

## Core

A destroyed ship — **no matter who destroys it** — relinquishes
its **CARGO WHOLE**, plus salvage rolled on the ladder against
its INVESTED VALUE. The drop is a field resource: no killer
ownership; the owner may race back to reclaim (the respawn
timer is the handicap).

## The ladder

One roll per wreck, % of basis:

| % of basis | chance |
|---|---|
| 10% | 61.8% |
| 20% | 12.2% |
| 30% | 8.5% |
| 40% | 6.0% |
| 50% | 4.2% |
| 60% | 2.9% |
| 70% | 2.0% |
| 80% | 1.4% |
| 90% | 1.0% |

Geometric decay ≈ ×0.7 per rung; the 10% floor is guaranteed
and absorbs the leftover probability mass; the table sums to
100.0 and its expected value is ≈ 20.8% of basis. The 90%
freak, in Adam's fiction: "the hit penetrated the weakest
spot and took out the crew (very low chance) with minimal
ship damage." Adam's worked example: a 20-unit upgrade on a
free Skiff carrying 10 scrap drops the 10 cargo + 2–18 for
the upgrade.

## Scope and the destroyed set

Adam: *"all the ships that are purchasable receive the chart
treatment"* — capital ships, drones, and escorts. And:
*"invested value is what we want to use for a killed ship's
scrap in space."*

A capital ship's basis counts ONLY what death destroys:

- (a) cumulative TYPE price for its line/tier — a free
  Skiff's hull contributes 0 by arithmetic, not special
  case: its wreck is just its hold;
- (b) hull-step prices;
- (c) turret mounts at curve prices for its mount count;
- (d) arsenal tiers at prices paid — EXCEPT the starter Bolt
  Cannon's first tier (free, and KEPT through death, so it
  contributes nothing; paid bolt tiers above it count);
- (e) the five upgrade tracks, every current level at prices
  paid — Adam: "the upgrades should apply for scrap value
  chart treatment" — and death resets them all.

EXCLUDED deliberately: cargo (rides whole, separately); the
bank (kept); deployed drones/escorts (they survive the
captain and carry their own charts for their own deaths);
sunk fees (switch tolls, swap fees, repurchase prices —
history, not value on the hull as it died). The fence, in one
line: **the chart pays only on what death actually destroys.**

## Drones and escorts

- **Drones:** cargo whole + ladder vs PURCHASE value (Adam:
  harvesters follow "the same rules as regular ships… rolled
  on the chart vs. purchase value, plus scrap it holds").
  Unpurchased-hull bases: a star-fleet gleaner rolls vs
  DRONE_PRICE 75 (the same airframe the well sells); a
  defense-mode drone vs DEFENSE_DRONE_PRICE 100. A
  liquidating drone (ECONOMY_AND_THE_WELL.md) killed on its
  last trip dies under this same law.
- **Escorts:** basis = kind price alone (100 / 200 / 350);
  they carry no steps, tracks, or arsenal.

## Rounding, drift, marker

- **Rounding:** nearest unit; never below one unit when a
  roll pays.
- **DRIFT (Adam):** wreck scrap slowly diverges from the
  destruction point — gentle; "too fast and it's practically
  not worth it to collect." Rate and decay DRAFT. Big rolls
  chunk into a bounded set of value-carrying shards so a
  crown wreck doesn't flood the field with single-unit
  entities.
- **Wreck marker** (settled UI ↔ BackGround): `GameState.wrecks`
  — one tombstone per CAPITAL-ship death { id, pos, bornAt,
  expiresAt, seed, value } on the sim's own clock; value
  dresses dressing scale only. Scattered scrap carries the
  wreckId; the canvas draws those pieces as cooling shards
  that outlive the marker as cold metal. Harvester deaths
  stay unmarked — small game doesn't get a monument.
