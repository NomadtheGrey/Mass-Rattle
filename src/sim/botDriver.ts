/**
 * Per-seat bot ship driver (Phase 2, P2-2b) — NEW behavior, not a
 * generalization of something the shipped game had: SP's enemy seat
 * flies no ship, so this driver is only ever exercised by bot seats
 * that HAVE a ship (multiplayer matches seated with ships, P2-3+).
 * The SP init path seats the enemy with ship: null and this code
 * never runs in the shipped game.
 *
 * The driver is deliberately simple and tunable — a harvest loop in
 * the drone's idiom, flown by a ship:
 *   seek the nearest loose scrap → collect it on contact → when the
 *   hold is full, return to the seat's own star and deliver (the game
 *   loop runs the actual infusion through infuseStar, same as drone
 *   deliveries) → repeat. It steers clear of hostile stars' burn
 *   radius, and fires its equipped starter weapon at the nearest
 *   hostile drone or ship in range, through the same projectile shape
 *   the game loop creates for the player's volleys.
 *
 * OFFENSE (Arsenal slice 5a, 2026-10-21): the harvest loop is the
 * default posture. A targetable hostile ship inside AGGRO_RANGE is
 * hunted; an empty hold with nothing to hunt and no scrap inside
 * SCAN_RANGE besieges the nearest hostile star from SIEGE_STANDOFF.
 * All ship acquisition is stealth-aware (isVisibleTo) per the
 * submarine ruling. The carrier wing's escorts (slice 5b) fly the
 * same acquisition + fire discipline from their own step.
 *
 * Decisions are pure with respect to the world view it is handed: it
 * mutates only its own seat's ship (a frame copy in the loop) and
 * reports scrap collections / deliveries / new projectiles back as
 * data for the loop to apply. No rendering, no input, no economy —
 * bot seats never touch the workshop paths (those stay bound to the
 * local seat).
 */

import { PHYSICS } from '../constants';
import { weaponStatsFor } from '../loadout';
import { EXTRA_MOUNT_DAMAGE, typeFor, healCapPctFor, healRateFor } from '../shipProgression';
import { isVisibleTo } from './stealth';
import { repairFrame } from './repair';
import { areHostile, type TeamSeatLike } from './teams';
import { milestonesForInfused } from '../starGrowth';
import { canDockAt, HARBOR_DOCK_RANGE } from './harbor';
import type {
  Harvester,
  Projectile,
  Scrap,
  SeatSimState,
  Ship,
  Star,
} from '../types';

