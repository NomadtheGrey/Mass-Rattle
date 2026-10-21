/**
 * STEALTH — the minelayer line is the game's submarine (Adam's
 * ruling, 2026-10-21, via the dev lane; both fairness valves ruled
 * the same day: "I agree with you. OK, let's get cooking!").
 *
 * THE SHAPE:
 * - A minelayer-line ship (T2+) is INVISIBLE ON RADAR outright, and
 *   on the field it fades in only as an enemy closes: invisible
 *   beyond `far`, solid inside `near`, a linear alpha ramp between.
 * - Its MINES are hidden from enemies beyond a reveal radius that
 *   SHRINKS by the layer's type tier — the deeper the line, the
 *   later you see the field. The owner and their team always see
 *   their own mines (callers apply that exemption — these helpers
 *   are pure geometry).
 * - PERISCOPE MOMENT (ruled): firing any weapon or laying mines
 *   while cloaked reveals the ship fully for PERISCOPE_REVEAL_S
 *   seconds. The loop stamps Ship.cloakReveal (SECONDS REMAINING,
 *   decremented per frame) at the fire/mine sites — a countdown,
 *   not a timestamp, because a host performance.now() stamp is
 *   meaningless on a guest's clock, while a seconds-remaining
 *   field rides snapshots natively and reads identically
 *   everywhere (UI lane's contract catch, 2026-10-21).
 * - Stealth gates SEEING, never physics: a cloaked ship still
 *   collides, still trips mines, still takes hits from fire aimed
 *   true. Nothing here touches damage or movement.
 *
 * PROJECTION-FIRST (the ruling's net shape): the shared state stays
 * TRUE for everyone; each viewer derives what they can see from
 * their own seat's position. The canvas/radar/nameplate/mine
 * drawing lives in the UI lane and consumes stealthAlphaFor +
 * mineVisibleToViewer. The SIM consumes isVisibleTo only where a
 * system must "look": today that is the star systems (below) and
 * tomorrow the offensive-bots item — bot drivers and seekers get
 * the same geometry then, RULED, not re-debated.
 *
 * STAR SYSTEMS (turret targeting, CME aim): do they respect the
 * cloak, measured from the STAR? — UNRULED. Dev recommended yes.
 * STAR_SYSTEMS_RESPECT_STEALTH carries the recommendation as its
 * default so the game plays the recommended way while the question
 * is open; Adam's word flips this one constant and both systems
 * follow. Do not "fix" either system's behavior around it.
 *
 * NUMBERS: DRAFT (Adam's pin pass pending). The anchors are the
 * design brief's ~500 invisible / ~150 solid, seated at T4 — the
 * top tier when the ruling landed. Tiers tighten: `far` grows and
 * `near` shrinks as the submarine deepens; mine reveal shrinks.
 */

import type { Ship } from '../types';
import type { TypeTier } from '../shipProgression';

export interface StealthBand {
  /** Invisible at or beyond this distance from the viewer. */
  far: number;
  /** Fully visible at or inside this distance. */
  near: number;
  /** An enemy sees this layer's mines inside this radius of THEMSELVES. */
  mineReveal: number;
}

/**
 * Per type tier of the minelayer line (T1 Skiff has no line yet).
 * THE ONE GEOMETRY TABLE (Adam's shared-geometry ruling): the
 * renderer (src/cloak.ts) imports these bands — its own file
 * holds presentation only (ghost styling, floors, plate
 * threshold), never a second set of distances. Mine radii are
 * the UI lane's renderer-tuned values, adopted 2026-10-21 when
 * the two draft tables converged here.
 */
export const STEALTH_BANDS: Record<TypeTier, StealthBand> = {
  1: { far: 0, near: 0, mineReveal: 260 },
  2: { far: 425, near: 175, mineReveal: 230 },
  3: { far: 475, near: 160, mineReveal: 200 },
  4: { far: 500, near: 150, mineReveal: 165 },
  5: { far: 550, near: 135, mineReveal: 130 },
};

/** Periscope moment: seconds firing/laying reveals a cloaked ship (RULED ~2 s). */
export const PERISCOPE_REVEAL_S = 2.0;

/**
 * UNRULED switch — see the header. Default = dev's recommendation
 * (star systems respect the cloak). Adam's ruling flips it.
 */
export const STAR_SYSTEMS_RESPECT_STEALTH = true;

/** A ship flies the submarine: minelayer line, T2 or deeper. */
export const isStealthShip = (ship: Pick<Ship, 'line' | 'typeTier'>): boolean =>
  ship.line === 'minelayer' && ship.typeTier >= 2;

/** The periscope moment is live for this ship (countdown running). */
export const isRevealedByAction = (
  ship: Pick<Ship, 'cloakReveal'>,
): boolean => (ship.cloakReveal || 0) > 0;

/**
 * How visible `target` is to a viewer standing at `viewerPos`:
 * 1 = solid, 0 = not there. Non-stealth ships are always 1; a
 * periscope-revealed submarine is 1 at any range; otherwise the
 * proximity ramp between the tier's near and far radii.
 */
export const stealthAlphaFor = (
  target: Pick<Ship, 'line' | 'typeTier' | 'pos' | 'cloakReveal'>,
  viewerPos: { x: number; y: number },
): number => {
  if (!isStealthShip(target)) return 1;
  if (isRevealedByAction(target)) return 1;
  const band = STEALTH_BANDS[target.typeTier];
  const d = Math.hypot(target.pos.x - viewerPos.x, target.pos.y - viewerPos.y);
  if (d >= band.far) return 0;
  if (d <= band.near) return 1;
  return (band.far - d) / (band.far - band.near);
};

/**
 * The sim's yes/no: can a system at `viewerPos` engage `target`?
 * Any visibility at all (alpha > 0) counts — a shape in the fade
 * band is a shape you may shoot at.
 */
export const isVisibleTo = (
  target: Pick<Ship, 'line' | 'typeTier' | 'pos' | 'cloakReveal'>,
  viewerPos: { x: number; y: number },
): boolean => stealthAlphaFor(target, viewerPos) > 0;

/**
 * Mine concealment: may a viewer at `viewerPos` see a mine whose
 * owner currently flies a ship of `ownerTier`? (Owner/team
 * exemption is the caller's — they always see their own.) There
 * is NO tier stamped on the mine: concealment reads the owner's
 * CURRENT type tier (callers resolve ownerId -> seat -> ship), so
 * a layer who climbs sees their whole field deepen with them.
 * An owner with no live submarine — shipless, or back in the
 * tier-1 Skiff after a repurchase — tends no field: their mines
 * are VISIBLE to everyone. The field surfaces when its layer dies.
 */
export const mineVisibleToViewer = (
  minePos: { x: number; y: number },
  ownerTier: TypeTier | null,
  viewerPos: { x: number; y: number },
): boolean => {
  if (ownerTier === null || ownerTier < 2) return true;
  const d = Math.hypot(minePos.x - viewerPos.x, minePos.y - viewerPos.y);
  return d <= STEALTH_BANDS[ownerTier].mineReveal;
};
