/**
 * Team hostility (Phase 2, TEAMS — Adam, 2026-10-21).
 *
 * Hostility in the sim is keyed on TEAM, not ownership: two seats
 * are hostile exactly when their teamIds differ. Adam's pins:
 * "No friendly fire" (same-team entities never damage or target
 * each other) and "The team works together to build the star"
 * (cross-feeding/banking at any same-team star).
 *
 * Every hostility decision in the sim routes through
 * `areHostile` / `isHostileTo` below — one helper, so a future
 * ruling flips behavior in one place. The regression law of the
 * slice: every seat's default team is its own color-team, so with
 * no lobby picks made, teamOf(a) !== teamOf(b) reduces EXACTLY to
 * a !== b for distinct seats — the pre-teams ownerId rule.
 *
 * Reads accept anything carrying the seat records (an array of
 * { ownerId, teamId }) so sim steps that already hold seats — or a
 * bare pair of teamIds — share the one definition.
 */

import type { TeamId } from '../net/protocol';
import { defaultTeamForSeatIndex } from '../net/protocol';
import { seatIndexForOwnerId } from './ownership';

/** Minimal seat shape the team reads need. */
export interface TeamSeatLike {
  ownerId: string;
  teamId: TeamId;
}

/**
 * The team of an ownerId within a seat set. Falls back to the
 * seat-index default team when the ownerId is well-formed but the
 * seat is absent (defensive — every live ownerId has a seat), and
 * to null when the ownerId names no seat at all.
 */
export const teamIdOf = (
  seats: readonly TeamSeatLike[],
  ownerId: string,
): TeamId | null => {
  const seat = seats.find(s => s.ownerId === ownerId);
  if (seat) return seat.teamId;
  const idx = seatIndexForOwnerId(ownerId);
  return idx === null ? null : defaultTeamForSeatIndex(idx);
};

/** Two raw teamIds are hostile when both are known and different. */
export const teamsAreHostile = (
  a: TeamId | null | undefined,
  b: TeamId | null | undefined,
): boolean => a != null && b != null && a !== b;

/**
 * THE hostility predicate: seat/entity `aOwnerId` is hostile to
 * `bOwnerId` within this seat set. Equal ownerIds are never hostile
 * (the pre-teams rule's `!==` guard), and an ownerId that resolves
 * to no team is hostile to nothing new — callers that previously
 * treated "not mine" as hostile for seatless ids keep today's
 * behavior only where their site explicitly handled it.
 */
export const areHostile = (
  seats: readonly TeamSeatLike[],
  aOwnerId: string,
  bOwnerId: string,
): boolean => {
  if (aOwnerId === bOwnerId) return false;
  return teamsAreHostile(teamIdOf(seats, aOwnerId), teamIdOf(seats, bOwnerId));
};

/** Same-team test (the cross-feed/bank gate): distinct ownerIds,
 *  one known team. */
export const areTeammates = (
  seats: readonly TeamSeatLike[],
  aOwnerId: string,
  bOwnerId: string,
): boolean => {
  if (aOwnerId === bOwnerId) return false;
  const a = teamIdOf(seats, aOwnerId);
  return a !== null && a === teamIdOf(seats, bOwnerId);
};
