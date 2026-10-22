/**
 * DEBUG MODE arming (Adam's tester kit, 2026-10-21).
 *
 * The kit arms ONLY through a deliberate gesture: the page URL
 * carries ?debug=1. Nothing in the UI turns it on, no persisted
 * setting remembers it, and the flag is read once at module load.
 *
 * HARD SAFETY SHAPE (the commission's non-negotiable condition):
 *  - The flag lives HERE, in a module constant — never in game
 *    state, never in a snapshot, never on the wire. A guest's
 *    client cannot arm the host, and a host's flag never travels.
 *  - Arming alone grants nothing: every debug action in the game
 *    loop ALSO refuses while a networked room is joined (host or
 *    guest), so the kit is solo/offline only in effect, not just
 *    in presentation.
 *  - Unarmed builds behave exactly as shipped: the actions exist
 *    in the loop's API but refuse immediately, and the UI surface
 *    (SysCfg's DEV section) renders only when armed.
 */
export const DEBUG_ARMED: boolean =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('debug') === '1';
