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
 * - TYPE TIER: 1..5 within the line. T1 is the SKIFF for every line;
 *   T5 is the line's CROWN (added 2026-10-21 — see the crown notes
 *   in the table: names are Adam's adoptions, two crown names are
 *   still UNSETTLED drafts, and every crown number is DRAFT).
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
export type TypeTier = 1 | 2 | 3 | 4 | 5;

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
  /**
   * TURN FACTOR — the line's base turning character (RULED,
   * Adam, 2026-10-21: turn speed is a per-line base property,
   * rooted in what each line IS — not a size law, not a carrier
   * exception). Anchors are his: fighters turn fastest; carriers
   * turn poorly; haulers about like a carrier. Cruiser and
   * minelayer placements, and every value here, are DRAFT for
   * his pin pass. The physics step scales the base rotation
   * speed by this factor; handling upgrades still add on top.
   */
  turnFactor: number;
  trackCaps: TrackCaps;
  /**
   * Parallel mounts firing the equipped weapon (first mount 100%
   * damage, extras at EXTRA_MOUNT_DAMAGE). The CRUISER line keeps 1 —
   * its extra guns are autoGuns instead (Adam: "spot on").
   */
  hardPoints: number;
  /**
   * Shipboard auto-turret MOUNT CAP (Arsenal slice 2, 2026-10-21):
   * how many turret mounts this type can carry. Mounts are BOUGHT
   * one at a time (buyTurretMount, turretMountPriceFor); the ship
   * fires min(cap, Ship.turretMounts) — see effectiveAutoGuns. The
   * cruiser's values are the shipped Phase 3 amounts become caps:
   * the battery's advantage is now cap DEPTH, not free guns. Every
   * other line's cap is a NEW DRAFT under peaks-not-locks (a line
   * can mount turrets, the cruiser just mounts the most).
   */
  autoGuns: number;
  /** Mines laid per Mine Layer activation (each still costs 1 scrap). */
  minesPerDrop: number;
  /**
   * Defense-drone CAP (Arsenal slice 3, 2026-10-21): how many
   * defense-mode drones (see sim/drones.ts) this type can field
   * alongside its harvesters. Adam's hauler complement: the pair
   * completes at the hauler's T3 (1 at T2, 2 from T3) — "a couple,
   * nothing near the carriers." Every other line is 0 IN THIS
   * SLICE: the axis exists in the table for a later pass.
   */
  defenseDrones: number;
  /**
   * Drone quality axis (Arsenal slice 3, DRAFT): the workforce a
   * ship fields flies at PHYSICS.DRONES.SPEED x (1 + pct/100) and
   * carries PHYSICS.DRONES.CAPACITY + bonus. Values live ONLY on
   * the hauler row in this slice (her workforce IS the complement);
   * every other type is baseline 0/+0.
   */
  droneSpeedPct: number;
  droneCarryBonus: number;
  /**
   * THE CARRIER WING (Arsenal slice 5b): how many escorts of each
   * kind this type may field. Nonzero ONLY on the drone line — the
   * wing is that line's abundance (Adam's ruling: the carrier's
   * numbers are her escorts, not her workers). All other lines
   * carry zeros. Values DRAFT for the numbers pass; the entity
   * worst case (4 drone-line seats x an 11-ship crown wing = 44
   * extra hulls) is FLAGGED there, not solved here.
   */
  escortWing: { skiff: number; stinger: number; lancer: number };
  /** Player drones the ship can field at once (buildDrone's cap). */
  dronesFielded: number;
  /** Flat hold capacity added on top of the cargo track. */
  cargoBonus: number;
  /** Flat VAC/attract radius added on top of the attractor track. */
  vacBonus: number;
}

export interface ShipLineDef {
  /** Step prices to climb INTO T2 / T3 / T4 / T5 (Table 1a, DRAFT). */
  stepPrices: [number, number, number, number];
  /** Index 0..4 = T1..T5. Index 0 is the shared SKIFF for every line. */
  types: [ShipTypeDef, ShipTypeDef, ShipTypeDef, ShipTypeDef, ShipTypeDef];
}

// The SKIFF: every line's T1, and the whole ship when line === null.
// T1 numbers are line-neutral — nothing differs between lines at T1.
const SKIFF: ShipTypeDef = {
  name: 'SKIFF',
  turnFactor: 1.0,
  hullStepCap: 1,
  trackCaps: { thrust: 3, handling: 3, vac: 2, fuel: 2, cargo: 2 },
  hardPoints: 1,
  autoGuns: 1,
  minesPerDrop: 1,
  dronesFielded: 1,
  cargoBonus: 0,
  vacBonus: 0,
  defenseDrones: 0, droneSpeedPct: 0, droneCarryBonus: 0,
  escortWing: { skiff: 0, stinger: 0, lancer: 0 },
};

