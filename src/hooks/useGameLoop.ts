import { useState, useEffect, useRef, useCallback } from 'react';
import { GameState, SeatSimState, Star, Vector2D, Ship, Scrap } from '../types';
import { PHYSICS, COLORS } from '../constants';
import { getLoadoutItem, itemTierCost, swapCostForTier, MAX_ITEM_TIER, canMountWeapon, mountableLoadout , weaponIdForSelectSlot } from '../loadout';
import { inBankWell } from '../bank';
import { infuseStar, milestonesForInfused } from '../starGrowth';
import { ownerIdForSeat, starIdForSeat } from '../sim/ownership';
import { createMatchLayout, DEFAULT_MATCH_SEED } from '../sim/matchInit';
import { advanceSeatTracking, createSeatSimState, createStarterShip } from '../sim/seatState';
import { stepBotShip } from '../sim/botDriver';
import { DEBUG_ARMED } from '../debug';
import { stepStarBurn, stepShipPhysics, ShipPhysicsInputs } from '../sim/physics';
import { createMatch, shipSpawnPosition } from '../sim/matchAssembly';
import { loadSoloGame, saveSoloGame, clearSoloGame } from '../soloSave';
import { TUTORIAL_FLAG_KEY, TUTORIAL_STEP_DEFS, TUTORIAL_STIPEND, TEETH_INDEX, captureBaseline, type TutorialBaseline } from '../tutorial';
import type { NetSession, NetActionIntent } from '../net/useNetClient';
import {
  SNAPSHOT_EVERY_FRAMES, snapshotDue, localShipInput, remoteShipInput,
  idleShipInput, acceptGuestPayload, countDroppedActions, consumeRepurchaseIntent, consumeEconomyIntents, consumeTargetIntents,
  projectStateForViewer, ShipFrameInput,
} from '../net/sessionAdapter';
import {
  effectiveRadiusForStar,
  isInputLocked,
  physicalSizeForStar,
} from '../sim/starStages';
import { stepDrones } from '../sim/drones';
import { stepSeatRepairs } from '../sim/repair';
import { stepHarbors, canDockAt, HARBOR_DOCK_RANGE } from '../sim/harbor';
import { reconcileSwitch } from '../switchReconcile';
import { stepEscorts } from '../sim/escorts';
import { stepMines, stepProjectiles } from '../sim/projectiles';
import { isStealthShip, isVisibleTo, PERISCOPE_REVEAL_S } from '../sim/stealth';
import { stepCme } from '../sim/cme';
import { computeStandings } from '../sim/standings';
import { areHostile, areTeammates } from '../sim/teams';
import { applyDeathLoss, botRepurchaseDue, completeRespawn, respawnDue, tryRepurchase } from '../sim/deathEconomy';
import { walletPay, inTeamWell, attractRadiusForShip } from '../sim/seatShop';
import { stepBotEconomy } from '../sim/botEconomy';
import { isValidTarget, nextTargetId, stepTargetLocks } from '../sim/targeting';
import {
  WRECK_DRIFT_DECAY,
  WRECK_MARKER_MS,
  cargoDropScrap,
  droneSalvageBasis,
  rollSalvageValue,
  shipSalvageBasis,
  wreckShardScrap,
} from '../sim/salvage';
import { appendEventRecords, EventFeedEntry } from '../sim/eventFeed';
import { turretsForMilestones, turretRingRadius, turretDamageFor, turretFireChanceFor, turretAngleAt, targetInTurretArc, applyDeliveryHeal } from '../starDefense';
import { weaponStatsFor, shieldMaxFor, shieldRechargePerFrame, armorHullFor, armorThrustFactor, PD_RANGE, PD_COOLDOWN_MS, pdDamageFor, decoyHealthFor, decoyLifeFramesFor, gravFactorFor, thornDamageFor, aegisAbsorbFor } from '../loadout';
import { ShipLine, TypeTier, DRONE_MAX_HEALTH, typeFor, capsFor, typeStepPrice, hullStepPrice, hullSizeFor, HULL_STEP_HEALTH, switchToll, DRONE_PRICE, DEFENSE_DRONE_PRICE, EXTRA_MOUNT_DAMAGE, AUTO_GUN, autoGunCapFor, effectiveAutoGuns, turretMountPriceFor, ESCORT_KIND_DEFS, escortCapFor, escortKindOf, canOrderWorkforce, healCapPctFor, healRateFor, type EscortKind } from '../shipProgression';

/* attractRadiusForShip moved to src/sim/seatShop.ts (B2) — one text of the law for the local verbs, the bot policy, and guest intent consumption. */

/**
 * Masked device inputs for the collapse-cinematic lockout (P2-4):
 * while it runs, the local ship's routine receives these instead of
 * the live refs — no rotation keys, no touch, no stick — so every
 * command channel goes quiet at once (stepShipPhysics reads keys /
 * touch / stick directly; idleShipInput alone would not mask them).
 */
const NO_KEYS: ReadonlySet<string> = new Set();
const NO_TOUCH: ShipPhysicsInputs = {
  rotateLeft: false,
  rotateRight: false,
  vac: false,
  analogStick: null,
};

/* walletPay moved to src/sim/seatShop.ts (B2) — one text of the law for the local verbs, the bot policy, and guest intent consumption. */


/* inTeamWell moved to src/sim/seatShop.ts (B2) — one text of the law for the local verbs, the bot policy, and guest intent consumption. */

