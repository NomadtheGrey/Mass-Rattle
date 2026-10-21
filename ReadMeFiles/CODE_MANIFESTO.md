Mass Rattle — Code Manifesto & Engineering Guidelines
Status: Mandatory Engineering Specification
Adapted 2026-10-21 from BioForge's Code Manifesto — Adam's constitution
across his games, translated here to Mass Rattle's codebase and machinery.
The ten tenets' substance and law-form are unchanged; the engine-specifics
are this repo's own.

**Layout note.** Mass Rattle's source is organized by responsibility:
`src/sim/` holds the pure simulation modules, `src/net/` the wire protocol
and client session, `worker/` the Cloudflare Worker and Durable Objects,
`src/components/` the render surfaces, `src/hooks/` the coordinators.
`src/types.ts` is one canonical type registry and stays whole. New modules
are born as their own files in their home layer.

Scope: All Code Generation, Features, Refactoring, and Architecture
This document defines the strict architectural, style, and performance rules governing all code contributions and refactors in the Mass Rattle codebase. Every developer, agent, and reviewer must adhere strictly to these 10 tenets:

1. Guard Clauses, Fail-Fast Flow & Zero 'else' / 'else if'
STRICT RULE: Avoid using else or else if blocks entirely across all code. Use guard clauses, early returns, and discrete, independent if checks to keep code completely flat at depth 0.
Prohibition: Absolutely no else blocks, else if chains, deep nesting, or pyramidal control flow.
Pattern:
  // PREFERRED (Flat, early return, zero 'else' or 'else if'):
  function processAction(action: ActionType, isPaused: boolean) {
    if (isPaused) return;
    if (!action) return;

    if (action === 'harvest') {
      executeHarvest();
      return;
    }

    if (action === 'feed') {
      executeFeed();
      return;
    }

    executeDefault();
  }

  // REJECTED (Forbidden use of else / else if):
  function processAction(action: ActionType, isPaused: boolean) {
    if (!isPaused) {
      if (action === 'harvest') {
        executeHarvest();
      } else if (action === 'feed') {
        executeFeed();
      } else {
        executeDefault();
      }
    }
  }

2. Functional Style Over Imperative Loops
Rule: Prefer declarative transformations using .map(), .filter(), .reduce(), .find(), .some(), and .every() instead of imperative for, for...in, or while index loops.
Pattern:
  // PREFERRED:
  const hostileSeats = seats.filter((s) => areHostile(viewer, s));
  const totalScrap = droppedCargo
    .filter((item) => item.kind === 'scrap')
    .reduce((acc, item) => acc + item.count, 0);

  // REJECTED:
  let total = 0;
  for (let i = 0; i < droppedCargo.length; i++) {
    if (droppedCargo[i].kind === 'scrap') {
      total += droppedCargo[i].count;
    }
  }

3. Frame-Loop Performance & Pre-Allocated Scratch
Rule: The frame loop — the game loop's per-frame steps and the canvas draw — runs at 60fps and allocates like it matters. Cache and memoize expensive computations and spatial queries instead of recomputing them per frame.
Prohibition: Never allocate heavy objects, build large arrays, or construct fresh geometry/path data inside the per-frame draw or sim step. Pre-allocate reusable scratch state (vectors, sets, result buffers) at module scope and reuse it.
Pattern:
  // Scratch state allocated once at module scope
  const SCRATCH: { x: number; y: number } = { x: 0, y: 0 };

  function projectToScreen(out: { x: number; y: number }, wx: number, wy: number) {
    SCRATCH.x = wx - camera.x;
    SCRATCH.y = wy - camera.y;
    out.x = SCRATCH.x * zoom;
    out.y = SCRATCH.y * zoom;
  }

4. Single-Purpose & Decoupled Architecture
Rule: Each function, class, and component must have exactly one clearly defined responsibility.
Decoupling Boundaries:
Pure Game State: Kept as pristine serializable data objects (GameState, SeatSimState, Ship, Star). The simulation's state is plain data by design — it is snapshotted, projected per viewer, and sent over the wire; nothing non-serializable may live in it.
Sim Layer: `src/sim/` modules are pure steps over that state (physics, projectiles, drones, cme, seatState, deathEconomy, teams). They do not render, fetch, or touch the DOM.
Render Layer: The canvas and HUD only consume state snapshots; they never hold authoritative gameplay state.
Networking Layer: Multiplayer is a host-run sim with a Durable Object relay — the host client simulates, the RoomDO seats players and relays typed messages (worker/room.ts + worker/roomLogic.ts hold the pure logic). There is no peer-to-peer simulation to keep in sync; the host's state is the truth and snapshots are its publication.
Module Length: Keep files concise and modularized across logical sub-domains.

