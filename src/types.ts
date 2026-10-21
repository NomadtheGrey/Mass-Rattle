import type { ShipLine, TypeTier } from './shipProgression';
import type { MatchEndReason, Standing, TeamId } from './net/protocol';
import type { EventFeedRecord } from './sim/eventFeed';

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
  /** Seat-scoped ownerId (Phase 2, src/sim/ownership.ts): the seat
   * that owns this entity for the whole match, whoever controls it. */
  ownerId: string;
  /** performance.now() timestamp before which the equipped weapon cannot fire again. */
  fireReadyAt?: number;
  /** SUBMARINE (src/sim/stealth.ts): SECONDS REMAINING of the
   * periscope reveal — firing or laying mines while cloaked sets
   * it to ~2.0 and the sim counts it down per frame (Adam's
   * ruling, 2026-10-21). A countdown, not a timestamp: it rides
   * snapshots and reads identically on every clock. Absent/0 =
   * cloak as usual. */
  cloakReveal?: number;
  /** Deflector Shield: current pool and the last time it took a hit (loop clock). */
  shield?: number;
  shieldHitAt?: number;
  /** Point-Defense Zap: next-ready time and the last zap's target (for the canvas arc). */
  pdReadyAt?: number;
  pdZapAt?: number;
  pdZapTarget?: Vector2D;
  /** Scrap Aegis: leftover damage-soak credit from the last burned scrap,
   * so fractional damage (star burn) burns cargo at the table's rate
   * instead of a whole scrap per frame. Loop-managed. */
  aegisCredit?: number;
  /** Kill attribution (Phase 2, P2-2b): the ownerId of the seat whose
   * weapon/wave last damaged this ship. Bookkeeping only — read by the
   * kill crediting pass, never by behavior. */
  lastHitByOwnerId?: string;
  // Arsenal (see src/loadout.ts): item id -> owned tier (0/absent = not owned),
  // and the one equipped item id per category (null = slot empty).
  arsenal: Record<string, number>;
  loadout: { weapon: string | null; defense: string | null; hybrid: string | null };
  upgrades: {
    thrust: number;
    handling: number;
    attractor: number;
    fuelCap: number;
    cargo: number;
  };
  // Ship progression (Phase 3, src/shipProgression.ts — DRAFT numbers).
  // Per-match state only, like everything else on the ship.
  /** The ship's line; null at spawn (unaligned SKIFF). The T2 purchase
   * chooses it; switchLine moves a T2+ ship sideways for a toll. */
  line: ShipLine | null;
  /** Type tier within the line, 1..4 (T1 is the SKIFF for every line). */
  typeTier: TypeTier;
  /** Hull steps grown inside the current progression: size is
   * 15 + 2 x hullSteps, each step also +10 max health. Steps PERSIST
   * across type-ups and line switches; the current line/type's
   * hullStepCap only gates buying MORE steps. */
  hullSteps: number;
  /** Lifetime line switches this match (the first switch is free). */
  lineSwitchesUsed: number;
  /** Turret mounts OWNED (Arsenal slice 2, 2026-10-21): bought one
   *  at a time in the workshop up to the current type's cap (the
   *  autoGuns field, read via effectiveAutoGuns). Per-match ship
   *  property like the arsenal: the fresh starter frame after a
   *  death carries none. Persists across type/line changes — caps
   *  gate buying and firing, never strip what is owned. */
  turretMounts: number;
}

export interface Projectile {
  id: string;
  pos: Vector2D;
  vel: Vector2D;
  owner: 'player' | 'enemy';
  /** Seat-scoped ownerId (Phase 2, src/sim/ownership.ts): the seat
   * that owns this entity for the whole match, whoever controls it. */
  ownerId: string;
  life: number;
  /**
   * Ship-weapon fields (Slice 4). Where a field is absent, readers fall
   * back to PHYSICS.DEFENSE.DAMAGE, so old behavior is preserved.
   * Star turret bolts (Phase 1c) set `damage` (tier-scaled, from
   * starDefense.ts) but leave `kind` undefined — the drone-collision
   * gate keys on `kind`, which is how turret bolts keep their historic
   * pass-through behavior against drones while ship weapons connect.
   */
  damage?: number;
  /** Weapon id that fired this (drives special effects, e.g. ion stun). */
  kind?: string;
  /** Rail Lance: pass through targets instead of dying on the first hit. */
  pierce?: boolean;
  /** Drone/star ids this piercing projectile has already hit. */
  hitIds?: string[];
  /** Drawn head size on the canvas. */
  size?: number;
}

