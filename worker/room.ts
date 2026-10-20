/**
 * RoomDO — one Durable Object per room (the room code IS the DO name).
 *
 * Owns membership and seats, host election, message relay, phase, the
 * latest-snapshot echo cache, and the host heartbeat timestamp. It
 * NEVER simulates (contract): the host's browser runs the sim; this
 * object only moves messages and keeps the room's truth.
 *
 * Every seat/phase decision delegates to worker/roomLogic.ts (pure,
 * tsx-testable); this class is the runtime shell: storage, sockets,
 * JSON. Sockets use the hibernation API (state.acceptWebSocket) so
 * the DO can sleep with a lobby open.
 *
 * P2-1 produces: roomState / welcome / error / seatClaimed /
 * seatReleased / seatUpdated, the phase change on host start, input
 * relay to the host, snapshot echo + broadcast. Migration promotion,
 * takeover-into-live and reconnect bot-hold/reclaim are P2-3 — the
 * fields they need (host heartbeat ts, per-seat occupant/connection)
 * are recorded here but never acted on beyond election-on-change.
 */

import {
  claimSeat,
  findSeatByPlayerId,
  isClientVersionSupported,
  isHost,
  kickPlayer,
  recordHostHeartbeat,
  releaseSeat,
  roomMeta,
  startMatch,
  toRoomState,
  createRoomRecord,
} from './roomLogic';
import type { RoomRecord } from './roomLogic';
import type {
  ClientMessage,
  RoomMeta,
  Seat,
  ServerMessage,
  StarCount,
} from '../src/net/protocol';

/** Internal Worker → DO init call (POST /init). Not client wire. */
export interface RoomInitBody {
  name: string;
  starCount: StarCount;
  private: boolean;
  code: string;
  seed: number;
}

interface SocketSession {
  playerId?: string;
}

const ROOM_KEY = 'room';
const SNAPSHOT_KEY = 'snapshot';

