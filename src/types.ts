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

export interface GameState {
  ship: Ship;
  star: Star;
  enemyStar: Star;
  scrap: Scrap[];
  deployedCargo: DeployedCargo[];
  projectiles: Projectile[];
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
