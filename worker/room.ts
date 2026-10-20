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
 * relay to the host, snapshot echo + broadcast.
 *
 * P2-3a adds the sync completion: MIGRATION PROMOTION (the DO alarm
 * watches the host heartbeat; roomLogic's evaluateMigration decides,
 * this class broadcasts hostMigrating → hostMigrated), TAKEOVER
 * (hello during live/cinematic claims a bot seat through the same
 * claim path), RECONNECT GRACE + RECLAIM (socket-gone parks the seat
 * under bot control with its human identity held, all match), and
 * ROOM CLOSE (last human presence erased → the lobby index row is
 * deleted and the record discarded). All verdicts stay in
 * roomLogic; this class is still only the runtime shell.
 *
 * Alarm-verification caveat: DO alarms cannot be exercised locally
 * (no miniflare in this repo) — the pure decision logic is
 * sanity-tested under tsx; the alarm wiring itself is code-reviewed
 * only until the next main merge deploys it.
 */

import {
  HEARTBEAT_TIMEOUT_MS,
  claimSeat,
  disconnectSeat,
  evaluateMigration,
  findSeatByPlayerId,
  isClientVersionSupported,
  isHost,
  kickPlayer,
  reconcileHosting,
  recordHostHeartbeat,
  roomMeta,
  shouldCloseRoom,
  startMatch,
  toRoomState,
  createRoomRecord,
} from './roomLogic';
import type { MigrationOutcome, RoomRecord } from './roomLogic';
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
      if (this.room) {
        // Records written before P2-3a lack the grace/ban bookkeeping.
        this.room.heldIdentities ??= {};
        this.room.bannedPlayerIds ??= [];
      }
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
        if (startMatch(this.room, playerId, Date.now())) {
          await this.persistRoom();
          // Phase change → full sync (contract: roomState on any
          // membership/phase change). No separate phase event exists.
          this.broadcast({ type: 'roomState', room: toRoomState(this.room) });
          await this.notifyIndex();
          // The match is live: the migration watch starts now.
          await this.armMigrationAlarm();
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
          // A kick erases a human presence entirely; if it was the
          // last one, the room closes (conservative predicate — a
          // connected kicking host keeps it false in practice).
          if (shouldCloseRoom(this.room)) await this.closeRoom();
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
        // The migration watch: record the beat and (re)arm the alarm
        // at beat + timeout. setAlarm replaces the pending alarm, so
        // exactly one wake-up is ever outstanding, always tracking
        // the freshest beat.
        if (recordHostHeartbeat(this.room, playerId, Date.now())) {
          await this.persistRoom();
          await this.armMigrationAlarm();
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

  /** The migration watch's wake-up. The pure verdict lives in
   *  roomLogic.evaluateMigration; this handler applies it: broadcast
   *  the migration event pair on a promotion, close the room when
   *  nobody can host and nobody is held, or re-arm when the firing
   *  was early (the start-stamp alarm racing a slightly late first
   *  beat) and the host is in fact healthy. */
  async alarm(): Promise<void> {
    if (!this.room) return;
    const outcome = evaluateMigration(this.room, Date.now());
    if (outcome.action === 'none') {
      await this.armMigrationAlarm();
      return;
    }
    await this.applyMigrationOutcome(outcome, 'heartbeat_timeout');
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
    // id is honored as the identity to seat — claimSeat resolves it
    // as a refresh, a grace reclaim, a live-match takeover, or a
    // fresh claim, and refuses kicked ids outright.
    const playerId =
      msg.playerId && msg.playerId.trim()
        ? msg.playerId
        : `player-${crypto.randomUUID()}`;
    const claim = claimSeat(this.room, playerId, msg.callsign ?? '');
    if (claim.ok === false) {
      this.send(ws, { type: 'error', code: claim.error });
      ws.close(1008, claim.error);
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
      claim.reclaimed
        ? { type: 'seatClaimed', seat, reclaimed: true }
        : claim.isNewClaim
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
    // seat; only the last close parks it in reconnect grace.
    if (this.socketsOf(playerId, ws).length > 0) return;
    const seat: Seat | null = disconnectSeat(this.room, playerId);
    if (!seat) return;
    // Hosting settles BEFORE the sync goes out, so the roomState
    // below already names the promoted host (or the vacancy).
    const outcome = reconcileHosting(this.room, Date.now());
    await this.persistRoom();
    this.broadcast({ type: 'seatReleased', seat });
    if (outcome.action === 'promote') {
      // applyMigrationOutcome does its own roomState + index sync.
      await this.applyMigrationOutcome(outcome, 'host_disconnected');
      return;
    }
    if (outcome.action === 'close' || shouldCloseRoom(this.room)) {
      await this.closeRoom();
      return;
    }
    this.broadcastRoomState();
    await this.notifyIndex();
  }

  /** (Re)arm the one migration alarm at last-beat + timeout. Only
   *  meaningful while a match is live/cinematic with a heartbeat
   *  baseline outstanding — and only when the deadline is still in
   *  the future: arming a past deadline would fire immediately, and
   *  when the verdict was 'none' with the deadline already due (a
   *  held room waiting on a human who may return), nothing changes
   *  until the next membership event re-runs reconciliation. */
  private async armMigrationAlarm(): Promise<void> {
    if (!this.room) return;
    if (this.room.phase !== 'live' && this.room.phase !== 'cinematic') {
      return;
    }
    if (this.room.hostLastHeartbeatAt === null) return;
    const deadline = this.room.hostLastHeartbeatAt + HEARTBEAT_TIMEOUT_MS;
    if (deadline <= Date.now()) return;
    await this.state.storage.setAlarm(deadline);
  }

  /** Apply a migration verdict from roomLogic: broadcast the event
   *  pair + full sync on a promotion (the client renders a brief
   *  host-passing state), or close the room. The promoted host does
   *  not resume from nothing — guests already hold the host's
   *  snapshots, the DO holds the echo, and the new host's client
   *  takes over the sim from its freshest applied state (P2-3b
   *  wires the client side of that law). */
  private async applyMigrationOutcome(
    outcome: MigrationOutcome,
    reason: string,
  ): Promise<void> {
    if (!this.room) return;
    if (outcome.action === 'promote') {
      await this.persistRoom();
      this.broadcast({
        type: 'hostMigrating',
        // '' only in the no-flagged-host edge (every flag cleared
        // before the verdict) — there is no previous host to name.
        fromPlayerId: outcome.fromPlayerId ?? '',
        toPlayerId: outcome.toPlayerId,
        reason,
      });
      this.broadcast({
        type: 'hostMigrated',
        hostPlayerId: outcome.toPlayerId,
        hostOwnerId: outcome.hostOwnerId,
      });
      this.broadcastRoomState();
      await this.notifyIndex();
      // The verdict restamped the baseline to the promotion moment;
      // arm the watch for the NEW host.
      await this.armMigrationAlarm();
    } else if (outcome.action === 'close') {
      await this.closeRoom();
    }
  }

  /** Room close (design §6: the last human leaves, the room closes):
   *  drop the lobby index row, discard the record + snapshot echo,
   *  disarm the watch. Nobody is broadcast to — by the close
   *  predicate there is no connected human left to tell. */
  private async closeRoom(): Promise<void> {
    const code = this.room?.code;
    this.room = null;
    this.latestSnapshot = null;
    await this.state.storage.delete(ROOM_KEY);
    await this.state.storage.delete(SNAPSHOT_KEY);
    await this.state.storage.deleteAlarm();
    if (code) await this.notifyIndexDelete(code);
  }

  private async notifyIndexDelete(code: string): Promise<void> {
    try {
      const stub = this.env.LOBBY_INDEX.get(
        this.env.LOBBY_INDEX.idFromName(INDEX_NAME),
      );
      await stub.fetch(
        new Request(`https://index.internal/metas/${code}`, {
          method: 'DELETE',
        }),
      );
    } catch {
      // Index freshness is advisory (see worker/index.ts header).
    }
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
