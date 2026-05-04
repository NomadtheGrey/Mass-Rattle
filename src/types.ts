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
  attractRadius: number;
  upgrades: {
    thrust: number;
    handling: number;
    attractor: number;
    fuelCap: number;
  };
}

export interface Star extends GameObject {
  mass: number;
  totalScrapInfused: number;
  type: 'home' | 'enemy';
}

export interface Scrap {
  pos: Vector2D;
  color: string;
  id: string;
}

export interface GameState {
  ship: Ship;
  star: Star;
  enemyStar: Star;
  scrap: Scrap[];
  teamScrap: number;
  glitchActive: boolean;
  lastGlitchTime: number;
  shakeAmount: number;
  useAnalogGauges: boolean;
}