/** A proximity mine laid by the Mine Layer weapon (Slice 4). */
export interface Mine {
  id: string;
  pos: Vector2D;
  /** Seat-scoped ownerId (Phase 2, src/sim/ownership.ts): the seat
   * that owns this entity for the whole match, whoever controls it. */
  ownerId: string;
  /** Hull damage dealt to everything hostile inside `radius`. */
  damage: number;
  radius: number;
}

/**
 * One turret on a star's defense ladder (Phase 1c, src/starDefense.ts).
 * The canvas draws hubs from this list verbatim. `angle` is the
 * turret's fixed position on its shell ring around the star, in
 * radians, ABSOLUTE (no starOrbit rotation baked in); the ring radius
 * derives from the star's size — see PHYSICS.STAR_DEFENSE.
 */
export interface StarTurret {
  shell: 'inner' | 'outer';
  angle: number;
  tier: number;
}

export interface Star extends GameObject {
  mass: number;
  totalScrapInfused: number;
  /**
   * Growth base radius (P2-4): this star's size at 0 milestones.
   * Every current radius derives from it deterministically in
   * src/sim/starStages.ts — the physical size (growth curve, then
   * the NEUTRON collapse) and the effective/well radius (the
   * un-shrunk curve) — and the game loop reconciles `size` to that
   * derivation every frame, so `size` is never edited by hand.
   * Factories set it: 40 for match stars and the SP home star; the
   * SP enemy star starts pre-grown at 120.
   */
  baseSize: number;
  type: 'home' | 'enemy';
  /** Seat-scoped ownerId (Phase 2, src/sim/ownership.ts): the seat
   * that owns this entity for the whole match, whoever controls it. */
  ownerId: string;
  integrity: number; // 0 to 1
  /**
   * The star's defense-ladder turrets. A deterministic function of the
   * star's milestone count (turretsForMilestones in starDefense.ts) —
   * the game loop reconciles this list to that function every frame,
   * so it is never edited by hand and needs no save/sync bookkeeping.
   */
  turrets: StarTurret[];
  lastHitTime?: number;
  /** CME timers (Slice 7), on the game loop's clock: next scheduled fire,
   * the end of the current charge telegraph, and the locked aim angle. */
  cmeNextAt?: number;
  cmeChargeEndsAt?: number;
  cmeAimAngle?: number;
}

/**
 * A CME wavefront in flight (Slice 7). It expands from its star at a
 * fixed speed and DISSIPATES: damage and knockback scale with
 * (1 - radius / maxRange), so distance — or outrunning it — is defense.
 * dirAngle null = all-directional (radial) expansion.
 */
export interface CmeWave {
  id: string;
  owner: 'home' | 'enemy';
  /** Seat-scoped ownerId (Phase 2, src/sim/ownership.ts): the seat
   * that owns this entity for the whole match, whoever controls it. */
  ownerId: string;
  pos: Vector2D;
  dirAngle: number | null;
  radius: number;
  speed: number;
  maxRange: number;
  baseDamage: number;
  baseKnockback: number;
  milestone: number;
  /** Ids already struck by this wave ('ship', 'decoy', or drone ids). */
  hitIds: string[];
}

export interface Scrap {
  pos: Vector2D;
  color: string;
  id: string;
}

export interface DeployedCargo extends Scrap {
  vel: Vector2D;
  life: number;
  /** Seat-scoped ownerId (Phase 2, src/sim/ownership.ts): the seat
   * that owns this entity for the whole match, whoever controls it. */
  ownerId: string;
}

