/**
 * Worker entry + Table Durable Object.
 *
 * Routes
 *   POST /api/tables              → create a table, returns { code }
 *   GET  /api/tables/:code        → public summary (exists? mode, seats) for the join screen
 *   GET  /api/tables/:code/ws     → WebSocket into that table's Durable Object
 *   GET  /api/ice                 → ICE servers for WebRTC (public STUN; TURN when configured)
 *   GET  /health
 *
 * Free-plan notes (spec §13):
 *   - SQLite-backed DO (new_sqlite_classes), WebSocket Hibernation API, ping/pong auto-response (no wake-ups).
 *   - The whole room is ONE KV row. Saves are debounced (≤1 write per ~2 s burst of activity, forced at 10 s),
 *     so a full 4-human game costs a few hundred row writes, a 1-human + 3-bot game far fewer.
 *   - Turn timers use a single "ticking" alarm that is only re-armed when it fires (≈1 alarm write per turn timeout window).
 *   - A table with nobody connected freezes (no bots, no timers) and is deleted after 24 h idle.
 */
import { DurableObject } from 'cloudflare:workers';
import { CODE_ALPHABET, CODE_LENGTH, type ServerMsg, isRoomCode, normalizeRoomCode } from '@spades/protocol';
import { Room, type RoomData, ROOM_DATA_VERSION, newRoomData } from './room';

export interface Env {
  TABLES: DurableObjectNamespace<TableDO>;
  ALLOWED_ORIGINS?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const SAVE_DEBOUNCE_MS = 2000;
const SAVE_MAX_DELAY_MS = 10_000;
const IDLE_DELETE_MS = 24 * 3600_000;

/* ------------------------------------------------------------------ worker */

function allowedOrigin(req: Request, env: Env): string | null {
  const origin = req.headers.get('Origin');
  if (!origin) return null;
  const list = (env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim());
  if (list.includes('*') || list.includes(origin)) return origin;
  // preview deployments of the Pages project: <hash>.bid-wit-me.pages.dev
  if (/^https:\/\/[a-z0-9-]+\.bid-wit-me\.pages\.dev$/.test(origin)) return origin;
  return null;
}

function json(body: unknown, init: ResponseInit = {}, origin: string | null = null): Response {
  const h = new Headers(init.headers);
  h.set('content-type', 'application/json');
  h.set('cache-control', 'no-store');
  if (origin) { h.set('access-control-allow-origin', origin); h.set('vary', 'Origin'); }
  return new Response(JSON.stringify(body), { ...init, headers: h });
}

function randomCode(): string {
  const b = new Uint8Array(CODE_LENGTH * 2);
  crypto.getRandomValues(b);
  let out = '';
  for (const x of b) {
    if (x >= 248) continue; // 248 = 31 * 8: rejection sampling, no modulo bias
    out += CODE_ALPHABET[x % CODE_ALPHABET.length];
    if (out.length === CODE_LENGTH) return out;
  }
  return randomCode();
}

async function iceServers(env: Env): Promise<unknown> {
  // TURN hook: with a Cloudflare Realtime TURN key configured, mint short-lived credentials (24 h).
  if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) {
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl: 86_400 }),
      });
      if (r.ok) {
        const j = (await r.json()) as { iceServers: unknown };
        return { iceServers: [...STUN, ...(Array.isArray(j.iceServers) ? j.iceServers : [j.iceServers])], turn: true };
      }
    } catch { /* fall back to STUN only */ }
  }
  return { iceServers: STUN, turn: false };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = allowedOrigin(req, env);
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: origin ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'Origin' } : {},
      });
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.pathname === '/health') return json({ ok: true }, {}, origin);
    if (parts[0] !== 'api') return json({ error: 'not found' }, { status: 404 }, origin);

    // browsers always send Origin on cross-site fetches/websockets; reject foreign sites (non-browser clients have none)
    if (req.headers.get('Origin') && !origin) return json({ error: 'origin not allowed' }, { status: 403 });

    if (parts[1] === 'ice' && req.method === 'GET') return json(await iceServers(env), {}, origin);

    if (parts[1] === 'tables' && parts.length === 2 && req.method === 'POST') {
      for (let i = 0; i < 6; i++) {
        const code = randomCode();
        const stub = env.TABLES.get(env.TABLES.idFromName(code));
        const r = await stub.fetch(`https://table/create?code=${code}`, { method: 'POST' });
        if (r.status === 201) return json({ code }, { status: 201 }, origin);
      }
      return json({ error: 'could not allocate a table code' }, { status: 503 }, origin);
    }

    if (parts[1] === 'tables' && parts[2]) {
      const code = normalizeRoomCode(parts[2]);
      if (!isRoomCode(code)) return json({ error: 'bad code' }, { status: 400 }, origin);
      const stub = env.TABLES.get(env.TABLES.idFromName(code));
      if (parts[3] === 'ws') {
        if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, { status: 426 }, origin);
        return stub.fetch(new Request(`https://table/ws?code=${code}`, req));
      }
      if (parts.length === 3 && req.method === 'GET') {
        const r = await stub.fetch(`https://table/info?code=${code}`);
        return json(await r.json(), { status: r.status }, origin);
      }
    }
    return json({ error: 'not found' }, { status: 404 }, origin);
  },
} satisfies ExportedHandler<Env>;

