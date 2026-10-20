/**
 * Mass Rattle Worker entry (Phase 2, P2-1).
 *
 * Routes:
 *   POST /api/rooms            create a room (contract join flow)
 *   GET  /api/rooms            list PUBLIC rooms (private = unlisted)
 *   GET  /api/rooms/:code/ws   WebSocket upgrade → RoomDO passthrough
 *   everything else            static assets, exactly as before P2-1
 *
 * Room-list index approach (chosen for P2-1; flagged in the report):
 * a single well-known LobbyIndexDO instance tracks { code → meta }.
 * This Worker writes the index directly on create — it proxies every
 * create, so no room can exist that the index never heard of — and
 * each RoomDO pushes fresh meta on seat/phase changes. Phase/seat
 * freshness in the list can still lag by one change if a RoomDO's
 * index write fails (it is best-effort); joining is always resolved
 * against the RoomDO itself, never the index.
 *
 * The single-player game is untouched: wrangler's assets config uses
 * run_worker_first ["/api/*"], so non-API requests never reach this
 * code in production; the ASSETS fallthrough below only covers paths
 * that do reach the Worker.
 */

import { generateRoomCode, isClientVersionSupported } from './roomLogic';
import { INDEX_NAME } from './room';
import type { RoomInitBody } from './room';
import type {
  CreateRoomRequest,
  CreateRoomResponse,
  ListRoomsResponse,
  RoomMeta,
  RoomState,
} from '../src/net/protocol';

export { RoomDO, INDEX_NAME } from './room';
export { LobbyIndexDO } from './lobbyIndex';

const CODE_PATH = /^\/api\/rooms\/([A-Za-z2-9]{6})\/ws$/;

function indexStub(env: Env): DurableObjectStub {
  return env.LOBBY_INDEX.get(env.LOBBY_INDEX.idFromName(INDEX_NAME));
}

function roomStub(env: Env, code: string): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

async function indexHasRoom(
  env: Env,
  code: string,
): Promise<boolean> {
  const res = await indexStub(env).fetch(
    new Request(`https://index.internal/metas/${code}`),
  );
  return res.status === 200;
}

async function roomExists(env: Env, code: string): Promise<boolean> {
  const res = await roomStub(env, code).fetch(
    new Request('https://room.internal/meta'),
  );
  return res.status === 200;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    /* ------------------------- room list / create ------------- */
    if (url.pathname === '/api/rooms') {
      if (request.method === 'GET') {
        const res = await indexStub(env).fetch(
          new Request('https://index.internal/metas'),
        );
        const data = (await res.json()) as { metas: RoomMeta[] };
        const body: ListRoomsResponse = {
          rooms: data.metas.filter((m) => !m.private),
        };
        return Response.json(body);
      }

      if (request.method === 'POST') {
        let body: CreateRoomRequest;
        try {
          body = (await request.json()) as CreateRoomRequest;
        } catch {
          return Response.json({ error: 'bad_request' }, { status: 400 });
        }
        if (!isClientVersionSupported(body.clientVersion)) {
          return Response.json(
            { error: 'version_mismatch' },
            { status: 400 },
          );
        }
        const name =
          typeof body.name === 'string' ? body.name.trim() : '';
        if (!name || name.length > 40) {
          return Response.json({ error: 'bad_request' }, { status: 400 });
        }
        if (![2, 3, 4].includes(body.starCount)) {
          return Response.json({ error: 'bad_request' }, { status: 400 });
        }

        // Unique code: check the index, backstopped by the RoomDO
        // itself (the source of truth) in case the index ever lost a
        // row — a collision must never hand back someone else's room.
        let code = '';
        for (let attempt = 0; attempt < 8; attempt++) {
          const candidate = generateRoomCode(Math.random);
          if (await indexHasRoom(env, candidate)) continue;
          if (await roomExists(env, candidate)) continue;
          code = candidate;
          break;
        }
        if (!code) {
          return Response.json(
            { error: 'code_unavailable' },
            { status: 503 },
          );
        }

        const seed = Math.floor(Math.random() * 2 ** 31);
        const init: RoomInitBody = {
          name,
          starCount: body.starCount,
          private: body.private ?? false,
          code,
          seed,
        };
        const initRes = await roomStub(env, code).fetch(
          new Request('https://room.internal/init', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(init),
          }),
        );
        const created = (await initRes.json()) as {
          room: RoomState;
          meta: RoomMeta;
        };

        // The Worker saw the create, so it writes the index itself.
        await indexStub(env).fetch(
          new Request('https://index.internal/metas', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(created.meta),
          }),
        );

        const responseBody: CreateRoomResponse = {
          code,
          roomId: code,
          seed,
          room: created.room,
        };
        return Response.json(responseBody, { status: 201 });
      }

      return Response.json({ error: 'not_found' }, { status: 404 });
    }

    /* ------------------------- WebSocket join ----------------- */
    const wsMatch = url.pathname.match(CODE_PATH);
    if (wsMatch && request.headers.get('Upgrade') === 'websocket') {
      const code = wsMatch[1].toUpperCase();
      if (!(await roomExists(env, code))) {
        return Response.json(
          { error: 'room_not_found' },
          { status: 404 },
        );
      }
      return roomStub(env, code).fetch(request);
    }

    if (url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }

    /* ------------------------- static assets ------------------ */
    if (env.ASSETS) return env.ASSETS.fetch(request);
    // With the ASSETS binding configured (wrangler.jsonc) this is
    // unreachable in production; a bare 404 beats looping the request
    // back at our own origin. Flagged in the P2-1 report.
    return new Response('Not found', { status: 404 });
  },
};
