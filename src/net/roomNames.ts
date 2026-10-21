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
 *
 * The lists are the UNION of both lanes' drafts (the UI lane's noun
 * pulp + the BackGround lane's rowdier set, merged 2026-10-21 after
 * the two were briefly written in parallel — the drift this module
 * exists to prevent).
 */
export const ROOM_NAME_FIRST: readonly string[] = [
  'Star', 'Fat', 'Iron', 'Void', 'Solar', 'Rogue',
  'Cosmic', 'Rusty', 'Silent', 'Velvet', 'Crimson', 'Golden',
  'Neon', 'Lone', 'Savage', 'Electric', 'Hollow', 'Burning',
  'Frozen', 'Astral', 'Grim', 'Howling', 'Patient', 'Reckless',
  'Ancient', 'Midnight', 'Ship', 'Nova', 'Plasma', 'Nebula',
  'Lunar', 'Warp', 'Astro', 'Quantum', 'Diesel', 'Thunder',
  'Soggy', 'Angry', 'Drunken', 'Turbo', 'Mega',
];

export const ROOM_NAME_SECOND: readonly string[] = [
  'Killer', 'Hauler', 'Drifter', 'Comet', 'Anvil', 'Mule',
  'Serpent', 'Forge', 'Ghost', 'Harvest', 'Vandal', 'Pilgrim',
  'Kraken', 'Barge', 'Warden', 'Tempest', 'Coyote', 'Monolith',
  'Requiem', 'Jackal', 'Choir', 'Sextant', 'Marrow', 'Tinker',
  'Verdict', 'Lantern', 'Basher', 'Mauler', 'Eater', 'Runner',
  'Wraith', 'Gobbler', 'Smasher', 'Cruiser', 'Wanderer', 'Chomper',
  'Brawler', 'Sneaker', 'Howler', 'Muncher', 'Prowler', 'Grinder',
  'Dasher', 'Lurker', 'Bouncer',
];

/** A random two-word room name, e.g. "Fat Hauler". */
export const randomRoomName = (rng: () => number = Math.random): string => {
  const first = ROOM_NAME_FIRST[Math.floor(rng() * ROOM_NAME_FIRST.length)];
  const second = ROOM_NAME_SECOND[Math.floor(rng() * ROOM_NAME_SECOND.length)];
  return `${first} ${second}`;
};

/**
 * A generated room name that does not duplicate a live room's name
 * (Adam, 2026-10-21: no duplicate names in the lobby). Rolls until
 * the name clears `existingLowerNames` (the live names, lowercased;
 * comparison is case-insensitive — "fat hauler" IS "Fat Hauler" on
 * a lobby list). With 1,845 pairings the re-roll terminates at
 * once in practice; the paranoid fallback suffixes the room code
 * (itself unique) until clear, so this can never spin forever.
 */
export const generateUniqueRoomName = (
  existingLowerNames: ReadonlySet<string>,
  uniqueSuffix: string,
  rng: () => number = Math.random,
): string => {
  for (let i = 0; i < 64; i++) {
    const name = randomRoomName(rng);
    if (!existingLowerNames.has(name.toLowerCase())) return name;
  }
  let candidate = `${randomRoomName(rng)} ${uniqueSuffix}`;
  while (existingLowerNames.has(candidate.toLowerCase())) {
    candidate = `${candidate} ${uniqueSuffix}`;
  }
  return candidate;
};