/** Bot driver tuning — DRAFT numbers, one block, Adam's pin pending. */
export const BOT_DRIVER = {
  /** Top speed (units/frame). The player cap is PHYSICS.MAX_VELOCITY
   * (5) + thrust upgrades; a starter bot cruises a little under it. */
  MAX_SPEED: 4.2,
  /** Acceleration along the ship's facing (units/frame^2). */
  ACCEL: 0.22,
  /** Heading turn rate toward the current target (rad/frame). */
  TURN_RATE: 0.08,
  /** Per-frame velocity retention (the player ship's friction idiom). */
  FRICTION: 0.98,
  /** Scrap pickup distance — the player ship's auto-collect radius. */
  COLLECT_RADIUS: PHYSICS.AUTO_COLLECT_RADIUS,
  /** Delivery distance from the home star's CENTER — the drone
   * deposit radius beyond the star's surface. */
  DEPOSIT_RADIUS: PHYSICS.DRONES.DEPOSIT_RADIUS,
  /** Weapon range: the driver only opens fire inside this distance. */
  FIRE_RANGE: 520,
  /** OFFENSE (Arsenal slice 5a, 2026-10-21): a targetable hostile
   *  ship inside this distance becomes the bot's objective — it
   *  pursues instead of harvesting. DRAFT. */
  AGGRO_RANGE: 1000,
  /** OFFENSE: with an empty hold, scrap must be at least this near
   *  to keep the bot on the harvest loop; beyond it (and with no
   *  ship to hunt) the bot goes to siege a hostile star. DRAFT. */
  SCAN_RANGE: 700,
  /** OFFENSE: the siege stand-off beyond the target star's
   *  surface — outside the burn (size + 150) and outside the
   *  avoidance push (size + AVOID_MARGIN), inside FIRE_RANGE of
   *  the center for any star the growth curve produces. DRAFT. */
  SIEGE_STANDOFF: 300,
  /** Hostile-star avoidance: steering repulsion begins this far
   * beyond the star's surface (the burn zone is size + 150). */
  AVOID_MARGIN: 190,
  /** Hard keep-out beyond a hostile star's surface. */
  KEEP_OUT: 26,
  /** B1 FALLBACK (DRAFT): at or below this hull fraction, with a
   *  hostile engaging, the bot retreats under its home turrets —
   *  or to an allied harbor when its disposition favors repair. */
  FALLBACK_HEALTH_PCT: 0.35,
  /** B1 DEFEND (DRAFT): a hostile ship this close to the home
   *  star (or engaging the seat's drones) is intercepted. */
  DEFEND_RANGE: 900,
  /** B1 DEFEND (DRAFT): the defender never chases beyond this
   *  distance from the home star. */
  DEFEND_LEASH: 1200,
  /** B1 DEFEND (DRAFT): a hostile ship this close to one of the
   *  seat's drones counts as engaging its units. */
  DEFEND_UNIT_RANGE: 500,
  /** B1 SEARCH (DRAFT, Amendment 4): after losing its target the
   *  defender patrols the DEFEND–LEASH ring this long (ms of loop
   *  clock) before returning to the ladder. */
  SEARCH_MS: 30000,
  /** B1 catch-up bias (DRAFT): trailing the field's best star by
   *  at least this many milestones bars VOLUNTARY hunt/siege. */
  CATCHUP_MILESTONES: 2,
  /** Repair disposition: how often (ms of loop clock) a bot
   *  re-rolls whether it bothers to heal. DRAFT. */
  DISPOSITION_WINDOW_MS: 5000,
};

export interface BotWorldView {
  /** Loose scrap currently in the world (the frame's live list). */
  scrap: Scrap[];
  /** Every seat's star (the driver's own star is found by ownerId). */
  stars: Star[];
  /** Every drone in the world (fire targets are the hostile ones). */
  drones: Harvester[];
  /** Every flying ship, by owning seat. */
  ships: { ownerId: string; ship: Ship }[];
  /** The seat table (TEAMS): the driver's hostility reads — its
   *  threat and fire choices key on team, not ownerId. */
  seats: readonly TeamSeatLike[];
  /** The local seat's ownerId — projectile legacy-owner labels are
   * view-relative ('player' = the local seat's side), as everywhere
   * else in the sim. */
  localOwnerId: string;
  /** The loop clock (performance.now-based, ms) for fire cooldowns. */
  time: number;
}

export interface BotStepResult {
  /** Scrap ids the ship picked up this step (the loop removes them
   * from the world's returned scrap list). */
  collectedScrapIds: string[];
  /** Scrap delivered to the seat's star this step (the loop runs the
   * infusion + delivery heal); 0 on most steps. */
  deliverAmount: number;
  /** Projectiles fired this step, in the loop's projectile shape. */
  projectiles: Projectile[];
}

const EMPTY_RESULT: BotStepResult = {
  collectedScrapIds: [],
  deliverAmount: 0,
  projectiles: [],
};

/** Total hold capacity for a ship, the loop's formula (cargo track +
 * line/type bonus, overload ratio applied to the total). */
const holdCapacityFor = (ship: Ship): number => {
  const regular =
    PHYSICS.CARGO.BASE_CAPACITY +
    ship.upgrades.cargo * PHYSICS.CARGO.UPGRADE_BONUS +
    typeFor(ship.line, ship.typeTier).cargoBonus;
  return regular + Math.floor(regular * PHYSICS.CARGO.OVERLOAD_RATIO);
};

const angleLerp = (from: number, to: number, maxStep: number): number => {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return from + Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
};

