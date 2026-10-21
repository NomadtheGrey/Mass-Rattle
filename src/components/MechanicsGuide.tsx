import React from 'react';

/**
 * Mechanics guide (Adam, 2026-10-21) — the deep version of the lobby's
 * win-conditions + field-notes panels, in-game. Opens with ESC when
 * nothing else is open (and closes with ESC / X / backdrop, slotting
 * into the HUD's existing Escape stack), or from the GUIDE button —
 * phones have no ESC key. Every fact here is a pinned ruling; sections
 * that only apply to multiplayer matches carry the MULTIPLAYER tag,
 * and solo differences are stated where they differ.
 */

const Section: React.FC<{ title: string; tag?: string; children: React.ReactNode }> = ({ title, tag, children }) => (
  <section>
    <h3 className="flex items-center gap-2 text-[11px] font-mono font-bold tracking-[0.2em] text-[#33ff33] border-b border-zinc-800 pb-1 mb-2">
      {title}
      {tag && <span className="text-[7px] px-1 py-0.5 rounded bg-pink-950/60 border border-pink-800 text-pink-300 tracking-widest">{tag}</span>}
    </h3>
    <div className="space-y-1.5 text-[11px] font-mono leading-snug text-zinc-400">{children}</div>
  </section>
);

const Row: React.FC<{ k: string; v: string; color?: string }> = ({ k, v, color }) => (
  <div className="flex justify-between gap-3">
    <span className="font-bold shrink-0" style={{ color: color || '#e4e4e7' }}>{k}</span>
    <span className="text-right">{v}</span>
  </div>
);

