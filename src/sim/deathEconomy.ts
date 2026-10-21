/**
 * Death economy (Phase 2, P2-5, sim half) — pure cascade math.
 *
 * Adam's settled rulings (design draft §7 / PIN #8; multiplayer
 * notes, 2026-10-20): SHIP DEATH IS NOT ELIMINATION — the star's
 * death eliminates. The penalty is a cascade in shape (B)
 * REPURCHASE: on death the seat loses a cut of its bank; getting a
 * ship back means buying a new frame at a reduced price; repeated
 * deaths step the price down further; at zero bank the floor is a
 * FREE starter frame — nobody is ever locked out of playing. The
 * tuning pin over all of it: "shouldn't be crippling, just not
 * desirable" — a setback that costs momentum, never a death spiral.
 *
 * All numbers below are DRAFT (the draft's working set, adopted for
 * the build; Adam tunes later). Scrap is integer-valued throughout
 * the game, so losses and prices round to the nearest scrap.
 *
 * READING OF THE DRAFT (the one ambiguity that matters): the draft
 * prices the repurchase at "20% of the ship's current banked value"
 * and steps "the ship's value" down 15% per death. The sim tracks
 * no per-ship value figure — the only banked value a seat has is
 * its bank — so the price base is the SEAT'S BANK, taken AFTER the
 * death's bank loss, and the step-down rides as a price factor:
 * the first repurchase charges the full 20%; each prior death
 * discounts the next price by a further 15% (factor 0.85^(deaths−1)
 * at price time). The design sanity cascade pins the first step
 * exactly: bank 1000 → death → 750 → price 150 → respawn at 600.
 * The notes' cascade order ("bank loss until empty, THEN a penalty
 * on ship value") is preserved in effect: the step-down accrues in
 * the seat's death count from the first death and is what a
 * zero-bank seat carries — but the floor overrides it, so it can
 * never raise a price or block the free starter.
 *
 * The dead ship's HOLD is lost with it (the draft taxes the bank;
 * the hold is cargo in a destroyed hull) — the game loop zeroes
 * the wreck's carrying when it applies the cascade. The replacement
 * is a FRESH starter frame (createStarterShip, match-assembly
 * conventions, starter Bolt Cannon armed): the dead ship's tracks,
 * gear, and type progression are gone with the hull — that loss is
 * the real sting of the cascade, and the stepped-down price is the
 * discount on starting over.
 *
 * NO SPAWN PROTECTION: the draft grants none and this slice
 * invents none — a repurchased ship is an ordinary starter from
 * its first frame, protected only by spawning clear of its star
 * (src/sim/matchAssembly.ts shipSpawnPosition).
 */

import type { SeatSimState, Ship } from '../types';
import { createStarterShip } from './seatState';
import { shipSpawnPosition } from './matchAssembly';

/** DRAFT: fraction of the seat's bank taken on each ship death. */
export const BANK_LOSS_FRACTION = 0.25;
/** DRAFT: repurchase price as a fraction of the seat's current
 *  banked value (post-loss bank, read at price/pay time). */
export const REPURCHASE_COST_FRACTION = 0.2;
/** DRAFT: each death steps the repurchase price down by this
 *  fraction, compounding per prior death. */
export const VALUE_STEP_DOWN_FRACTION = 0.15;
/** DRAFT: how long a bot seat stays shipless before it buys back
 *  in (loop-clock ms). Bots must return to play or matches stall;
 *  under the pricing above a bot's price is always coverable (its
 *  bank starts at 0 and the floor is free), so the timer is the
 *  only wait a bot ever has. */
export const BOT_REPURCHASE_DELAY_MS = 5000;
/** DRAFT (Adam, 2026-10-21 — the "death tax"): a PAID repurchase
 *  also costs TIME — the new frame arrives only after a respawn
 *  wait, on top of the price. The FREE floor (price 0) skips the
 *  wait entirely: broke players have paid in poverty already.
 *  Base wait; the household magnitude is the bots' 5 s. */
