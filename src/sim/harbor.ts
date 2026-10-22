/**
 * ALLY DOCKING — harbors (RULED by Adam, 2026-10-22;
 * ReadMeFiles/ALLY_DOCKING.md is the spec of record).
 *
 * An allied ship may dock with a friendly CRUISER, CARRIER,
 * or HAULER: attached, it rides the host — out of combat
 * (cannot fire, cannot be hit; every targeting and damage
 * read in the game skips a docked ship) — while the HOST'S
 * HOLD pays for the guest's repair at the guest's own rate
 * multiplied by the host's HARBOR MULTIPLIER. The guest's
 * repair CAP stays its own hull's law: a host speeds repair;
 * it never raises the ceiling. The guest's repair toggle
 * stays the guest's — docked with repair OFF is a PASSENGER:
 * shelter first, workshop second.
 *
 * Consent is a mechanic: hosts carry a HARBOR SWITCH
 * (harborOpen; undefined reads as OPEN — a host closes it to
 * refuse, and closing spills current guests gently at their
 * current health). Host death spills guests at the wreck
 * (the escort law). Eligibility reads off TEAM MEMBERSHIP
 * (areTeammates) — never the mode: a solo seat with bot
 * teammates has harbors; only a pure 1v1 / true FFA has none.
 *
 * All numbers DRAFT for the pin pass.
 */
import type { SeatSimState, Ship } from '../types';
import type { ShipLine, TypeTier } from '../shipProgression';
import { healCapPctFor, healRateFor } from '../shipProgression';
import { repairFrame } from './repair';
import { areTeammates } from './teams';

/**
 * Lines that can host. The harbor is a big hull's work. (The
 * CARRIER of the ruling is the drone line — its hulls are the
 * carriers; 'drone' is the line's id in shipProgression.)
 */
export const canHostLine = (line: ShipLine | null): boolean =>
  line === 'cruiser' || line === 'drone' || line === 'hauler';

/** Guests a host may carry, by line and tier. DRAFT. */
export const harborCapacityFor = (line: ShipLine | null, tier: TypeTier): number => {
  switch (line) {
    case 'cruiser': return 1;
    case 'hauler': return tier >= 4 ? 2 : 1;
    case 'drone': return tier >= 5 ? 3 : tier >= 3 ? 2 : 1; // the carrier
    default: return 0;
  }
};

const HARBOR_BASE: Partial<Record<ShipLine, number>> = {
  cruiser: 1.25,
  hauler: 1.5,
  drone: 2.0, // the carrier
};

/**
 * The host's multiplier on the guest's repair RATE, with a
 * mild climb by tier (+0.05 per tier past T2). DRAFT.
 */
export const harborMultiplierFor = (line: ShipLine | null, tier: TypeTier): number => {
  const base = line ? HARBOR_BASE[line] : undefined;
  return base === undefined ? 1 : base + 0.05 * Math.max(0, tier - 2);
};

/** How close a guest must be to berth. DRAFT. */
export const HARBOR_DOCK_RANGE = 120;

/** Ships currently docked to the host with this ownerId. */
export const guestsOf = (ships: readonly (Ship | null)[], hostOwnerId: string): Ship[] =>
  ships.filter((s): s is Ship => !!s && s.dockedTo === hostOwnerId);

/**
 * May this guest berth at this host right now? The one gate
 * the dock verb and (later) the bot harbor-seeking share:
 * teammates, a hosting line, an open harbor, capacity free.
 */
export const canDockAt = (
  seats: readonly SeatSimState[],
  guest: Ship,
  host: Ship,
): boolean => {
  if (guest === host || guest.dockedTo) return false;
  if (!canHostLine(host.line)) return false;
  if (host.harborOpen === false) return false;
  if (!areTeammates(seats, guest.ownerId, host.ownerId)) return false;
  const ships = seats.map(s => s.ship);
  return guestsOf(ships, host.ownerId).length < harborCapacityFor(host.line, host.typeTier);
};

/**
 * The per-frame harbor pass (host/SP authoritative frame,
 * over the seats' ships — the local seat's ship IS the
 * top-level ship object, so one pass covers every captain).
 * A docked guest rides its host exactly and heals from the
 * host's hold; an invalid berth (host gone, eliminated,
 * harbor closed, host no longer a hosting hull, teams
 * dissolved) undocks the guest where it lies — gentle, at
 * its current health; a dead host leaves it at the wreck.
 */
export const stepHarbors = (seats: readonly SeatSimState[]): void => {
  const byOwner = new Map(seats.map(s => [s.ownerId, s]));
  for (const seat of seats) {
    const guest = seat.ship;
    if (!guest?.dockedTo) continue;
    const hostSeat = byOwner.get(guest.dockedTo);
    const host = hostSeat?.ship ?? null;
    if (
      !host || !hostSeat || hostSeat.eliminated ||
      !canHostLine(host.line) || host.harborOpen === false ||
      !areTeammates(seats, guest.ownerId, host.ownerId)
    ) {
      guest.dockedTo = undefined;
      continue;
    }
    guest.pos.x = host.pos.x;
    guest.pos.y = host.pos.y;
    guest.vel.x = host.vel.x;
    guest.vel.y = host.vel.y;
    guest.angle = host.angle;
    guest.thrust = false;
    if (guest.repairing !== false) {
      const ceiling = guest.maxHealth * healCapPctFor(guest.line, guest.typeTier);
      const rate = (healRateFor(guest.line, guest.typeTier) / 60) * harborMultiplierFor(host.line, host.typeTier);
      repairFrame(guest, host, ceiling, rate);
    }
  }
};