/** Deterministic per-seat hash — a pilot's identity, stable
 *  across frames, migrations, and drop-ins. */
const seatHash = (ownerId: string): number => {
  let h = 2166136261;
  for (let i = 0; i < ownerId.length; i++) {
    h = Math.imul(h ^ ownerId.charCodeAt(i), 16777619);
  }
  return h >>> 0;
};

/**
 * REPAIR DISPOSITION (Adam's ruling via DAMAGE_CONTROL.md): the
 * chance a bot chooses to heal at a given hull fraction —
 * ≈5% at 95% health, ≈80% at 20% — with a straight DRAFT curve
 * between the anchors and a shallow rise below the low anchor.
 */
export const healChanceFor = (healthPct: number): number => {
  if (healthPct >= 0.95) return 0.05;
  if (healthPct <= 0.2) return Math.min(0.9, 0.8 + (0.2 - healthPct) * 0.5);
  return 0.05 + (0.95 - healthPct);
};

/**
 * Write the bot's repair toggle for this disposition window.
 * "Various ship pilots are of various recklessness" (Adam):
 * each seat's hash shifts its chance ±0.15, and the roll is
 * deterministic per (seat, window) — a mood, re-rolled every
 * DISPOSITION_WINDOW_MS of loop clock, never stored posture.
 */
export const applyBotRepairDisposition = (seat: SeatSimState, time: number): void => {
  const ship = seat.ship;
  if (!ship) return;
  const hash = seatHash(seat.ownerId);
  const variance = ((hash % 31) - 15) / 100;
  const pct = ship.health / Math.max(1, ship.maxHealth);
  const p = Math.min(0.95, Math.max(0.02, healChanceFor(pct) + variance));
  const window = Math.floor(time / BOT_DRIVER.DISPOSITION_WINDOW_MS);
  const x = Math.sin(hash * 0.0137 + window * 1.917) * 43758.5453;
  ship.repairing = (x - Math.floor(x)) < p;
};

/**
 * SEARCH memory (B1 Amendment 4): pilot state, deliberately NOT
 * match state — keyed by seat, held by the driver, forgotten on
 * migration or restart like a socket grace. The posture ladder
 * itself stays stateless per frame; this only remembers that a
 * defender recently lost its target and owes the ring a patrol.
 */
interface BotSearchMemory { startedAt: number; until: number; fromAngle: number; dir: 1 | -1 }
const searchBySeat = new Map<string, BotSearchMemory>();
const lastPostureBySeat = new Map<string, string>();

/**
 * Advance one bot seat's ship by one frame step. `dtFrames` scales
 * the movement integration (the loop passes 1; it exists so tests and
 * future fixed-step hosts can drive the same decisions).
 */
