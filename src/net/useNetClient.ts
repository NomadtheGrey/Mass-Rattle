import React from 'react';
import {
  CLIENT_VERSION, CHAT_HISTORY_LIMIT, CHAT_MAX_CHARS,
  ClientMessage, ServerMessage, ChatMessage,
  RoomState, Seat, ClientState, ErrorCode,
  Standing, StageChangedEvent, MatchEndedEvent,
  CreateRoomRequest, CreateRoomResponse,
  TeamId,
} from './protocol';

/**
 * Net client hook (UI lane, Phase 2 slice 3b) — owns the socket and
 * the client half of the frozen contract. The lobby renders its state;
 * the loop's session adapter (BackGround's 3b) consumes the refs:
 *  - snapshotRef / snapshotVersion: the host's latest full-state
 *    snapshot (guest side; a fresh snapshot also clears a desync).
 *  - guestInputsRef: Map<ownerId, NetInputPayload> — the freshest
 *    input frame per guest seat (host side).
 * Heartbeat is internal: while this client hosts a live match it beats
 * every ~2s (the DO promotes after 5s of silence). Reconnect: an
 * uninvited close re-hellos with the stored playerId — the reclaim
 * path. The four wire ErrorCodes are terminal: no retries, the room
 * clears, and the lobby shows the honest banner.
 */

/* ---------------- Guest input payload (proposed to BackGround) ------ */

export type NetActionIntent =
  | { kind: 'decoy' }
  | { kind: 'feed' }
  | { kind: 'bankDeposit' }
  | { kind: 'bankWithdraw' }
  | { kind: 'toggleShop'; open?: boolean }
  | { kind: 'buyTrack'; track: string }
  | { kind: 'buyItem'; itemId: string }
  | { kind: 'equipItem'; itemId: string }
  | { kind: 'buyType'; line?: string }
  | { kind: 'buyHull' }
  | { kind: 'switchLine'; line: string }
  | { kind: 'buildDrone' }
  /** P2-5 death economy: BARE — the host derives the seat from the
   * relay's fromOwnerId and prices it host-side from the seat's
   * ledger (repurchasePriceFor). Added by the UI lane on BackGround's
   * flag, exactly as the sim landed it. */
  | { kind: 'repurchase' };

export interface NetInputPayload {
  /** Sender-local, monotonic; the host drops stale frames. */
  seq: number;
  thrust: boolean;
  left: boolean;
  right: boolean;
  brake: boolean;
  fire: boolean;
  jettison: boolean;
  /** VAC held (Q/E/R keys or the touch VAC). Added by the loop's
   *  session adapter (P2-3b): remote ships must be able to VAC, and
   *  the host reads payload.vac ?? false. Optional so payloads from a
   *  client that predates the field still parse. */
  vac?: boolean;
  /** Mobile analog vector when one is driving. */
  stick?: { x: number; y: number } | null;
  /** Discrete intents since the previous frame. */
  actions?: NetActionIntent[];
}

/* ------------------------------ Session ----------------------------- */

export interface HostMigration {
  fromPlayerId: string;
  toPlayerId: string | null;
}

export interface NetSession {
  clientState: ClientState;
  room: RoomState | null;
  myPlayerId: string | null;
  mySeat: Seat | null;
  isHost: boolean;
  migration: HostMigration | null;
  standings: Standing[] | null;
  matchEnded: MatchEndedEvent | null;
  stageByStar: Record<string, StageChangedEvent>;
  /** ownerId of a seat this player just reclaimed (seatClaimed flag). */
  reclaimedOwnerId: string | null;
  /** In-game chat (2026-10-21): the room's rolling chat window,
   *  server-stamped and echo-fed — this log is written ONLY by
   *  server messages (chatHistory seeds it wholesale; each chat
   *  echo appends), never by sendChat, so every client renders
   *  one ordering with no duplicate local copy. */
  chatLog: ChatMessage[];
  /** Transport failures the wire ErrorCode enum doesn't cover. */
  notice: string | null;
  snapshotRef: React.MutableRefObject<unknown>;
  snapshotVersion: number;
  guestInputsRef: React.MutableRefObject<Map<string, NetInputPayload>>;
  createRoom: (name: string, starCount: 2 | 3 | 4, isPrivate: boolean, callsign: string, callsignPassword?: string) => void;
  joinRoom: (code: string, callsign: string, callsignPassword?: string) => void;
  /** STEP AWAY (Adam, 2026-10-21): closing the socket parks the seat
   *  in reconnect grace — a bot plays on and the seat stays
   *  reclaimable all match. This is leaveRoom; grace is what a close
   *  has always meant server-side, now deliberately choosable. */
  leaveRoom: () => void;
  /** FORFEIT (Adam, 2026-10-21): sends the forfeit message (full
   *  release — no grace, no reclaim, no ban) and runs the same local
   *  teardown as leaveRoom. The rage-quit door. */
  forfeitRoom: () => void;
  startMatch: () => void;
  kickPlayer: (targetPlayerId: string) => void;
  /** Teams (frozen contract, 2026-10-21): lobby phase, own seat only;
   * unbalanced is legal and invalid picks are silently ignored. */
  setTeam: (teamId: TeamId) => void;
  sendInput: (payload: NetInputPayload) => void;
  sendSnapshot: (state: unknown) => void;
  sendHostMessage: (msg: ClientMessage) => void;
  /** Send one chat line. No local append: the server's echo is
   *  the only write path into chatLog (see its note above). The
   *  text is trimmed and capped client-side to mirror the
   *  server's hygiene; the server remains the authority. */
  sendChat: (text: string) => void;
}

