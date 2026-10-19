/**
 * THE BANK IS A PLACE — the home star's gravity well (Adam, 2026-10-19)
 * =====================================================================
 * "Let's have the player's star gravity well serve as the bank for now."
 *
 * What that means in the game:
 *  - Banked scrap is stored IN THE WELL: it orbits the home star (the
 *    canvas draws it as motes inside the well ring) instead of living in
 *    an abstract account screen.
 *  - Banking only works INSIDE the well: deposit, withdraw, and any shop
 *    purchase that would draw on banked savings. Outside the well, the
 *    shop spends the cargo hold only — you fly home to refit on savings.
 *  - The well is the band around the star: out to star.size + WELL_MARGIN
 *    from the center. At spawn that is 40 + 280 = 320 units, while the
 *    auto-feed delivery radius is only 80 — so there is a wide ring
 *    where you can bank BEFORE the star eats what you are carrying.
 *    That band is deliberate; it is the "approach the bank" space.
 */

/** How far beyond the star's surface its banking well reaches. */
export const BANK_WELL_MARGIN = 280;

/** True when a position is inside the home star's banking well. */
export const inBankWell = (
  pos: { x: number; y: number },
  starPos: { x: number; y: number },
  starSize: number,
): boolean => {
  const dx = pos.x - starPos.x;
  const dy = pos.y - starPos.y;
  return Math.sqrt(dx * dx + dy * dy) <= starSize + BANK_WELL_MARGIN;
};
