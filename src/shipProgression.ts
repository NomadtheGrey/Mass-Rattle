/**
 * SHIP PROGRESSION — Phase 3, slice 1 (BackGround lane, 2026-10-20).
 *
 * =====================================================================
 * DRAFT NUMBERS — Adam's pin pass pending. Every price, cap, and
 * amount in this file is DATA from
 * ~/workspace/games-audit/ship-progression-numbers-draft.md (which
 * drafts over the PINNED structure in ReadMeFiles/SHIP_PROGRESSION.md:
 * two ladders, peaks-not-locks, bundled pricing, well-gated shop,
 * switching toll). Adam's pin edits THIS TABLE, never the logic in
 * useGameLoop.ts — the loop only reads helpers from here.
 * =====================================================================
 *
 * Vocabulary:
 * - LINE: one of the five ship families. A ship has no line at spawn
 *   (line === null): it is the unaligned SKIFF. The T2 purchase chooses
 *   the line; later type purchases climb within it. switchLine moves a
 *   T2+ ship sideways for a toll.
 * - TYPE TIER: 1..4 within the line. T1 is the SKIFF for every line.
 * - HULL STEPS: the grind inside a type; each step is +2 size, +10 max
 *   health. A type's hullStepCap says how far the hull may grow before
 *   the next size step REQUIRES a bigger type (Adam's two-ladder rule).
 * - TRACK CAPS: per line x type ceilings on the five upgrade tracks
 *   (thrust / handling / attractor-as-vac / fuelCap-as-fuel / cargo).
 *   Baseline ladder is the same for all lines; a line's PEAK tracks run
 *   +1 at T3 and +2 at T4 over baseline (peaks-not-locks: nobody is
 *   denied a track, the specialty line just goes higher).
 */

export type ShipLine = 'fighter' | 'minelayer' | 'hauler' | 'drone' | 'cruiser';
export type TypeTier = 1 | 2 | 3 | 4;

export interface TrackCaps {
  thrust: number;
  handling: number;
  vac: number;
  fuel: number;
  cargo: number;
}

export interface ShipTypeDef {
  name: string;
  /** Hull steps this type allows (size = 15 + 2 x steps grown). */
  hullStepCap: number;
  trackCaps: TrackCaps;
  /**
   * Parallel mounts firing the equipped weapon (first mount 100%
   * damage, extras at EXTRA_MOUNT_DAMAGE). The CRUISER line keeps 1 —
   * its extra guns are autoGuns instead (Adam: "spot on").
   */
  hardPoints: number;
  /** Cruiser only: shipboard auto-turrets (see AUTO_GUN). 0 elsewhere. */
  autoGuns: number;
  /** Mines laid per Mine Layer activation (each still costs 1 scrap). */
  minesPerDrop: number;
  /** Player drones the ship can field at once (buildDrone's cap). */
  dronesFielded: number;
  /** Flat hold capacity added on top of the cargo track. */
  cargoBonus: number;
  /** Flat VAC/attract radius added on top of the attractor track. */
  vacBonus: number;
}

export interface ShipLineDef {
  /** Step prices to climb INTO T2 / T3 / T4 (Table 1a, DRAFT). */
  stepPrices: [number, number, number];
  /** Index 0..3 = T1..T4. Index 0 is the shared SKIFF for every line. */
  types: [ShipTypeDef, ShipTypeDef, ShipTypeDef, ShipTypeDef];
}

// The SKIFF: every line's T1, and the whole ship when line === null.
// T1 numbers are line-neutral — nothing differs between lines at T1.
const SKIFF: ShipTypeDef = {
  name: 'SKIFF',
  hullStepCap: 1,
  trackCaps: { thrust: 3, handling: 3, vac: 2, fuel: 2, cargo: 2 },
  hardPoints: 1,
  autoGuns: 0,
  minesPerDrop: 1,
  dronesFielded: 1,
  cargoBonus: 0,
  vacBonus: 0,
};

