// THE GUIDED FLIGHT — contract + copy (Adam's delegation, 2026-10-23:
// 'Let UI figure out best tutorial/display model.' The form ruled by
// the UI chair: a guided live flight — eight steps in a scripted
// solo match, each completed by DOING it, skippable step by step,
// graduating into ordinary free play. No page lecture.)
//
// OWNERSHIP: the step ENGINE (the scripted instance, the
// predicates, the snapshot below) is the state lane's bench; the
// SURFACES (coach card, canvas marker, HUD spotlights, the doors)
// are the UI lane's. This file is the seam: the engine publishes a
// TutorialSnapshot; the surfaces render it. Step COPY lives here —
// the engine never carries text.
//
// RECONCILED 2026-10-23 (BackGround): both lanes authored a
// tutorial.ts in parallel and the state lane's whole-file push
// briefly overwrote this contract file. This merged file is the
// one seam again: UI's types + copy above, the engine's step DEFS
// below under their own name (TUTORIAL_STEP_DEFS) so the two
// TUTORIAL_* tables can never collide again.

export type TutorialStepId =
  | 'fly' | 'scoop' | 'home' | 'bank' | 'workshop' | 'line' | 'teeth' | 'match';

// The HUD elements the flight names once, in place, at the moment
// each first matters (Adam: 'walk the player through the HUD'). The
// renderer maps an id to its on-screen anchor for the device in
// hand; an id with no anchor on this device simply shows its
// callout line without a pulse.
export type TutorialSpotlight =
  | 'plate' | 'vac' | 'dock' | 'shopdoor' | 'nudge' | 'strip' | 'radar';

export interface TutorialMarker {
  x: number;
  y: number;
  label: string;
  tone: 'go' | 'fight';
}

export interface TutorialSnapshot {
  active: boolean;
  /** 0–7, the current step's index. */
  step: number;
  stepId: TutorialStepId;
  /** Graduation acknowledged: the instance is a normal solo match now. */
  done: boolean;
  marker: TutorialMarker | null;
  spotlight: TutorialSpotlight | null;
}

export interface TutorialStepCopy {
  title: string;
  /** The one instruction line, worded for a phone's on-screen controls. */
  phone: string;
  /** The same line, worded for the settled desktop key map. */
  desktop: string;
  /** The woven HUD callout ('THAT'S YOUR PLATE — …'), when this step names an element. */
  callout?: string;
}

