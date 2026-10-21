import React from 'react';

/**
 * Repurchase screen (UI lane, P2-5 death economy) — shown while the
 * LOCAL seat is shipless in a live net match (seats[i].ship === null
 * with deaths > 0; the canvas shows the wreck as a stand-in until the
 * seat flies again). The price comes from the sim's own
 * repurchasePriceFor, so the screen can only ever quote what the host
 * will charge; the host remains the authority that validates and
 * applies. Solo play never shows this: an SP death is game over and
 * the results screen owns it.
 *
 * THE STRANDED-PLAYER PASS (Adam, 2026-10-21): this modal must never
 * be a toll booth or a trap —
 * 1. BROKE IS IMPOSSIBLE, SAID OUT LOUD: the price is 20% of the
 *    post-loss bank (stepping down per death), FREE at zero — it can
 *    never exceed what the player has. That guarantee is the panel's
 *    backbone copy, not fine print.
 * 2. LEAVING IS TWO REAL DOORS (grace-vs-forfeit): STEP AWAY keeps
 *    beside REPURCHASE; buying back is a choice.
 * 3. DISMISSAL HAS A WAY BACK: the corner [X], ESC, and the X key
 *    dismiss the panel (the modal rule), and App keeps a persistent
 *    YOU ARE DEAD pill on screen for as long as the seat is dead —
 *    one tap reopens this panel. Dismissal can never strand.
 */
interface RepurchaseOverlayProps {
  deaths: number;
  bankedScrap: number;
  price: number;
  onRepurchase: () => void;
  /** STEP AWAY: the plain leave — the seat parks in grace, a bot
   *  flies it, and the player may reclaim it all match. */
  onLeaveMatch: () => void;
  /** FORFEIT: the seat is released for good (Adam's grace-vs-forfeit
   *  ruling) — no reclaim, and a paid buy-back is forgotten with it.
   *  No refund exists. */
  onForfeitMatch: () => void;
  onDismiss: () => void;
  /** DEATH TAX (Adam, 2026-10-21): when the sim's death-tax state
   * lands, a PAID buy-back sets the seat's respawn deadline (seat.respawnAt)
   * (performance.now-based ms) instead of respawning instantly —
   * the price is scrap, the tax is time. The FREE-floor path never
   * sets it (instant, no timer on the broke). Until the sim carries
   * the field this prop is simply absent and the panel behaves
   * exactly as before: the display is built dark, lit by the data. */
  respawnAt?: number | null;
}

