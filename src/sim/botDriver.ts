/**
 * Per-seat bot ship driver (Phase 2, P2-2b) — NEW behavior, not a
 * generalization of something the shipped game had: SP's enemy seat
 * flies no ship, so this driver is only ever exercised by bot seats
 * that HAVE a ship (multiplayer matches seated with ships, P2-3+).
 * The SP init path seats the enemy with ship: null and this code
 * never runs in the shipped game.
 *
 * The driver is deliberately simple and tunable — a harvest loop in
 * the drone's idiom, flown by a ship:
 *   seek the nearest loose scrap → collect it on contact → when the
 *   hold is full, return to the seat's own star and deliver (the game
 *   loop runs the actual infusion through infuseStar, same as drone
 *   deliveries) → repeat. It steers clear of hostile stars' burn
 *   radius, and fires its equipped starter weapon at the nearest
 *   hostile drone or ship in range, through the same projectile shape
 *   the game loop creates for the player's volleys.
 *
 * Decisions are pure with respect to the world view it is handed: it
 * mutates only its own seat's ship (a frame copy in the loop) and
 * reports scrap collections / deliveries / new projectiles back as
 * data for the loop to apply. No rendering, no input, no economy —
 * bot seats never touch the workshop paths (those stay bound to the
 * local seat).
 */

import { PHYSICS } from '../constants';
import { weaponStatsFor } from '../loadout';
import { EXTRA_MOUNT_DAMAGE, typeFor } from '../shipProgression';
import type {
  Harvester,
  Projectile,
  Scrap,
  SeatSimState,
  Ship,
  Star,
} from '../types';

/** Bot driver tuning — DRAFT numbers, one block, Adam's pin pending. */
export const BOT_DRIVER = {
  /** Top speed (units/frame). The player cap is PHYSICS.MAX_VELOCITY
   * (5) + thrust upgrades; a starter bot cruises a little under it. */
  MAX_SPEED: 4.2,
  /** Acceleration along the ship's facing (units/frame^2). */
  ACCEL: 0.22,
  /** Heading turn rate toward the current target (rad/frame). */
  TURN_RATE: 0.08,
  /** Per-frame velocity retention (the player ship's friction idiom). */
  FRICTION: 0.98,
  /** Scrap pickup distance — the player ship's auto-collect radius. */
  COLLECT_RADIUS: PHYSICS.AUTO_COLLECT_RADIUS,
  /** Delivery distance from the home star's CENTER — the drone
   * deposit radius beyond the star's surface. */
  DEPOSIT_RADIUS: PHYSICS.DRONES.DEPOSIT_RADIUS,
  /** Weapon range: the driver only opens fire inside this distance. */
  FIRE_RANGE: 520,
  /** Hostile-star avoidance: steering repulsion begins this far
   * beyond the star's surface (the burn zone is size + 150). */
  AVOID_MARGIN: 190,
  /** Hard keep-out beyond a hostile star's surface. */
  KEEP_OUT: 26,
};

export interface BotWorldView {
  /** Loose scrap currently in the world (the frame's live list). */
  scrap: Scrap[];
  /** Every seat's star (the driver's own star is found by ownerId). */
  stars: Star[];
  /** Every drone in the world (fire targets are the hostile ones). */
  drones: Harvester[];
  /** Every flying ship, by owning seat. */
  ships: { ownerId: string; ship: Ship }[];
  /** The local seat's ownerId — projectile legacy-owner labels are
   * view-relative ('player' = the local seat's side), as everywhere
   * else in the sim. */
  localOwnerId: string;
  /** The loop clock (performance.now-based, ms) for fire cooldowns. */
  time: number;
}

export interface BotStepResult {
  /** Scrap ids the ship picked up this step (the loop removes them
   * from the world's returned scrap list). */
  collectedScrapIds: string[];
  /** Scrap delivered to the seat's star this step (the loop runs the
   * infusion + delivery heal); 0 on most steps. */
  deliverAmount: number;
  /** Projectiles fired this step, in the loop's projectile shape. */
  projectiles: Projectile[];
}

const EMPTY_RESULT: BotStepResult = {
  collectedScrapIds: [],
  deliverAmount: 0,
  projectiles: [],
};

