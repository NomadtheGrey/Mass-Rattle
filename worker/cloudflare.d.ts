/**
 * Minimal ambient Cloudflare Workers types for worker/ — ONLY what the
 * Phase 2 code uses. This repo has no @cloudflare/workers-types and
 * P2-1 must not add dependencies, so the handful of runtime globals
 * the DOM lib doesn't know are declared here.
 *
 * Route chosen (flagged in the P2-1 report): ONE `declare global` block
 * in this module. The app's tsconfig has no `include`, so worker/
 * compiles under the app's DOM lib — which already provides WebSocket,
 * fetch, Request, Response, URL, crypto. Nothing here redeclares
 * those; the DOM `WebSocket` / `ResponseInit` interfaces are only
 * EXTENDED by interface merging with the extra members the Workers
 * runtime adds (accept / attachments on server sockets, the 101
 * `webSocket` response option). The app's own types are untouched.
 */

export {};

declare global {
  interface DurableObjectId {
    toString(): string;
  }

  interface DurableObjectStub {
    fetch(request: Request): Promise<Response>;
  }

  interface DurableObjectNamespace {
    newUniqueId(): DurableObjectId;
    idFromName(name: string): DurableObjectId;
    idFromString(id: string): DurableObjectId;
    get(id: DurableObjectId): DurableObjectStub;
  }

  interface DurableObjectStorage {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<boolean>;
    /** Alarms (P2-3a): a one-shot wake-up for the DO — the migration
     *  watch. setAlarm REPLACES any pending alarm; the DO's `alarm()`
     *  handler runs when it fires, even after hibernation. */
    setAlarm(timestamp: number): Promise<void>;
    getAlarm(): Promise<number | null>;
    deleteAlarm(): Promise<void>;
  }

  interface DurableObjectState {
    readonly id: DurableObjectId;
    readonly storage: DurableObjectStorage;
    blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
    /** Hibernation API: hand a server socket to the runtime so the DO
     *  can sleep with connections open; events arrive as
     *  webSocketMessage / webSocketClose / webSocketError. */
    acceptWebSocket(ws: WebSocket, tags?: string[]): void;
    getWebSockets(tag?: string): WebSocket[];
    getTags(ws: WebSocket): string[];
  }

  /** Workers-only extras on a server-side WebSocket (DOM lib's
   *  interface, extended by merging — client sockets never call
   *  these). */
  interface WebSocket {
    accept(): void;
    serializeAttachment(value: unknown): void;
    deserializeAttachment(): unknown;
  }

  class WebSocketPair {
    readonly 0: WebSocket;
    readonly 1: WebSocket;
  }

  /** Workers-only Response option: the client half of a WebSocketPair
   *  on a 101 response. */
  interface ResponseInit {
    webSocket?: WebSocket;
  }

  interface ExecutionContext {
    waitUntil(promise: Promise<unknown>): void;
    passThroughOnException(): void;
  }

  /** A bound service / assets fetcher (env.ASSETS). */
  interface Fetcher {
    fetch(request: Request): Promise<Response>;
  }

  /** The Worker's bindings (see wrangler.jsonc). Global by convention
   *  so both the entry and the DO classes share one shape. */
  interface Env {
    ROOMS: DurableObjectNamespace;
    LOBBY_INDEX: DurableObjectNamespace;
    ASSETS?: Fetcher;
  }
}