/* ---------------------------------------------------------- Durable Object */

interface Attachment { cid: string; pid: string | null }

export class TableDO extends DurableObject<Env> {
  private room: Room | null = null;
  private sockets = new Map<string, WebSocket>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private firstDirtyAt: number | null = null;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeAt = Infinity;
  private alarmAt: number | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      const data = await ctx.storage.get<RoomData>('room');
      this.alarmAt = await ctx.storage.getAlarm();
      if (data && data.v === ROOM_DATA_VERSION) this.attach(data);
      // re-register sockets that survived hibernation
      for (const ws of ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() as Attachment | null;
        if (!a) continue;
        this.sockets.set(a.cid, ws);
        this.room?.restoreConnection(a.cid, a.pid);
      }
    });
  }

  private attach(data: RoomData): void {
    this.room = new Room(data, {
      now: () => Date.now(),
      send: (cid, msg) => this.send(cid, msg),
      close: (cid, code, reason) => { const ws = this.sockets.get(cid); this.sockets.delete(cid); try { ws?.close(code, reason); } catch { /* gone */ } },
      wake: (ms) => this.wake(ms),
      setAlarm: (at) => this.armAlarm(at),
      persist: () => this.scheduleSave(),
      randomId: () => crypto.randomUUID().replace(/-/g, ''),
    });
  }

  private send(cid: string, msg: ServerMsg): void {
    const ws = this.sockets.get(cid);
    if (!ws) return;
    try { ws.send(JSON.stringify(msg)); } catch { /* closing */ }
    // keep the player id on the socket so it survives hibernation
    if (msg.t === 'welcome') ws.serializeAttachment({ cid, pid: msg.you } satisfies Attachment);
  }

  /** Short in-memory timer (bot moves). While it's pending the DO stays awake, which is fine: it's ≤ a few seconds. */
  private wake(ms: number): void {
    const at = Date.now() + Math.max(0, ms);
    if (this.wakeTimer && at >= this.wakeAt) return;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeAt = at;
    this.wakeTimer = setTimeout(() => { this.wakeTimer = null; this.wakeAt = Infinity; this.room?.tick(); }, Math.max(0, ms));
  }

  /** One "ticking" alarm: only (re)armed when nothing earlier is pending. Clearing is free (it just fires and finds nothing). */
  private armAlarm(at: number | null): void {
    if (at === null) return;
    const now = Date.now();
    if (this.alarmAt !== null && this.alarmAt > now - 5000 && this.alarmAt <= at) return;
    this.alarmAt = at;
    void this.ctx.storage.setAlarm(at);
  }

  private scheduleSave(): void {
    const now = Date.now();
    this.firstDirtyAt ??= now;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const delay = Math.max(0, Math.min(SAVE_DEBOUNCE_MS, this.firstDirtyAt + SAVE_MAX_DELAY_MS - now));
    this.saveTimer = setTimeout(() => this.flush(), delay);
  }

  private flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.firstDirtyAt = null;
    if (this.room) void this.ctx.storage.put('room', this.room.data);
  }

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const code = url.searchParams.get('code') ?? '';
    if (url.pathname === '/create') {
      if (this.room) return new Response('exists', { status: 409 });
      this.attach(newRoomData(code, Date.now()));
      this.flush();
      // garbage-collect the table if it's never used
      this.armAlarm(Date.now() + IDLE_DELETE_MS);
      return new Response('created', { status: 201 });
    }
    if (url.pathname === '/info') {
      if (!this.room) return Response.json({ exists: false }, { status: 404 });
      return Response.json({ exists: true, ...this.room.summary() });
    }
    if (url.pathname === '/ws') {
      if (!this.room) return new Response('no such table', { status: 404 });
      if (this.sockets.size >= 24) return new Response('too many connections', { status: 429 });
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      const cid = crypto.randomUUID();
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ cid, pid: null } satisfies Attachment);
      this.sockets.set(cid, server);
      this.room.open(cid);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('not found', { status: 404 });
  }

  private cidOf(ws: WebSocket): string | null {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (a && !this.sockets.has(a.cid)) { this.sockets.set(a.cid, ws); this.room?.restoreConnection(a.cid, a.pid); }
    return a?.cid ?? null;
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const cid = this.cidOf(ws);
    if (!cid || !this.room || typeof message !== 'string') return;
    this.room.message(cid, message);
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    const cid = this.cidOf(ws);
    if (!cid) return;
    this.sockets.delete(cid);
    this.room?.close(cid);
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch { /* already closed */ }
    if (this.sockets.size === 0) {
      // last one out: save now and schedule the idle cleanup
      this.flush();
      this.armAlarm(Date.now() + IDLE_DELETE_MS);
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws, 1011);
  }

  override async alarm(): Promise<void> {
    this.alarmAt = null;
    if (!this.room) return;
    if (this.sockets.size === 0 && Date.now() - this.room.data.lastActive >= IDLE_DELETE_MS - 60_000) {
      this.room = null;
      await this.ctx.storage.deleteAll();
      return;
    }
    this.room.tick();
    if (this.sockets.size === 0) this.armAlarm(this.room.data.lastActive + IDLE_DELETE_MS);
  }
}
