/**
 * Carrier-wing escort step (Arsenal slice 5b, 2026-10-21 — the
 * program's summit). Escorts are real little ships (full Ship
 * objects in GameState.escorts) flown by the offense engine's
 * discipline: the bot driver's acquisition + volley math (slice
 * 5a), on a GUARD leash — an escort's world is its anchor.
 *
 *   anchor   — the owner's ship, or her star while she is shipless
 *              (the wing persists through the carrier's death,
 *              like her drones do, and re-anchors on repurchase).
 *   station  — a slot on a ring around the anchor (radius = the
 *              anchor's surface + a pad), spread by wing order.
 *   engage   — the nearest hostile within ENGAGE_RANGE of the
 *              escort AND within LEASH_RANGE of the anchor: drones
 *              first (the family precedent), then hulls — seat
 *              ships and hostile escorts alike. Ship acquisition
 *              is stealth-aware (isVisibleTo), as ruled.
 *   hold     — close to HOLD_RANGE of the target and fire; never
 *              chase past the leash. No star siege, no harvesting:
 *              escorts GUARD.
 *
 * Death: the projectile step damages escorts as plain hulls; a
 * wreck (health <= 0) drops out here (its salvage scrap was dropped
 * by the projectile pass that killed it). An eliminated seat's
 * wing dissolves with the seat.
 *
 * Known boundaries (flagged, deliberate): star turrets acquire
 * seat ships only, so escorts draw ship/drone/escort fire but not
 * turret fire; hostile-star proximity burn does not apply to
 * escorts (the leash keeps them home in practice).
 */

import { BOT_DRIVER } from './botDriver';
import { weaponStatsFor } from '../loadout';
import { EXTRA_MOUNT_DAMAGE, typeFor, healCapPctFor, healRateFor } from '../shipProgression';
import { isVisibleTo } from './stealth';
import { repairFrame, ESCORT_DOCK_PAD } from './repair';
import { areHostile, type TeamSeatLike } from './teams';
import type {
  EscortShip,
  Harvester,
  Projectile,
  SeatSimState,
} from '../types';

/** Escort tuning — DRAFT numbers, one block, the numbers pass owns them. */
export const ESCORT_AI = {
  /** Acquire hostiles within this distance of the ESCORT. */
  ENGAGE_RANGE: 600,
  /** Never engage a target farther than this from the ANCHOR. */
  LEASH_RANGE: 750,
  /** Stop closing at this distance from the target and fire. */
  HOLD_RANGE: 380,
  /** Station ring distance beyond the anchor's surface. */
  STATION_PAD: 55,
};

export interface EscortStepContext {
  next: {
    escorts: EscortShip[];
    drones: Harvester[];
    projectiles: Projectile[];
  };
  seatByOwnerId: ReadonlyMap<string, SeatSimState>;
  /** The seat table (TEAMS hostility reads). */
  seats: readonly TeamSeatLike[];
  /** The loop clock (ms) for fire cooldowns. */
  time: number;
  /** The local seat's ownerId (projectile legacy-owner labels). */
  localOwnerId: string;
}

const angleLerp = (from: number, to: number, maxStep: number): number => {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return from + Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
};

/**
 * Advance every escort one frame. Mutates the frame copies it is
 * handed (the loop passes the frame's working array) and returns
 * the survivors in wing order; new projectiles are pushed into
 * ctx.next.projectiles, which first move next frame — the same
 * production-phase discipline as bot volleys.
 */