export const NetSessionContext = React.createContext<NetSession | null>(null);

const PLAYER_ID_KEY = 'mr.playerId';
const TERMINAL_ERRORS: ErrorCode[] = ['room_not_found', 'room_full', 'version_mismatch', 'kicked'];

export function useNetClient(): NetSession {
  const [clientState, setClientState] = React.useState<ClientState>({ connection: 'idle', lastError: null });
  const [room, setRoom] = React.useState<RoomState | null>(null);
  const [myPlayerId, setMyPlayerId] = React.useState<string | null>(null);
  const [migration, setMigration] = React.useState<HostMigration | null>(null);
  const [standings, setStandings] = React.useState<Standing[] | null>(null);
  const [matchEnded, setMatchEnded] = React.useState<MatchEndedEvent | null>(null);
  const [stageByStar, setStageByStar] = React.useState<Record<string, StageChangedEvent>>({});
  const [reclaimedOwnerId, setReclaimedOwnerId] = React.useState<string | null>(null);
  const [chatLog, setChatLog] = React.useState<ChatMessage[]>([]);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [snapshotVersion, setSnapshotVersion] = React.useState(0);

  const wsRef = React.useRef<WebSocket | null>(null);
  const snapshotRef = React.useRef<unknown>(null);
  const guestInputsRef = React.useRef<Map<string, NetInputPayload>>(new Map());
  const codeRef = React.useRef<string | null>(null);
  const callsignRef = React.useRef<string>('');
  /** Reserved-callsign password proof, presented with the hello
   *  (Adam, 2026-10-21). Held only in memory for this session's
   *  (re)hellos — never persisted to storage. */
  const callsignPasswordRef = React.useRef<string | undefined>(undefined);
  const intentionalRef = React.useRef(false);
  const terminalRef = React.useRef<ErrorCode | null>(null);
  const reconnectTimerRef = React.useRef<number | null>(null);
  const standingsSeqRef = React.useRef<number | null>(null);
  const reclaimTimerRef = React.useRef<number | null>(null);

  const mySeat = React.useMemo<Seat | null>(() => {
    if (!room || !myPlayerId) return null;
    return room.seats.find(s => s.occupant.playerId === myPlayerId) ?? null;
  }, [room, myPlayerId]);

  const isHost = !!room && !!myPlayerId && room.hostPlayerId === myPlayerId;

  const send = React.useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const clearReconnect = () => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const connect = React.useCallback((code: string) => {
    clearReconnect();
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/api/rooms/${code}/ws`);
    wsRef.current = ws;
    terminalRef.current = null;

    ws.onopen = () => {
      const stored = window.localStorage.getItem(PLAYER_ID_KEY) || undefined;
      send({ type: 'hello', clientVersion: CLIENT_VERSION, callsign: callsignRef.current, playerId: stored, callsignPassword: callsignPasswordRef.current });
    };

    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(ev.data as string) as ServerMessage; } catch { return; }
      switch (msg.type) {
        case 'welcome': {
          window.localStorage.setItem(PLAYER_ID_KEY, msg.playerId);
          setMyPlayerId(msg.playerId);
          setRoom(msg.room);
          setClientState({ connection: 'connected', lastError: null });
          setNotice(null);
          break;
        }
        case 'roomState': {
          setRoom(msg.room);
          break;
        }
        case 'error': {
          terminalRef.current = msg.code;
          setClientState(prev => ({ ...prev, lastError: msg.code }));
          break;
        }
        case 'seatClaimed': {
          if (msg.reclaimed && msg.seat.occupant.playerId) {
            setReclaimedOwnerId(msg.seat.ownerId);
            if (reclaimTimerRef.current) window.clearTimeout(reclaimTimerRef.current);
            reclaimTimerRef.current = window.setTimeout(() => setReclaimedOwnerId(null), 8000);
          }
          break;
        }
        case 'hostMigrating': {
          setMigration({ fromPlayerId: msg.fromPlayerId, toPlayerId: msg.toPlayerId });
          break;
        }
        case 'hostMigrated': {
          setMigration(null);
          break;
        }
        case 'standings': {
          if (standingsSeqRef.current !== null && msg.seq !== standingsSeqRef.current + 1) {
            setClientState(prev => ({ ...prev, connection: 'desync', desync: { expectedSeq: (standingsSeqRef.current ?? 0) + 1, gotSeq: msg.seq } }));
          }
          standingsSeqRef.current = msg.seq;
          setStandings(msg.standings);
          break;
        }
        case 'stageChanged': {
          setStageByStar(prev => ({ ...prev, [msg.starId]: msg }));
          break;
        }
        case 'matchEnded': {
          setMatchEnded(msg);
          setStandings(msg.standings);
          break;
        }
        case 'snapshot': {
          snapshotRef.current = msg.state;
          setSnapshotVersion(v => v + 1);
          // A fresh full snapshot is the resync (contract): clear desync.
          setClientState(prev => (prev.connection === 'desync' ? { connection: 'connected', lastError: prev.lastError } : prev));
          break;
        }
        case 'chat': {
          // Echo-only writes, ordered by the server's seq: a frame
          // at or behind the log's tail is a duplicate — dropped.
          setChatLog(prev => {
            if (prev.length > 0 && msg.message.seq <= prev[prev.length - 1].seq) return prev;
            return [...prev, msg.message].slice(-CHAT_HISTORY_LIMIT);
          });
          break;
        }
        case 'chatHistory': {
          // The seed IS the resync: replace wholesale.
          setChatLog(msg.messages.slice(-CHAT_HISTORY_LIMIT));
          break;
        }
        case 'input': {
          if (typeof msg.payload === 'object' && msg.payload !== null) {
            const payload = msg.payload as NetInputPayload;
            const prev = guestInputsRef.current.get(msg.fromOwnerId);
            if (!prev || payload.seq >= prev.seq) guestInputsRef.current.set(msg.fromOwnerId, payload);
          }
          break;
        }
        default:
          break; // seatReleased / seatUpdated: the following roomState full-sync carries the truth
      }
    };

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
      if (intentionalRef.current) return;
      if (terminalRef.current && TERMINAL_ERRORS.includes(terminalRef.current)) {
        // Terminal hello answer / kick: stop, clear the room, keep the
        // error visible on the lobby entry screen.
        setRoom(null);
        setMyPlayerId(null);
        setClientState(prev => ({ connection: 'idle', lastError: terminalRef.current }));
        return;
      }
      // Uninvited close mid-session: reconnect + re-hello (reclaim).
      setClientState(prev => ({ ...prev, connection: 'reconnect_grace', reconnectGraceEndsAt: prev.reconnectGraceEndsAt ?? Date.now() + 20000 }));
      const codeNow = codeRef.current;
      if (codeNow) {
        reconnectTimerRef.current = window.setTimeout(() => connect(codeNow), 2000);
      }
    };
  }, [send]);

  const joinRoom = React.useCallback((code: string, callsign: string, callsignPassword?: string) => {
    const clean = code.trim().toUpperCase();
    if (clean.length < 6 || !callsign.trim()) return;
    intentionalRef.current = false;
    codeRef.current = clean;
    callsignRef.current = callsign.trim();
    callsignPasswordRef.current = callsignPassword;
    setMatchEnded(null);
    setStandings(null);
    setChatLog([]);
    standingsSeqRef.current = null;
    setClientState({ connection: 'connecting', lastError: null });
    connect(clean);
  }, [connect]);

  const createRoom = React.useCallback((name: string, starCount: 2 | 3 | 4, isPrivate: boolean, callsign: string, callsignPassword?: string) => {
    if (!callsign.trim()) return;
    setClientState({ connection: 'connecting', lastError: null });
    setNotice(null);
    const body: CreateRoomRequest = { name: name.trim(), starCount, clientVersion: CLIENT_VERSION, private: isPrivate };
    fetch('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        if (!res.ok) {
          // ERROR TAXONOMY (Adam's blank-name defect, 2026-10-21): the
          // server ANSWERED and refused — say so honestly, with its
          // reason. The connection wording below is reserved for when
          // no answer ever arrived. A refusal is not a connection.
          // The shape is PINNED (BackGround, 2026-10-21): {error: code}
          // is the whole body — no human detail field exists, and if
          // one ever ships it arrives as an announced contract change.
          // The copy keys off the code alone; nothing speculative.
          let code = '';
          try {
            const e = (await res.json()) as { error?: string };
            code = typeof e.error === 'string' ? e.error : '';
          } catch { /* an unparseable refusal is still a refusal */ }
          setClientState({ connection: 'idle', lastError: null });
          if (code === 'version_mismatch') {
            setNotice('VERSION MISMATCH — REFRESH THE GAME AND TRY AGAIN');
          } else if (code === 'name_taken') {
            // Name uniqueness (Adam, 2026-10-21): live room names are
            // unique — a typed collision is a refusal with a remedy,
            // not a mystery. The dice sits right beside the field.
            setNotice('THAT ROOM NAME IS TAKEN — PICK ANOTHER, OR ROLL THE DICE');
          } else if (code === 'code_unavailable') {
            // Not a refusal of anything the player did: the server
            // could not mint a room code (503). Rare enough to be a
            // curiosity, honest enough to name.
            setNotice('THE SERVER COULD NOT MINT A ROOM CODE — TRY AGAIN IN A MOMENT');
          } else {
            setNotice(`THE SERVER REFUSED THAT ROOM (ERROR ${res.status}) — TRY AGAIN`);
          }
          return;
        }
        const data = (await res.json()) as CreateRoomResponse;
        // Creating != seated: hello through the socket like everyone.
        joinRoom(data.code, callsign, callsignPassword);
      })
      .catch(() => {
        setClientState({ connection: 'idle', lastError: null });
        setNotice('COULD NOT REACH THE SERVER — CHECK YOUR CONNECTION AND TRY AGAIN');
      });
  }, [joinRoom]);

  const leaveRoom = React.useCallback(() => {
    intentionalRef.current = true;
    clearReconnect();
    wsRef.current?.close();
    wsRef.current = null;
    codeRef.current = null;
    setRoom(null);
    setMyPlayerId(null);
    setMigration(null);
    setMatchEnded(null);
    setStandings(null);
    setStageByStar({});
    setReclaimedOwnerId(null);
    setChatLog([]);
    guestInputsRef.current.clear();
    setClientState({ connection: 'idle', lastError: null });
  }, []);

  const forfeitRoom = React.useCallback(() => {
    // The message rides ahead of the close in the same task — the
    // server releases the seat on receipt and closes its side too,
    // so the release never depends on which close lands first.
    send({ type: 'forfeit' });
    leaveRoom();
  }, [send, leaveRoom]);

  const startMatch = React.useCallback(() => send({ type: 'start' }), [send]);
  const setTeam = React.useCallback((teamId: TeamId) => {
    send({ type: 'setTeam', teamId });
  }, [send]);
  const kickPlayer = React.useCallback((targetPlayerId: string) => send({ type: 'kick', targetPlayerId }), [send]);
  const sendInput = React.useCallback((payload: NetInputPayload) => send({ type: 'input', payload }), [send]);
  const sendSnapshot = React.useCallback((state: unknown) => send({ type: 'snapshot', state }), [send]);
  const sendHostMessage = React.useCallback((msg: ClientMessage) => send(msg), [send]);
  const sendChat = React.useCallback((text: string) => {
    const clean = text.trim();
    if (!clean) return;
    // Capped here so an over-length line arrives shortened rather
    // than dropped whole by the server; the composer should still
    // cap its own input at CHAT_MAX_CHARS so this never bites.
    send({ type: 'chat', text: clean.slice(0, CHAT_MAX_CHARS) });
  }, [send]);

  // Host heartbeat: ~2s while hosting a live match (DO promotes after
  // 5s of silence). A promoted host starts beating by the same rule —
  // promotion is its baseline; a returning host never retakes the role.
  React.useEffect(() => {
    if (!isHost || room?.phase !== 'live') return;
    send({ type: 'heartbeat' });
    const id = window.setInterval(() => send({ type: 'heartbeat' }), 2000);
    return () => window.clearInterval(id);
  }, [isHost, room?.phase, send]);

  // Unmount cleanup.
  React.useEffect(() => () => {
    intentionalRef.current = true;
    clearReconnect();
    wsRef.current?.close();
  }, []);

  return {
    clientState, room, myPlayerId, mySeat, isHost,
    migration, standings, matchEnded, stageByStar,
    reclaimedOwnerId, chatLog, notice,
    snapshotRef, snapshotVersion, guestInputsRef,
    createRoom, joinRoom, leaveRoom, forfeitRoom, startMatch, kickPlayer, setTeam,
    sendInput, sendSnapshot, sendHostMessage, sendChat,
  };
}