export const useGameLoop = (width: number, height: number, net?: NetSession | null) => {
  // MATCH GEOMETRY (Phase 2, src/sim/matchInit.ts): SP plays the
  // two-star layout at the default seed, whose star offsets relative
  // to the arena center are exactly the shipped (-1500, -500) /
  // (+1500, +500) — so the arena center here is the shipped midpoint
  // (home at width/2, height/2; enemy at +3000, +1000 from it) and the
  // positions computed below are the shipped ones, unchanged.
  const initialLayout = createMatchLayout(DEFAULT_MATCH_SEED, 2);
  const initialArenaCenter = { x: width / 2 + 1500, y: height / 2 + 500 };
  const initialStarPos = {
    x: initialArenaCenter.x + initialLayout.stars[0].pos.x,
    y: initialArenaCenter.y + initialLayout.stars[0].pos.y,
  };
  const initialEnemyStarPos = {
    x: initialArenaCenter.x + initialLayout.stars[1].pos.x,
    y: initialArenaCenter.y + initialLayout.stars[1].pos.y,
  };
  // PER-SEAT INIT (Phase 2, P2-2b): the initial ship and stars are
  // built once here so the per-seat projection (state.seats) can hold
  // the SAME object references as the top-level fields — seats[0].ship
  // IS state.ship, seats[0].star IS state.star, seats[1].star IS
  // state.enemyStar. SP is the 2-seat degenerate case: seat 0 human,
  // seat 1 a bot seat WITH a starter ship (Adam, 2026-10-23 — solo
  // fields an opponent; the shipless sandbox was the earlier shape).
  // The starter-ship factory reproduces the shipped initial ship
  // field for field (see src/sim/seatState.ts).
  const initialShip = createStarterShip(ownerIdForSeat(0), { x: 100, y: 100 }, { withStarterWeapon: true });
  const initialHomeStar: Star = {
    pos: initialStarPos,
    vel: { x: 0, y: 0 },
    size: 40,
    baseSize: 40,
    mass: 400,
    totalScrapInfused: 0,
    type: 'home',
    ownerId: initialLayout.stars[0].ownerId,
    integrity: 1,
    turrets: turretsForMilestones(0),
  };
  const initialEnemyStar: Star = {
    pos: initialEnemyStarPos,
    vel: { x: 0, y: 0 },
    size: 120,
    baseSize: 120,
    mass: 4000,
    totalScrapInfused: 0,
    type: 'enemy',
    ownerId: initialLayout.stars[1].ownerId,
    integrity: 1,
    turrets: turretsForMilestones(0),
  };
  // SOLO SAVE (Adam, 2026-10-23; src/soloSave.ts): a saved solo
  // match resumes at boot. Read once, here — the initializer below
  // consumes it; a room never reaches it (the save is solo-only
  // and the room paths build their own state).
  const bootSaveRef = useRef<GameState | null | undefined>(undefined);
  // TUTORIAL (Adam's program, 2026-10-23; src/tutorial.ts): the
  // flag is set by startTutorial before its reload; a tutorial boot
  // never restores the solo save (startTutorial cleared it, and
  // this read is the second lock on that door).
  const tutorialBootRef = useRef<boolean | undefined>(undefined);
  if (tutorialBootRef.current === undefined) {
    try { tutorialBootRef.current = window.localStorage.getItem(TUTORIAL_FLAG_KEY) === '1'; }
    catch { tutorialBootRef.current = false; }
  }
  if (bootSaveRef.current === undefined) bootSaveRef.current = tutorialBootRef.current ? null : loadSoloGame();
  const [state, setState] = useState<GameState>(() => bootSaveRef.current ?? {
    ship: initialShip,
    star: initialHomeStar,
    enemyStar: initialEnemyStar,
    seats: [
      createSeatSimState(initialHomeStar, 0, 'human', initialShip),
      // SOLO OPPONENT (Adam's call, 2026-10-23, superseding the
      // deliberate shipless-sandbox note in matchAssembly): the
      // enemy seat flies — a bot with the same starter ship an MP
      // bot seat gets, spawned by the assembly's own placement law.
      // The B1 driver + B2 economy already iterate this seat every
      // frame; the null ship was the only thing keeping it inert.
      createSeatSimState(initialEnemyStar, 1, 'bot', createStarterShip(initialEnemyStar.ownerId, shipSpawnPosition(initialEnemyStar), { withStarterWeapon: true })),
    ],
    standings: [],
    eventFeed: [],
    matchEnd: null,
    scrap: [],
    wrecks: [],
    deployedCargo: [],
    projectiles: [],
    mines: [],
    decoy: null,
    cmes: [],
    drones: [],
    escorts: [],
    starOrbit: 0,
    enemyStarOrbit: 0,
    teamScrap: 0,
    bankedScrap: 0,
    isShopOpen: false,
    lastUpgradeTime: 0,
    glitchActive: false,
    lastGlitchTime: 0,
    shakeAmount: 0,
    isVictory: false,
    isGameOver: false,
    useAnalogGauges: true,
    slip: 0,
  });

  // THE GUIDED FLIGHT — machine (src/tutorial.ts owns the table):
  // step state for the HUD's coach card, refs for the frame gates
  // (captain parking, save suppression), baselines per step entry.
  const [tutorial, setTutorial] = useState<{ active: boolean; step: number; done: boolean }>(() => ({ active: tutorialBootRef.current === true, step: 0, done: false }));
  const tutorialActiveRef = useRef(tutorial.active);
  const tutorialStepRef = useRef(0);
  const tutorialDoneRef = useRef(false);
  const tutorialBaselineRef = useRef<TutorialBaseline | null>(null);
  const tutorialStipendRef = useRef(-1);
  // REFRESH GUARD (Adam, 2026-10-24): the game's own reloads are
  // intentional and must never trip the guard — this flag is set
  // first, and the beforeunload handler below stands aside for it.
  const intentionalReloadRef = useRef(false);
  const reloadPage = useCallback(() => {
    intentionalReloadRef.current = true;
    window.location.reload();
  }, []);
  // GRADUATION (UI's contract): the flag clears and the world
  // KEEPS — the match simply becomes a normal solo match, and
  // done publishes so the HUD's graduation chip can show.
  const graduateTutorial = useCallback(() => {
    try { window.localStorage.removeItem(TUTORIAL_FLAG_KEY); } catch { /* no-op */ }
    tutorialActiveRef.current = false;
    tutorialDoneRef.current = true;
    setTutorial(t => ({ ...t, active: false, done: true }));
  }, []);
  // The END control: with graduation pending (the MATCH beat met)
  // it graduates in place; anywhere earlier it TEARS DOWN to a
  // fresh normal solo — the scripted instance is discarded, the
  // same reload idiom startTutorial boots with.
  const endTutorial = useCallback(() => {
    if (tutorialDoneRef.current) return; // graduated already: nothing to tear down
    try { window.localStorage.removeItem(TUTORIAL_FLAG_KEY); } catch { /* no-op */ }
    reloadPage();
  }, []);
  const skipTutorialStep = useCallback(() => {
    setTutorial(t => {
      if (!t.active) return t;
      const next = t.step + 1;
      tutorialBaselineRef.current = null;
      if (next >= TUTORIAL_STEP_DEFS.length) {
        // Skipping the last beat graduates, like acknowledging it.
        tutorialActiveRef.current = false;
        tutorialDoneRef.current = true;
        try { window.localStorage.removeItem(TUTORIAL_FLAG_KEY); } catch { /* no-op */ }
        return { active: false, step: t.step, done: true };
      }
      tutorialStepRef.current = next;
      return { active: true, step: next, done: false };
    });
  }, []);
  const startTutorial = useCallback(() => {
    clearSoloGame();
    try { window.localStorage.setItem(TUTORIAL_FLAG_KEY, '1'); } catch { /* no-op */ }
    reloadPage();
  }, []);
  useEffect(() => {
    if (!tutorial.active) return;
    if (netRef.current?.room || mpRoomRef.current) return; // the flight is solo-only
    const now = performance.now();
    if (!tutorialBaselineRef.current) {
      tutorialBaselineRef.current = captureBaseline(state, now);
      // The stipend lands once, as the WORKSHOP step opens.
      if (tutorial.step === 4 && tutorialStipendRef.current !== 4) {
        tutorialStipendRef.current = 4;
        setState(prev => ({ ...prev, bankedScrap: prev.bankedScrap + TUTORIAL_STIPEND }));
      }
      return;
    }
    const def = TUTORIAL_STEP_DEFS[tutorial.step];
    if (def && def.done(tutorialBaselineRef.current, state, now)) {
      if (tutorial.step + 1 >= TUTORIAL_STEP_DEFS.length) {
        // The MATCH beat is met: graduate in place — the flag
        // clears, done publishes for the chip, the world keeps.
        graduateTutorial();
        return;
      }
      tutorialStepRef.current = tutorial.step + 1;
      tutorialBaselineRef.current = null;
      setTutorial({ active: true, step: tutorial.step + 1, done: false });
    }
  }, [state, tutorial, graduateTutorial]);
  const keys = useRef<Set<string>>(new Set());
  const touchInputs = useRef<{
    thrust: boolean;
    rotateLeft: boolean;
    rotateRight: boolean;
    vac: boolean;
    jettison: boolean;
    jettisonAll: boolean;
    fire: boolean;
    analogStick: { x: number; y: number } | null;
  }>({
    thrust: false,
    rotateLeft: false,
    rotateRight: false,
    vac: false,
    jettison: false,
    jettisonAll: false,
    fire: false,
    analogStick: null,
  });

  // ---------------------------------------------------------------
  // NET SESSION (Phase 2, P2-3b): when `net` carries a room, this
  // loop hosts or guests a multiplayer match (mode gates in the
  // frame loop + the session effects further down). With no room —
  // the solo game — every net branch is inert and the frame runs
  // exactly as shipped. The hook re-creates the session object on
  // every render, so long-lived closures read it through this ref.
  // ---------------------------------------------------------------
  const netRef = useRef<NetSession | null>(null);
  netRef.current = net ?? null;
  /** Room code whose match this loop has initialized (host-built,
   *  guest-applied, or promotion-adopted); null in SP. */
  const mpRoomRef = useRef<string | null>(null);
  /** Last RAW host snapshot applied as a guest — the promotion base
   *  (its seats array is host-oriented; the projection only re-points
   *  the top-level fields). */
  const rawSnapshotRef = useRef<GameState | null>(null);
  const rawSnapshotRoomRef = useRef<string | null>(null);
  const lastSnapshotVersionRef = useRef(0);
  /** True once this client has been promoted from guest to host. */
  const promotedRef = useRef(false);
  /** Host-side: last consumed guest-input seq per seat ownerId. */
  const guestSeqSeenRef = useRef<Map<string, number>>(new Map());
  /** Host-side: per-seat jettison throttle stamps for remote ships
   *  (the local ship's stamp is state.lastEjectTime, as shipped). */
  const remoteEjectAtRef = useRef<Map<string, number>>(new Map());
  /** Guest-side: outgoing input seq + last-sent signature/time. */
  const guestOutSeqRef = useRef(0);
  const guestOutSigRef = useRef('');
  // B2 PER-SEAT ECONOMY (guest half): economy verbs on a guest
  // client queue their NetActionIntent here instead of mutating
  // the projection; the guest send block below drains the queue
  // into the next input payload, and the HOST applies each to
  // the sender's seat through the seat shop (sessionAdapter's
  // consumeEconomyIntents). queueGuestAction returns true when
  // it queued (the caller then does nothing else).
  const guestActionsRef = useRef<NetActionIntent[]>([]);
  const queueGuestAction = (intent: NetActionIntent): boolean => {
    const session = netRef.current;
    if (session?.room && !session.isHost) {
      guestActionsRef.current.push(intent);
      return true;
    }
    return false;
  };
  const guestOutAtRef = useRef(0);
  /** Host-side: frames since match init, for the snapshot cadence. */
  const hostFramesRef = useRef(0);
  /** The room code matchEnded was already announced for. */
  const matchEndSentRef = useRef<string | null>(null);
  /** Host-side stageChanged cursor (P2-4): the highest event-feed
   *  seq already forwarded as a stageChanged relay; null until this
   *  client first hosts (first sight baselines it — history is not
   *  replayed). */
  const stageSeqSentRef = useRef<number | null>(null);
  /** Latest committed state, for the host's snapshot emit (kept out
   *  of the frame updater, which stays side-effect free). */
  const stateRef = useRef<GameState | null>(null);
  stateRef.current = state;

  const setVirtualControl = useCallback((action: 'thrust' | 'rotateLeft' | 'rotateRight' | 'vac' | 'jettison' | 'jettisonAll' | 'fire', active: boolean) => {
    touchInputs.current[action] = active;
  }, []);

  const setAnalogStick = useCallback((stick: { x: number; y: number } | null) => {
    touchInputs.current.analogStick = stick;
  }, []);

  const toggleShop = useCallback((force?: boolean) => {
    setState(prev => {
      const wantOpen = typeof force === 'boolean' ? force : !prev.isShopOpen;
      // SHOP-WELL GATE (Adam's pin, 2026-10-19, via the UI chat): the
      // workshop only OPENS inside the home star's gravity well — it is a
      // dock, not a carried menu. Closing is always allowed. A refused
      // open stamps shopRefusedAt so the HUD can show the fly-home hint.
      if (wantOpen && !prev.isShopOpen && !inTeamWell(prev.seats, prev.ship)) {
        return { ...prev, shopRefusedAt: Date.now() };
      }
      return { ...prev, isShopOpen: wantOpen };
    });
  }, []);

  /**
   * Deploy the Decoy Beacon at the ship's position (KeyX or the HUD pill).
   * One at a time; it lives for its tier's lifetime or until shot down.
   * (The shared-DEPLOY-key shape is the UI chat's proposal being tried in
   * WIP — Adam's lean is that the beacon is the only manual deployable.)
   */
  const deployDecoy = useCallback(() => {
    setState(prev => {
      const tier = prev.ship.loadout.defense === 'decoy_beacon' ? (prev.ship.arsenal['decoy_beacon'] || 0) : 0;
      if (tier <= 0 || prev.decoy) return prev;
      return {
        ...prev,
        decoy: { pos: { ...prev.ship.pos }, health: decoyHealthFor(tier), lifeFrames: decoyLifeFramesFor(tier), ownerId: prev.ship.ownerId },
      };
    });
  }, []);

  const upgrade = useCallback((type: 'thrust' | 'handling' | 'attractor' | 'fuel' | 'cargo') => {
    if (queueGuestAction({ kind: 'buyTrack', track: type })) return;
    setState(prev => {
      const baseCost = type === 'thrust' ? PHYSICS.UPGRADE_COSTS.THRUST : 
                       type === 'handling' ? PHYSICS.UPGRADE_COSTS.HANDLING : 
                       type === 'attractor' ? PHYSICS.UPGRADE_COSTS.ATTRACTOR :
                       type === 'fuel' ? PHYSICS.UPGRADE_COSTS.FUEL :
                       PHYSICS.UPGRADE_COSTS.CARGO;
      
      const currentLevel = type === 'fuel' ? prev.ship.upgrades.fuelCap : (prev.ship.upgrades as any)[type];
      // TRACK CAPS (Phase 3): a track cannot be bought past the ship's
      // line/type cap (src/shipProgression.ts). Peaks-not-locks: caps
      // only refuse MORE of a track, they never remove levels bought.
      const capKey = type === 'attractor' ? 'vac' : type === 'fuel' ? 'fuel' : type;
      if (currentLevel >= capsFor(prev.ship.line, prev.ship.typeTier)[capKey]) return prev;
      const cost = baseCost + (currentLevel * Math.floor(baseCost * 0.5));
      
      const payment = walletPay(prev.ship.carrying, prev.bankedScrap, cost, inTeamWell(prev.seats, prev.ship));
      if (!payment) return prev;

      const next = { ...prev };
      const ship = { ...next.ship };
      ship.carrying = payment.carrying;
      next.bankedScrap = payment.banked;
      const upgradeKey = type === 'fuel' ? 'fuelCap' : type;
      ship.upgrades = { ...ship.upgrades, [upgradeKey]: (ship.upgrades as any)[upgradeKey] + 1 };
      
      if (type === 'attractor') {
        ship.attractRadius = attractRadiusForShip(ship.upgrades.attractor, ship.line, ship.typeTier);
      }
      if (type === 'fuel') {
        ship.maxFuel = 100 + ship.upgrades.fuelCap * 50;
        ship.fuel = ship.maxFuel;
      }

      return { 
        ...next, 
        ship, 
        glitchActive: true, 
        lastGlitchTime: performance.now(),
        lastUpgradeTime: performance.now() 
      };
    });
  }, []);

  // ------------------------------------------------------------------
  // ARSENAL: buy/upgrade an item tier, and equip items into the loadout.
  // Everything is paid from scrap in the cargo hold (ship.carrying),
  // the same wallet as the five base upgrades and star feeding.
  // ------------------------------------------------------------------
  const buyItem = useCallback((itemId: string) => {
    if (queueGuestAction({ kind: 'buyItem', itemId })) return;
    const def = getLoadoutItem(itemId);
    if (!def) return;
    setState(prev => {
      const owned = prev.ship.arsenal[itemId] || 0;
      if (owned >= MAX_ITEM_TIER) return prev;
      // MOUNT ACCESS (Arsenal slice 1): a weapon the current
      // line/tier cannot mount cannot be BOUGHT either — ownership
      // follows mounting (src/loadout.ts MOUNT_ACCESS). Defenses
      // and hybrids are never gated. Silent refusal, like every
      // other gated purchase in this file.
      if (!canMountWeapon(prev.ship.line, prev.ship.typeTier, itemId)) return prev;
      const cost = itemTierCost(def, owned);
      const payment = walletPay(prev.ship.carrying, prev.bankedScrap, cost, inTeamWell(prev.seats, prev.ship));
      if (!payment) return prev;

      const ship = { ...prev.ship };
      ship.carrying = payment.carrying;
      ship.arsenal = { ...ship.arsenal, [itemId]: owned + 1 };
      // First purchase auto-equips ONLY into an empty slot (free: it is
      // part of the purchase). If the slot is taken, the player swaps
      // deliberately and pays the pinned swap cost (see equipItem).
      if (owned === 0 && !ship.loadout[def.category]) {
        ship.loadout = { ...ship.loadout, [def.category]: itemId };
      }
      return { ...prev, ship, bankedScrap: payment.banked, glitchActive: true, lastGlitchTime: performance.now() };
    });
  }, []);

  const equipItem = useCallback((itemId: string) => {
    if (queueGuestAction({ kind: 'equipItem', itemId })) return;
    const def = getLoadoutItem(itemId);
    if (!def) return;
    setState(prev => {
      const owned = prev.ship.arsenal[itemId] || 0;
      if (owned <= 0) return prev; // cannot equip what you do not own
      // MOUNT ACCESS (Arsenal slice 1): nor equip a weapon the
      // current line/tier cannot mount (e.g. after a line switch
      // into a light-only hull). Same silent refusal as the buy.
      if (!canMountWeapon(prev.ship.line, prev.ship.typeTier, itemId)) return prev;
      const slot = def.category;
      const current = prev.ship.loadout[slot];
      if (current === itemId) return prev; // already equipped

      const ship = { ...prev.ship };
      let banked = prev.bankedScrap;
      // Adam's pin: swapping costs 60 + 20 per tier beyond the first,
      // priced on the INCOMING item's tier. Empty slot = free equip.
      // Paid from the combined wallet like every other purchase.
      if (current !== null) {
        const payment = walletPay(prev.ship.carrying, prev.bankedScrap, swapCostForTier(owned), inTeamWell(prev.seats, prev.ship));
        if (!payment) return prev;
        ship.carrying = payment.carrying;
        banked = payment.banked;
      }
      ship.loadout = { ...ship.loadout, [slot]: itemId };
      return { ...prev, ship, bankedScrap: banked, glitchActive: true, lastGlitchTime: performance.now() };
    });
  }, []);

  // ------------------------------------------------------------------
  // FEED vs BANK (Adam's pin, 2026-10-20): where the hold goes is the
  // PLAYER'S CHOICE, made at the dock — the star no longer auto-feeds
  // the hold on a flyby (see the retired delivery block in the frame
  // loop). feedCargo delivers the whole hold to the home star (the
  // same infusion + heal the old flyby ran); depositBank saves it
  // instead. Both live at the dock because both only work in the well.
  // Withdraw is limited by free hold space (capacity incl. overload).
  // WELL RADIUS (P2-4): every inBankWell call in this file passes the
  // star's EFFECTIVE radius (src/sim/starStages.ts), never star.size —
  // at NEUTRON the body collapses but the well follows the un-shrunk
  // growth curve, so the dock doesn't move when the star goes dense.
  // DOCK (TEAMS): the well that counts is any SAME-TEAM star's — see
  // inTeamWell above; deposit/withdraw move the acting seat's OWN
  // bank at any team dock, feedCargo delivers to the dock's star.
  // ------------------------------------------------------------------
  const feedCargo = useCallback(() => {
    if (queueGuestAction({ kind: 'feed' })) return;
    setState(prev => {
      if (prev.ship.carrying <= 0) return prev;
      const amount = prev.ship.carrying;
      // TEAMS cross-feed (Adam's pin: "the team works together to
      // build the star"): the target is the same-team star whose
      // well holds the ship — its own star first (seat order puts
      // the local seat first), else a teammate's. The fed star
      // gains the infusion + heal exactly as a home delivery, and
      // its seat's fedTotal mirror refreshes from the star next
      // frame. teamScrap is the LOCAL seat's counter, so it grows
      // only when the fed star is the local seat's own — the SP /
      // own-dock path below is the shipped return, unchanged.
      const selfId = prev.ship.ownerId;
      const target = prev.seats.find(seat =>
        (seat.ownerId === selfId || areTeammates(prev.seats, selfId, seat.ownerId)) &&
        inBankWell(prev.ship.pos, seat.star.pos, effectiveRadiusForStar(seat.star)));
      if (!target) return prev; // feeding happens at a team dock
      const star = { ...target.star };
      infuseStar(star, amount);
      applyDeliveryHeal(star, amount);
      const ship = { ...prev.ship, carrying: 0 };
      if (target.ownerId === selfId) {
        return { ...prev, ship, star, teamScrap: prev.teamScrap + amount, glitchActive: true, lastGlitchTime: performance.now() };
      }
      const seats = prev.seats.map(seat =>
        seat.ownerId === target.ownerId ? { ...seat, star } : seat);
      return { ...prev, ship, seats, glitchActive: true, lastGlitchTime: performance.now() };
    });
  }, []);

  const depositBank = useCallback(() => {
    if (queueGuestAction({ kind: 'bankDeposit' })) return;
    setState(prev => {
      if (!inTeamWell(prev.seats, prev.ship)) return prev; // banking happens at home
      if (prev.ship.carrying <= 0) return prev;
      const ship = { ...prev.ship, carrying: 0 };
      return { ...prev, ship, bankedScrap: prev.bankedScrap + prev.ship.carrying, glitchActive: true, lastGlitchTime: performance.now() };
    });
  }, []);

  const withdrawBank = useCallback(() => {
    if (queueGuestAction({ kind: 'bankWithdraw' })) return;
    setState(prev => {
      if (!inTeamWell(prev.seats, prev.ship)) return prev; // banking happens at home
      if (prev.bankedScrap <= 0) return prev;
      const regularCapacity = PHYSICS.CARGO.BASE_CAPACITY + prev.ship.upgrades.cargo * PHYSICS.CARGO.UPGRADE_BONUS + typeFor(prev.ship.line, prev.ship.typeTier).cargoBonus;
      const totalCapacity = regularCapacity + Math.floor(regularCapacity * PHYSICS.CARGO.OVERLOAD_RATIO);
      const space = Math.max(0, totalCapacity - prev.ship.carrying);
      const moved = Math.min(space, prev.bankedScrap);
      if (moved <= 0) return prev;
      const ship = { ...prev.ship, carrying: prev.ship.carrying + moved };
      return { ...prev, ship, bankedScrap: prev.bankedScrap - moved, glitchActive: true, lastGlitchTime: performance.now() };
    });
  }, []);

  // ------------------------------------------------------------------
  // SHIP PROGRESSION (Phase 3): types, hull steps, line switches, and
  // drone building. All numbers live in src/shipProgression.ts (DRAFT,
  // Adam's pin pending). Like feedCargo/depositBank, every action here
  // is WELL-GATED — progression is bought at the home dock, never in
  // the field — and pays through the combined wallet (hold, then bank).
  // ------------------------------------------------------------------
  // SELECT WEAPON (CONTROLS.md): keys 1–5 + T (the surface's
  // binding) call this with the slot index. Selection IS an
  // equip — it resolves through the fixed registry order and
  // the owned/installed gates, then runs the ordinary equip
  // verb, swap fee on change included; on a guest the equip
  // verb's own intent path carries it to the host. A press on
  // a greyed cell (unowned, unmountable) selects nothing.
  const selectWeaponSlot = useCallback((slotIndex: number) => {
    const itemId = weaponIdForSelectSlot(stateRef.current.ship, slotIndex);
    if (itemId) equipItem(itemId);
  }, [equipItem]);

  // TARGET LOCKS (CONTROLS.md follow-on): Tab cycles the lock,
  // click/tap sets it — both verbs are thin hands over the one
  // lock law (src/sim/targeting.ts). On a guest they ride the
  // intent channel and the host applies them to the sender's
  // seat; the lock itself rides the ship in state, so every
  // client (and tomorrow the Lightning Lock) reads one truth.
  const cycleTarget = useCallback(() => {
    if (queueGuestAction({ kind: 'cycleTarget' })) return;
    setState(prev => {
      const nextId = nextTargetId(prev.seats, prev.ship);
      if ((prev.ship.targetId ?? null) === nextId) return prev;
      return { ...prev, ship: { ...prev.ship, targetId: nextId ?? undefined } };
    });
  }, []);

  // Set a specific lock (click/tap), or clear it: anything that
  // is not a valid target right now — empty space, a teammate,
  // a cloaked hull, null — clears instead of sticking.
  const setTarget = useCallback((targetOwnerId: string | null) => {
    if (queueGuestAction({ kind: 'setTarget', targetOwnerId: targetOwnerId ?? undefined })) return;
    setState(prev => {
      const nextId = targetOwnerId && isValidTarget(prev.seats, prev.ship, targetOwnerId)
        ? targetOwnerId
        : undefined;
      if (prev.ship.targetId === nextId) return prev;
      return { ...prev, ship: { ...prev.ship, targetId: nextId } };
    });
  }, []);

  const buyType = useCallback((line?: ShipLine) => {
    if (queueGuestAction({ kind: 'buyType', line })) return;
    setState(prev => {
      if (!inTeamWell(prev.seats, prev.ship)) return prev; // types are bought at home
      if (prev.ship.typeTier >= 5) return prev; // top of the ladder (T5 crowns, 2026-10-21)
      // From the SKIFF (T1) the purchase CHOOSES the line; from T2 up it
      // climbs within the line the ship already flies.
      const targetLine = prev.ship.typeTier === 1 ? line : prev.ship.line;
      if (!targetLine) return prev;
      const cost = typeStepPrice(targetLine, prev.ship.typeTier);
      const payment = walletPay(prev.ship.carrying, prev.bankedScrap, cost, inTeamWell(prev.seats, prev.ship));
      if (!payment) return prev;

      const newTier = (prev.ship.typeTier + 1) as TypeTier;
      // THE FORCED SELL (Adam, 2026-10-22; src/switchReconcile.ts):
      // caps grow on a climb WITHIN a line, but choosing a line off
      // the Skiff can SHRINK them (the Skiff fields more drones
      // than a young carrier) — the same sell-down runs, so no
      // hull change ever leaves a holding its hull can't hold.
      const rec = reconcileSwitch(prev.ship, prev.drones, prev.escorts, targetLine, newTier);
      const ship = { ...prev.ship, carrying: payment.carrying, line: targetLine, typeTier: newTier, arsenal: rec.arsenal, loadout: rec.loadout, turretMounts: rec.turretMounts };
      // Hull steps persist (caps only grow with tier, so no clamp is
      // needed); the VAC bonus may have changed with the new type.
      ship.attractRadius = attractRadiusForShip(ship.upgrades.attractor, ship.line, ship.typeTier);
      return {
        ...prev, ship,
        drones: prev.drones
          .filter(d => !rec.soldDroneIds.includes(d.id))
          .map(d => rec.liquidateDroneIds.includes(d.id) ? { ...d, liquidating: true } : d),
        escorts: rec.soldEscortIds.length ? prev.escorts.filter(e => !rec.soldEscortIds.includes(e.id)) : prev.escorts,
        bankedScrap: payment.banked + rec.refund,
        glitchActive: true, lastGlitchTime: performance.now(), lastUpgradeTime: performance.now(),
      };
    });
  }, []);

  const buyHullStep = useCallback(() => {
    if (queueGuestAction({ kind: 'buyHull' })) return;
    setState(prev => {
      if (!inTeamWell(prev.seats, prev.ship)) return prev; // hull work happens at home
      // The type's hullStepCap is the gate: at the cap, growing further
      // REQUIRES a bigger type (Adam's two-ladder rule) — refuse here.
      if (prev.ship.hullSteps >= typeFor(prev.ship.line, prev.ship.typeTier).hullStepCap) return prev;
      const cost = hullStepPrice(prev.ship.hullSteps);
      const payment = walletPay(prev.ship.carrying, prev.bankedScrap, cost, inTeamWell(prev.seats, prev.ship));
      if (!payment) return prev;

      const hullSteps = prev.ship.hullSteps + 1;
      const ship = {
        ...prev.ship,
        carrying: payment.carrying,
        hullSteps,
        size: hullSizeFor(hullSteps),
        // Each step is also +10 max health, and current health follows
        // the delta — the Armor Plating precedent (Slice 6).
        maxHealth: prev.ship.maxHealth + HULL_STEP_HEALTH,
        health: prev.ship.health + HULL_STEP_HEALTH,
      };
      return { ...prev, ship, bankedScrap: payment.banked, glitchActive: true, lastGlitchTime: performance.now(), lastUpgradeTime: performance.now() };
    });
  }, []);

  /**
   * Buy ONE turret mount (Arsenal slice 2, 2026-10-21): mounts fill
   * the current type's autoGuns CAP one purchase at a time, priced
   * off turretMountPriceFor (DRAFT — see shipProgression.ts). At the
   * cap the purchase refuses (the hull carries no more — a deeper
   * type is the way up, the two-ladder rule again). Mounts persist
   * across type/line changes and die with the ship (the fresh
   * starter frame carries none). Workshop work: well-gated like
   * every refit.
   */
  const buyTurretMount = useCallback(() => {
    if (queueGuestAction({ kind: 'buyTurretMount' })) return;
    setState(prev => {
      if (!inTeamWell(prev.seats, prev.ship)) return prev; // mounts are fitted at home
      if (prev.ship.turretMounts >= autoGunCapFor(prev.ship.line, prev.ship.typeTier)) return prev;
      const cost = turretMountPriceFor(prev.ship.turretMounts);
      const payment = walletPay(prev.ship.carrying, prev.bankedScrap, cost, inTeamWell(prev.seats, prev.ship));
      if (!payment) return prev;
      const ship = { ...prev.ship, carrying: payment.carrying, turretMounts: prev.ship.turretMounts + 1 };
      return { ...prev, ship, bankedScrap: payment.banked, glitchActive: true, lastGlitchTime: performance.now(), lastUpgradeTime: performance.now() };
    });
  }, []);

  const switchLine = useCallback((line: ShipLine) => {
    if (queueGuestAction({ kind: 'switchLine', line })) return;
    setState(prev => {
      if (!inTeamWell(prev.seats, prev.ship)) return prev; // refits happen at home
      if (prev.ship.typeTier < 2 || !prev.ship.line || line === prev.ship.line) return prev;
      const toll = switchToll(prev.ship);
      const payment = walletPay(prev.ship.carrying, prev.bankedScrap, toll, inTeamWell(prev.seats, prev.ship));
      if (!payment) return prev;

      // Tier, hull steps, track levels, and cargo all ride across —
      // only the line (and therefore the caps, peaks, and capability
      // amounts) changes. If hullSteps exceeds the new line/type's cap,
      // the steps STAY; the cap only refuses buying more (same rule as
      // track caps). The VAC bonus follows the new line immediately.
      // THE FORCED SELL (Adam, 2026-10-22; src/switchReconcile.ts):
      // holdings the new hull cannot hold SELL at full price into
      // the bank — weapons it can't mount, drones/mounts/escorts
      // over its caps. Slice 4's shelve is superseded for
      // property; it survives only in the debug jump.
      const rec = reconcileSwitch(prev.ship, prev.drones, prev.escorts, line, prev.ship.typeTier);
      const ship = { ...prev.ship, carrying: payment.carrying, line, lineSwitchesUsed: prev.ship.lineSwitchesUsed + 1, arsenal: rec.arsenal, loadout: rec.loadout, turretMounts: rec.turretMounts };
      ship.attractRadius = attractRadiusForShip(ship.upgrades.attractor, ship.line, ship.typeTier);
      return {
        ...prev, ship,
        drones: prev.drones
          .filter(d => !rec.soldDroneIds.includes(d.id))
          .map(d => rec.liquidateDroneIds.includes(d.id) ? { ...d, liquidating: true } : d),
        escorts: rec.soldEscortIds.length ? prev.escorts.filter(e => !rec.soldEscortIds.includes(e.id)) : prev.escorts,
        bankedScrap: payment.banked + rec.refund,
        glitchActive: true, lastGlitchTime: performance.now(), lastUpgradeTime: performance.now(),
      };
    });
  }, []);

  // =====================================================================
  // DEBUG KIT (Adam's tester kit, 2026-10-21) — see src/debug.ts for
  // the arming contract. EVERY action below carries the same double
  // guard: the kit must be ARMED (?debug=1) AND this client must not
  // be in a networked room (host or guest — netRef.current.room is
  // the loop's networked signal). A refused call changes nothing.
  // The SysCfg DEV section (UI's surface) renders only when armed
  // and calls exactly these three hooks.
  // =====================================================================

  /** GRANT SCRAP: top up the bank (the wallet every purchase reads). */
  const debugGrantScrap = useCallback((amount: number) => {
    if (!DEBUG_ARMED || netRef.current?.room) return;
    if (!(amount > 0)) return;
    setState(prev => ({ ...prev, bankedScrap: prev.bankedScrap + amount }));
  }, []);

  /**
   * GRANT FED: infuse the home star on demand — the same infusion a
   * delivery runs (milestones, mass, size all follow through the
   * growth functions; the per-frame reconciliation walks the stages
   * and turret ladder from there). The star's own growth record is
   * what grows; teamScrap (the seat's hand-fed counter) is untouched
   * — no hands did this feeding.
   */
  const debugGrantFed = useCallback((amount: number) => {
    if (!DEBUG_ARMED || netRef.current?.room) return;
    if (!(amount > 0)) return;
    setState(prev => {
      const star = { ...prev.star };
      infuseStar(star, amount);
      return { ...prev, star, glitchActive: true, lastGlitchTime: performance.now() };
    });
  }, []);

  /**
   * LINE/TIER JUMP: sit in any hull instantly. The derivation is
   * buyType's, minus the toll and the well: line + tier set, the
   * VAC bonus follows via attractRadius, and the equipped weapon
   * rides through mountableLoadout — jumping into a light-only hull
   * SHELVES a heavy weapon (slice 4's law, no debug exception).
   * Tier 1 is the SKIFF: line clears to unaligned. Hull steps, track
   * levels, cargo and the bank all ride — the jump exercises the
   * TABLES at the destination, not a fresh frame.
   */
  const debugJumpTo = useCallback((line: ShipLine | null, tier: TypeTier) => {
    if (!DEBUG_ARMED || netRef.current?.room) return;
    setState(prev => {
      const targetLine = tier === 1 ? null : line;
      if (targetLine === prev.ship.line && tier === prev.ship.typeTier) return prev;
      const ship = {
        ...prev.ship,
        line: targetLine,
        typeTier: tier,
        loadout: mountableLoadout(targetLine, tier, prev.ship.loadout),
      };
      ship.attractRadius = attractRadiusForShip(ship.upgrades.attractor, ship.line, ship.typeTier);
      return { ...prev, ship, glitchActive: true, lastGlitchTime: performance.now(), lastUpgradeTime: performance.now() };
    });
  }, []);

  /**
   * Build one player drone (DRONE_PRICE, DRAFT — see shipProgression.ts).
   * This is also the REPLACEMENT path: a drone shot down is gone, and
   * the player rebuilds it here, up to the line/type's dronesFielded.
   */
  const buildDrone = useCallback(() => {
    if (queueGuestAction({ kind: 'buildDrone' })) return;
    setState(prev => {
      if (!inTeamWell(prev.seats, prev.ship)) return prev; // drones are built at home
      // Harvesters only (Arsenal slice 3): defense-mode drones are
      // a separate complement and never eat workforce slots.
      // (Liquidating drones don't hold slots either — they are
      // sold and flying their last trip; the replacement may be
      // built while they are still on the road.)
      const fielded = prev.drones.filter(d => d.owner === 'player' && d.mode !== 'defense' && !d.starFleet && !d.liquidating).length;
      if (fielded >= typeFor(prev.ship.line, prev.ship.typeTier).dronesFielded) return prev;
      const payment = walletPay(prev.ship.carrying, prev.bankedScrap, DRONE_PRICE, inTeamWell(prev.seats, prev.ship));
      if (!payment) return prev;

      const ship = { ...prev.ship, carrying: payment.carrying };
      const drone = {
        id: 'player-drone-' + Math.random().toString(36).substr(2, 9),
        pos: { x: prev.star.pos.x + 100, y: prev.star.pos.y + 100 },
        vel: { x: 0, y: 0 },
        angle: 0,
        targetId: null,
        carrying: 0,
        // Drone quality (Arsenal slice 3): carry capacity is
        // stamped at build from the builder's current type.
        capacity: PHYSICS.DRONES.CAPACITY + typeFor(prev.ship.line, prev.ship.typeTier).droneCarryBonus,
        owner: 'player' as const,
        ownerId: prev.ship.ownerId,
        state: 'searching' as const,
        health: DRONE_MAX_HEALTH,
      };
      return { ...prev, ship, bankedScrap: payment.banked, drones: [...prev.drones, drone], glitchActive: true, lastGlitchTime: performance.now(), lastUpgradeTime: performance.now() };
    });
  }, []);

  /**
   * REPURCHASE (Phase 2, P2-5, death economy): buy a dead seat a
   * fresh starter frame from its bank (src/sim/deathEconomy.ts —
   * the price is 20% of the seat's current bank, stepped down 15%
   * per prior death, and free at a zero bank). The UI lane's
   * repurchase screen wires to this exact callback:
   * repurchaseShip(ownerId).
   *
   * HOST / SOLO ONLY: a guest's state is a projection of the
   * host's snapshots, so a guest calling this would mutate a
   * projection the next snapshot overwrites — the guest's screen
   * instead sends the { kind: 'repurchase' } action intent, and
   * the HOST applies it to the sender's seat in the frame (via
   * the session adapter's consumeRepurchaseIntent — the same
   * tryRepurchase, so a repurchase is a repurchase regardless of
   * whose finger sent it). On a guest client this callback stays
   * a no-op. In single-player it is likewise inert:
   * SP seats are never death-economy shipless (the local death is
   * game over; the enemy seat never flew) and tryRepurchase
   * refuses them.
   */
  /**
   * Build ONE defense drone (Arsenal slice 3, 2026-10-21 — Adam's
   * hauler pair): a drone in defense MODE (see sim/drones.ts) that
   * guards the ship/star and never harvests. Capped by the current
   * type's defenseDrones (the hauler's pair completes at T3; other
   * lines field none in this slice). DEFENSE_DRONE_PRICE (DRAFT).
   * A lost guard is rebuilt here, like a lost harvester.
   */
  const buildDefenseDrone = useCallback(() => {
    if (queueGuestAction({ kind: 'buildDefenseDrone' })) return;
    setState(prev => {
      if (!inTeamWell(prev.seats, prev.ship)) return prev; // drones are built at home
      const fielded = prev.drones.filter(d => d.owner === 'player' && d.mode === 'defense').length;
      if (fielded >= typeFor(prev.ship.line, prev.ship.typeTier).defenseDrones) return prev;
      const payment = walletPay(prev.ship.carrying, prev.bankedScrap, DEFENSE_DRONE_PRICE, inTeamWell(prev.seats, prev.ship));
      if (!payment) return prev;

      const ship = { ...prev.ship, carrying: payment.carrying };
      const drone = {
        id: 'player-drone-' + Math.random().toString(36).substr(2, 9),
        pos: { x: prev.ship.pos.x + 40, y: prev.ship.pos.y + 40 },
        vel: { x: 0, y: 0 },
        angle: 0,
        targetId: null,
        carrying: 0,
        capacity: 0, // guards carry nothing; the mode branch never harvests
        owner: 'player' as const,
        ownerId: prev.ship.ownerId,
        state: 'searching' as const,
        mode: 'defense' as const,
        health: DRONE_MAX_HEALTH,
      };
      return { ...prev, ship, bankedScrap: payment.banked, drones: [...prev.drones, drone], glitchActive: true, lastGlitchTime: performance.now(), lastUpgradeTime: performance.now() };
    });
  }, []);

  /**
   * WORKFORCE ORDERS (Adam, 2026-10-22): set the captain's standing
   * delivery order for her workforce — 'feed' or 'deposit' (see
   * SeatSimState.deliveryMode). The order is the HAULER line's
   * crown capability in v1 (canOrderWorkforce); any other hull's
   * call is refused silently, like the arsenal's mount gates. The
   * standing order persists on the seat across line switches, but
   * the delivery read binds it only while she flies a hauler —
   * shelved, never stripped (the game's standing law for line
   * capabilities). The mode lives on the seat record, so it syncs
   * as seat state; a
   * GUEST captain's switch-throwing rides the per-seat economy
   * follow-on with the other guest economy verbs — this verb is
   * the local/host path, and the B2 bot policy will set the same
   * field for bot haulers.
   */
  /**
   * SCRAP HEALING (RULED, src/sim/repair.ts): the captain's
   * repair toggle — DEFAULT ON; this verb is the opt-out (and
   * the way back). While the mode stands, the loop's frame tick
   * converts the ship's hold scrap into hull up to its cap.
   */
  const setRepairing = useCallback((on: boolean) => {
    if (queueGuestAction({ kind: 'setRepairing', on })) return;
    setState(prev => ({ ...prev, ship: { ...prev.ship, repairing: on } }));
  }, []);

  /**
   * ALLY DOCKING verbs (src/sim/harbor.ts): berth at an allied
   * harbor in reach (canDockAt is the one gate — teammates,
   * hosting line, open harbor, capacity), leave a berth, work
   * your own HARBOR switch, or undock one of your guests
   * (gently — they keep their current health; the pass spills
   * the rest when a harbor closes or a host dies).
   */
  const dockToHost = useCallback((hostOwnerId: string) => {
    if (queueGuestAction({ kind: 'dockToHost', hostOwnerId })) return;
    setState(prev => {
      const hostSeat = prev.seats.find(s => s.ownerId === hostOwnerId);
      const host = hostSeat?.ship;
      if (!host || prev.ship.dockedTo) return prev;
      if (!canDockAt(prev.seats, prev.ship, host)) return prev;
      const d = Math.hypot(prev.ship.pos.x - host.pos.x, prev.ship.pos.y - host.pos.y);
      if (d > host.size + HARBOR_DOCK_RANGE) return prev;
      return { ...prev, ship: { ...prev.ship, dockedTo: hostOwnerId } };
    });
  }, []);

  const undock = useCallback(() => {
    if (queueGuestAction({ kind: 'undock' })) return;
    setState(prev => (prev.ship.dockedTo
      ? { ...prev, ship: { ...prev.ship, dockedTo: undefined } }
      : prev));
  }, []);

  const setHarborOpen = useCallback((open: boolean) => {
    if (queueGuestAction({ kind: 'setHarborOpen', open })) return;
    setState(prev => ({ ...prev, ship: { ...prev.ship, harborOpen: open } }));
  }, []);

  const undockGuest = useCallback((guestOwnerId: string) => {
    if (queueGuestAction({ kind: 'undockGuest', guestOwnerId })) return;
    setState(prev => {
      const seats = prev.seats.map(seat => {
        const gs = seat.ship;
        if (!gs || seat.ownerId !== guestOwnerId || gs.dockedTo !== prev.ship.ownerId) return seat;
        return { ...seat, ship: { ...gs, dockedTo: undefined } };
      });
      return { ...prev, seats };
    });
  }, []);

  const setDeliveryMode = useCallback((mode: 'feed' | 'deposit') => {
    if (queueGuestAction({ kind: 'setDeliveryMode', mode })) return;
    setState(prev => {
      if (!canOrderWorkforce(prev.ship.line)) return prev;
      const seats = prev.seats.map(seat =>
        seat.ownerId === prev.ship.ownerId ? { ...seat, deliveryMode: mode } : seat);
      return { ...prev, seats };
    });
  }, []);

  /**
   * Build ONE carrier-wing escort (Arsenal slice 5b, 2026-10-21):
   * a real little ship of the given kind, built at the well like a
   * drone and rebuilt the same way when lost. The CURRENT type's
   * escortWing composition is the cap (the wing belongs to the
   * drone line — other hulls field none); the wing itself is a
   * seat asset that persists through the carrier's death and any
   * line change, like her drones. The escort flies its kind's hull
   * from the tables (line/tier stamped at build) with a bolt
   * cannon at its class's tier; src/sim/escorts.ts flies it.
   * Prices are the kind defs' DRAFT figures.
   */
  const buildEscort = useCallback((kind: EscortKind) => {
    if (queueGuestAction({ kind: 'buildEscort', escortKind: kind })) return;
    setState(prev => {
      if (!inTeamWell(prev.seats, prev.ship)) return prev; // escorts are built at home
      const def = ESCORT_KIND_DEFS[kind];
      const fielded = prev.escorts.filter(e => e.ownerId === prev.ship.ownerId && escortKindOf(e) === kind).length;
      if (fielded >= escortCapFor(prev.ship.line, prev.ship.typeTier, kind)) return prev;
      const payment = walletPay(prev.ship.carrying, prev.bankedScrap, def.price, inTeamWell(prev.seats, prev.ship));
      if (!payment) return prev;

      const ship = { ...prev.ship, carrying: payment.carrying };
      const escort = {
        ...createStarterShip(prev.ship.ownerId, { x: prev.ship.pos.x + 50, y: prev.ship.pos.y + 50 }, { withStarterWeapon: true }),
        // The starter frame's id names its seat — every escort of
        // the wing needs its OWN (projectile pierce dedupes by id).
        id: 'escort-' + Math.random().toString(36).substr(2, 9),
        line: def.line,
        typeTier: def.typeTier,
        arsenal: { bolt_cannon: def.typeTier },
      };
      return { ...prev, ship, bankedScrap: payment.banked, escorts: [...prev.escorts, escort], glitchActive: true, lastGlitchTime: performance.now(), lastUpgradeTime: performance.now() };
    });
  }, []);

  const repurchaseShip = useCallback((ownerId: string) => {
    const session = netRef.current;
    if (session?.room && !session.isHost) {
      // B2 follow-on: the guest's repurchase rides the same
      // intent channel as every other economy verb — the host
      // applies it to the SENDER's seat, so queue only when the
      // seat is the guest's own.
      if (ownerId === session.mySeat?.ownerId) guestActionsRef.current.push({ kind: 'repurchase' });
      return;
    }
    setState(prev => {
      if (prev.matchEnd) return prev;
      const idx = prev.seats.findIndex(s => s.ownerId === ownerId);
      if (idx < 0) return prev;
      const seat: SeatSimState = { ...prev.seats[idx] };
      const bought = tryRepurchase(seat, performance.now());
      if (!bought) return prev;
      const seats = prev.seats.map((s, i) => (i === idx ? seat : s));
      const eventFeed = appendEventRecords(prev.eventFeed, [
        {
          type: 'repurchase',
          ownerId: seat.ownerId,
          starId: starIdForSeat(seat.starIndex),
          cost: bought.cost,
          deaths: seat.deaths,
          at: performance.now(),
        },
      ]);
      // The local seat's view IS the top level: its new frame and
      // its post-payment bank land there too (the seat record and
      // the top level hold the same objects, per the projection
      // law) so the next frame's rebuild picks the ship up as the
      // local seat's own.
      if (ownerId === prev.ship.ownerId) {
        return {
          ...prev,
          seats,
          eventFeed,
          // A PAID buy-back serves its death-tax wait first: the
          // seat record carries the pending arrival and the top
          // level keeps the wreck stand-in until the frame lands.
          // The free floor's ship arrives in bought.ship at once.
          ship: bought.ship ?? prev.ship,
          bankedScrap: seat.bankedScrap,
        };
      }
      return { ...prev, seats, eventFeed };
    });
  }, []);

  const toggleGauges = useCallback(() => {
    setState(prev => ({ ...prev, useAnalogGauges: !prev.useAnalogGauges }));
  }, []);

  const restart = useCallback(() => {
    reloadPage(); // Simple for now as we don't have a complex state machine yet
  }, []);

  const spawnScrap = useCallback((center: Vector2D, radius: number = 100) => {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * radius;
    const spawnPos = {
      x: center.x + Math.cos(angle) * r,
      y: center.y + Math.sin(angle) * r,
    };
    
    return {
      pos: spawnPos,
      color: COLORS.SCRAP[Math.floor(Math.random() * COLORS.SCRAP.length)],
      id: Math.random().toString(36).substr(2, 9),
    };
  }, []);

  // OPENING SCRAP FIELD: 15 veins scattered around a center. SP
  // seeds it around the viewport center (the effect below); a hosted
  // match seeds the same field around the arena center (0,0 in match
  // coordinates, the session effects further down) so the first
  // snapshot carries the field. One builder, two centers — the SP
  // call passes the shipped center and consumes the shipped
  // Math.random sequence.
  const buildScrapField = (center: Vector2D): Scrap[] => {
    const field: Scrap[] = [];

    // Spawn several "Veins" or Belts
    for (let v = 0; v < 15; v++) {
      const vAngle = Math.random() * Math.PI * 2;
      const vDist = 500 + Math.random() * 4000;
      const vCenter = {
        x: center.x + Math.cos(vAngle) * vDist,
        y: center.y + Math.sin(vAngle) * vDist,
      };

      // Some rare large clusters, mostly smaller pockets
      const rand = Math.random();
      let pocketCount = 1;
      if (rand > 0.92) pocketCount = 12 + Math.floor(Math.random() * 15);
      else if (rand > 0.7) pocketCount = 4 + Math.floor(Math.random() * 6);
      else if (rand > 0.3) pocketCount = 2 + Math.floor(Math.random() * 2);

      for (let i = 0; i < pocketCount; i++) {
        field.push(spawnScrap(vCenter, pocketCount * 12));
      }
    }
    return field;
  };

  // Initial scrap
  useEffect(() => {
    // NET GUARD (P2-3b): in a room — or once a match has been
    // initialized — the field belongs to the match, not SP seeding.
    if (netRef.current?.room || mpRoomRef.current) return;
    // SOLO SAVE: a resumed match keeps its own field, drones and
    // star anchor — the seeding below is for fresh games only.
    if (bootSaveRef.current) return;
    const initialScrap = buildScrapField({ x: width / 2, y: height / 2 });

    setState(s => {
      // The star is re-anchored to the viewport center (the position
      // it already holds by construction); the seat projection is
      // re-pointed at the SAME new star object so seats[0].star stays
      // reference-identical to the top-level star.
      const anchoredStar: Star = { ...s.star, pos: { x: width / 2, y: height / 2 } };
      return {
      ...s,
      scrap: initialScrap,
      drones: [
        {
          id: 'player-drone-1',
          pos: { x: width / 2 + 100, y: height / 2 + 100 },
          vel: { x: 0, y: 0 },
          angle: 0,
          targetId: null,
          carrying: 0,
          capacity: PHYSICS.DRONES.CAPACITY,
          owner: 'player',
          ownerId: s.star.ownerId,
          state: 'searching',
          health: DRONE_MAX_HEALTH
        },
        {
          id: 'enemy-drone-1',
          pos: { x: s.enemyStar.pos.x - 100, y: s.enemyStar.pos.y - 100 },
          vel: { x: 0, y: 0 },
          angle: 0,
          targetId: null,
          carrying: 0,
          capacity: PHYSICS.DRONES.CAPACITY,
          owner: 'enemy',
          ownerId: s.enemyStar.ownerId,
          state: 'searching',
          health: DRONE_MAX_HEALTH
        }
      ],
      star: anchoredStar,
      seats: s.seats.map(seat =>
        seat.starIndex === 0 ? { ...seat, star: anchoredStar, ship: s.ship } : seat,
      ),
      };
    });
  }, [width, height, spawnScrap]);

  // SOLO SAVE — WRITE SIDE (Adam, 2026-10-23): while a solo match
  // runs, persist it every 15 s and again as the page hides or the
  // tab closes; when the match ends, the save clears so the next
  // load starts fresh. Rooms never touch it (the guards), and the
  // sanitizer in src/soloSave.ts decides what rides.
  useEffect(() => {
    const flush = () => {
      const s = stateRef.current;
      if (!s || netRef.current?.room || mpRoomRef.current) return;
      if (tutorialActiveRef.current) return; // a tutorial flight never saves
      saveSoloGame(s);
    };
    const timer = window.setInterval(flush, 15000);
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, []);
  // REFRESH GUARD (Adam, 2026-10-24): an accidental refresh, back
  // tap, or tab close mid-match kills the game, so while a match is
  // live the browser gets its leave-site confirmation. The wording
  // is the browser's, not ours; confirming still refreshes, so a
  // deliberate refresh always works. Armed only while a match is on
  // the field — a live/cinematic room, or a solo match not yet
  // ended (tutorial flights included) — never in the lobby or on
  // menus, where there is nothing to lose. The game's own reloads
  // set intentionalReloadRef first and never trip it.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (intentionalReloadRef.current) return;
      const roomPhase = netRef.current?.room?.phase;
      const matchLive = roomPhase
        ? roomPhase === 'live' || roomPhase === 'cinematic'
        : !!(stateRef.current && !stateRef.current.matchEnd);
      if (!matchLive) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
  useEffect(() => {
    if (state.matchEnd && !netRef.current?.room) clearSoloGame();
  }, [state.matchEnd]);

  // HOST MATCH INIT + MIGRATION PROMOTION (P2-3b): this client is
  // the host of a live room and no match is running yet → build it.
  // Normal path: createMatch from the room (seed, star count, seat
  // occupants), the opening field seeded around the arena center,
  // the top level re-anchored to MY seat (projectStateForViewer),
  // and one snapshot emitted immediately so guests see the field.
  // Promotion path: this client was a GUEST in this room and the DO
  // just elected it host — the contract says promote, never rebuild.
  // The state the guest already holds is the projection of the raw
  // snapshot, its seats array is the raw (host-oriented) one, and
  // the frame projection re-points top-level fields by ownerId, so
  // hosting resumes from that state as-is; only the cadence restarts
  // and a fresh snapshot goes out under the new host.
  useEffect(() => {
    const session = net;
    if (!session?.room || !session.isHost) return;
    const room = session.room;
    if (room.phase !== 'live' && room.phase !== 'cinematic') return;
    if (mpRoomRef.current === room.code) return;
    const myOwnerId = session.mySeat?.ownerId;
    if (!myOwnerId) return;
    mpRoomRef.current = room.code;
    hostFramesRef.current = 0;
    if (rawSnapshotRoomRef.current === room.code && rawSnapshotRef.current) {
      promotedRef.current = true;
      // Stage-announce cursor baselines at the adopted snapshot's
      // feed tail: crossings the old host already relayed are not
      // re-announced under the new host (P2-4).
      const adoptedFeed = rawSnapshotRef.current.eventFeed;
      stageSeqSentRef.current =
        adoptedFeed.length > 0 ? adoptedFeed[adoptedFeed.length - 1].seq : 0;
      session.sendSnapshot(projectStateForViewer(rawSnapshotRef.current, myOwnerId));
      return;
    }
    stageSeqSentRef.current = 0; // fresh match: the feed starts empty
    const match = createMatch({
      seed: room.seed,
      starCount: room.starCount,
      // TEAMS: the room seats carry the DO-resolved teams (lobby
      // picks as settled at match start) into the sim seats.
      seats: room.seats.map(s => ({ ownerId: s.ownerId, controller: s.occupant.kind, teamId: s.teamId })),
    });
    match.scrap = buildScrapField({ x: 0, y: 0 });
    const mine = projectStateForViewer(match, myOwnerId);
    setState(mine);
    session.sendSnapshot(mine);
  }, [net]);

  // GUEST SNAPSHOT APPLY (P2-3b): a guest never simulates — each new
  // snapshot version replaces local state with the viewer projection
  // of the host's state. The RAW snapshot is kept verbatim: it is
  // the promotion base if the DO elects this client host mid-match.
  useEffect(() => {
    const session = net;
    if (!session?.room || session.isHost) return;
    if (session.snapshotVersion === lastSnapshotVersionRef.current) return;
    lastSnapshotVersionRef.current = session.snapshotVersion;
    const raw = session.snapshotRef.current as GameState | null;
    if (!raw || !Array.isArray(raw.seats)) return;
    rawSnapshotRef.current = raw;
    rawSnapshotRoomRef.current = session.room.code;
    mpRoomRef.current = session.room.code;
    const myOwnerId = session.mySeat?.ownerId;
    if (!myOwnerId) return;
    setState(projectStateForViewer(raw, myOwnerId));
  }, [net]);

  // Leaving a room retires the match bookkeeping. Whatever state the
  // loop holds simply plays on as a solo sandbox (v1: no attempt is
  // made to restore a pre-room SP state).
  useEffect(() => {
    if (net?.room) return;
    mpRoomRef.current = null;
    rawSnapshotRef.current = null;
    rawSnapshotRoomRef.current = null;
    promotedRef.current = false;
    matchEndSentRef.current = null;
    stageSeqSentRef.current = null;
    guestSeqSeenRef.current.clear();
    remoteEjectAtRef.current.clear();
  }, [net?.room]);

  // MATCH END ANNOUNCE (P2-3b; cinematic fields from state since
  // P2-4): the protocol defines matchEnded as a host-authored client
  // message the DO relays verbatim — when the host sim records the
  // end, announce it once per room, built from state.matchEnd + the
  // final standings. The cinematic bookkeeping (collapsing star,
  // epoch start, lockout) is stamped on the record at derivation
  // (src/sim/seatState.ts) and read from there; the fallbacks below
  // only cover a record adopted from a pre-P2-4 snapshot (a promoted
  // host resuming an older host's match). Per the contract:
  // critical-mass ends lock input and name the collapsing star (the
  // winner's) with the cinematic start; last-survivor ends go
  // straight to results with no lockout. (Guests ALSO see matchEnd
  // inside snapshots; this wire event is what flips their shell.)
  useEffect(() => {
    const session = netRef.current;
    if (!session?.room || !session.isHost) return;
    const end = state.matchEnd;
    if (!end) return;
    if (matchEndSentRef.current === session.room.code) return;
    matchEndSentRef.current = session.room.code;
    const winnerSeat = state.seats.find(s => s.ownerId === end.winnerOwnerId);
    const critical = end.endReason === 'critical_mass';
    session.sendHostMessage({
      type: 'matchEnded',
      endReason: end.endReason,
      winnerOwnerId: end.winnerOwnerId,
      winnerSeat: winnerSeat?.starIndex ?? 0,
      ...(critical
        ? {
            collapsingStarId:
              end.collapsingStarId ?? `star-${winnerSeat?.starIndex ?? 0}`,
            cinematicStartedAt: end.cinematicStartedAt ?? Date.now(),
          }
        : {}),
      inputLockout: end.inputLockout ?? critical,
      standings: state.standings,
    });
  }, [state.matchEnd, state.seats, state.standings]);

  // STAGE CHANGE ANNOUNCE (P2-4): the host authors the protocol's
  // stageChanged relays from the sim's own feed records —
  // advanceSeatTracking appends a stage_change record exactly once
  // per star per band crossing (fed only grows, so crossings are
  // upward and single), and this effect forwards each unannounced
  // one, in seq order. First sight while hosting only baselines the
  // cursor (set at host init / promotion; the null case here is the
  // belt-and-braces) — history is never replayed.
  useEffect(() => {
    const session = netRef.current;
    if (!session?.room || !session.isHost) return;
    const feed = state.eventFeed;
    if (stageSeqSentRef.current === null) {
      stageSeqSentRef.current =
        feed.length > 0 ? feed[feed.length - 1].seq : 0;
      return;
    }
    for (const rec of feed) {
      if (rec.seq <= stageSeqSentRef.current) continue;
      stageSeqSentRef.current = rec.seq;
      if (rec.type === 'stage_change') {
        session.sendHostMessage({
          type: 'stageChanged',
          starId: rec.starId,
          ownerId: rec.ownerId,
          stage: rec.toStage,
          progressWithinStage: rec.progressWithinStage,
          milestone: rec.milestone,
        });
      }
    }
  }, [state.eventFeed]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // TEXT-FIELD SEAL (chat surface, 2026-10-21): while the player
      // is typing — the chat composer, the lobby's fields — a
      // keystroke is text, not flight: it never enters the held-keys
      // set and no hotkey fires. KeyUP is deliberately NOT sealed:
      // releasing a key over a field must still clear it from the
      // set, or a key held while clicking into the composer sticks.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      keys.current.add(e.code);
      
      // THE SETTLED KEY MAP (Adam, 2026-10-22; CONTROLS.md is
      // the spec of record): digits SELECT weapons in the fixed
      // registry order (selection IS an equip — swap fee on
      // change); the same digits SHIFTED buy the standard
      // upgrade tracks (Shift is the buying layer). T is the
      // sixth weapon's only key. E deploys the item (X is
      // retired); R toggles Damage Control; U alone works the
      // workshop — Tab's toggle duty retired with its
      // reassignment to TARGET CYCLE — the lock state has since
      // landed (ship.targetId; the sim validates and clears it),
      // so Tab cycles it below. SPACE
      // IS NEVER FIRE: it is the scrap key (jettison), owned by
      // the adapter; this handler must never claim it.
      const slotDigits = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
      const slotIdx = slotDigits.indexOf(e.code);
      if (slotIdx >= 0) {
        if (e.shiftKey) {
          const tracks = ['thrust', 'handling', 'attractor', 'fuel', 'cargo'] as const;
          upgrade(tracks[slotIdx]);
        } else {
          selectWeaponSlot(slotIdx);
        }
      }
      if (e.code === 'KeyT') selectWeaponSlot(5);
      if (e.code === 'KeyG') toggleGauges();
      if (e.code === 'KeyE') deployDecoy();
      if (e.code === 'KeyR') setRepairing(stateRef.current.ship.repairing === false);
      if (e.code === 'Tab') { e.preventDefault(); cycleTarget(); }
      if (e.code === 'KeyU') {
        setState(prev => {
          // Same shop-well gate as toggleShop (Adam's pin, 2026-10-19).
          if (!prev.isShopOpen && !inTeamWell(prev.seats, prev.ship)) {
            return { ...prev, shopRefusedAt: Date.now() };
          }
          return { ...prev, isShopOpen: !prev.isShopOpen };
        });
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    // STUCK-KEY GUARD (Adam, 2026-10-21): alt-tab out mid-thrust and
    // the keyup lands in the other app — the Set never hears it, and
    // the ship flies itself on return, hard to recapture. Losing the
    // window (blur, or the tab going hidden) now releases EVERY held
    // input at the source, keyboard and touch alike: controls sit
    // inactive until the player is back and presses fresh. A key
    // still physically held on return stays released until it is
    // re-pressed — that is the point of the rule.
    const releaseAllInputs = () => {
      keys.current.clear();
      touchInputs.current.thrust = false;
      touchInputs.current.rotateLeft = false;
      touchInputs.current.rotateRight = false;
      touchInputs.current.vac = false;
      touchInputs.current.jettison = false;
      touchInputs.current.fire = false;
      touchInputs.current.analogStick = null;
    };
    const onVisibility = () => { if (document.hidden) releaseAllInputs(); };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', releaseAllInputs);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', releaseAllInputs);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [upgrade, deployDecoy, selectWeaponSlot, setRepairing, toggleGauges, cycleTarget]);

  useEffect(() => {
    let frameId: number;
    let prevFrameTime: number | null = null;
    const loop = (time: number) => {
      // Frame delta for the survival ledger (death-tax decay).
      // Clamped: a hidden tab or a long hitch must not bank
      // survival the player never lived. Guests return early
      // below — their seats' ledgers accrue on the HOST and ride
      // the snapshots, like every other seat fact.
      const frameDtMs =
        prevFrameTime === null
          ? 0
          : Math.min(250, Math.max(0, time - prevFrameTime));
      prevFrameTime = time;
      // NET MODE GATES (P2-3b). Solo (no room): both gates are inert
      // and the frame below runs exactly as shipped.
      const frameSession = netRef.current;
      const frameRoom = frameSession?.room ?? null;
      if (frameSession && frameRoom && !frameSession.isHost && frameRoom.phase !== 'lobby') {
        // GUEST: the sim does NOT run locally — state arrives via
        // snapshots (the apply effect above). This frame only
        // captures + relays input from the same refs the SP input
        // phase reads: on change, plus a ~100 ms heartbeat so the
        // host always holds a fresh frame. (No brake source exists
        // in the SP input set; the field rides as false.)
        const input = localShipInput(keys.current, touchInputs.current);
        const fields = {
          thrust: input.wantsThrust,
          left: input.rotateLeft,
          right: input.rotateRight,
          brake: false,
          fire: input.wantsFire,
          jettison: input.wantsJettison,
          jettisonAll: input.wantsJettisonAll,
          vac: input.vac,
          stick: input.stick,
        };
        const sig = JSON.stringify(fields);
        if (sig !== guestOutSigRef.current || time - guestOutAtRef.current >= 100 || guestActionsRef.current.length > 0) {
          guestOutSigRef.current = sig;
          guestOutAtRef.current = time;
          guestOutSeqRef.current += 1;
          const pendingActions = guestActionsRef.current.splice(0);
          frameSession.sendInput({ seq: guestOutSeqRef.current, ...fields, ...(pendingActions.length ? { actions: pendingActions } : {}) });
        }
        frameId = requestAnimationFrame(loop);
        return;
      }
      if (
        frameSession && frameRoom && frameSession.isHost &&
        mpRoomRef.current === frameRoom.code &&
        (frameRoom.phase === 'live' || frameRoom.phase === 'cinematic')
      ) {
        // HOST SNAPSHOT EMIT: one full-state snapshot every
        // SNAPSHOT_EVERY_FRAMES frames (12 Hz at 60 fps). Emitted
        // from stateRef — the last committed state — so the updater
        // below stays side-effect free; the ≤1-frame lag is inside
        // the cadence's tolerance.
        hostFramesRef.current += 1;
        if (snapshotDue(hostFramesRef.current) && stateRef.current) {
          frameSession.sendSnapshot(stateRef.current);
        }
      }
      // Ms-epoch stamp for this frame (the cinematic clock's domain
      // — the protocol's shared freeze clock, NOT the rAF clock).
      const frameNowEpoch = Date.now();
      setState(prev => {
        const next = { ...prev };
        const ship = { ...next.ship };
        const star = { ...next.star };
        const enemyStar = { ...next.enemyStar };

        // PER-SEAT PROJECTION (Phase 2, P2-2b): rebuild the seat
        // records around this frame's working copies, so everything
        // below can resolve stars/ships by ownerId through the seats
        // while the top-level fields stay the local seat's view.
        // The local seat wraps `ship`/`star`, the first hostile seat
        // wraps `enemyStar` — the same objects the rest of the frame
        // (and the returned state) use. P2-3b: the two seats are
        // found by ownerId, not by position — a hosted match
        // re-anchors the top level to the HOST's seat, which is not
        // necessarily seat 0. In SP (and in createMatch's seat-0
        // orientation) localIdx is 0 and enemyIdx is 1, and this
        // mapping is exactly the shipped positional one. Extra seats
        // carry their own copies.
        const localOwnerId = ship.ownerId;
        const prevSeats: SeatSimState[] =
          prev.seats && prev.seats.length >= 2
            ? prev.seats
            : [
                createSeatSimState(star, 0, 'human', ship),
                createSeatSimState(enemyStar, 1, 'bot', createStarterShip(enemyStar.ownerId, shipSpawnPosition(enemyStar), { withStarterWeapon: true })),
              ];
        const localIdx = prevSeats.findIndex(ps => ps.ownerId === localOwnerId);
        const enemyIdx = prevSeats.findIndex(ps => ps.ownerId !== localOwnerId);
        // HOSTED MATCH — the state-provenance discriminator: this
        // frame simulates a match this client HOSTS — a room session
        // is present, this client is its host, and the match in
        // state was initialized from that room (mpRoomRef). In
        // single-player every clause is false (no room; SP never
        // sets mpRoomRef), and a guest never reaches this updater
        // for a room it doesn't host. The death economy (P2-5)
        // gates on this: where it is false, ship death keeps its
        // shipped meaning.
        const hosting =
          !!frameSession && !!frameRoom && frameSession.isHost &&
          mpRoomRef.current === frameRoom.code;
        // The local seat began this frame shipless in a hosted
        // match: its ship died in an earlier frame and the death
        // economy holds the seat until repurchase. The top-level
        // ship is then only the wreck stand-in (see the death
        // sweep); the seat record carries the truth, and the
        // rebuild below keeps it null.
        const localSeatDead =
          hosting && localIdx >= 0 && prevSeats[localIdx].ship === null;
        const simSeats: SeatSimState[] = prevSeats.map((ps, i) => {
          const seat: SeatSimState = { ...ps };
          if (i === localIdx) {
            seat.ship = localSeatDead ? null : ship;
            seat.star = star;
            seat.bankedScrap = prev.bankedScrap;
          } else if (i === enemyIdx) {
            seat.ship = ps.ship ? { ...ps.ship } : null;
            seat.star = enemyStar;
          } else {
            seat.ship = ps.ship ? { ...ps.ship } : null;
            seat.star = { ...ps.star };
          }
          seat.fedTotal = seat.star.totalScrapInfused;
          return seat;
        });
        const seatByOwnerId = new Map(simSeats.map(s => [s.ownerId, s]));
        // HOST CONTROLLER SYNC (P2-3b): while hosting, seat
        // controllers follow the room — a guest who takes over a bot
        // seat (or drops, leaving it to the bot) flips the seat's
        // driver on the next frame. (`hosting` is computed above,
        // beside the seat rebuild.)
        if (hosting && frameRoom) {
          for (const seat of simSeats) {
            const roomSeat = frameRoom.seats.find(rs => rs.ownerId === seat.ownerId);
            if (roomSeat) seat.controller = roomSeat.occupant.kind;
          }
        }
        const starByOwnerId = (ownerId: string): Star =>
          seatByOwnerId.get(ownerId)?.star ??
          (ownerId === localOwnerId ? star : enemyStar);
        // This frame's host event-feed entries (kills credited below,
        // milestones/stage changes/eliminations at frame end). Pure
        // data — folded into state.eventFeed at the return.
        const feedEntries: EventFeedEntry[] = [];

        // COLLAPSE CINEMATIC LOCKOUT (P2-4): while a critical-mass
        // cinematic is inside its window, ship inputs stop applying
        // — every human seat is fed the idle input, the local device
        // refs are masked (NO_KEYS / NO_TOUCH), and remote payloads
        // are not consumed. The window is the matchEnd record's
        // epoch start + CINEMATIC_DURATION_MS (starStages); once it
        // closes, inputs apply again (in a room, the results phase
        // is the DO/UI's move from there). Reads prev.matchEnd: the
        // end is derived at frame end, so the lock engages the
        // frame after the crossing — the same one-frame lag every
        // frame-end derivation here has.
        const cinematicLocked = isInputLocked(prev.matchEnd, frameNowEpoch);

        // DEFENSE STATE (Slice 6): the equipped defense's invariants are
        // enforced here, once, every frame — max hull follows Armor
        // Plating, the shield pool follows the Deflector — so buying or
        // swapping in the shop needs no bookkeeping of its own.
        const defId = ship.loadout.defense;
        const defTier = defId ? (ship.arsenal[defId] || 0) : 0;
        // Max hull = base + hull steps (Phase 3) + Armor Plating. The
        // hull-step term belongs here: this per-frame enforcement is
        // what the buy action's own +10 defers to every frame after.
        const wantMaxHealth = 100 + ship.hullSteps * HULL_STEP_HEALTH + (defId === 'armor_plating' ? armorHullFor(defTier) : 0);
        if (ship.maxHealth !== wantMaxHealth) {
          if (wantMaxHealth > ship.maxHealth) ship.health += wantMaxHealth - ship.maxHealth;
          ship.maxHealth = wantMaxHealth;
          if (ship.health > wantMaxHealth) ship.health = wantMaxHealth;
        }
        if (defId === 'deflector_shield') {
          const sMax = shieldMaxFor(defTier);
          if (ship.shield === undefined) ship.shield = sMax;
          if (ship.shield > sMax) ship.shield = sMax;
          if (time - (ship.shieldHitAt || 0) > 2500 && ship.shield < sMax) {
            ship.shield = Math.min(sMax, ship.shield + shieldRechargePerFrame(defTier));
          }
        } else if (ship.shield) {
          ship.shield = 0;
        }
        // SCRAP HEALING (RULED, src/sim/repair.ts; REPAIR PARITY,
        // Adam's commission 2026-10-24): the repair toggle
        // DEFAULTS ON (undefined reads as on) — a hurt, loaded
        // ship heals at its hull's rate up to its type/tier cap
        // whenever the mode stands; at the cap or on an empty
        // hold the engine simply idles. The pass runs over the
        // sim seats — every human seat, not just this one — so
        // the local inline tick it replaces is gone: one law,
        // one call site, no double heal. (The local seat's ship
        // IS this ship object, so its heal is unchanged.)
        stepSeatRepairs(simSeats);
        const gravFactor = defId === 'grav_dampers' ? gravFactorFor(defTier) : 1;
        const thrustFactor = defId === 'armor_plating' ? armorThrustFactor(defTier) : 1;

        // HYBRID STATE (Phase 1b): the equipped hybrid, resolved once per
        // frame exactly like the defense above — effects key off the
        // EQUIPPED item and its owned tier; owning without equipping
        // does nothing.
        const hyId = ship.loadout.hybrid;
        const hyTier = hyId ? (ship.arsenal[hyId] || 0) : 0;

        // SCRAP AEGIS plumbing: ablative armor made of cargo. Every point
        // of hull damage is offered to the hold first: each scrap soaks
        // aegisAbsorbFor(tier) damage, and a partly used scrap's leftover
        // soak is remembered (ship.aegisCredit) so fractional damage —
        // the star burn — burns cargo at the same rate instead of a
        // scrap per frame. Returns the damage the hull actually takes
        // (0 while cargo lasts). Layering: the Deflector pool absorbs
        // first where it already does (it recharges free), the aegis
        // second (it costs cargo), the hull last.
        // P2-3b: the closure is built by a per-ship factory so a
        // remote human ship's burn gets the same absorb over ITS
        // hold; the frame's instance (the local ship's) is built
        // from it with the shipped arguments, body unchanged.
        const makeAegisAbsorb = (target: Ship, id: Ship['loadout']['hybrid'], tier: number) => (dmg: number): number => {
          if (id !== 'scrap_aegis' || dmg <= 0) return dmg;
          let remaining = dmg;
          let credit = target.aegisCredit || 0;
          if (credit > 0) {
            const used = Math.min(credit, remaining);
            credit -= used;
            remaining -= used;
          }
          const per = aegisAbsorbFor(tier);
          while (remaining > 0 && target.carrying > 0) {
            target.carrying -= 1;
            credit += per;
            const used = Math.min(credit, remaining);
            credit -= used;
            remaining -= used;
          }
          target.aegisCredit = credit;
          return remaining;
        };
        const aegisAbsorb = makeAegisAbsorb(ship, hyId, hyTier);

        // PER-SHIP HUMAN FRAME (Phase 2, P2-3b): the ship step
        // sequence — fuel & inputs, star burn, physics, scrap
        // collection, jettison, weapon fire — extracted into a
        // routine parameterized by (ship, input) so EVERY human seat
        // runs it: the local seat from the device refs, remote seats
        // (host only) from their relayed payloads. Bot seats never
        // run it (botDriver, below). The local call passes the
        // shipped arguments verbatim — the live key/touch refs, the
        // frame's star pair, the distant-scrap cull, the state-level
        // eject stamp — and the frame's own defense block above has
        // already enforced the local ship's invariants, so the local
        // call skips enforcement; remote ships enforce their own
        // inside (enforceDefense) with the same helpers. Movement of
        // the ambient scrap-spawn block (it now runs after the whole
        // local routine instead of between collection and jettison)
        // is the only ordering change, and it is inert: the block
        // reads only ship.pos (post-physics either way) and the scrap
        // array, which neither jettison nor fire touches.
        const runHumanShipFrame = (args: {
          s: Ship;
          input: ShipFrameInput;
          physKeys: ReadonlySet<string>;
          physTouch: ShipPhysicsInputs;
          ownStar: Star;
          hostileStar: Star;
          scrapIn: Scrap[];
          cullDistant: boolean;
          enforceDefense: boolean;
          ejectAt: number | undefined;
        }): { scrap: Scrap[]; isVacActive: boolean; ejectAt: number | undefined } => {
          const { input } = args;
          const s = args.s;

          // Defense invariants for ships the frame block did not
          // already enforce (remote human seats) — the frame's local
          // block, parameterized by ship.
          if (args.enforceDefense) {
            const dId = s.loadout.defense;
            const dTier = dId ? (s.arsenal[dId] || 0) : 0;
            const wantMax = 100 + s.hullSteps * HULL_STEP_HEALTH + (dId === 'armor_plating' ? armorHullFor(dTier) : 0);
            if (s.maxHealth !== wantMax) {
              if (wantMax > s.maxHealth) s.health += wantMax - s.maxHealth;
              s.maxHealth = wantMax;
              if (s.health > wantMax) s.health = wantMax;
            }
            if (dId === 'deflector_shield') {
              const sMax = shieldMaxFor(dTier);
              if (s.shield === undefined) s.shield = sMax;
              if (s.shield > sMax) s.shield = sMax;
              if (time - (s.shieldHitAt || 0) > 2500 && s.shield < sMax) {
                s.shield = Math.min(sMax, s.shield + shieldRechargePerFrame(dTier));
              }
            } else if (s.shield) {
              s.shield = 0;
            }
          }
          const sDefId = s.loadout.defense;
          const sDefTier = sDefId ? (s.arsenal[sDefId] || 0) : 0;
          const sGravFactor = sDefId === 'grav_dampers' ? gravFactorFor(sDefTier) : 1;
          const sThrustFactor = sDefId === 'armor_plating' ? armorThrustFactor(sDefTier) : 1;
          const sHyId = s.loadout.hybrid;
          const sHyTier = sHyId ? (s.arsenal[sHyId] || 0) : 0;
          const sAegisAbsorb = makeAegisAbsorb(s, sHyId, sHyTier);

          // 1. Fuel & Inputs
          const stick = input.stick;
          const stickDist = stick ? Math.sqrt(stick.x * stick.x + stick.y * stick.y) : 0;

          // Cargo Capacity (the line/type cargoBonus rides on top of the
          // cargo track; the overload ratio applies to the total, as ever)
          const regularCapacity = PHYSICS.CARGO.BASE_CAPACITY + s.upgrades.cargo * PHYSICS.CARGO.UPGRADE_BONUS + typeFor(s.line, s.typeTier).cargoBonus;
          const overloadCapacity = Math.floor(regularCapacity * PHYSICS.CARGO.OVERLOAD_RATIO);
          const totalCapacity = regularCapacity + overloadCapacity;

          // Slowdown Penalty (Overload)
          let speedMult = 1.0;
          if (s.carrying > regularCapacity) {
            const excess = s.carrying - regularCapacity;
            speedMult = 1.0 - (excess / overloadCapacity) * PHYSICS.CARGO.SLOWDOWN_PENALTY;
          }

          if (input.wantsThrust && s.fuel > PHYSICS.FUEL_CONSUMPTION) {
            s.thrust = true;
            s.fuel -= PHYSICS.FUEL_CONSUMPTION;
          } else {
            s.thrust = false;
            s.fuel = Math.min(s.fuel + PHYSICS.FUEL_REGEN, s.maxFuel);
          }

          // Auto-refuel from cargo
          if (s.fuel < PHYSICS.FUEL_AUTO_CONVERT_THRESHOLD && s.carrying > 0) {
            s.carrying -= 1;
            s.fuel += 40; // Buffed conversion
            next.glitchActive = true;
            next.lastGlitchTime = time;
          }

          // Ship Health Regen
          s.health = Math.min(s.health + 0.01, s.maxHealth);

          // Ship Health Damage from hostile star proximity — the
          // step lives in src/sim/physics.ts (dedicated split),
          // called here in the shipped position (after the health
          // regen, before the physics step).
          stepStarBurn({ next, ship: s, simSeats, hyId: sHyId, hyTier: sHyTier, time, aegisAbsorb: sAegisAbsorb });
          // (The old deep-space drain past 6,000 from the midpoint is
          // RETIRED: the world wrap below caps the ship at ~3,000, so the
          // drain could never trigger again. Flagged per Adam's ruling.)

          // 2. Physics (Mass Scaling) — the step lives in
          // src/sim/physics.ts (dedicated split), called here in the
          // shipped position with this frame's working copies.
          const { isVacActive } = stepShipPhysics({
            ship: s, simSeats, star: args.ownStar, enemyStar: args.hostileStar,
            keys: args.physKeys,
            touchInputs: args.physTouch,
            stick, stickDist, speedMult, thrustFactor: sThrustFactor, gravFactor: sGravFactor, hyId: sHyId, hyTier: sHyTier,
          });

          // Scrap Collection, ATTRACTION and CULLING
          const outScrap = args.scrapIn.filter(d => {
            const ddx = s.pos.x - d.pos.x;
            const ddy = s.pos.y - d.pos.y;
            const dDistSq = ddx * ddx + ddy * ddy;
            const dDist = Math.sqrt(dDistSq);

            // Cull distant scrap (2500 units) to keep memory clean and allow new spawns
            if (args.cullDistant && dDist > 4000) return false;

            const attractLimit = isVacActive ? s.attractRadius * 1.6 : s.attractRadius;
            if (dDist < attractLimit) {
              let pullForce = PHYSICS.DUST_ATTRACT_FORCE * (1 + s.upgrades.attractor * 0.6);
              if (isVacActive) pullForce *= PHYSICS.ACTIVE_VAC_MULTIPLIER;
              d.pos.x += (ddx / dDist) * pullForce;
              d.pos.y += (ddy / dDist) * pullForce;
            }

            if (dDistSq < (PHYSICS.AUTO_COLLECT_RADIUS ** 2)) {
              // WRECK SALVAGE: a value shard is a pile — it banks
              // whole when the hold has room for all of it, and
              // stays on the field when it doesn't (plain scrap
              // is worth 1, exactly as shipped).
              const pieceValue = d.value ?? 1;
              if (s.carrying + pieceValue <= totalCapacity) {
                s.carrying += pieceValue;
                return false;
              }
            }
            return true;
          });

          // CARGO JETTISON (live player mechanic — an old banner mislabeled
          // this 'Enemy Sabotage / legacy'; corrected 2026-10-20): Space or
          // the mobile JETTISON button throws one carried scrap overboard
          // as a DeployedCargo pod, kicked along the ship's heading; the
          // cargo pass flies it to a star — feeding its owner's star, or
          // damaging a hostile one.
          let ejectAt = args.ejectAt;

          // Handle Ejection
          if (input.wantsJettison && s.carrying > 0 && (!ejectAt || time - ejectAt > 100)) {
            s.carrying -= 1;
            ejectAt = time;

            // Eject in direction of travel + extra kick
            const kickDir = s.angle;
            const kickForce = 8;
            next.deployedCargo.push({
              id: Math.random().toString(),
              pos: { ...s.pos },
              vel: {
                x: s.vel.x + Math.cos(kickDir) * kickForce,
                y: s.vel.y + Math.sin(kickDir) * kickForce,
              },
              color: '#f472b6',
              ownerId: s.ownerId,
              life: 200, // frames
            });
          }

          // DUMP ALL (J — CARGO_AND_JETTISON.md, RULED): the
          // whole hold overboard BEHIND the ship in one kicked,
          // spread cloud — the escape verb (instant overload
          // shed, and a scrap cloud in the pursuer's face). The
          // same pods under the same cargo law as the single
          // throw; the shared throttle stamp keeps the two
          // verbs from stacking inside one press window.
          if (input.wantsJettisonAll && s.carrying > 0 && (!ejectAt || time - ejectAt > 100)) {
            ejectAt = time;
            const load = s.carrying;
            s.carrying = 0;
            for (let pi = 0; pi < load; pi++) {
              const kickDir = s.angle + Math.PI + (Math.random() - 0.5) * 0.7;
              const kickForce = 6 + Math.random() * 4;
              next.deployedCargo.push({
                id: Math.random().toString(),
                pos: { ...s.pos },
                vel: {
                  x: s.vel.x + Math.cos(kickDir) * kickForce,
                  y: s.vel.y + Math.sin(kickDir) * kickForce,
                },
                color: '#f472b6',
                ownerId: s.ownerId,
                life: 200, // frames
              });
            }
          }

          // SHIP WEAPON FIRE (Slice 4): the equipped weapon shoots down the
          // ship's nose. Hold F on desktop or the FIRE button on mobile.
          // Stats and tier scaling: src/loadout.ts WEAPON_STATS.
          const weaponId = s.loadout.weapon;
          const wStats = weaponStatsFor(weaponId, weaponId ? (s.arsenal[weaponId] || 0) : 0);
          if (!s.dockedTo && input.wantsFire && wStats && time >= (s.fireReadyAt || 0)) {
            const cost = wStats.scrapCost || 0;
            if (wStats.kind === 'mine') {
              // Mine Layer: no projectile — mines drop at the ship's tail.
              // HARD POINTS DO NOT APPLY to mines (Phase 3): a drop lays
              // the line/type's minesPerDrop instead, each still costing
              // 1 hold scrap — the drop lays only as many as the hold
              // affords, fanned across the tail so they don't stack-trip.
              const perDrop = typeFor(s.line, s.typeTier).minesPerDrop;
              const dropCount = cost > 0 ? Math.min(perDrop, Math.floor(s.carrying / cost)) : perDrop;
              if (dropCount > 0) {
                s.carrying -= dropCount * cost;
                s.fireReadyAt = time + wStats.cooldownMs;
                // PERISCOPE (ruled, src/sim/stealth.ts): laying
                // mines while cloaked surfaces the submarine.
                if (isStealthShip(s)) s.cloakReveal = PERISCOPE_REVEAL_S;
                for (let mi = 0; mi < dropCount; mi++) {
                  const lateral = (mi - (dropCount - 1) / 2) * 16;
                  (next.mines = next.mines || []).push({
                    id: Math.random().toString(),
                    pos: {
                      x: s.pos.x - Math.cos(s.angle) * mi * 8 - Math.sin(s.angle) * lateral,
                      y: s.pos.y - Math.sin(s.angle) * mi * 8 + Math.cos(s.angle) * lateral,
                    },
                    damage: wStats.damage,
                    radius: wStats.radius || 115,
                    ownerId: s.ownerId,
                  });
                }
              }
            } else {
              // HARD POINTS (Phase 3): the equipped weapon fires from
              // every mount the line/type fields. Mount 0 is the nose at
              // full damage, exactly the pre-progression shot; each extra
              // mount fires the same pattern from a perpendicular offset
              // (alternating sides) at EXTRA_MOUNT_DAMAGE of the damage.
              // Scrap-cost weapons (seekers) pay PER SHOT, extras
              // included: if the hold runs dry mid-volley, the remaining
              // mounts simply don't fire.
              const mounts = typeFor(s.line, s.typeTier).hardPoints;
              let firedAny = false;
              for (let m = 0; m < mounts; m++) {
                if (cost > 0) {
                  if (s.carrying < cost) break;
                  s.carrying -= cost;
                }
                const dmgScale = m === 0 ? 1 : EXTRA_MOUNT_DAMAGE;
                const side = m === 0 ? 0 : (m % 2 === 1 ? 1 : -1) * Math.ceil(m / 2);
                const off = side * s.size * 0.7;
                const muzzle = {
                  x: s.pos.x + Math.cos(s.angle) * (s.size + 4) - Math.sin(s.angle) * off,
                  y: s.pos.y + Math.sin(s.angle) * (s.size + 4) + Math.cos(s.angle) * off,
                };
                const pellets = wStats.pellets || 1;
                for (let pi = 0; pi < pellets; pi++) {
                  const spreadOffset = pellets > 1 ? (pi / (pellets - 1) - 0.5) * (wStats.spread || 0) : 0;
                  const a = s.angle + spreadOffset;
                  next.projectiles.push({
                    id: Math.random().toString(),
                    pos: { ...muzzle },
                    vel: {
                      x: Math.cos(a) * wStats.speed + s.vel.x * 0.5,
                      y: Math.sin(a) * wStats.speed + s.vel.y * 0.5,
                    },
                    // Legacy view-relative label: 'player' only for
                    // the local seat's ship (P2-3b).
                    owner: s.ownerId === localOwnerId ? 'player' : 'enemy',
                    ownerId: s.ownerId,
                    life: wStats.life,
                    damage: wStats.damage * dmgScale,
                    kind: weaponId || undefined,
                    pierce: wStats.pierce,
                    size: wStats.size,
                    hitIds: wStats.pierce ? [] : undefined,
                  });
                }
                firedAny = true;
              }
              if (firedAny) {
                s.fireReadyAt = time + wStats.cooldownMs;
                // PERISCOPE (ruled, src/sim/stealth.ts): firing
                // while cloaked surfaces the submarine.
                if (isStealthShip(s)) s.cloakReveal = PERISCOPE_REVEAL_S;
              }
            }
          }

          return { scrap: outScrap, isVacActive, ejectAt };
        };

        // The LOCAL seat's ship runs the routine with the shipped
        // arguments (see the routine's banner) — masked to the idle
        // input + empty device refs while the cinematic lockout runs.
        // DEATH ECONOMY (P2-5): a shipless local seat runs NO
        // routine — the wreck stand-in does not thrust, fire, burn,
        // or collect. The substituted result is the routine's shape
        // with the frame's scrap untouched and no VAC.
        const localFrame = localSeatDead
          ? { scrap: next.scrap, isVacActive: false, ejectAt: next.lastEjectTime }
          : runHumanShipFrame({
              s: ship,
              input: cinematicLocked
                ? idleShipInput()
                : localShipInput(keys.current, touchInputs.current),
              physKeys: cinematicLocked ? NO_KEYS : keys.current,
              physTouch: cinematicLocked ? NO_TOUCH : touchInputs.current,
              ownStar: star,
              hostileStar: enemyStar,
              scrapIn: next.scrap,
              cullDistant: true,
              enforceDefense: false,
              ejectAt: next.lastEjectTime,
            });
        const isVacActive = localFrame.isVacActive;
        next.lastEjectTime = localFrame.ejectAt;
        let newScrap = localFrame.scrap;
        // WRECK SALVAGE: shards drift gently apart from the
        // destruction point (velocity decays per frame), and
        // tombstones stand only until their expiresAt — both on
        // the sim's own clock, applied once here.
        for (const piece of newScrap) {
          if (!piece.vel) continue;
          piece.pos.x += piece.vel.x;
          piece.pos.y += piece.vel.y;
          piece.vel.x *= WRECK_DRIFT_DECAY;
          piece.vel.y *= WRECK_DRIFT_DECAY;
        }
        next.wrecks = (next.wrecks ?? []).filter(w => time < w.expiresAt);

        if (newScrap.length < 180 && Math.random() < 0.08) {
          // Spawn clusters biased toward player movement or rich veins
          const spawnAngle = (Math.random() * Math.PI * 2);
          const spawnDist = 1200 + Math.random() * 800;
          
          let spawnCenter = {
            x: ship.pos.x + Math.cos(spawnAngle) * spawnDist,
            y: ship.pos.y + Math.sin(spawnAngle) * spawnDist,
          };

          // "Rich Vein" Logic (pseudo-noise)
          const nv = Math.sin(spawnCenter.x * 0.001) * Math.cos(spawnCenter.y * 0.001);
          if (nv < 0.2 && Math.random() < 0.7) {
            // Nudge toward stars if not in a vein
            const target = Math.random() > 0.5 ? star.pos : enemyStar.pos;
            spawnCenter.x += (target.x - spawnCenter.x) * 0.4;
            spawnCenter.y += (target.y - spawnCenter.y) * 0.4;
          }
          
          const rand = Math.random();
          let clusterSize = 1;
          if (rand > 0.97) clusterSize = 8 + Math.floor(Math.random() * 8); 
          else if (rand > 0.8) clusterSize = 3 + Math.floor(Math.random() * 3); 
          else if (rand > 0.5) clusterSize = 2; 

          for (let i = 0; i < clusterSize; i++) {
            newScrap.push(spawnScrap(spawnCenter, clusterSize * 15));
          }
        }

        // Home Delivery — RETIRED (Adam's pin, 2026-10-20): the ship's
        // hold used to auto-feed inside DELIVERY_RADIUS, which made the
        // feed-vs-bank decision for the player (and forced banking to
        // happen from the ring before the star grabbed the load).
        // Feeding is now the player's choice at the dock: the FEED
        // action (feedCargo, above) runs this same infusion on demand,
        // anywhere in the well. Drones and deployed cargo still deliver
        // themselves below — they were never the one choosing.
        let glitch = prev.glitchActive;
        let teamScrap = prev.teamScrap;

        // REMOTE HUMAN SEATS (host only, P2-3b): every other human
        // seat with a ship runs the same routine, driven by its
        // relayed payload (freshest per seat in the net hook's ref;
        // the seq gate here drops stale frames and makes the
        // per-payload side effects fire once per payload). Their
        // scrap pass threads the same array the local pass
        // returned — no distant cull for them: the cull is the
        // local ship's shipped field-keeping, already applied above.
        // ECONOMY ACTION INTENTS (buy/equip/feed/bank/shop) riding
        // in those payloads are deliberately NOT applied in v1:
        // per-seat banks/wallets are not sim-wired beyond the local
        // seat (P2-2b), so a remote seat has no wallet to pay from.
        // They are counted in the session adapter
        // (droppedRemoteActionIntents) and dropped — the deferral
        // is flagged in the P2-3b report. THE ONE EXCEPTION (P2-5
        // follow-on): a { kind: 'repurchase' } intent IS consumed —
        // the death economy's per-seat banks are sim-wired, so the
        // host applies it to the sender's seat through the same
        // tryRepurchase the local repurchaseShip callback uses.
        if (hosting && frameSession) {
          for (const seat of simSeats) {
            if (seat.controller !== 'human' || seat.ownerId === localOwnerId) continue;
            if (seat.eliminated) continue;
            const payload = frameSession.guestInputsRef.current.get(seat.ownerId);
            // FRESH-PAYLOAD SIDE EFFECTS, seq-gated to exactly once
            // per payload — and deliberately run BEFORE the ship
            // check below: a shipless seat has no frame to fly, but
            // its repurchase intent is consumed here (the only way
            // back into a ship). Cinematic lockout: payloads are not
            // consumed while it runs (their seqs stay unseen; the
            // first payload after the window is fresh by
            // construction).
            if (payload && !cinematicLocked) {
              const lastSeq = guestSeqSeenRef.current.get(seat.ownerId) ?? -1;
              if (acceptGuestPayload(lastSeq, payload)) {
                guestSeqSeenRef.current.set(seat.ownerId, payload.seq);
                countDroppedActions(payload);
                if (!prev.matchEnd) {
                  const consumed = consumeRepurchaseIntent(seat, payload, time);
                  if (consumed) feedEntries.push(consumed.record);
                  // B2 PER-SEAT ECONOMY: the guest's shop intents
                  // apply to THEIR seat through the seat shop —
                  // their bank, their wallet, the shared dock.
                  consumeTargetIntents(seat, payload, simSeats);
                  const econ = consumeEconomyIntents(seat, payload, { seats: simSeats, drones: next.drones, escorts: next.escorts, localOwnerId });
                  if (econ) {
                    if (econ.drones) next.drones = econ.drones;
                    if (econ.escorts) next.escorts = econ.escorts;
                    if (econ.addDrones.length) next.drones = [...next.drones, ...econ.addDrones];
                    if (econ.addEscorts.length) next.escorts = [...next.escorts, ...econ.addEscorts];
                  }
                }
              }
            }
            const sShip = seat.ship;
            if (!sShip) continue;
            let input = idleShipInput();
            if (payload && !cinematicLocked) {
              input = remoteShipInput(payload);
            }
            const physKeys = new Set<string>();
            if (input.rotateLeft) physKeys.add('ArrowLeft');
            if (input.rotateRight) physKeys.add('ArrowRight');
            if (input.vac) physKeys.add('KeyQ');
            // NOTE (TEAMS): this "hostileStar" is a misnomer kept
            // from P2-3b — physics reads it ONLY as the wrap-center
            // midpoint (geometry, not a hostility decision), so it
            // stays the first other seat exactly as shipped; the
            // burn itself keys on team inside stepStarBurn.
            const hostileSeat = simSeats.find(os => os.ownerId !== seat.ownerId);
            const remoteFrame = runHumanShipFrame({
              s: sShip,
              input,
              physKeys,
              physTouch: {
                rotateLeft: input.rotateLeft,
                rotateRight: input.rotateRight,
                vac: input.vac,
                analogStick: input.stick,
              },
              ownStar: seat.star,
              hostileStar: hostileSeat ? hostileSeat.star : enemyStar,
              scrapIn: newScrap,
              cullDistant: false,
              enforceDefense: true,
              ejectAt: remoteEjectAtRef.current.get(seat.ownerId),
            });
            newScrap = remoteFrame.scrap;
            if (remoteFrame.ejectAt !== undefined) {
              remoteEjectAtRef.current.set(seat.ownerId, remoteFrame.ejectAt);
            }
          }
        }

        // Update Deployed Cargo
        next.deployedCargo = (next.deployedCargo || []).filter(c => {
          c.pos.x += c.vel.x;
          c.pos.y += c.vel.y;
          c.life -= 1;

          // Collision with stars (P2-2b: every seat's star — cargo
          // delivered to its OWN seat's star feeds it; cargo striking
          // a hostile star damages it. In SP the player's cargo meets
          // exactly the home/enemy pair, as shipped.)
          // (TEAMS, Adam's pin "the team works together to build the
          // star": cargo striking a SAME-TEAM star feeds THAT star —
          // the fed seat's fedTotal mirror refreshes from its star
          // next frame, like every infusion. Hostile stars still
          // take the damage branch, bit for bit.)
          for (const seat of simSeats) {
            const s = seat.star;
            const dx = s.pos.x - c.pos.x;
            const dy = s.pos.y - c.pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < s.size + 10) {
              const amount = 1;
              if (c.ownerId === s.ownerId || areTeammates(simSeats, c.ownerId, s.ownerId)) {
                infuseStar(s, amount);
                applyDeliveryHeal(s, amount);
                if (s.ownerId === localOwnerId) next.teamScrap += amount;
              } else {
                s.integrity = Math.max(0, s.integrity - 0.01);
                s.mass *= 0.99; // Each bit of cargo damages it
                s.size *= 0.995;
                s.lastHitTime = time;
                next.shakeAmount = 10;
              }

              next.glitchActive = true;
              next.lastGlitchTime = time;
              return false; // Cargo consumed
            }
          }

          return c.life > 0;
        });

        if (glitch && time - prev.lastGlitchTime > 500) {
          glitch = false;
        }

        // Decay shake
        next.shakeAmount = Math.max(0, next.shakeAmount * 0.9);

        // Calculate Inertia Slip (Drift)
        // 0 = moving exactly forward, 1 = moving sideways/backward relative to heading
        let slip = 0;
        const velMag = Math.sqrt(ship.vel.x * ship.vel.x + ship.vel.y * ship.vel.y);
        if (velMag > 0.1) {
          const velAngle = Math.atan2(ship.vel.y, ship.vel.x);
          let angleDiff = Math.abs(ship.angle - velAngle);
          while (angleDiff > Math.PI) angleDiff = Math.abs(angleDiff - 2 * Math.PI);
          slip = angleDiff / Math.PI;
        }

        // Shop-well gate, second half: drift out of the well with the
        // workshop open and it closes behind you (Adam's pin, 2026-10-19).
        // (TEAMS: the well is any same-team star's — see inTeamWell.)
        if (next.isShopOpen && !inTeamWell(simSeats, ship)) {
          next.isShopOpen = false;
        }

        // Win/Loss Conditions
        if (enemyStar.integrity <= 0 && !next.isVictory) {
          next.isVictory = true;
        }
        // DEATH ECONOMY (P2-5): in a hosted match the local ship's
        // death is NOT game over — the death sweep below runs the
        // bank-loss cascade and the seat plays on shipless until
        // repurchase. The shipped isGameOver stands wherever no
        // match is hosted (single-player, lobby backdrop).
        if (ship.health <= 0 && !next.isGameOver && !hosting) {
          next.isGameOver = true;
        }
        if (next.isVictory || next.isGameOver) {
          ship.thrust = false;
        }

        // 5. Drones Logic — the step lives in src/sim/drones.ts
        // (dedicated split), called here in the shipped position.
        // teamScrap rides in and out: the local seat's drone
        // deliveries feed it.
        const droneStep = stepDrones({ next, seatByOwnerId, star, enemyStar, localOwnerId, teamScrap });
        next.drones = droneStep.drones;
        teamScrap = droneStep.teamScrap;
        // WORKFORCE ORDERS (2026-10-22): a DEPOSIT order banks the
        // workforce's loads on the SEAT record inside the drone
        // step; the local seat's bank is the top-level wallet, so
        // carry the seat's post-step bank back up — the next frame's
        // seat rebuild seeds the seat FROM the top level, and
        // without this the deposit would silently un-bank.
        const localSeatAfterDrones = seatByOwnerId.get(localOwnerId);
        if (localSeatAfterDrones) next.bankedScrap = localSeatAfterDrones.bankedScrap;

        // Decoy lifetime (Slice 6)
        if (next.decoy) {
          next.decoy = { ...next.decoy, lifeFrames: next.decoy.lifeFrames - 1 };
          if (next.decoy.lifeFrames <= 0) next.decoy = null;
        }

        // ALLY DOCKING (src/sim/harbor.ts): docked guests ride
        // their hosts and heal from the hosts' holds BEFORE
        // weapons resolve, so this frame's positions and the
        // cannot-be-hit reads all see the berth as it stands.
        stepHarbors(simSeats);

        // MINES — the step lives in src/sim/projectiles.ts
        // (dedicated split), called here in the shipped position.
        next.mines = stepMines({ next, simSeats, time });

        // 6. Projectiles and Defense — the step lives in
        // src/sim/projectiles.ts (dedicated split), called here in
        // the shipped position with this frame's working copies.
        next.projectiles = stepProjectiles({
          next, ship, simSeats, starByOwnerId, localOwnerId, newScrap,
          hyId, hyTier, isVacActive, time, aegisAbsorb,
        });

        // POINT-DEFENSE ZAP (Slice 6): fully automatic — the single
        // nearest hostile bolt OR drone inside PD_RANGE gets zapped, one
        // target per cooldown. Bolts are destroyed; drones take damage
        // (and the death sweep below turns kills into dropped scrap).
        if (!localSeatDead && defId === 'pd_zap' && time >= (ship.pdReadyAt || 0)) {
          let zapTarget: any = null;
          let hitProj: any = null;
          let hitDrone: any = null;
          let bestD = PD_RANGE;
          // (TEAMS: hostile TEAM — PD never zaps a teammate's bolt
          // or drone.)
          next.projectiles.forEach(p => {
            if (!areHostile(simSeats, p.ownerId, ship.ownerId)) return;
            const dd = Math.hypot(p.pos.x - ship.pos.x, p.pos.y - ship.pos.y);
            if (dd < bestD) { bestD = dd; hitProj = p; hitDrone = null; zapTarget = p.pos; }
          });
          next.drones.forEach(d => {
            if (d.state === 'docked') return; // inside its ship
            if (!areHostile(simSeats, d.ownerId, ship.ownerId)) return;
            const dd = Math.hypot(d.pos.x - ship.pos.x, d.pos.y - ship.pos.y);
            if (dd < bestD) { bestD = dd; hitDrone = d; hitProj = null; zapTarget = d.pos; }
          });
          if (hitProj) next.projectiles = next.projectiles.filter(p => p !== hitProj);
          if (hitDrone) {
            hitDrone.health -= pdDamageFor(defTier);
            hitDrone.lastHitByOwnerId = ship.ownerId;
          }
          if (zapTarget) {
            ship.pdReadyAt = time + PD_COOLDOWN_MS;
            ship.pdZapAt = time;
            ship.pdZapTarget = { x: zapTarget.x, y: zapTarget.y };
          }
        }

        // SHIPBOARD AUTO-TURRETS (Phase 3, universalized by Arsenal
        // slice 2, 2026-10-21): purchased turret mounts fire on their
        // own — each gun independently rolls its fire chance per frame
        // at the NEAREST hostile in range (an enemy drone, else the
        // enemy star). They never focus-fire the pilot's target; the
        // pilot's own weapon is separate. Bolts are ordinary player
        // projectiles with kind 'auto_gun', so they run the same
        // drone/star hit paths as ship weapons (star turret bolts pass
        // drones by leaving kind unset; these set it, so they connect
        // with drones too — that's their job). The count is
        // effectiveAutoGuns: the type's CAP bounded by mounts OWNED —
        // an unbought cap fires nothing.
        // ALLY DOCKING: a docked ship cannot fire — mounts too.
        const autoGunCount = ship.dockedTo ? 0 : effectiveAutoGuns(ship);
        if (!localSeatDead && autoGunCount > 0) {
          let gunTarget: Vector2D | null = null;
          let gunBestD = AUTO_GUN.range;
          // (TEAMS: hostile TEAM throughout — drones and the star
          // fallback alike.)
          next.drones.forEach(d => {
            if (d.state === 'docked') return; // inside its ship
            if (!areHostile(simSeats, d.ownerId, ship.ownerId)) return;
            const dd = Math.hypot(d.pos.x - ship.pos.x, d.pos.y - ship.pos.y);
            if (dd < gunBestD) { gunBestD = dd; gunTarget = d.pos; }
          });
          if (!gunTarget) {
            // Nearest hostile star (SP: the enemy star, as shipped —
            // measured to its center, edge proximity does not trigger).
            for (const seat of simSeats) {
              const s = seat.star;
              if (!areHostile(simSeats, s.ownerId, ship.ownerId)) continue;
              const dd = Math.hypot(s.pos.x - ship.pos.x, s.pos.y - ship.pos.y);
              if (dd < AUTO_GUN.range && dd < gunBestD) gunTarget = s.pos;
            }
          }
          if (gunTarget) {
            const aim = Math.atan2(gunTarget.y - ship.pos.y, gunTarget.x - ship.pos.x);
            for (let g = 0; g < autoGunCount; g++) {
              if (Math.random() >= AUTO_GUN.fireChance) continue;
              next.projectiles.push({
                id: Math.random().toString(),
                pos: {
                  x: ship.pos.x + Math.cos(aim) * (ship.size + 4),
                  y: ship.pos.y + Math.sin(aim) * (ship.size + 4),
                },
                vel: {
                  x: Math.cos(aim) * AUTO_GUN.boltSpeed,
                  y: Math.sin(aim) * AUTO_GUN.boltSpeed,
                },
                owner: 'player',
                ownerId: ship.ownerId,
                life: AUTO_GUN.life,
                damage: AUTO_GUN.damage,
                kind: 'auto_gun',
                size: 3,
              });
            }
          }
        }

        // THORN HULL contact (Phase 1b): enemy drones that ram the ship —
        // inside hull contact range (ship radius + the same 14 the
        // projectile checks use for drones) — get bitten continuously,
        // thorn damage per second for as long as they stay in reach.
        // Kills are swept up by the drone-death pass below, drops and all.
        if (!localSeatDead && hyId === 'thorn_hull') {
          const thornPerFrame = thornDamageFor(hyTier) / 60;
          next.drones.forEach(d => {
            // (TEAMS: thorn bites hostile drones only — a teammate's
            // drone ramming the hull is just a friendly bump.)
            if (!areHostile(simSeats, d.ownerId, ship.ownerId)) return;
            if (Math.hypot(d.pos.x - ship.pos.x, d.pos.y - ship.pos.y) < ship.size + 14) {
              d.health -= thornPerFrame;
              d.lastHitByOwnerId = ship.ownerId;
            }
          });
        }

        // CME — CORONAL MASS EJECTIONS: the step lives in
        // src/sim/cme.ts (dedicated split) — per-star charge /
        // telegraph / fire + the wave advance, called here in the
        // shipped position with this frame's working copies.
        stepCme({ next, simSeats, localOwnerId, ship, defId, defTier, gravFactor, time, aegisAbsorb });

        // DRONE DEATHS (Slice 4): a drone shot or mined to 0 health becomes
        // wreckage — it drops what it was carrying plus one salvage piece.
        // Drops go into newScrap, the array the frame actually returns.
        // (P2-2b: the kill is credited to the seat whose weapon/wave/mine
        // last damaged the drone — bookkeeping on the seat records and
        // the event feed only; drops and shake are exactly as shipped.)
        next.drones = next.drones.filter(d => {
          if (d.health > 0) return true;
          // WRECK SALVAGE (the flat +1 retires): the hold drops
          // WHOLE as plain pieces, and the airframe rolls the
          // ladder against its purchase price (75; a defense-mode
          // drone 100; a star-fleet gleaner the same 75). A
          // liquidating drone killed on its last trip dies under
          // this same law — no sale settles.
          newScrap.push(...cargoDropScrap(d.pos, d.carrying));
          newScrap.push(...wreckShardScrap(d.pos, rollSalvageValue(droneSalvageBasis(d))));
          const killerOwnerId =
            d.lastHitByOwnerId && d.lastHitByOwnerId !== d.ownerId
              ? d.lastHitByOwnerId
              : null;
          if (killerOwnerId) {
            const killerSeat = seatByOwnerId.get(killerOwnerId);
            if (killerSeat) killerSeat.kills += 1;
          }
          feedEntries.push({
            type: 'kill',
            killerOwnerId,
            victimOwnerId: d.ownerId,
            victimKind: 'drone',
            at: time,
          });
          next.shakeAmount = Math.max(next.shakeAmount, 6);
          return false;
        });

        // SHIP DEATHS + DEATH ECONOMY (Phase 2, P2-2b + P2-5): a
        // seat's ship reduced to 0 leaves the seat shipless — the
        // kill is credited, the seat plays on with its star and
        // drones, and the death economy (src/sim/deathEconomy.ts)
        // takes its bank-loss cut and counts the death. Ship death
        // is NOT elimination. The local seat joins the sweep ONLY
        // in a hosted match: in single-player its death remains
        // the shipped isGameOver above, and the sweep stays inert
        // there for every seat (the SP enemy seat flies no ship).
        // A shipless seat fails the bs check, so the cascade lands
        // exactly once per death.
        for (const seat of simSeats) {
          const bs = seat.ship;
          if (!bs || bs.health > 0) continue;
          const isLocalSeat = seat.ownerId === localOwnerId;
          if (isLocalSeat && !hosting) continue;
          const killerOwnerId =
            bs.lastHitByOwnerId && bs.lastHitByOwnerId !== seat.ownerId
              ? bs.lastHitByOwnerId
              : null;
          if (killerOwnerId) {
            const killerSeat = seatByOwnerId.get(killerOwnerId);
            if (killerSeat) killerSeat.kills += 1;
          }
          feedEntries.push({
            type: 'kill',
            killerOwnerId,
            victimOwnerId: seat.ownerId,
            victimKind: 'ship',
            at: time,
          });
          // WRECK SALVAGE: the hull relinquishes its CARGO WHOLE
          // and rolls the ladder against its INVESTED VALUE (the
          // destroyed set only — shipSalvageBasis). The shards
          // carry the tombstone's id; the marker stands in
          // next.wrecks for WRECK_MARKER_MS, dressing only. No
          // killer ownership: the field is the prize, and the
          // respawn timer is the owner's handicap.
          if (bs.carrying > 0) newScrap.push(...cargoDropScrap(bs.pos, bs.carrying));
          const rolled = rollSalvageValue(shipSalvageBasis(bs));
          if (rolled > 0) {
            const wreckId = Math.random().toString();
            newScrap.push(...wreckShardScrap(bs.pos, rolled, wreckId));
            (next.wrecks ??= []).push({
              id: wreckId,
              pos: { ...bs.pos },
              bornAt: time,
              expiresAt: time + WRECK_MARKER_MS,
              seed: Math.random(),
              value: rolled,
            });
          }
          const cascade = applyDeathLoss(seat.bankedScrap, seat.deaths ?? 0);
          seat.bankedScrap = cascade.bankAfter;
          seat.deaths = cascade.deathsAfter;
          seat.shipLostAt = time;
          seat.ship = null;
          if (isLocalSeat) {
            // The local seat's bank IS the top-level wallet (the
            // rebuild mirror runs the other way), so the cascade
            // writes through to it — and the wreck the top level
            // keeps as a render stand-in loses its hold with the
            // hull (the cascade taxes the bank; the hold is cargo
            // in a destroyed ship) and does not thrust.
            next.bankedScrap = seat.bankedScrap;
            ship.carrying = 0;
            ship.thrust = false;
          }
        }

        // TARGET LOCKS (src/sim/targeting.ts): a lock whose
        // target left validity this frame — died, docked,
        // cloaked, changed sides — clears where it stands.
        stepTargetLocks(simSeats);

        // BOT AUTO-REPURCHASE (P2-5): a bot-driven seat buys its
        // frame back on the delay timer (deathEconomy), so a match
        // never stalls on a seat nobody is driving. Human seats
        // repurchase only through the player's own action (the
        // repurchaseShip callback, below). Runs before the bot
        // drivers so a bought-back ship flies this same frame.
        if (!prev.matchEnd) {
          // SURVIVAL LEDGER (death-tax decay, Adam, 2026-10-21):
          // time alive banks on the seat and never resets — each
          // full minute forgives one death-step of the respawn
          // wait's growth (deathEconomy). Dead, waiting, and
          // eliminated seats accrue nothing: the ship is the proof
          // of life.
          for (const seat of simSeats) {
            if (seat.ship && !seat.eliminated) {
              seat.survivalMs = (seat.survivalMs ?? 0) + frameDtMs;
            }
          }
          // PERISCOPE COUNTDOWN (src/sim/stealth.ts): the reveal a
          // cloaked submarine earned by firing or laying ticks down
          // in seconds — a snapshot-native field, identical on
          // every clock, where a host timestamp would be noise.
          for (const seat of simSeats) {
            if (seat.ship && seat.ship.cloakReveal) {
              seat.ship.cloakReveal = Math.max(0, seat.ship.cloakReveal - frameDtMs / 1000);
            }
          }
          // DEATH-TAX ARRIVALS (Adam, 2026-10-21): a paid buy-back's
          // frame lands when its respawn wait elapses. Payment was
          // recorded at purchase; arrival itself is silent.
          for (const seat of simSeats) {
            if (respawnDue(seat, time)) completeRespawn(seat);
          }
          for (const seat of simSeats) {
            if (!botRepurchaseDue(seat, time)) continue;
            const bought = tryRepurchase(seat, time);
            if (bought) {
              feedEntries.push({
                type: 'repurchase',
                ownerId: seat.ownerId,
                starId: starIdForSeat(seat.starIndex),
                cost: bought.cost,
                deaths: seat.deaths,
                at: time,
              });
            }
          }
        }

        // B2 BOT ECONOMY (src/sim/botEconomy.ts): policy +
        // purchases for bot seats — real banks, real prices, the
        // well is the market. Runs before the drivers so a fresh
        // purchase flies this frame, and this frame's deliveries
        // split by the mode the policy just set.
        {
          const econCtx = { seats: simSeats, drones: next.drones, escorts: next.escorts, localOwnerId };
          for (const seat of simSeats) {
            if (seat.controller !== 'bot') continue;
            // TUTORIAL: the captain stays parked until TEETH.
            if (tutorialActiveRef.current && tutorialStepRef.current < TEETH_INDEX && seat.starIndex === 1) continue;
            const change = stepBotEconomy(seat, econCtx, time);
            if (change) {
              if (change.drones) { next.drones = change.drones; econCtx.drones = change.drones; }
              if (change.escorts) { next.escorts = change.escorts; econCtx.escorts = change.escorts; }
              if (change.drone) { next.drones = [...next.drones, change.drone]; econCtx.drones = next.drones; }
            }
          }
        }

        // BOT SHIP DRIVERS (Phase 2, P2-2b): every bot seat that HAS a
        // ship flies it via src/sim/botDriver.ts — harvest, deliver
        // (through the same infuseStar + delivery heal as drone
        // deliveries), and fire. Its projectiles join this frame's
        // production phase alongside turret bolts and auto-guns, so
        // they first move next frame, like theirs. In SP this is
        // the solo opponent: the enemy seat's bot flies from frame one.
        for (const seat of simSeats) {
          if (seat.controller !== 'bot' || !seat.ship || seat.eliminated) continue;
          // TUTORIAL: the captain stays parked until TEETH.
          if (tutorialActiveRef.current && tutorialStepRef.current < TEETH_INDEX && seat.starIndex === 1) continue;
          // BOT DIFFICULTY LADDER: the room's rung drives every bot
          // seat; solo has no room, so it defaults to ROOKIE — the
          // gentle on-ramp. A room whose state predates difficulty
          // keeps today's behavior (IMPOSSIBLE), never a surprise
          // softening mid-match.
          const botDifficulty = netRef.current?.room
            ? (netRef.current.room.difficulty ?? 'impossible')
            : 'rookie';
          const botResult = stepBotShip(
            seat,
            {
              scrap: newScrap,
              stars: simSeats.map(s => s.star),
              drones: next.drones,
              ships: simSeats
                .filter(s => s.ship)
                .map(s => ({ ownerId: s.ownerId, ship: s.ship! })),
              seats: simSeats,
              localOwnerId,
              time,
              difficulty: botDifficulty,
            },
            1,
          );
          for (const id of botResult.collectedScrapIds) {
            const ix = newScrap.findIndex(sc => sc.id === id);
            if (ix >= 0) newScrap.splice(ix, 1);
          }
          if (botResult.deliverAmount > 0) {
            // B2 POLICY SPLIT: a depositing bot BANKS its ship's
            // load into its own account (no infusion, no heal —
            // the drone DEPOSIT law); a feeding bot infuses as
            // bots always have.
            if (seat.deliveryMode === 'deposit') {
              seat.bankedScrap += botResult.deliverAmount;
            } else {
              infuseStar(seat.star, botResult.deliverAmount);
              applyDeliveryHeal(seat.star, botResult.deliverAmount);
            }
          }
          for (const p of botResult.projectiles) next.projectiles.push(p);
        }

        // ESCORT WINGS (Arsenal slice 5b): every seat's wing steps
        // here — station, leashed engagement, volleys into this
        // frame's production phase beside the bot drivers' (their
        // bolts first move next frame, like theirs). Wrecks and
        // dissolved seats' wings drop out inside the step.
        next.escorts = stepEscorts({ next, seatByOwnerId, seats: simSeats, time, localOwnerId });

        // Update Turrets
        next.starOrbit += 0.01;
        next.enemyStarOrbit += 0.015;

        // Auto-Fire for stars — STAR DEFENSE LADDER (Phase 1c,
        // src/starDefense.ts): a star's turret list is a deterministic
        // function of its milestone count, reconciled here every frame
        // so a milestone crossing takes effect the moment it lands.
        simSeats.forEach(seat => {
          const s = seat.star;
          // SIZE RECONCILIATION (P2-4): a star's physical size is a
          // deterministic function of its growth base + total fed
          // (src/sim/starStages.ts) — the ×1.15 growth curve before
          // NEUTRON, the collapse curve from M12 — reconciled here
          // alongside the turrets, never hand-edited. This supersedes
          // infuseStar's imperative size growth (its mass growth
          // stands) and the hostile-cargo size nibble in the cargo
          // pass above: size is derived state now, not a damage sink.
          // Gravity and banking read the EFFECTIVE radius instead,
          // so the collapse never weakens the well.
          s.size = physicalSizeForStar(s);
          s.turrets = turretsForMilestones(milestonesForInfused(s.totalScrapInfused));
          // ORBIT (Adam, 2026-10-21): the ladder list carries BASE
          // angles; each turret's live angle is derived from the
          // loop clock and stamped here, so the firing code below
          // and the canvas both read the turret where it IS — and
          // snapshots carry the stamped angle to guests as-is.
          for (const t of s.turrets) t.angle = turretAngleAt(t, time);
        });
        // TARGETING (unchanged from the single-turret era, and shared by
        // every turret on a star): turrets may fire only while their
        // target is within DEFENSE.RANGE of the star's CENTER. EVERY
        // turret rolls its own tier fire chance and fires independently,
        // from its own ring position (radius per the PHYSICS.STAR_DEFENSE
        // formula), aiming from there, and its bolt carries its own tier
        // damage.
        // (P2-2b generalization, as amended by Adam's ruling of
        // 2026-10-20: turrets are DEFENSIVE — they protect their star
        // from incoming hostile ships, and they never engage stars.
        // A star's target is the first of — a hostile Decoy Beacon;
        // the nearest hostile SHIP. No star fallback: if no decoy or
        // ship is in range, the turrets hold fire.)
        simSeats.forEach(seat => {
          const s = seat.star;
          let target: { pos: Vector2D } | null = null;
          // (TEAMS: a decoy draws a star's fire only when it is
          // hostile to that star, and ships are targeted only when
          // hostile — a teammate's ship/decoy is never engaged.)
          if (next.decoy && areHostile(simSeats, next.decoy.ownerId, s.ownerId)) {
            target = { pos: next.decoy.pos };
          }
          if (!target) {
            let bd = Infinity;
            for (const os of simSeats) {
              if (!os.ship || !areHostile(simSeats, os.ownerId, s.ownerId)) continue;
              // SUBMARINE (RULED, Adam, 2026-10-21): turrets
              // respect the cloak like everything else — they do
              // not engage what the star cannot see, the reveal
              // geometry measured from the star (src/sim/stealth.ts).
              if (!isVisibleTo(os.ship, s.pos)) continue;
              const dd = Math.hypot(os.ship.pos.x - s.pos.x, os.ship.pos.y - s.pos.y);
              if (dd < bd) { bd = dd; target = os.ship; }
            }
          }
          if (!target) return;
          const dx = target.pos.x - s.pos.x;
          const dy = target.pos.y - s.pos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist >= PHYSICS.DEFENSE.RANGE) return;

          s.turrets.forEach(t => {
            const ring = turretRingRadius(s.size, t.shell);
            // FIRING ARC (Adam, 2026-10-21): a turret engages only
            // targets inside its outward sector (see
            // targetInTurretArc) — outside its arc it holds fire
            // and the ring's other turrets carry that side. The
            // shared target selection and the RANGE-from-center
            // gate above are unchanged, and turrets still never
            // damage stars.
            if (!targetInTurretArc(s.pos, t, ring, target.pos)) return;
            if (Math.random() >= turretFireChanceFor(t.tier)) return;
            const origin = {
              x: s.pos.x + Math.cos(t.angle) * ring,
              y: s.pos.y + Math.sin(t.angle) * ring,
            };
            const aim = Math.atan2(target.pos.y - origin.y, target.pos.x - origin.x);
            next.projectiles.push({
              id: Math.random().toString(),
              pos: origin,
              vel: {
                x: Math.cos(aim) * PHYSICS.DEFENSE.BOLT_SPEED,
                y: Math.sin(aim) * PHYSICS.DEFENSE.BOLT_SPEED,
              },
              owner: s.ownerId === localOwnerId ? 'player' : 'enemy',
              ownerId: s.ownerId,
              life: 180,
              damage: turretDamageFor(t.tier),
            });
          });
        });

        // PER-SEAT TRACKING + STANDINGS (Phase 2, P2-2b): star
        // eliminations, milestone/stage feed entries, and the match
        // end are derived from the seat records (src/sim/seatState.ts);
        // standings are recomputed host-side every frame
        // (src/sim/standings.ts). All of it is DATA riding in state —
        // no component reads it yet, and none of it feeds back into
        // the SP flow: isVictory / isGameOver above remain the shipped
        // game's win/loss triggers, untouched. In SP, the enemy star's
        // death records matchEnd last_survivor / seat-0 alongside the
        // isVictory it has always set.
        const tracking = advanceSeatTracking(prevSeats, simSeats, prev.matchEnd, time, frameNowEpoch);
        feedEntries.push(...tracking.entries);
        const matchEnd = tracking.matchEnd;
        const standings = computeStandings(
          simSeats.map(seat => ({
            starIndex: seat.starIndex,
            ownerId: seat.ownerId,
            teamId: seat.teamId,
            totalScrapInfused: seat.star.totalScrapInfused,
            mass: seat.star.mass,
            integrity: seat.star.integrity,
            alive: !seat.eliminated,
            eliminated: seat.eliminated,
            eliminationOrder: seat.eliminationOrder,
            kills: seat.kills,
          })),
          matchEnd
            ? { endReason: matchEnd.endReason, winnerOwnerId: matchEnd.winnerOwnerId }
            : undefined,
        );
        const eventFeed =
          feedEntries.length > 0
            ? appendEventRecords(prev.eventFeed, feedEntries)
            : prev.eventFeed;

        return {
          ...next,
          ship,
          star,
          enemyStar,
          seats: simSeats,
          standings,
          eventFeed,
          matchEnd,
          scrap: newScrap,
          teamScrap,
          glitchActive: glitch,
          slip,
        };
      });
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [width, height]);

  // THE GUIDED FLIGHT — published snapshot (UI's contract): one
  // object for the coach card, the canvas marker and the spotlight
  // pulse. stepId/spotlight come straight from the step table;
  // marker is world-flat {x, y, label, tone}; a room never shows
  // any of it (the snapshot inerts: marker/spotlight null).
  const tutorialStepDef = TUTORIAL_STEP_DEFS[tutorial.step];
  const tutorialSnapshot = {
    active: tutorial.active,
    step: tutorial.step,
    stepId: tutorialStepDef?.id ?? 'fly',
    done: tutorial.done,
    marker: tutorial.active && !netRef.current?.room ? (tutorialStepDef?.marker(state) ?? null) : null,
    spotlight: tutorial.active && !netRef.current?.room ? (tutorialStepDef?.spotlight ?? null) : null,
  };

  return {
    state,
    tutorial: tutorialSnapshot,
    startTutorial,
    endTutorial,
    skipTutorialStep,
    upgrade,
    buyItem,
    equipItem,
    selectWeaponSlot,
    cycleTarget,
    setTarget,
    buyType,
    buyHullStep,
    buyTurretMount,
    switchLine,
    buildDrone,
    buildDefenseDrone,
    setDeliveryMode,
    setRepairing,
    dockToHost,
    undock,
    setHarborOpen,
    undockGuest,
    buildEscort,
    debugGrantScrap,
    debugGrantFed,
    debugJumpTo,
    repurchaseShip,
    feedCargo,
    depositBank, 
    withdrawBank, 
    deployDecoy, 
    restart, 
    setVirtualControl, 
    setAnalogStick, 
    toggleShop, 
    toggleGauges 
  };
};
