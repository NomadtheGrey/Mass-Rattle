/**
 * Host-side event feed (Phase 2).
 *
 * A pure accumulator for the match's story — feed milestones, stage
 * changes, eliminations, kills — as typed DATA the host can emit to
 * clients (the UI lane renders its own strings from these; no display
 * text lives here). This module is deliberately NOT wired into the game
 * loop in P2-2a: the loop produces these events in P2-2b/P2-3, when the
 * per-seat sim exists to attribute them.
 *
 * The feed is a bounded ring buffer: it keeps the most recent
 * `capacity` entries, each stamped with a monotonically increasing
 * `seq` (starting at 1) that never repeats, even across evictions.
 */

import type { StarStage } from '../net/protocol';

export type EventFeedEntry =
  | {
      type: 'feed_milestone';
      ownerId: string;
      starId: string;
      /** The milestone the star just crossed. */
      milestone: number;
      /** The star's total infused scrap after the crossing delivery. */
      fedTotal: number;
      /** Loop/host clock timestamp, when the caller has one. */
      at?: number;
    }
  | {
      type: 'stage_change';
      ownerId: string;
      starId: string;
      fromStage: StarStage;
      toStage: StarStage;
      milestone: number;
      progressWithinStage: number;
      at?: number;
    }
  | {
      type: 'elimination';
      ownerId: string;
      starId: string;
      /** 1 = first star eliminated this match. */
      eliminationOrder: number;
      at?: number;
    }
  | {
      type: 'kill';
      /** Null when the environment (a star, a CME) did the killing. */
      killerOwnerId: string | null;
      victimOwnerId: string;
      victimKind: 'ship' | 'drone' | 'star';
      at?: number;
    };

export type EventFeedRecord = EventFeedEntry & { seq: number };

export interface EventFeed {
  /** Append an entry; returns the stored record (entry + its seq). */
  add: (entry: EventFeedEntry) => EventFeedRecord;
  /** Oldest-to-newest copy of the entries currently retained. */
  snapshot: () => EventFeedRecord[];
  clear: () => void;
  readonly size: number;
}

/**
 * Pure append over a plain record list (P2-2b): GameState stores the
 * feed as serializable EventFeedRecord[] — never the closure
 * accumulator above — so the loop folds each frame's new entries in
 * with this helper. Seq continues from the last retained record, so
 * it never repeats even across evictions. Returns the SAME array
 * reference when there is nothing to add.
 */
export const appendEventRecords = (
  records: EventFeedRecord[],
  entries: EventFeedEntry[],
  capacity: number = 100,
): EventFeedRecord[] => {
  if (entries.length === 0) return records;
  const cap = Math.max(1, Math.floor(capacity));
  let seq = records.length > 0 ? records[records.length - 1].seq : 0;
  const added: EventFeedRecord[] = entries.map(
    entry => ({ ...entry, seq: ++seq }) as EventFeedRecord,
  );
  const merged = [...records, ...added];
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
};

export const createEventFeed = (capacity: number = 100): EventFeed => {
  const cap = Math.max(1, Math.floor(capacity));
  let entries: EventFeedRecord[] = [];
  let nextSeq = 1;

  return {
    add: entry => {
      const record: EventFeedRecord = { ...entry, seq: nextSeq++ };
      entries.push(record);
      if (entries.length > cap) {
        entries = entries.slice(entries.length - cap);
      }
      return record;
    },
    snapshot: () => [...entries],
    clear: () => {
      entries = [];
    },
    get size() {
      return entries.length;
    },
  };
};
