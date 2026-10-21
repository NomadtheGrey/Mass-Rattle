import React from 'react';
import type { RoomState, Seat, ClientState } from '../../net/protocol';
import {
  CUE_GLYPHS, ERROR_LABELS, SEAT_CONNECTION_LABELS,
  TeamId, TEAM_ORDER, TEAM_COLORS, TEAM_LABELS, seatTeam,
} from './lobbyTypes';
import { generateUniqueRoomName } from '../../net/roomNames';

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
  /** STEP AWAY: plain leave — the seat parks in grace, a bot flies
   *  it, reclaimable all match. */
  onLeave: () => void;
  /** FORFEIT: the seat is released for good (no hold, no reclaim). */
  onForfeit: () => void;
  /** Close the modal WITHOUT leaving (entry view: nothing to leave). */
  onClose: () => void;
  onSetTeam: (teamId: TeamId) => void;
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

/**
 * Win conditions (Adam, 2026-10-21) — pinned facts, worded to read
 * true in BOTH a free-for-all lobby and a team lobby: in a default
 * lobby every seat is its own team, so "opposing teams" is every
 * other star; on a shared team you win or fall together.
 */
const WinConditions: React.FC = () => (
  <div className="hud-panel p-3 rounded border-2 border-amber-500/60 bg-amber-950/10">
    <div className="text-[10px] font-mono font-bold tracking-[0.25em] text-amber-300 mb-2">🏆 HOW A MATCH IS WON</div>
    <div className="space-y-2 text-[11px] font-mono leading-snug text-zinc-300">
      <p>
        <span className="text-amber-300 font-bold">1 · CRITICAL MASS</span> — feed a star all the way to
        <span className="text-zinc-50 font-bold"> BLACK HOLE</span>: 4,125 scrap fed
        <span className="text-zinc-500"> (Red Giant 375 → Yellow 975 → White 1,800 → Neutron 2,850 → Black Hole 4,125)</span>.
        The match ends the moment it happens, and that star's team are recorded as its
        <span className="text-amber-300 font-bold"> CARETAKERS</span>.
      </p>
      <p>
        <span className="text-amber-300 font-bold">2 · LAST TEAM STANDING</span> — destroy every opposing
        team's stars. Playing solo, that's every other star; on a team, you win or fall together.
      </p>
    </div>
  </div>
);

/** First-timer basics (Adam, 2026-10-21) — the left margin on wide
 * screens; on phones the same full text rides under the win
 * conditions instead of being shrunk away. */
const HowToBlock: React.FC = () => (
  <div className="hud-panel p-3 rounded border-2 border-zinc-800">
    <div className="text-[10px] font-mono font-bold tracking-[0.25em] text-zinc-400 mb-2">FIELD NOTES</div>
    <ul className="space-y-2 text-[11px] font-mono leading-snug text-zinc-400">
      <li>⛏ <span className="text-zinc-200">Harvest scrap</span> and carry it home — feeding grows your star.</li>
      <li>🤝 <span className="text-zinc-200">On a team, anyone can feed any team star.</span> Build one together.</li>
      <li>🔫 <span className="text-zinc-200">Only ship weapons hurt a star.</span> Turrets just defend — they never damage one.</li>
      <li>🛡 <span className="text-zinc-200">Guard your star while it grows.</span> A fat star is a target.</li>
      <li>💀 <span className="text-zinc-200">Dying costs a cut of your bank</span> plus a buy-back. Don't trade your ship cheaply.</li>
    </ul>
  </div>
);