export interface Harvester {
  id: string;
  // Drones gain health with the Arsenal slices: ship weapons need something
  // to damage. 100 = a fresh drone; destroyed drones drop their cargo as scrap.
  health: number;
  pos: Vector2D;
  vel: Vector2D;
  angle: number;
  targetId: string | null;
  carrying: number;
  capacity: number;
  owner: 'player' | 'enemy';
  /** Seat-scoped ownerId (Phase 2, src/sim/ownership.ts): the seat
   * that owns this entity for the whole match, whoever controls it. */
  ownerId: string;
  state: 'searching' | 'collecting' | 'returning';
  /** Defense mode (Arsenal slice 3, 2026-10-21): a drone with
   *  mode 'defense' never harvests — it stations on its owner's
   *  ship (or home star) and engages hostiles in range (see
   *  sim/drones.ts + DEFENSE_DRONE in shipProgression.ts). Absent
   *  = an ordinary harvester; every pre-slice-3 drone is one. */
  mode?: 'defense';
  /** Ion Blaster effect: frames remaining where this drone is rebooting (no movement). */
  stunFrames?: number;
  /** Kill attribution (Phase 2, P2-2b): the ownerId of the seat whose
   * weapon/wave/mine last damaged this drone. The drone-death sweep
   * credits that seat's kill count. Bookkeeping only. */
  lastHitByOwnerId?: string;
}

/**
 * PER-SEAT SIM STATE (Phase 2, P2-2b). One record per seat in the
 * match: its star, its ship (null while shipless — the SP enemy seat
 * flies no ship, and a seat whose ship was destroyed stays null until
 * the death economy answers, P2-5), its bank, and its match record.
 *
 * The GameState top-level fields (ship / star / enemyStar /
 * bankedScrap / teamScrap) remain the LOCAL seat's view and are the
 * SAME object references as seats[0].ship / seats[0].star /
 * seats[1].star — the loop rebuilds the seat projection from the
 * frame's working copies every frame, so components keep reading the
 * top-level fields exactly as they always have.
 */
export interface SeatSimState {
  /** Seat-scoped ownerId (`seat-<starIndex>`); never changes. */
  ownerId: string;
  starIndex: number;
  /** The seat's team (TEAMS, Adam 2026-10-21): hostility and
   *  cross-feeding key on this, not on ownerId (src/sim/teams.ts).
   *  Defaults to the seat's own color-team; the room's resolved
   *  teams thread in through match assembly. */
  teamId: TeamId;
  /** Who drives this seat's ship: a human's input or the bot driver. */
  controller: 'human' | 'bot';
  ship: Ship | null;
  star: Star;
  /** This seat's banked scrap. Only the local seat's bank is wired to
   * the workshop economy in P2-2b; bot seats bank nothing (their drone
   * and ship deliveries infuse their star directly). */
  bankedScrap: number;
  /** Mirror of star.totalScrapInfused, refreshed by the loop each
   * frame — the star's field is the single source of truth. */
  fedTotal: number;
  /** Ships + drones this seat's weapons/waves/mines have destroyed. */
  kills: number;
  /** Lifetime SHIP deaths this match (Phase 2, P2-5 death economy).
   * Star deaths are eliminations, not counted here. Drives the
   * repurchase price's value step-down and distinguishes a seat
   * that is shipless because its ship died (deaths > 0) from one
   * that never flew (SP's enemy seat: ship null, deaths 0). */
  deaths: number;
  /** Loop-clock timestamp (the frame's rAF clock) when the seat's
   * current shiplessness began; set by the death sweep, cleared on
   * repurchase. Bot seats auto-repurchase off this stamp. Absent
   * while the seat has a ship. */
  shipLostAt?: number;
  /** DEATH TAX (Adam, 2026-10-21): loop-clock timestamp when a PAID
   * repurchase's ship arrives. Set at payment by tryRepurchase when
   * the price was > 0 — the seat stays shipless until the frame
   * clock reaches it, then the loop spawns the frame. Absent while
   * no paid buy-back is pending; the FREE floor (price 0) never
   * sets it — broke players spawn at once. */
  respawnAt?: number;
  /** The full death-tax wait stamped at payment (ms), alongside
   * respawnAt: the overlay's countdown total. Guests read the pair
   * off snapshots (their own clock is not the host's loop clock, so
   * the total + first-sight is their countdown basis). */
  respawnWaitMs?: number;
  /** Total time this seat has SURVIVED this match (ms, loop clock),
   * accrued per frame while it has a ship and is not eliminated;
   * never reset by death — survival is banked across lives. Read
   * only by the death tax: each full SURVIVAL_MS_PER_TAX_STEP of it
   * forgives one death-step of the respawn wait's growth (Adam,
   * 2026-10-21: the tax decays through honest play). */
  survivalMs?: number;
  /** A seat is eliminated when its STAR dies (Adam's ruling: ship
   * death is not elimination). */
  eliminated: boolean;
  /** 1 = first seat eliminated this match; null while standing. */
  eliminationOrder: number | null;
}

