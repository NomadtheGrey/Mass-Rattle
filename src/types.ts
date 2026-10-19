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
}

export interface Projectile {
  id: string;
  pos: Vector2D;
  vel: Vector2D;
  owner: 'player' | 'enemy';
  life: number;
  /**
   * Ship-weapon fields (Slice 4). Turret bolts leave these undefined and
   * fall back to PHYSICS.DEFENSE.DAMAGE, so old behavior is preserved
   * wherever a field is absent.
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

export interface Star extends GameObject {
  mass: number;
  totalScrapInfused: number;
  type: 'home' | 'enemy';
  integrity: number; // 0 to 1
  lastHitTime?: number;
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
