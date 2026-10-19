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
  STAR_GROWTH_THRESHOLD: 100,
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
    RANGE: 1200,
    FIRERATE_MIN: 120, // frames
    BOLT_SPEED: 8,
    DAMAGE: 10,
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
