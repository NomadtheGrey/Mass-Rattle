/**
 * ROOM NAME GENERATOR — the ONE source of truth for random room names
 * (Adam, 2026-10-21: a dice button on the create form, "Star Killer /
 * Fat Hauler energy"). This module is shared on purpose: the lobby's
 * dice imports it client-side (instant fill, no network call) and the
 * Worker's blank-name default imports the same generator server-side,
 * so a rolled name and a server-assigned name come from the same
 * lists and can never drift apart. Two-word galactic pulp: any FIRST
 * pairs with any SECOND. Keep names <= 24 chars (the lobby field's
 * maxLength) — the longest current pairing is 17.
 */
export const ROOM_NAME_FIRST: readonly string[] = [
  'Star', 'Fat', 'Iron', 'Void', 'Solar', 'Rogue',
  'Crimson', 'Silent', 'Golden', 'Cosmic', 'Rusty', 'Neon',
  'Lone', 'Savage', 'Electric', 'Hollow', 'Burning', 'Frozen',
  'Astral', 'Velvet', 'Grim', 'Howling', 'Patient', 'Reckless',
  'Ancient', 'Midnight',
];

export const ROOM_NAME_SECOND: readonly string[] = [
  'Killer', 'Hauler', 'Comet', 'Anvil', 'Mule', 'Serpent',
  'Forge', 'Ghost', 'Harvest', 'Vandal', 'Pilgrim', 'Kraken',
  'Barge', 'Warden', 'Tempest', 'Coyote', 'Monolith', 'Drifter',
  'Requiem', 'Jackal', 'Choir', 'Sextant', 'Marrow', 'Tinker',
  'Verdict', 'Lantern',
];

/** A random two-word room name, e.g. "Fat Hauler". */
export const randomRoomName = (rng: () => number = Math.random): string => {
  const first = ROOM_NAME_FIRST[Math.floor(rng() * ROOM_NAME_FIRST.length)];
  const second = ROOM_NAME_SECOND[Math.floor(rng() * ROOM_NAME_SECOND.length)];
  return `${first} ${second}`;
};
