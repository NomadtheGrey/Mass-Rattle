/**
 * THE GUIDED FLIGHT — step table (Adam's tutorial program,
 * 2026-10-23; form by the UI lane, truth here). Eight beats over a
 * real solo match: the machine in useGameLoop advances a step when
 * its predicate sees the player DO the thing — nothing is theatre.
 *
 * The instance law (the loop enforces): a tutorial boot is a fresh
 * solo match with the enemy captain PARKED (his driver and economy
 * skip) until TEETH unparks him; the solo save neither loads nor
 * writes during a tutorial; graduation ends the tutorial IN PLACE —
 * the match you built becomes your real solo game.
 *
 * Copy lives with the UI lane (device-aware voices); this table
 * carries ids, markers, spotlights and truth only. The stipend is
 * scaffolding with a name: the fleet bankrolls your first frame —
 * one banked hold (5–10u) cannot reach a 150–200u T2, and the
 * tutorial's job is momentum, not the economy's real grind.
 */
import type { GameState, Vector2D } from './types';
import { inTeamWell } from './sim/seatShop';

export const TUTORIAL_FLAG_KEY = 'mr.tutorial.v1';
export const TUTORIAL_STIPEND = 300;
export const TEETH_INDEX = 6; // steps 0..5 park the captain

export interface TutorialMarker { pos: Vector2D; label: string; tone: 'go' | 'enemy' }
export interface TutorialBaseline {
  banked: number;
  tracksSum: number;
  hullSteps: number;
  tier: number;
  enemyHealth: number;
  startedAt: number;
}
export interface TutorialStep {
  id: string;
  /** HUD anchor the walkthrough spotlights at this step (UI's ids). */
  spotlight?: string;
  marker: (s: GameState) => TutorialMarker | null;
  done: (b: TutorialBaseline, s: GameState, now: number) => boolean;
}

export const captureBaseline = (s: GameState, now: number): TutorialBaseline => ({
  banked: s.bankedScrap,
  tracksSum: Object.values(s.ship.upgrades).reduce((a, v) => a + v, 0),
  hullSteps: s.ship.hullSteps,
  tier: s.ship.typeTier,
  enemyHealth: s.seats[1]?.ship?.health ?? 0,
  startedAt: now,
});

const nearestScrap = (s: GameState): Vector2D | null => {
  let best: Vector2D | null = null; let bestD = Infinity;
  for (const sc of s.scrap) {
    const d = Math.hypot(sc.pos.x - s.ship.pos.x, sc.pos.y - s.ship.pos.y);
    if (d < bestD) { bestD = d; best = sc.pos; }
  }
  return best;
};
const homeMarker = (s: GameState): TutorialMarker => ({ pos: s.star.pos, label: '⭐ YOUR STAR', tone: 'go' });

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'fly', spotlight: 'plate',
    marker: s => { const p = nearestScrap(s); return p ? { pos: p, label: '⛏ SCRAP VEIN', tone: 'go' } : null; },
    done: (b, s) => { const p = nearestScrap(s); return p !== null && Math.hypot(p.x - s.ship.pos.x, p.y - s.ship.pos.y) <= 320; },
  },
  {
    id: 'scoop', spotlight: 'vac',
    marker: s => { const p = nearestScrap(s); return p ? { pos: p, label: '⛏ SCOOP THE SCRAP', tone: 'go' } : null; },
    done: (b, s) => s.ship.carrying >= 3,
  },
  {
    id: 'home', spotlight: 'dock',
    marker: homeMarker,
    done: (b, s) => s.ship.carrying > 0 && inTeamWell(s.seats, s.ship),
  },
  {
    id: 'bank',
    marker: homeMarker,
    done: (b, s) => s.bankedScrap > b.banked,
  },
  {
    id: 'workshop', spotlight: 'workshopDoor',
    marker: homeMarker,
    done: (b, s) =>
      Object.values(s.ship.upgrades).reduce((a, v) => a + v, 0) > b.tracksSum ||
      s.ship.hullSteps > b.hullSteps || s.ship.typeTier > b.tier,
  },
  {
    id: 'line', spotlight: 'climbPill',
    marker: homeMarker,
    done: (b, s) => s.ship.typeTier >= 2,
  },
  {
    id: 'teeth', spotlight: 'strip',
    marker: s => { const e = s.seats[1]?.ship; return e ? { pos: e.pos, label: '⚔ ENEMY', tone: 'enemy' } : null; },
    done: (b, s, now) => {
      const e = s.seats[1]?.ship;
      return (e !== null && e !== undefined && e.health < b.enemyHealth) || now - b.startedAt >= 45000;
    },
  },
  {
    id: 'match',
    marker: s => ({ pos: s.enemyStar.pos, label: '⚔ THE ENEMY STAR', tone: 'enemy' }),
    done: (b, s, now) => now - b.startedAt >= 20000,
  },
];