export class RoomDO {
  private readonly state: DurableObjectState;
  private readonly env: Env;
  private room: RoomRecord | null = null;
  /** Latest host snapshot, echoed back for P2-3 migration. Kept out
   *  of the RoomRecord: it is opaque bulk, persisted under its own
   *  storage key so membership writes don't rewrite it. */
  private latestSnapshot: unknown = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    state.blockConcurrencyWhile(async () => {
      this.room = (await state.storage.get<RoomRecord>(ROOM_KEY)) ?? null;
      this.latestSnapshot =
        (await state.storage.get<unknown>(SNAPSHOT_KEY)) ?? null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal: room creation (Worker only; never routed from clients).
    if (url.pathname === '/init' && request.method === 'POST') {
      const body = (await request.json()) as RoomInitBody;
      if (!this.room) {
        // Version is gated by the Worker (create) and again at hello;
        // creation itself only needs the room spec.
        this.room = createRoomRecord(
          {
            name: body.name,
            starCount: body.starCount,
            private: body.private,
          },
          body.code,
          body.seed,
          Date.now(),
        );
        await this.persistRoom();
      }
      return Response.json({ room: toRoomState(this.room), meta: roomMeta(this.room) });
    }

    // Internal: existence + list metadata (Worker's ws-route check and
    // the create-collision backstop).
    if (url.pathname === '/meta' && request.method === 'GET') {
      if (!this.room) return Response.json({ error: 'room_not_found' }, { status: 404 });
      return Response.json({ meta: roomMeta(this.room) });
    }

    // WebSocket passthrough from the Worker's /api/rooms/:code/ws.
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.state.acceptWebSocket(server);
      server.serializeAttachment({} satisfies SocketSession);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(
    ws: WebSocket,
    raw: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof raw !== 'string') return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return; // malformed frame: no contract error code covers it; ignore
    }
    const session = this.sessionOf(ws);

    if (msg.type === 'hello') {
      await this.handleHello(ws, msg);
      return;
    }
    // Everything below requires a completed hello on this socket.
    const playerId = session.playerId;
    if (!playerId || !this.room) return;

    switch (msg.type) {
      case 'start': {
        if (startMatch(this.room, playerId)) {
          await this.persistRoom();
          // Phase change → full sync (contract: roomState on any
          // membership/phase change). No separate phase event exists.
          this.broadcast({ type: 'roomState', room: toRoomState(this.room) });
          await this.notifyIndex();
        }
        // Non-host or wrong phase: ignored — the contract's error set
        // has no code for it (flagged in the P2-1 report).
        break;
      }
      case 'kick': {
        const freed = kickPlayer(this.room, playerId, msg.targetPlayerId);
        if (freed) {
          await this.persistRoom();
          for (const target of this.socketsOf(msg.targetPlayerId)) {
            this.send(target, { type: 'error', code: 'kicked' });
            target.close(1000, 'kicked');
          }
          this.broadcast({ type: 'seatReleased', seat: freed });
          this.broadcastRoomState();
          await this.notifyIndex();
        }
        break;
      }
      case 'input': {
        // Guest intent → the host connection only. The host's own
        // inputs are local to its sim and are never relayed.
        const sender = findSeatByPlayerId(this.room, playerId);
        if (!sender || sender.isHost) break;
        const relay: ServerMessage = {
          type: 'input',
          fromOwnerId: sender.ownerId,
          fromPlayerId: playerId,
          payload: msg.payload,
        };
        const host = this.room.seats.find((s) => s.isHost);
        if (host?.occupant.playerId) {
          for (const target of this.socketsOf(host.occupant.playerId)) {
            this.send(target, relay);
          }
        }
        break;
      }
      case 'snapshot': {
        // Host only: cache as the migration echo + broadcast to
        // everyone else (the host already has its own state).
        if (!isHost(this.room, playerId)) break;
        this.latestSnapshot = msg.state;
        await this.state.storage.put(SNAPSHOT_KEY, msg.state);
        this.broadcast({ type: 'snapshot', state: msg.state }, ws);
        break;
      }
      case 'heartbeat': {
        // Recorded for P2-3's migration watch. No promotion in P2-1.
        if (recordHostHeartbeat(this.room, playerId, Date.now())) {
          await this.persistRoom();
        }
        break;
      }
      default:
        // standings / stageChanged / matchEnded are host-authored and
        // defined in the protocol, but their DO relay lands with the
        // slices that produce them (P2-2/P2-4) — ignored in P2-1.
        break;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.handleSocketGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleSocketGone(ws);
  }

  /* ---------------------------------------------------------------- */

  private async handleHello(
    ws: WebSocket,
    msg: Extract<ClientMessage, { type: 'hello' }>,
  ): Promise<void> {
    if (!this.room) {
      this.send(ws, { type: 'error', code: 'room_not_found' });
      ws.close(1008, 'room_not_found');
      return;
    }
    if (!isClientVersionSupported(msg.clientVersion)) {
      this.send(ws, { type: 'error', code: 'version_mismatch' });
      ws.close(1008, 'version_mismatch');
      return;
    }
    // Server issues playerId on first hello (contract); a presented
    // id is honored as the identity to seat (P2-3 completes reclaim).
    const playerId =
      msg.playerId && msg.playerId.trim()
        ? msg.playerId
        : `player-${crypto.randomUUID()}`;
    const claim = claimSeat(this.room, playerId, msg.callsign ?? '');
    if (!claim) {
      this.send(ws, { type: 'error', code: 'room_full' });
      ws.close(1008, 'room_full');
      return;
    }
    ws.serializeAttachment({ playerId } satisfies SocketSession);
    await this.persistRoom();
    const seat = claim.seat;
    this.send(ws, {
      type: 'welcome',
      playerId,
      seat,
      room: toRoomState(this.room),
    });
    this.broadcast(
      claim.isNewClaim
        ? { type: 'seatClaimed', seat }
        : { type: 'seatUpdated', seat },
      ws,
    );
    this.broadcastRoomState();
    await this.notifyIndex();
  }

  private async handleSocketGone(ws: WebSocket): Promise<void> {
    const { playerId } = this.sessionOf(ws);
    if (!playerId || !this.room) return;
    // A second live socket for the same player (two tabs) keeps the
    // seat; only the last close releases it. P2-1 model: the seat
    // flips back to bot — bot-hold/reclaim is P2-3.
    if (this.socketsOf(playerId, ws).length > 0) return;
    const freed: Seat | null = releaseSeat(this.room, playerId);
    if (!freed) return;
    await this.persistRoom();
    this.broadcast({ type: 'seatReleased', seat: freed });
    this.broadcastRoomState();
    await this.notifyIndex();
  }

  private sessionOf(ws: WebSocket): SocketSession {
    try {
      return (ws.deserializeAttachment() as SocketSession) ?? {};
    } catch {
      return {};
    }
  }

  private socketsOf(playerId: string, except?: WebSocket): WebSocket[] {
    return this.state
      .getWebSockets()
      .filter(
        (s) => s !== except && this.sessionOf(s).playerId === playerId,
      );
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket already gone; its close event will reconcile the seat.
    }
  }

  private broadcast(msg: ServerMessage, except?: WebSocket): void {
    for (const ws of this.state.getWebSockets()) {
      if (ws !== except) this.send(ws, msg);
    }
  }

  private broadcastRoomState(): void {
    if (!this.room) return;
    this.broadcast({ type: 'roomState', room: toRoomState(this.room) });
  }

  private async persistRoom(): Promise<void> {
    if (this.room) await this.state.storage.put(ROOM_KEY, this.room);
  }

  /** Keep the lobby index's meta (phase / seatsTaken) fresh. Seat and
   *  phase changes are rare (not per-frame), so a cross-DO write per
   *  change is cheap. Best-effort: a stale list row must never break
   *  the room itself. */
  private async notifyIndex(): Promise<void> {
    if (!this.room) return;
    try {
      const meta: RoomMeta = roomMeta(this.room);
      const stub = this.env.LOBBY_INDEX.get(
        this.env.LOBBY_INDEX.idFromName(INDEX_NAME),
      );
      await stub.fetch(
        new Request('https://index.internal/metas', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(meta),
        }),
      );
    } catch {
      // Index freshness is advisory (see worker/index.ts header).
    }
  }
}

/** The well-known LobbyIndexDO instance name. Shared with
 *  worker/index.ts and worker/lobbyIndex.ts. */
export const INDEX_NAME = 'lobby-index';
