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
 */
interface RepurchaseOverlayProps {
  deaths: number;
  bankedScrap: number;
  price: number;
  onRepurchase: () => void;
}

export const RepurchaseOverlay: React.FC<RepurchaseOverlayProps> = ({
  deaths, bankedScrap, price, onRepurchase,
}) => (
  <div className="fixed inset-0 z-[90] flex items-center justify-center p-3 bg-black/70 backdrop-blur-[2px] pointer-events-auto">
    <div className="hud-panel w-full max-w-sm p-5 rounded border-4 border-red-900 bg-zinc-950/85 text-center shadow-[0_0_50px_rgba(220,38,38,0.25)]">
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
        <span className="text-zinc-100 font-bold">{price === 0 ? 'FREE' : `${price}U`}</span>
      </div>
      {price === 0 && (
        <p className="text-[9px] font-mono text-zinc-600 mt-1">An empty bank pays the floor price: nothing.</p>
      )}
      <button
        onClick={onRepurchase}
        className="pitted-metal w-full mt-4 py-3 rounded font-bold text-sm tracking-widest bg-[#33ff33] text-black shadow-[0_0_16px_rgba(51,255,51,0.4)] active:scale-[0.98] touch-manipulation"
      >
        ↻ REPURCHASE SHIP
      </button>
      <p className="text-[9px] font-mono text-zinc-600 mt-3 leading-snug">
        A fresh starter frame, bought from your bank. Each death steps the price down — coming back gets cheaper, never free of consequence.
      </p>
    </div>
  </div>
);
