# CARGO AND JETTISON — the two ways scrap leaves a ship by hand

PINNED (shipped behavior; the pairing ruled 2026-10-22). Scrap
carried in the hold can be thrown, not just delivered — and a
thrown pod obeys star law at the far end: reaching a friendly
or same-team star FEEDS it; striking a hostile star WOUNDS it
(the wound's arithmetic lives in STAR_INTEGRITY.md).

## SPACE — the scrap key

Throws ONE carried scrap per press (100 ms cadence), kicked
along the ship's heading as a deployed-cargo pod
(`wantsJettison`, `src/net/sessionAdapter.ts`; pod life
~200 frames). An aimed verb: feed your star from a distance,
pellet theirs one honest scrap at a time. The HUD controls
card names it EJECT PULSE — SPACE.

**Fence:** Space is the scrap key. The controls rework
(CONTROLS.md) must never reassign it to fire — F fires the
weapon, alone. (A chat-side map once claimed "F/Space fire";
code said otherwise, and Adam's memory settled it.)

## J — DUMP ALL

RULED by Adam 2026-10-22; builds with the controls slice. The
whole hold overboard BEHIND the ship in one kicked, spread
cloud — the escape verb: instant overload shed plus a scrap
cloud in the pursuer's face ("like throwing a dead rat at a
chasing dog" — Adam). Where Space is the aimed throw, J is
the panicked dump; both pods then drift under the same cargo
law. Phone parity: its own tile beside EJECT — never a
long-press; a verb you need mid-escape cannot hide behind
a hold.

Sim half: a `jettisonAll` intent beside `wantsJettison` — the
mass version of the same pod spawn.
