/**
 * SOLO SAVE (Adam, 2026-10-23): periodic saves in solo — stupid
 * simple by his pin ('solo can be stupid simple. The fun is
 * multiplayer'). One slot in this browser's localStorage, written
 * every few seconds while a solo match runs and again as the page
 * hides; read once at boot; a saved match simply resumes.
 *
 * WHAT RIDES: the whole GameState — both seats with their ships
 * (upgrade tracks, line, tier, hull steps, arsenal — the ship IS
 * the save), both stars, banks, drones, escorts, the scrap field.
 * WHAT DOES NOT: in-flight transients (projectiles, mines, CME
 * fronts, wreck tombstones, a live decoy) and the loop-clock stamps
 * (respawn timers, refusal hints) — a fresh page runs a fresh
 * clock, so stamps from the old one would read as far-future.
 * The bot captain's patrol memory lives in driver-held Maps, not
 * in state; he re-scouts after a resume. That is accepted.
 *
 * Solo only, by the caller's guards: this module never runs in a
 * room, and a finished match (matchEnd set) is never saved and
 * never restored — the next load starts fresh.
 */
import type { GameState } from './types';

export const SOLO_SAVE_KEY = 'mr.soloSave.v1';
const SOLO_SAVE_VERSION = 1;

/** The saveable shape of a live solo state, or null if the match
 *  is over / not a solo pair. Pure — the suite tests this. */
export const sanitizeSoloState = (s: GameState): GameState | null => {
  if (!s || s.matchEnd || s.isGameOver) return null;
  if (!Array.isArray(s.seats) || s.seats.length !== 2) return null;
  if (!s.seats[0]?.ship || !s.seats[0]?.star || !s.seats[1]?.star) return null;
  const c = JSON.parse(JSON.stringify(s)) as GameState;
  // In-flight transients do not ride.
  c.projectiles = [];
  c.mines = [];
  c.cmes = [];
  c.wrecks = [];
  c.decoy = null;
  // Loop-clock stamps do not ride (fresh page, fresh clock).
  delete c.shopRefusedAt;
  delete c.lastEjectTime;
  c.lastUpgradeTime = 0;
  c.lastGlitchTime = 0;
  c.glitchActive = false;
  c.shakeAmount = 0;
  c.isShopOpen = false;
  for (const seat of c.seats) {
    // Death-clock stamps restart at the fresh page's zero: a paid
    // respawn comes due at once, a bot's buy-back wait counts from
    // the resume. (DELETING shipLostAt would strand a shipless bot
    // forever — its auto-repurchase requires the stamp to exist.)
    if (seat.respawnAt !== undefined) seat.respawnAt = 0;
    if (seat.shipLostAt !== undefined) seat.shipLostAt = 0;
  }
  // The identity invariant, re-linked: the seat copies are
  // canonical; the top-level fields point at them.
  c.ship = c.seats[0].ship!;
  c.star = c.seats[0].star;
  c.enemyStar = c.seats[1].star;
  return c;
};

export const saveSoloGame = (s: GameState): void => {
  try {
    const clean = sanitizeSoloState(s);
    if (!clean) return;
    window.localStorage.setItem(
      SOLO_SAVE_KEY,
      JSON.stringify({ v: SOLO_SAVE_VERSION, state: clean }),
    );
  } catch { /* storage unavailable — solo simply doesn't persist */ }
};

export const loadSoloGame = (): GameState | null => {
  try {
    const raw = window.localStorage.getItem(SOLO_SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: number; state?: GameState };
    if (parsed?.v !== SOLO_SAVE_VERSION || !parsed.state) return null;
    const clean = sanitizeSoloState(parsed.state);
    if (!clean) return null;
    // A corrupted coordinate anywhere vital means a fresh start,
    // never a NaN ship.
    const p = clean.ship.pos;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    return clean;
  } catch { return null; }
};

export const clearSoloGame = (): void => {
  try { window.localStorage.removeItem(SOLO_SAVE_KEY); } catch { /* no-op */ }
};