export const MechanicsGuide: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div
    onClick={onClose}
    className="fixed inset-0 z-[105] flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md pointer-events-auto"
  >
    <div
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      className="hud-panel hud-panel-deep w-full max-w-lg max-h-[90vh] overflow-y-auto p-4 sm:p-6 border-4 bg-zinc-950/80 rounded-lg shadow-[0_0_50px_rgba(51,255,51,0.15)]"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-black font-mono tracking-widest text-zinc-50">FIELD MANUAL</h2>
          <div className="text-[9px] font-mono tracking-[0.3em] text-zinc-500">HOW MASS RATTLE WORKS</div>
        </div>
        <button
          onClick={onClose}
          className="px-2.5 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-red-500 font-mono text-xs touch-manipulation"
          aria-label="Close guide"
        >
          [X]
        </button>
      </div>

      <div className="space-y-5">
        <Section title="🏆 WINNING">
          <p><span className="text-amber-300 font-bold">CRITICAL MASS</span> — feed a star to <span className="text-zinc-100 font-bold">BLACK HOLE</span> and the match ends on the spot. That star's team are recorded as its <span className="text-amber-300 font-bold">CARETAKERS</span>.</p>
          <p><span className="text-amber-300 font-bold">LAST TEAM STANDING</span> — destroy every opposing team's stars. Playing solo, every other star is an opposing team; on a shared team, you win or fall together.</p>
        </Section>

        <Section title="★ STAR STAGES">
          <Row k="RED DWARF" v="where every star starts" color="#f0764d" />
          <Row k="RED GIANT" v="375 fed — huge and diffuse" color="#ff4d3a" />
          <Row k="YELLOW" v="975 fed" color="#ffd94d" />
          <Row k="WHITE" v="1,800 fed — compact and fierce" color="#eef4ff" />
          <Row k="NEUTRON" v="2,850 fed — shrinks dense and tiny" color="#8fd0ff" />
          <Row k="BLACK HOLE" v="4,125 fed — critical mass, match over" color="#b79aff" />
          <p>Stars also grow a little with every milestone on the way. A neutron star's pull follows its <span className="text-zinc-100">mass, never its size</span> — small does not mean weak gravity.</p>
        </Section>

        <Section title="⛏ FEED · BANK · MEND">
          <p><span className="text-zinc-100 font-bold">FEED</span> — inside your star's gravity well, FEED pours your whole hold into the star. Feeding is what grows it through the stages.</p>
          <p><span className="text-zinc-100 font-bold">BANK</span> — BANK stores scrap instead: safe, spendable, but it does not grow the star until you withdraw it and feed. The bank, the workshop, and withdrawals only work <span className="text-zinc-100">inside the well</span>.</p>
          <p><span className="text-zinc-100 font-bold">MEND</span> — every delivery also repairs the star a little. Feeding a wounded star patches its integrity as it grows.</p>
        </Section>

        <Section title="🛡 TURRETS & STAR DAMAGE">
          <p>A fed star grows <span className="text-zinc-100">defense turrets</span> that shoot hostile ships. Turret fire <span className="text-zinc-100 font-bold">never hurts a star</span> — only a ship's own weapons can damage one. To kill a star, a ship has to do it personally.</p>
        </Section>

        <Section title="🚀 SHIPS & THE WORKSHOP">
          <p>Five ship lines — <span className="text-zinc-100">FIGHTER</span> (more hard points), <span className="text-zinc-100">MINELAYER</span> (more mines per drop), <span className="text-zinc-100">HAULER</span> (cargo + tractor reach), <span className="text-zinc-100">DRONE</span> (up to a Carrier), <span className="text-zinc-100">CRUISER</span> (up to a Dreadnought, with shipboard guns). Each line climbs types, and types cap your hull size and upgrade tracks — max a type out and the next frame up is a bigger type.</p>
          <p>A line's special is a <span className="text-zinc-100">peak, not a lock</span>: any ship can carry mines or guns, the specialist just carries more. Switching lines costs a toll that grows with the tier you leave. The workshop (in the well) sells track upgrades, weapons, defenses, and hybrids; swapping arsenal gear costs scrap by tier.</p>
        </Section>

        <Section title="💀 DEATH & BUY-BACK" tag="MULTIPLAYER">
          <p>Losing your ship costs <span className="text-zinc-100 font-bold">25% of your bank</span>. Buying back a fresh starter frame costs <span className="text-zinc-100 font-bold">20% of what remains</span>, discounted further with each death — and it's <span className="text-zinc-100">free at an empty bank</span>. Your star, your team, and the rest of your bank carry on.</p>
          <p>A <span className="text-zinc-100 font-bold">star's</span> death is different: that seat is <span className="text-zinc-100">eliminated</span>. There is no buy-back from that.</p>
          <p>A <span className="text-zinc-100 font-bold">paid</span> buy-back also costs <span className="text-zinc-100">time</span> — the death tax: the new frame arrives after a respawn wait (5s, +1s per death, never more than 30s). The free floor never waits.</p>
          <p className="text-zinc-500">Solo: losing your ship ends the run outright — the buy-back is a match rule.</p>
        </Section>

        <Section title="🎨 TEAMS" tag="MULTIPLAYER">
          <p>Pick a color in the lobby — red, blue, green, gold. Untouched seats keep their own color as a one-star team, so a default lobby is a free-for-all. <span className="text-zinc-100 font-bold">Teammates can't hurt each other</span>, and anyone can feed or bank at any team star — build one together.</p>
          <p>If every human stacks a single team, the bots take the first unpicked color and form the opposition, so a stacked lobby still has a match in it.</p>
        </Section>

        <Section title="🌐 MULTIPLAYER" tag="MULTIPLAYER">
          <p><span className="text-zinc-100 font-bold">Progression is per match.</span> Bank, loadout, ship type — all of it starts fresh each match and ends with it.</p>
          <p>The first player in runs the simulation. If the host leaves, <span className="text-zinc-100">hosting passes automatically</span> to the next player in join order — and a returning host does <span className="text-zinc-100">not</span> take it back. Promotion is for the match.</p>
          <p>Drop out mid-match and your seat flies on under a bot until you return and reclaim it — same seat, same star, same bank.</p>
        </Section>
      </div>

      <div className="text-center text-[9px] font-mono text-zinc-600 mt-5 tracking-widest">[ ESC / X TO CLOSE ]</div>
    </div>
  </div>
);
