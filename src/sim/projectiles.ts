/**
 * Projectile + mine steps (dedicated loop split, 2026-10-20):
 * "6. Projectiles and Defense" from the game loop's frame body,
 * extracted verbatim — seeker steering, projectile motion, the
 * Siphon VAC eat, Mirror Sail reflection, Deflector / Scrap Aegis /
 * Thorn Hull resolution on the local ship, plain hits on other
 * seats' ships, drone hits (with the ion disable), and star hits.
 *
 * The MINES step travels with this module (the brief's either/or,
 * decided here): a mine is a static member of the same hostile-
 * interaction family — its trip check reads the drone positions the
 * drone step just produced, its blast resolves with the same
 * damage / lastHit bookkeeping as projectile hits, and in the frame
 * order it runs immediately before the projectile step, called from
 * the same place the inline code ran.
 *
 * Both steps mutate the frame's working copies handed in through
 * the context (ship, stars, drones, decoy, the shared scrap list)
 * and the loop's own closures (aegisAbsorb, starByOwnerId) — the
 * data flow is the inline code's, unchanged; only the location
 * moved.
 */

import { COLORS, PHYSICS } from '../constants';
import {
  mirrorReflectDamageFor,
  siphonFuelFor,
  thornDamageFor,
} from '../loadout';
import { areHostile } from './teams';
import type {
  GameState,
  Mine,
  Projectile,
  Scrap,
  SeatSimState,
  Ship,
  Star,
} from '../types';

export interface MineStepContext {
  /** The frame's working state copy (mines / drones / shake). */
  next: GameState;
  /** Every seat in the match (hostile-star blast checks). */
  simSeats: SeatSimState[];
  /** The loop clock (performance.now-based, ms). */
  time: number;
}

export const stepMines = (ctx: MineStepContext): Mine[] => {
  const { next, simSeats, time } = ctx;
  // MINES (Slice 4): a hostile drone wandering inside a mine's
  // radius trips it — everything hostile in the blast takes the
  // damage, including hostile stars if one is somehow close.
  // (Hostile = TEAMS: not the mine's TEAM; in SP, the enemy's.)
  return (next.mines || []).filter(mine => {
    const tripped = next.drones.some(d => areHostile(simSeats, d.ownerId, mine.ownerId) &&
      Math.hypot(d.pos.x - mine.pos.x, d.pos.y - mine.pos.y) < mine.radius);
    if (!tripped) return true;
    next.drones.forEach(d => {
      if (areHostile(simSeats, d.ownerId, mine.ownerId) && Math.hypot(d.pos.x - mine.pos.x, d.pos.y - mine.pos.y) < mine.radius) {
        d.health -= mine.damage;
        d.lastHitByOwnerId = mine.ownerId;
      }
    });
    for (const seat of simSeats) {
      const s = seat.star;
      if (!areHostile(simSeats, s.ownerId, mine.ownerId)) continue;
      if (Math.hypot(s.pos.x - mine.pos.x, s.pos.y - mine.pos.y) < mine.radius + s.size) {
        s.integrity -= mine.damage * 0.002;
        s.lastHitTime = time;
      }
    }
    next.shakeAmount = Math.max(next.shakeAmount, 12);
    return false;
  });
};

export interface ProjectileStepContext {
  /** The frame's working state copy (projectiles / drones / decoy /
   * shake / glitch). */
  next: GameState;
  /** The local seat's ship (this frame's working copy) — the
   * loadout-defense resolution is bound to this ship. */
  ship: Ship;
  /** Every seat in the match (other ships + stars are hit targets). */
  simSeats: SeatSimState[];
  /** The loop's star lookup by ownerId (the thorn bite's target). */
  starByOwnerId: (ownerId: string) => Star;
  /** The local seat's ownerId. */
  localOwnerId: string;
  /** The frame's live scrap list (ion drops push into it) — the
   * same array the loop returns in state. */
  newScrap: Scrap[];
  /** The local ship's equipped hybrid + tier (frame-resolved). */
  hyId: Ship['loadout']['hybrid'];
  hyTier: number;
  /** Whether VAC is active this frame (the physics step's result). */
  isVacActive: boolean;
  /** The loop clock (performance.now-based, ms). */
  time: number;
  /** The loop's Scrap Aegis absorb closure for this frame. */
  aegisAbsorb: (dmg: number) => number;
}

