/**
 * Ship physics steps (dedicated loop split, 2026-10-20): the local
 * ship's star-burn application and its "2. Physics (Mass Scaling)"
 * step — rotation, thrust, gravity from every seat's star, Mirror
 * Sail light-catch, friction/velocity cap, position integration, and
 * the world wrap.
 *
 * Extracted VERBATIM from the game loop's frame body: the step
 * functions mutate the same frame working copies the loop hands in
 * (ship / stars / next) and run in the same order the inline code
 * ran. Everything a step reads arrives through its context object —
 * no React, no hooks, no refs, no state of its own.
 */

import { PHYSICS } from '../constants';
import { typeFor } from '../shipProgression';
import { SAIL_RANGE, sailThrustFor, thornDamageFor } from '../loadout';
import { effectiveRadiusForStar } from './starStages';
import { areHostile } from './teams';
import type { GameState, SeatSimState, Ship, Star } from '../types';

export interface StarBurnContext {
  /** The frame's working state copy (shake effects land here). */
  next: GameState;
  /** The local seat's ship (this frame's working copy). */
  ship: Ship;
  /** Every seat in the match (the burn reads each seat's star). */
  simSeats: SeatSimState[];
  /** The local ship's equipped hybrid + tier (frame-resolved). */
  hyId: Ship['loadout']['hybrid'];
  hyTier: number;
  /** The loop clock (performance.now-based, ms). */
  time: number;
  /** The loop's Scrap Aegis absorb closure for this frame. */
  aegisAbsorb: (dmg: number) => number;
}

/**
 * Hostile-star proximity burn for the local ship (was inline in the
 * loop, immediately after the ship's health regen). Runs BEFORE the
 * physics step, exactly where the inline code ran.
 */