export const RESPAWN_WAIT_BASE_MS = 5000;
/** DRAFT, UNRULED: each death beyond the first adds this much to
 *  the wait. Whether the tax grows at all is Adam's open number —
 *  it is one constant, and 0 flattens it. */
export const RESPAWN_WAIT_PER_DEATH_MS = 1000;
/** PINNED (Adam, 2026-10-21): the wait never exceeds 30 seconds,
 *  however often a seat dies. His reasoning: the per-death price
 *  discount could otherwise be farmed by deliberate repeat deaths
 *  ("shills") — a wait climbing toward a 30 s ceiling makes the
 *  farming cost real time. */
export const RESPAWN_WAIT_MAX_MS = 30000;
/** DRAFT, UNRULED (Adam, 2026-10-21 — the tax DECAYS through
 *  honest play): each full stretch of this much SURVIVED time
 *  forgives one death-step of the wait's growth — "if the player
 *  survives X amount of seconds, the tax gets lowered. As a reward
 *  for surviving." Drafted at a minute of honest play per step:
 *  forgiveness is earned, never ambient, and a deep hole takes
 *  real play to climb out of. Survival is BANKED across lives
 *  (the seat's survivalMs never resets on death) and steps are
 *  whole — no fractions, the ledger stays legible. */
export const SURVIVAL_MS_PER_TAX_STEP = 60000;

/** Whole death-steps forgiven by a seat's banked survival. */
export const taxStepsForgiven = (survivalMs: number): number =>
  Math.floor(Math.max(0, survivalMs) / SURVIVAL_MS_PER_TAX_STEP);

/**
 * The death count the WAIT reads: raw deaths minus forgiven
 * steps, floored at 1 — survival can work the tax back down to
 * the first-death base, never below it. (The PRICE step-down is
 * a separate curve and is NOT forgiven: repurchasePriceFor reads
 * raw deaths, exactly as before.)
 */
export const effectiveTaxDeaths = (deaths: number, survivalMs: number): number =>
  Math.max(1, deaths - taxStepsForgiven(survivalMs));

/**
 * The death-tax wait for a seat's NEXT paid repurchase, from its
 * lifetime death count (the count AFTER the death being bought
 * back from — the first buy-back waits the base) reduced by the
 * steps its banked survival forgives. Pure.
 */
export const respawnWaitMsFor = (deaths: number, survivalMs = 0): number =>
  Math.min(
    RESPAWN_WAIT_MAX_MS,
    RESPAWN_WAIT_BASE_MS +
      RESPAWN_WAIT_PER_DEATH_MS *
        Math.max(0, effectiveTaxDeaths(deaths, survivalMs) - 1),
  );

export interface DeathLossResult {
  /** The scrap the death took from the bank (0 at an empty bank). */
  loss: number;
  /** The seat's bank after the loss. */
  bankAfter: number;
  /** The seat's lifetime death count after this death. */
  deathsAfter: number;
}

/**
 * The bank-loss half of the cascade, at the moment of a ship death:
 * 25% of the bank, taken until the bank is empty (a proportional
 * take asymptotes — a 1-scrap bank loses 0 after rounding, which
 * is the "not crippling" pin at the smallest scale).
 */
export const applyDeathLoss = (bank: number, deaths: number): DeathLossResult => {
  const loss = Math.min(bank, Math.round(bank * BANK_LOSS_FRACTION));
  return { loss, bankAfter: bank - loss, deathsAfter: deaths + 1 };
};

/**
 * The price of buying a ship back, from the seat's CURRENT bank
 * and lifetime death count: 20% of the bank, stepped down 15% per
 * PRIOR death (the first repurchase is full price — see the module
 * banner's sanity cascade). At a zero bank the price is 0: the
 * free-starter floor is structural, not a special case.
 */