export const stepProjectiles = (ctx: ProjectileStepContext): Projectile[] => {
  const { next, ship, simSeats, starByOwnerId, localOwnerId, newScrap, hyId, hyTier, isVacActive, time, aegisAbsorb } = ctx;
  // 6. Projectiles and Defense
  return (next.projectiles || []).filter(p => {
    // Seeker torpedoes steer toward the nearest hostile drone,
    // turning at most 0.15 rad/frame so they arc rather than snap.
    if (p.kind === 'seeker_torpedoes') {
      let best: any = null;
      let bestD = 700;
      next.drones.forEach(d => {
        if (!areHostile(simSeats, d.ownerId, p.ownerId)) return;
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

    // STARS BLOCK AMMO (Adam, 2026-10-21): a projectile that
    // reaches ANY star's surface terminates there — stars are
    // terrain, checked before every other hit. Damage applies
    // only where the standing rules already allow it: ship-fired
    // weapons (kind set) against a HOSTILE star, on the universal
    // damage x 0.002 scale (Slice 4 repair: the old x 0.5 would
    // have ended games outright). Turret bolts (kind unset) NEVER
    // damage stars (Adam's ruling, 2026-10-20) and friendly stars
    // take no damage — for those bolts this is purely a stop.
    // (TEAMS: "hostile star" reads hostile TEAM via areHostile,
    // as everywhere here.)
    // THE RAIL LANCE EXCEPTION (Adam's ruling, 2026-10-21): the
    // lance fires THROUGH stars — exempt from termination. A
    // hostile star takes its hit as the bolt passes (deduped per
    // star via hitIds, as the pre-block pierce code had it); a
    // friendly star is simply flown through. Every OTHER
    // projectile — pierce included — stops at the surface.
    for (const seat of simSeats) {
      const s = seat.star;
      const sdx2 = s.pos.x - p.pos.x;
      const sdy2 = s.pos.y - p.pos.y;
      if (Math.sqrt(sdx2 * sdx2 + sdy2 * sdy2) >= s.size) continue;
      if (p.kind === 'rail_lance') {
        const hitKey = `star:${s.ownerId}`;
        if (
          areHostile(simSeats, s.ownerId, p.ownerId) &&
          !(p.hitIds || []).includes(hitKey)
        ) {
          s.integrity -= (p.damage !== undefined ? p.damage : PHYSICS.DEFENSE.DAMAGE) * 0.002;
          s.lastHitTime = time;
          (p.hitIds = p.hitIds || []).push(hitKey);
        }
        continue;
      }
      if (p.kind !== undefined && areHostile(simSeats, s.ownerId, p.ownerId)) {
        s.integrity -= (p.damage !== undefined ? p.damage : PHYSICS.DEFENSE.DAMAGE) * 0.002;
        s.lastHitTime = time;
      }
      return false;
    }

    // SIPHON VAC (Phase 1b): while the VAC runs, the tractor beam
    // eats enemy projectiles that cross its field and converts them
    // into a trickle of fuel. INTERPRETATION (flagged for Adam):
    // the description names the tractor beam, and in this code the
    // beam's deliberate mode is ACTIVE VAC (Q/E/R) — so eating is
    // gated on VAC being held, over the same radius that hauls
    // scrap while VAC is on (attractRadius x 1.6). Ungated, the
    // passive attract field would eat every bolt near the ship and
    // quietly retire the Deflector Shield's whole job.
    if (hyId === 'siphon_vac' && areHostile(simSeats, p.ownerId, ship.ownerId) && isVacActive &&
        Math.hypot(ship.pos.x - p.pos.x, ship.pos.y - p.pos.y) < ship.attractRadius * 1.6) {
      ship.fuel = Math.min(ship.maxFuel, ship.fuel + siphonFuelFor(hyTier));
      return false;
    }

    // Collision with the DECOY beacon (Slice 6): hostile bolts eat
    // the beacon instead of the ship, until it is shot down.
    // (TEAMS: hostile to the DECOY's team — a teammate's bolt
    // flies past their own side's beacon.)
    if (next.decoy && areHostile(simSeats, p.ownerId, next.decoy.ownerId) &&
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
    if (areHostile(simSeats, p.ownerId, ship.ownerId) && Math.sqrt(sdx * sdx + sdy * sdy) < ship.size) {
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
      if (!bs || seat.ownerId === localOwnerId || !areHostile(simSeats, p.ownerId, seat.ownerId)) continue;
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
      const hitDrone = next.drones.find(d => areHostile(simSeats, d.ownerId, p.ownerId) &&
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

    // (Star collisions resolve at the top of this step now —
    // STARS BLOCK AMMO: every projectile terminates on any star's
    // surface, damaging only a hostile star and only when
    // ship-fired. See the block after the movement increment.)

    return p.life > 0;
  });
};