export const SHIP_LINES: Record<ShipLine, ShipLineDef> = {
  fighter: {
    stepPrices: [150, 400, 900, 1450],
    types: [
      SKIFF,
      {
        name: 'STINGER',
        turnFactor: 1.25,
        hullStepCap: 3,
        trackCaps: { thrust: 5, handling: 5, vac: 4, fuel: 4, cargo: 4 },
        hardPoints: 2, autoGuns: 1, minesPerDrop: 1, dronesFielded: 1, cargoBonus: 0, vacBonus: 0, defenseDrones: 0, droneSpeedPct: 0, droneCarryBonus: 0, escortWing: { skiff: 0, stinger: 0, lancer: 0 },
      },
      {
        name: 'LANCER',
        turnFactor: 1.22,
        hullStepCap: 5,
        // PEAK: thrust + handling (+1 over baseline at T3).
        trackCaps: { thrust: 9, handling: 9, vac: 6, fuel: 7, cargo: 6 },
        hardPoints: 3, autoGuns: 1, minesPerDrop: 1, dronesFielded: 2, cargoBonus: 0, vacBonus: 10, defenseDrones: 0, droneSpeedPct: 0, droneCarryBonus: 0, escortWing: { skiff: 0, stinger: 0, lancer: 0 },
      },
      {
        name: 'WARFANG',
        turnFactor: 1.2,
        // GLASS CANNON (Arsenal slice 1, 2026-10-21): hull cap cut
        // 8 -> 7 — the fighter ladder (3/5/7/9) is the LIGHTEST in
        // the table, tier for tier. The whole arsenal rides on the
        // thinnest hull. DRAFT for Adam's pin pass.
        hullStepCap: 7,
        // PEAK: thrust + handling (+2 over baseline at T4).
        trackCaps: { thrust: 14, handling: 14, vac: 10, fuel: 10, cargo: 10 },
        hardPoints: 4, autoGuns: 2, minesPerDrop: 2, dronesFielded: 2, cargoBonus: 2, vacBonus: 20, defenseDrones: 0, droneSpeedPct: 0, droneCarryBonus: 0, escortWing: { skiff: 0, stinger: 0, lancer: 0 },
      },
      {
        // T5 CROWN — WARMONGER (Adam, adopted 2026-10-21).
        name: 'WARMONGER',
        turnFactor: 1.15,
        // GLASS CANNON (Arsenal slice 1, 2026-10-21): hull cap cut
        // 11 -> 9 (see WARFANG) — lightest ladder in the table.
        hullStepCap: 9,
        // PEAK: thrust + handling (+3 over the T5 baseline).
        trackCaps: { thrust: 19, handling: 19, vac: 13, fuel: 13, cargo: 13 },
        hardPoints: 5, autoGuns: 2, minesPerDrop: 2, dronesFielded: 3, cargoBonus: 2, vacBonus: 30, defenseDrones: 0, droneSpeedPct: 0, droneCarryBonus: 0, escortWing: { skiff: 0, stinger: 0, lancer: 0 },
      },
    ],
  },
  minelayer: {
    stepPrices: [150, 400, 900, 1450],
    types: [
      SKIFF,
      {
        name: 'MOLE',
        turnFactor: 1.05, // The saboteur ladder (Adam, adopted 2026-10-21): MOLE / SKULKER / SABOTEUR / NAUTILUS — SOWER retired.
        hullStepCap: 3,
        trackCaps: { thrust: 5, handling: 5, vac: 4, fuel: 4, cargo: 4 },
        hardPoints: 1, autoGuns: 1, minesPerDrop: 2, dronesFielded: 1, cargoBonus: 0, vacBonus: 0, defenseDrones: 0, droneSpeedPct: 0, droneCarryBonus: 0, escortWing: { skiff: 0, stinger: 0, lancer: 0 },
      },
      {
        name: 'SKULKER',
        turnFactor: 1.03, // Saboteur ladder: TRAPPER retired (SKULKER is Adam's substitution for the proposed SLEEPER).
        hullStepCap: 5,
        // PEAK: cargo (+1 over baseline at T3).
        trackCaps: { thrust: 8, handling: 8, vac: 6, fuel: 7, cargo: 7 },
        hardPoints: 2, autoGuns: 1, minesPerDrop: 3, dronesFielded: 2, cargoBonus: 2, vacBonus: 10, defenseDrones: 0, droneSpeedPct: 0, droneCarryBonus: 0, escortWing: { skiff: 0, stinger: 0, lancer: 0 },
      },
      {
        name: 'SABOTEUR',
        turnFactor: 1.0, // Saboteur ladder: WIDOW retired.
        hullStepCap: 8,
        // PEAK: cargo (+2 over baseline at T4).
        trackCaps: { thrust: 12, handling: 12, vac: 10, fuel: 10, cargo: 12 },
        hardPoints: 2, autoGuns: 1, minesPerDrop: 5, dronesFielded: 2, cargoBonus: 4, vacBonus: 20, defenseDrones: 0, droneSpeedPct: 0, droneCarryBonus: 0, escortWing: { skiff: 0, stinger: 0, lancer: 0 },
      },
      {
        // T5 CROWN — NAUTILUS (Adam, adopted 2026-10-21): the
        // submarine line's crown, and the ladder's fourth saboteur
        // name (MOLE / SKULKER / SABOTEUR / NAUTILUS). The STATS
        // are drafted.
        name: 'NAUTILUS',
        turnFactor: 0.98,
        hullStepCap: 11,
        // PEAK: cargo (+3 over the T5 baseline).
        trackCaps: { thrust: 16, handling: 16, vac: 13, fuel: 13, cargo: 16 },
        hardPoints: 2, autoGuns: 2, minesPerDrop: 7, dronesFielded: 3, cargoBonus: 6, vacBonus: 30, defenseDrones: 0, droneSpeedPct: 0, droneCarryBonus: 0, escortWing: { skiff: 0, stinger: 0, lancer: 0 },
      },
    ],
  },
  hauler: {
    stepPrices: [160, 440, 1000, 1600],
    types: [
      SKIFF,
      {
        // WORKFORCE CROWN (Adam's ruling, 2026-10-21 — "If anyone
        // has harvesters, HAULERS should"): the hauler row wears
        // the deep workforce ladder (2/3/5/7, the drone line's old
        // numbers) in number AND quality — her dronesFielded and
        // the droneSpeedPct/droneCarryBonus axis are both the
        // game's peak. Still DRAFT for the numbers pass.
        name: 'MULE',
        turnFactor: 0.72,
        hullStepCap: 3,
        trackCaps: { thrust: 5, handling: 5, vac: 4, fuel: 4, cargo: 4 },
        hardPoints: 1, autoGuns: 1, minesPerDrop: 1, dronesFielded: 2, cargoBonus: 4, vacBonus: 20, defenseDrones: 1, droneSpeedPct: 0, droneCarryBonus: 0, escortWing: { skiff: 0, stinger: 0, lancer: 0 },
      },
      {
        name: 'MAMMOTH',
        turnFactor: 0.7, // Renamed from PACKHORSE (Adam, adopted 2026-10-21).
        hullStepCap: 5,
        // PEAK: vac + cargo (+1 over baseline at T3).
        trackCaps: { thrust: 8, handling: 8, vac: 7, fuel: 7, cargo: 7 },
        hardPoints: 1, autoGuns: 2, minesPerDrop: 2, dronesFielded: 3, cargoBonus: 8, vacBonus: 40, defenseDrones: 2, droneSpeedPct: 10, droneCarryBonus: 1, escortWing: { skiff: 0, stinger: 0, lancer: 0 },
      },
      {
        name: 'LEVIATHAN',
        turnFactor: 0.68,
        hullStepCap: 9, // Hauler T4 peaks hull second only to Cruiser.
        // PEAK: vac + cargo (+2 over baseline at T4).
        trackCaps: { thrust: 12, handling: 12, vac: 12, fuel: 10, cargo: 12 },
        hardPoints: 2, autoGuns: 2, minesPerDrop: 2, dronesFielded: 5, cargoBonus: 12, vacBonus: 60, defenseDrones: 2, droneSpeedPct: 20, droneCarryBonus: 1, escortWing: { skiff: 0, stinger: 0, lancer: 0 },
      },
      {
        // T5 CROWN — ATLAS (Adam, adopted 2026-10-21: 'That's even
        // better for the Hauler T5'): the beast ladder tops out in
        // the Titan who carries the world — the hauler's whole job,
        // crowned. BEHEMOTH was the runner-up.
        name: 'ATLAS',
        turnFactor: 0.65,
        hullStepCap: 12,
        // PEAK: vac + cargo (+3 over the T5 baseline).
        trackCaps: { thrust: 16, handling: 16, vac: 16, fuel: 13, cargo: 16 },
        hardPoints: 2, autoGuns: 3, minesPerDrop: 2, dronesFielded: 7, cargoBonus: 16, vacBonus: 80, defenseDrones: 2, droneSpeedPct: 30, droneCarryBonus: 2, escortWing: { skiff: 0, stinger: 0, lancer: 0 },
      },
    ],
  },
  drone: {
    stepPrices: [190, 500, 1125, 1700],
    types: [
      SKIFF,
      {
        // MODEST CREW (Adam's ruling, 2026-10-21 — see the Mule):
        // the drone line's workforce drops to 1/2/3/4 — enough to
        // tend her star, no more. This line's abundance is her
        // ESCORT WING (Arsenal slice 5), not her workers.
        name: 'SHEPHERD',
        turnFactor: 0.72,
        hullStepCap: 3,
        trackCaps: { thrust: 5, handling: 5, vac: 4, fuel: 4, cargo: 4 },
        hardPoints: 1, autoGuns: 1, minesPerDrop: 1, dronesFielded: 1, cargoBonus: 2, vacBonus: 10, defenseDrones: 0, droneSpeedPct: 0, droneCarryBonus: 0, escortWing: { skiff: 1, stinger: 0, lancer: 0 },
      },
      {
        name: 'WARDEN',
        turnFactor: 0.7,
        hullStepCap: 5,
        // PEAK: fuel (+1 over baseline at T3).
        trackCaps: { thrust: 8, handling: 8, vac: 6, fuel: 8, cargo: 6 },
        hardPoints: 2, autoGuns: 2, minesPerDrop: 1, dronesFielded: 2, cargoBonus: 2, vacBonus: 20, defenseDrones: 0, droneSpeedPct: 0, droneCarryBonus: 0, escortWing: { skiff: 2, stinger: 1, lancer: 0 },
      },
      {
        name: 'CARRIER',
        turnFactor: 0.68,
        hullStepCap: 8,
        // PEAK: fuel (+2 over baseline at T4).
        trackCaps: { thrust: 12, handling: 12, vac: 10, fuel: 12, cargo: 10 },
        hardPoints: 2, autoGuns: 3, minesPerDrop: 2, dronesFielded: 3, cargoBonus: 4, vacBonus: 30, defenseDrones: 0, droneSpeedPct: 0, droneCarryBonus: 0, escortWing: { skiff: 4, stinger: 2, lancer: 0 },
      },
      {
        // T5 CROWN — MOTHERSHIP (Adam, adopted 2026-10-21).
        name: 'MOTHERSHIP',
        turnFactor: 0.65,
        hullStepCap: 11,
        // PEAK: fuel (+3 over the T5 baseline).
        trackCaps: { thrust: 16, handling: 16, vac: 13, fuel: 16, cargo: 13 },
        hardPoints: 2, autoGuns: 4, minesPerDrop: 2, dronesFielded: 4, cargoBonus: 6, vacBonus: 40, defenseDrones: 0, droneSpeedPct: 0, droneCarryBonus: 0, escortWing: { skiff: 6, stinger: 3, lancer: 2 },
      },
    ],
  },
  cruiser: {
    stepPrices: [200, 600, 1800, 2600],
    types: [
      SKIFF,
      {
        name: 'CRUISER',
        turnFactor: 0.9,
        hullStepCap: 3,
        // Cruiser exception: handling -1 from T2 on (the biggest hulls
        // turn worst). No peak tracks — its peak is size/health.
        trackCaps: { thrust: 5, handling: 4, vac: 4, fuel: 4, cargo: 4 },
        hardPoints: 1, autoGuns: 1, minesPerDrop: 2, dronesFielded: 1, cargoBonus: 2, vacBonus: 0, defenseDrones: 0, droneSpeedPct: 0, droneCarryBonus: 0, escortWing: { skiff: 0, stinger: 0, lancer: 0 },
      },
      {
        // T3 VANGUARD — the interpolated rung (Adam, adopted
        // 2026-10-21): the ladder's NAMES moved up a tier; the
        // STATS stayed in their slots, so this slot keeps the old
        // T3 (Battlestar) numbers under the Vanguard name.
        name: 'VANGUARD',
        turnFactor: 0.87,
        hullStepCap: 6,
        // Handling -1; fuel +1 (T3/T4).
        trackCaps: { thrust: 8, handling: 7, vac: 6, fuel: 8, cargo: 6 },
        hardPoints: 1, autoGuns: 2, minesPerDrop: 2, dronesFielded: 2, cargoBonus: 4, vacBonus: 10, defenseDrones: 0, droneSpeedPct: 0, droneCarryBonus: 0, escortWing: { skiff: 0, stinger: 0, lancer: 0 },
      },
      {
        // T4 BATTLESTAR — the old T4 (Dreadnought) numbers under
        // the Battlestar name (see the Vanguard note above).
        name: 'BATTLESTAR',
        turnFactor: 0.84,
        hullStepCap: 10, // Max size 35.
        // Handling -1; fuel +1 (T3/T4).
        trackCaps: { thrust: 12, handling: 11, vac: 10, fuel: 11, cargo: 10 },
        hardPoints: 1, autoGuns: 4, minesPerDrop: 3, dronesFielded: 3, cargoBonus: 6, vacBonus: 20, defenseDrones: 0, droneSpeedPct: 0, droneCarryBonus: 0, escortWing: { skiff: 0, stinger: 0, lancer: 0 },
      },
      {
        // T5 CROWN — DREADNOUGHT (Adam, FINAL 2026-10-21: the name
        // belongs to the cruiser line; the biggest hull in the
        // game, past the Battlestar's 35: max size 41).
        name: 'DREADNOUGHT',
        turnFactor: 0.8,
        hullStepCap: 13,
        // Handling -1; fuel +1.
        trackCaps: { thrust: 16, handling: 15, vac: 13, fuel: 14, cargo: 13 },
        hardPoints: 1, autoGuns: 6, minesPerDrop: 3, dronesFielded: 4, cargoBonus: 8, vacBonus: 30, defenseDrones: 0, droneSpeedPct: 0, droneCarryBonus: 0, escortWing: { skiff: 0, stinger: 0, lancer: 0 },
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
 * T1 = 0 (no line to leave), T2 = 40, T3 = 120, T4 = 300,
 * T5 = 500 (DRAFT extension of the same curve).
 */
export const switchToll = (s: { lineSwitchesUsed: number; typeTier: TypeTier }): number => {
  if (s.lineSwitchesUsed <= 0) return 0;
  switch (s.typeTier) {
    case 2: return 40;
    case 3: return 120;
    case 4: return 300;
    case 5: return 500;
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

/**
 * Turret mounts (Arsenal slice 2, 2026-10-21 — Adam's universal
 * turret purchase): every type's autoGuns value is a CAP; a ship
 * buys mounts one at a time up to it and fires what it owns. The
 * price curve is DRAFT, drafted off the household ladders (hull
 * steps' base + step shape; DRONE_PRICE 75 as the neighborhood for
 * a permanent shipboard system): the NEXT mount when `owned` are
 * already fitted costs 50 + 25 x owned — mounts run 50 / 75 / 100 /
 * 125 / 150 / 175, so filling a Dreadnought's six caps costs 675
 * all-in. Named here so the pin pass sweeps it in one read.
 */
export const TURRET_MOUNT_PRICE_BASE = 50;
export const TURRET_MOUNT_PRICE_STEP = 25;
export const turretMountPriceFor = (owned: number): number =>
  TURRET_MOUNT_PRICE_BASE + TURRET_MOUNT_PRICE_STEP * Math.max(0, owned);

/** Turret mount cap for a ship's current line/tier. */
export const autoGunCapFor = (line: ShipLine | null, tier: TypeTier): number =>
  typeFor(line, tier).autoGuns;

/**
 * The guns that actually fire: min(cap, owned). Mounts persist
 * across type purchases and line switches (owned hardware rides
 * with the captain — the track-cap precedent); a hull whose cap is
 * lower than the owned count simply shelves the excess until a
 * deeper-cap hull carries it again. The loop's fire step and the
 * canvas's barrel tells both read THIS, never the raw fields.
 */
export const effectiveAutoGuns = (s: {
  line: ShipLine | null;
  typeTier: TypeTier;
  turretMounts: number;
}): number => Math.min(autoGunCapFor(s.line, s.typeTier), Math.max(0, s.turretMounts));

/** Extra hard-point mounts fire at this fraction of the weapon's damage. */
export const EXTRA_MOUNT_DAMAGE = 0.6;

/**
 * Shipboard auto-turret stats (DRAFT, numbers draft Table 2): the
 * purchased mounts of Arsenal slice 2, on any hull — they fire on
 * their own at the nearest hostile and never focus-fire the pilot's
 * target. Bolt speed mirrors the star turrets'.
 */
export const AUTO_GUN = {
  damage: 6,
  fireChance: 0.008, // per gun, per frame (~0.8%)
  range: 700,
  boltSpeed: 8,
  life: 110, // frames; range / boltSpeed ~= 88, plus slack
};

/**
 * Defense drones (Arsenal slice 3, 2026-10-21 — Adam's hauler
 * complement): a drone MODE, not a new entity — a defense drone
 * guards its owner's ship (or home star, shipless) from a station
 * off the anchor and fires light bolts at hostiles in range,
 * drones first. ALL VALUES DRAFT for the pin pass. The price is
 * derived per the costs rule: DRONE_PRICE (75) + 25, the mount
 * step's increment, for the gun fit.
 */
export const DEFENSE_DRONE_PRICE = 100;
export const DEFENSE_DRONE = {
  damage: 4,
  fireChance: 0.01, // per frame while a hostile is in range
  range: 320, // engagement range, measured from the drone
};

// ---------------------------------------------------------------------
// THE CARRIER WING (Arsenal slice 5b, 2026-10-21 — the program's
// summit, Adam's vision): the drone line's escorts are REAL little
// ships flown by the offense engine (slice 5a's acquisition + fire
// discipline, on a guard leash — see src/sim/escorts.ts). The wing
// grows by kind as the carrier climbs:
//   T2 SHEPHERD   1 Skiff
//   T3 WARDEN     2 Skiffs + 1 Stinger
//   T4 CARRIER    4 Skiffs + 2 Stingers
//   T5 MOTHERSHIP 6 Skiffs + 3 Stingers + 2 Lancers (an 11-ship wing)
// (the counts themselves live on the type defs' escortWing field).
// Each kind IS a hull from the tables — a Skiff escort flies the
// shared T1 def, a Stinger the fighter's T2, a Lancer the T3 — so
// hard points, turn factor and bolt strength all read the one
// table. Prices are DRAFT, off the program's ladders (a Skiff ≈ a
// drone's 75 + a gun fit; a Stinger ≈ the fighter's T2 step
// neighborhood; a Lancer ≈ a T3 step), for the numbers pass.
// ---------------------------------------------------------------------

/** The escort kinds, in build order (cheapest hull first). */
export type EscortKind = 'skiff' | 'stinger' | 'lancer';
export const ESCORT_KINDS: readonly EscortKind[] = ['skiff', 'stinger', 'lancer'];

export interface EscortKindDef {
  kind: EscortKind;
  /** Display name (the hull's own name from the tables). */
  label: string;
  /** The hull this escort flies: a line + tier read through typeFor. */
  line: ShipLine | null;
  typeTier: TypeTier;
  /** Build/rebuild price at the well (DRAFT). */
  price: number;
}

export const ESCORT_KIND_DEFS: Record<EscortKind, EscortKindDef> = {
  skiff:   { kind: 'skiff',   label: 'SKIFF',   line: null,      typeTier: 1, price: 100 },
  stinger: { kind: 'stinger', label: 'STINGER', line: 'fighter', typeTier: 2, price: 200 },
  lancer:  { kind: 'lancer',  label: 'LANCER',  line: 'fighter', typeTier: 3, price: 350 },
};

/** How many escorts of `kind` a ship of this line/tier may field. */
export const escortCapFor = (line: ShipLine | null, typeTier: TypeTier, kind: EscortKind): number =>
  typeFor(line, typeTier).escortWing[kind];

/** Total wing size a ship of this line/tier may field. */
export const escortWingSize = (line: ShipLine | null, typeTier: TypeTier): number => {
  const w = typeFor(line, typeTier).escortWing;
  return w.skiff + w.stinger + w.lancer;
};

/** Which kind a flying escort is, read back off its hull (the
 * inverse of ESCORT_KIND_DEFS — escorts carry no kind stamp). */
export const escortKindOf = (ship: { line: ShipLine | null; typeTier: TypeTier }): EscortKind | null => {
  for (const kind of ESCORT_KINDS) {
    const def = ESCORT_KIND_DEFS[kind];
    if (def.line === ship.line && def.typeTier === ship.typeTier) return kind;
  }
  return null;
};