export const repurchasePriceFor = (bank: number, deaths: number): number => {
  if (bank <= 0) return 0;
  const stepFactor = Math.pow(
    1 - VALUE_STEP_DOWN_FRACTION,
    Math.max(0, deaths - 1),
  );
  return Math.min(bank, Math.round(bank * REPURCHASE_COST_FRACTION * stepFactor));
};

export interface RepurchaseResult {
  /** The new starter frame, already placed on the seat record —
   *  or null when a PAID buy-back is serving its death-tax wait
   *  (the frame arrives at respawnAt; see completeRespawn). */
  ship: Ship | null;
  /** Scrap actually paid (0 at the zero-value floor). */
  cost: number;
  /** Loop-clock arrival of a paid frame; absent when the ship
   *  spawned at once (the free floor never waits). */
  respawnAt?: number;
}

/**
 * Place a bought frame on the seat record: a fresh starter at the
 * seat's star through the assembly placement math, shipless and
 * pending stamps cleared. Called by tryRepurchase for the free
 * floor, and by the loop when a paid seat's death-tax wait elapses
 * (respawnDue). Returns null for an eliminated seat — a dead star
 * takes no deliveries, even of a ship already paid for.
 */
export const completeRespawn = (seat: SeatSimState): Ship | null => {
  if (seat.eliminated) return null;
  const ship = createStarterShip(seat.ownerId, shipSpawnPosition(seat.star), {
    withStarterWeapon: true,
  });
  seat.ship = ship;
  seat.shipLostAt = undefined;
  seat.respawnAt = undefined;
  seat.respawnWaitMs = undefined;
  return ship;
};

/** A paid buy-back's frame is due when the loop clock reaches the
 *  stamped arrival. The loop ticks this for every seat each frame. */
export const respawnDue = (seat: SeatSimState, now: number): boolean =>
  !seat.ship &&
  !seat.eliminated &&
  seat.respawnAt !== undefined &&
  now >= seat.respawnAt;

/**
 * Buy a shipless seat a new frame, mutating the seat record (the
 * loop's seat copies are working state, mutated in place by
 * convention): deducts the price from the seat's bank, then either
 * spawns the frame at once (the FREE floor: price 0 never waits)
 * or stamps its arrival after the death-tax wait (a PAID buy-back
 * costs time on top of scrap — Adam, 2026-10-21). Returns null —
 * and mutates nothing — when the seat is not death-economy
 * shipless (it still has a ship, it never lost one, it is
 * eliminated: a dead star buys no ships) or when a paid buy-back
 * is already pending (a second intent finds the wait stamped and
 * refuses — no double charge, structurally).
 */
export const tryRepurchase = (
  seat: SeatSimState,
  now: number,
): RepurchaseResult | null => {
  if (seat.ship || seat.eliminated || (seat.deaths ?? 0) <= 0) return null;
  if (seat.respawnAt !== undefined) return null;
  const cost = repurchasePriceFor(seat.bankedScrap, seat.deaths);
  if (seat.bankedScrap < cost) return null;
  seat.bankedScrap -= cost;
  if (cost <= 0) {
    const ship = completeRespawn(seat);
    return ship ? { ship, cost } : null;
  }
  const waitMs = respawnWaitMsFor(seat.deaths, seat.survivalMs ?? 0);
  seat.respawnAt = now + waitMs;
  seat.respawnWaitMs = waitMs;
  return { ship: null, cost, respawnAt: seat.respawnAt };
};

/**
 * Bot auto-repurchase predicate: a bot-driven seat buys back in on
 * its own once it has been shipless for BOT_REPURCHASE_DELAY_MS of
 * loop clock. (Human seats repurchase through the player's own
 * action — the loop's repurchaseShip callback — never on a timer.)
 */
export const botRepurchaseDue = (seat: SeatSimState, now: number): boolean =>
  seat.controller === 'bot' &&
  !seat.ship &&
  !seat.eliminated &&
  seat.respawnAt === undefined &&
  (seat.deaths ?? 0) > 0 &&
  seat.shipLostAt !== undefined &&
  now - seat.shipLostAt >= BOT_REPURCHASE_DELAY_MS;
