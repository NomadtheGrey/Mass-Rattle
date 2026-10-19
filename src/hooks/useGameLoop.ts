import { useState, useEffect, useRef, useCallback } from 'react';
import { GameState, Vector2D } from '../types';
import { PHYSICS, COLORS } from '../constants';
import { getLoadoutItem, itemTierCost, swapCostForTier, MAX_ITEM_TIER } from '../loadout';
import { inBankWell } from '../bank';
import { weaponStatsFor } from '../loadout';

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
  const [state, setState] = useState<GameState>({
    ship: {
      pos: { x: 100, y: 100 },
      vel: { x: 0, y: 0 },
      size: 15,
      angle: 0,
      rotationVel: 0,
      thrust: false,
      carrying: 0,
      fuel: 100,
      maxFuel: 100,
      health: 100,
      maxHealth: 100,
      attractRadius: PHYSICS.BASE_ATTRACT_RADIUS,
      arsenal: {},
      loadout: { weapon: null, defense: null, hybrid: null },
      upgrades: {
        thrust: 0,
        handling: 0,
        attractor: 0,
        fuelCap: 0,
        cargo: 0,
      },
    },
    star: {
      pos: { x: width / 2, y: height / 2 },
      vel: { x: 0, y: 0 },
      size: 40,
      mass: 400,
      totalScrapInfused: 0,
      type: 'home',
      integrity: 1,
    },
    enemyStar: {
      pos: { x: width / 2 + 3000, y: height / 2 + 1000 },
      vel: { x: 0, y: 0 },
      size: 120,
      mass: 4000,
      totalScrapInfused: 0,
      type: 'enemy',
      integrity: 1,
    },
    scrap: [],
    deployedCargo: [],
    projectiles: [],
    mines: [],
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
    setState(prev => ({
      ...prev,
      isShopOpen: typeof force === 'boolean' ? force : !prev.isShopOpen,
    }));
  }, []);

  const upgrade = useCallback((type: 'thrust' | 'handling' | 'attractor' | 'fuel' | 'cargo') => {
    setState(prev => {
      const baseCost = type === 'thrust' ? PHYSICS.UPGRADE_COSTS.THRUST : 
                       type === 'handling' ? PHYSICS.UPGRADE_COSTS.HANDLING : 
                       type === 'attractor' ? PHYSICS.UPGRADE_COSTS.ATTRACTOR :
                       type === 'fuel' ? PHYSICS.UPGRADE_COSTS.FUEL :
                       PHYSICS.UPGRADE_COSTS.CARGO;
      
      const currentLevel = type === 'fuel' ? prev.ship.upgrades.fuelCap : (prev.ship.upgrades as any)[type];
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
        ship.attractRadius = PHYSICS.BASE_ATTRACT_RADIUS + ship.upgrades.attractor * 35;
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
  // BANK: move scrap between hold and bank. Banking is what lets a
  // player SAVE UP past the hold's physical capacity — and banked scrap
  // survives flybys of the home star that would auto-feed the hold.
  // Withdraw is limited by free hold space (capacity incl. overload).
  // ------------------------------------------------------------------
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
      const regularCapacity = PHYSICS.CARGO.BASE_CAPACITY + prev.ship.upgrades.cargo * PHYSICS.CARGO.UPGRADE_BONUS;
      const totalCapacity = regularCapacity + Math.floor(regularCapacity * PHYSICS.CARGO.OVERLOAD_RATIO);
      const space = Math.max(0, totalCapacity - prev.ship.carrying);
      const moved = Math.min(space, prev.bankedScrap);
      if (moved <= 0) return prev;
      const ship = { ...prev.ship, carrying: prev.ship.carrying + moved };
      return { ...prev, ship, bankedScrap: prev.bankedScrap - moved, glitchActive: true, lastGlitchTime: performance.now() };
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

    setState(s => ({
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
          state: 'searching',
          health: 100
        }
      ],
      star: { ...s.star, pos: { x: width / 2, y: height / 2 } }
    }));
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
      if (e.code === 'KeyU' || e.code === 'Tab') {
        if (e.code === 'Tab') e.preventDefault();
        setState(prev => ({ ...prev, isShopOpen: !prev.isShopOpen }));
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [upgrade]);

  useEffect(() => {
    let frameId: number;
    const loop = (time: number) => {
      setState(prev => {
        const next = { ...prev };
        const ship = { ...next.ship };
        const star = { ...next.star };
        const enemyStar = { ...next.enemyStar };

        // 1. Fuel & Inputs
        const stick = touchInputs.current.analogStick;
        const stickDist = stick ? Math.sqrt(stick.x * stick.x + stick.y * stick.y) : 0;
        const stickThrust = stickDist > 0.45;
        const wantsThrust = keys.current.has('ArrowUp') || keys.current.has('KeyW') || touchInputs.current.thrust || stickThrust;
        
        // Cargo Capacity
        const regularCapacity = PHYSICS.CARGO.BASE_CAPACITY + ship.upgrades.cargo * PHYSICS.CARGO.UPGRADE_BONUS;
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

        // Ship Health Damage from enemy star proximity
        const edx = enemyStar.pos.x - ship.pos.x;
        const edy = enemyStar.pos.y - ship.pos.y;
        const eDist = Math.sqrt(edx * edx + edy * edy);
        
        // Deep Space Radiation check (distance from center of both stars)
        const centerX = (star.pos.x + enemyStar.pos.x) / 2;
        const centerY = (star.pos.y + enemyStar.pos.y) / 2;
        const cdx = centerX - ship.pos.x;
        const cdy = centerY - ship.pos.y;
        const centerDist = Math.sqrt(cdx * cdx + cdy * cdy);

        if (eDist < enemyStar.size + 150) {
          ship.health -= 0.15 * (1 - (eDist / (enemyStar.size + 150)));
          if (Math.random() < 0.05) next.shakeAmount = 3;
        } else if (centerDist > 6000) {
          // Deep Space Drain
          const severity = (centerDist - 6000) / 4000;
          ship.health -= 0.05 * severity;
          if (Math.random() < 0.02) next.glitchActive = true;
        }

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
          const currentThrust = (PHYSICS.THRUST_POWER + ship.upgrades.thrust * 0.08) * speedMult;
          // Accel = Force / Mass
          ship.vel.x += (Math.cos(ship.angle) * currentThrust) / currentMass;
          ship.vel.y += (Math.sin(ship.angle) * currentThrust) / currentMass;
        }

        // Active VAC Mode (Q, E, R or virtual touch)
        const isVacActive = keys.current.has('KeyQ') || keys.current.has('KeyE') || keys.current.has('KeyR') || touchInputs.current.vac;

        // Gravity from BOTH Stars
        [star, enemyStar].forEach(s => {
          const dx = s.pos.x - ship.pos.x;
          const dy = s.pos.y - ship.pos.y;
          const distSq = dx * dx + dy * dy;
          const dist = Math.sqrt(distSq);
          
          // Safer gravity: cap distance to prevent "infinite" pull
          const safeDistSq = Math.max(distSq, s.size * s.size); 
          const isHomeStar = s.type === 'home';
          const shipGravityModifier = isHomeStar ? 0.2 : 0.6; // Much weaker pull for home
          
          const force = (PHYSICS.G * s.mass * shipGravityModifier) / safeDistSq;
          
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

        if (Math.abs(ship.pos.x - star.pos.x) > 5000 || Math.abs(ship.pos.y - star.pos.y) > 5000) {
           ship.vel.x *= -0.1;
           ship.vel.y *= -0.1;
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

        // Home Delivery
        const hdx = star.pos.x - ship.pos.x;
        const hdy = star.pos.y - ship.pos.y;
        const hDist = Math.sqrt(hdx * hdx + hdy * hdy);
        
        let glitch = prev.glitchActive;
        let teamScrap = prev.teamScrap;
        
        if (ship.carrying > 0 && hDist < PHYSICS.DELIVERY_RADIUS) {
          const amount = ship.carrying;
          const oldInfused = star.totalScrapInfused;
          star.totalScrapInfused += amount;
          teamScrap += amount;
          ship.carrying = 0;

          const newMilestone = Math.floor(star.totalScrapInfused / PHYSICS.STAR_GROWTH_THRESHOLD);
          const oldMilestone = Math.floor(oldInfused / PHYSICS.STAR_GROWTH_THRESHOLD);
          
          if (newMilestone > oldMilestone) {
            star.mass *= 1.25;
            star.size *= 1.15;
          }
          glitch = true;
          next.lastGlitchTime = time;
        }

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
          if (cost <= 0 || ship.carrying >= cost) {
            if (cost > 0) ship.carrying -= cost;
            ship.fireReadyAt = time + wStats.cooldownMs;
            if (wStats.kind === 'mine') {
              // Mine Layer: no projectile — a mine drops at the ship's tail.
              (next.mines = next.mines || []).push({
                id: Math.random().toString(),
                pos: { ...ship.pos },
                damage: wStats.damage,
                radius: wStats.radius || 115,
              });
            } else {
              const pellets = wStats.pellets || 1;
              for (let pi = 0; pi < pellets; pi++) {
                const spreadOffset = pellets > 1 ? (pi / (pellets - 1) - 0.5) * (wStats.spread || 0) : 0;
                const a = ship.angle + spreadOffset;
                next.projectiles.push({
                  id: Math.random().toString(),
                  pos: {
                    x: ship.pos.x + Math.cos(ship.angle) * (ship.size + 4),
                    y: ship.pos.y + Math.sin(ship.angle) * (ship.size + 4),
                  },
                  vel: {
                    x: Math.cos(a) * wStats.speed + ship.vel.x * 0.5,
                    y: Math.sin(a) * wStats.speed + ship.vel.y * 0.5,
                  },
                  owner: 'player',
                  life: wStats.life,
                  damage: wStats.damage,
                  kind: weaponId || undefined,
                  pierce: wStats.pierce,
                  size: wStats.size,
                  hitIds: wStats.pierce ? [] : undefined,
                });
              }
            }
          }
        }

        // Update Deployed Cargo
        next.deployedCargo = (next.deployedCargo || []).filter(c => {
          c.pos.x += c.vel.x;
          c.pos.y += c.vel.y;
          c.life -= 1;

          // Collision with stars
          for (const s of [star, enemyStar]) {
            const dx = s.pos.x - c.pos.x;
            const dy = s.pos.y - c.pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < s.size + 10) {
              const amount = 1;
              if (s.type === 'home') {
                const oldInfused = star.totalScrapInfused;
                star.totalScrapInfused += amount;
                next.teamScrap += amount;
                
                const newMilestone = Math.floor(star.totalScrapInfused / PHYSICS.STAR_GROWTH_THRESHOLD);
                const oldMilestone = Math.floor(oldInfused / PHYSICS.STAR_GROWTH_THRESHOLD);
                if (newMilestone > oldMilestone) {
                  star.mass *= 1.25;
                  star.size *= 1.15;
                }
              } else {
                enemyStar.integrity = Math.max(0, enemyStar.integrity - 0.01);
                enemyStar.mass *= 0.99; // Each bit of cargo damages it
                enemyStar.size *= 0.995;
                enemyStar.lastHitTime = time;
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
          const droneStar = drone.owner === 'player' ? star : enemyStar;

          // Ion stun: a rebooting drone hangs dead in space, timer ticking.
          if (drone.stunFrames && drone.stunFrames > 0) {
            drone.stunFrames -= 1;
            return drone;
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
              if (drone.owner === 'player') {
                const oldInfused = star.totalScrapInfused;
                star.totalScrapInfused += amount;
                teamScrap += amount;
                const newMilestone = Math.floor(star.totalScrapInfused / PHYSICS.STAR_GROWTH_THRESHOLD);
                const oldMilestone = Math.floor(oldInfused / PHYSICS.STAR_GROWTH_THRESHOLD);
                if (newMilestone > oldMilestone) {
                  star.mass *= 1.25;
                  star.size *= 1.15;
                }
              } else {
                enemyStar.totalScrapInfused += amount;
                // Healing or growth for enemy star
                enemyStar.integrity = Math.min(1, enemyStar.integrity + 0.005 * amount);
                enemyStar.size *= 1.01;
                enemyStar.mass *= 1.01;
              }
              drone.carrying = 0;
              drone.state = 'searching';
            }
          }

          return drone;
        });

        // MINES (Slice 4): an enemy drone wandering inside a mine's radius
        // trips it — everything hostile in the blast takes the damage,
        // including the enemy star if it is somehow close.
        next.mines = (next.mines || []).filter(mine => {
          const tripped = next.drones.some(d => d.owner === 'enemy' &&
            Math.hypot(d.pos.x - mine.pos.x, d.pos.y - mine.pos.y) < mine.radius);
          if (!tripped) return true;
          next.drones.forEach(d => {
            if (d.owner === 'enemy' && Math.hypot(d.pos.x - mine.pos.x, d.pos.y - mine.pos.y) < mine.radius) {
              d.health -= mine.damage;
            }
          });
          if (Math.hypot(enemyStar.pos.x - mine.pos.x, enemyStar.pos.y - mine.pos.y) < mine.radius + enemyStar.size) {
            enemyStar.integrity -= mine.damage * 0.002;
            enemyStar.lastHitTime = time;
          }
          next.shakeAmount = Math.max(next.shakeAmount, 12);
          return false;
        });

        // 6. Projectiles and Defense
        next.projectiles = (next.projectiles || []).filter(p => {
          // Seeker torpedoes steer toward the nearest enemy drone,
          // turning at most 0.15 rad/frame so they arc rather than snap.
          if (p.kind === 'seeker_torpedoes') {
            let best: any = null;
            let bestD = 700;
            next.drones.forEach(d => {
              if (d.owner !== 'enemy') return;
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

          // Collision with ship
          const sdx = ship.pos.x - p.pos.x;
          const sdy = ship.pos.y - p.pos.y;
          if (p.owner === 'enemy' && Math.sqrt(sdx * sdx + sdy * sdy) < ship.size) {
            ship.health -= PHYSICS.DEFENSE.DAMAGE;
            next.shakeAmount = 15;
            next.glitchActive = true;
            next.lastGlitchTime = time;
            return false;
          }

          // Collision with enemy DRONES (ship weapons only — turret bolts
          // carry no damage field and keep their old pass-through behavior)
          if (p.owner === 'player' && p.damage !== undefined) {
            const hitDrone = next.drones.find(d => d.owner === 'enemy' &&
              !(p.hitIds || []).includes(d.id) &&
              Math.hypot(d.pos.x - p.pos.x, d.pos.y - p.pos.y) < 14);
            if (hitDrone) {
              hitDrone.health -= p.damage;
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

          // Collision with Enemy Star (Player Star defense helps)
          if (p.owner === 'player') {
            const edx = enemyStar.pos.x - p.pos.x;
            const edy = enemyStar.pos.y - p.pos.y;
            if (Math.sqrt(edx * edx + edy * edy) < enemyStar.size && !(p.hitIds || []).includes('enemy-star')) {
              // REPAIR (Slice 4): this used to subtract DAMAGE x 0.5 = 5 from
              // a 0..1 integrity scale — a single turret hit would have ended
              // the game outright. Star damage is now damage x 0.002 for every
              // shooter: a T1 bolt chips 0.024, a T5 rail lance lands 0.186.
              enemyStar.integrity -= (p.damage !== undefined ? p.damage : PHYSICS.DEFENSE.DAMAGE) * 0.002;
              enemyStar.lastHitTime = time;
              if (p.pierce) {
                (p.hitIds = p.hitIds || []).push('enemy-star');
              } else {
                return false;
              }
            }
          }

          return p.life > 0;
        });

        // DRONE DEATHS (Slice 4): a drone shot or mined to 0 health becomes
        // wreckage — it drops what it was carrying plus one salvage piece.
        // Drops go into newScrap, the array the frame actually returns.
        next.drones = next.drones.filter(d => {
          if (d.health > 0) return true;
          for (let di = 0; di < d.carrying + 1; di++) {
            newScrap.push({
              id: Math.random().toString(),
              pos: { x: d.pos.x + (Math.random() - 0.5) * 30, y: d.pos.y + (Math.random() - 0.5) * 30 },
              color: COLORS.SCRAP[Math.floor(Math.random() * COLORS.SCRAP.length)],
            });
          }
          next.shakeAmount = Math.max(next.shakeAmount, 6);
          return false;
        });

        // Update Turrets
        next.starOrbit += 0.01;
        next.enemyStarOrbit += 0.015;

        // Auto-Fire for stars
        [star, enemyStar].forEach(s => {
          const target = s.type === 'home' ? enemyStar : ship;
          const dx = target.pos.x - s.pos.x;
          const dy = target.pos.y - s.pos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < PHYSICS.DEFENSE.RANGE && Math.random() < 0.01) {
            const angle = Math.atan2(dy, dx);
            next.projectiles.push({
              id: Math.random().toString(),
              pos: { 
                x: s.pos.x + Math.cos(angle) * s.size, 
                y: s.pos.y + Math.sin(angle) * s.size 
              },
              vel: {
                x: Math.cos(angle) * PHYSICS.DEFENSE.BOLT_SPEED,
                y: Math.sin(angle) * PHYSICS.DEFENSE.BOLT_SPEED,
              },
              owner: s.type === 'home' ? 'player' : 'enemy',
              life: 180
            });
          }
        });

        return {
          ...next,
          ship,
          star,
          enemyStar,
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
    depositBank, 
    withdrawBank, 
    restart, 
    setVirtualControl, 
    setAnalogStick, 
    toggleShop, 
    toggleGauges 
  };
};
