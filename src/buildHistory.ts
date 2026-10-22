// BUILD HISTORY (Adam, 2026-10-21): the production builds of Mass
// Rattle, newest first. SYSCFG shows the latest build; its history
// modal lists the last twenty. The game ships as a static bundle, so
// this file IS the build record the game can carry.
//
// MAINTENANCE: every WIP -> main merge prepends ONE entry here as
// part of the landing — title in the landing's own words, detail one
// sentence, ref the PR or commit. Seeded 2026-10-21 from main's real
// history: eleven WIP -> main merges, the Worker stand-up, and the
// eight prototype-era builds that preceded the merge discipline.

export interface BuildEntry {
  date: string; // ISO day, the build's landing date
  ref: string; // PR number or short commit
  title: string;
  detail: string;
}

export const BUILD_HISTORY: BuildEntry[] = [
  { date: '2026-10-22', ref: 'PR #31', title: 'HARBORS, JUDGMENT, AND HONEST WRECKS', detail: 'Allied ships berth in a teammate’s harbor and mend from the host’s hold. Bots gain judgment: postures for the hunt, the defense and the fallback, a repair disposition of their own — and honest wallets that bank, save and buy at real prices, while guests buy through the same seat shop. Death pays honestly: cargo drops whole and every hull rolls the salvage ladder against what it was worth, the field littered with cooling shards under a tombstone. The settled controls map lands whole — fixed-order weapon selection that pays its swap fee, Tab’s target lock, and the panicked dump-all behind the ship.' },
  { date: '2026-10-22', ref: 'PR #29', title: 'THE FLEET SAILS, THE CREWS OBEY, THE HULLS MEND', detail: 'Stars grow their own harvester fleets by evolution and haulers gain workforce orders — feed the star or bank the load, shelved off-hull. T5 CME hardening becomes total immunity. Hull switching sells what the new hull cannot hold at full price, and liquidated harvesters fly one last trip home to bank their cargo and themselves. Damage Control arrives: ships mend from the hold (on by default, guns up), hurt harvesters dock inside their ship, escorts mend alongside their carrier — and every drone hull drops to 30, two and a half bolt shots. The well is audited as the only market, and the system docs become a per-system ledger.' },
  { date: '2026-10-21', ref: 'PR #27', title: 'THE ARSENAL COMPLETES + THE NAME IS KEPT', detail: 'The arsenal program finishes: turret mounts are bought to fill their caps, haulers take the harvester crown with a defense pair of their own, an unmountable weapon shelves instead of stranding on a line switch, enemy ships hunt and besiege, and the carrier fields an eleven-ship wing of real little hulls on a guard leash. Testers gain a solo-only debug kit (?debug=1), ping and framerate move to the play field’s top-right, and the reserved name hardens: any callsign containing NOMAD is refused without its password — no more quiet suffixes.' },
  { date: '2026-10-21', ref: 'PR #25', title: 'THE ARSENAL OPENS + FIRST WORDS', detail: 'Weapons gain classes and a mounting matrix — fighters and cruisers open the whole arsenal by T3, the quiet lines stay light, and the fighter’s hull caps drop to the lightest in the game. Rooms learn to talk: seat-stamped chat in the lobby and in-match, the last fifty lines kept. Turrets step out of the corona (surface standoff 45/110, hubs drawn lit, last), and the painted hulls’ green edge becomes hit feedback instead of furniture.' },
  { date: '2026-10-21', ref: 'PR #23', title: 'BEAUTIFUL SHIPS + THE CROWNS', detail: 'Painted sprites for all 21 hulls over the honest outlines; T5 crowns on every line — WARMONGER, NAUTILUS, ATLAS, MOTHERSHIP, DREADNOUGHT — with VANGUARD interpolated and the hauler’s MAMMOTH renamed; the minelayer becomes the submarine (proximity cloak, the periscope moment, turrets respect it); turret orbits pinned at five seconds; turning becomes a per-line character; the name Nomad is reserved by password; Options and this very history arrive.' },
  { date: '2026-10-21', ref: 'PR #21', title: 'ARMED BUTTONS + REAL GLASS', detail: 'Armed buttons read armed — the CTAs own their colors; glass panels lighten to blue-grey. The callsign field starts empty, “Nomad” becomes a reserved name, and alt-tab can no longer steal your ship.' },
  { date: '2026-10-21', ref: 'PR #19', title: 'THE FIELD MANUAL ROW', detail: 'The SHIP CONTROLS card gains its missing row — FIELD MANUAL · ESC, bold, on top.' },
  { date: '2026-10-21', ref: 'PR #17', title: 'DEATH TAX + TWO LEAVE DOORS', detail: 'A paid buy-back also costs time (redeploy wait, 30 s cap). Leaving splits into STEP AWAY and FORFEIT. Remote ships and nameplates arrive; team names go on screen.' },
  { date: '2026-10-21', ref: 'PR #15', title: 'TEAMS + THE PRICE OF DYING', detail: 'Team picks with live player counts, no friendly fire, cross-feeding. Death costs 25% of the bank; the buy-back is priced by deaths. FIELD NOTES and the FIELD MANUAL arrive.' },
  { date: '2026-10-21', ref: 'PR #13', title: 'MULTIPLAYER LANDS', detail: 'Rooms, the lobby, seats and bots. The host runs the sim; standings and star stages go live. The .io game exists.' },
  { date: '2026-10-20', ref: 'PR #11', title: 'SHIP PROGRESSION', detail: 'Five lines, types, hull steps — the TYPE × HULL ladders. The workshop grows its faces; every type gets its silhouette.' },
  { date: '2026-10-20', ref: 'PR #9', title: 'THE DOCK + THE STRIP', detail: 'The status strip goes slim and honest; the dock becomes a choice — FEED · BANK · WORKSHOP; a label-contrast pass.' },
  { date: '2026-10-20', ref: 'PR #7', title: 'HYBRIDS + THE DEFENSE LADDER', detail: 'Hybrid effects and their silhouettes; the electron-shell turret ladder; rising milestone costs; turret hubs read real state.' },
  { date: '2026-10-20', ref: 'PR #5', title: 'THE WRAP + THE CONTROLS CARD', detail: 'The world wraps at R=3000, point-reflected through the midpoint. The full controls card; weapon and defense visual differentiation.' },
  { date: '2026-10-19', ref: 'PR #3', title: 'ARSENAL, BANK + CME', detail: 'The 16-item loadout with its swap toll; the star-as-bank gravity well; weapons fire; all six defenses; coronal mass ejections.' },
  { date: '2026-10-19', ref: 'PR #1', title: 'THE LADDER IS DRAWN', detail: 'The star defense ladder design lands (electron shells, 2n²); the starter turret is settled. The first WIP merge.' },
  { date: '2026-10-19', ref: '64349be', title: 'THE WORKER STANDS UP', detail: 'Wrangler config lands — the game gets its Cloudflare home and its address.' },
  { date: '2026-08-16', ref: '2a7cbb0', title: 'MOBILE ARRIVES', detail: 'Touch controls. The game leaves the desk and fits in a pocket.' },
  { date: '2026-05-04', ref: '212e861', title: 'DRONES', detail: 'Harvesting drones and their management join the loop.' },
  { date: '2026-05-04', ref: '7e61efc', title: 'WIN AND LOSE', detail: 'Victory and game-over states — a match can end both ways.' },
  { date: '2026-05-04', ref: '31c43fa', title: 'HEALTH + EJECTION', detail: 'Ship health arrives, and cargo can be ejected — the ancestor of the jettison.' },
  { date: '2026-05-04', ref: '4db5b3c', title: 'SYSCFG TAKES SHAPE', detail: 'The system configuration panel is styled — this very screen, in embryo.' },
  { date: '2026-05-04', ref: '5b96f59', title: 'THE SIGNATURE', detail: 'The author’s signature plate, flicker and all.' },
  { date: '2026-05-04', ref: '3a1bf31', title: 'GRAVITY WELLS — PHASE 1', detail: 'The first playable build: orbit a star, collect what drifts, feed it, grow.' },
  { date: '2026-05-04', ref: 'e315a50', title: 'INITIAL COMMIT', detail: 'The repo is born.' },
];

export const LATEST_BUILD: BuildEntry = BUILD_HISTORY[0];