export const stepEscorts = (ctx: EscortStepContext): EscortShip[] => {
  const { next, seatByOwnerId, seats, time, localOwnerId } = ctx;
  const survivors: EscortShip[] = [];

  // Wing order per owner (station slots spread by this order).
  const wingOf = new Map<string, EscortShip[]>();
  for (const e of next.escorts) {
    const wing = wingOf.get(e.ownerId) || [];
    wing.push(e);
    wingOf.set(e.ownerId, wing);
  }

  for (const escort of next.escorts) {
    const seat = seatByOwnerId.get(escort.ownerId);
    if (!seat || seat.eliminated) continue; // the wing dissolves with its seat
    if (escort.health <= 0) continue; // a wreck; salvage already dropped

    const anchor = seat.ship ?? seat.star;
    const anchorRadius = seat.ship ? seat.ship.size : seat.star.size;
    const wing = wingOf.get(escort.ownerId)!;
    const slot = wing.indexOf(escort);

    // ESCORT DOCKING (the harvester-docking law read across —
    // RULED family, 2026-10-22): while the escort's health sits
    // below its REPAIR CAP (its kind's, off the heal table),
    // its carrier — a living SHIP; the star is no dock — is its
    // whole world: it flies the road home (no acquisition, no
    // fire), then rides alongside inside dock range, out of the
    // fight, healing from the carrier's hold at its kind's rate
    // up to its kind's cap. The cap is the threshold AND the
    // ceiling, so no kind can dock-loop. Alongside is not
    // inside: a docked escort remains targetable.
    const carrier = seat.ship ?? null;
    if (carrier && escort.health < escort.maxHealth * healCapPctFor(escort.line, escort.typeTier)) {
      const ceiling = escort.maxHealth * healCapPctFor(escort.line, escort.typeTier);
      const distToCarrier = Math.hypot(escort.pos.x - carrier.pos.x, escort.pos.y - carrier.pos.y);
      if (distToCarrier <= carrier.size + ESCORT_DOCK_PAD) {
        const a = (Math.PI * 2 * slot) / Math.max(1, wing.length);
        escort.pos.x = carrier.pos.x + Math.cos(a) * (carrier.size + 14);
        escort.pos.y = carrier.pos.y + Math.sin(a) * (carrier.size + 14);
        escort.vel.x = carrier.vel.x;
        escort.vel.y = carrier.vel.y;
        escort.angle = a;
        repairFrame(escort, carrier, ceiling, healRateFor(escort.line, escort.typeTier) / 60);
        survivors.push(escort);
        continue;
      }
      const want = Math.atan2(carrier.pos.y - escort.pos.y, carrier.pos.x - escort.pos.x);
      escort.angle = angleLerp(escort.angle, want, BOT_DRIVER.TURN_RATE);
      escort.vel.x += Math.cos(escort.angle) * BOT_DRIVER.ACCEL;
      escort.vel.y += Math.sin(escort.angle) * BOT_DRIVER.ACCEL;
      escort.vel.x *= BOT_DRIVER.FRICTION;
      escort.vel.y *= BOT_DRIVER.FRICTION;
      const sp = Math.hypot(escort.vel.x, escort.vel.y);
      if (sp > BOT_DRIVER.MAX_SPEED) {
        const r = BOT_DRIVER.MAX_SPEED / sp;
        escort.vel.x *= r;
        escort.vel.y *= r;
      }
      escort.pos.x += escort.vel.x;
      escort.pos.y += escort.vel.y;
      escort.thrust = sp > 0.4;
      survivors.push(escort);
      continue;
    }

    // --- Target acquisition (5a discipline, leashed) -------------
    let target: { x: number; y: number } | null = null;
    let targetDist = Infinity;
    const consider = (pos: { x: number; y: number }) => {
      const d = Math.hypot(pos.x - escort.pos.x, pos.y - escort.pos.y);
      if (d > ESCORT_AI.ENGAGE_RANGE || d >= targetDist) return;
      const anchorD = Math.hypot(pos.x - anchor.pos.x, pos.y - anchor.pos.y);
      if (anchorD > ESCORT_AI.LEASH_RANGE) return;
      target = pos;
      targetDist = d;
    };
    for (const d of next.drones) {
      if (d.state === 'docked') continue; // inside its ship
      if (areHostile(seats, d.ownerId, escort.ownerId)) consider(d.pos);
    }
    if (!target) {
      for (const s of seats) {
        const hull = (s as SeatSimState).ship;
        if (!hull || s.ownerId === escort.ownerId) continue;
        if (!areHostile(seats, s.ownerId, escort.ownerId)) continue;
        if (!isVisibleTo(hull, escort.pos)) continue;
        consider(hull.pos);
      }
      for (const other of next.escorts) {
        if (other === escort || other.health <= 0) continue;
        if (!areHostile(seats, other.ownerId, escort.ownerId)) continue;
        if (!isVisibleTo(other, escort.pos)) continue;
        consider(other.pos);
      }
    }

    // --- Destination: the target, or the station slot -------------
    let dest: { x: number; y: number } | null = null;
    if (target && targetDist > ESCORT_AI.HOLD_RANGE) {
      dest = target;
    } else if (!target) {
      const a = (Math.PI * 2 * slot) / Math.max(1, wing.length);
      dest = {
        x: anchor.pos.x + Math.cos(a) * (anchorRadius + ESCORT_AI.STATION_PAD),
        y: anchor.pos.y + Math.sin(a) * (anchorRadius + ESCORT_AI.STATION_PAD),
      };
      // Arrived: sit nose-out instead of jittering around the point.
      if (Math.hypot(dest.x - escort.pos.x, dest.y - escort.pos.y) < 6) {
        escort.angle = a;
        dest = null;
      }
    }

    // --- Steer + integrate (the bot driver's idiom) ---------------
    if (dest) {
      const want = Math.atan2(dest.y - escort.pos.y, dest.x - escort.pos.x);
      escort.angle = angleLerp(escort.angle, want, BOT_DRIVER.TURN_RATE);
      escort.vel.x += Math.cos(escort.angle) * BOT_DRIVER.ACCEL;
      escort.vel.y += Math.sin(escort.angle) * BOT_DRIVER.ACCEL;
    }
    escort.vel.x *= BOT_DRIVER.FRICTION;
    escort.vel.y *= BOT_DRIVER.FRICTION;
    const speed = Math.hypot(escort.vel.x, escort.vel.y);
    if (speed > BOT_DRIVER.MAX_SPEED) {
      const ratio = BOT_DRIVER.MAX_SPEED / speed;
      escort.vel.x *= ratio;
      escort.vel.y *= ratio;
    }
    escort.pos.x += escort.vel.x;
    escort.pos.y += escort.vel.y;
    escort.thrust = speed > 0.4;

    // --- Fire (the bot driver's volley discipline) ----------------
    const weaponId = escort.loadout.weapon;
    const wStats = weaponStatsFor(
      weaponId,
      weaponId ? escort.arsenal[weaponId] || 0 : 0,
    );
    if (
      target &&
      wStats &&
      !wStats.scrapCost &&
      wStats.kind !== 'mine' &&
      targetDist <= BOT_DRIVER.FIRE_RANGE &&
      time >= (escort.fireReadyAt || 0)
    ) {
      const aim = Math.atan2(target.y - escort.pos.y, target.x - escort.pos.x);
      const mounts = typeFor(escort.line, escort.typeTier).hardPoints;
      for (let m = 0; m < mounts; m++) {
        const dmgScale = m === 0 ? 1 : EXTRA_MOUNT_DAMAGE;
        const side = m === 0 ? 0 : (m % 2 === 1 ? 1 : -1) * Math.ceil(m / 2);
        const off = side * escort.size * 0.7;
        const muzzle = {
          x: escort.pos.x + Math.cos(escort.angle) * (escort.size + 4) - Math.sin(escort.angle) * off,
          y: escort.pos.y + Math.sin(escort.angle) * (escort.size + 4) + Math.cos(escort.angle) * off,
        };
        const pellets = wStats.pellets || 1;
        for (let pi = 0; pi < pellets; pi++) {
          const spreadOffset =
            pellets > 1 ? (pi / (pellets - 1) - 0.5) * (wStats.spread || 0) : 0;
          const a = aim + spreadOffset;
          next.projectiles.push({
            id: Math.random().toString(),
            pos: { ...muzzle },
            vel: {
              x: Math.cos(a) * wStats.speed + escort.vel.x * 0.5,
              y: Math.sin(a) * wStats.speed + escort.vel.y * 0.5,
            },
            owner: escort.ownerId === localOwnerId ? 'player' : 'enemy',
            ownerId: escort.ownerId,
            life: wStats.life,
            damage: wStats.damage * dmgScale,
            kind: weaponId || undefined,
            pierce: wStats.pierce,
            size: wStats.size,
            hitIds: wStats.pierce ? [] : undefined,
          });
        }
      }
      escort.fireReadyAt = time + wStats.cooldownMs;
    }

    survivors.push(escort);
  }
  return survivors;
};
