/**
 * CME step (dedicated loop split, 2026-10-20): the CORONAL MASS
 * EJECTIONS block from the game loop's frame body, extracted
 * verbatim — per-star charge / telegraph / fire (aim locked at
 * charge start, per seat, with the shipped local-vs-other aiming
 * preferences), then the wave advance: dissipating damage /
 * knockback falloff, the decoy eat, the local ship's full
 * hardening / shield / aegis wash, other seats' ships' plain wash,
 * and the drone wash.
 *
 * The step mutates the frame's working copies handed in through
 * the context (the stars' CME timers on the seat records, the ship,
 * next.cmes / next.drones / next.decoy / shake / glitch) and calls
 * the loop's aegisAbsorb closure — the inline code's data flow,
 * unchanged; only the location moved.
 */

import { PHYSICS } from '../constants';
import { milestonesForInfused } from '../starGrowth';
import { cmeReductionFor } from '../loadout';
import type { GameState, SeatSimState, Ship } from '../types';

export interface CmeStepContext {
  /** The frame's working state copy (cmes / drones / decoy / shake /
   * glitch). */
  next: GameState;
  /** Every seat in the match (each seat's star charges + fires). */
  simSeats: SeatSimState[];
  /** The local seat's ownerId (its ship gets the defended wash;
   * its star's waves skip it). */
  localOwnerId: string;
  /** The local seat's ship (this frame's working copy). */
  ship: Ship;
  /** The local ship's equipped defense + tier (frame-resolved;
   * CME Hardening reads them). */
  defId: Ship['loadout']['defense'];
  defTier: number;
  /** Grav Dampers factor for the local ship (loop-resolved). */
  gravFactor: number;
  /** The loop clock (performance.now-based, ms). */
  time: number;
  /** The loop's Scrap Aegis absorb closure for this frame. */
  aegisAbsorb: (dmg: number) => number;
}

export const stepCme = (ctx: CmeStepContext): void => {
  const { next, simSeats, localOwnerId, ship, defId, defTier, gravFactor, time, aegisAbsorb } = ctx;
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
};
