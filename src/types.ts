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
}

export interface GameState {
  ship: Ship;
  star: Star;
  enemyStar: Star;
  scrap: Scrap[];
  deployedCargo: DeployedCargo[];
  projectiles: Projectile[];
  drones: Harvester[];
  starOrbit: number;
  enemyStarOrbit: number;
  teamScrap: number;
  isShopOpen: boolean;
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
