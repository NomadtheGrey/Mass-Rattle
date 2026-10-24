/**
 * SIM EVENTS (sounds pass, Adam 2026-10-24) — the one clean hook the
 * audio layer subscribes to. Plain data only: NO audio code lives
 * here or anywhere in the sim. The loop collects one event per
 * gameplay moment during a frame and drains the frame's list after
 * the frame, two ways: locally to registered listeners (solo + host)
 * and, on the host, attached to the snapshot for guests.
 *
 * CONTRACT (workshopped with UI, FINAL 2026-10-24 after the flip
 * history — in, out, in, out — settled on OUT): the shape is flat
 * { type, ownerId?, x?, y?, size? }, and type is a voice-family
 * name from AudioLayer's VoiceType MINUS the layer-side voices
 * (thrust is input-gated in the layer, ui + chat are layer-side,
 * win/lose come from App's isVictory/isGameOver props — NO match_end
 * event, exactly one source for the stingers, no double trigger).
 * The sim defines its own union mirroring those names — same
 * strings, no import from a .tsx, so the sim stays audio-free.
 * weaponId rides fire events for later per-class pitch; v1 plays
 * one uniform fire voice. Earshot (800, full ≤250, linear falloff)
 * and loudness are the LAYER's job — the sim carries no loudness
 * and no hearing rule. Snapshot batches cap at
 * SIM_EVENT_SNAPSHOT_CAP (DRAFT); oldest dropped past the cap.
 */
import { milestonesForInfused } from '../starGrowth';
import type { GameState } from '../types';

export type SimEventType =
  | 'fire'
  | 'hit'
  | 'explosion'
  | 'scoop'
  | 'bank'
  | 'feed'
  | 'buy'
  | 'climb'
  | 'milestone'
  | 'starDamage'
  | 'cme'
  | 'decoy'
  | 'dock';

export interface SimEvent {
  type: SimEventType;
  /** Owning seat for seat-scoped events (fire, hit, explosion, ...). */
  ownerId?: string;
  /** World position, for the layer's distance gate. */
  x?: number;
  y?: number;
  /** Hull/star size at the event (explosion scale, star identity). */
  size?: number;
  /** Firing weapon class, on fire events only (later pitch). */
  weaponId?: string;
}

export const SIM_EVENT_SNAPSHOT_CAP = 48;

/**
 * FRAME-BOUNDARY DIFF (sounds pass) — the loop's frame updater stays
 * side-effect free, so events derive HERE from two committed states,
 * never from pushes inside the step. The loop calls this once per
 * frame (host + solo) with the last rendered state vs the previous
 * tick's, emits the result locally, and (host only) accumulates it
 * for the snapshot batch. Rules are transition-shaped on purpose:
 * only a change that a fresh match cannot fake emits, so a match
 * reset, a promotion, or a save restore stays silent — EXCEPT one
 * accepted blip: a ship docked at a reset undocks silently in the
 * new match, which reads as one dock event. Every rule can only
 * MISS (a shared nested object hides a change); none can invent an
 * event, because a value cannot differ between two states that
 * share the object. Copy-on-write in the frame (seats, ships, stars,
 * arsenal, upgrades all replaced, never mutated in place) is what
 * makes the diff see anything at all.
 *
 * Per kind, prev → next:
 * - fire: a projectile id present in next, absent in prev. Turret
 *   bolts carry no kind, so weaponId is omitted for them.
 * - hit: a seat ship's health strictly down. Ship damage is always
 *   discrete (projectiles, once-per-wave CME washes); nothing
 *   damages a ship per frame, so no threshold is needed.
 * - explosion: a seat ship present in prev, null in next (death
 *   nulls the ship and stamps shipLostAt in the same frame).
 * - scoop: a ship's or drone's carrying strictly up (collection
 *   fills the hold; delivery empties it, so only ups count).
 * - bank: a seat's bankedScrap strictly up.
 * - feed: a seat star's totalScrapInfused strictly up.
 * - buy: any arsenal tier or track level strictly up (one event per
 *   seat per frame at most — purchases are one per frame in
 *   practice, and a burst still deserves only one blip).
 * - climb: a seat ship's typeTier strictly up, or its line changed.
 * - milestone: milestonesForInfused(totalScrapInfused) strictly up.
 * - starDamage: a seat star's integrity strictly down.
 * - cme: a CME id present in next, absent in prev.
 * - decoy: decoy null in prev, set in next (single object, not a
 *   list — deployment is the null → set edge).
 * - dock: a seat ship's dockedTo set ↔ unset edge, either way.
 * Escort hits/deaths are skipped in v1 (no stable per-escort
 * identity to diff on); escort fire still sounds via projectiles.
 */
