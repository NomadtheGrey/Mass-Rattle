/**
 * Drone step (dedicated loop split, 2026-10-20): "5. Drones Logic"
 * from the game loop's frame body, extracted verbatim — stun ticks,
 * decoy chase, the search / collect / returning state machine, and
 * delivery into the drone's own seat's star through the same shared
 * infuseStar + applyDeliveryHeal helpers the loop used inline.
 *
 * The step mutates the frame's working copies it is handed (the
 * drones themselves, the shared scrap list on `next`, the delivery
 * stars) and returns the mapped drone list plus the frame's updated
 * teamScrap (the local seat's fed counter lives in a loop local, so
 * it rides in and out through the context/result pair).
 */

import { PHYSICS } from '../constants';
import { infuseStar } from '../starGrowth';
import { applyDeliveryHeal } from '../starDefense';
import type { GameState, Harvester, SeatSimState, Star } from '../types';

export interface DroneStepContext {
  /** The frame's working state copy (drones / scrap / decoy). */
  next: GameState;
  /** Seat lookup by ownerId (a drone's home star is its seat's). */
  seatByOwnerId: Map<string, SeatSimState>;
  /** The legacy star pair (fallback if an ownerId ever misses the
   * seat table — unreachable in SP). */
  star: Star;
  enemyStar: Star;
  /** The local seat's ownerId (its deliveries feed teamScrap). */
  localOwnerId: string;
  /** The frame's teamScrap value on entry. */
  teamScrap: number;
}

export interface DroneStepResult {
  drones: Harvester[];
  /** teamScrap after this step's local-seat deliveries. */
  teamScrap: number;
}

export const stepDrones = (ctx: DroneStepContext): DroneStepResult => {
  const { next, seatByOwnerId, star, enemyStar, localOwnerId } = ctx;
  let teamScrap = ctx.teamScrap;
  // 5. Drones Logic
  const drones = (next.drones || []).map(drone => {
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
  return { drones, teamScrap };
};
