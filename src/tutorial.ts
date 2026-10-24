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

/* ================================================================
 * UI-LANE COPY (appended at integration, 2026-10-23): the engine
 * table above carries truth; everything below is voice — device-
 * aware step copy keyed by the table's ids, the plain-name track
 * list, and the surface snapshot types. Copy law: plain words;
 * controls named for the device in hand; SPACE stays jettison.
 * ================================================================ */

export type TutorialStepId = 'fly' | 'scoop' | 'home' | 'bank' | 'workshop' | 'line' | 'teeth' | 'match';
export type TutorialSpotlightId = 'plate' | 'vac' | 'dock' | 'workshopDoor' | 'climbPill' | 'strip';

export interface TutorialStepCopy {
  title: string;
  phone: string;
  desktop: string;
  callout?: string;
}

export const TUTORIAL_COPY: Record<TutorialStepId, TutorialStepCopy> = {
  fly: {
    title: 'FLY',
    phone: 'Hold THRUST and steer with the stick — reach the marked scrap vein.',
    desktop: 'Thrust with W, steer with A / D — reach the marked scrap vein.',
    callout: 'THAT’S YOUR PLATE — your ship, its tier, the next climb’s price. The meters with it are your hull and fuel.',
  },
  scoop: {
    title: 'SCOOP',
    phone: 'Tap VAC, then drift through the vein — gather 3 scrap in your hold.',
    desktop: 'Q switches your vacuum — drift through the vein and gather 3 scrap in your hold.',
    callout: 'VACUUM — your pull. Scrap inside its reach drifts to you; the number is how far it reaches.',
  },
  home: {
    title: 'BRING IT HOME',
    phone: 'Fly back into your star’s glow — the dock doors wake inside it.',
    desktop: 'Fly back into your star’s glow — the dock doors wake inside it.',
    callout: 'THE DOCK — inside the glow these doors work: FEED · BANK · WORKSHOP.',
  },
  bank: {
    title: 'BANK FIRST',
    phone: 'Tap BANK at the dock. Banked scrap is upgrade money — safe even if you fall. Feeding grows your star; that’s for when your ship is ready.',
    desktop: 'Bank at the dock. Banked scrap is upgrade money — safe even if you fall. Feeding grows your star; that’s for when your ship is ready.',
  },
  workshop: {
    title: 'THE WORKSHOP',
    phone: 'A 300U TRAINING STIPEND just landed in your bank — the fleet bankrolls your first upgrades. Buy any track.',
    desktop: 'U is the workshop door. A 300U TRAINING STIPEND just landed in your bank — buy any track.',
    callout: 'THE WORKSHOP — every upgrade lives here. It only opens docked, and closes when you leave the glow.',
  },
  line: {
    title: 'YOUR LINE',
    phone: 'Open the frame door and climb — pick a line, take your first T2. The stipend was for this.',
    desktop: 'Open the frame door and climb — pick a line, take your first T2. The stipend was for this.',
    callout: 'THE CLIMB PILL — when a climb is affordable, this pill lights. One tap opens the frame door.',
  },
  teeth: {
    title: 'TEETH',
    phone: 'Tap FIRE — your cannon answers. First blood ends the lesson.',
    desktop: 'F fires your cannon. First blood ends the lesson.',
    callout: 'YOUR STRIP — the cannon cell. It lights when it can fire; digits pick, T swaps.',
  },
  match: {
    title: 'THE MATCH',
    phone: 'Two stars. Break theirs, or feed yours into a black hole — the race is the game. Fly it.',
    desktop: 'Two stars. Break theirs, or feed yours into a black hole — the race is the game. TAB cycles targets. Fly it.',
    callout: 'THE RADAR — the whole field at a glance. Red is the enemy.',
  },
};

// The workshop step's plain-name track list (Adam's pin: 'common
// ship upgrades like hold size, thrust, etc.').
export const TUTORIAL_TRACKS: { name: string; payoff: string }[] = [
  { name: 'THRUST', payoff: 'top speed' },
  { name: 'HANDLING', payoff: 'turning' },
  { name: 'VACUUM', payoff: 'scrap pull' },
  { name: 'FUEL', payoff: 'tank size' },
  { name: 'HOLD SIZE', payoff: 'how much you carry' },
];

// The surface snapshot App composes from the loop's published
// pieces ({active, step} + the step table + the marker).
export interface TutorialSnapshot {
  active: boolean;
  step: number;
  stepId: TutorialStepId;
  spotlight: TutorialSpotlightId | null;
  marker: TutorialMarker | null;
}
