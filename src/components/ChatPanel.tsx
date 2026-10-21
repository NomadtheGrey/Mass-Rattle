import React, { useContext, useEffect, useRef, useState } from 'react';
import { NetSessionContext } from '../net/useNetClient';
import { CHAT_MAX_CHARS, TEAM_COLORS } from '../net/protocol';

/**
 * IN-GAME CHAT — THE SURFACE (Adam's commission, 2026-10-21; the wire
 * is BackGround's c8d2793 and this component only consumes it:
 * session.chatLog for the log, session.sendChat to send — rendering
 * happens on the server's echo, so there is one ordering and no local
 * copy to reconcile).
 *
 * Two homes, one component:
 * - variant 'room': the full panel inside the lobby's room view —
 *   always open, always read.
 * - variant 'overlay': in-match, a slim tab on the left edge; tap or
 *   press Enter (with game focus) to open the drawer, Esc or the ✕ to
 *   close it. While closed it wears the unread count (other players'
 *   lines only — your own echo never badges you).
 *
 * Key discipline: Enter sends from the composer and the composer
 * keeps focus; Esc in the composer closes/blurs. Typing never flies
 * the ship — useGameLoop's handlers seal themselves against text
 * targets, and the lobby's Esc yields to fields, so an Esc typed
 * here never closes the room either.
 */
export const ChatPanel: React.FC<{ variant: 'room' | 'overlay' }> = ({ variant }) => {
  const session = useContext(NetSessionContext);
  const [open, setOpen] = useState(variant === 'room');
  const [draft, setDraft] = useState('');
  const [lastReadSeq, setLastReadSeq] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const log = session?.chatLog ?? [];
  const myOwnerId = session?.mySeat?.ownerId ?? null;
  const latestSeq = log.length > 0 ? log[log.length - 1].seq : 0;
  const unread = open
    ? 0
    : log.filter(m => m.seq > lastReadSeq && m.ownerId !== myOwnerId).length;

  // Read = seen: while the panel is open, the read marker rides the
  // newest line.
  useEffect(() => {
    if (open && latestSeq > lastReadSeq) setLastReadSeq(latestSeq);
  }, [open, latestSeq, lastReadSeq]);

  // Follow the conversation: opening snaps to the newest line; new
  // lines scroll only when the reader is already near the bottom
  // (scrolling up to re-read is never yanked away).
  useEffect(() => {
    const el = logRef.current;
    if (!el || !open) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [log.length, open]);
  useEffect(() => {
    if (open) {
      const el = logRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      if (variant === 'overlay') inputRef.current?.focus();
    }
  }, [open, variant]);

  // Enter opens the drawer — only from true game focus (body/canvas),
  // never while a button, field or modal owns the keyboard.
  useEffect(() => {
    if (variant !== 'overlay' || open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const t = e.target as HTMLElement | null;
      if (t === document.body || (t && t.tagName === 'CANVAS')) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [variant, open]);

  if (!session || !session.room) return null;

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    session.sendChat(text);
    setDraft('');
  };

  const onComposerKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (variant === 'overlay') setOpen(false);
      inputRef.current?.blur();
    }
  };

  const logBox = (heightClass: string) => (
    <div ref={logRef} className={`${heightClass} overflow-y-auto px-2.5 py-2 space-y-1.5`}>
      {log.length === 0 ? (
        <p className="text-[10px] font-mono text-zinc-500 leading-snug">
          No messages yet — say hello. Everyone in the room hears you, in every phase.
        </p>
      ) : (
        log.map(m => (
          <p key={m.seq} className="text-[11px] font-mono leading-snug break-words">
            <span className="text-zinc-500 text-[9px] mr-1.5">
              {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="font-bold mr-1.5" style={{ color: TEAM_COLORS[m.teamId] }}>
              {m.callsign}
            </span>
            <span className="text-zinc-100">{m.text}</span>
          </p>
        ))
      )}
    </div>
  );

  const composer = (
    <div className="flex items-stretch gap-1.5 px-2.5 pb-2.5">
      <div className="relative flex-1">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onComposerKey}
          maxLength={CHAT_MAX_CHARS}
          placeholder="Message the room…"
          aria-label="Message the room"
          className="w-full h-11 md:h-9 px-2.5 rounded bg-zinc-950/80 border border-zinc-700 focus:border-[#33ff33] outline-none font-mono text-[12px] text-zinc-100 placeholder:text-zinc-500"
        />
        {draft.length >= CHAT_MAX_CHARS - 40 && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-mono text-zinc-500">
            {draft.length}/{CHAT_MAX_CHARS}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={send}
        disabled={draft.trim().length === 0}
        className="px-3 rounded font-mono font-bold text-[11px] tracking-widest bg-zinc-800 border border-zinc-600 text-zinc-200 active:scale-95 touch-manipulation disabled:text-zinc-600 disabled:border-zinc-800"
      >
        SEND
      </button>
    </div>
  );

  if (variant === 'room') {
    return (
      <div className="hud-panel rounded border-2 border-zinc-800 overflow-hidden">
        <div className="px-3 pt-2.5 text-[9px] font-mono tracking-[0.25em] text-zinc-500">
          💬 ROOM CHAT
        </div>
        {logBox('h-44')}
        {composer}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={unread > 0 ? `Open room chat, ${unread} unread` : 'Open room chat'}
        className="fixed left-0 top-[46%] z-[58] flex flex-col items-center gap-1.5 px-1.5 py-3 rounded-r-lg bg-zinc-900/85 border border-l-0 border-zinc-600 text-zinc-300 shadow-lg active:scale-95 touch-manipulation"
      >
        <span aria-hidden="true" className="text-sm leading-none">💬</span>
        <span
          aria-hidden="true"
          className="text-[8px] font-mono font-bold tracking-[0.2em] text-zinc-400"
          style={{ writingMode: 'vertical-rl' }}
        >
          CHAT
        </span>
        {unread > 0 && (
          <span className="min-w-4 h-4 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-mono font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="fixed left-0 top-[46%] -translate-y-1/2 z-[85] w-[320px] max-w-[92vw] hud-panel-deep rounded-r-xl border border-l-0 border-zinc-600 shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between pl-3 pr-1.5 pt-2">
        <span className="text-[9px] font-mono tracking-[0.25em] text-zinc-400">💬 ROOM CHAT</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close chat"
          className="w-8 h-8 rounded bg-zinc-900/85 border border-zinc-600 text-zinc-300 font-mono text-xs active:scale-95 touch-manipulation"
        >
          ✕
        </button>
      </div>
      {logBox('h-[220px]')}
      {composer}
    </div>
  );
};