export const RepurchaseOverlay: React.FC<RepurchaseOverlayProps> = ({
  deaths, bankedScrap, price, onRepurchase, onLeaveMatch, onForfeitMatch, onDismiss,
  respawnAt = null,
}) => {
  // The countdown ticks on its own clock while the paid wait runs,
  // independent of how often the app happens to re-render.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!respawnAt) return;
    const id = window.setInterval(() => setTick(t => t + 1), 200);
    return () => window.clearInterval(id);
  }, [respawnAt]);
  const respawnSecs = respawnAt
    ? Math.max(0, Math.ceil((respawnAt - performance.now()) / 1000))
    : 0;
  const respawnClock = `${Math.floor(respawnSecs / 60)}:${String(respawnSecs % 60).padStart(2, '0')}`;
  const insurancePaid = respawnAt !== null && respawnSecs > 0;
  // The modal rule's keyboard half, owned here (HUD's stack does not
  // know this surface): ESC / X dismiss, capture-phase + swallowed so
  // neither key reaches the game behind.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isEsc = e.key === 'Escape';
      const isX = (e.key === 'x' || e.key === 'X') && !e.metaKey && !e.ctrlKey && !e.altKey;
      if (!isEsc && !isX) return;
      e.preventDefault();
      e.stopPropagation();
      onDismiss();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onDismiss]);

  const free = price === 0;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-3 bg-black/70 backdrop-blur-[2px] pointer-events-auto">
      <div className="hud-panel w-full max-w-sm p-5 rounded border-4 border-red-900 bg-zinc-950/85 text-center shadow-[0_0_50px_rgba(220,38,38,0.25)] relative">
        <button
          type="button"
          onClick={onDismiss}
          title="Watch the field — the buy-back waits on a pill"
          aria-label="Dismiss — the buy-back stays available on a pill"
          className="absolute top-2 right-2 min-w-9 h-9 px-1.5 rounded bg-zinc-900/85 border border-zinc-600 text-zinc-200 font-mono font-bold text-xs flex items-center justify-center touch-manipulation active:scale-95 hover:border-red-400 hover:text-white"
        >
          ✕
        </button>
        <div className="text-3xl mb-1">💥</div>
        <h2 className="text-xl font-black font-mono tracking-widest text-red-500">SHIP DESTROYED</h2>
        <p className="text-[11px] font-mono text-zinc-400 mt-2 leading-relaxed">
          Deaths this match: <span className="text-zinc-100 font-bold">{deaths}</span><br />
          Your star and your bank carry on — only the frame is gone.
        </p>
        <div className="flex justify-between text-[11px] font-mono mt-4 px-1">
          <span className="text-zinc-500">YOUR BANK</span>
          <span className="text-cyan-300 font-bold">{bankedScrap}U</span>
        </div>
        <div className="flex justify-between text-[11px] font-mono mt-1 px-1">
          <span className="text-zinc-500">NEW FRAME</span>
          <span className={`font-bold ${free ? 'text-[#33ff33]' : 'text-zinc-100'}`}>{free ? 'FREE' : `${price}U`}</span>
        </div>
        {free ? (
          <p className="text-[11px] font-mono font-bold text-[#33ff33] bg-[#33ff33]/10 border border-[#33ff33]/40 rounded px-2 py-1.5 mt-2 leading-snug">
            FREE — THE FLOOR COVERS YOU. AT ZERO BANK THE BUY-BACK COSTS NOTHING.
          </p>
        ) : (
          <p className="text-[10px] font-mono text-zinc-400 mt-2 leading-snug">
            The price is a cut of what's in your bank — it can never be more than you have, and at zero bank it's free.
          </p>
        )}
        {insurancePaid ? (
          <div className="w-full mt-4 py-3 rounded font-bold text-sm tracking-widest bg-[#33ff33]/15 border border-[#33ff33]/60 text-[#33ff33] font-mono">
            INSURANCE PAID — REDEPLOY IN {respawnClock}
          </div>
        ) : (
          <button
            onClick={onRepurchase}
            className="cta-go w-full py-3 rounded font-bold text-sm tracking-widest active:scale-[0.98] touch-manipulation"
          >
            ↻ REPURCHASE SHIP{free ? ' — FREE' : ` — ${price}U`}
          </button>
        )}
        {free && !insurancePaid && (
          <p className="text-[9px] font-mono text-zinc-600 mt-2 leading-snug">
            Paid buy-backs also wait out a short redeploy timer — the death tax. The free floor never does.
          </p>
        )}
        <div className="flex gap-2 mt-2">
          <button
            onClick={onLeaveMatch}
            className="flex-1 py-2.5 rounded font-bold text-xs tracking-widest bg-zinc-900 text-zinc-300 border border-zinc-700 hover:border-zinc-400 active:scale-[0.98] touch-manipulation"
          >
            STEP AWAY
          </button>
          <button
            onClick={onForfeitMatch}
            className="flex-1 py-2.5 rounded font-bold text-xs tracking-widest bg-zinc-900 text-red-400 border border-red-900 hover:border-red-500 hover:text-red-300 active:scale-[0.98] touch-manipulation"
          >
            FORFEIT SEAT
          </button>
        </div>
        <p className="text-[9px] font-mono text-zinc-600 mt-2 leading-snug">
          {insurancePaid
            ? 'You PAID for this buy-back. Step away and your seat — wait and all — stays yours to reclaim. Forfeit and the payment is forgotten with the seat: no refund, no reclaim.'
            : 'Step away: your seat is kept, a bot flies it, and you can reclaim it any time this match. Forfeit: the seat is released for good — no reclaim.'}
        </p>
        <p className="text-[9px] font-mono text-zinc-600 mt-3 leading-snug">
          A fresh starter frame, bought from your bank. Each death steps the price down — coming back gets cheaper, never free of consequence.
        </p>
        <p className="text-[9px] font-mono text-zinc-500 mt-2 tracking-wider">
          [ ✕ / ESC / X — WATCH THE FIELD; THE BUY-BACK WAITS ON A PILL ]
        </p>
      </div>
    </div>
  );
};
