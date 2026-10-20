import React from 'react';
import type { RoomState, Seat, ClientState } from '../../net/protocol';
import { CUE_GLYPHS, ERROR_LABELS, SEAT_CONNECTION_LABELS } from './lobbyTypes';

/**
 * Lobby front end (UI lane, Phase 2) — built against the frozen wire
 * contract as coded in src/net/protocol.ts (P2-1). Presentational: the
 * screen renders RoomState/ClientState and calls back; the net client
 * that owns the socket and feeds these props binds in next (P2-2+).
 * Phone-first: the join flow is sized for phone keyboards (the code
 * field especially) because that's how players arrive.
 *
 * Match flow per Adam's rulings: create -> pick star count -> host
 * starts -> play is live immediately. No ready-up exists anywhere.
 */

export interface LobbyCallbacks {
  onCreate: (name: string, starCount: 2 | 3 | 4, isPrivate: boolean, callsign: string) => void;
  onJoin: (code: string, callsign: string) => void;
  onStart: () => void;
  onLeave: () => void;
}

interface LobbyScreenProps {
  clientState: ClientState;
  room: RoomState | null;
  myPlayerId: string | null;
  defaultCallsign?: string;
  /** Join-link prefill (?room=CODE): the code fills itself in. */
  initialCode?: string;
  /** ownerId of a seat just reclaimed by its returning player. */
  reclaimedOwnerId?: string | null;
  /** Transport-level failure copy (not a wire ErrorCode). */
  notice?: string | null;
  callbacks: LobbyCallbacks;
}

const SeatCard: React.FC<{ seat: Seat; mine: boolean; reclaimed?: boolean }> = ({ seat, mine, reclaimed }) => {
  const { occupant } = seat;
  const glyph = CUE_GLYPHS[occupant.cue] || '●';
  return (
    <div className={`hud-panel p-3 rounded border-2 flex items-center gap-3 ${mine ? 'border-[#33ff33]' : 'border-zinc-800'}`}>
      <div
        className="w-11 h-11 shrink-0 rounded flex items-center justify-center text-2xl border border-zinc-700 bg-zinc-950"
        style={{ color: occupant.color }}
        aria-label={`${occupant.cue} seat`}
      >
        {glyph}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-bold text-sm text-zinc-100 truncate">
            {occupant.kind === 'bot' ? 'BOT' : occupant.callsign || '—'}
          </span>
          {seat.isHost && (
            <span className="text-[8px] font-mono font-bold px-1 py-0.5 rounded bg-amber-500/20 border border-amber-500 text-amber-300">HOST</span>
          )}
          {mine && (
            <span className="text-[8px] font-mono font-bold px-1 py-0.5 rounded bg-[#33ff33]/15 border border-[#33ff33] text-[#33ff33]">YOU</span>
          )}
          {reclaimed && (
            <span className="text-[8px] font-mono font-bold px-1 py-0.5 rounded bg-amber-500/20 border border-amber-500 text-amber-300">SEAT RECLAIMED</span>
          )}
        </div>
        <div className="text-[9px] font-mono text-zinc-500 tracking-wider">
          STAR {seat.starIndex + 1} · {occupant.cue.toUpperCase()} SEAT ·{' '}
          <span className={seat.connection === 'reconnect_grace' ? 'text-amber-400' : ''}>
            {SEAT_CONNECTION_LABELS[seat.connection]}
          </span>
        </div>
      </div>
    </div>
  );
};