export const SHIP_LINES: Record<ShipLine, ShipLineDef> = {
  fighter: {
    stepPrices: [150, 400, 900],
    types: [
      SKIFF,
      {
        name: 'STINGER',
        hullStepCap: 3,
        trackCaps: { thrust: 5, handling: 5, vac: 4, fuel: 4, cargo: 4 },
        hardPoints: 2, autoGuns: 0, minesPerDrop: 1, dronesFielded: 1, cargoBonus: 0, vacBonus: 0,
      },
      {
        name: 'LANCER',
        hullStepCap: 5,
        // PEAK: thrust + handling (+1 over baseline at T3).
        trackCaps: { thrust: 9, handling: 9, vac: 6, fuel: 7, cargo: 6 },
        hardPoints: 3, autoGuns: 0, minesPerDrop: 1, dronesFielded: 2, cargoBonus: 0, vacBonus: 10,
      },
      {
        name: 'WARFANG',
        hullStepCap: 8,
        // PEAK: thrust + handling (+2 over baseline at T4).
        trackCaps: { thrust: 14, handling: 14, vac: 10, fuel: 10, cargo: 10 },
        hardPoints: 4, autoGuns: 0, minesPerDrop: 2, dronesFielded: 2, cargoBonus: 2, vacBonus: 20,
      },
    ],
  },
  minelayer: {
    stepPrices: [150, 400, 900],
    types: [
      SKIFF,
      {
        name: 'SOWER',
        hullStepCap: 3,
        trackCaps: { thrust: 5, handling: 5, vac: 4, fuel: 4, cargo: 4 },
        hardPoints: 1, autoGuns: 0, minesPerDrop: 2, dronesFielded: 1, cargoBonus: 0, vacBonus: 0,
      },
      {
        name: 'TRAPPER',
        hullStepCap: 5,
        // PEAK: cargo (+1 over baseline at T3).
        trackCaps: { thrust: 8, handling: 8, vac: 6, fuel: 7, cargo: 7 },
        hardPoints: 2, autoGuns: 0, minesPerDrop: 3, dronesFielded: 2, cargoBonus: 2, vacBonus: 10,
      },
      {
        name: 'WIDOW',
        hullStepCap: 8,
        // PEAK: cargo (+2 over baseline at T4).
        trackCaps: { thrust: 12, handling: 12, vac: 10, fuel: 10, cargo: 12 },
        hardPoints: 2, autoGuns: 0, minesPerDrop: 5, dronesFielded: 2, cargoBonus: 4, vacBonus: 20,
      },
    ],
  },
  hauler: {
    stepPrices: [160, 440, 1000],
    types: [
      SKIFF,
      {
        name: 'MULE',
        hullStepCap: 3,
        trackCaps: { thrust: 5, handling: 5, vac: 4, fuel: 4, cargo: 4 },
        hardPoints: 1, autoGuns: 0, minesPerDrop: 1, dronesFielded: 1, cargoBonus: 4, vacBonus: 20,
      },
      {
        name: 'PACKHORSE',
        hullStepCap: 5,
        // PEAK: vac + cargo (+1 over baseline at T3).
        trackCaps: { thrust: 8, handling: 8, vac: 7, fuel: 7, cargo: 7 },
        hardPoints: 1, autoGuns: 0, minesPerDrop: 2, dronesFielded: 2, cargoBonus: 8, vacBonus: 40,
      },
      {
        name: 'LEVIATHAN',
        hullStepCap: 9, // Hauler T4 peaks hull second only to Cruiser.
        // PEAK: vac + cargo (+2 over baseline at T4).
        trackCaps: { thrust: 12, handling: 12, vac: 12, fuel: 10, cargo: 12 },
        hardPoints: 2, autoGuns: 0, minesPerDrop: 2, dronesFielded: 2, cargoBonus: 12, vacBonus: 60,
      },
    ],
  },
  drone: {
    stepPrices: [190, 500, 1125],
    types: [
      SKIFF,
      {
        name: 'SHEPHERD',
        hullStepCap: 3,
        trackCaps: { thrust: 5, handling: 5, vac: 4, fuel: 4, cargo: 4 },
        hardPoints: 1, autoGuns: 0, minesPerDrop: 1, dronesFielded: 2, cargoBonus: 2, vacBonus: 10,
      },
      {
        name: 'WARDEN',
        hullStepCap: 5,
        // PEAK: fuel (+1 over baseline at T3).
        trackCaps: { thrust: 8, handling: 8, vac: 6, fuel: 8, cargo: 6 },
        hardPoints: 2, autoGuns: 0, minesPerDrop: 1, dronesFielded: 3, cargoBonus: 2, vacBonus: 20,
      },
      {
        name: 'CARRIER',
        hullStepCap: 8,
        // PEAK: fuel (+2 over baseline at T4).
        trackCaps: { thrust: 12, handling: 12, vac: 10, fuel: 12, cargo: 10 },
        hardPoints: 2, autoGuns: 0, minesPerDrop: 2, dronesFielded: 5, cargoBonus: 4, vacBonus: 30,
      },
    ],
  },
  cruiser: {
    stepPrices: [200, 600, 1800],
    types: [
      SKIFF,
      {
        name: 'CRUISER',
        hullStepCap: 3,
        // Cruiser exception: handling -1 from T2 on (the biggest hulls
        // turn worst). No peak tracks — its peak is size/health.
        trackCaps: { thrust: 5, handling: 4, vac: 4, fuel: 4, cargo: 4 },
        hardPoints: 1, autoGuns: 1, minesPerDrop: 2, dronesFielded: 1, cargoBonus: 2, vacBonus: 0,
      },
      {
        name: 'BATTLESTAR',
        hullStepCap: 6, // Cruiser T3 peaks hull steps.
        // Handling -1; fuel +1 (T3/T4).
        trackCaps: { thrust: 8, handling: 7, vac: 6, fuel: 8, cargo: 6 },
        hardPoints: 1, autoGuns: 2, minesPerDrop: 2, dronesFielded: 2, cargoBonus: 4, vacBonus: 10,
      },
      {
        name: 'DREADNOUGHT',
        hullStepCap: 10, // The biggest hull in the game: max size 35.
        // Handling -1; fuel +1 (T3/T4).
        trackCaps: { thrust: 12, handling: 11, vac: 10, fuel: 11, cargo: 10 },
        hardPoints: 1, autoGuns: 4, minesPerDrop: 3, dronesFielded: 3, cargoBonus: 6, vacBonus: 20,
      },
    ],
  },
};

