// SHIP SPRITES (Pretty Ships integration, Adam 2026-10-21): the
// painted hull art, generated + magenta-keyed against the final
// 21-hull slate. The art ships as base64 TEXT (public/sprites/
// <name>.b64, the WebP bytes encoded) because this repo's write
// paths are text-only — the loader fetches the text, decodes it to
// a Blob URL, and hands the canvas a normal Image. The JS bundle
// stays lean; each hull's art caches as a static asset.
//
// THE CONTRACT (from the prototype gate): a sprite is a PICTURE of
// the hull, nothing more. The hull OUTLINE (hullOutlineFor) stays
// the truth — hitbox, armor rim, capability tells, thorn/aegis
// overlays all walk the outline in hull space. Sprites rotate to
// heading and draw at progression size; remote hulls take a
// runtime team tint (38% wash toward the team color, cached per
// hull + team). Until an image loads, the vector renderer draws —
// a missing sprite is a plain ship, never a broken one.

import type { ShipLine } from './shipProgression';

/** Draw size: sprite square side = ship.size * SPRITE_SCALE. The
 *  keyed art fills ~88% of its square; the outline spans ~2.2 *
 *  size — 2.5 seats the art on the outline's footprint. One
 *  constant, tuned by eye. */
export const SPRITE_SCALE = 2.5;

const NAMES: Record<string, string> = {
  'fighter:2': 'stinger',
  'fighter:3': 'lancer',
  'fighter:4': 'warfang',
  'fighter:5': 'warmonger',
  'minelayer:2': 'mole',
  'minelayer:3': 'skulker',
  'minelayer:4': 'saboteur',
  'minelayer:5': 'nautilus',
  'hauler:2': 'mule',
  'hauler:3': 'mammoth',
  'hauler:4': 'leviathan',
  'hauler:5': 'atlas',
  'drone:2': 'shepherd',
  'drone:3': 'warden',
  'drone:4': 'carrier',
  'drone:5': 'mothership',
  'cruiser:2': 'cruiser',
  'cruiser:3': 'vanguard',
  'cruiser:4': 'battlestar',
  'cruiser:5': 'dreadnought',
};

export function spriteNameFor(line: ShipLine | null, typeTier: number): string {
  if (!line || typeTier <= 1) return 'skiff';
  return NAMES[`${line}:${typeTier}`] ?? 'skiff';
}

const imageCache = new Map<string, HTMLImageElement>();
const fetchStarted = new Set<string>();

function startFetch(name: string) {
  if (fetchStarted.has(name)) return;
  fetchStarted.add(name);
  fetch(`/sprites/${name}.b64`)
    .then(r => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .then(b64 => {
      const bin = atob(b64.trim());
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }));
      const img = new Image();
      img.src = url;
      imageCache.set(name, img);
    })
    .catch(() => {
      /* the art failed to arrive — the vector hull draws, forever
         if need be. A plain ship, never a broken one. */
    });
}

/** The loaded sprite for a hull, or null while it is still loading
 *  (the caller falls back to the vector hull meanwhile). */
export function shipSprite(line: ShipLine | null, typeTier: number): HTMLImageElement | null {
  const name = spriteNameFor(line, typeTier);
  const img = imageCache.get(name);
  if (!img) {
    startFetch(name);
    return null;
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

const tintCache = new Map<string, HTMLCanvasElement>();

/** The sprite washed 38% toward a team color — identity at a
 *  glance for remote hulls, built once per hull + team and cached.
 *  Returns the plain sprite when no color is given, null while
 *  loading. */
export function tintedShipSprite(
  line: ShipLine | null,
  typeTier: number,
  color: string | null,
): CanvasImageSource | null {
  const img = shipSprite(line, typeTier);
  if (!img) return null;
  if (!color) return img;
  const name = spriteNameFor(line, typeTier);
  const key = `${name}|${color}`;
  let canvas = tintCache.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const c = canvas.getContext('2d');
    if (!c) return img;
    c.drawImage(img, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    c.globalAlpha = 0.38;
    c.fillStyle = color;
    c.fillRect(0, 0, canvas.width, canvas.height);
    tintCache.set(key, canvas);
  }
  return canvas;
}
