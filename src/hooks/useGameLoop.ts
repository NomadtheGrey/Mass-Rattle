import { useState, useEffect, useRef, useCallback } from 'react';
import { GameState, Vector2D } from '../types';
import { PHYSICS, COLORS } from '../constants';

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
      attractRadius: PHYSICS.BASE_ATTRACT_RADIUS,
      upgrades: {
        thrust: 0,
        handling: 0,
        attractor: 0,
        fuelCap: 0,
      },
    },
    star: {
      pos: { x: width / 2, y: height / 2 },
      vel: { x: 0, y: 0 },
      size: 40,
      mass: 400,
      totalScrapInfused: 0,
      type: 'home',
    },
    enemyStar: {
      pos: { x: width / 2 + 3000, y: height / 2 + 1000 },
      vel: { x: 0, y: 0 },
      size: 120,
      mass: 4000,
      totalScrapInfused: 0,
      type: 'enemy',
    },
    scrap: [],
    teamScrap: 0,
    glitchActive: false,
    lastGlitchTime: 0,
    shakeAmount: 0,
    useAnalogGauges: true,
  });

  const keys = useRef<Set<string>>(new Set());

  const upgrade = useCallback((type: 'thrust' | 'handling' | 'attractor' | 'fuel') => {
    setState(prev => {
      const cost = type === 'thrust' ? PHYSICS.UPGRADE_COSTS.THRUST : 
                   type === 'handling' ? PHYSICS.UPGRADE_COSTS.HANDLING : 
                   type === 'attractor' ? PHYSICS.UPGRADE_COSTS.ATTRACTOR :
                   PHYSICS.UPGRADE_COSTS.FUEL;
      
      if (prev.teamScrap < cost) return prev;

      const next = { ...prev };
      next.teamScrap -= cost;
      const ship = { ...next.ship };
      ship.upgrades = { ...ship.upgrades, [type === 'fuel' ? 'fuelCap' : type]: (ship.upgrades as any)[type === 'fuel' ? 'fuelCap' : type] + 1 };
      
      if (type === 'attractor') {
        ship.attractRadius = PHYSICS.BASE_ATTRACT_RADIUS + ship.upgrades.attractor * 35;
      }
      if (type === 'fuel') {
        ship.maxFuel = 100 + ship.upgrades.fuelCap * 50;
        ship.fuel = ship.maxFuel;
      }

      return { ...next, ship, glitchActive: true, lastGlitchTime: performance.now() };
    });
  }, []);

  const toggleGauges = useCallback(() => {
    setState(prev => ({ ...prev, useAnalogGauges: !prev.useAnalogGauges }));
  }, []);

  const spawnScrap = useCallback(() => {
    const angle = Math.random() * Math.PI * 2;
    const dist = 400 + Math.random() * 1200;
    return {
      pos: {
        x: width / 2 + Math.cos(angle) * dist,
        y: height / 2 + Math.sin(angle) * dist,
      },
      color: COLORS.SCRAP[Math.floor(Math.random() * COLORS.SCRAP.length)],
      id: Math.random().toString(36).substr(2, 9),
    };
  }, [width, height]);

  // Initial scrap
  useEffect(() => {
    setState(s => ({
      ...s,
      scrap: Array.from({ length: 25 }, spawnScrap),
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
      if (e.code === 'KeyG') toggleGauges();
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
        const wantsThrust = keys.current.has('ArrowUp') || keys.current.has('KeyW');
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
          ship.fuel += 20; 
          next.glitchActive = true;
          next.lastGlitchTime = time;
        }

        // 2. Physics (Mass Scaling)
        const currentMass = PHYSICS.SHIP_MASS + (ship.carrying * PHYSICS.MASS_PER_CARGO);
        const currentRotSpeed = (PHYSICS.ROTATION_SPEED + ship.upgrades.handling * 0.005) / (1 + ship.carrying * 0.05);
        
        if (keys.current.has('ArrowLeft') || keys.current.has('KeyA')) ship.angle -= currentRotSpeed;
        if (keys.current.has('ArrowRight') || keys.current.has('KeyD')) ship.angle += currentRotSpeed;

        if (ship.thrust) {
          const currentThrust = PHYSICS.THRUST_POWER + ship.upgrades.thrust * 0.08;
          // Accel = Force / Mass
          ship.vel.x += (Math.cos(ship.angle) * currentThrust) / currentMass;
          ship.vel.y += (Math.sin(ship.angle) * currentThrust) / currentMass;
        }

        // Active VAC Mode (Q, E, or R)
        const isVacActive = keys.current.has('KeyQ') || keys.current.has('KeyE') || keys.current.has('KeyR');

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

        // Scrap Collection and ATTRACTION
        const newScrap = next.scrap.filter(d => {
          const ddx = ship.pos.x - d.pos.x;
          const ddy = ship.pos.y - d.pos.y;
          const dDistSq = ddx * ddx + ddy * ddy;
          const dDist = Math.sqrt(dDistSq);

          const attractLimit = isVacActive ? ship.attractRadius * 1.6 : ship.attractRadius;
          if (dDist < attractLimit) {
            let pullForce = PHYSICS.DUST_ATTRACT_FORCE * (1 + ship.upgrades.attractor * 0.6);
            if (isVacActive) pullForce *= PHYSICS.ACTIVE_VAC_MULTIPLIER;
            d.pos.x += (ddx / dDist) * pullForce;
            d.pos.y += (ddy / dDist) * pullForce;
          }

          if (dDistSq < (PHYSICS.AUTO_COLLECT_RADIUS ** 2)) { 
            ship.carrying += 1;
            return false;
          }
          return true;
        });

        while (newScrap.length < 25) {
          newScrap.push(spawnScrap());
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

        // Enemy Sabotage (Offensive Delivery)
        const edx = enemyStar.pos.x - ship.pos.x;
        const edy = enemyStar.pos.y - ship.pos.y;
        const eDist = Math.sqrt(edx * edx + edy * edy);
        const wantsJettison = keys.current.has('Space');

        if (ship.carrying > 0 && eDist < PHYSICS.DELIVERY_RADIUS * 2 && wantsJettison) {
          const amount = ship.carrying;
          enemyStar.mass *= (1 - 0.02 * amount);
          enemyStar.size *= (1 - 0.01 * amount);
          ship.carrying = 0;
          glitch = true;
          next.lastGlitchTime = time;
          next.shakeAmount = 20;
        }

        if (glitch && time - prev.lastGlitchTime > 500) {
          glitch = false;
        }

        // Decay shake
        next.shakeAmount = Math.max(0, next.shakeAmount * 0.9);

        return {
          ...next,
          ship,
          star,
          enemyStar,
          scrap: newScrap,
          teamScrap,
          glitchActive: glitch,
        };
      });
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [width, height, spawnScrap]);

  return { state, upgrade };
};
