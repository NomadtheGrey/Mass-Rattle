import { useState, useEffect, useRef, useCallback } from 'react';
import { GameState, SeatSimState, Star, Vector2D } from '../types';
import { PHYSICS, COLORS } from '../constants';
import { getLoadoutItem, itemTierCost, swapCostForTier, MAX_ITEM_TIER } from '../loadout';
import { inBankWell } from '../bank';
import { infuseStar, milestonesForInfused } from '../starGrowth';
import { ownerIdForSeat } from '../sim/ownership';
import { createMatchLayout, DEFAULT_MATCH_SEED } from '../sim/matchInit';
import { advanceSeatTracking, createSeatSimState, createStarterShip } from '../sim/seatState';
import { stepBotShip } from '../sim/botDriver';
import { computeStandings } from '../sim/standings';
import { appendEventRecords, EventFeedEntry } from '../sim/eventFeed';
import { turretsForMilestones, turretRingRadius, turretDamageFor, turretFireChanceFor, applyDeliveryHeal } from '../starDefense';
import { weaponStatsFor, shieldMaxFor, shieldRechargePerFrame, armorHullFor, armorThrustFactor, PD_RANGE, PD_COOLDOWN_MS, pdDamageFor, decoyHealthFor, decoyLifeFramesFor, gravFactorFor, cmeReductionFor, mirrorReflectDamageFor, SAIL_RANGE, sailThrustFor, siphonFuelFor, thornDamageFor, aegisAbsorbFor } from '../loadout';
import { ShipLine, TypeTier, typeFor, capsFor, typeStepPrice, hullStepPrice, hullSizeFor, HULL_STEP_HEALTH, switchToll, DRONE_PRICE, EXTRA_MOUNT_DAMAGE, AUTO_GUN } from '../shipProgression';

/**
 * SHIP PROGRESSION (Phase 3, src/shipProgression.ts — DRAFT numbers):
 * the ship's effective VAC/attract radius is the attractor track's
 * formula plus the line/type's flat vacBonus. The radius lives on
 * ship.attractRadius (state the canvas draws from), so it is
 * recomputed wherever the track, line, or tier changes: attractor
 * purchases, buyType, switchLine.
 */
const attractRadiusForShip = (attractorLvl: number, line: ShipLine | null, tier: TypeTier): number =>
  PHYSICS.BASE_ATTRACT_RADIUS + attractorLvl * 35 + typeFor(line, tier).vacBonus;

/**
 * COMBINED WALLET — every purchase in the game (base upgrades, Arsenal
 * tiers, loadout swaps) is checked against hold + bank TOGETHER and paid
 * hold-first, then bank. This is what makes prices above the hold's
 * physical capacity (15 scrap at start) reachable at all.
 *
 * BANK ACCESS (Adam, 2026-10-19): the bank IS the home star's gravity
 * well — savings can only be SPENT from inside the well (see src/bank.ts).
 * Outside it, bankAccessible is false and the wallet is the hold alone.
 * Returns null when the accessible wallet cannot cover the cost.
 */
const walletPay = (carrying: number, banked: number, cost: number, bankAccessible: boolean) => {
  const accessible = carrying + (bankAccessible ? banked : 0);
  if (accessible < cost) return null;
  const fromHold = Math.min(carrying, cost);
  return { carrying: carrying - fromHold, banked: banked - (cost - fromHold) };
};

