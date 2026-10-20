import type { ShipLine, TypeTier } from './shipProgression';

export interface Vector2D {
  x: number;
  y: number;
}

export interface GameObject {
  pos: Vector2D;
  vel: Vector2D;
  size: number;
}

export interface Ship extends GameObject {
  angle: number;
  rotationVel: number;
  thrust: boolean;
  carrying: number;
  fuel: number;
  maxFuel: number;
  health: number;
  maxHealth: number;
  attractRadius: number;
  /** performance.now() timestamp before which the equipped weapon cannot fire again. */
  fireReadyAt?: number;
  /** Deflector Shield: current pool and the last time it took a hit (loop clock). */
  shield?: number;
  shieldHitAt?: number;
  /** Point-Defense Zap: next-ready time and the last zap's target (for the canvas arc). */
  pdReadyAt?: number;
  pdZapAt?: number;
  pdZapTarget?: Vector2D;
  /** Scrap Aegis: leftover damage-soak credit from the last burned scrap,
   * so fractional damage (star burn) burns cargo at the table's rate
   * instead of a whole scrap per frame. Loop-managed. */
  aegisCredit?: number;
  // Arsenal (see src/loadout.ts): item id -> owned tier (0/absent = not owned),
  // and the one equipped item id per category (null = slot empty).
  arsenal: Record<string, number>;
  loadout: { weapon: string | null; defense: string | null; hybrid: string | null };
  upgrades: {
    thrust: number;
    handling: number;
    attractor: number;
    fuelCap: number;
    cargo: number;
  };
  // Ship progression (Phase 3, src/shipProgression.ts — DRAFT numbers).
  // Per-match state only, like everything else on the ship.
  /** The ship's line; null at spawn (unaligned SKIFF). The T2 purchase
   * chooses it; switchLine moves a T2+ ship sideways for a toll. */
  line: ShipLine | null;
  /** Type tier within the line, 1..4 (T1 is the SKIFF for every line). */
  typeTier: TypeTier;
  /** Hull steps grown inside the current progression: size is
   * 15 + 2 x hullSteps, each step also +10 max health. Steps PERSIST
   * across type-ups and line switches; the current line/type's
   * hullStepCap only gates buying MORE steps. */
  hullSteps: number;
  /** Lifetime line switches this match (the first switch is free). */
  lineSwitchesUsed: number;
}

export interface Projectile {
  id: string;
  pos: Vector2D;
  vel: Vector2D;
  owner: 'player' | 'enemy';
  life: number;
  /**
   * Ship-weapon fields (Slice 4). Where a field is absent, readers fall
   * back to PHYSICS.DEFENSE.DAMAGE, so old behavior is preserved.
   * Star turret bolts (Phase 1c) set `damage` (tier-scaled, from
   * starDefense.ts) but leave `kind` undefined — the drone-collision
   * gate keys on `kind`, which is how turret bolts keep their historic
   * pass-through behavior against drones while ship weapons connect.
   */
  damage?: number;
  /** Weapon id that fired this (drives special effects, e.g. ion stun). */
  kind?: string;
  /** Rail Lance: pass through targets instead of dying on the first hit. */
  pierce?: boolean;
  /** Drone/star ids this piercing projectile has already hit. */
  hitIds?: string[];
  /** Drawn head size on the canvas. */
  size?: number;
}

/** A proximity mine laid by the Mine Layer weapon (Slice 4). */
export interface Mine {
  id: string;
  pos: Vector2D;
  /** Hull damage dealt to everything hostile inside `radius`. */
  damage: number;
  radius: number;
}

/**
 * One turret on a star's defense ladder (Phase 1c, src/starDefense.ts).
 * The canvas draws hubs from this list verbatim. `angle` is the
 * turret's fixed position on its shell ring around the star, in
 * radians, ABSOLUTE (no starOrbit rotation baked in); the ring radius
 * derives from the star's size — see PHYSICS.STAR_DEFENSE.
 */
export interface StarTurret {
  shell: 'inner' | 'outer';
  angle: number;
  tier: number;
}

export interface Star extends GameObject {
  mass: number;
  totalScrapInfused: number;
  type: 'home' | 'enemy';
  integrity: number; // 0 to 1
  /**
   * The star's defense-ladder turrets. A deterministic function of the
   * star's milestone count (turretsForMilestones in starDefense.ts) —
   * the game loop reconciles this list to that function every frame,
   * so it is never edited by hand and needs no save/sync bookkeeping.
   */
  turrets: StarTurret[];
  lastHitTime?: number;
  /** CME timers (Slice 7), on the game loop's clock: next scheduled fire,
   * the end of the current charge telegraph, and the locked aim angle. */
  cmeNextAt?: number;
  cmeChargeEndsAt?: number;
  cmeAimAngle?: number;
}

/**
 * A CME wavefront in flight (Slice 7). It expands from its star at a
 * fixed speed and DISSIPATES: damage and knockback scale with
 * (1 - radius / maxRange), so distance — or outrunning it — is defense.
 * dirAngle null = all-directional (radial) expansion.
 */
export interface CmeWave {
  id: string;
  owner: 'home' | 'enemy';
  pos: Vector2D;
  dirAngle: number | null;
  radius: number;
  speed: number;
  maxRange: number;
  baseDamage: number;
  baseKnockback: number;
  milestone: number;
  /** Ids already struck by this wave ('ship', 'decoy', or drone ids). */
  hitIds: string[];
}

export interface Scrap {
  pos: Vector2D;
  color: string;
  id: string;
}

export interface DeployedCargo extends Scrap {
  vel: Vector2D;
  life: number;
}

export interface Harvester {
  id: string;
  // Drones gain health with the Arsenal slices: ship weapons need something
  // to damage. 100 = a fresh drone; destroyed drones drop their cargo as scrap.
  health: number;
  pos: Vector2D;
  vel: Vector2D;
  angle: number;
  targetId: string | null;
  carrying: number;
  capacity: number;
  owner: 'player' | 'enemy';
  state: 'searching' | 'collecting' | 'returning';
  /** Ion Blaster effect: frames remaining where this drone is rebooting (no movement). */
  stunFrames?: number;
}

export interface GameState {
  ship: Ship;
  star: Star;
  enemyStar: Star;
  scrap: Scrap[];
  deployedCargo: DeployedCargo[];
  projectiles: Projectile[];
  /** Proximity mines laid by the player (Mine Layer weapon). */
  mines: Mine[];
  /** Active Decoy Beacon, if one is deployed (Decoy Beacon defense). */
  decoy: { pos: Vector2D; health: number; lifeFrames: number } | null;
  /** CME wavefronts currently in flight from either star (Slice 7). */
  cmes: CmeWave[];
  drones: Harvester[];
  starOrbit: number;
  enemyStarOrbit: number;
  teamScrap: number;
  // THE BANK (Adam, 2026-10-19): scrap saved up OUTSIDE the cargo hold.
  // Banked scrap is NOT auto-fed to the home star on delivery flybys and
  // does not count toward feeding milestones until it is withdrawn into
  // the hold and actually delivered. Shop purchases draw on a combined
  // wallet: hold first, then bank (see useGameLoop walletPay).
  bankedScrap: number;
  isShopOpen: boolean;
  /** Set when a shop-open attempt is refused (outside the star's well);
   * the HUD shows a "return to your star" hint briefly after this time. */
  shopRefusedAt?: number;
  lastUpgradeTime: number;
  glitchActive: boolean;
  lastGlitchTime: number;
  shakeAmount: number;
  isVictory: boolean;
  isGameOver: boolean;
  useAnalogGauges: boolean;
  lastEjectTime?: number;
  slip: number;
}
