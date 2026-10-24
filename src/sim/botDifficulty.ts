/**
 * BOT DIFFICULTY LADDER (Adam, 2026-10-24) — one home for the rungs,
 * read by the driver (tuning) and the picker (labels + blurbs) alike,
 * so the choice the player reads is the behavior the bot gets.
 *
 * The complaint that built it: on a phone, the bot shot with perfect
 * aim from beyond the visible field, thirty seconds into a solo
 * match. The driver's old constants ARE the top rung, preserved
 * untouched — IMPOSSIBLE is today's bot, exactly. Lower rungs soften
 * the three combat levers that made it feel unfair: aim error (each
 * bolt veers by up to this many radians), fire range (the driver only
 * opens fire inside it), and aggro range (how far away a hostile
 * becomes something worth hunting). Everything else — defend ranges,
 * siege standoff, repair disposition, economy cadence, escort fire —
 * stays at today's values on every rung for v1; those are follow-up
 * dials, not silent passengers.
 *
 * All numbers DRAFT, Adam's pin pending.
 */
import type { BotDifficulty } from '../net/protocol';

export interface BotDifficultyParams {
  /** Per-bolt aim error, radians each way (0 = mathematically exact). */
  aimErrorRad: number;
  /** The driver only opens fire inside this distance. */
  fireRange: number;
  /** A hostile ship inside this distance becomes a hunt objective. */
  aggroRange: number;
}

export const BOT_DIFFICULTY: Record<BotDifficulty, BotDifficultyParams> = {
  rookie: { aimErrorRad: 0.1, fireRange: 360, aggroRange: 550 },
  seasoned: { aimErrorRad: 0.045, fireRange: 450, aggroRange: 750 },
  veteran: { aimErrorRad: 0.015, fireRange: 520, aggroRange: 1000 },
  // IMPOSSIBLE is today's bot, exactly: BOT_DRIVER.FIRE_RANGE (520)
  // and BOT_DRIVER.AGGRO_RANGE (1000), zero aim error.
  impossible: { aimErrorRad: 0, fireRange: 520, aggroRange: 1000 },
};

export const BOT_DIFFICULTY_ORDER: BotDifficulty[] = [
  'rookie',
  'seasoned',
  'veteran',
  'impossible',
];

/** Player-readable choice copy — plain words, never stats. The
 *  picker renders label + blurb per rung; the board shows the label. */
export const BOT_DIFFICULTY_META: Record<
  BotDifficulty,
  { label: string; blurb: string }
> = {
  rookie: {
    label: 'ROOKIE',
    blurb:
      'Bots miss often, only fight what is close by, and will not chase you across the map. Learn the ropes.',
  },
  seasoned: {
    label: 'SEASONED',
    blurb:
      'Bots shoot straighter and roam further. A fair fight.',
  },
  veteran: {
    label: 'VETERAN',
    blurb:
      'Bots barely miss and hunt hard. Bring your best game.',
  },
  impossible: {
    label: 'IMPOSSIBLE',
    blurb:
      'Perfect aim, full range, no mercy. The bot as it plays today.',
  },
};
