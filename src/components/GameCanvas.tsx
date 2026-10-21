import React, { useRef, useEffect } from 'react';
import { GameState } from '../types';
import { COLORS, PHYSICS } from '../constants';
import { BANK_WELL_MARGIN } from '../bank';
import { shieldMaxFor, PD_RANGE } from '../loadout';
import { turretRingRadius } from '../starDefense';
import { getUiOptions } from '../uiOptions';
import { stealthAlphaFor, mineVisibleToViewer, isStealthShip } from '../sim/stealth';
import { shipSprite, tintedShipSprite, SPRITE_SCALE } from '../shipSprites';
import { typeFor } from '../shipProgression';
import { stageStateForInfused } from '../sim/starStages';

// CME EJECTA (Adam, 2026-10-21): a CME is stellar mass jetting out and
// escaping the star's gravity — NOT a force field. The render below is
// pure presentation over the same wave state (front, cone, falloff);
// the sim is untouched. Streamer parameters are a deterministic hash
// of the wave's id, so the same matter persists frame to frame instead
// of re-rolling — blobs TRAVEL, they don't flicker. Ejecta tints by the
// firing star's stage (the HUD's stage palette, mirrored as rgb).
const CME_STAGE_TINTS: Record<string, [number, number, number]> = {
  red_dwarf: [240, 118, 77],
  red_giant: [255, 77, 58],
  yellow: [255, 217, 77],
  white: [238, 244, 255],
  neutron: [143, 208, 255],
  black_hole: [183, 154, 255],
};
const cmeHash = (seed: string, i: number): number => {
  let h = (2166136261 ^ Math.imul(i + 1, 16777619)) >>> 0;
  for (let k = 0; k < seed.length; k++) {
    h ^= seed.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};

// CME FIREBALL SPRITES (Adam, 2026-10-21: 'shouldn't they be more like
// solar flares/fireballs?' — the bowed-stroke streamers read as green
// squiggles). A fireball is a pre-rendered radial glow: white-hot core
// cooling through the firing star's stage tint to transparency, in
// three heats. Sprites are cached per (tint, heat) — a handful of
// 128px canvases serve every wave — and drawn additively so overlaps
// bloom like plasma instead of stacking like lines.
type CmeHeat = 'hot' | 'mid' | 'ember';
const cmeSpriteCache = new Map<string, HTMLCanvasElement>();
const cmeSprite = (tint: [number, number, number], heat: CmeHeat): HTMLCanvasElement => {
  const key = `${tint[0]},${tint[1]},${tint[2]}|${heat}`;
  const hit = cmeSpriteCache.get(key);
  if (hit) return hit;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  const [r, gg, b] = tint;
  const mixW = (f: number): string => `${Math.round(r + (255 - r) * f)}, ${Math.round(gg + (250 - gg) * f)}, ${Math.round(b + (238 - b) * f)}`;
  if (heat === 'hot') {
    grad.addColorStop(0, 'rgba(255, 252, 244, 1)');
    grad.addColorStop(0.3, `rgba(${mixW(0.65)}, 0.95)`);
    grad.addColorStop(0.62, `rgba(${r}, ${gg}, ${b}, 0.55)`);
    grad.addColorStop(1, `rgba(${r}, ${gg}, ${b}, 0)`);
  } else if (heat === 'mid') {
    grad.addColorStop(0, `rgba(${mixW(0.45)}, 0.95)`);
    grad.addColorStop(0.45, `rgba(${r}, ${gg}, ${b}, 0.6)`);
    grad.addColorStop(1, `rgba(${r}, ${gg}, ${b}, 0)`);
  } else {
    const dr = Math.round(r * 0.5), dg = Math.round(gg * 0.42), db = Math.round(b * 0.38);
    grad.addColorStop(0, `rgba(${dr}, ${dg}, ${db}, 0.8)`);
    grad.addColorStop(0.55, `rgba(${dr}, ${dg}, ${db}, 0.35)`);
    grad.addColorStop(1, `rgba(${dr}, ${dg}, ${db}, 0)`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  cmeSpriteCache.set(key, cv);
  return cv;
};
const drawCmeBlob = (c: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number, radius: number, alpha: number) => {
  c.globalAlpha = Math.max(0, Math.min(1, alpha));
  c.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  c.globalAlpha = 1;
};

// PER-TYPE SILHOUETTES (UI lane, Phase 3): every frame in the progression
// table gets its own hull outline. Points are unit multiples of ship.size
// (x forward, nose first), so hull steps scale every shape for free and
// growth stays honest — the hitbox IS the drawing. The SKIFF outline is
// the original stock hull, unchanged. Attachments that walk the outline
// (Armor Plating's rim, Scrap Aegis plates, Thorn Hull spikes) read the
// SAME outline, so they follow whatever frame the ship flies.
type Pt = [number, number];
const SKIFF_OUTLINE: Pt[] = [[1.25, 0], [-0.55, -0.92], [-0.95, -0.28], [-0.35, 0], [-0.95, 0.28], [-0.55, 0.92]];
// SKIFF LEGIBILITY (Adam live-test, 2026-10-21): the stock kite's
// tail notch was 0.4 deep on paper and invisible at gameplay size —
// the frame read as the plain prototype triangle. The reshape above
// is the SAME kite with its character made legible: a longer nose,
// swept wings, and a true swallow-tail notch. Every line's T1 wears
// it (they all start as Skiffs); the other 15 frames are untouched.
const HULL_OUTLINES: Record<string, Pt[]> = {
  'fighter:2': [[1.25, 0], [-0.9, -0.5], [-0.55, 0], [-0.9, 0.5]],
  'fighter:3': [[1.3, 0], [0.1, -0.28], [-0.7, -1.0], [-0.45, -0.3], [-0.6, 0], [-0.45, 0.3], [-0.7, 1.0], [0.1, 0.28]],
  'fighter:4': [[1.35, -0.22], [0.55, -0.3], [-0.75, -1.05], [-0.5, -0.28], [-0.65, 0], [-0.5, 0.28], [-0.75, 1.05], [0.55, 0.3], [1.35, 0.22], [0.8, 0]],
  'minelayer:2': [[1.05, 0], [0.2, -0.75], [-0.85, -0.8], [-0.6, 0], [-0.85, 0.8], [0.2, 0.75]],
  'minelayer:3': [[1.05, 0], [0.25, -0.7], [-0.55, -0.95], [-1.0, -0.6], [-0.65, 0], [-1.0, 0.6], [-0.55, 0.95], [0.25, 0.7]],
  'minelayer:4': [[1.0, 0], [0.3, -0.6], [-0.4, -0.8], [-1.15, -1.05], [-0.95, -0.35], [-0.7, 0], [-0.95, 0.35], [-1.15, 1.05], [-0.4, 0.8], [0.3, 0.6]],
  'hauler:2': [[1.0, -0.5], [0.95, 0], [1.0, 0.5], [-0.95, 0.72], [-0.7, 0], [-0.95, -0.72]],
  'hauler:3': [[1.05, -0.5], [1.0, 0], [1.05, 0.5], [0.2, 0.95], [-0.9, 0.8], [-0.7, 0], [-0.9, -0.8], [0.2, -0.95]],
  'hauler:4': [[1.1, -0.62], [1.05, 0], [1.1, 0.62], [0.35, 1.05], [-0.95, 0.9], [-0.72, 0], [-0.95, -0.9], [0.35, -1.05]],
  'drone:2': [[1.1, 0], [0.35, -0.5], [-0.2, -0.95], [-0.75, -0.45], [-0.55, 0], [-0.75, 0.45], [-0.2, 0.95], [0.35, 0.5]],
  'drone:3': [[1.15, 0], [0.4, -0.45], [0.05, -1.0], [-0.5, -0.85], [-1.0, -0.4], [-0.6, 0], [-1.0, 0.4], [-0.5, 0.85], [0.05, 1.0], [0.4, 0.45]],
  'drone:4': [[1.2, -0.35], [1.2, 0.35], [0.5, 0.9], [-0.6, 1.0], [-1.05, 0.55], [-0.75, 0], [-1.05, -0.55], [-0.6, -1.0], [0.5, -0.9]],
  'cruiser:2': [[1.45, 0], [0.3, -0.42], [-1.1, -0.55], [-0.7, 0], [-1.1, 0.55], [0.3, 0.42]],
  'cruiser:3': [[1.5, 0], [0.5, -0.4], [0.15, -0.95], [-0.75, -0.8], [-1.15, -0.5], [-0.75, 0], [-1.15, 0.5], [-0.75, 0.8], [0.15, 0.95], [0.5, 0.4]],
  'cruiser:4': [[1.6, 0], [0.7, -0.35], [0.45, -0.8], [0.0, -1.1], [-0.8, -0.95], [-1.25, -0.55], [-0.85, 0], [-1.25, 0.55], [-0.8, 0.95], [0.0, 1.1], [0.45, 0.8], [0.7, 0.35]],
};
const hullOutlineFor = (line: string | null, tier: number, size: number): Pt[] => {
  const unit = (line && HULL_OUTLINES[`${line}:${tier}`]) || SKIFF_OUTLINE;
  return unit.map(([x, y]) => [x * size, y * size] as Pt);
};
const traceOutline = (c: CanvasRenderingContext2D, pts: Pt[]) => {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath();
};

interface GameCanvasProps {
  state: GameState;
  /** NAMEPLATES (Adam, 2026-10-21): ownerId -> {callsign, team color}
   *  for every seat in a net room, built by App from the room state.
   *  Absent in solo — no plates, and remote ships don't exist there. */
  seatLabels?: Record<string, { callsign: string; color: string }>;
  width: number;
  height: number;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({ state, width, height, seatLabels }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Wrap-edge flash: a >2000-unit jump between frames can only be the
  // world wrap firing — remember when it happened so the rim can flash.
  const prevShipPosRef = useRef<{ x: number; y: number } | null>(null);
  const wrapFlashAtRef = useRef(0);
  // HIT FLASH (Adam, 2026-10-21, live test of the painted fleet):
  // the green edge is hit feedback, not furniture — a painted hull
  // wears NO outline at rest, and the edge appears only for a beat
  // when the ship takes a hit. The canvas watches each ship's health
  // itself: a drop stamps a flash. Presentation-only — no sim field,
  // no wire change; a health drop reads identically on host, guest,
  // local hull and remote hull.
  const prevHealthRef = useRef<Map<string, number>>(new Map());
  const hitFlashAtRef = useRef<Map<string, number>>(new Map());
  const noteHealth = (ownerId: string, health: number) => {
    const prev = prevHealthRef.current.get(ownerId);
    if (prev !== undefined && health < prev) {
      hitFlashAtRef.current.set(ownerId, performance.now());
    }
    prevHealthRef.current.set(ownerId, health);
  };
  // 1 at the hit, fading to 0 over the flash window; 0 at rest.
  const hitFlashFor = (ownerId: string): number => {
    const at = hitFlashAtRef.current.get(ownerId);
    if (at === undefined) return 0;
    const age = performance.now() - at;
    return age < 260 ? 1 - age / 260 : 0;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { ship, star, enemyStar, scrap, shakeAmount, glitchActive } = state;

    // Clear background
    ctx.fillStyle = COLORS.CRT_BG;
    ctx.fillRect(0, 0, width, height);

    // DRAW BACKGROUND STATIC SCRATCHES (Procedural / Static-ish)
    ctx.save();
    ctx.translate((Math.random() - 0.5) * shakeAmount, (Math.random() - 0.5) * shakeAmount);
    
    // CAMERA LOGIC: Offset everything by ship position to keep ship centered
    const camX = width / 2 - ship.pos.x;
    const camY = height / 2 - ship.pos.y;
    ctx.translate(camX, camY);

    // WORLD WRAP EDGE (Adam's ruling; the wrap itself lives in
    // useGameLoop): the rim of the world drawn as a place — a faint
    // dashed circle around the stars' midpoint. It brightens and
    // pulses as the ship closes on it, and flashes on the wrap frame.
    {
      const prevShipPos = prevShipPosRef.current;
      if (prevShipPos && Math.hypot(ship.pos.x - prevShipPos.x, ship.pos.y - prevShipPos.y) > 2000) {
        wrapFlashAtRef.current = performance.now();
      }
      prevShipPosRef.current = { x: ship.pos.x, y: ship.pos.y };

      const wrapCx = (star.pos.x + enemyStar.pos.x) / 2;
      const wrapCy = (star.pos.y + enemyStar.pos.y) / 2;
      const wrapR = PHYSICS.WORLD.WRAP_RADIUS;
      const centerDist = Math.hypot(ship.pos.x - wrapCx, ship.pos.y - wrapCy);
      const nearEdge = Math.min(1, Math.max(0, (centerDist - (wrapR - 450)) / 450));
      const flashAge = performance.now() - wrapFlashAtRef.current;
      const flashing = flashAge < 350;
      const alpha = flashing
        ? 0.85
        : 0.10 + nearEdge * 0.35 + (nearEdge > 0 ? Math.sin(performance.now() / 130) * 0.06 : 0);
      ctx.save();
      ctx.strokeStyle = `rgba(51, 255, 51, ${Math.min(0.9, Math.max(0.08, alpha))})`;
      ctx.lineWidth = flashing ? 3 : 1.5;
      ctx.setLineDash([16, 20]);
      ctx.beginPath();
      ctx.arc(wrapCx, wrapCy, wrapR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // DRAW STARS
    [star, enemyStar].forEach(s => {
      const isHome = s.type === 'home';
      ctx.save();
      ctx.translate(s.pos.x, s.pos.y);

      // Delivery Zone indicator
      ctx.strokeStyle = isHome ? 'rgba(234, 88, 12, 0.2)' : 'rgba(244, 63, 94, 0.2)';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, isHome ? 80 : 160, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

        // Star Noise Flares
        const isRecentlyHit = s.lastHitTime && (performance.now() - s.lastHitTime < 250);
        ctx.strokeStyle = isRecentlyHit ? '#fff' : (isHome ? COLORS.STAR_NOISE : '#f43f5e');
        ctx.lineWidth = isRecentlyHit ? 4 : 2;
        const flareCount = isHome ? 60 : 120;
        for(let i = 0; i < flareCount; i++) {
          const angle = (i / flareCount) * Math.PI * 2 + Math.random() * 0.1;
          let length = s.size * (1 + (isHome ? Math.random() * 0.8 : Math.random() * 0.4));
          
          if (isRecentlyHit && !isHome) {
            length *= 1.5 + Math.random();
          }

          // Add "instability" jitter to enemy flares if glitching
          const jitter = (!isHome && glitchActive) ? (Math.random() - 0.5) * 20 : 0;
          
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(angle) * (length + jitter), Math.sin(angle) * (length + jitter));
          ctx.stroke();
        }

        // Enemy Destabilization Arcs
        if (!isHome && (glitchActive || isRecentlyHit)) {
          ctx.strokeStyle = isRecentlyHit ? '#fff' : '#f43f5e';
          ctx.lineWidth = isRecentlyHit ? 2 : 1;
          for(let i = 0; i < (isRecentlyHit ? 15 : 5); i++) {
            ctx.beginPath();
            ctx.arc(0, 0, s.size * (0.5 + Math.random() * 2), Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
            ctx.stroke();
          }
        }

      // Turret Hubs — read straight from state (Phase 1c): star.turrets
      // is the ladder's list ({shell, angle, tier} per turret, a pure
      // function of milestone count — see starDefense.ts). Angles are
      // ABSOLUTE: the sim fires from pos + angle x turretRingRadius, so
      // the hubs sit exactly where the bolts come from. (The old draw
      // rotated the ring by starOrbit and showed one hub — the hubs
      // appeared to orbit while the sim fired from fixed angles.)
      // Hub box grows a little per tier, matching its fire stats.
      (s.turrets || []).forEach(t => {
        const ring = turretRingRadius(s.size, t.shell);
        const hub = 9 + Math.min(t.tier, 4);
        ctx.save();
        ctx.rotate(t.angle);
        ctx.translate(ring, 0);
        ctx.fillStyle = isHome ? '#1a1a1c' : '#300';
        ctx.strokeStyle = isHome ? COLORS.CRT_GLOW : '#f43f5e';
        ctx.lineWidth = 1;
        ctx.fillRect(-hub / 2, -hub / 2, hub, hub);
        ctx.strokeRect(-hub / 2, -hub / 2, hub, hub);
        // Barrel
        ctx.fillRect(hub / 2, -2, 8, 4);
        ctx.strokeRect(hub / 2, -2, 8, 4);
        ctx.restore();
      });

      // BANK WELL (home star only): the gravity-well ring that IS the bank,
      // plus one orbiting mote per banked scrap (capped for readability) so
      // savings are visible in the world, circling their star.
      if (isHome) {
        ctx.save();
        ctx.strokeStyle = 'rgba(51, 255, 51, 0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 10]);
        ctx.beginPath();
        ctx.arc(0, 0, s.size + BANK_WELL_MARGIN, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        const motes = Math.min(state.bankedScrap, 24);
        ctx.fillStyle = '#f472b6';
        for (let i = 0; i < motes; i++) {
          const mAngle = state.starOrbit * 0.6 + (i / Math.max(1, motes)) * Math.PI * 2;
          const mRadius = s.size + 90 + (i % 3) * 60;
          ctx.beginPath();
          ctx.arc(Math.cos(mAngle) * mRadius, Math.sin(mAngle) * mRadius, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // CME CHARGE TELEGRAPH: the ring CONTRACTS as the charge completes, so
      // it reads as a countdown — and the pulse quickens with it. An enemy
      // star ramps white-hot in the final quarter: "about to fire" at a
      // glance, mid-fight, on a phone screen. The aim dashes march toward
      // the target with an arrowhead at the far end.
      if (s.cmeChargeEndsAt && s.cmeChargeEndsAt > performance.now()) {
        ctx.save();
        const now = performance.now();
        const remain = s.cmeChargeEndsAt - now;
        const progress = Math.max(0, Math.min(1, 1 - remain / PHYSICS.CME.CHARGE_MS));
        const aboutToFire = progress > 0.75;
        const pulse = 0.5 + 0.5 * Math.sin(now / (60 - 36 * progress));
        // A CME wears its star's STAGE tint (Adam, 2026-10-21 — the
        // phosphor green read as UI chrome, not starfire): ring,
        // dashes, agitation and ejecta all draw from this one tint.
        // The about-to-fire white ramp stays, for every star — it is
        // the glance cue, not a faction color.
        const cmeTint: [number, number, number] = CME_STAGE_TINTS[stageStateForInfused(s.totalScrapInfused).stage] || [255, 170, 60];
        const ringCol = aboutToFire ? '255, 255, 255' : `${cmeTint[0]}, ${cmeTint[1]}, ${cmeTint[2]}`;
        ctx.strokeStyle = `rgba(${ringCol}, ${0.35 + 0.4 * pulse})`;
        ctx.lineWidth = aboutToFire ? 3.5 : 2;
        ctx.beginPath();
        ctx.arc(0, 0, s.size + 22 - progress * 16, 0, Math.PI * 2);
        ctx.stroke();
        if (s.cmeAimAngle !== undefined) {
          const a = s.cmeAimAngle;
          const x1 = Math.cos(a) * s.size, y1 = Math.sin(a) * s.size;
          const x2 = Math.cos(a) * (s.size + 430), y2 = Math.sin(a) * (s.size + 430);
          ctx.strokeStyle = `rgba(${cmeTint[0]}, ${cmeTint[1]}, ${cmeTint[2]}, 0.45)`;
          ctx.lineWidth = 2;
          ctx.setLineDash([10, 7]);
          ctx.lineDashOffset = -now / 22;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = `rgba(${cmeTint[0]}, ${cmeTint[1]}, ${cmeTint[2]}, 0.7)`;
          ctx.save();
          ctx.translate(x2, y2);
          ctx.rotate(a);
          ctx.beginPath();
          ctx.moveTo(10, 0);
          ctx.lineTo(-4, -6);
          ctx.lineTo(-4, 6);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        // ERUPTION SITE AGITATION (Adam, 2026-10-21): the surface BOILS
        // where it will burst — plasma blobs jitter at the aim point
        // (around the whole limb for a radial burst), swelling and
        // whitening as the charge completes. The marching dashes keep
        // the aim exact; this makes the star itself tell the story.
        {
          const agitSeed = s.ownerId || s.id;
          const baseCol: [number, number, number] = cmeTint;
          const flashes = 7;
          for (let k = 0; k < flashes; k++) {
            const tick = Math.floor(now / 110) + k * 17;
            const jr = cmeHash(agitSeed, tick);
            const jr2 = cmeHash(agitSeed, tick + 5000);
            const jr3 = cmeHash(agitSeed, tick + 9000);
            const ang = s.cmeAimAngle !== undefined
              ? s.cmeAimAngle + (jr - 0.5) * 0.55
              : (k / flashes) * Math.PI * 2 + (jr - 0.5) * 0.5;
            const rr = s.size * (0.88 + 0.16 * jr2);
            const blob = (1 + 3.4 * progress) * (0.55 + 0.8 * jr3);
            const hot = 0.25 + 0.75 * progress;
            const cr = Math.round(baseCol[0] + (255 - baseCol[0]) * hot);
            const cg = Math.round(baseCol[1] + (246 - baseCol[1]) * hot);
            const cb = Math.round(baseCol[2] + (230 - baseCol[2]) * hot);
            ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${0.3 + 0.5 * pulse * (0.4 + 0.6 * jr3)})`;
            ctx.beginPath();
            ctx.arc(Math.cos(ang) * rr, Math.sin(ang) * rr, blob, 0, Math.PI * 2);
            ctx.fill();
          }
          if (s.cmeAimAngle !== undefined) {
            const hx = Math.cos(s.cmeAimAngle) * s.size * 0.96;
            const hy = Math.sin(s.cmeAimAngle) * s.size * 0.96;
            const hRad = s.size * (0.3 + 0.35 * progress);
            const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, hRad);
            hg.addColorStop(0, `rgba(255, 244, 224, ${0.3 + 0.5 * progress})`);
            hg.addColorStop(1, 'rgba(255, 244, 224, 0)');
            ctx.fillStyle = hg;
            ctx.beginPath();
            ctx.arc(hx, hy, hRad, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      // Star Core
      const gradient = ctx.createRadialGradient(0, 0, s.size * 0.2, 0, 0, s.size);
      if (isHome) {
        gradient.addColorStop(0, COLORS.STAR_CORE);
        gradient.addColorStop(1, COLORS.STAR_NOISE);
      } else {
        gradient.addColorStop(0, '#fecdd3');
        gradient.addColorStop(1, '#881337');
      }
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, s.size, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.fillStyle = isHome ? '#33ff33' : '#f43f5e';
      ctx.font = '10px monospace';
      ctx.fillText(isHome ? 'SYS: HOME_STAR_CORE' : 'SYS: ENEMY_STAR_CORE', -30, -s.size - 20);
      
      ctx.restore();
    });

    // DRAW SCRAP
    scrap.forEach(d => {
      ctx.fillStyle = d.color;
      ctx.fillRect(d.pos.x - 2, d.pos.y - 2, 4, 4);
    });

    // DRAW MINES: pink diamonds with a blinking core (blink rides the
    // star-orbit clock so the render stays a pure function of state).
    // MINE CONCEALMENT (Adam, 2026-10-21, the submarine ruling): a
    // mine laid by a minelayer-line hull is dark beyond its reveal
    // radius — shrinking per tier — and only shimmers once a hunter
    // is inside it. Your own mines always read; allies' read dim;
    // anyone else's non-submarine mines are ordinary ordnance and
    // draw as they always have. Tier comes from the mine once the
    // sim stamps it (m.tier), else from the layer's line tier.
    (state.mines || []).forEach(m => {
      let alpha = 1;
      if (m.ownerId !== ship.ownerId) {
        const ownerSeat = (state.seats || []).find(se => se.ownerId === m.ownerId);
        const ownerShip = ownerSeat?.ship;
        const mySeat = (state.seats || []).find(se => se.ownerId === ship.ownerId);
        const allied = !!ownerSeat && !!mySeat && ownerSeat.teamId === mySeat.teamId;
        if (allied) {
          alpha = 0.65; // your team's field is charted — dim, never hidden
        } else if (ownerShip && isStealthShip(ownerShip)) {
          // The sim's word (src/sim/stealth.ts): the layer's CURRENT
          // tier sets the radius — a climbing submarine's whole field
          // deepens with her. Outside it, the mine is simply not drawn.
          if (!mineVisibleToViewer(m.pos, ownerShip.typeTier, ship.pos)) return;
          alpha = 0.9; // inside the radius it reads — a breath under full
        }
        // A dead layer's ship is gone from state; her mines then draw
        // plain (concealment can't be established) — visible, not dark.
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(m.pos.x, m.pos.y);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-5, -5, 10, 10);
      ctx.restore();
      if (Math.sin(state.starOrbit * 6) > 0) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#f472b6';
        ctx.beginPath();
        ctx.arc(m.pos.x, m.pos.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });

    // DRAW DECOY BEACON: a blinking mast with an expanding scream-ring.
    if (state.decoy) {
      const d = state.decoy;
      ctx.save();
      ctx.translate(d.pos.x, d.pos.y);
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 8);
      ctx.lineTo(0, -8);
      ctx.moveTo(-6, 8);
      ctx.lineTo(6, 8);
      ctx.stroke();
      const pulse = (state.starOrbit * 30) % (Math.PI * 2);
      // Twin scream-rings, phase-offset — the beacon "shouts" in stereo.
      for (const phase of [pulse, (pulse + Math.PI) % (Math.PI * 2)]) {
        ctx.strokeStyle = 'rgba(244, 114, 182, 0.35)';
        ctx.beginPath();
        ctx.arc(0, 0, 12 + (phase / (Math.PI * 2)) * 26, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#f472b6';
      ctx.font = '8px monospace';
      ctx.fillText('DECOY', -12, -14);
      ctx.restore();
    }

    // DRAW DRONES
    (state.drones || []).forEach(d => {
      ctx.save();
      ctx.translate(d.pos.x, d.pos.y);
      ctx.rotate(d.angle);
      
      const isHome = d.owner === 'player';
      const color = isHome ? COLORS.CRT_GLOW : '#f43f5e';
      
      // Drone body
      ctx.fillStyle = '#1a1a1c';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      
      // Triangular body
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(-6, 6);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-6, -6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Cargo light if carrying
      if (d.carrying > 0) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(-2, 0, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Exhaust flame if moving
      if (d.state !== 'searching') {
        const flicker = Math.random() * 4;
        ctx.fillStyle = isHome ? 'rgba(51, 255, 51, 0.6)' : 'rgba(244, 63, 94, 0.6)';
        ctx.beginPath();
        ctx.moveTo(-6, -2);
        ctx.lineTo(-10 - flicker, 0);
        ctx.lineTo(-6, 2);
        ctx.fill();
      }
      
      ctx.restore();
    });

    // DRAW PROJECTILES — every weapon draws as itself (UI lane pass,
    // Adam: "fix whatever is generic"). p.kind is the firing weapon's id
    // (Slice 4); turret bolts leave it undefined and keep the stock look.
    (state.projectiles || []).forEach(p => {
      const isPlayer = p.owner === 'player';
      const glow = isPlayer ? '#33ff33' : '#f43f5e';

      if (isPlayer && p.kind === 'rail_lance') {
        // RAIL LANCE: a long bright lance streak with a wake — the siege
        // gun should look like it could punch through a star.
        ctx.save();
        ctx.shadowBlur = 14;
        ctx.shadowColor = glow;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p.pos.x - p.vel.x * 7, p.pos.y - p.vel.y * 7);
        ctx.lineTo(p.pos.x + p.vel.x * 1.5, p.pos.y + p.vel.y * 1.5);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(51, 255, 51, 0.35)';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(p.pos.x - p.vel.x * 5, p.pos.y - p.vel.y * 5);
        ctx.lineTo(p.pos.x, p.pos.y);
        ctx.stroke();
        ctx.restore();
        return;
      }

      if (isPlayer && p.kind === 'ion_blaster') {
        // ION BLASTER: a crackling cyan-white orb that spits sparks —
        // barely a bullet, mostly electricity.
        ctx.save();
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#67e8f9';
        ctx.fillStyle = '#ecfeff';
        ctx.beginPath();
        ctx.arc(p.pos.x, p.pos.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(103, 232, 249, 0.9)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2;
          const r0 = 4, r1 = 7 + Math.random() * 5;
          ctx.beginPath();
          ctx.moveTo(p.pos.x + Math.cos(a) * r0, p.pos.y + Math.sin(a) * r0);
          ctx.lineTo(p.pos.x + Math.cos(a + 0.6) * r1, p.pos.y + Math.sin(a + 0.6) * r1);
          ctx.stroke();
        }
        ctx.restore();
        return;
      }

      if (isPlayer && p.kind === 'seeker_torpedoes') {
        // SEEKER TORPEDO: a little dart with a flickering exhaust — it
        // reads as a missile, and its curving path does the rest.
        ctx.save();
        ctx.translate(p.pos.x, p.pos.y);
        ctx.rotate(Math.atan2(p.vel.y, p.vel.x));
        ctx.shadowBlur = 8;
        ctx.shadowColor = glow;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(6, 0);
        ctx.lineTo(-4, 3);
        ctx.lineTo(-2, 0);
        ctx.lineTo(-4, -3);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255, 102, 0, 0.85)';
        ctx.beginPath();
        ctx.moveTo(-4, 1.5);
        ctx.lineTo(-8 - Math.random() * 5, 0);
        ctx.lineTo(-4, -1.5);
        ctx.fill();
        ctx.restore();
        return;
      }

      if (isPlayer && p.kind === 'flak_cannon') {
        // FLAK: hot amber pellets, short-lived and stubby-trailed — a
        // shotgun blast, not a bullet stream.
        ctx.save();
        ctx.fillStyle = '#fbbf24';
        ctx.shadowBlur = 6;
        ctx.shadowColor = '#f59e0b';
        ctx.beginPath();
        ctx.arc(p.pos.x, p.pos.y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.pos.x, p.pos.y);
        ctx.lineTo(p.pos.x - p.vel.x * 1.5, p.pos.y - p.vel.y * 1.5);
        ctx.stroke();
        ctx.restore();
        return;
      }

      if (isPlayer && p.kind === 'mirror_sail') {
        // REFLECTED BOLT (Mirror Sail, Phase 1b): the loop flips the
        // bolt's owner and stamps kind='mirror_sail' — it should read as
        // a shard of mirror coming back, not a stock bolt that changed
        // color. A bright diamond along its velocity with a glint cross.
        ctx.save();
        ctx.translate(p.pos.x, p.pos.y);
        ctx.rotate(Math.atan2(p.vel.y, p.vel.x));
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#a7f3d0';
        ctx.fillStyle = '#ecfdf5';
        ctx.beginPath();
        ctx.moveTo(6, 0);
        ctx.lineTo(0, 2.6);
        ctx.lineTo(-6, 0);
        ctx.lineTo(0, -2.6);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(167, 243, 208, 0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -5);
        ctx.lineTo(0, 5);
        ctx.moveTo(-3, 0);
        ctx.lineTo(-11, 0);
        ctx.stroke();
        ctx.restore();
        return;
      }

      // Bolt Cannon + turret bolts: the stock square-and-trail.
      ctx.fillStyle = isPlayer ? '#fff' : '#f43f5e';
      ctx.shadowBlur = 10;
      ctx.shadowColor = glow;

      const headSize = p.size ?? (isPlayer ? 3 : 4);
      ctx.fillRect(p.pos.x - headSize/2, p.pos.y - headSize/2, headSize, headSize);

      // Trail
      ctx.lineWidth = 1;
      ctx.strokeStyle = isPlayer ? 'rgba(51, 255, 51, 0.4)' : 'rgba(244, 63, 94, 0.4)';
      ctx.beginPath();
      ctx.moveTo(p.pos.x, p.pos.y);
      ctx.lineTo(p.pos.x - p.vel.x * 3, p.pos.y - p.vel.y * 3);
      ctx.stroke();

      ctx.shadowBlur = 0;
    });

    // PD ZAP ARC: a jagged cyan line to the zapped target, gone in ~130 ms.
    // (performance.now shares the game loop's clock, so this stays honest.)
    if (ship.pdZapAt && ship.pdZapTarget && performance.now() - ship.pdZapAt < 130) {
      ctx.save();
      ctx.strokeStyle = 'rgba(103, 232, 249, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ship.pos.x, ship.pos.y);
      const segs = 5;
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        const jx = i === segs ? 0 : (Math.random() - 0.5) * 14;
        const jy = i === segs ? 0 : (Math.random() - 0.5) * 14;
        ctx.lineTo(
          ship.pos.x + (ship.pdZapTarget.x - ship.pos.x) * t + jx,
          ship.pos.y + (ship.pdZapTarget.y - ship.pos.y) * t + jy,
        );
      }
      ctx.stroke();
      ctx.restore();
    }

    // CME WAVES — ERUPTIVE EJECTA (Adam, 2026-10-21): stellar matter
    // bursting off the surface and escaping — plumes of plasma blobs and
    // streamers along the cone (or a full corona for a radial burst),
    // NOT an expanding force-field ring. Each streamer is matter ejected
    // at fire time: a few leaders ride the exact front, the rest trail
    // behind, stretching and cooling (white-hot → the star's stage tint
    // → dark ember) as they go. The dissipation stays READABLE the same
    // way the sim computes it: strength = 1 - distance / maxRange, and
    // the matter itself thins — fewer, fainter streamers survive as the
    // falloff falls, and nothing reaches past the front. Where the
    // matter ends, safety starts.
    (state.cmes || []).forEach(w => {
      const frac = Math.max(0, 1 - w.radius / w.maxRange);
      if (frac <= 0 || w.radius <= 0) return;
      const star = (state.stars || []).find(st => st.ownerId === w.ownerId);
      const stage = star ? stageStateForInfused(star.totalScrapInfused).stage : null;
      const tint: [number, number, number] = (stage && CME_STAGE_TINTS[stage])
        || [255, 170, 60];
      const radial = w.dirAngle === null;
      const count = radial ? 46 : 30;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (let i = 0; i < count; i++) {
        const rA = cmeHash(w.id, i * 7);
        const rS = cmeHash(w.id, i * 7 + 1);
        const rW = cmeHash(w.id, i * 7 + 2);
        const rL = cmeHash(w.id, i * 7 + 3);
        const rKeep = cmeHash(w.id, i * 7 + 4);
        const rBow = cmeHash(w.id, i * 7 + 5);
        // Thinning: as the wave's strength falls, matter disperses —
        // streamers wink out deterministically instead of fading as
        // one sheet.
        if (rKeep > 0.2 + 0.8 * frac) continue;
        const ang = radial
          ? (i / count) * Math.PI * 2 + (rA - 0.5) * 0.35
          : (w.dirAngle as number) + (rA * 2 - 1) * PHYSICS.CME.CONE_RAD;
        // Speed factor: most matter trails; ~1 in 10 blobs leads at
        // the true front, so the front reads off the brightest heads.
        const head = Math.max(6, w.radius * (0.45 + 0.55 * rS * rS));
        const q = head / w.maxRange;               // cooling coordinate
        const fHead = Math.max(0, 1 - q);          // strength right here
        const len = Math.min(200, Math.max(12, head * (0.16 + 0.3 * rL)));
        const tail = Math.max(2, head - len);
        const width = (1.2 + 3.6 * rW) * (0.45 + 0.55 * fHead);
        // Cooling is carried by the sprite heat each blob picks
        // below, from its own distance along the wave.
        const alpha = (0.1 + 0.5 * fHead) * (0.35 + 0.65 * frac);
        const hx = w.pos.x + Math.cos(ang) * head;
        const hy = w.pos.y + Math.sin(ang) * head;
        const tx = w.pos.x + Math.cos(ang) * tail;
        const ty = w.pos.y + Math.sin(ang) * tail;
        // Plasma arcs bend: the midpoint bows off the radial line.
        const bow = (rBow - 0.5) * len * 0.35;
        const mx = (hx + tx) / 2 - Math.sin(ang) * bow;
        const my = (hy + ty) / 2 + Math.cos(ang) * bow;
        // FIREBALLS, not squiggles (Adam, 2026-10-21): the streamer
        // is a chain of glowing plasma blobs along its bowed path,
        // swelling toward the head, each picking its heat from its
        // own cooling coordinate — white-hot near the star, the stage
        // tint mid-flight, dark ember as it dies. Under 'lighter'
        // the overlaps bloom like fire instead of reading as lines.
        const BLOBS = 5;
        for (let bIdx = 0; bIdx < BLOBS; bIdx++) {
          const t = bIdx / (BLOBS - 1);
          const bx = (1 - t) * (1 - t) * tx + 2 * (1 - t) * t * mx + t * t * hx;
          const by = (1 - t) * (1 - t) * ty + 2 * (1 - t) * t * my + t * t * hy;
          const bq = (tail + (head - tail) * t) / w.maxRange;
          const heat: CmeHeat = bq < 0.3 ? 'hot' : bq < 0.68 ? 'mid' : 'ember';
          const bRad = Math.max(1.4, width * (1 + 2.3 * t));
          drawCmeBlob(ctx, cmeSprite(tint, heat), bx, by, bRad, alpha * (0.5 + 0.55 * t));
        }
      }
      // ERUPTION PLUME (early life): while the front is still near the
      // star, thick tendrils reach off the surface toward it — the
      // burst itself, before the matter separates into streamers. A
      // directed burst fans from the eruption site; a radial burst
      // crowns the whole limb.
      if (star && w.radius < w.maxRange * 0.25) {
        const baseFrac = 1 - w.radius / (w.maxRange * 0.25);
        const tendrils = radial ? 14 : 9;
        for (let k = 0; k < tendrils; k++) {
          const rA = cmeHash(w.id + ':plume', k * 3);
          const rL = cmeHash(w.id + ':plume', k * 3 + 1);
          const rW = cmeHash(w.id + ':plume', k * 3 + 2);
          const ang = radial
            ? (k / tendrils) * Math.PI * 2 + (rA - 0.5) * 0.3
            : (w.dirAngle as number) + (rA * 2 - 1) * 0.55;
          const inner = star.size * 0.92;
          const outer = Math.max(inner + 8, Math.min(w.radius * (0.75 + 0.3 * rL), star.size + (40 + 110 * rL) * baseFrac + w.radius * 0.3));
          ctx.strokeStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${0.22 * baseFrac * (0.5 + 0.5 * rW)})`;
          ctx.lineWidth = 2 + 2.5 * rW;
          ctx.beginPath();
          ctx.moveTo(w.pos.x + Math.cos(ang) * inner, w.pos.y + Math.sin(ang) * inner);
          ctx.lineTo(w.pos.x + Math.cos(ang) * outer, w.pos.y + Math.sin(ang) * outer);
          ctx.stroke();
          // Flare lumps riding the tendril — a solar flare is arches
          // of fire with bright knots, not a laser line.
          for (const tt of [0.4, 0.7, 1]) {
            const fx = w.pos.x + Math.cos(ang) * (inner + (outer - inner) * tt);
            const fy = w.pos.y + Math.sin(ang) * (inner + (outer - inner) * tt);
            drawCmeBlob(ctx, cmeSprite(tint, tt < 0.55 ? 'hot' : 'mid'), fx, fy, (2.6 + 4.4 * rW) * (0.6 + 0.5 * tt), 0.55 * baseFrac * (0.5 + 0.5 * rW));
          }
        }
      }
      ctx.restore();
    });

    // DRAW DEPLOYED CARGO
    (state.deployedCargo || []).forEach(c => {
      ctx.fillStyle = '#fff';
      
      // Outer glow
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#f472b6';
      
      // Core
      ctx.fillRect(c.pos.x - 2, c.pos.y - 2, 4, 4);
      
      ctx.shadowBlur = 0;
    });

    // DRAW SHIP
    ctx.save();
    ctx.translate(ship.pos.x, ship.pos.y);
    
    // Attractor Radius
    ctx.strokeStyle = glitchActive ? 'rgba(51, 255, 51, 0.2)' : 'rgba(51, 255, 51, 0.08)';
    ctx.beginPath();
    ctx.arc(0, 0, ship.attractRadius, 0, Math.PI * 2);
    ctx.stroke();

    // SIPHON VAC tell: slow inward chevrons riding the attractor ring —
    // the field drinks, and the ring should say so. (The siphon's wider
    // eat-field only exists while VAC is held, so no second ring is
    // drawn — that would claim a field that isn't always there.)
    if (ship.loadout.hybrid === 'siphon_vac') {
      const spin = performance.now() / 2400;
      ctx.strokeStyle = 'rgba(51, 255, 51, 0.22)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const a = spin + (i * Math.PI) / 3;
        const rx = Math.cos(a) * ship.attractRadius;
        const ry = Math.sin(a) * ship.attractRadius;
        ctx.save();
        ctx.translate(rx, ry);
        ctx.rotate(a + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(-4, -3);
        ctx.lineTo(0, 2);
        ctx.lineTo(4, -3);
        ctx.stroke();
        ctx.restore();
      }
    }

    // DEFENSE VISUALS (Slice 6): Deflector bubble (brightness = pool left)
    // and the faint Point-Defense reach ring, when those are equipped.
    if (ship.loadout.defense === 'deflector_shield' && ship.shield && ship.shield > 0) {
      const sTier = ship.arsenal['deflector_shield'] || 1;
      const frac = Math.max(0, Math.min(1, ship.shield / shieldMaxFor(sTier)));
      ctx.strokeStyle = `rgba(103, 232, 249, ${0.25 + 0.55 * frac})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, ship.size + 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (ship.loadout.defense === 'pd_zap') {
      // PD REACH RING — wakes, doesn't loiter: near-invisible while
      // nothing threatens, lit when a hostile or its bolt is inside
      // reach, brightest just after a zap. (Was a constant ring stacking
      // on the VAC circle and the shield bubble — ring soup.)
      const pdThreat = (state.drones || []).some(d => d.owner === 'enemy' &&
          Math.hypot(d.pos.x - ship.pos.x, d.pos.y - ship.pos.y) < PD_RANGE + 40) ||
        (state.projectiles || []).some(p => p.owner === 'enemy' &&
          Math.hypot(p.pos.x - ship.pos.x, p.pos.y - ship.pos.y) < PD_RANGE + 40);
      const pdJustFired = ship.pdZapAt && performance.now() - ship.pdZapAt < 300;
      const pdAlpha = pdJustFired ? 0.5 : pdThreat ? 0.28 : 0.03;
      ctx.strokeStyle = `rgba(103, 232, 249, ${pdAlpha})`;
      ctx.setLineDash([3, 9]);
      ctx.beginPath();
      ctx.arc(0, 0, PD_RANGE, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.rotate(ship.angle);
    
    // Cargo Visual (Sparks/Mass indicators)
    if (ship.carrying > 0) {
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = 1;
      for (let i = 0; i < Math.min(ship.carrying, 12); i++) {
        const sx = (Math.random() - 0.5) * 30;
        const sy = (Math.random() - 0.5) * 30;
        ctx.strokeRect(sx, sy, 2, 2);
      }
    }

    // HYBRID VISUALS — BACK LAYER (Phase 1b follow-on): the equipped
    // hybrid changes the ship's silhouette, drawn from loadout.hybrid +
    // its owned tier. Mirror Sail rides BEHIND the hull: two mirror
    // panels swept back from the tail, sized by tier, with a sheen that
    // slowly travels — a sail, not a wing.
    if (ship.loadout.hybrid === 'mirror_sail') {
      const mTier = ship.arsenal['mirror_sail'] || 1;
      const reach = ship.size * (1.5 + 0.16 * mTier);
      const spread = ship.size * (1.05 + 0.13 * mTier);
      const sheen = 0.22 + 0.1 * Math.sin(performance.now() / 700);
      ctx.fillStyle = `rgba(226, 232, 240, ${sheen})`;
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.85)';
      ctx.lineWidth = 1;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-ship.size * 0.55, s * ship.size * 0.18);
        ctx.lineTo(-reach, s * spread);
        ctx.lineTo(-ship.size * 0.1, s * ship.size * 0.62);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      // Mast line tying the panels to the tail.
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.5)';
      ctx.beginPath();
      ctx.moveTo(-ship.size * 0.55, -ship.size * 0.18);
      ctx.lineTo(-ship.size * 0.55, ship.size * 0.18);
      ctx.stroke();
    }

    // ARMOR PLATING (when equipped): a steel rim under the hull outline,
    // thicker per tier — plating you can see, since the mass is real.
    const hullPts = hullOutlineFor(ship.line, ship.typeTier, ship.size);
    if (ship.loadout.defense === 'armor_plating') {
      const aTier = ship.arsenal['armor_plating'] || 1;
      ctx.strokeStyle = '#9f9faa';
      ctx.lineWidth = 3 + aTier;
      traceOutline(ctx, hullPts);
      ctx.stroke();
    }

    // Ship Body — the painted SPRITE when it has loaded (Pretty
    // Ships): rotated from nose-up into the hull's forward, drawn at
    // SPRITE_SCALE over the outline's footprint. NO outline rides the
    // art at rest (Adam, 2026-10-21): the green edge is the HIT
    // FLASH now, stroked only for a beat when health drops. Until
    // the image lands (or if it ever fails), the vector body below
    // draws exactly as it always has — its green stroke is the body
    // there, not an edge over paint. Armor rim (under) and the
    // capability tells (over) are unchanged either way.
    noteHealth(ship.ownerId, ship.health);
    const localSprite = shipSprite(ship.line, ship.typeTier);
    if (localSprite) {
      ctx.save();
      ctx.rotate(Math.PI / 2);
      const S = ship.size * SPRITE_SCALE;
      ctx.drawImage(localSprite, -S / 2, -S / 2, S, S);
      ctx.restore();
      const flash = hitFlashFor(ship.ownerId);
      if (flash > 0) {
        ctx.strokeStyle = `rgba(51, 255, 51, ${0.85 * flash})`;
        ctx.lineWidth = 2;
        traceOutline(ctx, hullPts);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#1a1a1c';
      ctx.strokeStyle = COLORS.CRT_GLOW;
      ctx.lineWidth = 2;
      traceOutline(ctx, hullPts);
      ctx.fill();
      ctx.stroke();
    }

    // CAPABILITY TELLS: the frame's special, drawn from the same def the
    // sim fires with — extra hard points as flank mount nubs, cruiser
    // auto-guns as deck turrets, drone capacity as spine dock rings.
    {
      const def = typeFor(ship.line, ship.typeTier);
      ctx.fillStyle = '#0c0c0e';
      ctx.strokeStyle = 'rgba(51, 255, 51, 0.75)';
      ctx.lineWidth = 1;
      for (let i = 0; i < def.hardPoints - 1; i++) {
        for (const sd of [-1, 1]) {
          const mx = ship.size * (0.45 - i * 0.3);
          const my = sd * ship.size * 0.52;
          ctx.beginPath();
          ctx.arc(mx, my, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      for (let i = 0; i < def.autoGuns; i++) {
        const gx = ship.size * (0.5 - i * 0.55);
        ctx.beginPath();
        ctx.arc(gx, 0, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx + ship.size * 0.3, 0);
        ctx.stroke();
      }
      if (def.dronesFielded > 1) {
        ctx.strokeStyle = 'rgba(244, 114, 182, 0.65)';
        for (let i = 0; i < def.dronesFielded; i++) {
          ctx.beginPath();
          ctx.arc(ship.size * (0.25 - i * 0.32), 0, 2.6, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // HYBRID VISUALS — FRONT LAYER: the other three hybrids ride ON the
    // hull. (One hybrid equips at a time, so these never stack.)
    if (ship.loadout.hybrid === 'thorn_hull') {
      // THORN HULL: spikes along both flanks and off the tail — the
      // bite-back made visible. Longer per tier (its damage table is).
      const tTier = ship.arsenal['thorn_hull'] || 1;
      const spikeLen = 4 + 1.7 * tTier;
      ctx.fillStyle = '#14532d';
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 1;
      const spike = (bx: number, by: number, dx: number, dy: number) => {
        const dl = Math.hypot(dx, dy) || 1;
        const ux = dx / dl, uy = dy / dl;
        const px = -uy, py = ux;
        ctx.beginPath();
        ctx.moveTo(bx + px * 2.2, by + py * 2.2);
        ctx.lineTo(bx + ux * spikeLen, by + uy * spikeLen);
        ctx.lineTo(bx - px * 2.2, by - py * 2.2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      };
      // Flank edges come from the flown frame's outline: nose -> the
      // rearmost corner on each side, wherever this type puts them.
      const nose = hullPts[0];
      const rearTop = hullPts.filter(p => p[1] < 0).reduce((a, b) => (b[0] < a[0] ? b : a));
      const rearBot = hullPts.filter(p => p[1] > 0).reduce((a, b) => (b[0] < a[0] ? b : a));
      for (const s of [-1, 1]) {
        const rear = s < 0 ? rearTop : rearBot;
        for (const t of [0.3, 0.55, 0.8]) {
          const bx = nose[0] + (rear[0] - nose[0]) * t;
          const by = nose[1] + (rear[1] - nose[1]) * t;
          // Outward = away from the hull's spine.
          spike(bx, by, bx * 0.4, s * 1);
        }
        // Tail corner spike, pointing back-out.
        spike(rear[0], rear[1], -1, s * 0.35);
      }
    }
    if (ship.loadout.hybrid === 'scrap_aegis') {
      // SCRAP AEGIS: patchwork plates bolted along the hull outline —
      // junk armor, visibly NOT the smooth steel rim of Armor Plating.
      // More plates per tier (each plate is scrap that soaks damage).
      const gTier = ship.arsenal['scrap_aegis'] || 1;
      const plateCount = 3 + gTier;
      const tones = ['#b45309', '#78716c', '#a16207', '#57534e'];
      const outline: Array<[number, number]> = hullPts;
      // Walk the outline perimeter and park a plate every 1/plateCount.
      const segs: Array<{ x0: number; y0: number; x1: number; y1: number; len: number }> = [];
      let perim = 0;
      for (let i = 0; i < outline.length; i++) {
        const [x0, y0] = outline[i];
        const [x1, y1] = outline[(i + 1) % outline.length];
        const len = Math.hypot(x1 - x0, y1 - y0);
        segs.push({ x0, y0, x1, y1, len });
        perim += len;
      }
      for (let i = 0; i < plateCount; i++) {
        let d = (perim * (i + 0.5)) / plateCount;
        let seg = segs[segs.length - 1];
        for (const sg of segs) {
          if (d <= sg.len) { seg = sg; break; }
          d -= sg.len;
        }
        const t = seg.len ? d / seg.len : 0;
        const cx = seg.x0 + (seg.x1 - seg.x0) * t;
        const cy = seg.y0 + (seg.y1 - seg.y0) * t;
        const ang = Math.atan2(seg.y1 - seg.y0, seg.x1 - seg.x0);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ang);
        ctx.fillStyle = tones[i % tones.length];
        ctx.strokeStyle = '#292524';
        ctx.lineWidth = 1;
        ctx.fillRect(-4.5, -2.6, 9, 5.2);
        ctx.strokeRect(-4.5, -2.6, 9, 5.2);
        ctx.fillStyle = '#e7e5e4';
        ctx.beginPath();
        ctx.arc(0, 0, 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    if (ship.loadout.hybrid === 'siphon_vac') {
      // SIPHON VAC: intake scoops at the rear flanks — the silhouette
      // grows a pair of drinking mouths to match the ring chevrons.
      ctx.fillStyle = '#12211a';
      ctx.strokeStyle = 'rgba(51, 255, 51, 0.6)';
      ctx.lineWidth = 1;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-ship.size * 0.35, s * ship.size * 0.6);
        ctx.lineTo(-ship.size * 1.08, s * ship.size * 1.04);
        ctx.lineTo(-ship.size * 1.28, s * ship.size * 0.84);
        ctx.lineTo(-ship.size * 0.62, s * ship.size * 0.42);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Louver slats across the scoop mouth.
        for (const t of [0.35, 0.65]) {
          ctx.beginPath();
          ctx.moveTo(
            -ship.size * (0.35 + 0.73 * t),
            s * ship.size * (0.6 + 0.44 * t),
          );
          ctx.lineTo(
            -ship.size * (0.62 + 0.66 * t),
            s * ship.size * (0.42 + 0.42 * t),
          );
          ctx.stroke();
        }
      }
    }

    // Thrust Flame
    if (ship.thrust) {
      ctx.fillStyle = '#ff6600';
      ctx.beginPath();
      ctx.moveTo(-ship.size * 0.8, 0);
      ctx.lineTo(-ship.size * 2 - Math.random() * 15, (Math.random() - 0.5) * 8);
      ctx.lineTo(-ship.size * 0.8, (Math.random() - 0.5) * 4);
      ctx.fill();
    }

    // Welding Effect
    const timeSinceUpgrade = performance.now() - state.lastUpgradeTime;
    if (timeSinceUpgrade < 1500) {
      const sparkCount = Math.floor(Math.random() * 8) + 4;
      for (let i = 0; i < sparkCount; i++) {
        const sx = (Math.random() - 0.5) * ship.size * 2.5;
        const sy = (Math.random() - 0.5) * ship.size * 2.5;
        const len = Math.random() * 6;
        ctx.strokeStyle = Math.random() > 0.5 ? '#fff' : '#fbbf24';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + (Math.random() - 0.5) * len, sy + (Math.random() - 0.5) * len);
        ctx.stroke();
      }
      // Bright flash
      if (Math.random() < 0.2) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.beginPath();
        ctx.arc(0, 0, ship.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // REMOTE SHIPS + NAMEPLATES (Adam, 2026-10-21): every seat's ship
    // is on the field in a net room — until now this canvas drew only
    // the viewer's frame, so other players were invisible. A remote
    // frame wears its own type/hull silhouette stroked in its TEAM
    // color (friend-or-foe at a glance) with a thrust flame when its
    // sim says it's burning — and none of the viewer's instruments
    // (no VAC ring, no gauges: those belong to the seat you fly).
    // NAMEPLATES ride the same block but are separately optional
    // (DISPLAY OPTIONS): hulls always draw; plates obey their toggle.
    // THE CLOAK (Adam, 2026-10-21): a minelayer-line hull is the
    // submarine — invisible beyond the reveal band, a sonar GHOST
    // inside it (pale stroke, dashed echo ring, no plate), near-solid
    // only up close; thrust betrays it (a burning boat ghosts
    // brighter), and firing or laying flares it fully for the
    // periscope window the sim stamps as ship.cloakReveal (seconds
    // remaining). Plates obey the cloak too. Solo passes no labels;
    // nothing here draws there.
    if (seatLabels) {
      const platesOn = getUiOptions().nameplates;
      const plateFor = (sx: number, sy: number, size: number, ownerId: string, alpha = 1) => {
        const label = seatLabels[ownerId];
        if (!label) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        const w = ctx.measureText(label.callsign).width + 10;
        const y = sy - size - 18;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(sx - w / 2, y - 9, w, 13);
        ctx.fillStyle = label.color;
        ctx.fillText(label.callsign, sx, y + 2);
        ctx.restore();
      };
      const mySeat = state.seats.find(se => se.ownerId === ship.ownerId);
      for (const seat of state.seats) {
        const rs = seat.ship;
        if (!rs || seat.ownerId === ship.ownerId) continue;
        noteHealth(rs.ownerId, rs.health);
        const label = seatLabels[seat.ownerId];
        // Reveal IS the sim's alpha (src/sim/stealth.ts — one
        // geometry for canvas, bots, seekers, and star systems):
        // 0 = skip entirely, the periscope moment snaps it to 1.
        // Teammates are exempt at this call site (a friendly
        // submarine draws solid for her own team).
        let reveal = 1;
        let ghost = false;
        if (isStealthShip(rs)) {
          const allied = !!mySeat && seat.teamId === mySeat.teamId;
          if (!allied) {
            reveal = stealthAlphaFor(rs, ship.pos);
            if (reveal <= 0) continue; // dark — the submarine is simply not there
            ghost = reveal < 0.85;
          }
        }
        ctx.save();
        if (isStealthShip(rs)) ctx.globalAlpha = reveal;
        ctx.translate(rs.pos.x, rs.pos.y);
        ctx.rotate(rs.angle);
        if (rs.thrust) {
          ctx.fillStyle = '#ff6600';
          ctx.beginPath();
          ctx.moveTo(-rs.size * 0.8, 0);
          ctx.lineTo(-rs.size * 2 - Math.random() * 15, (Math.random() - 0.5) * 8);
          ctx.lineTo(-rs.size * 0.8, (Math.random() - 0.5) * 4);
          ctx.fill();
        }
        // Hull presentation: an IDENTIFIED ship (not a cloak ghost)
        // wears its painted sprite, washed toward its team color;
        // a ghost keeps the sonar vector — detection earns a shape,
        // identification earns the ship. Vector fallback while the
        // image loads, as with the local hull.
        const rsSprite = !ghost ? tintedShipSprite(rs.line, rs.typeTier, label ? label.color : null) : null;
        if (rsSprite) {
          ctx.save();
          ctx.rotate(Math.PI / 2);
          const S = rs.size * SPRITE_SCALE;
          ctx.drawImage(rsSprite, -S / 2, -S / 2, S, S);
          ctx.restore();
          const rFlash = hitFlashFor(rs.ownerId);
          if (rFlash > 0) {
            ctx.save();
            ctx.globalAlpha = (isStealthShip(rs) ? reveal : 1) * rFlash * 0.9;
            ctx.strokeStyle = label ? label.color : COLORS.CRT_GLOW;
            ctx.lineWidth = 2;
            traceOutline(ctx, hullOutlineFor(rs.line, rs.typeTier, rs.size));
            ctx.stroke();
            ctx.restore();
          }
        } else {
          ctx.fillStyle = '#1a1a1c';
          ctx.strokeStyle = ghost ? 'rgba(150, 215, 255, 0.9)' : (label ? label.color : COLORS.CRT_GLOW);
          ctx.lineWidth = 2;
          traceOutline(ctx, hullOutlineFor(rs.line, rs.typeTier, rs.size));
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
        if (ghost) {
          // The sonar echo: a dashed ring says DETECTED, not seen.
          ctx.save();
          ctx.globalAlpha = 0.45 * reveal;
          ctx.strokeStyle = 'rgba(150, 215, 255, 0.8)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 5]);
          ctx.beginPath();
          ctx.arc(rs.pos.x, rs.pos.y, rs.size * 1.6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        if (platesOn && reveal > 0) {
          // Plates obey the cloak: they fade on the same alpha, so a
          // half-seen boat wears a half-seen name.
          plateFor(rs.pos.x, rs.pos.y, rs.size, seat.ownerId, isStealthShip(rs) ? reveal : 1);
        }
      }
      if (platesOn) plateFor(ship.pos.x, ship.pos.y, ship.size, ship.ownerId);
    }

    ctx.restore(); // End Camera space

    // OFF-SCREEN CHARGE CUE: the HUD banner says a CME is charging, but not
    // WHERE. If the charging star is off-screen, a blinking edge arrow
    // points toward it. Home star excluded — its CME is yours.
    [star, enemyStar].forEach(s => {
      if (s.type !== 'enemy') return;
      if (!(s.cmeChargeEndsAt && s.cmeChargeEndsAt > performance.now())) return;
      const camX = width / 2 - ship.pos.x;
      const camY = height / 2 - ship.pos.y;
      const sx = s.pos.x + camX;
      const sy = s.pos.y + camY;
      const m = 30;
      if (sx > m && sx < width - m && sy > m && sy < height - m) return;
      const px = Math.max(m, Math.min(width - m, sx));
      const py = Math.max(m, Math.min(height - m, sy));
      const ang = Math.atan2(sy - height / 2, sx - width / 2);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(performance.now() / 160);
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.moveTo(13, 0);
      ctx.lineTo(-6, -9);
      ctx.lineTo(-6, 9);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
      ctx.fillStyle = '#f43f5e';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('CME', px, py + 26);
      ctx.textAlign = 'start'; // restore canvas default for later world labels
    });

    // Global Overlay Effects
    if (glitchActive) {
      ctx.fillStyle = 'rgba(0, 255, 170, 0.05)';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(100, 255, 255, 0.15)';
      ctx.fillRect(0, Math.random() * height, width, 5 + Math.random() * 20);
    }
  }, [state, width, height]);

  return <canvas ref={canvasRef} width={width} height={height} className="block" />;
};