export const stepBotShip = (
  seat: SeatSimState,
  world: BotWorldView,
  dtFrames: number = 1,
): BotStepResult => {
  const ship = seat.ship;
  if (!ship || seat.eliminated) return EMPTY_RESULT;
  const ownStar = world.stars.find(s => s.ownerId === seat.ownerId);
  if (!ownStar) return EMPTY_RESULT;

  // REPAIR DISPOSITION (B1): the pilot's health-graded choice
  // to heal, written before anything reads the toggle — the
  // harbor pass reads it for docked bots exactly as the tick
  // below reads it for free-flying ones.
  applyBotRepairDisposition(seat, world.time);

  // ALLY DOCKING (src/sim/harbor.ts): a docked bot rides its
  // host — no steering, no fire, no own-hold repair tick (the
  // harbor pass heals it from the host's hold). The pass owns
  // berth validity; this gate keeps the hull attached — and
  // lets it go when the recovery is done: healed to its cap
  // ("return at the cap"), or patched past the fallback line
  // with the host's hold dry and nothing left to gain.
  if (ship.dockedTo) {
    const hostEntry = world.ships.find(s => s.ownerId === ship.dockedTo);
    const cap = ship.maxHealth * healCapPctFor(ship.line, ship.typeTier);
    const healedOut = ship.health >= cap - 1e-6;
    const hostDry = !!hostEntry && hostEntry.ship.carrying <= 0 &&
      ship.health / Math.max(1, ship.maxHealth) > BOT_DRIVER.FALLBACK_HEALTH_PCT;
    if (healedOut || hostDry) {
      ship.dockedTo = undefined;
    } else {
      if (hostEntry) {
        ship.pos.x = hostEntry.ship.pos.x;
        ship.pos.y = hostEntry.ship.pos.y;
        ship.vel.x = hostEntry.ship.vel.x;
        ship.vel.y = hostEntry.ship.vel.y;
      }
      return EMPTY_RESULT;
    }
  }

  // SCRAP HEALING (RULED, src/sim/repair.ts): the toggle
  // DEFAULTS ON for bots as for captains until the bot
  // program's disposition policy (B1/B2 — Adam's health-graded
  // chance: 5% at 95% health, 80% at 20%) starts writing the
  // flag per pilot; the tick honors the flag exactly as a
  // captain's ship does, from its own hold.
  if (ship.repairing !== false) {
    const ceiling = ship.maxHealth * healCapPctFor(ship.line, ship.typeTier);
    repairFrame(ship, ship, ceiling, (healRateFor(ship.line, ship.typeTier) / 60) * dtFrames);
  }

  const result: BotStepResult = {
    collectedScrapIds: [],
    deliverAmount: 0,
    projectiles: [],
  };
  const capacity = holdCapacityFor(ship);

  // --- Decide the destination -------------------------------------
  // B1 POSTURES (RULED, ReadMeFiles/BOTS.md): flight judgment,
  // derived per frame — a human drop-in inherits a ship, never a
  // posture. The ladder, in order:
  //   return   — a full hold goes home (the delivery is also the
  //              fallback route: home is where the turrets are).
  //   fallback — hull <= FALLBACK_HEALTH_PCT with a hostile
  //              engaging: retreat under the home turrets, or to
  //              an allied harbor when the disposition favors
  //              repair (ALLY_DOCKING.md — falling back to dock).
  //   defend   — a hostile threatens the home star (DEFEND_RANGE,
  //              the star itself may be the stealth observer) or
  //              engages the seat's drones: intercept the threat
  //              NEAREST THE STAR, never past the leash.
  //   search   — Amendment 4: a defender that lost its target
  //              patrols the DEFEND-LEASH ring before returning.
  //   hunt     — the 5a offense engine (AGGRO_RANGE). A seat
  //              trailing the field's best star by >=
  //              CATCHUP_MILESTONES takes no VOLUNTARY hunt or
  //              siege; Amendment 3 keeps the REACTIVE hunt: a
  //              hostile in its territory, on its units, or
  //              point-blank on the bot itself is still hunted.
  //   siege / harvest — the 5a defaults.
  // All acquisition runs through isVisibleTo (STEALTH.md).
  const full = ship.carrying >= capacity;
  let target: { x: number; y: number } | null = null;
  let targetScrap: Scrap | null = null;
  let objective: 'harvest' | 'return' | 'hunt' | 'siege' | 'fallback' | 'defend' | 'search' = 'harvest';
  let huntShip: Ship | null = null;
  let siegeStar: Star | null = null;

  // Hunt scan (5a): nearest targetable hostile ship inside aggro.
  let bestAggro = BOT_DRIVER.AGGRO_RANGE;
  for (const hostile of world.ships) {
    if (hostile.ownerId === seat.ownerId) continue;
    if (hostile.ship.dockedTo) continue; // docked = out of combat
    if (!areHostile(world.seats, hostile.ownerId, seat.ownerId)) continue;
    if (!isVisibleTo(hostile.ship, ship.pos)) continue;
    const dd = Math.hypot(
      hostile.ship.pos.x - ship.pos.x,
      hostile.ship.pos.y - ship.pos.y,
    );
    if (dd < bestAggro) {
      bestAggro = dd;
      huntShip = hostile.ship;
    }
  }

  // DEFEND reads: the seat's drones (any hostile on them is
  // engaging the seat's units) and the threats to the home star.
  const myDrones = world.drones.filter(d => d.ownerId === seat.ownerId && d.state !== 'docked');
  const engagesMyUnits = (h: Ship): boolean => myDrones.some(d =>
    Math.hypot(d.pos.x - h.pos.x, d.pos.y - h.pos.y) <= BOT_DRIVER.DEFEND_UNIT_RANGE);
  let defendShip: Ship | null = null;
  let defendShipStarDist = Infinity;
  for (const hostile of world.ships) {
    if (hostile.ownerId === seat.ownerId) continue;
    if (hostile.ship.dockedTo) continue;
    if (!areHostile(world.seats, hostile.ownerId, seat.ownerId)) continue;
    const starDist = Math.hypot(
      hostile.ship.pos.x - ownStar.pos.x,
      hostile.ship.pos.y - ownStar.pos.y,
    );
    const nearStar = starDist <= BOT_DRIVER.DEFEND_RANGE && isVisibleTo(hostile.ship, ownStar.pos);
    const onMyUnits = engagesMyUnits(hostile.ship) && isVisibleTo(hostile.ship, ship.pos);
    if (!nearStar && !onMyUnits) continue;
    if (starDist < defendShipStarDist) {
      defendShipStarDist = starDist;
      defendShip = hostile.ship;
    }
  }

  // Catch-up bias + the reactive exception (Amendments to B1).
  const myMilestones = milestonesForInfused(ownStar.totalScrapInfused);
  const bestMilestones = Math.max(...world.stars.map(s => milestonesForInfused(s.totalScrapInfused)));
  const trailing = bestMilestones - myMilestones >= BOT_DRIVER.CATCHUP_MILESTONES;
  const reactive = !!huntShip && (
    Math.hypot(huntShip.pos.x - ownStar.pos.x, huntShip.pos.y - ownStar.pos.y) <= BOT_DRIVER.DEFEND_RANGE ||
    engagesMyUnits(huntShip) ||
    bestAggro <= 300
  );

  const healthPct = ship.health / Math.max(1, ship.maxHealth);
  let searchEntry = searchBySeat.get(seat.ownerId);
  if (searchEntry && world.time >= searchEntry.until) {
    searchBySeat.delete(seat.ownerId);
    searchEntry = undefined;
  }

  if (full) {
    objective = 'return';
  } else if (healthPct <= BOT_DRIVER.FALLBACK_HEALTH_PCT && huntShip) {
    objective = 'fallback';
    let harbor: Ship | null = null;
    if (ship.repairing !== false) {
      const pseudoSeats = world.seats.map(s => ({
        ownerId: s.ownerId,
        teamId: (s as TeamSeatLike).teamId,
        ship: world.ships.find(w => w.ownerId === s.ownerId)?.ship ?? null,
      }));
      let bestHarbor = Infinity;
      for (const entry of world.ships) {
        if (entry.ownerId === seat.ownerId) continue;
        if (!canDockAt(pseudoSeats as unknown as SeatSimState[], ship, entry.ship)) continue;
        const dd = Math.hypot(entry.ship.pos.x - ship.pos.x, entry.ship.pos.y - ship.pos.y);
        if (dd < bestHarbor) {
          bestHarbor = dd;
          harbor = entry.ship;
        }
      }
      if (harbor && bestHarbor <= harbor.size + HARBOR_DOCK_RANGE) {
        // Berth: the harbor pass owns the hull from here; the
        // docked gate at the top of this driver lets it go when
        // the recovery is done.
        ship.dockedTo = harbor.ownerId;
        return result;
      }
      if (harbor) target = harbor.pos;
    }
    if (!harbor) target = ownStar.pos; // under the turrets
  } else if (defendShip) {
    objective = 'defend';
    huntShip = defendShip;
    searchBySeat.delete(seat.ownerId);
    const myStarDist = Math.hypot(ship.pos.x - ownStar.pos.x, ship.pos.y - ownStar.pos.y);
    if (myStarDist > BOT_DRIVER.DEFEND_LEASH) {
      target = ownStar.pos; // the leash: come home first
    } else {
      const dd = Math.hypot(defendShip.pos.x - ship.pos.x, defendShip.pos.y - ship.pos.y);
      target = dd > BOT_DRIVER.FIRE_RANGE * 0.8 ? defendShip.pos : null;
    }
  } else if (searchEntry || lastPostureBySeat.get(seat.ownerId) === 'defend') {
    // SEARCH (Amendment 4): patrol the ring between DEFEND_RANGE
    // and the leash for SEARCH_MS after losing the target.
    if (!searchEntry) {
      searchEntry = {
        startedAt: world.time,
        until: world.time + BOT_DRIVER.SEARCH_MS,
        fromAngle: Math.atan2(ship.pos.y - ownStar.pos.y, ship.pos.x - ownStar.pos.x),
        dir: seatHash(seat.ownerId) % 2 === 0 ? 1 : -1,
      };
      searchBySeat.set(seat.ownerId, searchEntry);
    }
    objective = 'search';
    const sweep = (world.time - searchEntry.startedAt) / BOT_DRIVER.SEARCH_MS;
    const ang = searchEntry.fromAngle + searchEntry.dir * sweep * Math.PI;
    const ring = ownStar.size + (BOT_DRIVER.DEFEND_RANGE + BOT_DRIVER.DEFEND_LEASH) / 2;
    target = {
      x: ownStar.pos.x + Math.cos(ang) * ring,
      y: ownStar.pos.y + Math.sin(ang) * ring,
    };
  } else if (huntShip && (!trailing || reactive)) {
    objective = 'hunt';
    // Hold at firing range: inside it, coast and shoot.
    target = bestAggro > BOT_DRIVER.FIRE_RANGE * 0.8 ? huntShip.pos : null;
  } else {
    // Harvest scan (nearest scrap, as ever).
    let bestD = Infinity;
    for (const s of world.scrap) {
      const dd = Math.hypot(s.pos.x - ship.pos.x, s.pos.y - ship.pos.y);
      if (dd < bestD) {
        bestD = dd;
        targetScrap = s;
      }
    }
    if (ship.carrying === 0 && (!targetScrap || bestD > BOT_DRIVER.SCAN_RANGE)) {
      // Siege scan: nearest hostile star — VOLUNTARY, so the
      // catch-up bias bars it for a trailing seat.
      let bestStar = Infinity;
      if (!trailing) {
        for (const s of world.stars) {
          if (!areHostile(world.seats, s.ownerId, seat.ownerId)) continue;
          const dd = Math.hypot(s.pos.x - ship.pos.x, s.pos.y - ship.pos.y);
          if (dd < bestStar) {
            bestStar = dd;
            siegeStar = s;
          }
        }
      }
      if (siegeStar) {
        objective = 'siege';
        targetScrap = null;
        // Destination: the stand-off point on the star's rim
        // facing the bot — steered to ALWAYS, not only from
        // outside: a coast-only hold overshoots on arrival
        // momentum (friction alone carries ~200 units) and dips
        // into the burn before settling. Steering to the point
        // makes the bot brake and correct around it instead.
        const a = Math.atan2(
          ship.pos.y - siegeStar.pos.y,
          ship.pos.x - siegeStar.pos.x,
        );
        target = {
          x: siegeStar.pos.x + Math.cos(a) * (siegeStar.size + BOT_DRIVER.SIEGE_STANDOFF),
          y: siegeStar.pos.y + Math.sin(a) * (siegeStar.size + BOT_DRIVER.SIEGE_STANDOFF),
        };
      } else if (targetScrap) {
        target = targetScrap.pos;
      }
    } else if (targetScrap) {
      target = targetScrap.pos;
    }
  }
  lastPostureBySeat.set(seat.ownerId, objective);
  const returning = full || (objective === 'harvest' && !targetScrap && ship.carrying > 0);
  if (returning) {
    objective = 'return';
    target = ownStar.pos;
  }

  // --- Steer + integrate ------------------------------------------
  if (target) {
    const want = Math.atan2(target.y - ship.pos.y, target.x - ship.pos.x);
    ship.angle = angleLerp(ship.angle, want, BOT_DRIVER.TURN_RATE * dtFrames);
    ship.vel.x += Math.cos(ship.angle) * BOT_DRIVER.ACCEL * dtFrames;
    ship.vel.y += Math.sin(ship.angle) * BOT_DRIVER.ACCEL * dtFrames;
  }
  // Hostile-star avoidance: a soft push out of the burn approach,
  // plus a hard keep-out so the driver never parks inside a star.
  // (TEAMS: hostile TEAM — a teammate's star is no threat.)
  for (const s of world.stars) {
    if (!areHostile(world.seats, s.ownerId, seat.ownerId)) continue;
    const dx = ship.pos.x - s.pos.x;
    const dy = ship.pos.y - s.pos.y;
    const dist = Math.hypot(dx, dy) || 1;
    const danger = s.size + BOT_DRIVER.AVOID_MARGIN;
    if (dist < danger) {
      const push = (1 - dist / danger) * BOT_DRIVER.ACCEL * 2.2 * dtFrames;
      ship.vel.x += (dx / dist) * push;
      ship.vel.y += (dy / dist) * push;
    }
    const keepOut = s.size + BOT_DRIVER.KEEP_OUT;
    if (dist < keepOut) {
      ship.pos.x = s.pos.x + (dx / dist) * keepOut;
      ship.pos.y = s.pos.y + (dy / dist) * keepOut;
    }
  }
  ship.vel.x *= BOT_DRIVER.FRICTION;
  ship.vel.y *= BOT_DRIVER.FRICTION;
  // Siege approach discipline: inside the stand-off's approach
  // band the bot flies a slow final, so arrival momentum cannot
  // carry it past the stand-off into the burn (see the siege
  // destination note above).
  let speedCap = BOT_DRIVER.MAX_SPEED;
  if (objective === 'siege' && siegeStar) {
    const surfD =
      Math.hypot(ship.pos.x - siegeStar.pos.x, ship.pos.y - siegeStar.pos.y) -
      siegeStar.size;
    if (surfD < BOT_DRIVER.SIEGE_STANDOFF + 260) speedCap = 1.6;
  }
  const speed = Math.hypot(ship.vel.x, ship.vel.y);
  if (speed > speedCap) {
    const ratio = speedCap / speed;
    ship.vel.x *= ratio;
    ship.vel.y *= ratio;
  }
  ship.pos.x += ship.vel.x * dtFrames;
  ship.pos.y += ship.vel.y * dtFrames;
  ship.thrust = speed > 0.4;

  // --- Collect / deliver on contact --------------------------------
  if (targetScrap && !returning) {
    const dd = Math.hypot(
      targetScrap.pos.x - ship.pos.x,
      targetScrap.pos.y - ship.pos.y,
    );
    if (dd < BOT_DRIVER.COLLECT_RADIUS && ship.carrying < capacity) {
      ship.carrying += 1;
      result.collectedScrapIds.push(targetScrap.id);
    }
  }
  if (returning && ship.carrying > 0) {
    const dd = Math.hypot(ownStar.pos.x - ship.pos.x, ownStar.pos.y - ship.pos.y);
    if (dd < ownStar.size + BOT_DRIVER.DEPOSIT_RADIUS) {
      result.deliverAmount = ship.carrying;
      ship.carrying = 0;
    }
  }

  // --- Fire the equipped starter weapon ----------------------------
  const weaponId = ship.loadout.weapon;
  const wStats = weaponStatsFor(
    weaponId,
    weaponId ? ship.arsenal[weaponId] || 0 : 0,
  );
  if (
    wStats &&
    !wStats.scrapCost &&
    wStats.kind !== 'mine' &&
    world.time >= (ship.fireReadyAt || 0)
  ) {
    // Nearest hostile: drones first (the harvest war), then ships.
    // (TEAMS: hostile TEAM — a bot never fires on its own side.)
    let fireTarget: { x: number; y: number } | null = null;
    let bestD = BOT_DRIVER.FIRE_RANGE;
    for (const d of world.drones) {
      if (d.state === 'docked') continue; // inside its ship
      if (!areHostile(world.seats, d.ownerId, seat.ownerId)) continue;
      const dd = Math.hypot(d.pos.x - ship.pos.x, d.pos.y - ship.pos.y);
      if (dd < bestD) {
        bestD = dd;
        fireTarget = d.pos;
      }
    }
    if (!fireTarget) {
      for (const hostile of world.ships) {
        if (hostile.ship.dockedTo) continue; // docked = out of combat
        if (!areHostile(world.seats, hostile.ownerId, seat.ownerId)) continue;
        // STEALTH (the submarine ruling, consumed offensively in
        // slice 5a): a cloaked hull beyond its reveal band cannot
        // be acquired, however close the geometry table says the
        // hull is — visibility is the gate, not distance alone.
        if (!isVisibleTo(hostile.ship, ship.pos)) continue;
        const dd = Math.hypot(
          hostile.ship.pos.x - ship.pos.x,
          hostile.ship.pos.y - ship.pos.y,
        );
        if (dd < bestD) {
          bestD = dd;
          fireTarget = hostile.ship.pos;
        }
      }
    }
    if (!fireTarget && objective === 'siege' && siegeStar) {
      // SIEGE FIRE (slice 5a): only on the siege objective — a
      // harvesting bot never plinks a star opportunistically; the
      // match's star pressure is a decision, not an accident. The
      // bolts are ship-fired, so the projectile step chips the
      // star at the ruled ship-fire rate.
      const dd = Math.hypot(
        siegeStar.pos.x - ship.pos.x,
        siegeStar.pos.y - ship.pos.y,
      );
      if (dd < BOT_DRIVER.FIRE_RANGE) fireTarget = siegeStar.pos;
    }
    if (fireTarget) {
      const aim = Math.atan2(
        fireTarget.y - ship.pos.y,
        fireTarget.x - ship.pos.x,
      );
      // Hard-point volley, the loop's mount math: mount 0 is the nose
      // at full damage; extra mounts offset perpendicular, alternating
      // sides, at EXTRA_MOUNT_DAMAGE of the damage.
      const mounts = typeFor(ship.line, ship.typeTier).hardPoints;
      for (let m = 0; m < mounts; m++) {
        const dmgScale = m === 0 ? 1 : EXTRA_MOUNT_DAMAGE;
        const side = m === 0 ? 0 : (m % 2 === 1 ? 1 : -1) * Math.ceil(m / 2);
        const off = side * ship.size * 0.7;
        const muzzle = {
          x:
            ship.pos.x +
            Math.cos(ship.angle) * (ship.size + 4) -
            Math.sin(ship.angle) * off,
          y:
            ship.pos.y +
            Math.sin(ship.angle) * (ship.size + 4) +
            Math.cos(ship.angle) * off,
        };
        const pellets = wStats.pellets || 1;
        for (let pi = 0; pi < pellets; pi++) {
          const spreadOffset =
            pellets > 1 ? (pi / (pellets - 1) - 0.5) * (wStats.spread || 0) : 0;
          const a = aim + spreadOffset;
          result.projectiles.push({
            id: Math.random().toString(),
            pos: { ...muzzle },
            vel: {
              x: Math.cos(a) * wStats.speed + ship.vel.x * 0.5,
              y: Math.sin(a) * wStats.speed + ship.vel.y * 0.5,
            },
            owner: seat.ownerId === world.localOwnerId ? 'player' : 'enemy',
            ownerId: ship.ownerId,
            life: wStats.life,
            damage: wStats.damage * dmgScale,
            kind: weaponId || undefined,
            pierce: wStats.pierce,
            size: wStats.size,
            hitIds: wStats.pierce ? [] : undefined,
          });
        }
      }
      ship.fireReadyAt = world.time + wStats.cooldownMs;
    }
  }

  return result;
};