/** Total hold capacity for a ship, the loop's formula (cargo track +
 * line/type bonus, overload ratio applied to the total). */
const holdCapacityFor = (ship: Ship): number => {
  const regular =
    PHYSICS.CARGO.BASE_CAPACITY +
    ship.upgrades.cargo * PHYSICS.CARGO.UPGRADE_BONUS +
    typeFor(ship.line, ship.typeTier).cargoBonus;
  return regular + Math.floor(regular * PHYSICS.CARGO.OVERLOAD_RATIO);
};

const angleLerp = (from: number, to: number, maxStep: number): number => {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return from + Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
};

/**
 * Advance one bot seat's ship by one frame step. `dtFrames` scales
 * the movement integration (the loop passes 1; it exists so tests and
 * future fixed-step hosts can drive the same decisions).
 */
export const stepBotShip = (
  seat: SeatSimState,
  world: BotWorldView,
  dtFrames: number = 1,
): BotStepResult => {
  const ship = seat.ship;
  if (!ship || seat.eliminated) return EMPTY_RESULT;
  const ownStar = world.stars.find(s => s.ownerId === seat.ownerId);
  if (!ownStar) return EMPTY_RESULT;

  const result: BotStepResult = {
    collectedScrapIds: [],
    deliverAmount: 0,
    projectiles: [],
  };
  const capacity = holdCapacityFor(ship);

  // --- Decide the destination -------------------------------------
  const full = ship.carrying >= capacity;
  let target: { x: number; y: number } | null = null;
  let targetScrap: Scrap | null = null;
  if (!full) {
    let bestD = Infinity;
    for (const s of world.scrap) {
      const dd = Math.hypot(s.pos.x - ship.pos.x, s.pos.y - ship.pos.y);
      if (dd < bestD) {
        bestD = dd;
        targetScrap = s;
      }
    }
    if (targetScrap) target = targetScrap.pos;
  }
  const returning = full || (!targetScrap && ship.carrying > 0);
  if (returning) target = ownStar.pos;

  // --- Steer + integrate ------------------------------------------
  if (target) {
    const want = Math.atan2(target.y - ship.pos.y, target.x - ship.pos.x);
    ship.angle = angleLerp(ship.angle, want, BOT_DRIVER.TURN_RATE * dtFrames);
    ship.vel.x += Math.cos(ship.angle) * BOT_DRIVER.ACCEL * dtFrames;
    ship.vel.y += Math.sin(ship.angle) * BOT_DRIVER.ACCEL * dtFrames;
  }
  // Hostile-star avoidance: a soft push out of the burn approach,
  // plus a hard keep-out so the driver never parks inside a star.
  for (const s of world.stars) {
    if (s.ownerId === seat.ownerId) continue;
    const dx = ship.pos.x - s.pos.x;
    const dy = ship.pos.y - s.pos.y;
    const dist = Math.hypot(dx, dy) || 1;
    const danger = s.size + BOT_DRIVER.AVOID_MARGIN;
    if (dist < danger) {
      const push = (1 - dist / danger) * BOT_DRIVER.ACCEL * 2.2 * dtFrames;
      ship.vel.x += (dx / dist) * push;
      ship.vel.y += (dy / dist) * push;
    }
    const keepOut = s.size + BOT_DRIVER.KEEP_OUT;
    if (dist < keepOut) {
      ship.pos.x = s.pos.x + (dx / dist) * keepOut;
      ship.pos.y = s.pos.y + (dy / dist) * keepOut;
    }
  }
  ship.vel.x *= BOT_DRIVER.FRICTION;
  ship.vel.y *= BOT_DRIVER.FRICTION;
  const speed = Math.hypot(ship.vel.x, ship.vel.y);
  if (speed > BOT_DRIVER.MAX_SPEED) {
    const ratio = BOT_DRIVER.MAX_SPEED / speed;
    ship.vel.x *= ratio;
    ship.vel.y *= ratio;
  }
  ship.pos.x += ship.vel.x * dtFrames;
  ship.pos.y += ship.vel.y * dtFrames;
  ship.thrust = speed > 0.4;

  // --- Collect / deliver on contact --------------------------------
  if (targetScrap && !returning) {
    const dd = Math.hypot(
      targetScrap.pos.x - ship.pos.x,
      targetScrap.pos.y - ship.pos.y,
    );
    if (dd < BOT_DRIVER.COLLECT_RADIUS && ship.carrying < capacity) {
      ship.carrying += 1;
      result.collectedScrapIds.push(targetScrap.id);
    }
  }
  if (returning && ship.carrying > 0) {
    const dd = Math.hypot(ownStar.pos.x - ship.pos.x, ownStar.pos.y - ship.pos.y);
    if (dd < ownStar.size + BOT_DRIVER.DEPOSIT_RADIUS) {
      result.deliverAmount = ship.carrying;
      ship.carrying = 0;
    }
  }

  // --- Fire the equipped starter weapon ----------------------------
  const weaponId = ship.loadout.weapon;
  const wStats = weaponStatsFor(
    weaponId,
    weaponId ? ship.arsenal[weaponId] || 0 : 0,
  );
  if (
    wStats &&
    !wStats.scrapCost &&
    wStats.kind !== 'mine' &&
    world.time >= (ship.fireReadyAt || 0)
  ) {
    // Nearest hostile: drones first (the harvest war), then ships.
    let fireTarget: { x: number; y: number } | null = null;
    let bestD = BOT_DRIVER.FIRE_RANGE;
    for (const d of world.drones) {
      if (d.ownerId === seat.ownerId) continue;
      const dd = Math.hypot(d.pos.x - ship.pos.x, d.pos.y - ship.pos.y);
      if (dd < bestD) {
        bestD = dd;
        fireTarget = d.pos;
      }
    }
    if (!fireTarget) {
      for (const hostile of world.ships) {
        if (hostile.ownerId === seat.ownerId) continue;
        const dd = Math.hypot(
          hostile.ship.pos.x - ship.pos.x,
          hostile.ship.pos.y - ship.pos.y,
        );
        if (dd < bestD) {
          bestD = dd;
          fireTarget = hostile.ship.pos;
        }
      }
    }
    if (fireTarget) {
      const aim = Math.atan2(
        fireTarget.y - ship.pos.y,
        fireTarget.x - ship.pos.x,
      );
      // Hard-point volley, the loop's mount math: mount 0 is the nose
      // at full damage; extra mounts offset perpendicular, alternating
      // sides, at EXTRA_MOUNT_DAMAGE of the damage.
      const mounts = typeFor(ship.line, ship.typeTier).hardPoints;
      for (let m = 0; m < mounts; m++) {
        const dmgScale = m === 0 ? 1 : EXTRA_MOUNT_DAMAGE;
        const side = m === 0 ? 0 : (m % 2 === 1 ? 1 : -1) * Math.ceil(m / 2);
        const off = side * ship.size * 0.7;
        const muzzle = {
          x:
            ship.pos.x +
            Math.cos(ship.angle) * (ship.size + 4) -
            Math.sin(ship.angle) * off,
          y:
            ship.pos.y +
            Math.sin(ship.angle) * (ship.size + 4) +
            Math.cos(ship.angle) * off,
        };
        const pellets = wStats.pellets || 1;
        for (let pi = 0; pi < pellets; pi++) {
          const spreadOffset =
            pellets > 1 ? (pi / (pellets - 1) - 0.5) * (wStats.spread || 0) : 0;
          const a = aim + spreadOffset;
          result.projectiles.push({
            id: Math.random().toString(),
            pos: { ...muzzle },
            vel: {
              x: Math.cos(a) * wStats.speed + ship.vel.x * 0.5,
              y: Math.sin(a) * wStats.speed + ship.vel.y * 0.5,
            },
            owner: seat.ownerId === world.localOwnerId ? 'player' : 'enemy',
            ownerId: ship.ownerId,
            life: wStats.life,
            damage: wStats.damage * dmgScale,
            kind: weaponId || undefined,
            pierce: wStats.pierce,
            size: wStats.size,
            hitIds: wStats.pierce ? [] : undefined,
          });
        }
      }
      ship.fireReadyAt = world.time + wStats.cooldownMs;
    }
  }

  return result;
};
