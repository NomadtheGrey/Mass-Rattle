# ECONOMY AND THE WELL — money law

## The Well is the Market

PINNED (Adam, generalized 2026-10-22): *"Once it gets into the
star's influence, harvesters and their scrap may be sold. That
principle goes with switching hulls, workshop, etc."* Every
purchase, sale, deposit, and withdrawal is gated to the home
team's gravity well (star size + 280, the dashed ring). Audited
2026-10-22: NO EXCEPTIONS — the shop cannot open outside the
well and auto-closes on leaving it. Banked scrap is not food:
it does not count toward milestones until withdrawn and fed
by hand (feeding mechanics: STAR_DEFENSE_LADDER.md's neighbor,
STAR_INTEGRITY.md; delivery policy: DRONES_AND_FLEETS.md).

## Forced sell at full price

PINNED (2026-10-22). Switching lines or climbing tiers sells
whatever the new hull cannot hold — weapons, mounts, escorts,
defense drones refund to bank at full price. One pure helper
decides for sim and UI alike (`src/switchReconcile.ts`,
`reconcileSwitch`), so the workshop's warning preview IS the
outcome ("⚠ SELLS THERE: … (+N U TO BANK)"). Shelving
survives only in the debug jump and the workforce-orders gate
(DRONES_AND_FLEETS.md).

## The last trip

PINNED (Adam's final shape, 2026-10-22). Excess WORKFORCE
drones are not sold on the spot. A hull change MARKS them
(`Harvester.liquidating`); a marked drone abandons work,
decoys, and dock, and flies home. ON ARRIVAL the sale settles
— carried cargo banks at face value ("sold cargo is sold
cargo — it gets banked") plus DRONE_PRICE banks — and the
drone leaves the world. A sale is not a delivery: the star is
not fed, no delivery heal, no teamScrap; deliveryMode does not
govern it. A marked drone killed en route dies as an ordinary
drone under WRECK_SALVAGE.md — cargo drops as field scrap,
nothing banks. Liquidating drones leave the workforce census
immediately (no double-sell; replacements are buildable while
the departing fly). Adam's doctrine for the road risk, same
provisional family as the death-wait cap below: if liquidated
harvesters dying on the final trip home "becomes an issue
we'll fix it. Likely we will. For now… the fault lies in the
capital ship captain (player) for switching hulls so far
from home."

## Death economy

PINNED set. Death tax 25% of bank; repurchase = 20% of
post-loss bank × 0.85^(deaths−1) — the first repurchase takes
no discount step (`src/sim/deathEconomy.ts`); FREE at zero
bank; respawn wait drafted 5s + 1s/death (the base and step
are DRAFTS) under a 30-second cap that is itself PINNED
(RESPAWN_WAIT_MAX_MS, binding from death 26; Adam's framing
when he set it: "IF it becomes a problem, we'll remove the
cap"); 60s of
survival forgives one wait-step (banked across lives; the
price reads raw deaths); free-floor repurchase is instant.
Forfeit after paying does not refund it. Death surfaces must
make FREE unmistakable, with real exits (the repurchase
overlay ships FORFEIT and wait-it-out rows).

## Flagged: death-tax laundering

Found by Gemini review, verified real-but-bounded by
BackGround (2026-10-22); Adam's call pending. Convert bank →
fielded drones pre-fight (death taxes only the shrunken bank),
then hull-switch to liquidate at 100%. Ceiling ≈ 725 scrap
sheltered, ≈ 181 tax saved per death on a full Hauler
complement; requires surviving the last trips inbound and a
tier climb before the verbs open. A shelter, not a mint.
Surgical fix if commissioned: the death tax reads bank +
fielded-drone purchase value. Adam's governing frame: "if
hull switching becomes a problem we can address that."
