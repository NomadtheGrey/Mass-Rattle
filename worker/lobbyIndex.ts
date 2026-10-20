/**
 * LobbyIndexDO — the room-list index: one well-known instance
 * (idFromName('lobby-index')) holding { code → RoomMeta } for every
 * room the Worker has created.
 *
 * Why this exists: a Durable Object can only see itself, so "list
 * public rooms" needs an index somewhere. The write path is simple
 * because the Worker sees every create — it writes the index directly
 * on create, and each RoomDO pushes a fresh meta on every seat/phase
 * change (rare events, not per-frame). Internal fetch surface only:
 *
 *   POST   /metas        body: RoomMeta → upsert
 *   GET    /metas        → { metas: RoomMeta[] } (all, private too —
 *                        the Worker filters for the public list)
 *   GET    /metas/<code> → RoomMeta or 404 (create-collision check)
 *   DELETE /metas/<code> → remove (no P2-1 caller; rooms have no
 *                        expiry/GC yet — flagged in the P2-1 report)
 */

import type { RoomMeta } from '../src/net/protocol';

const METAS_KEY = 'metas';

export class LobbyIndexDO {
  private readonly state: DurableObjectState;
  private metas: Record<string, RoomMeta> = {};

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
    state.blockConcurrencyWhile(async () => {
      this.metas =
        (await state.storage.get<Record<string, RoomMeta>>(METAS_KEY)) ??
        {};
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ['metas', code?]

    if (parts[0] !== 'metas') {
      return new Response('Not found', { status: 404 });
    }

    if (request.method === 'POST' && parts.length === 1) {
      const meta = (await request.json()) as RoomMeta;
      if (!meta || typeof meta.code !== 'string') {
        return Response.json({ error: 'bad_request' }, { status: 400 });
      }
      this.metas[meta.code] = meta;
      await this.state.storage.put(METAS_KEY, this.metas);
      return Response.json({ ok: true });
    }

    if (request.method === 'GET' && parts.length === 1) {
      return Response.json({ metas: Object.values(this.metas) });
    }

    if (parts.length === 2) {
      const code = decodeURIComponent(parts[1]);
      if (request.method === 'GET') {
        const meta = this.metas[code];
        if (!meta) {
          return Response.json(
            { error: 'room_not_found' },
            { status: 404 },
          );
        }
        return Response.json({ meta });
      }
      if (request.method === 'DELETE') {
        delete this.metas[code];
        await this.state.storage.put(METAS_KEY, this.metas);
        return Response.json({ ok: true });
      }
    }

    return new Response('Not found', { status: 404 });
  }
}
