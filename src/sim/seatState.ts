/**
 * Per-seat sim state (Phase 2, P2-2b): factories + the frame-end
 * tracking advance.
 *
 * The generalized sim keeps one SeatSimState per seat next to the
 * GameState top-level fields, which remain the local seat's view
 * (seats[0].ship IS state.ship, seats[0].star IS state.star — same
 * objects). Single-player is the 2-seat degenerate case: seat 0 is
 * the human's, seat 1 is a bot seat whose ship is null, exactly the
 * shipped home/enemy game.
 */

import { PHYSICS } from '../constants';
import { defaultTeamForSeatIndex } from '../net/protocol';
import type { SeatSimState, Ship, Star, MatchEndState } from '../types';
import type { EventFeedEntry } from './eventFeed';
import { stageStateForInfused } from './starStages';
import { starIdForSeat } from './ownership';

/**
 * A fresh starter ship (the SKIFF frame every seat begins a match
 * with). The default shape reproduces the shipped SP initial ship
 * FIELD FOR FIELD — the game loop builds the player's ship through
 * this factory, so any drift here would change the shipped game.
 *
 * Bot seats (and future multiplayer humans) fly with a starter Bolt
 * Cannon equipped: `withStarterWeapon` arms loadout + arsenal with
 * the tier-1 cannon a player would own after their first purchase.
 */
export const createStarterShip = (
  ownerId: string,
  pos: { x: number; y: number },
  opts?: { withStarterWeapon?: boolean },
): Ship => ({
  pos: { ...pos },
  vel: { x: 0, y: 0 },
  size: 15,
  angle: 0,
  rotationVel: 0,
  thrust: false,
  carrying: 0,
  fuel: 100,
  maxFuel: 100,
  health: 100,
  maxHealth: 100,
  attractRadius: PHYSICS.BASE_ATTRACT_RADIUS,
  ownerId,
  arsenal: opts?.withStarterWeapon ? { bolt_cannon: 1 } : {},
  loadout: {
    weapon: opts?.withStarterWeapon ? 'bolt_cannon' : null,
    defense: null,
    hybrid: null,
  },
  upgrades: {
    thrust: 0,
    handling: 0,
    attractor: 0,
    fuelCap: 0,
    cargo: 0,
  },
  line: null,
  typeTier: 1,
  hullSteps: 0,
  lineSwitchesUsed: 0,
  turretMounts: 0,
});

/** A seat record around an existing star (+ ship, for seats that fly). */
export const createSeatSimState = (
  star: Star,
  starIndex: number,
  controller: 'human' | 'bot',
  ship: Ship | null,
): SeatSimState => ({
  ownerId: star.ownerId,
  starIndex,
  // TEAMS: the seat's own color-team by default (SP seats: 0 blue,
  // 1 red — a 1v1 of solo teams, behavior identical to pre-teams).
  // Match assembly overwrites with the room's resolved team.
  teamId: defaultTeamForSeatIndex(starIndex),
  controller,
  ship,
  star,
  bankedScrap: 0,
  deliveryMode: 'feed',
  fedTotal: star.totalScrapInfused,
  kills: 0,
  deaths: 0,
  survivalMs: 0,
  eliminated: false,
  eliminationOrder: null,
});

export interface SeatTrackingResult {
  /** Feed entries produced this frame (milestones, stage changes,
   * eliminations), in seat order. */
  entries: EventFeedEntry[];
  /** The match end after this frame: the previous one if already
   * decided, else a newly derived one, else null. */
  matchEnd: MatchEndState | null;
}

/**
 * Frame-end seat tracking (pure, apart from stamping the frame's seat
 * copies): refresh each seat's fedTotal mirror, emit feed entries for
 * milestone crossings / stage changes / star eliminations (setting
 * eliminated + eliminationOrder on the seat copy), and derive the
 * match end — critical mass (a star reaches BLACK HOLE, M15) first,
 * then last-survivor BY TEAM (TEAMS): the match ends when at most
 * one TEAM still has a non-eliminated seat, after at least one
 * elimination; the winner is the surviving seat of that team with
 * the highest fedTotal. With every seat on its own default team
 * this reduces exactly to the pre-teams derivation (the sole
 * standing seat wins). An already-decided match end is never
 * overwritten.
 * A critical-mass derivation also stamps the collapse-cinematic
 * bookkeeping (P2-4) onto the record — inputLockout, the collapsing
 * (winning) star's id, and the cinematic start on the ms-epoch clock
 * (`nowEpochMs`, injectable for tests; wall clock by default) — so
 * the host's matchEnded announce reads them from state verbatim.
 *
 * A seat is eliminated when its STAR's integrity reaches 0 (Adam's
 * ruling: ship death is not elimination).
 */
