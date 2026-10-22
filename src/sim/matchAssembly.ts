/**
 * N-seat match assembly (Phase 2, P2-3a) — pure.
 *
 * Builds the complete initial GameState for a MULTIPLAYER match on
 * the host from a room's shape (seed + starCount + the seats'
 * ownerIds/controllers). Single-player never calls this: SP keeps
 * its shipped init in the game loop, untouched — this module mirrors
 * SP's init conventions per seat instead:
 *
 * - Stars come from createMatchLayout(seed, starCount), positions
 *   used as-is (arena-center-relative; the arena center is (0, 0) in
 *   a host sim state, where SP translates by its viewport center).
 *   Each star is built with the shipped seat-star factory values
 *   (SP's home star: size 40, mass 400, integrity 1, no infusion,
 *   the milestone-0 turret ladder). `Star.type` is the legacy
 *   local-view label — seat 0 is 'home', every other seat 'enemy',
 *   exactly how the top-level view reads them; ownerId is the truth.
 * - EVERY seat gets a starter ship (createStarterShip with the
 *   starter Bolt Cannon armed) — MP seats fly, including bot seats.
 *   That is the deliberate difference from SP's shipless enemy seat.
 * - Ships and each seat's one initial drone spawn off their star by
 *   SP's convention (its drone offsets: 100 per axis toward the
 *   arena center), which also keeps them outside the star's disc.
 * - `scrap` starts EMPTY: SP seeds its field scrap in an init
 *   effect (Math.random veins around the viewport), not in the
 *   initial state — assembly mirrors the state shape and leaves
 *   field seeding to the host client's match-start effect, whose
 *   first snapshot carries the field to everyone.
 *
 * Everything here is plain serializable data, ready to snapshot.
 */

import { PHYSICS } from '../constants';
import { turretsForMilestones } from '../starDefense';
import type { TeamId } from '../net/protocol';
import type { GameState, Harvester, Star } from '../types';
import { createMatchLayout } from './matchInit';
import type { MatchStarCount } from './matchInit';
import { ownerIdForSeat } from './ownership';
import { createSeatSimState, createStarterShip } from './seatState';

export interface MatchSeatConfig {
  ownerId: string;
  controller: 'human' | 'bot';
  /** The seat's team from the room (TEAMS): the lobby pick as
   *  resolved by the DO at match start. Absent = the seat's
   *  default color-team (the factory's value stands). */
  teamId?: TeamId;
}

export interface CreateMatchConfig {
  seed: number;
  starCount: MatchStarCount;
  /** One entry per seat, in starIndex order. Missing entries are
   *  filled with bot seats (ownerIdForSeat of their index). */
  seats: MatchSeatConfig[];
}

/** Per-axis spawn offset toward the arena center (SP's drone-spawn
 *  convention: its two drones sit 100 per axis inward of their star). */
const spawnOffsetTowardCenter = (pos: { x: number; y: number }) => ({
  x: pos.x - Math.sign(pos.x) * 100,
  y: pos.y - Math.sign(pos.y) * 100,
});

/**
 * Where a seat's SHIP spawns at its star: the convention above (100
 * per axis toward the arena center), with a clearance guarantee —
 * a star GROWS as it is fed (×1.15 per milestone), so late in a
 * match the raw convention point can land inside the star's disc;
 * the spawn is then pushed out along the same toward-center
 * direction until it clears the star's radius + the starter hull
 * (size 15, createStarterShip) + a margin. At assembly every star
 * is size 40, the clearance never binds, and the position is
 * exactly the convention point — assembly output is unchanged.
 * The death economy's repurchase (src/sim/deathEconomy.ts) spawns
 * through this same function, so a bought-back ship appears where
 * a match-start ship would, never inside its own star.
 */
export const shipSpawnPosition = (star: Star): { x: number; y: number } => {
  const raw = spawnOffsetTowardCenter(star.pos);
  const clearance = star.size + 15 + 10;
  const dx = raw.x - star.pos.x;
  const dy = raw.y - star.pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist >= clearance) return raw;
  if (dist === 0) return { x: star.pos.x + clearance, y: star.pos.y };
  const scale = clearance / dist;
  return { x: star.pos.x + dx * scale, y: star.pos.y + dy * scale };
};

const createSeatStar = (
  ownerId: string,
  starIndex: number,
  pos: { x: number; y: number },
): Star => ({
  pos: { ...pos },
  vel: { x: 0, y: 0 },
  size: 40,
  baseSize: 40,
  mass: 400,
  totalScrapInfused: 0,
  type: starIndex === 0 ? 'home' : 'enemy',
  ownerId,
  integrity: 1,
  turrets: turretsForMilestones(0),
});

const createSeatDrone = (star: Star, starIndex: number): Harvester => ({
  id: `${star.ownerId}-drone-1`,
  health: 100,
  pos: spawnOffsetTowardCenter(star.pos),
  vel: { x: 0, y: 0 },
  angle: 0,
  targetId: null,
  carrying: 0,
  capacity: PHYSICS.DRONES.CAPACITY,
  owner: starIndex === 0 ? 'player' : 'enemy',
  ownerId: star.ownerId,
  state: 'searching',
  // The birth drone is the STAR FLEET's seed (2026-10-22): the
  // fleet grows from this one as the star evolves (src/starFleet.ts).
  starFleet: true,
});

export const createMatch = (config: CreateMatchConfig): GameState => {
  const layout = createMatchLayout(config.seed, config.starCount);

  const seats = layout.stars.map((layoutStar, starIndex) => {
    const seatConfig: MatchSeatConfig = config.seats[starIndex] ?? {
      ownerId: ownerIdForSeat(starIndex),
      controller: 'bot',
    };
    const star = createSeatStar(
      seatConfig.ownerId,
      starIndex,
      layoutStar.pos,
    );
    const ship = createStarterShip(seatConfig.ownerId, shipSpawnPosition(star), {
      withStarterWeapon: true,
    });
    const seat = createSeatSimState(star, starIndex, seatConfig.controller, ship);
    // TEAMS: the room's resolved team rides the seat record (the
    // factory's default color-team stands when none is given).
    if (seatConfig.teamId) seat.teamId = seatConfig.teamId;
    return seat;
  });

  const drones = seats.map((seat) => createSeatDrone(seat.star, seat.starIndex));

  return {
    // Top-level fields remain the local (host, seat 0) view — the
    // SAME objects as seats[0]'s, exactly the SP projection law.
    ship: seats[0].ship!,
    star: seats[0].star,
    enemyStar: seats[1].star,
    seats,
    standings: [],
    eventFeed: [],
    matchEnd: null,
    scrap: [],
    deployedCargo: [],
    projectiles: [],
    mines: [],
    decoy: null,
    cmes: [],
    drones,
    escorts: [],
    starOrbit: 0,
    enemyStarOrbit: 0,
    teamScrap: 0,
    bankedScrap: 0,
    isShopOpen: false,
    lastUpgradeTime: 0,
    glitchActive: false,
    lastGlitchTime: 0,
    shakeAmount: 0,
    isVictory: false,
    isGameOver: false,
    useAnalogGauges: true,
    slip: 0,
  };
};