/** The type def for a ship: line null (unaligned) is always the SKIFF. */
export const typeFor = (line: ShipLine | null, tier: TypeTier): ShipTypeDef =>
  line === null ? SKIFF : SHIP_LINES[line].types[tier - 1];

/** Track caps for a ship's current line/tier (null line = SKIFF caps). */
export const capsFor = (line: ShipLine | null, tier: TypeTier): TrackCaps =>
  typeFor(line, tier).trackCaps;

/** Price to climb from `fromTier` to the next type within `line`. */
export const typeStepPrice = (line: ShipLine, fromTier: TypeTier): number =>
  SHIP_LINES[line].stepPrices[fromTier - 1];

/**
 * Hull step price (DRAFT curve): 30 + 10 x steps already grown on top
 * of the first step's 40 — i.e. the NEXT step when `stepsGrown` steps
 * are already grown costs 40 + 10 x stepsGrown (step 1 = 40, step 8 =
 * 110; maxing 8 steps = 600).
 */
export const hullStepPrice = (stepsGrown: number): number => 40 + 10 * stepsGrown;

/** Hull geometry: size starts 15, +2 per step (draft Table 1b). */
export const BASE_SHIP_SIZE = 15;
export const hullSizeFor = (hullSteps: number): number => BASE_SHIP_SIZE + 2 * hullSteps;
/** Max-health granted per hull step (UI lane's recommendation, DRAFT). */
export const HULL_STEP_HEALTH = 10;

/**
 * Line-switching toll (DRAFT curve, Adam: "free at first, costlier as
 * progression goes"): your FIRST switch ever is free at any tier; after
 * that the toll is set by the tier of the ship you're leaving.
 * T1 = 0 (no line to leave), T2 = 40, T3 = 120, T4 = 300.
 */
export const switchToll = (s: { lineSwitchesUsed: number; typeTier: TypeTier }): number => {
  if (s.lineSwitchesUsed <= 0) return 0;
  switch (s.typeTier) {
    case 2: return 40;
    case 3: return 120;
    case 4: return 300;
    default: return 0;
  }
};

/**
 * DRAFT — NOT in the numbers draft: the price of building one player
 * drone via the buildDrone action (which is also the replacement path
 * for a lost drone — lost drones are rebuilt, not auto-replaced).
 * Flagged for Adam's pin pass alongside the table numbers.
 */
export const DRONE_PRICE = 75;

/** Extra hard-point mounts fire at this fraction of the weapon's damage. */
export const EXTRA_MOUNT_DAMAGE = 0.6;

/**
 * Cruiser auto-gun stats (DRAFT, numbers draft Table 2): shipboard
 * turrets that fire on their own at the nearest hostile — they never
 * focus-fire the pilot's target. Bolt speed mirrors the star turrets'.
 */
export const AUTO_GUN = {
  damage: 6,
  fireChance: 0.008, // per gun, per frame (~0.8%)
  range: 700,
  boltSpeed: 8,
  life: 110, // frames; range / boltSpeed ~= 88, plus slack
};
