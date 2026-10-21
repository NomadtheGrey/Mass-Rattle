/**
 * Host-side standings (Phase 2).
 *
 * Standings are computed by the HOST sim — the authority — and relayed
 * to clients, who never reconstruct them (frozen contract). The output
 * rows are exactly protocol.ts's `Standing` shape; this module does not
 * redefine it.
 *
 * Sources, from today's state: fedTotal is the star's
 * totalScrapInfused; mass and integrity ride straight from the star;
 * stage + progressWithinStage derive from fedTotal via
 * src/sim/starStages.ts (which bands milestones from starGrowth.ts).
 * Alive/eliminated and eliminationOrder are INPUTS — the per-seat sim
 * that tracks star deaths lands in P2-2b; today's GameState has no
 * per-seat elimination record and no per-seat kill count, so `kills`
 * is an input that defaults to 0 (FLAGGED in the P2-2a report).
 *
 * Placement law (contract): while a match is live, placement is null.
 * When the caller supplies the end condition (and the winner, for a
 * critical-mass end), final placements are assigned to ALL seats,
 * eliminated included: winner 1st; surviving non-winners next, by fed
 * total; eliminated seats after them, latest elimination placing best
 * (eliminationOrder descending), fed total breaking any gaps.
 */

import type { MatchEndReason, Standing, TeamId } from '../net/protocol';
import { ownerIdForSeat, starIdForSeat } from './ownership';
import { stageStateForInfused } from './starStages';

export interface SeatStandingInput {
  starIndex: number;
  /** The seat's team (TEAMS): carried onto the row when given. */
  teamId?: TeamId;
  /** Defaults to the seat-scoped `seat-<starIndex>`. */
  ownerId?: string;
  /** Defaults to `star-<starIndex>`. */
  starId?: string;
  /** The star's totalScrapInfused — the standings' fedTotal source. */
  totalScrapInfused: number;
  mass: number;
  integrity: number;
  /** Defaults from `eliminated`, else from integrity > 0. */
  alive?: boolean;
  /** Defaults to the negation of `alive`. */
  eliminated?: boolean;
  /** 1 = first star eliminated this match; null while standing. */
  eliminationOrder?: number | null;
  /** Defaults to 0 — no kill tracking exists in state yet (P2-2b). */
  kills?: number;
}

export interface StandingsEndCondition {
  endReason: MatchEndReason;
  /** The winning seat's ownerId. Required to place a critical-mass
   *  end; a last-survivor end can derive it from the sole alive seat. */
  winnerOwnerId?: string;
}

interface StandingRow extends Standing {
  starIndex: number;
}

const byFinalRank = (a: StandingRow, b: StandingRow): number => {
  // Survivors place ahead of eliminated seats.
  if (a.alive !== b.alive) return a.alive ? -1 : 1;
  if (a.alive && b.alive) {
    // Among survivors (a critical-mass end leaves rivals standing):
    // the fuller star places better.
    return b.fedTotal - a.fedTotal || a.starIndex - b.starIndex;
  }
  // Among eliminated seats, the LAST eliminated places best.
  const aOrder = a.eliminationOrder;
  const bOrder = b.eliminationOrder;
  if (aOrder != null && bOrder != null) return bOrder - aOrder;
  if (aOrder != null) return -1;
  if (bOrder != null) return 1;
  return b.fedTotal - a.fedTotal || a.starIndex - b.starIndex;
};

export const computeStandings = (
  seats: SeatStandingInput[],
  end?: StandingsEndCondition,
): Standing[] => {
  const rows: StandingRow[] = seats.map(input => {
    const alive =
      input.alive ?? (input.eliminated ? false : input.integrity > 0);
    const eliminated = input.eliminated ?? !alive;
    const stageState = stageStateForInfused(input.totalScrapInfused);
    return {
      starIndex: input.starIndex,
      ownerId: input.ownerId ?? ownerIdForSeat(input.starIndex),
      starId: input.starId ?? starIdForSeat(input.starIndex),
      teamId: input.teamId,
      placement: null,
      stage: stageState.stage,
      progressWithinStage: stageState.progressWithinStage,
      fedTotal: input.totalScrapInfused,
      mass: input.mass,
      integrity: input.integrity,
      alive,
      eliminated,
      eliminationOrder: input.eliminationOrder ?? null,
      kills: input.kills ?? 0,
    };
  });

  const winner = end
    ? end.winnerOwnerId != null
      ? rows.find(row => row.ownerId === end.winnerOwnerId)
      : end.endReason === 'last_survivor'
        ? rows.filter(row => row.alive).length === 1
          ? rows.find(row => row.alive)
          : undefined
        : // Critical mass without a named winner: only an unambiguous
          // black-hole seat can be derived; anything else stays live.
          (() => {
            const blackHoles = rows.filter(
              row => row.stage === 'black_hole',
            );
            if (blackHoles.length === 1) return blackHoles[0];
            if (blackHoles.length > 1) {
              return [...blackHoles].sort(byFinalRank)[0];
            }
            return undefined;
          })()
    : undefined;

  if (winner) {
    winner.placement = 1;
    rows
      .filter(row => row !== winner)
      .sort(byFinalRank)
      .forEach((row, index) => {
        row.placement = index + 2;
      });
  }

  // Rows go out in seat order; placement carries the ranking.
  return rows
    .sort((a, b) => a.starIndex - b.starIndex)
    .map(({ starIndex: _starIndex, ...standing }) => standing);
};