export const stepStarBurn = (ctx: StarBurnContext): void => {
  const { next, ship, simSeats, hyId, hyTier, time, aegisAbsorb } = ctx;
  // ALLY DOCKING: a docked ship is out of combat — attached
  // to its host, it takes no burn (src/sim/harbor.ts).
  if (ship.dockedTo) return;
  // Ship Health Damage from hostile star proximity (P2-2b: any
  // star whose ownerId isn't the ship's — in SP that is exactly
  // the enemy star, with exactly the shipped math). TEAMS: the
  // gate is now TEAM hostility — a teammate's star never burns
  // you (Adam: "No friendly fire"). With default solo teams this
  // is the ownerId rule bit for bit.
  // (The midpoint/centerDist computation that fed the retired
  // deep-space drain is gone too; the wrap below computes the
  // midpoint where it needs it.)
  for (const burnSeat of simSeats) {
    const burnStar = burnSeat.star;
    if (!areHostile(simSeats, burnStar.ownerId, ship.ownerId)) continue;
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
};

export interface ShipPhysicsInputs {
  rotateLeft: boolean;
  rotateRight: boolean;
  vac: boolean;
  analogStick: { x: number; y: number } | null;
}

export interface ShipPhysicsContext {
  /** The local seat's ship (this frame's working copy). */
  ship: Ship;
  /** Every seat in the match (gravity + sail read each seat's star). */
  simSeats: SeatSimState[];
  /** The local seat's star and the (SP) opposing star — the world
   * wrap reflects through this pair's midpoint, as shipped. */
  star: Star;
  enemyStar: Star;
  /** This frame's pressed-key set (the loop's key ref, unwrapped). */
  keys: ReadonlySet<string>;
  /** This frame's touch inputs (the loop's touch ref, unwrapped). */
  touchInputs: ShipPhysicsInputs;
  /** The analog stick vector + magnitude, resolved by the loop. */
  stick: { x: number; y: number } | null;
  stickDist: number;
  /** The overload speed multiplier (loop's cargo math, this frame). */
  speedMult: number;
  /** Defense-derived factors (loop-resolved): Armor Plating thrust,
   * Grav Dampers gravity. */
  thrustFactor: number;
  gravFactor: number;
  /** The local ship's equipped hybrid + tier (frame-resolved). */
  hyId: Ship['loadout']['hybrid'];
  hyTier: number;
}

export interface ShipPhysicsResult {
  /** Whether VAC is active this frame (the scrap-collection and
   * projectile steps read it later in the frame). */
  isVacActive: boolean;
}

/**
 * The local ship's physics step: "2. Physics (Mass Scaling)" from
 * the loop, verbatim. Mutates `ship` in place; the only value handed
 * back is the frame's VAC-active flag.
 */
export const stepShipPhysics = (ctx: ShipPhysicsContext): ShipPhysicsResult => {
  const { ship, simSeats, star, enemyStar, keys, touchInputs, stick, stickDist, speedMult, thrustFactor, gravFactor, hyId, hyTier } = ctx;
  // 2. Physics (Mass Scaling)
  const currentMass = PHYSICS.SHIP_MASS + (ship.carrying * PHYSICS.MASS_PER_CARGO);
  // TURN FACTOR (Adam, 2026-10-21): the type's base turning
  // character scales the base rotation speed; handling upgrades
  // still add their flat bonus on top, and the cargo-mass divisor
  // is untouched. See ShipTypeDef.turnFactor in shipProgression.
  const turnFactor = typeFor(ship.line, ship.typeTier).turnFactor;
  const currentRotSpeed = (PHYSICS.ROTATION_SPEED * turnFactor + ship.upgrades.handling * 0.005) / (1 + ship.carrying * 0.05);

  if (keys.has('ArrowLeft') || keys.has('KeyA') || touchInputs.rotateLeft) {
    ship.angle -= currentRotSpeed;
  }
  if (keys.has('ArrowRight') || keys.has('KeyD') || touchInputs.rotateRight) {
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
  const isVacActive = keys.has('KeyQ') || keys.has('KeyE') || keys.has('KeyR') || touchInputs.vac;

  // Gravity from ALL seats' stars (SP: both stars, same order —
  // seat 0's star first, then seat 1's, as shipped)
  simSeats.forEach(seat => {
    const s = seat.star;
    const dx = s.pos.x - ship.pos.x;
    const dy = s.pos.y - ship.pos.y;
    const distSq = dx * dx + dy * dy;
    const dist = Math.sqrt(distSq);

    // GRAVITY AUDIT (P2-4): the pull itself is mass-driven —
    // G * s.mass / d² — and nothing may derive it from the star's
    // SIZE (Adam's decoupling ruling: at NEUTRON the body collapses
    // while the mass, and so the pull, keeps compounding). The one
    // place size used to leak in was this distance floor (and the
    // repulsion reach below): both now read the star's EFFECTIVE
    // radius — the un-shrunk growth curve (src/sim/starStages.ts) —
    // so the well's reach is continuous across the collapse. Before
    // NEUTRON the effective radius IS the physical size, so the
    // shipped feel is untouched.
    const effRadius = effectiveRadiusForStar(s);

    // Safer gravity: cap distance to prevent "infinite" pull
    const safeDistSq = Math.max(distSq, effRadius * effRadius);
    const isHomeStar = s.ownerId === ship.ownerId;
    const shipGravityModifier = isHomeStar ? 0.2 : 0.6; // Much weaker pull for home

    const force = ((PHYSICS.G * s.mass * shipGravityModifier) / safeDistSq) * gravFactor;

    const ax = (force * dx) / (dist || 1);
    const ay = (force * dy) / (dist || 1);
    ship.vel.x += ax / currentMass;
    ship.vel.y += ay / currentMass;

    // Repulsion buffer (Anti-Stuck Logic)
    // If ship is inside the star's well radius, push it out firmly
    const repulsionRadius = effRadius + 10;
    if (dist < repulsionRadius) {
      const repulsion = (repulsionRadius - dist) * 0.25;
      ship.vel.x -= (dx / (dist || 1)) * repulsion;
      ship.vel.y -= (dy / (dist || 1)) * repulsion;

      // Dampen velocity when hitting the star to prevent weird bouncing/gluing
      if (dist < effRadius) {
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
  return { isVacActive };
};