/**
 * Match-end DATA (Phase 2, P2-2b) — the sim's record that an end
 * condition has been reached. P2-4 adds the collapse-cinematic
 * bookkeeping the protocol's matchEnded carries: the fields below
 * are stamped once, at derivation (src/sim/seatState.ts), and the
 * host's wire announce reads them from here verbatim — the wire
 * shape is protocol.ts's MatchEndedEvent, unchanged.
 */
export interface MatchEndState {
  endReason: MatchEndReason;
  winnerOwnerId: string;
  /** Critical-mass ends: ship inputs stop applying while the
   * collapse cinematic runs (the loop's input phase enforces it).
   * Stamped false for last-survivor ends, which lock nothing. */
  inputLockout?: boolean;
  /** Critical-mass ends only: `star-<starIndex>` of the collapsing
   * star — by the match-end law that is the WINNER's star (the one
   * that reached BLACK HOLE). */
  collapsingStarId?: string;
  /** Critical-mass ends only: when the cinematic began, ms epoch —
   * the protocol's shared clock, so every client freezes together
   * and the lockout window (starStages.CINEMATIC_DURATION_MS) is
   * measured on it. */
  cinematicStartedAt?: number;
}

export interface GameState {
  ship: Ship;
  star: Star;
  enemyStar: Star;
  /** Per-seat sim state (Phase 2, P2-2b). seats[0] is the local seat;
   * its ship/star are the same objects as the top-level fields. */
  seats: SeatSimState[];
  /** Host-computed standings (src/sim/standings.ts), refreshed every
   * frame. Plain data in protocol.ts's Standing shape. */
  standings: Standing[];
  /** Host event feed records (src/sim/eventFeed.ts), oldest-to-newest.
   * Plain serializable data — the accumulator lives in the feed
   * module's pure helpers, never in state. */
  eventFeed: EventFeedRecord[];
  /** Set once when a star-elimination or critical-mass end condition
   * is reached; null while the match is undecided. */
  matchEnd: MatchEndState | null;
  scrap: Scrap[];
  deployedCargo: DeployedCargo[];
  projectiles: Projectile[];
  /** Proximity mines laid by the player (Mine Layer weapon). */
  mines: Mine[];
  /** Active Decoy Beacon, if one is deployed (Decoy Beacon defense). */
  decoy: { pos: Vector2D; health: number; lifeFrames: number; ownerId: string } | null;
  /** CME wavefronts currently in flight from either star (Slice 7). */
  cmes: CmeWave[];
  drones: Harvester[];
  starOrbit: number;
  enemyStarOrbit: number;
  teamScrap: number;
  // THE BANK (Adam, 2026-10-19): scrap saved up OUTSIDE the cargo hold.
  // Banked scrap is NOT auto-fed to the home star on delivery flybys and
  // does not count toward feeding milestones until it is withdrawn into
  // the hold and actually delivered. Shop purchases draw on a combined
  // wallet: hold first, then bank (see useGameLoop walletPay).
  bankedScrap: number;
  isShopOpen: boolean;
  /** Set when a shop-open attempt is refused (outside the star's well);
   * the HUD shows a "return to your star" hint briefly after this time. */
  shopRefusedAt?: number;
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