export const useGameLoop = (width: number, height: number) => {
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
  // seat 1 a bot seat with ship: null — the shipped game, unchanged.
  // The starter-ship factory reproduces the shipped initial ship
  // field for field (see src/sim/seatState.ts).
  const initialShip = createStarterShip(ownerIdForSeat(0), { x: 100, y: 100 });
  const initialHomeStar: Star = {
    pos: initialStarPos,
    vel: { x: 0, y: 0 },
    size: 40,
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
    mass: 4000,
    totalScrapInfused: 0,
    type: 'enemy',
    ownerId: initialLayout.stars[1].ownerId,
    integrity: 1,
    turrets: turretsForMilestones(0),
  };
  const [state, setState] = useState<GameState>({
    ship: initialShip,
    star: initialHomeStar,
    enemyStar: initialEnemyStar,
    seats: [
      createSeatSimState(initialHomeStar, 0, 'human', initialShip),
      createSeatSimState(initialEnemyStar, 1, 'bot', null),
    ],
    standings: [],
    eventFeed: [],
    matchEnd: null,
    scrap: [],
    deployedCargo: [],
    projectiles: [],
    mines: [],
    decoy: null,
    cmes: [],
    drones: [],
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

  const keys = useRef<Set<string>>(new Set());
  const touchInputs = useRef<{
    thrust: boolean;
    rotateLeft: boolean;
    rotateRight: boolean;
    vac: boolean;
    jettison: boolean;
    fire: boolean;
    analogStick: { x: number; y: number } | null;
  }>({
    thrust: false,
    rotateLeft: false,
    rotateRight: false,
    vac: false,
    jettison: false,
    fire: false,
    analogStick: null,
  });

  const setVirtualControl = useCallback((action: 'thrust' | 'rotateLeft' | 'rotateRight' | 'vac' | 'jettison' | 'fire', active: boolean) => {
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
      if (wantOpen && !prev.isShopOpen && !inBankWell(prev.ship.pos, prev.star.pos, prev.star.size)) {
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
      
      const payment = walletPay(prev.ship.carrying, prev.bankedScrap, cost, inBankWell(prev.ship.pos, prev.star.pos, prev.star.size));
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
    const def = getLoadoutItem(itemId);
    if (!def) return;
    setState(prev => {
      const owned = prev.ship.arsenal[itemId] || 0;
      if (owned >= MAX_ITEM_TIER) return prev;
      const cost = itemTierCost(def, owned);
      const payment = walletPay(prev.ship.carrying, prev.bankedScrap, cost, inBankWell(prev.ship.pos, prev.star.pos, prev.star.size));
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
    const def = getLoadoutItem(itemId);
    if (!def) return;
    setState(prev => {
      const owned = prev.ship.arsenal[itemId] || 0;
      if (owned <= 0) return prev; // cannot equip what you do not own
      const slot = def.category;
      const current = prev.ship.loadout[slot];
      if (current === itemId) return prev; // already equipped

      const ship = { ...prev.ship };
      let banked = prev.bankedScrap;
      // Adam's pin: swapping costs 60 + 20 per tier beyond the first,
      // priced on the INCOMING item's tier. Empty slot = free equip.
      // Paid from the combined wallet like every other purchase.
      if (current !== null) {
        const payment = walletPay(prev.ship.carrying, prev.bankedScrap, swapCostForTier(owned), inBankWell(prev.ship.pos, prev.star.pos, prev.star.size));
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
  // ------------------------------------------------------------------
  const feedCargo = useCallback(() => {
    setState(prev => {
      if (!inBankWell(prev.ship.pos, prev.star.pos, prev.star.size)) return prev; // feeding happens at home
      if (prev.ship.carrying <= 0) return prev;
      const amount = prev.ship.carrying;
      const star = { ...prev.star };
      infuseStar(star, amount);
      applyDeliveryHeal(star, amount);
      const ship = { ...prev.ship, carrying: 0 };
      return { ...prev, ship, star, teamScrap: prev.teamScrap + amount, glitchActive: true, lastGlitchTime: performance.now() };
    });
  }, []);

  const depositBank = useCallback(() => {
    setState(prev => {
      if (!inBankWell(prev.ship.pos, prev.star.pos, prev.star.size)) return prev; // banking happens at home
      if (prev.ship.carrying <= 0) return prev;
      const ship = { ...prev.ship, carrying: 0 };
      return { ...prev, ship, bankedScrap: prev.bankedScrap + prev.ship.carrying, glitchActive: true, lastGlitchTime: performance.now() };
    });
  }, []);

  const withdrawBank = useCallback(() => {
    setState(prev => {
      if (!inBankWell(prev.ship.pos, prev.star.pos, prev.star.size)) return prev; // banking happens at home
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
  const buyType = useCallback((line?: ShipLine) => {
    setState(prev => {
      if (!inBankWell(prev.ship.pos, prev.star.pos, prev.star.size)) return prev; // types are bought at home
      if (prev.ship.typeTier >= 4) return prev; // top of the ladder
      // From the SKIFF (T1) the purchase CHOOSES the line; from T2 up it
      // climbs within the line the ship already flies.
      const targetLine = prev.ship.typeTier === 1 ? line : prev.ship.line;
      if (!targetLine) return prev;
      const cost = typeStepPrice(targetLine, prev.ship.typeTier);
      const payment = walletPay(prev.ship.carrying, prev.bankedScrap, cost, inBankWell(prev.ship.pos, prev.star.pos, prev.star.size));
      if (!payment) return prev;

      const ship = { ...prev.ship, carrying: payment.carrying, line: targetLine, typeTier: (prev.ship.typeTier + 1) as TypeTier };
      // Hull steps persist (caps only grow with tier, so no clamp is
      // needed); the VAC bonus may have changed with the new type.
      ship.attractRadius = attractRadiusForShip(ship.upgrades.attractor, ship.line, ship.typeTier);
      return { ...prev, ship, bankedScrap: payment.banked, glitchActive: true, lastGlitchTime: performance.now(), lastUpgradeTime: performance.now() };
    });
  }, []);

  const buyHullStep = useCallback(() => {
    setState(prev => {
      if (!inBankWell(prev.ship.pos, prev.star.pos, prev.star.size)) return prev; // hull work happens at home
      // The type's hullStepCap is the gate: at the cap, growing further
      // REQUIRES a bigger type (Adam's two-ladder rule) — refuse here.
      if (prev.ship.hullSteps >= typeFor(prev.ship.line, prev.ship.typeTier).hullStepCap) return prev;
      const cost = hullStepPrice(prev.ship.hullSteps);
      const payment = walletPay(prev.ship.carrying, prev.bankedScrap, cost, inBankWell(prev.ship.pos, prev.star.pos, prev.star.size));
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

  const switchLine = useCallback((line: ShipLine) => {
    setState(prev => {
      if (!inBankWell(prev.ship.pos, prev.star.pos, prev.star.size)) return prev; // refits happen at home
      if (prev.ship.typeTier < 2 || !prev.ship.line || line === prev.ship.line) return prev;
      const toll = switchToll(prev.ship);
      const payment = walletPay(prev.ship.carrying, prev.bankedScrap, toll, inBankWell(prev.ship.pos, prev.star.pos, prev.star.size));
      if (!payment) return prev;

      // Tier, hull steps, track levels, and cargo all ride across —
      // only the line (and therefore the caps, peaks, and capability
      // amounts) changes. If hullSteps exceeds the new line/type's cap,
      // the steps STAY; the cap only refuses buying more (same rule as
      // track caps). The VAC bonus follows the new line immediately.
      const ship = { ...prev.ship, carrying: payment.carrying, line, lineSwitchesUsed: prev.ship.lineSwitchesUsed + 1 };
      ship.attractRadius = attractRadiusForShip(ship.upgrades.attractor, ship.line, ship.typeTier);
      return { ...prev, ship, bankedScrap: payment.banked, glitchActive: true, lastGlitchTime: performance.now(), lastUpgradeTime: performance.now() };
    });
  }, []);

  /**
   * Build one player drone (DRONE_PRICE, DRAFT — see shipProgression.ts).
   * This is also the REPLACEMENT path: a drone shot down is gone, and
   * the player rebuilds it here, up to the line/type's dronesFielded.
   */
  const buildDrone = useCallback(() => {
    setState(prev => {
      if (!inBankWell(prev.ship.pos, prev.star.pos, prev.star.size)) return prev; // drones are built at home
      const fielded = prev.drones.filter(d => d.owner === 'player').length;
      if (fielded >= typeFor(prev.ship.line, prev.ship.typeTier).dronesFielded) return prev;
      const payment = walletPay(prev.ship.carrying, prev.bankedScrap, DRONE_PRICE, inBankWell(prev.ship.pos, prev.star.pos, prev.star.size));
      if (!payment) return prev;

      const ship = { ...prev.ship, carrying: payment.carrying };
      const drone = {
        id: 'player-drone-' + Math.random().toString(36).substr(2, 9),
        pos: { x: prev.star.pos.x + 100, y: prev.star.pos.y + 100 },
        vel: { x: 0, y: 0 },
        angle: 0,
        targetId: null,
        carrying: 0,
        capacity: PHYSICS.DRONES.CAPACITY,
        owner: 'player' as const,
        ownerId: prev.ship.ownerId,
        state: 'searching' as const,
        health: 100,
      };
      return { ...prev, ship, bankedScrap: payment.banked, drones: [...prev.drones, drone], glitchActive: true, lastGlitchTime: performance.now(), lastUpgradeTime: performance.now() };
    });
  }, []);

  const toggleGauges = useCallback(() => {
    setState(prev => ({ ...prev, useAnalogGauges: !prev.useAnalogGauges }));
  }, []);

  const restart = useCallback(() => {
    window.location.reload(); // Simple for now as we don't have a complex state machine yet
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

  // Initial scrap
  useEffect(() => {
    const initialScrap = [];
    
    // Spawn several "Veins" or Belts
    for (let v = 0; v < 15; v++) {
      const vAngle = Math.random() * Math.PI * 2;
      const vDist = 500 + Math.random() * 4000;
      const vCenter = {
        x: width / 2 + Math.cos(vAngle) * vDist,
        y: height / 2 + Math.sin(vAngle) * vDist,
      };
      
      // Some rare large clusters, mostly smaller pockets
      const rand = Math.random();
      let pocketCount = 1;
      if (rand > 0.92) pocketCount = 12 + Math.floor(Math.random() * 15);
      else if (rand > 0.7) pocketCount = 4 + Math.floor(Math.random() * 6);
      else if (rand > 0.3) pocketCount = 2 + Math.floor(Math.random() * 2);
      
      for (let i = 0; i < pocketCount; i++) {
        initialScrap.push(spawnScrap(vCenter, pocketCount * 12));
      }
    }

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
          health: 100
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
          health: 100
        }
      ],
      star: anchoredStar,
      seats: s.seats.map(seat =>
        seat.starIndex === 0 ? { ...seat, star: anchoredStar, ship: s.ship } : seat,
      ),
      };
    });
  }, [width, height, spawnScrap]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keys.current.add(e.code);
      
      // Upgrade Hotkeys
      if (e.code === 'Digit1') upgrade('thrust');
      if (e.code === 'Digit2') upgrade('handling');
      if (e.code === 'Digit3') upgrade('attractor');
      if (e.code === 'Digit4') upgrade('fuel');
      if (e.code === 'Digit5') upgrade('cargo');
      if (e.code === 'KeyG') toggleGauges();
      if (e.code === 'KeyX') deployDecoy();
      if (e.code === 'KeyU' || e.code === 'Tab') {
        if (e.code === 'Tab') e.preventDefault();
        setState(prev => {
          // Same shop-well gate as toggleShop (Adam's pin, 2026-10-19).
          if (!prev.isShopOpen && !inBankWell(prev.ship.pos, prev.star.pos, prev.star.size)) {
            return { ...prev, shopRefusedAt: Date.now() };
          }
          return { ...prev, isShopOpen: !prev.isShopOpen };
        });
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [upgrade, deployDecoy]);

  useEffect(() => {
    let frameId: number;
    const loop = (time: number) => {
      setState(prev => {
        const next = { ...prev };
        const ship = { ...next.ship };
        const star = { ...next.star };
        const enemyStar = { ...next.enemyStar };

        // PER-SEAT PROJECTION (Phase 2, P2-2b): rebuild the seat
        // records around this frame's working copies, so everything
        // below can resolve stars/ships by ownerId through the seats
        // while the top-level fields stay the local seat's view.
        // seats[0] wraps `ship`/`star`, seats[1] wraps `enemyStar` —
        // the same objects the rest of the frame (and the returned
        // state) use. In SP this is exactly two seats; extra seats
        // (multiplayer matches) carry their own copies.
        const localOwnerId = ship.ownerId;
        const prevSeats: SeatSimState[] =
          prev.seats && prev.seats.length >= 2
            ? prev.seats
            : [
                createSeatSimState(star, 0, 'human', ship),
                createSeatSimState(enemyStar, 1, 'bot', null),
              ];
        const simSeats: SeatSimState[] = prevSeats.map((ps, i) => {
          const seat: SeatSimState = { ...ps };
          if (i === 0) {
            seat.ship = ship;
            seat.star = star;
            seat.bankedScrap = prev.bankedScrap;
          } else if (i === 1) {
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
        const starByOwnerId = (ownerId: string): Star =>
          seatByOwnerId.get(ownerId)?.star ??
          (ownerId === localOwnerId ? star : enemyStar);
        // This frame's host event-feed entries (kills credited below,
        // milestones/stage changes/eliminations at frame end). Pure
        // data — folded into state.eventFeed at the return.
        const feedEntries: EventFeedEntry[] = [];

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
        const aegisAbsorb = (dmg: number): number => {
          if (hyId !== 'scrap_aegis' || dmg <= 0) return dmg;
          let remaining = dmg;
          let credit = ship.aegisCredit || 0;
          if (credit > 0) {
            const used = Math.min(credit, remaining);
            credit -= used;
            remaining -= used;
          }
          const per = aegisAbsorbFor(hyTier);
          while (remaining > 0 && ship.carrying > 0) {
            ship.carrying -= 1;
            credit += per;
            const used = Math.min(credit, remaining);
            credit -= used;
            remaining -= used;
          }
          ship.aegisCredit = credit;
          return remaining;
        };

        // 1. Fuel & Inputs
        const stick = touchInputs.current.analogStick;
        const stickDist = stick ? Math.sqrt(stick.x * stick.x + stick.y * stick.y) : 0;
        const stickThrust = stickDist > 0.45;
        const wantsThrust = keys.current.has('ArrowUp') || keys.current.has('KeyW') || touchInputs.current.thrust || stickThrust;
        
        // Cargo Capacity (the line/type cargoBonus rides on top of the
        // cargo track; the overload ratio applies to the total, as ever)
        const regularCapacity = PHYSICS.CARGO.BASE_CAPACITY + ship.upgrades.cargo * PHYSICS.CARGO.UPGRADE_BONUS + typeFor(ship.line, ship.typeTier).cargoBonus;
        const overloadCapacity = Math.floor(regularCapacity * PHYSICS.CARGO.OVERLOAD_RATIO);
        const totalCapacity = regularCapacity + overloadCapacity;

        // Slowdown Penalty (Overload)
        let speedMult = 1.0;
        if (ship.carrying > regularCapacity) {
          const excess = ship.carrying - regularCapacity;
          speedMult = 1.0 - (excess / overloadCapacity) * PHYSICS.CARGO.SLOWDOWN_PENALTY;
        }

        if (wantsThrust && ship.fuel > PHYSICS.FUEL_CONSUMPTION) {
          ship.thrust = true;
          ship.fuel -= PHYSICS.FUEL_CONSUMPTION;
        } else {
          ship.thrust = false;
          ship.fuel = Math.min(ship.fuel + PHYSICS.FUEL_REGEN, ship.maxFuel);
        }

        // Auto-refuel from cargo
        if (ship.fuel < PHYSICS.FUEL_AUTO_CONVERT_THRESHOLD && ship.carrying > 0) {
          ship.carrying -= 1;
          ship.fuel += 40; // Buffed conversion
          next.glitchActive = true;
          next.lastGlitchTime = time;
        }

        // Ship Health Regen
        ship.health = Math.min(ship.health + 0.01, ship.maxHealth);

        // Ship Health Damage from hostile star proximity (P2-2b: any
        // star whose ownerId isn't the ship's — in SP that is exactly
        // the enemy star, with exactly the shipped math).
        // (The midpoint/centerDist computation that fed the retired
        // deep-space drain is gone too; the wrap below computes the
        // midpoint where it needs it.)
        for (const burnSeat of simSeats) {
          const burnStar = burnSeat.star;
          if (burnStar.ownerId === ship.ownerId) continue;
          const edx = burnStar.pos.x - ship.pos.x;
          const edy = burnStar.pos.y - ship.pos.y;
          const eDist = Math.sqrt(edx * edx + edy * edy);
          if (eDist >= burnStar.size + 150) continue;
          // The burn still bypasses the Deflector (heat, not bolts), but
          // the Scrap Aegis is armor, not shield — it soaks burn too.
          ship.health -= aegisAbsorb(0.15 * (1 - (eDist / (burnStar.size + 150))));
          // THORN HULL at point blank (Phase 1b): sitting in the burn is
          // the star point-blanking you, and the armor bites back —
          // thorn damage per second on the universal x0.002 star scale.
          if (hyId === 'thorn_hull') {
            burnStar.integrity = Math.max(0, burnStar.integrity - (thornDamageFor(hyTier) * 0.002) / 60);
            burnStar.lastHitTime = time;
          }
          if (Math.random() < 0.05) next.shakeAmount = 3;
        }
        // (The old deep-space drain past 6,000 from the midpoint is
        // RETIRED: the world wrap below caps the ship at ~3,000, so the
        // drain could never trigger again. Flagged per Adam's ruling.)

        // 2. Physics (Mass Scaling)
        const currentMass = PHYSICS.SHIP_MASS + (ship.carrying * PHYSICS.MASS_PER_CARGO);
        const currentRotSpeed = (PHYSICS.ROTATION_SPEED + ship.upgrades.handling * 0.005) / (1 + ship.carrying * 0.05);
        
        if (keys.current.has('ArrowLeft') || keys.current.has('KeyA') || touchInputs.current.rotateLeft) {
          ship.angle -= currentRotSpeed;
        }
        if (keys.current.has('ArrowRight') || keys.current.has('KeyD') || touchInputs.current.rotateRight) {
          ship.angle += currentRotSpeed;
        }

        // Analog stick rotational tracking
        if (stick && stickDist > 0.15) {
          const targetAngle = Math.atan2(stick.y, stick.x);
          let angleDiff = targetAngle - ship.angle;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          const maxTurn = currentRotSpeed * 1.5;
          const turn = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), maxTurn);
          ship.angle += turn;
        }

        if (ship.thrust) {
          const currentThrust = (PHYSICS.THRUST_POWER + ship.upgrades.thrust * 0.08) * speedMult * thrustFactor;
          // Accel = Force / Mass
          ship.vel.x += (Math.cos(ship.angle) * currentThrust) / currentMass;
          ship.vel.y += (Math.sin(ship.angle) * currentThrust) / currentMass;
        }

        // Active VAC Mode (Q, E, R or virtual touch)
        const isVacActive = keys.current.has('KeyQ') || keys.current.has('KeyE') || keys.current.has('KeyR') || touchInputs.current.vac;

        // Gravity from ALL seats' stars (SP: both stars, same order —
        // seat 0's star first, then seat 1's, as shipped)
        simSeats.forEach(seat => {
          const s = seat.star;
          const dx = s.pos.x - ship.pos.x;
          const dy = s.pos.y - ship.pos.y;
          const distSq = dx * dx + dy * dy;
          const dist = Math.sqrt(distSq);

          // Safer gravity: cap distance to prevent "infinite" pull
          const safeDistSq = Math.max(distSq, s.size * s.size);
          const isHomeStar = s.ownerId === ship.ownerId;
          const shipGravityModifier = isHomeStar ? 0.2 : 0.6; // Much weaker pull for home
          
          const force = ((PHYSICS.G * s.mass * shipGravityModifier) / safeDistSq) * gravFactor;
          
          const ax = (force * dx) / (dist || 1);
          const ay = (force * dy) / (dist || 1);
          ship.vel.x += ax / currentMass;
          ship.vel.y += ay / currentMass;

          // Repulsion buffer (Anti-Stuck Logic)
          // If ship is inside the star's physical radius, push it out firmly
          const repulsionRadius = s.size + 10;
          if (dist < repulsionRadius) {
            const repulsion = (repulsionRadius - dist) * 0.25;
            ship.vel.x -= (dx / (dist || 1)) * repulsion;
            ship.vel.y -= (dy / (dist || 1)) * repulsion;
            
            // Dampen velocity when hitting the star to prevent weird bouncing/gluing
            if (dist < s.size) {
              ship.vel.x *= 0.8;
              ship.vel.y *= 0.8;
            }
          }
        });

        // MIRROR SAIL light-catch (Phase 1b): near a bright star the sail
        // turns starlight into thrust — radiation pressure, a gentle push
        // straight AWAY from the star, strongest close in and gone past
        // SAIL_RANGE. It is not gravity, so Grav Dampers neither cut it
        // nor are cut by it; and like engine thrust it is divided by ship
        // mass, so a heavy hold catches less push. Always on — a sail
        // catches light whether or not the engine is burning.
        if (hyId === 'mirror_sail') {
          const sailForce = sailThrustFor(hyTier);
          simSeats.forEach(seat => {
            const s = seat.star;
            const dx = ship.pos.x - s.pos.x;
            const dy = ship.pos.y - s.pos.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 1 && dist < SAIL_RANGE) {
              const push = (sailForce * (1 - dist / SAIL_RANGE)) / currentMass;
              ship.vel.x += (dx / dist) * push;
              ship.vel.y += (dy / dist) * push;
            }
          });
        }

        // Inertia & Friction (Handling improvements)
        const currentFriction = Math.max(PHYSICS.FRICTION - ship.upgrades.handling * 0.01, PHYSICS.FRICTION_MAX);
        ship.vel.x *= currentFriction;
        ship.vel.y *= currentFriction;

        // Cap Velocity
        const currentMaxVel = PHYSICS.MAX_VELOCITY + ship.upgrades.thrust * 0.5;
        const currentVel = Math.sqrt(ship.vel.x ** 2 + ship.vel.y ** 2);
        if (currentVel > currentMaxVel) {
          const ratio = currentMaxVel / currentVel;
          ship.vel.x *= ratio;
          ship.vel.y *= ratio;
        }

        // Position Updates
        ship.pos.x += ship.vel.x;
        ship.pos.y += ship.vel.y;

        // WORLD WRAP (Adam's ruling, 2026-10-20, via the UI chat): no
        // wall, no bounce — cross the boundary circle and point-reflect
        // through the stars' midpoint (pos' = 2*center - pos), velocity
        // and heading untouched. Out the west edge heading west, you
        // reappear at the east edge still heading west: back into the
        // map, and (per the margin in constants) never into an ambush.
        // This replaces the old 5,000-unit axis velocity-flip, which was
        // an invisible wall wearing a fake moustache.
        const wcx = (star.pos.x + enemyStar.pos.x) / 2;
        const wcy = (star.pos.y + enemyStar.pos.y) / 2;
        const wdx = ship.pos.x - wcx;
        const wdy = ship.pos.y - wcy;
        if (wdx * wdx + wdy * wdy > PHYSICS.WORLD.WRAP_RADIUS * PHYSICS.WORLD.WRAP_RADIUS) {
          ship.pos.x = 2 * wcx - ship.pos.x;
          ship.pos.y = 2 * wcy - ship.pos.y;
        }

        // Scrap Collection, ATTRACTION and CULLING
        const newScrap = next.scrap.filter(d => {
          const ddx = ship.pos.x - d.pos.x;
          const ddy = ship.pos.y - d.pos.y;
          const dDistSq = ddx * ddx + ddy * ddy;
          const dDist = Math.sqrt(dDistSq);

          // Cull distant scrap (2500 units) to keep memory clean and allow new spawns
          if (dDist > 4000) return false;

          const attractLimit = isVacActive ? ship.attractRadius * 1.6 : ship.attractRadius;
          if (dDist < attractLimit) {
            let pullForce = PHYSICS.DUST_ATTRACT_FORCE * (1 + ship.upgrades.attractor * 0.6);
            if (isVacActive) pullForce *= PHYSICS.ACTIVE_VAC_MULTIPLIER;
            d.pos.x += (ddx / dDist) * pullForce;
            d.pos.y += (ddy / dDist) * pullForce;
          }

          if (dDistSq < (PHYSICS.AUTO_COLLECT_RADIUS ** 2)) { 
            if (ship.carrying < totalCapacity) {
              ship.carrying += 1;
              return false;
            }
          }
          return true;
        });

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

        // 277. Enemy Sabotage (Legacy check - we'll replace this with the projectile system)
        const wantsJettison = keys.current.has('Space') || touchInputs.current.jettison;
        
        // Handle Ejection
        if (wantsJettison && ship.carrying > 0 && (!next.lastEjectTime || time - next.lastEjectTime > 100)) {
          ship.carrying -= 1;
          next.lastEjectTime = time;
          
          // Eject in direction of travel + extra kick
          const kickDir = ship.angle;
          const kickForce = 8;
          next.deployedCargo.push({
            id: Math.random().toString(),
            pos: { ...ship.pos },
            vel: {
              x: ship.vel.x + Math.cos(kickDir) * kickForce,
              y: ship.vel.y + Math.sin(kickDir) * kickForce,
            },
            color: '#f472b6',
            ownerId: ship.ownerId,
            life: 200, // frames
          });
        }

        // SHIP WEAPON FIRE (Slice 4): the equipped weapon shoots down the
        // ship's nose. Hold F on desktop or the FIRE button on mobile.
        // Stats and tier scaling: src/loadout.ts WEAPON_STATS.
        const wantsFire = keys.current.has('KeyF') || touchInputs.current.fire;
        const weaponId = ship.loadout.weapon;
        const wStats = weaponStatsFor(weaponId, weaponId ? (ship.arsenal[weaponId] || 0) : 0);
        if (wantsFire && wStats && time >= (ship.fireReadyAt || 0)) {
          const cost = wStats.scrapCost || 0;
          if (wStats.kind === 'mine') {
            // Mine Layer: no projectile — mines drop at the ship's tail.
            // HARD POINTS DO NOT APPLY to mines (Phase 3): a drop lays
            // the line/type's minesPerDrop instead, each still costing
            // 1 hold scrap — the drop lays only as many as the hold
            // affords, fanned across the tail so they don't stack-trip.
            const perDrop = typeFor(ship.line, ship.typeTier).minesPerDrop;
            const dropCount = cost > 0 ? Math.min(perDrop, Math.floor(ship.carrying / cost)) : perDrop;
            if (dropCount > 0) {
              ship.carrying -= dropCount * cost;
              ship.fireReadyAt = time + wStats.cooldownMs;
              for (let mi = 0; mi < dropCount; mi++) {
                const lateral = (mi - (dropCount - 1) / 2) * 16;
                (next.mines = next.mines || []).push({
                  id: Math.random().toString(),
                  pos: {
                    x: ship.pos.x - Math.cos(ship.angle) * mi * 8 - Math.sin(ship.angle) * lateral,
                    y: ship.pos.y - Math.sin(ship.angle) * mi * 8 + Math.cos(ship.angle) * lateral,
                  },
                  damage: wStats.damage,
                  radius: wStats.radius || 115,
                  ownerId: ship.ownerId,
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
            const mounts = typeFor(ship.line, ship.typeTier).hardPoints;
            let firedAny = false;
            for (let m = 0; m < mounts; m++) {
              if (cost > 0) {
                if (ship.carrying < cost) break;
                ship.carrying -= cost;
              }
              const dmgScale = m === 0 ? 1 : EXTRA_MOUNT_DAMAGE;
              const side = m === 0 ? 0 : (m % 2 === 1 ? 1 : -1) * Math.ceil(m / 2);
              const off = side * ship.size * 0.7;
              const muzzle = {
                x: ship.pos.x + Math.cos(ship.angle) * (ship.size + 4) - Math.sin(ship.angle) * off,
                y: ship.pos.y + Math.sin(ship.angle) * (ship.size + 4) + Math.cos(ship.angle) * off,
              };
              const pellets = wStats.pellets || 1;
              for (let pi = 0; pi < pellets; pi++) {
                const spreadOffset = pellets > 1 ? (pi / (pellets - 1) - 0.5) * (wStats.spread || 0) : 0;
                const a = ship.angle + spreadOffset;
                next.projectiles.push({
                  id: Math.random().toString(),
                  pos: { ...muzzle },
                  vel: {
                    x: Math.cos(a) * wStats.speed + ship.vel.x * 0.5,
                    y: Math.sin(a) * wStats.speed + ship.vel.y * 0.5,
                  },
                  owner: 'player',
                  ownerId: ship.ownerId,
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
            if (firedAny) ship.fireReadyAt = time + wStats.cooldownMs;
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
          for (const seat of simSeats) {
            const s = seat.star;
            const dx = s.pos.x - c.pos.x;
            const dy = s.pos.y - c.pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < s.size + 10) {
              const amount = 1;
              if (c.ownerId === s.ownerId) {
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
        if (next.isShopOpen && !inBankWell(ship.pos, star.pos, star.size)) {
          next.isShopOpen = false;
        }

        // Win/Loss Conditions
        if (enemyStar.integrity <= 0 && !next.isVictory) {
          next.isVictory = true;
        }
        if (ship.health <= 0 && !next.isGameOver) {
          next.isGameOver = true;
        }
        if (next.isVictory || next.isGameOver) {
          ship.thrust = false;
        }

        // 5. Drones Logic
        next.drones = (next.drones || []).map(drone => {
          // Home star by ownerId (P2-2b): the drone's seat's star.
          // (Fallback to the legacy pair if an ownerId ever misses
          // the seat table — unreachable in SP, where every drone is
          // seat-0's or seat-1's.)
          const droneStar =
            seatByOwnerId.get(drone.ownerId)?.star ??
            (drone.owner === 'player' ? star : enemyStar);

          // Ion stun: a rebooting drone hangs dead in space, timer ticking.
          if (drone.stunFrames && drone.stunFrames > 0) {
            drone.stunFrames -= 1;
            return drone;
          }

          // Decoy Beacon: hostile drones within 500 chase the beacon
          // instead of working — it screams "hostile" louder than scrap
          // whispers, and a returning drone delays its delivery to chase
          // it. (Hostile = not the decoy's seat; in SP, the enemy's.)
          if (next.decoy && drone.ownerId !== next.decoy.ownerId) {
            const bx = next.decoy.pos.x - drone.pos.x;
            const by = next.decoy.pos.y - drone.pos.y;
            const bd = Math.hypot(bx, by);
            if (bd < 500) {
              const ba = Math.atan2(by, bx);
              drone.angle += (ba - drone.angle) * PHYSICS.DRONES.ROTATE_SPEED;
              if (bd > 30) {
                drone.pos.x += Math.cos(drone.angle) * PHYSICS.DRONES.SPEED;
                drone.pos.y += Math.sin(drone.angle) * PHYSICS.DRONES.SPEED;
              }
              return drone;
            }
          }
          
          if (drone.state === 'searching') {
            // Find closest scrap
            let closestScrap = null;
            let minDist = Infinity;
            next.scrap.forEach(s => {
              const dx = s.pos.x - drone.pos.x;
              const dy = s.pos.y - drone.pos.y;
              const d = dx * dx + dy * dy;
              if (d < minDist) {
                minDist = d;
                closestScrap = s;
              }
            });

            if (closestScrap) {
              drone.targetId = (closestScrap as any).id;
              drone.state = 'collecting';
            }
          }

          if (drone.state === 'collecting') {
            const target = next.scrap.find(s => s.id === drone.targetId);
            if (!target) {
              drone.state = 'searching';
              drone.targetId = null;
            } else {
              const dx = target.pos.x - drone.pos.x;
              const dy = target.pos.y - drone.pos.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              
              const targetAngle = Math.atan2(dy, dx);
              drone.angle += (targetAngle - drone.angle) * PHYSICS.DRONES.ROTATE_SPEED;
              
              drone.pos.x += Math.cos(drone.angle) * PHYSICS.DRONES.SPEED;
              drone.pos.y += Math.sin(drone.angle) * PHYSICS.DRONES.SPEED;

              if (dist < PHYSICS.DRONES.COLLECT_RADIUS) {
                drone.carrying += 1;
                // Remove scrap from world
                next.scrap = next.scrap.filter(s => s.id !== drone.targetId);
                drone.targetId = null;
                
                if (drone.carrying >= drone.capacity) {
                  drone.state = 'returning';
                } else {
                  drone.state = 'searching';
                }
              }
            }
          }

          if (drone.state === 'returning') {
            const dx = droneStar.pos.x - drone.pos.x;
            const dy = droneStar.pos.y - drone.pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            const targetAngle = Math.atan2(dy, dx);
            drone.angle += (targetAngle - drone.angle) * PHYSICS.DRONES.ROTATE_SPEED;
            
            drone.pos.x += Math.cos(drone.angle) * PHYSICS.DRONES.SPEED;
            drone.pos.y += Math.sin(drone.angle) * PHYSICS.DRONES.SPEED;

            if (dist < droneStar.size + PHYSICS.DRONES.DEPOSIT_RADIUS) {
              const amount = drone.carrying;
              // Every star grows through the SAME rising milestone
              // system (starGrowth.ts) — no per-delivery creep — and
              // gets the SAME symmetric delivery heal (starDefense.ts).
              // The local seat's deliveries also feed teamScrap, the
              // SP fed counter the HUD reads.
              infuseStar(droneStar, amount);
              applyDeliveryHeal(droneStar, amount);
              if (drone.ownerId === localOwnerId) {
                teamScrap += amount;
              }
              drone.carrying = 0;
              drone.state = 'searching';
            }
          }

          return drone;
        });

        // Decoy lifetime (Slice 6)
        if (next.decoy) {
          next.decoy = { ...next.decoy, lifeFrames: next.decoy.lifeFrames - 1 };
          if (next.decoy.lifeFrames <= 0) next.decoy = null;
        }

        // MINES (Slice 4): a hostile drone wandering inside a mine's
        // radius trips it — everything hostile in the blast takes the
        // damage, including hostile stars if one is somehow close.
        // (Hostile = not the mine's seat; in SP, the enemy's.)
        next.mines = (next.mines || []).filter(mine => {
          const tripped = next.drones.some(d => d.ownerId !== mine.ownerId &&
            Math.hypot(d.pos.x - mine.pos.x, d.pos.y - mine.pos.y) < mine.radius);
          if (!tripped) return true;
          next.drones.forEach(d => {
            if (d.ownerId !== mine.ownerId && Math.hypot(d.pos.x - mine.pos.x, d.pos.y - mine.pos.y) < mine.radius) {
              d.health -= mine.damage;
              d.lastHitByOwnerId = mine.ownerId;
            }
          });
          for (const seat of simSeats) {
            const s = seat.star;
            if (s.ownerId === mine.ownerId) continue;
            if (Math.hypot(s.pos.x - mine.pos.x, s.pos.y - mine.pos.y) < mine.radius + s.size) {
              s.integrity -= mine.damage * 0.002;
              s.lastHitTime = time;
            }
          }
          next.shakeAmount = Math.max(next.shakeAmount, 12);
          return false;
        });

        // 6. Projectiles and Defense
        next.projectiles = (next.projectiles || []).filter(p => {
          // Seeker torpedoes steer toward the nearest hostile drone,
          // turning at most 0.15 rad/frame so they arc rather than snap.
          if (p.kind === 'seeker_torpedoes') {
            let best: any = null;
            let bestD = 700;
            next.drones.forEach(d => {
              if (d.ownerId === p.ownerId) return;
              const dd = Math.hypot(d.pos.x - p.pos.x, d.pos.y - p.pos.y);
              if (dd < bestD) { bestD = dd; best = d; }
            });
            if (best) {
              const cur = Math.atan2(p.vel.y, p.vel.x);
              const want = Math.atan2(best.pos.y - p.pos.y, best.pos.x - p.pos.x);
              let diff = want - cur;
              while (diff > Math.PI) diff -= Math.PI * 2;
              while (diff < -Math.PI) diff += Math.PI * 2;
              const turn = Math.max(-0.15, Math.min(0.15, diff));
              const spd = Math.hypot(p.vel.x, p.vel.y) || 9.5;
              p.vel.x = Math.cos(cur + turn) * spd;
              p.vel.y = Math.sin(cur + turn) * spd;
            }
          }

          p.pos.x += p.vel.x;
          p.pos.y += p.vel.y;
          p.life -= 1;

          // SIPHON VAC (Phase 1b): while the VAC runs, the tractor beam
          // eats enemy projectiles that cross its field and converts them
          // into a trickle of fuel. INTERPRETATION (flagged for Adam):
          // the description names the tractor beam, and in this code the
          // beam's deliberate mode is ACTIVE VAC (Q/E/R) — so eating is
          // gated on VAC being held, over the same radius that hauls
          // scrap while VAC is on (attractRadius x 1.6). Ungated, the
          // passive attract field would eat every bolt near the ship and
          // quietly retire the Deflector Shield's whole job.
          if (hyId === 'siphon_vac' && p.ownerId !== ship.ownerId && isVacActive &&
              Math.hypot(ship.pos.x - p.pos.x, ship.pos.y - p.pos.y) < ship.attractRadius * 1.6) {
            ship.fuel = Math.min(ship.maxFuel, ship.fuel + siphonFuelFor(hyTier));
            return false;
          }

          // Collision with the DECOY beacon (Slice 6): hostile bolts eat
          // the beacon instead of the ship, until it is shot down.
          if (next.decoy && p.ownerId !== next.decoy.ownerId &&
              Math.hypot(next.decoy.pos.x - p.pos.x, next.decoy.pos.y - p.pos.y) < 12) {
            // The bolt's own damage — star turret bolts carry their tier
            // damage (Phase 1c); absent a field, the stock DEFENSE damage.
            next.decoy = { ...next.decoy, health: next.decoy.health - (p.damage !== undefined ? p.damage : PHYSICS.DEFENSE.DAMAGE) };
            if (next.decoy.health <= 0) next.decoy = null;
            return false;
          }

          // Collision with the LOCAL ship (hostile bolts only — the
          // local ship's defenses below are player systems and stay
          // bound to this seat; other seats' ships take plain hits in
          // the bot-ship pass after this one)
          const sdx = ship.pos.x - p.pos.x;
          const sdy = ship.pos.y - p.pos.y;
          if (p.ownerId !== ship.ownerId && Math.sqrt(sdx * sdx + sdy * sdy) < ship.size) {
            // MIRROR SAIL (Phase 1b): the bolt never lands — the sail
            // throws it back the way it came, as a player projectile with
            // tier-scaled damage ("defense that is offense"), keeping
            // whatever flight life it had left. The Deflector never sees
            // it: reflection happens at the sail, outside the bubble.
            // Falling out of this branch with the bolt mutated, it flows
            // on into the drone/star hit checks below as a player shot.
            if (hyId === 'mirror_sail') {
              p.owner = 'player';
              p.ownerId = ship.ownerId;
              p.vel.x = -p.vel.x;
              p.vel.y = -p.vel.y;
              p.damage = mirrorReflectDamageFor(hyTier);
              p.kind = 'mirror_sail';
              next.shakeAmount = Math.max(next.shakeAmount, 5);
              next.glitchActive = true;
              next.lastGlitchTime = time;
            } else {
            // The bolt's own damage — enemy bolts are star turret bolts
            // and carry their tier damage (Phase 1c); the fallback keeps
            // the stock DEFENSE damage where a field is absent.
            let dmg = p.damage !== undefined ? p.damage : PHYSICS.DEFENSE.DAMAGE;
            // Deflector Shield eats bolts before they reach the hull;
            // whatever overflows the pool is what the hull feels.
            if (ship.shield && ship.shield > 0) {
              const absorbed = Math.min(ship.shield, dmg);
              ship.shield -= absorbed;
              dmg -= absorbed;
              ship.shieldHitAt = time;
            }
            // Scrap Aegis burns cargo for whatever gets past the shield.
            if (dmg > 0) dmg = aegisAbsorb(dmg);
            if (dmg > 0) {
              ship.health -= dmg;
              ship.lastHitByOwnerId = p.ownerId;
              // THORN HULL (Phase 1b): a bolt that reaches the hull was
              // fired point blank — the armor bites the firing star back
              // on the universal x0.002 scale. Bolts the shield or aegis
              // ate never touch the armor, so they don't bite. (The
              // firing star is the bolt owner's star — in SP, the
              // enemy star, as shipped.)
              if (hyId === 'thorn_hull') {
                const firingStar = starByOwnerId(p.ownerId);
                firingStar.integrity -= thornDamageFor(hyTier) * 0.002;
                firingStar.lastHitTime = time;
              }
              next.shakeAmount = 15;
            } else {
              next.shakeAmount = Math.max(next.shakeAmount, 5);
            }
            } // (end of the non-mirror damage path)
            if (hyId !== 'mirror_sail') {
              next.glitchActive = true;
              next.lastGlitchTime = time;
              return false;
            }
            // A reflected bolt falls through: the checks below now treat
            // it as the player shot it has become.
          }

          // Collision with OTHER SEATS' SHIPS (Phase 2, P2-2b): any
          // projectile hostile to a bot seat's ship strikes it — plain
          // hull damage, no loadout defenses (those are player systems,
          // bound to the local ship above). SP's enemy seat flies no
          // ship, so this pass is inert in the shipped game. A ship
          // reduced to 0 is removed by the bot-ship death pass below.
          for (const seat of simSeats) {
            const bs = seat.ship;
            if (!bs || seat.ownerId === localOwnerId || p.ownerId === seat.ownerId) continue;
            if ((p.hitIds || []).includes(seat.ownerId)) continue;
            if (Math.hypot(bs.pos.x - p.pos.x, bs.pos.y - p.pos.y) >= bs.size) continue;
            bs.health -= p.damage !== undefined ? p.damage : PHYSICS.DEFENSE.DAMAGE;
            bs.lastHitByOwnerId = p.ownerId;
            if (p.pierce) {
              (p.hitIds = p.hitIds || []).push(seat.ownerId);
            } else {
              return false;
            }
          }

          // Collision with hostile DRONES (ship weapons only — the gate
          // keys on `kind`, which ship weapons and mirror-reflected
          // bolts carry and star turret bolts never do; turret bolts
          // carry damage since Phase 1c but keep their old pass-through
          // behavior against drones)
          if (p.damage !== undefined && p.kind !== undefined) {
            const hitDrone = next.drones.find(d => d.ownerId !== p.ownerId &&
              !(p.hitIds || []).includes(d.id) &&
              Math.hypot(d.pos.x - p.pos.x, d.pos.y - p.pos.y) < 14);
            if (hitDrone) {
              hitDrone.health -= p.damage;
              hitDrone.lastHitByOwnerId = p.ownerId;
              if (p.kind === 'ion_blaster') {
                // Ion disable: the drone reboots (stunned, no movement)
                // and drops whatever scrap it was carrying.
                hitDrone.stunFrames = 90;
                for (let di = 0; di < hitDrone.carrying; di++) {
                  newScrap.push({
                    id: Math.random().toString(),
                    pos: { x: hitDrone.pos.x + (Math.random() - 0.5) * 24, y: hitDrone.pos.y + (Math.random() - 0.5) * 24 },
                    color: COLORS.SCRAP[Math.floor(Math.random() * COLORS.SCRAP.length)],
                  });
                }
                hitDrone.carrying = 0;
              }
              if (p.pierce) {
                (p.hitIds = p.hitIds || []).push(hitDrone.id);
              } else {
                return false;
              }
            }
          }

          // Collision with hostile STARS (P2-2b). The shipped rule is
          // deliberately NOT symmetric, and this preserves it exactly:
          // in SP only the PLAYER side's fire damages a star — the
          // local ship's weapons, the local star's turret bolts, and
          // mirror-reflected bolts chip the enemy star, while enemy
          // turret bolts fly THROUGH the home star (they are aimed at
          // the ship, and the ship is how the enemy side wins). So:
          // ship-fired projectiles (kind set) damage any hostile star;
          // star-turret bolts (kind unset) damage hostile stars only
          // when fired by the LOCAL seat's star. In SP that reduces to
          // the shipped block precisely. (Full symmetric star-vs-star
          // bolt damage is a multiplayer tuning question, flagged for
          // P2-3 — not silently introduced here.)
          if (p.kind !== undefined || p.ownerId === localOwnerId) {
            for (const seat of simSeats) {
              const s = seat.star;
              if (s.ownerId === p.ownerId) continue;
              const edx = s.pos.x - p.pos.x;
              const edy = s.pos.y - p.pos.y;
              const hitKey = `star:${s.ownerId}`;
              if (Math.sqrt(edx * edx + edy * edy) < s.size && !(p.hitIds || []).includes(hitKey)) {
                // REPAIR (Slice 4): this used to subtract DAMAGE x 0.5 = 5 from
                // a 0..1 integrity scale — a single turret hit would have ended
                // the game outright. Star damage is now damage x 0.002 for every
                // shooter: a T1 bolt chips 0.024, a T5 rail lance lands 0.186.
                s.integrity -= (p.damage !== undefined ? p.damage : PHYSICS.DEFENSE.DAMAGE) * 0.002;
                s.lastHitTime = time;
                if (p.pierce) {
                  (p.hitIds = p.hitIds || []).push(hitKey);
                } else {
                  return false;
                }
              }
            }
          }

          return p.life > 0;
        });

        // POINT-DEFENSE ZAP (Slice 6): fully automatic — the single
        // nearest hostile bolt OR drone inside PD_RANGE gets zapped, one
        // target per cooldown. Bolts are destroyed; drones take damage
        // (and the death sweep below turns kills into dropped scrap).
        if (defId === 'pd_zap' && time >= (ship.pdReadyAt || 0)) {
          let zapTarget: any = null;
          let hitProj: any = null;
          let hitDrone: any = null;
          let bestD = PD_RANGE;
          next.projectiles.forEach(p => {
            if (p.ownerId === ship.ownerId) return;
            const dd = Math.hypot(p.pos.x - ship.pos.x, p.pos.y - ship.pos.y);
            if (dd < bestD) { bestD = dd; hitProj = p; hitDrone = null; zapTarget = p.pos; }
          });
          next.drones.forEach(d => {
            if (d.ownerId === ship.ownerId) return;
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

        // CRUISER AUTO-GUNS (Phase 3): the cruiser line's shipboard
        // turrets fire on their own — each gun independently rolls its
        // fire chance per frame at the NEAREST hostile in range (an
        // enemy drone, else the enemy star). They never focus-fire the
        // pilot's target; the pilot's own weapon is separate. Bolts are
        // ordinary player projectiles with kind 'auto_gun', so they run
        // the same drone/star hit paths as ship weapons (star turret
        // bolts pass drones by leaving kind unset; these set it, so
        // they connect with drones too — that's their job).
        const autoGunCount = typeFor(ship.line, ship.typeTier).autoGuns;
        if (autoGunCount > 0) {
          let gunTarget: Vector2D | null = null;
          let gunBestD = AUTO_GUN.range;
          next.drones.forEach(d => {
            if (d.ownerId === ship.ownerId) return;
            const dd = Math.hypot(d.pos.x - ship.pos.x, d.pos.y - ship.pos.y);
            if (dd < gunBestD) { gunBestD = dd; gunTarget = d.pos; }
          });
          if (!gunTarget) {
            // Nearest hostile star (SP: the enemy star, as shipped —
            // measured to its center, edge proximity does not trigger).
            for (const seat of simSeats) {
              const s = seat.star;
              if (s.ownerId === ship.ownerId) continue;
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
        if (hyId === 'thorn_hull') {
          const thornPerFrame = thornDamageFor(hyTier) / 60;
          next.drones.forEach(d => {
            if (d.ownerId === ship.ownerId) return;
            if (Math.hypot(d.pos.x - ship.pos.x, d.pos.y - ship.pos.y) < ship.size + 14) {
              d.health -= thornPerFrame;
              d.lastHitByOwnerId = ship.ownerId;
            }
          });
        }

        // CME — CORONAL MASS EJECTIONS (Slice 7). Each star fires one
        // about every 30 s (Adam's pin), stronger each of its milestones.
        // Telegraph: CHARGE_MS before firing, the star charges and LOCKS
        // its aim at the nearest hostile — move, and the cone misses you.
        // Default shot is directed; 10% x M (cap 90%) goes radial instead.
        // The wave DISSIPATES (Adam's pin): damage and knockback scale
        // with (1 - radius / maxRange), and the wave dies at max range —
        // outrunning a CME is a real defense.
        simSeats.forEach(seat => {
          const s = seat.star;
          if (s.cmeNextAt === undefined) s.cmeNextAt = time + PHYSICS.CME.INTERVAL_MS;
          if (!s.cmeChargeEndsAt && time >= s.cmeNextAt - PHYSICS.CME.CHARGE_MS) {
            s.cmeChargeEndsAt = s.cmeNextAt;
            // Aim at the nearest hostile, locked for the whole telegraph.
            // (P2-2b generalization, SP-exact: the LOCAL seat's star
            // aims at the nearest hostile drone, else the nearest
            // hostile star — the shipped home-star behavior. Every
            // other star aims at a hostile decoy if one is deployed,
            // else the nearest hostile ship, else the nearest hostile
            // star — the shipped enemy-star behavior, whose decoy and
            // target ship in SP are the player's.)
            if (s.ownerId === localOwnerId) {
              // Shipped preference order: the nearest hostile DRONE if
              // one exists at all, else the (nearest hostile) star.
              let bt: any = null;
              let bd = Infinity;
              next.drones.forEach(d => {
                if (d.ownerId === s.ownerId) return;
                const dd = Math.hypot(d.pos.x - s.pos.x, d.pos.y - s.pos.y);
                if (dd < bd) { bd = dd; bt = d; }
              });
              if (!bt) {
                let sd = Infinity;
                for (const os of simSeats) {
                  if (os.ownerId === s.ownerId) continue;
                  const dd = Math.hypot(os.star.pos.x - s.pos.x, os.star.pos.y - s.pos.y);
                  if (dd < sd) { sd = dd; bt = os.star; }
                }
              }
              s.cmeAimAngle = Math.atan2(bt.pos.y - s.pos.y, bt.pos.x - s.pos.x);
            } else {
              let t: { x: number; y: number } | null = null;
              if (next.decoy && next.decoy.ownerId !== s.ownerId) {
                t = next.decoy.pos;
              }
              if (!t) {
                let bd = Infinity;
                for (const os of simSeats) {
                  if (!os.ship || os.ownerId === s.ownerId) continue;
                  const dd = Math.hypot(os.ship.pos.x - s.pos.x, os.ship.pos.y - s.pos.y);
                  if (dd < bd) { bd = dd; t = os.ship.pos; }
                }
              }
              if (!t) {
                let bd = Infinity;
                for (const os of simSeats) {
                  if (os.ownerId === s.ownerId) continue;
                  const dd = Math.hypot(os.star.pos.x - s.pos.x, os.star.pos.y - s.pos.y);
                  if (dd < bd) { bd = dd; t = os.star.pos; }
                }
              }
              s.cmeAimAngle = Math.atan2(t!.y - s.pos.y, t!.x - s.pos.x);
            }
          }
          if (s.cmeChargeEndsAt && time >= s.cmeChargeEndsAt) {
            const M = milestonesForInfused(s.totalScrapInfused);
            const radial = Math.random() < Math.min(0.9, 0.1 * M);
            (next.cmes = next.cmes || []).push({
              id: Math.random().toString(),
              owner: s.ownerId === localOwnerId ? 'home' : 'enemy',
              ownerId: s.ownerId,
              pos: { ...s.pos },
              dirAngle: radial ? null : (s.cmeAimAngle ?? 0),
              radius: s.size,
              speed: PHYSICS.CME.SPEED,
              maxRange: PHYSICS.CME.BASE_RANGE + PHYSICS.CME.RANGE_PER_M * M,
              baseDamage: PHYSICS.CME.BASE_DAMAGE + PHYSICS.CME.DAMAGE_PER_M * M,
              baseKnockback: PHYSICS.CME.BASE_KNOCKBACK + PHYSICS.CME.KNOCKBACK_PER_M * M,
              milestone: M,
              hitIds: [],
            });
            s.cmeChargeEndsAt = undefined;
            s.cmeAimAngle = undefined;
            s.cmeNextAt = time + PHYSICS.CME.INTERVAL_MS + Math.random() * PHYSICS.CME.JITTER_MS;
          }
        });

        // Advance the waves and apply whatever they wash over.
        next.cmes = (next.cmes || []).filter(w => {
          w.radius += w.speed;
          if (w.radius > w.maxRange) return false;
          const falloff = Math.max(0, 1 - w.radius / w.maxRange);
          const inBand = (p: { x: number; y: number }) =>
            Math.abs(Math.hypot(p.x - w.pos.x, p.y - w.pos.y) - w.radius) < PHYSICS.CME.BAND;
          const inCone = (p: { x: number; y: number }) => {
            if (w.dirAngle === null) return true;
            let dd = Math.atan2(p.y - w.pos.y, p.x - w.pos.x) - w.dirAngle;
            while (dd > Math.PI) dd -= Math.PI * 2;
            while (dd < -Math.PI) dd += Math.PI * 2;
            return Math.abs(dd) < PHYSICS.CME.CONE_RAD;
          };
          const shoveVec = (p: { x: number; y: number }, kb: number) => {
            const dx = p.x - w.pos.x;
            const dy = p.y - w.pos.y;
            const d = Math.hypot(dx, dy) || 1;
            return { x: (dx / d) * kb, y: (dy / d) * kb };
          };
          const washDrone = (d: any) => {
            if (w.hitIds.includes(d.id) || !inBand(d.pos) || !inCone(d.pos)) return;
            w.hitIds.push(d.id);
            d.health -= w.baseDamage * falloff;
            d.lastHitByOwnerId = w.ownerId;
            const sv = shoveVec(d.pos, w.baseKnockback * falloff * 2);
            d.pos.x += sv.x;
            d.pos.y += sv.y;
            d.stunFrames = Math.max(d.stunFrames || 0, 30);
          };

          if (w.ownerId !== localOwnerId) {
            // A DIRECTED hostile CME eats the decoy whole: the beacon dies,
            // the wave dies with it. A radial one just washes past it.
            if (next.decoy && next.decoy.ownerId !== w.ownerId && !w.hitIds.includes('decoy') && inBand(next.decoy.pos) && inCone(next.decoy.pos)) {
              w.hitIds.push('decoy');
              next.decoy = null;
              if (w.dirAngle !== null) return false;
            }
            if (!w.hitIds.includes('ship') && inBand(ship.pos) && inCone(ship.pos)) {
              w.hitIds.push('ship');
              // CME Hardening (finally consuming its table) cuts both the
              // damage and the knockback; Grav Dampers cut knockback too.
              const red = defId === 'cme_hardening' ? cmeReductionFor(defTier) : 0;
              let dmg = w.baseDamage * falloff * (1 - red);
              if (ship.shield && ship.shield > 0) {
                const absorbed = Math.min(ship.shield, dmg);
                ship.shield -= absorbed;
                dmg -= absorbed;
                ship.shieldHitAt = time;
              }
              // Scrap Aegis burns cargo for whatever gets past the shield.
              if (dmg > 0) dmg = aegisAbsorb(dmg);
              if (dmg > 0) {
                ship.health -= dmg;
                ship.lastHitByOwnerId = w.ownerId;
              }
              const kb = w.baseKnockback * falloff * (1 - red) * gravFactor;
              const sv = shoveVec(ship.pos, kb);
              ship.vel.x += sv.x;
              ship.vel.y += sv.y;
              next.shakeAmount = Math.max(next.shakeAmount, 6 + 10 * falloff);
              next.glitchActive = true;
              next.lastGlitchTime = time;
            }
          }
          // Other seats' SHIPS in the wave (P2-2b): plain damage +
          // knockback, no loadout defenses. Inert in SP (no bot ships
          // fly); the local ship's wash above keeps its full
          // hardening/shield/aegis treatment.
          for (const seat of simSeats) {
            const bs = seat.ship;
            if (!bs || seat.ownerId === localOwnerId || seat.ownerId === w.ownerId) continue;
            const hitKey = `ship:${seat.ownerId}`;
            if (w.hitIds.includes(hitKey) || !inBand(bs.pos) || !inCone(bs.pos)) continue;
            w.hitIds.push(hitKey);
            bs.health -= w.baseDamage * falloff;
            bs.lastHitByOwnerId = w.ownerId;
            const sv = shoveVec(bs.pos, w.baseKnockback * falloff);
            bs.pos.x += sv.x;
            bs.pos.y += sv.y;
          }
          // Drones: the wave washes every drone hostile to its star —
          // in SP, an enemy wave washes player drones and a home wave
          // washes enemy drones, as shipped.
          next.drones.forEach(d => { if (d.ownerId !== w.ownerId) washDrone(d); });
          return true;
        });

        // DRONE DEATHS (Slice 4): a drone shot or mined to 0 health becomes
        // wreckage — it drops what it was carrying plus one salvage piece.
        // Drops go into newScrap, the array the frame actually returns.
        // (P2-2b: the kill is credited to the seat whose weapon/wave/mine
        // last damaged the drone — bookkeeping on the seat records and
        // the event feed only; drops and shake are exactly as shipped.)
        next.drones = next.drones.filter(d => {
          if (d.health > 0) return true;
          for (let di = 0; di < d.carrying + 1; di++) {
            newScrap.push({
              id: Math.random().toString(),
              pos: { x: d.pos.x + (Math.random() - 0.5) * 30, y: d.pos.y + (Math.random() - 0.5) * 30 },
              color: COLORS.SCRAP[Math.floor(Math.random() * COLORS.SCRAP.length)],
            });
          }
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

        // BOT SHIP DEATHS (Phase 2, P2-2b): a bot seat's ship reduced
        // to 0 leaves the seat shipless — the kill is credited, the
        // seat plays on with its star and drones, and what happens
        // next for that seat (repurchase) is the death economy's
        // business (P2-5), not this slice's. Ship death is NOT
        // elimination. Inert in SP: the enemy seat flies no ship and
        // the local ship is never touched here (its death remains the
        // shipped isGameOver path).
        for (const seat of simSeats) {
          const bs = seat.ship;
          if (!bs || seat.ownerId === localOwnerId || bs.health > 0) continue;
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
          seat.ship = null;
        }

        // BOT SHIP DRIVERS (Phase 2, P2-2b): every bot seat that HAS a
        // ship flies it via src/sim/botDriver.ts — harvest, deliver
        // (through the same infuseStar + delivery heal as drone
        // deliveries), and fire. Its projectiles join this frame's
        // production phase alongside turret bolts and auto-guns, so
        // they first move next frame, like theirs. Inert in SP: the
        // enemy seat's ship is null and the local seat is human.
        for (const seat of simSeats) {
          if (seat.controller !== 'bot' || !seat.ship || seat.eliminated) continue;
          const botResult = stepBotShip(
            seat,
            {
              scrap: newScrap,
              stars: simSeats.map(s => s.star),
              drones: next.drones,
              ships: simSeats
                .filter(s => s.ship)
                .map(s => ({ ownerId: s.ownerId, ship: s.ship! })),
              localOwnerId,
              time,
            },
            1,
          );
          for (const id of botResult.collectedScrapIds) {
            const ix = newScrap.findIndex(sc => sc.id === id);
            if (ix >= 0) newScrap.splice(ix, 1);
          }
          if (botResult.deliverAmount > 0) {
            infuseStar(seat.star, botResult.deliverAmount);
            applyDeliveryHeal(seat.star, botResult.deliverAmount);
          }
          for (const p of botResult.projectiles) next.projectiles.push(p);
        }

        // Update Turrets
        next.starOrbit += 0.01;
        next.enemyStarOrbit += 0.015;

        // Auto-Fire for stars — STAR DEFENSE LADDER (Phase 1c,
        // src/starDefense.ts): a star's turret list is a deterministic
        // function of its milestone count, reconciled here every frame
        // so a milestone crossing takes effect the moment it lands.
        simSeats.forEach(seat => {
          const s = seat.star;
          s.turrets = turretsForMilestones(milestonesForInfused(s.totalScrapInfused));
        });
        // TARGETING (unchanged from the single-turret era, and shared by
        // every turret on a star): turrets may fire only while their
        // target is within DEFENSE.RANGE of the star's CENTER. EVERY
        // turret rolls its own tier fire chance and fires independently,
        // from its own ring position (radius per the PHYSICS.STAR_DEFENSE
        // formula), aiming from there, and its bolt carries its own tier
        // damage.
        // (P2-2b generalization, SP-exact: a star's target is the first
        // of — a hostile Decoy Beacon; the nearest hostile SHIP; the
        // nearest hostile STAR. In SP that is precisely the shipped
        // rule: the home star skips its own decoy and the shipless
        // enemy seat and lands on the enemy star; the enemy star takes
        // the player's decoy while one flies, else the player's ship.)
        simSeats.forEach(seat => {
          const s = seat.star;
          let target: { pos: Vector2D } | null = null;
          if (next.decoy && next.decoy.ownerId !== s.ownerId) {
            target = { pos: next.decoy.pos };
          }
          if (!target) {
            let bd = Infinity;
            for (const os of simSeats) {
              if (!os.ship || os.ownerId === s.ownerId) continue;
              const dd = Math.hypot(os.ship.pos.x - s.pos.x, os.ship.pos.y - s.pos.y);
              if (dd < bd) { bd = dd; target = os.ship; }
            }
          }
          if (!target) {
            let bd = Infinity;
            for (const os of simSeats) {
              if (os.ownerId === s.ownerId) continue;
              const dd = Math.hypot(os.star.pos.x - s.pos.x, os.star.pos.y - s.pos.y);
              if (dd < bd) { bd = dd; target = os.star; }
            }
          }
          if (!target) return;
          const dx = target.pos.x - s.pos.x;
          const dy = target.pos.y - s.pos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist >= PHYSICS.DEFENSE.RANGE) return;

          s.turrets.forEach(t => {
            if (Math.random() >= turretFireChanceFor(t.tier)) return;
            const ring = turretRingRadius(s.size, t.shell);
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
        const tracking = advanceSeatTracking(prevSeats, simSeats, prev.matchEnd, time);
        feedEntries.push(...tracking.entries);
        const matchEnd = tracking.matchEnd;
        const standings = computeStandings(
          simSeats.map(seat => ({
            starIndex: seat.starIndex,
            ownerId: seat.ownerId,
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

  return {
    state,
    upgrade,
    buyItem,
    equipItem,
    buyType,
    buyHullStep,
    switchLine,
    buildDrone,
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
