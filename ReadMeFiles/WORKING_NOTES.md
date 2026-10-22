Mass Rattle — Working Notes
The local customs of this repo: how work lands, how it ships, and who
does what. The constitution is CODE_MANIFESTO.md (same folder); this
page is the practice that has grown up around it. Brief and factual.
Last updated 2026-10-21 (batch merges + build-history step folded in).

Branches & landings
- ALL work stages on the `WIP` branch. `main` is production and
  changes only through a WIP → main merge, so each merge is one
  reviewable delta and one production build.
- Merges are collaborative, per-landing decisions (Adam's word, made
  with the lanes) — there is no standing merge order.
- Merges run in BATCHES (Adam, 2026-10-21): landings accumulate on
  WIP one at a time and main moves when he calls the batch, so
  Cloudflare rebuilds only on batch-changes, not per landing. A
  merge's title names the batch; the PR's file list is the batch's
  manifest.
- One logical landing = one push carrying all of its files (one
  commit per landing keeps rollback and verification clean).
- After a merge, main is reverse-synced back into WIP and the tree
  diff is verified empty, so staging never starts from a stale tree.

Verification (a tool's "OK" is never the verdict)
- Every push is verified at origin: the commit exists and each
  landed file is byte-compared against the branch tip's content.
- Before a merge, the delta's file list is verified three ways:
  locally, in the PR's own file list, and again in the final merged
  delta after merging (a commit landing mid-merge rides along only
  if it is caught).
- TypeScript (`npx tsc --noEmit`) and the production build must be
  green on the tree being shipped; sim changes carry sanity checks
  against the pure modules.

Shipping to production
- The LAST commit on WIP before a merge is a prepend to
  src/buildHistory.ts: one entry (date, batch title in the batch's
  own words, one-sentence detail) citing the merge PR — so the PR
  is opened first, the entry lands citing it, then the merge runs.
- GitHub pushes do NOT auto-build this repo (the webhook has never
  fired). After each WIP → main merge, the production build is
  triggered manually through the Cloudflare Builds API and monitored
  to success.
- The live site is then verified, not assumed: the served bundle's
  hash and content markers are checked, and when worker code
  changed, the production lobby endpoints are probed end-to-end
  (create a room → it lists → a WebSocket hello seats a player).
- Deploys need no dashboard work: `wrangler deploy` in the build
  applies the Worker, assets, and Durable Object bindings/migrations
  from wrangler.jsonc.

Lanes (who owns what)
- Dev / coordination: design, contracts, sequencing of cross-lane work.
- UI: HUD, canvas rendering, lobby screens, overlays, mobile surfaces.
- BackGround: independent audits, deploy verification, heavy build
  work, and executing merges when the lanes agree a stack is complete.
- Cross-lane work starts with a claim naming every file the landing
  will touch; shared files (App.tsx, useGameLoop.ts, types.ts,
  protocol.ts) are claimed before they are edited.

Game truths a new reader needs
- Single player is the shipped game and the regression law: every
  multiplayer addition must reduce, in the default case, to the
  shipped behavior bit-for-bit (defaults make new gates no-ops).
- Multiplayer is host-run: one client's sim is authoritative, the
  Durable Objects seat players and relay; guests render snapshots.
- Sim state is plain serializable data, always — it crosses the wire.