export const LobbyScreen: React.FC<LobbyScreenProps> = ({
  clientState, room, myPlayerId, defaultCallsign = '', initialCode = '',
  reclaimedOwnerId = null, notice = null, callbacks,
}) => {
  const [callsign, setCallsign] = React.useState(defaultCallsign);
  const [roomName, setRoomName] = React.useState('');
  const [starCount, setStarCount] = React.useState<2 | 3 | 4>(2);
  const [isPrivate, setIsPrivate] = React.useState(false);
  const [joinCode, setJoinCode] = React.useState(initialCode.toUpperCase().slice(0, 6));

  const busy = clientState.connection === 'connecting';
  const callsignOk = callsign.trim().length > 0;

  const errorBanner = clientState.lastError && (
    <div className="hud-panel px-3 py-2 rounded border-2 border-red-500 bg-red-950/40 text-center">
      <span className="text-[11px] font-mono font-bold text-red-300">{ERROR_LABELS[clientState.lastError]}</span>
    </div>
  );

  /* ------------------------------ ROOM VIEW ------------------------------ */
  if (room) {
    const iAmHost = myPlayerId !== null && room.hostPlayerId === myPlayerId;
    return (
      <div className="fixed inset-0 z-[100] overflow-y-auto bg-zinc-950 text-[#33ff33] flex justify-center p-3 sm:p-6">
        <div className="w-full max-w-md flex flex-col gap-3">
          <div className="text-center">
            <div className="text-[9px] font-mono tracking-[0.3em] text-zinc-500">ROOM CODE — SHARE IT TO INVITE</div>
            <div className="text-4xl font-black font-mono tracking-[0.35em] text-zinc-50 my-1">{room.code}</div>
            <div className="text-[10px] font-mono text-zinc-400">
              {room.name || 'UNNAMED ROOM'} · {room.starCount} STARS · {room.private ? 'PRIVATE — CODE/LINK ONLY' : 'PUBLIC'}
            </div>
          </div>

          {errorBanner}
          {notice && (
            <div className="hud-panel px-3 py-2 rounded border-2 border-amber-500 bg-amber-950/30 text-center">
              <span className="text-[11px] font-mono font-bold text-amber-300">{notice}</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {room.seats.map(seat => (
              <SeatCard
                key={seat.ownerId}
                seat={seat}
                mine={seat.occupant.playerId !== null && seat.occupant.playerId === myPlayerId}
                reclaimed={reclaimedOwnerId === seat.ownerId}
              />
            ))}
          </div>

          <p className="text-[10px] font-mono text-zinc-500 text-center leading-snug">
            Empty seats are flown by bots until a player joins and takes the seat over.
            Progression is per match — every caretaker starts with a fresh frame.
          </p>

          {room.phase === 'lobby' && (
            iAmHost ? (
              <button
                onClick={callbacks.onStart}
                className="pitted-metal w-full py-3.5 rounded font-bold text-sm tracking-widest bg-[#33ff33] text-black shadow-[0_0_16px_rgba(51,255,51,0.45)] active:scale-[0.98] touch-manipulation"
              >
                ▶ START MATCH
              </button>
            ) : (
              <div className="hud-panel w-full py-3 rounded text-center text-[11px] font-mono text-zinc-400 border border-zinc-800">
                WAITING FOR THE HOST TO START…
              </div>
            )
          )}
          {room.phase !== 'lobby' && (
            <div className="hud-panel w-full py-3 rounded text-center text-[11px] font-mono text-zinc-400 border border-zinc-800 uppercase">
              MATCH {room.phase} — THE GAME SCREEN HAS THE CONTROLS
            </div>
          )}

          <button
            onClick={callbacks.onLeave}
            className="w-full py-2 text-[11px] font-mono text-zinc-500 hover:text-red-400 tracking-widest touch-manipulation"
          >
            [ LEAVE ROOM ]
          </button>
        </div>
      </div>
    );
  }

  /* ------------------------------ ENTRY VIEW ----------------------------- */
  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-zinc-950 text-[#33ff33] flex justify-center p-3 sm:p-6">
      <div className="w-full max-w-md flex flex-col gap-4">
        <div className="text-center mt-2">
          <h1 className="text-3xl font-black tracking-tighter italic text-zinc-50">MASS RATTLE</h1>
          <div className="text-[9px] font-mono tracking-[0.3em] text-zinc-500 mt-1">MULTIPLAYER LOBBY</div>
        </div>

        {errorBanner}
        {notice && (
          <div className="hud-panel px-3 py-2 rounded border-2 border-amber-500 bg-amber-950/30 text-center">
            <span className="text-[11px] font-mono font-bold text-amber-300">{notice}</span>
          </div>
        )}
        {clientState.connection === 'desync' && (
          <div className="hud-panel px-3 py-2 rounded border-2 border-amber-500 bg-amber-950/30 text-center">
            <span className="text-[11px] font-mono font-bold text-amber-300">CONNECTION LOST SYNC — REJOINING…</span>
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-mono tracking-[0.25em] text-zinc-500">YOUR CALLSIGN</span>
          <input
            value={callsign}
            onChange={e => setCallsign(e.target.value)}
            maxLength={16}
            placeholder="e.g. NOMAD"
            className="hud-panel rounded px-3 py-2.5 bg-zinc-900 border border-zinc-700 font-mono text-sm text-zinc-50 placeholder:text-zinc-600 outline-none focus:border-[#33ff33]"
          />
        </label>

        <div className="hud-panel p-3 sm:p-4 rounded border-2 border-zinc-800 flex flex-col gap-3">
          <div className="text-[10px] font-mono font-bold tracking-[0.25em] text-zinc-400">CREATE A ROOM</div>
          <input
            value={roomName}
            onChange={e => setRoomName(e.target.value)}
            maxLength={24}
            placeholder="ROOM NAME (OPTIONAL)"
            className="rounded px-3 py-2 bg-zinc-900 border border-zinc-700 font-mono text-sm text-zinc-50 placeholder:text-zinc-600 outline-none focus:border-[#33ff33]"
          />
          <div>
            <div className="text-[9px] font-mono tracking-[0.25em] text-zinc-500 mb-1.5">STARS IN THE ARENA</div>
            <div className="flex gap-1.5">
              {([2, 3, 4] as const).map(n => (
                <button
                  key={n}
                  onClick={() => setStarCount(n)}
                  className={`flex-1 py-2.5 rounded font-mono font-bold text-sm border touch-manipulation active:scale-95 ${
                    starCount === n
                      ? 'bg-[#33ff33] text-black border-[#33ff33] shadow-[0_0_10px_rgba(51,255,51,0.4)]'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-700'
                  }`}
                >
                  {n} ★
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => setIsPrivate(v => !v)}
            className="flex items-center justify-between py-1 touch-manipulation"
          >
            <span className="text-[10px] font-mono text-zinc-400 tracking-wider">PRIVATE ROOM (CODE/LINK ONLY)</span>
            <span className={`w-10 h-5 rounded-full relative transition-colors ${isPrivate ? 'bg-[#33ff33]' : 'bg-zinc-700'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-zinc-100 transition-all ${isPrivate ? 'left-[22px]' : 'left-0.5'}`} />
            </span>
          </button>
          <button
            onClick={() => callbacks.onCreate(roomName.trim(), starCount, isPrivate, callsign.trim())}
            disabled={busy || !callsignOk}
            className={`w-full py-3 rounded font-bold text-sm tracking-widest touch-manipulation active:scale-[0.98] ${
              busy || !callsignOk ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'pitted-metal bg-[#33ff33] text-black shadow-[0_0_14px_rgba(51,255,51,0.4)]'
            }`}
          >
            {busy ? 'CREATING…' : 'CREATE ROOM'}
          </button>
        </div>

        <div className="hud-panel p-3 sm:p-4 rounded border-2 border-zinc-800 flex flex-col gap-3">
          <div className="text-[10px] font-mono font-bold tracking-[0.25em] text-zinc-400">JOIN WITH A CODE</div>
          <input
            value={joinCode}
            onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
            placeholder="CODE"
            autoCapitalize="characters"
            autoCorrect="off"
            className="rounded px-3 py-2.5 bg-zinc-900 border border-zinc-700 font-mono text-xl font-bold tracking-[0.4em] text-center text-zinc-50 placeholder:text-zinc-700 outline-none focus:border-[#33ff33]"
          />
          <button
            onClick={() => callbacks.onJoin(joinCode, callsign.trim())}
            disabled={busy || !callsignOk || joinCode.length < 6}
            className={`w-full py-3 rounded font-bold text-sm tracking-widest touch-manipulation active:scale-[0.98] ${
              busy || !callsignOk || joinCode.length < 6
                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                : 'pitted-metal bg-pink-600 text-white shadow-[0_0_14px_rgba(219,39,119,0.4)]'
            }`}
          >
            {busy ? 'JOINING…' : 'JOIN ROOM'}
          </button>
          <p className="text-[9px] font-mono text-zinc-600 text-center">
            Got a link instead? Open it — the code fills itself in.
          </p>
        </div>
      </div>
    </div>
  );
};
