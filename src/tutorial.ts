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
    phone: 'Open the frame door. Five ship lines climb to T5 — buying is optional today; knowing is not.',
    desktop: 'Open the frame door. Five ship lines climb to T5 — buying is optional today; knowing is not.',
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