const SeatCard: React.FC<{ seat: Seat; mine: boolean; reclaimed?: boolean }> = ({ seat, mine, reclaimed }) => {
  const { occupant } = seat;
  const glyph = CUE_GLYPHS[occupant.cue] || '●';
  const team = seatTeam(seat);
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
          <span
            className="text-[8px] font-mono font-bold px-1 py-0.5 rounded border"
            style={{ color: TEAM_COLORS[team], borderColor: TEAM_COLORS[team], backgroundColor: `${TEAM_COLORS[team]}1a` }}
          >
            {TEAM_LABELS[team]}
          </span>
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

  // DICE POLITENESS (Adam, 2026-10-21: no duplicate names in the
  // lobby): the entry screen keeps a best-effort set of the names
  // live rooms already wear (one GET on mount, refreshed when stale)
  // and the dice rolls against it with the server's OWN uniqueness
  // generator — a rolled name won't knowingly duplicate a listed
  // room. Politeness, not the guarantee: private rooms aren't
  // listed and rooms born after the fetch aren't in the set; the
  // server's create-time enforcement (name_taken) is the law.
  const [liveNames, setLiveNames] = React.useState<ReadonlySet<string>>(new Set());
  const liveNamesFetchedAt = React.useRef(0);
  const refreshLiveNames = React.useCallback(() => {
    liveNamesFetchedAt.current = Date.now();
    fetch('/api/rooms')
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { rooms?: { name?: string }[] };
        setLiveNames(new Set(
          (data.rooms || [])
            .map(r => (typeof r.name === 'string' ? r.name.toLowerCase() : ''))
            .filter(Boolean),
        ));
      })
      .catch(() => { /* politeness degrades silently; the server enforces */ });
  }, []);
  React.useEffect(() => { refreshLiveNames(); }, [refreshLiveNames]);
  const rollName = React.useCallback(() => {
    if (Date.now() - liveNamesFetchedAt.current > 20000) refreshLiveNames();
    const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
    setRoomName(generateUniqueRoomName(liveNames, suffix));
  }, [liveNames, refreshLiveNames]);

  const busy = clientState.connection === 'connecting';
  const callsignOk = callsign.trim().length > 0;

  // THE EXIT (Adam, 2026-10-21: 'We don't have a way to exit the
  // multiplayer screen'). Closing is honest about where you are: in
  // the entry view it just closes the modal; SEATED in a room, the
  // same gesture LEAVES the room (the existing onLeave path) — so the
  // room view's button says LEAVE, not a bare X that would strand
  // nobody but tell nobody either. ESC and the X key close too. The
  // listener is CAPTURE-phase with stopPropagation: the lobby is a
  // pre-game context, and neither key may fall through to the in-game
  // handlers behind it (ESC would open the FIELD MANUAL; X is the
  // decoy key). The X key yields while typing in a field — callsigns
  // contain Xs.
  const seated = room !== null;
  const handleClose = React.useCallback(() => {
    if (seated) callbacks.onLeave();
    else callbacks.onClose();
  }, [seated, callbacks]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
        return;
      }
      if ((e.key === 'x' || e.key === 'X') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [handleClose]);
  const closeButton = (
    <button
      type="button"
      onClick={handleClose}
      title={seated ? 'Leave the room and close' : 'Close'}
      aria-label={seated ? 'Leave the room and close' : 'Close multiplayer'}
      className="fixed top-3 right-3 z-[110] min-w-11 h-11 px-2 rounded bg-zinc-900/85 border border-zinc-600 text-zinc-200 font-mono font-bold text-sm flex items-center justify-center gap-1.5 touch-manipulation active:scale-95 hover:border-red-400 hover:text-white shadow-lg"
    >
      <span aria-hidden="true">✕</span>
      {seated && <span className="text-[9px] tracking-widest text-zinc-400">STEP AWAY</span>}
    </button>
  );

  const errorBanner = clientState.lastError && (
    <div className="hud-panel px-3 py-2 rounded border-2 border-red-500 bg-red-950/40 text-center">
      <span className="text-[11px] font-mono font-bold text-red-300">{ERROR_LABELS[clientState.lastError]}</span>
    </div>
  );

  /* ------------------------------ ROOM VIEW ------------------------------ */
  if (room) {
    const iAmHost = myPlayerId !== null && room.hostPlayerId === myPlayerId;
    const mySeat = room.seats.find(seat => seat.occupant.playerId !== null && seat.occupant.playerId === myPlayerId) ?? null;
    return (
      <div className="fixed inset-0 z-[100] overflow-y-auto bg-zinc-950/90 text-[#33ff33] flex justify-center p-3 sm:p-6">
      {closeButton}
        <div className="w-full max-w-md md:max-w-3xl flex gap-4 items-start">
        {/* Left margin: field notes (desktop); phones get the same
            block inline below — nothing shrunk away. */}
        <aside className="hidden md:block w-56 shrink-0 sticky top-0">
          <HowToBlock />
        </aside>
        <div className="flex-1 min-w-0 max-w-md flex flex-col gap-3">
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

          <WinConditions />
          <div className="md:hidden">
            <HowToBlock />
          </div>

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

          {room.phase === 'lobby' && mySeat && (
            <div className="hud-panel p-3 rounded border-2 border-zinc-800">
              <div className="text-[9px] font-mono tracking-[0.25em] text-zinc-500 mb-2">YOUR TEAM</div>
              <div className="grid grid-cols-4 gap-1.5">
                {TEAM_ORDER.map(t => {
                  const humans = room.seats.filter(seat => seat.occupant.kind === 'human' && seatTeam(seat) === t).length;
                  const mine = seatTeam(mySeat) === t;
                  return (
                    <button
                      key={t}
                      onClick={() => callbacks.onSetTeam(t)}
                      className={`py-2 rounded border-2 font-mono touch-manipulation active:scale-95 ${mine ? 'bg-zinc-800' : 'bg-zinc-900'}`}
                      style={{ borderColor: mine ? TEAM_COLORS[t] : '#3f3f46', boxShadow: mine ? `0 0 10px ${TEAM_COLORS[t]}55` : undefined }}
                    >
                      <span className="block w-4 h-2.5 mx-auto rounded-sm mb-1" style={{ backgroundColor: TEAM_COLORS[t] }} />
                      <span className="block text-[10px] font-bold" style={{ color: TEAM_COLORS[t] }}>{TEAM_LABELS[t]}</span>
                      <span className="block text-[8px] text-zinc-400 mt-0.5">{humans} PLAYER{humans === 1 ? '' : 'S'}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[9px] font-mono text-zinc-500 mt-2 leading-snug">
                Teammates can't hurt you — and the team builds together: feed or bank at any team star.
              </p>
              <p className="text-[9px] font-mono text-zinc-600 mt-1 leading-snug">
                Counts are real players only — bots never count, and a seat held through a reconnect counts.
                Unbalanced teams are legal. At the start, bots hold their seat colors unless every human
                stacks one team — then the bots form the opposition.
              </p>
            </div>
          )}

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

          <p className="text-[9px] font-mono text-zinc-600 leading-snug px-1">
            STEP AWAY keeps your seat — a bot flies it and you can reclaim it any time this match. FORFEIT releases it for good.
          </p>
          <div className="flex gap-2">
            <button
              onClick={callbacks.onLeave}
              className="flex-1 py-2 text-[11px] font-mono text-zinc-400 hover:text-zinc-100 border border-zinc-800 rounded tracking-widest touch-manipulation"
            >
              [ STEP AWAY ]
            </button>
            <button
              onClick={callbacks.onForfeit}
              className="flex-1 py-2 text-[11px] font-mono text-zinc-500 hover:text-red-400 border border-zinc-800 rounded tracking-widest touch-manipulation"
            >
              [ FORFEIT ]
            </button>
          </div>
        </div>
        </div>
      </div>
    );
  }

  /* ------------------------------ ENTRY VIEW ----------------------------- */
  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-zinc-950/90 text-[#33ff33] flex justify-center p-3 sm:p-6">
      {closeButton}
      <div className="w-full max-w-md flex flex-col gap-4">
        <div className="text-center mt-2">
          <h1 className="text-3xl font-black tracking-tighter italic text-zinc-50">MASS RATTLE</h1>
          <div className="text-[9px] font-mono tracking-[0.3em] text-zinc-500 mt-1">MULTIPLAYER LOBBY</div>
          <div className="text-[10px] font-mono text-zinc-400 mt-2">Win by feeding a star to <span className="text-amber-300 font-bold">BLACK HOLE</span> — or be the <span className="text-amber-300 font-bold">LAST TEAM STANDING</span>.</div>
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
          <div className="flex gap-1.5">
            <input
              value={roomName}
              onChange={e => setRoomName(e.target.value)}
              maxLength={24}
              placeholder="ROOM NAME (OPTIONAL)"
              className="flex-1 min-w-0 rounded px-3 py-2 bg-zinc-900 border border-zinc-700 font-mono text-sm text-zinc-50 placeholder:text-zinc-600 outline-none focus:border-[#33ff33]"
            />
            <button
              type="button"
              onClick={rollName}
              title="Roll a random name"
              aria-label="Roll a random room name"
              className="w-11 shrink-0 rounded bg-zinc-900 border border-zinc-700 text-lg touch-manipulation active:scale-95 hover:border-[#33ff33]"
            >
              🎲
            </button>
          </div>
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
