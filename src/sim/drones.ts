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
import { STAR_DRONE_RESPAWN_FRAMES, starDroneRangeFor, starDroneTargetFor } from '../starFleet';
import { applyDeliveryHeal } from '../starDefense';
import { areHostile } from './teams';
import { repairFrame, DRONE_DOCK_HEALTH, DRONE_DOCK_RATE_PER_SEC } from './repair';
import { AUTO_GUN, DEFENSE_DRONE, DRONE_MAX_HEALTH, DRONE_PRICE, canOrderWorkforce, typeFor } from '../shipProgression';
import type { GameState, Harvester, SeatSimState, Star, Vector2D } from '../types';

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
  // TEAMS hostility reads (the seat table, as a list).
  const simSeats = [...seatByOwnerId.values()];
  // THE LAST TRIP (Adam, 2026-10-22): ids of liquidated
  // harvesters whose sale settled this frame — filtered out of
  // the step's result below, once the map has run.
  const settledSales = new Set<string>();
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

    // Drone QUALITY (Arsenal slice 3): the owner's current ship
    // type grades its workforce — speed reads live (a better hull
    // directs better drones), shipless owners fly baseline. The
    // STAR FLEET is not the captain's workforce (it is excluded
    // from their counts on the same logic), so it flies baseline
    // regardless of the hull overhead.
    const ownerShip = seatByOwnerId.get(drone.ownerId)?.ship ?? null;
    const speedMul = ownerShip && !drone.starFleet
      ? 1 + typeFor(ownerShip.line, ownerShip.typeTier).droneSpeedPct / 100
      : 1;
    const droneSpeed = PHYSICS.DRONES.SPEED * speedMul;
    // STAR FLEET leash (2026-10-22): a fleet drone only gleans
    // within its star's current fleet range — young stars glean
    // near, old stars sweep far (src/starFleet.ts).
    const fleetRange = drone.starFleet ? starDroneRangeFor(droneStar) : Infinity;

    // THE LAST TRIP (Adam's final shape, 2026-10-22): a
    // liquidated harvester abandons everything — its work, the
    // decoy, the dock — and flies home to be sold. Forcing its
    // state to 'returning' hands it to the ordinary return
    // steering below (a docked drone undocks into the trip);
    // the arrival there settles the SALE, not a delivery.
    if (drone.liquidating && drone.state !== 'returning') {
      drone.state = 'returning';
    }

    // DEFENSE MODE (Arsenal slice 3 — Adam's hauler pair): a
    // defense drone never harvests. It holds a station off its
    // anchor (the owner's ship, or the home star when shipless —
    // station radius rides the anchor's surface, the turret
    // standoff shape) and fires light bolts at hostiles in range:
    // hostile DRONES first (the workforce-killers), then ships.
    // Bolts are kind 'auto_gun' with the drone's ownerId, so they
    // run the same hit paths as shipboard turret fire.
    if (drone.mode === 'defense') {
      const anchor: { pos: Vector2D } = ownerShip ?? droneStar;
      const anchorRadius = ownerShip
        ? ownerShip.size + 50
        : droneStar.size + 45;
      const siblings = next.drones.filter(
        d => d.ownerId === drone.ownerId && d.mode === 'defense',
      );
      const slot = Math.max(0, siblings.findIndex(d => d.id === drone.id));
      const slotAngle = (Math.PI * 2 * slot) / Math.max(1, siblings.length);
      const stationX = anchor.pos.x + Math.cos(slotAngle) * anchorRadius;
      const stationY = anchor.pos.y + Math.sin(slotAngle) * anchorRadius;

      let target: Vector2D | null = null;
      let bestD = DEFENSE_DRONE.range;
      next.drones.forEach(d => {
        if (d.id === drone.id) return;
        if (!areHostile(simSeats, drone.ownerId, d.ownerId)) return;
        const dd = Math.hypot(d.pos.x - drone.pos.x, d.pos.y - drone.pos.y);
        if (dd < bestD) { bestD = dd; target = d.pos; }
      });
      if (!target) {
        for (const seat of simSeats) {
          const s = seat.ship;
          if (!s) continue;
          if (!areHostile(simSeats, drone.ownerId, s.ownerId)) continue;
          const dd = Math.hypot(s.pos.x - drone.pos.x, s.pos.y - drone.pos.y);
          if (dd < bestD) { bestD = dd; target = s.pos; }
        }
      }

      if (target) {
        const aim = Math.atan2(target.y - drone.pos.y, target.x - drone.pos.x);
        drone.angle += (aim - drone.angle) * PHYSICS.DRONES.ROTATE_SPEED;
        if (Math.random() < DEFENSE_DRONE.fireChance) {
          next.projectiles.push({
            id: Math.random().toString(),
            pos: { x: drone.pos.x, y: drone.pos.y },
            vel: { x: Math.cos(aim) * AUTO_GUN.boltSpeed, y: Math.sin(aim) * AUTO_GUN.boltSpeed },
            owner: drone.owner,
            ownerId: drone.ownerId,
            life: AUTO_GUN.life,
            damage: DEFENSE_DRONE.damage,
            kind: 'auto_gun',
            size: 3,
          });
        }
      } else {
        // No contact: fly to the station and hold it, nose out.
        const dx = stationX - drone.pos.x;
        const dy = stationY - drone.pos.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 6) {
          const ta = Math.atan2(dy, dx);
          drone.angle += (ta - drone.angle) * PHYSICS.DRONES.ROTATE_SPEED;
          drone.pos.x += Math.cos(drone.angle) * droneSpeed;
          drone.pos.y += Math.sin(drone.angle) * droneSpeed;
        } else {
          const out = Math.atan2(drone.pos.y - anchor.pos.y, drone.pos.x - anchor.pos.x);
          drone.angle += (out - drone.angle) * PHYSICS.DRONES.ROTATE_SPEED;
        }
      }
      return drone;
    }

    // HARVESTER DOCKING (RULED by Adam, 2026-10-22; src/sim/
    // repair.ts): a WORKFORCE harvester — never the star fleet
    // (the star's own; she has no capital ship) and never the
    // defense pair (guards, not harvesters; they already live at
    // the ship) — hurt below DRONE_DOCK_HEALTH abandons its work
    // and flies to its capital ship, vulnerable on the road home.
    // Docked, it rides INSIDE the ship (untargetable: every
    // targeting read skips state 'docked'), out of service, and
    // heals to full from the ship's hold at the drone rate. At
    // full health it relaunches on its own. A drone whose ship
    // is GONE spills back to work at its current health — the
    // dock dies with the dock; the drone does not.
    const capitalShip = (!drone.starFleet && drone.mode !== 'defense')
      ? seatByOwnerId.get(drone.ownerId)?.ship ?? null
      : null;
    if (drone.state === 'docked') {
      if (!capitalShip) {
        drone.state = drone.carrying >= drone.capacity ? 'returning' : 'searching';
        return drone;
      }
      drone.pos.x = capitalShip.pos.x;
      drone.pos.y = capitalShip.pos.y;
      drone.vel.x = 0;
      drone.vel.y = 0;
      repairFrame(drone, capitalShip, DRONE_MAX_HEALTH, DRONE_DOCK_RATE_PER_SEC / 60);
      if (drone.health >= DRONE_MAX_HEALTH) {
        drone.state = drone.carrying >= drone.capacity ? 'returning' : 'searching';
      }
      return drone;
    }
    if (capitalShip && drone.health < DRONE_DOCK_HEALTH) {
      const dx = capitalShip.pos.x - drone.pos.x;
      const dy = capitalShip.pos.y - drone.pos.y;
      if (Math.hypot(dx, dy) < capitalShip.size + 12) {
        drone.state = 'docked';
        drone.pos.x = capitalShip.pos.x;
        drone.pos.y = capitalShip.pos.y;
        return drone;
      }
      const ta = Math.atan2(dy, dx);
      // The diff MUST wrap: a bearing of -PI and a heading of
      // +PI are the same direction, and the naive lerp rotates
      // the long way around the seam (the escorts' angleLerp
      // wraps for this reason; the older drone branches' seam
      // wobble is cosmetic, but a drone flying home to dock
      // crosses the seam dead-on whenever the road runs level).
      let diff = ta - drone.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      drone.angle += diff * PHYSICS.DRONES.ROTATE_SPEED;
      drone.pos.x += Math.cos(drone.angle) * droneSpeed;
      drone.pos.y += Math.sin(drone.angle) * droneSpeed;
      return drone;
    }

    // Decoy Beacon: hostile drones within 500 chase the beacon
    // instead of working — it screams "hostile" louder than scrap
    // whispers, and a returning drone delays its delivery to chase
    // it. (Hostile = TEAMS: not the decoy's TEAM; in SP, the
    // enemy's.) The STAR FLEET never chases: they are gleaners,
    // not guards — the defense pair does the guarding.
    if (!drone.starFleet && !drone.liquidating && next.decoy && areHostile(simSeats, drone.ownerId, next.decoy.ownerId)) {
      const bx = next.decoy.pos.x - drone.pos.x;
      const by = next.decoy.pos.y - drone.pos.y;
      const bd = Math.hypot(bx, by);
      if (bd < 500) {
        const ba = Math.atan2(by, bx);
        drone.angle += (ba - drone.angle) * PHYSICS.DRONES.ROTATE_SPEED;
        if (bd > 30) {
          drone.pos.x += Math.cos(drone.angle) * droneSpeed;
          drone.pos.y += Math.sin(drone.angle) * droneSpeed;
        }
        return drone;
      }
    }
    
    if (drone.state === 'searching') {
      // Find closest scrap (STAR FLEET: only scrap inside the
      // fleet's leash of its home star is a candidate at all).
      let closestScrap = null;
      let minDist = Infinity;
      next.scrap.forEach(s => {
        // WRECK SALVAGE: a value shard banks whole or not at
        // all — never chase a pile the hold can't take entire.
        if ((s.value ?? 1) > drone.capacity - drone.carrying) return;
        if (drone.starFleet) {
          const sx = s.pos.x - droneStar.pos.x;
          const sy = s.pos.y - droneStar.pos.y;
          if (sx * sx + sy * sy > fleetRange * fleetRange) return;
        }
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
        
        drone.pos.x += Math.cos(drone.angle) * droneSpeed;
        drone.pos.y += Math.sin(drone.angle) * droneSpeed;

        if (dist < PHYSICS.DRONES.COLLECT_RADIUS) {
          // A shard banks its whole value (targeting already
          // refused piles that cannot fit entire).
          const piece = next.scrap.find(sp => sp.id === drone.targetId);
          drone.carrying += piece?.value ?? 1;
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
      // The diff wraps (the docking precedent, 2026-10-22): the
      // LAST TRIP rides this steering, and a liquidated drone
      // whose heading sits on the atan2 seam would otherwise
      // loop the long way home — or never arrive to be sold.
      let returnDiff = targetAngle - drone.angle;
      while (returnDiff > Math.PI) returnDiff -= Math.PI * 2;
      while (returnDiff < -Math.PI) returnDiff += Math.PI * 2;
      drone.angle += returnDiff * PHYSICS.DRONES.ROTATE_SPEED;
      
      drone.pos.x += Math.cos(drone.angle) * droneSpeed;
      drone.pos.y += Math.sin(drone.angle) * droneSpeed;

      if (dist < droneStar.size + PHYSICS.DRONES.DEPOSIT_RADIUS) {
        // THE LAST TRIP SETTLES (Adam, 2026-10-22): a liquidated
        // harvester's arrival is a SALE, not a delivery — its
        // cargo banks at face and the drone's own value banks
        // with it; the standing FEED/DEPOSIT order does not
        // govern a sale (no infusion, no heal, no teamScrap),
        // and the drone disappears (filtered from the result).
        if (drone.liquidating) {
          const saleSeat = seatByOwnerId.get(drone.ownerId);
          if (saleSeat) saleSeat.bankedScrap += drone.carrying + DRONE_PRICE;
          settledSales.add(drone.id);
          drone.carrying = 0;
          return drone;
        }
        const amount = drone.carrying;
        // WORKFORCE ORDERS (Adam, 2026-10-22): under a DEPOSIT
        // order the load BANKS into the seat's balance instead of
        // feeding — no infusion, no delivery heal, no teamScrap
        // (banking is not nourishment, and the fed counter stays
        // truthful). The STAR FLEET is never under orders: the
        // star's own gleaners always feed her. And the order BINDS
        // only while the captain flies a hauler hull — the game's
        // shelve law (slice 4): the standing order persists on the
        // seat across line switches and death, dormant, and binds
        // again the moment a hauler hull returns; off-hull (or
        // shipless, in the starter frame death leaves), the
        // workforce feeds.
        const ownerSeat = seatByOwnerId.get(drone.ownerId);
        if (
          !drone.starFleet &&
          ownerSeat?.deliveryMode === 'deposit' &&
          canOrderWorkforce(ownerSeat.ship?.line ?? null)
        ) {
          ownerSeat.bankedScrap += amount;
        } else {
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
        }
        drone.carrying = 0;
        drone.state = 'searching';
      }
    }

    return drone;
  });
  // Settled last-trip sales leave the world here (their banks
  // were credited in the map, at the arrival).
  if (settledSales.size) {
    for (let i = drones.length - 1; i >= 0; i--) {
      if (settledSales.has(drones[i].id)) drones.splice(i, 1);
    }
  }
  // STAR FLEET growth + regrowth (2026-10-22, src/starFleet.ts):
  // each living seat's star rebuilds its own fleet toward the
  // target its evolution sets — one birth per respawn interval,
  // growth and replacement alike (Adam: "if destroyed, then the
  // star can slowly respawn them"). The newborn is the birth
  // drone's twin, spawned by the star's own convention (100 per
  // axis toward the arena center, as in matchAssembly).
  for (const seat of seatByOwnerId.values()) {
    if (seat.eliminated) continue;
    const homeStar = seat.star;
    const target = starDroneTargetFor(homeStar);
    const fleetCount = drones.filter(
      d => d.starFleet && d.ownerId === seat.ownerId,
    ).length;
    if (fleetCount >= target) {
      homeStar.starDroneTimerFrames = 0;
      continue;
    }
    homeStar.starDroneTimerFrames = (homeStar.starDroneTimerFrames ?? 0) + 1;
    if (homeStar.starDroneTimerFrames < STAR_DRONE_RESPAWN_FRAMES) continue;
    homeStar.starDroneTimerFrames = 0;
    const seq = (homeStar.starDroneSeq ?? 1) + 1;
    homeStar.starDroneSeq = seq;
    drones.push({
      id: `${seat.ownerId}-stardrone-${seq}`,
      health: DRONE_MAX_HEALTH,
      pos: {
        x: homeStar.pos.x - Math.sign(homeStar.pos.x) * 100,
        y: homeStar.pos.y - Math.sign(homeStar.pos.y) * 100,
      },
      vel: { x: 0, y: 0 },
      angle: 0,
      targetId: null,
      carrying: 0,
      capacity: PHYSICS.DRONES.CAPACITY,
      owner: seat.starIndex === 0 ? 'player' : 'enemy',
      ownerId: seat.ownerId,
      state: 'searching',
      starFleet: true,
    });
  }

  return { drones, teamScrap };
};