// Copy law: plain words, the game's dialect only where the game has
// already taught it by this step; controls named for the device in
// hand; SPACE stays jettison (Adam's settled map), never scoop.
export const TUTORIAL_STEPS: Record<TutorialStepId, TutorialStepCopy> = {
  fly: {
    title: 'FLY',
    phone: 'Hold THRUST and steer with the stick — reach the marked scrap vein.',
    desktop: 'Thrust with W, steer with A / D — reach the marked scrap vein.',
    callout: 'THAT’S YOUR PLATE — your ship, its tier, the next climb’s price. The meters with it are your hull and fuel.',
  },
  scoop: {
    title: 'SCOOP',
    phone: 'Tap VAC, then drift through the vein — fill your hold with 5 scrap.',
    desktop: 'Q switches your vacuum — drift through the vein and fill your hold with 5 scrap.',
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
    phone: 'Buy any upgrade. Five tracks, plain names — each one makes the next run easier.',
    desktop: 'U is the workshop door. Buy any upgrade — five tracks, plain names, each makes the next run easier.',
    callout: 'THE WORKSHOP — every upgrade lives here. It only opens docked, and closes when you leave the glow.',
  },
  line: {
    title: 'YOUR LINE',
    // AMENDED at the reconciliation (BackGround, flagged to the UI
    // chair): the engine's predicate is the purchase itself (the
    // stipend bankrolls it), so 'buying is optional' could not
    // stand. UI's reword welcome; the truth may not soften.
    phone: 'Open the frame door and buy your first frame — the stipend covers it. Five lines climb to T5 from here.',
    desktop: 'Open the frame door and buy your first frame — the stipend covers it. Five lines climb to T5 from here.',
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
// ship upgrades like hold size, thrust, etc.'). Rendered by the
// coach card on the workshop step only.
export const TUTORIAL_TRACKS: { name: string; payoff: string }[] = [
  { name: 'THRUST', payoff: 'top speed' },
  { name: 'HANDLING', payoff: 'turning' },
  { name: 'VACUUM', payoff: 'scrap pull' },
  { name: 'FUEL', payoff: 'tank size' },
  { name: 'HOLD SIZE', payoff: 'how much you carry' },
];

// =====================================================================
// THE ENGINE (state lane). The step DEFS: order is the flight's
// order; each predicate reads real play off the GameState — nothing
// is theatre. The instance law (the loop enforces): a tutorial boot
// is a fresh solo match with the enemy captain PARKED (driver +
// economy skip) until TEETH; the solo save neither loads nor writes
// during a flight; graduation KEEPS the world — the match you built
// becomes your real solo game. The stipend is scaffolding with a
// name: one banked hold (5–10u) cannot reach a 150–200u T2, and the
// tutorial's job is momentum, not the economy's real grind.
// =====================================================================
import type { GameState, Vector2D } from './types';
import { inTeamWell } from './sim/seatShop';

export const TUTORIAL_FLAG_KEY = 'mr.tutorial.v1';
export const TUTORIAL_STIPEND = 300;
export const TEETH_INDEX = 6; // steps 0..5 park the captain

export interface TutorialBaseline {
  banked: number;
  tracksSum: number;
  hullSteps: number;
  tier: number;
  enemyHealth: number;
  startedAt: number;
}
export interface TutorialStepDef {
  id: TutorialStepId;
  spotlight?: TutorialSpotlight;
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
const homeMarker = (s: GameState): TutorialMarker => ({ x: s.star.pos.x, y: s.star.pos.y, label: '⭐ YOUR STAR', tone: 'go' });

export const TUTORIAL_STEP_DEFS: TutorialStepDef[] = [
  {
    id: 'fly', spotlight: 'plate',
    marker: s => { const p = nearestScrap(s); return p ? { x: p.x, y: p.y, label: '⛏ SCRAP VEIN', tone: 'go' } : null; },
    done: (b, s) => { const p = nearestScrap(s); return p !== null && Math.hypot(p.x - s.ship.pos.x, p.y - s.ship.pos.y) <= 320; },
  },
  {
    id: 'scoop', spotlight: 'vac',
    marker: s => { const p = nearestScrap(s); return p ? { x: p.x, y: p.y, label: '⛏ SCOOP THE SCRAP', tone: 'go' } : null; },
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
    id: 'workshop', spotlight: 'shopdoor',
    marker: homeMarker,
    done: (b, s) =>
      Object.values(s.ship.upgrades).reduce((a, v) => a + v, 0) > b.tracksSum ||
      s.ship.hullSteps > b.hullSteps || s.ship.typeTier > b.tier,
  },
  {
    id: 'line', spotlight: 'nudge',
    marker: homeMarker,
    done: (b, s) => s.ship.typeTier >= 2,
  },
  {
    id: 'teeth', spotlight: 'strip',
    marker: s => { const e = s.seats[1]?.ship; return e ? { x: e.pos.x, y: e.pos.y, label: '⚔ ENEMY', tone: 'fight' } : null; },
    done: (b, s, now) => {
      const e = s.seats[1]?.ship;
      return (e !== null && e !== undefined && e.health < b.enemyHealth) || now - b.startedAt >= 45000;
    },
  },
  {
    id: 'match', spotlight: 'radar',
    marker: s => ({ x: s.enemyStar.pos.x, y: s.enemyStar.pos.y, label: '⚔ THE ENEMY STAR', tone: 'fight' }),
    done: (b, s, now) => now - b.startedAt >= 20000,
  },
];
