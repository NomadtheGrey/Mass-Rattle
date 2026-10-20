/**
 * Seat-scoped ownership helpers (Phase 2).
 *
 * Owner IDs are issued to SEATS, not to the human currently controlling
 * a seat: `seat-<starIndex>`. A takeover changes the seat's controller
 * and callsign only; the star, ship, drones, projectiles, mines, cargo,
 * and waves keep this same ownerId for the whole match.
 *
 * The legacy two-seat game uses binary owner labels ('player' / 'enemy',
 * plus 'home' for CME waves). Those labels stay in place for P2-2a —
 * this module only gives every entity the seat-scoped id that belongs
 * to the same seat: 'player' and 'home' are seat 0, 'enemy' is seat 1.
 */

export type LegacyOwner = 'player' | 'enemy' | 'home';

/** The seat-scoped ownerId for a seat/star index: seat 0 -> 'seat-0'. */
export const ownerIdForSeat = (starIndex: number): string =>
  `seat-${starIndex}`;

/** The star id for a seat/star index: seat 0 -> 'star-0'. */
export const starIdForSeat = (starIndex: number): string =>
  `star-${starIndex}`;

/**
 * Map a legacy binary owner label onto its seat-scoped ownerId.
 * 'player' and 'home' are the first seat; 'enemy' is the second seat.
 */
export const ownerIdForLegacyOwner = (owner: LegacyOwner): string =>
  ownerIdForSeat(owner === 'enemy' ? 1 : 0);

/** Parse a seat-scoped ownerId back to its seat index, if it has one. */
export const seatIndexForOwnerId = (ownerId: string): number | null => {
  const match = /^seat-(\d+)$/.exec(ownerId);
  return match ? Number(match[1]) : null;
};