export function diffSimEvents(prev: GameState | null, next: GameState): SimEvent[] {
  if (!prev) return [];
  const events: SimEvent[] = [];
  const prevSeats = new Map(prev.seats.map(s => [s.ownerId, s]));
  const prevProjIds = new Set(prev.projectiles.map(p => p.id));
  const prevCmeIds = new Set(prev.cmes.map(c => c.id));
  const prevDrones = new Map(prev.drones.map(d => [d.id, d]));

  for (const p of next.projectiles) {
    if (!prevProjIds.has(p.id)) {
      events.push({
        type: 'fire',
        ownerId: p.ownerId,
        x: p.pos.x,
        y: p.pos.y,
        ...(p.kind ? { weaponId: p.kind } : {}),
      });
    }
  }
  for (const c of next.cmes) {
    if (!prevCmeIds.has(c.id)) {
      events.push({ type: 'cme', ownerId: c.ownerId, x: c.pos.x, y: c.pos.y });
    }
  }
  if (!prev.decoy && next.decoy) {
    events.push({
      type: 'decoy',
      ownerId: next.decoy.ownerId,
      x: next.decoy.pos.x,
      y: next.decoy.pos.y,
    });
  }

  for (const seat of next.seats) {
    const ps = prevSeats.get(seat.ownerId);
    if (!ps) continue;
    const ship = seat.ship;
    const prevShip = ps.ship;
    if (ship && prevShip) {
      if (ship.health < prevShip.health) {
        events.push({ type: 'hit', ownerId: seat.ownerId, x: ship.pos.x, y: ship.pos.y, size: ship.size });
      }
      if (ship.carrying > prevShip.carrying) {
        events.push({ type: 'scoop', ownerId: seat.ownerId, x: ship.pos.x, y: ship.pos.y });
      }
      const buy =
        Object.keys({ ...prevShip.arsenal, ...ship.arsenal }).some(
          w => (ship.arsenal[w] || 0) > (prevShip.arsenal[w] || 0),
        ) ||
        Object.keys({ ...prevShip.upgrades, ...ship.upgrades }).some(
          t =>
            (ship.upgrades as unknown as Record<string, number>)[t] >
            (prevShip.upgrades as unknown as Record<string, number>)[t],
        );
      if (buy) {
        events.push({ type: 'buy', ownerId: seat.ownerId, x: ship.pos.x, y: ship.pos.y });
      }
      if (ship.typeTier > prevShip.typeTier || ship.line !== prevShip.line) {
        events.push({ type: 'climb', ownerId: seat.ownerId, x: ship.pos.x, y: ship.pos.y });
      }
      if (!!prevShip.dockedTo !== !!ship.dockedTo) {
        events.push({ type: 'dock', ownerId: seat.ownerId, x: ship.pos.x, y: ship.pos.y });
      }
    }
    if (prevShip && !ship) {
      events.push({
        type: 'explosion',
        ownerId: seat.ownerId,
        x: prevShip.pos.x,
        y: prevShip.pos.y,
        size: prevShip.size,
      });
    }
    if (seat.bankedScrap > ps.bankedScrap) {
      const at = ship ?? seat.star;
      events.push({ type: 'bank', ownerId: seat.ownerId, x: at.pos.x, y: at.pos.y });
    }
    if (seat.star.totalScrapInfused > ps.star.totalScrapInfused) {
      events.push({
        type: 'feed',
        ownerId: seat.ownerId,
        x: seat.star.pos.x,
        y: seat.star.pos.y,
        size: seat.star.size,
      });
    }
    if (
      milestonesForInfused(ps.star.totalScrapInfused) <
      milestonesForInfused(seat.star.totalScrapInfused)
    ) {
      events.push({
        type: 'milestone',
        ownerId: seat.ownerId,
        x: seat.star.pos.x,
        y: seat.star.pos.y,
        size: seat.star.size,
      });
    }
    if (seat.star.integrity < ps.star.integrity) {
      events.push({
        type: 'starDamage',
        ownerId: seat.ownerId,
        x: seat.star.pos.x,
        y: seat.star.pos.y,
        size: seat.star.size,
      });
    }
  }
  for (const d of next.drones) {
    const pd = prevDrones.get(d.id);
    if (pd && d.carrying > pd.carrying) {
      events.push({ type: 'scoop', ownerId: d.ownerId, x: d.pos.x, y: d.pos.y });
    }
  }
  return events;
}

export type SimEventListener = (events: SimEvent[]) => void;

const listeners = new Set<SimEventListener>();

/** The audio layer calls this once on mount. Returns unsubscribe. */
export function onSimEvents(cb: SimEventListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** The loop calls this once per frame with the drained list. The
 *  drain semantics stay the loop's: listeners are notified whether
 *  or not anyone is subscribed, and the list is never retained. */
export function emitSimEvents(events: SimEvent[]): void {
  if (events.length === 0 || listeners.size === 0) return;
  for (const cb of listeners) cb(events);
}
