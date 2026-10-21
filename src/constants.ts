export const PHYSICS = {
  G: 2, 
  FRICTION: 0.96,
  THRUST_POWER: 0.3,
  ROTATION_SPEED: 0.025,
  SHIP_MASS: 4.0,
  MIN_DIST_STAR: 30,
  DELIVERY_RADIUS: 80,
  MAX_VELOCITY: 7.5,
  DUST_ATTRACT_FORCE: 0.1,
  ACTIVE_VAC_MULTIPLIER: 6.0,
  BASE_ATTRACT_RADIUS: 140,
  AUTO_COLLECT_RADIUS: 35,
  FRICTION_MAX: 0.90, 
  // STAR GROWTH (Adam's pin, 2026-10-20): milestone costs RISE — milestone
  // N costs BASE + STEP x (N-1): M1 100, M2 125, M3 150, M4 175 ...
  // (cumulative thresholds 100 / 225 / 375 / 550 / 750 ...). Each crossed
  // milestone compounds the star's mass x1.25 and size x1.15. The math
  // lives in src/starGrowth.ts — never re-derive it inline.
  STAR_GROWTH_BASE_COST: 100,
  STAR_GROWTH_COST_STEP: 25,
  STAR_GROWTH_MASS_MULT: 1.25,
  STAR_GROWTH_SIZE_MULT: 1.15,
  MASS_PER_CARGO: 0.35, 
  FUEL_CONSUMPTION: 0.08,
  FUEL_REGEN: 0.06,
  FUEL_AUTO_CONVERT_THRESHOLD: 10, 
  UPGRADE_COSTS: {
    THRUST: 15,
    HANDLING: 20,
    ATTRACTOR: 12,
    FUEL: 10,
    CARGO: 15,
  },
  CARGO: {
    BASE_CAPACITY: 12,
    UPGRADE_BONUS: 4,
    OVERLOAD_RATIO: 0.25,
    SLOWDOWN_PENALTY: 0.4, // Up to 40% slower at max overload
  },
  DRONES: {
    SPEED: 2.5,
    ROTATE_SPEED: 0.05,
    CAPACITY: 5,
    COLLECT_RADIUS: 40,
    DEPOSIT_RADIUS: 80,
  },
  DEFENSE: {
    /** Turret engagement range, from the star's center — DRAFT
     *  (Adam, 2026-10-21: "about screen's diagonal length"): a
     *  turret engages nothing the player can't just barely see.
     *  DERIVATION: the canvas is the full browser window and the
     *  camera is a pure translation (GameCanvas — no zoom, 1 world
     *  unit = 1 px), so the visible world rect IS the window.
     *  Anchored to the standard desktop view, 1920x1080: diagonal
     *  = sqrt(1920^2 + 1080^2) ~= 2203, rounded to 2200. Smaller
     *  windows (phones) see less than this — the anchor is the
     *  desktop, per the drafting brief. Sole consumer: the turret
     *  targeting gate in useGameLoop. */
    RANGE: 2200,
    FIRERATE_MIN: 120, // frames (dead constant — fire is a per-frame chance roll)
    BOLT_SPEED: 8,
    DAMAGE: 10,
  },
  /**
   * STAR DEFENSE LADDER (Phase 1c) — the electron shells from
   * src/starDefense.ts: an INNER shell of 2 turrets and an OUTER shell
   * of 8 around each star, grown by feeding milestones.
   *
   * RING RADIUS FORMULA (the canvas derives hub positions with this
   * same formula, so it is pinned here):
   *   ring radius = star.size + (shell === 'inner' ? 15 : 90)
   * The inner pad (15) is where the canvas has always drawn the starter
   * hub; the outer pad puts the second ring 75 units beyond the inner.
   *
   * TIER STATS (draft numbers from the design doc): a turret's bolt
   * damage = DEFENSE.DAMAGE + 2 x (tier - 1); its fire chance per frame
   * = 1% + 0.2pp x (tier - 1). Bolt speed and range never scale.
   *
   * HEAL (DRAFT, UNPINNED): integrity healed per scrap delivered =
   * min(0.005, 0.0005 x milestones) — 0 at M0, rising each milestone,
   * reaching the old enemy-only rate (0.005) at M10.
   */
  STAR_DEFENSE: {
    INNER_RING_PAD: 15,
    OUTER_RING_PAD: 90,
    TURRET_BASE_FIRE_CHANCE: 0.01,
    TURRET_FIRE_CHANCE_PER_TIER: 0.002,
    TURRET_DAMAGE_PER_TIER: 2,
    HEAL_PER_SCRAP_PER_MILESTONE: 0.0005,
    HEAL_PER_SCRAP_MAX: 0.005,
    /** Turret ORBIT (Adam, 2026-10-21 — "turrets must rotate
     *  around their star"): full-revolution period per shell,
     *  DRAFT. Both rings turn the same way (counterclockwise, the
     *  angle convention); the outer ring turns slower. A turret's
     *  angle at any moment is DERIVED from time (base + 2π x
     *  elapsed / period) and stamped into its record by the loop —
     *  no orbit state is kept or synced beyond the angle field the
     *  turret record already carries (src/starDefense.ts). */
    ORBIT_PERIOD_INNER_MS: 120000,
    ORBIT_PERIOD_OUTER_MS: 240000,
    /** Turret FIRING ARC — PINNED (Adam, 2026-10-21): a turret
     *  engages only targets within ±45° of its radial line (star
     *  center through the turret's current position) — a 90°
     *  sector per turret. His logic: coverage comes from the
     *  ladder's turret COUNT as stars grow (a full outer ring of 8
     *  tiles the circle), not from per-turret width; the drafted
     *  ±85° was "kinda too wide." Outside its arc a turret holds
     *  fire. */
    TURRET_ARC_HALF_RAD: Math.PI / 4,
  },
  /**
   * CME (Slice 7) — a star's periodic coronal mass ejection.
   * Settled shape (Adam): fires ~every 30 s per star, stronger each
   * milestone; directed at the nearest hostile by default, with a
   * 10% x M chance (cap 90%) of going all-directional instead; and it
   * DISSIPATES over distance (also Adam) — a traveling wave at finite
   * SPEED whose damage/knockback fade to zero at its max range, so a
   * fast ship can outrun one and a distant ship barely feels it.
   * All numbers here are draft tuning.
   */
  CME: {
    INTERVAL_MS: 30000,
    JITTER_MS: 5000,
    CHARGE_MS: 1200,      // telegraph: the star glows and locks its aim
    SPEED: 6,             // units/frame — drones (2.5) can't outrun it; a thrusting ship can
    BASE_RANGE: 900,
    RANGE_PER_M: 150,
    BASE_DAMAGE: 14,
    DAMAGE_PER_M: 6,
    BASE_KNOCKBACK: 9,
    KNOCKBACK_PER_M: 2,
    CONE_RAD: 0.6,        // directed half-angle, ~34 degrees
    BAND: 26,             // wavefront thickness for hit tests
  },
  /**
   * WORLD WRAP (Adam's ruling, 2026-10-20): the map is a circle of this
   * radius around the two stars' midpoint. There is no wall — a ship
   * crossing the edge point-reflects through the center and re-enters
   * from the opposite side, velocity and heading untouched. Radius
   * floor matters: the stars sit ~1,581 from the midpoint, so entry is
   * never closer than ~1,419 to the far star — outside turret range
   * (1,200), star proximity burn, and the bank well. Don't shrink this
   * below ~2,800 without re-checking that ambush margin.
   */
  WORLD: {
    WRAP_RADIUS: 3000,
  }
};

export const COLORS = {
  CRT_GLOW: '#33ff33',
  CRT_BG: '#050505',
  STAR_CORE: '#ffffff',
  STAR_NOISE: '#ea580c',
  SHIP_SCRATCH: '#555555',
  SCRAP: ['#f472b6', '#22d3ee', '#fbbf24', '#ffffff'],
};