export const advanceSeatTracking = (
  prevSeats: SeatSimState[],
  seats: SeatSimState[],
  prevMatchEnd: MatchEndState | null,
  at?: number,
  nowEpochMs?: number,
): SeatTrackingResult => {
  const entries: EventFeedEntry[] = [];
  const prevByOwnerId = new Map(prevSeats.map(s => [s.ownerId, s]));
  let eliminationCount = seats.filter(s => s.eliminated).length;

  for (const seat of seats) {
    seat.fedTotal = seat.star.totalScrapInfused;
    const starId = starIdForSeat(seat.starIndex);
    const prev = prevByOwnerId.get(seat.ownerId);
    const prevStage = stageStateForInfused(
      prev ? prev.star.totalScrapInfused : 0,
    );
    const nowStage = stageStateForInfused(seat.star.totalScrapInfused);

    if (nowStage.milestone > prevStage.milestone) {
      entries.push({
        type: 'feed_milestone',
        ownerId: seat.ownerId,
        starId,
        milestone: nowStage.milestone,
        fedTotal: seat.star.totalScrapInfused,
        at,
      });
    }
    if (nowStage.stage !== prevStage.stage) {
      entries.push({
        type: 'stage_change',
        ownerId: seat.ownerId,
        starId,
        fromStage: prevStage.stage,
        toStage: nowStage.stage,
        milestone: nowStage.milestone,
        progressWithinStage: nowStage.progressWithinStage,
        at,
      });
    }
    if (!seat.eliminated && seat.star.integrity <= 0) {
      seat.eliminated = true;
      seat.eliminationOrder = ++eliminationCount;
      entries.push({
        type: 'elimination',
        ownerId: seat.ownerId,
        starId,
        eliminationOrder: seat.eliminationOrder,
        at,
      });
    }
  }

  let matchEnd = prevMatchEnd;
  if (!matchEnd) {
    const blackHoleSeat = seats.find(
      s => stageStateForInfused(s.star.totalScrapInfused).stage === 'black_hole',
    );
    if (blackHoleSeat) {
      matchEnd = {
        endReason: 'critical_mass',
        winnerOwnerId: blackHoleSeat.ownerId,
        // Collapse cinematic (P2-4): inputs lock, the collapsing
        // star is the winner's, and the cinematic clock starts now
        // (ms epoch — the protocol's shared freeze clock).
        inputLockout: true,
        collapsingStarId: starIdForSeat(blackHoleSeat.starIndex),
        cinematicStartedAt: nowEpochMs ?? Date.now(),
      };
    } else {
      // LAST SURVIVOR, BY TEAM (TEAMS): eliminations stay per-seat,
      // but the match ends when at most one TEAM is still standing.
      // The winner seat is deterministic: the standing seat of the
      // winning team with the highest fedTotal (seat order breaks
      // ties — filter/sort are stable). Critical mass above is
      // unchanged: the collapsing seat wins, and through it its
      // team. All-default teams (each seat solo) make the standing
      // teams set a singleton exactly when one seat stands — the
      // pre-teams rule, bit for bit.
      const standing = seats.filter(s => !s.eliminated);
      const standingTeams = new Set(standing.map(s => s.teamId));
      if (eliminationCount >= 1 && standing.length >= 1 && standingTeams.size === 1) {
        const winner = standing.reduce((best, s) =>
          s.fedTotal > best.fedTotal ? s : best,
        );
        matchEnd = {
          endReason: 'last_survivor',
          winnerOwnerId: winner.ownerId,
          inputLockout: false,
        };
      }
    }
  }

  return { entries, matchEnd };
};