5. Explicit Dependencies & Pure Ingestion
Rule: Pass all dependencies, configurations, and state references explicitly as typed function arguments or hook props.
Prohibition: Avoid hidden module-level mutable variables, ambient implicit globals, or unexpected side-effects across module boundaries.

6. Event-Driven Communication
Rule: Subsystems notify each other through typed events and records, never by reaching into each other's state. In this repo the instruments are the protocol's typed messages (ClientMessage / ServerMessage over the RoomDO relay) and the host-authored event feed (src/sim/eventFeed.ts) — kill, milestone, stage-change, repurchase, and match-end records that HUD, standings, and announcements consume as data.
Benefit: Decouples core gameplay logic from HUD surfaces, announcements, and network broadcasting so features can be extended without touching existing handlers.
Pattern:
  // The sim appends a typed record:
  feedEntries.push({ type: 'repurchase', ownerId: seat.ownerId, cost, at: time });

  // Independent consumers react cleanly:
  // - the HUD renders the feed entry
  // - the host announces standings / match end from state
  // - guests apply the next snapshot

7. Memory Management & Strict Resource Disposal
Rule: Every resource acquired must be released on teardown. Clean up all addEventListener handlers, requestAnimationFrame loops, setInterval/setTimeout timers, and WebSocket connections inside effect cleanup / component unmount / socket-close paths — no listener, loop, or socket outlives the surface that opened it.
Pattern:
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { /* ... */ };
    window.addEventListener('keydown', onKey);
    const frameId = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(frameId);
    };
  }, []);

8. Modular Domain Separation & Thin Coordinators
Rule: Do not store all gameplay domain state inside a monolithic root component. Logically separate distinct domains into dedicated, testable modules — the sim steps under `src/sim/` are the pattern: one mechanic, one module, pure over state.
Role of App.tsx and useGameLoop.ts: App.tsx is a thin coordinator wiring decoupled subsystems and layout. useGameLoop coordinates the frame — input, net session, and the ordered sim steps — and delegates every mechanic to its module; it does not grow new logic mass of its own.
Prohibition: Do not bundle raw economy math, bot AI routines, and world seeding together in the view layer or the coordinator.

9. Strict Type Safety & Zero Duck-Typing
Rule: All types, entity shapes, events, and parameters must be explicitly typed with zero ambiguity.
Prohibition: Absolutely no any, unchecked unknown, loose duck-typing, or dynamic shape assumptions.
Requirements:
Use Discriminated Unions for polymorphic targets and messages (e.g. ClientMessage = { type: 'hello'; ... } | { type: 'input'; ... } | { type: 'setTeam'; ... }, NetActionIntent likewise).
Ensure exhaustive type checks using never in switch statements where applicable.
Use strictly bounded key sets (e.g. Record<ItemId, number>) instead of generic string-indexed maps where domain keys are finite.
Define explicit return types for domain services, hooks, and event handlers.

10. Named Constants Over Magic Numbers
STRICT RULE: No hard-coded numeric literals in gameplay, rendering, or networking logic. Every number that carries domain meaning — radii, timers, rates, costs, speeds, thresholds, counts — must be declared exactly once as a named, typed constant at module scope or in a shared constants module, and referenced by name everywhere.
Naming: SCREAMING_SNAKE_CASE, descriptive of what the number means, not where it is used (e.g. RESPAWN_WAIT_BASE_MS, not WAIT_NUM).
Rationale: A bare 5000 cannot be searched, cannot be tuned in one place, and silently drifts when the same value is copy-pasted into a second check. A named constant is a single source of truth. This repo already lives this tenet visibly: the death economy's constants (src/sim/deathEconomy.ts — BANK_LOSS_FRACTION, REPURCHASE_COST_FRACTION, RESPAWN_WAIT_BASE_MS / _PER_DEATH_MS / _MAX_MS, SURVIVAL_MS_PER_TAX_STEP) are the tuning surface Adam rules on, and src/constants.ts's PHYSICS tables likewise.
Exemption: Pure arithmetic identity/index values (0, 1) in loop counters, array indices, and trivial increments are acceptable bare. Everything with domain meaning gets a name.
Pattern:
  // PREFERRED (declared once, named, one place to tune):
  const BANK_WELL_BONUS_RADIUS = 280;

  function inBankWell(shipX: number, shipY: number, star: Star) {
    const dist = Math.hypot(shipX - star.pos.x, shipY - star.pos.y);
    return dist < effectiveRadiusFor(star) + BANK_WELL_BONUS_RADIUS;
  }

  // REJECTED (magic number — what is 280? missed in the second copy):
  function inBankWell(shipX: number, shipY: number, star: Star) {
    const dist = Math.hypot(shipX - star.pos.x, shipY - star.pos.y);
    return dist < star.size + 280;
  }

Verification & Compliance
All pull requests, agent tasks, and automated refactors must verify compliance against these 10 rules prior to merging.
