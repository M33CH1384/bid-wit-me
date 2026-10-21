/**
 * Worker entry + Table Durable Object.
 *
 * Routes
 *   POST /api/tables              → create a table, returns { code }
 *   GET  /api/tables/:code        → public summary (exists? mode, seats) for the join screen
 *   GET  /api/tables/:code/ws     → WebSocket into that table's Durable Object
 *   GET  /api/ice                 → ICE servers for WebRTC (public STUN; TURN when configured)
 *   POST /api/feedback            → player feedback (+ up to 3 screenshots), see feedback.ts
 *   GET  /api/feedback/admin      → private listing (sign-in form → HttpOnly admin cookie; never a token in the URL)
 *   /api/auth/*                   → accounts + sign-in (D1), see auth/routes.ts; served same-origin via the Pages proxy
 *   POST /api/stats/local         → signed-in offline game (rebuilt server-side, unrated)
 *   GET  /health
 *
 * Free-plan notes (spec §13):
 *   - SQLite-backed DO (new_sqlite_classes), WebSocket Hibernation API, ping/pong auto-response (no wake-ups).
 *   - The whole room is ONE KV row. Saves are debounced (≤1 write per ~2 s burst of activity, forced at 10 s),
 *     so a full 4-human game costs a few hundred row writes, a 1-human + 3-bot game far fewer.
 *   - Human turn timers and bot moves share one storage alarm (re-armed only when nothing earlier is pending).
 *     The in-memory wake is only the fast path: hibernation drops it, and ping/pong does not wake the object.
 *   - A table with nobody connected freezes (no bots, no timers) and is deleted after 24 h idle.
 */
import { DurableObject } from 'cloudflare:workers';
import { CODE_ALPHABET, CODE_LENGTH, GUEST_SESSION, type ServerMsg, isRoomCode, normalizeRoomCode } from '@spades/protocol';
import { Room, type RoomData, ROOM_DATA_VERSION, newRoomData } from './room';
import { dispatchTableMessage } from './dispatch';
import { FEEDBACK_LIMITS, type FeedbackRow, adminHtml, hashIp, notifyOwner, parseFeedback, rateOk, tokenOk } from './feedback';
import { ADMIN_COOKIE, ADMIN_TTL_MS, adminCookieOk, adminLoginHtml, makeAdminCookie, readCookie } from './admin';
import { type Bucket, LIMITS, type LimitEnv, hit, limited } from './limits';
import { type AuthEnv, handleAuth } from './auth/routes';
import { handleLocalStats } from './stats/local';
import { type SocialEnv, handleSocialHttp, isAdmin } from './social/routes';
import { type CredEnv, handleCredHttp } from './cred/routes';
import { pjsVenueAccess } from './cred/venueAccess';
import { verifyTicket } from './social/ticket';
import { type ConnAtt, type GlobalLog, Hub, type TableLog } from './social/hub';
import { saveRecord } from './stats/record';
import { recordHighlight, wireText } from './stats/highlights';
import { backfillHomiesOnce } from './stats/backfill';
import { handleTournaments } from './tournament/routes';
import type { TOp } from './tournament/do';
import { handleWagerChallenges } from './wager/routes';
import { handleStoryHttp } from './story/routes';
import { runStoryCallbacks } from './story/callback';
import type { WOp } from './wager/do';
import { type PushEnv, handlePushHttp } from './push/routes';
import { notifyFriendsOfOnline, notifyInvite, notifyTurn, pushVapid, runScheduledPushes, sendCredPushEvent } from './push/notify';
import type { TableRules } from '@spades/rules';
export { TournamentDO } from './tournament/do';
import type { TournamentDO } from './tournament/do';
export { ChallengeDO } from './wager/do';
import type { ChallengeDO } from './wager/do';
import type { ChatReactions, OpenTable, ReplyRef, SocialChatLine, SocialServerMsg } from '@spades/protocol';

import { D1QueueStore, WriterBreaker, writeVoiceLine, type WorkersAiLike, type WriterRequest } from './voice/writer';
export interface Env extends LimitEnv, AuthEnv, SocialEnv {
  /** Voice (c) Workers AI binding ([ai] in wrangler.toml); absent in local tests without AI. */
  AI?: WorkersAiLike;
  TABLES: DurableObjectNamespace<TableDO>;
  SOCIAL: DurableObjectNamespace<SocialDO>;
  TOURNAMENTS: DurableObjectNamespace<TournamentDO>;
  CHALLENGES: DurableObjectNamespace<ChallengeDO>;
  ALLOWED_ORIGINS?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  FEEDBACK: DurableObjectNamespace<FeedbackDO>;
  FEEDBACK_ADMIN_TOKEN?: string;
  FEEDBACK_EMAIL_TO?: string;
  FEEDBACK_EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  /** local test runs only (`wrangler dev --var TEST_HOOKS:1`): lets e2e scripts load a game position. Never set in production. */
  TEST_HOOKS?: string;
  /** Web Push (Release 13): `npx wrangler secret put VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT` */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

const voiceBreaker = new WriterBreaker();
const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const SAVE_DEBOUNCE_MS = 2000;
const SAVE_MAX_DELAY_MS = 10_000;
const IDLE_DELETE_MS = 24 * 3600_000;
/** tournament e2e on local wrangler (TEST_HOOKS=1 + fast) only */
const FAST_TIMING = { botMs: 40, trickPauseMs: 60, dealMs: 80, disconnectGraceMs: 3000, handOverMs: 1200, handEndHoldMs: 0 };

/* ------------------------------------------------------------------ worker */

function allowedOrigin(req: Request, env: Env): string | null {
  const origin = req.headers.get('Origin');
  if (!origin) return null;
  // the Worker's own pages (feedback admin sign-in form)
  if (origin === new URL(req.url).origin) return origin;
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

async function feedbackRoute(req: Request, env: Env, parts: string[], url: URL, origin: string | null): Promise<Response> {
  const stub = env.FEEDBACK.get(env.FEEDBACK.idFromName('all'));
  if (parts.length === 2 && req.method === 'POST') {
    const len = Number(req.headers.get('content-length') ?? '0');
    if (len > FEEDBACK_LIMITS.bodyBytesMax) return json({ error: 'too big' }, { status: 413 }, origin);
    const text = await req.text();
    if (text.length > FEEDBACK_LIMITS.bodyBytesMax) return json({ error: 'too big' }, { status: 413 }, origin);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return json({ error: 'bad json' }, { status: 400 }, origin); }
    const p = parseFeedback(body);
    if (!p.ok) return json({ error: p.error }, { status: 400 }, origin);
    if (p.spam) return json({ ok: true, id: 0 }, { status: 201 }, origin); // honeypot: pretend it worked
    const ip = await hashIp(req.headers.get('CF-Connecting-IP') ?? 'unknown');
    const r = await stub.fetch('https://feedback/add', { method: 'POST', headers: { 'x-ip': ip, 'x-base': url.origin }, body: text });
    const out = (await r.json()) as { id?: number; error?: string };
    return json(out.id ? { ok: true, id: out.id } : out, { status: r.status }, origin);
  }
  // admin: a sign-in form sets a short-lived HttpOnly cookie; scripts may send Authorization: Bearer. No token in URLs.
  const page = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' };
  if (!env.FEEDBACK_ADMIN_TOKEN) return new Response('not found', { status: 404 });
  if (parts[2] === 'admin' && req.method === 'POST') {
    const form = await req.formData().catch(() => null);
    const given = form?.get('token');
    if (!tokenOk(typeof given === 'string' ? given : null, env.FEEDBACK_ADMIN_TOKEN)) return new Response(adminLoginHtml('Wrong token.'), { status: 401, headers: page });
    const cookie = `${ADMIN_COOKIE}=${await makeAdminCookie(env.FEEDBACK_ADMIN_TOKEN, Date.now())}; Path=/api/feedback; Max-Age=${ADMIN_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Strict`;
    return new Response(null, { status: 303, headers: { location: '/api/feedback/admin', 'set-cookie': cookie, 'cache-control': 'no-store' } });
  }
  if (req.method !== 'GET') return new Response('not found', { status: 404 });
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  const authed = tokenOk(bearer, env.FEEDBACK_ADMIN_TOKEN) || await adminCookieOk(readCookie(req, ADMIN_COOKIE), env.FEEDBACK_ADMIN_TOKEN, Date.now());
  if (!authed) {
    if (parts[2] === 'admin') return new Response(adminLoginHtml(url.searchParams.has('token') ? 'Tokens in links are no longer accepted: paste it here instead.' : ''), { status: 401, headers: page });
    return new Response('not found', { status: 404 });
  }
  if (parts[2] === 'shot' && parts[3]) return stub.fetch(`https://feedback/shot/${encodeURIComponent(parts[3])}`);
  if (parts[2] === 'list' || parts[2] === 'admin') {
    const rows = (await (await stub.fetch('https://feedback/list')).json()) as FeedbackRow[];
    if (parts[2] === 'list') return json(rows);
    return new Response(adminHtml(rows, url.origin), { headers: page });
  }
  return new Response('not found', { status: 404 });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // rides the deploy: one attempt per isolate, retried until the offline-games columns exist
    if (env.DB) ctx.waitUntil(backfillHomiesOnce(env.DB));
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

    if (parts[1] === 'feedback') return feedbackRoute(req, env, parts, url, origin);

    if (parts[1] === 'auth') {
      // sign-in ceremonies + username checks are rate limited; reading /me and /config isn't
      // username checks run as you type, so they share the roomier lookup bucket
      const bucket = ['me', 'config', 'deletion-status'].includes(parts[2] ?? '') ? null : parts[2] === 'username' && parts[3] === 'check' ? 'info' : 'auth';
      if (bucket) { const slow = await limited(req, env, bucket); if (slow) return slow; }
      return handleAuth(req, env, url, parts, { fetch: (i, init) => fetch(i, init), now: () => Date.now() });
    }

    if (parts[1] === 'stats' && parts[2] === 'local' && req.method === 'POST') {
      const slow = await limited(req, env, 'stats', origin);
      if (slow) return slow;
      return handleLocalStats(req, env, url, Date.now());
    }

    if (parts[1] === 'social') {
      if (parts[2] === 'ws') {
        if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, { status: 426 }, origin);
        const slow = await limited(req, env, 'join', origin);
        if (slow) return slow;
        const t = await verifyTicket(env.DB, url.searchParams.get('ticket'), Date.now());
        const h = new Headers(req.headers);
        h.delete('x-uid'); h.delete('x-name'); h.delete('x-admin'); h.delete('x-gid');
        if (t) { h.set('x-uid', t.uid); h.set('x-name', t.name); if (isAdmin(env, t.uid, t.name)) h.set('x-admin', '1'); }
        else {
          h.set('x-name', (url.searchParams.get('name') ?? 'Guest').slice(0, 40));
          const gid = url.searchParams.get('gid') ?? '';
          if (GUEST_SESSION.test(gid)) h.set('x-gid', gid);
        }
        const stub = env.SOCIAL.get(env.SOCIAL.idFromName('hub'));
        return stub.fetch(new Request('https://social/ws', { headers: h }));
      }
      const slow = await limited(req, env, 'info');
      if (slow) return slow;
      if (parts[2] === 'tables' && parts.length === 3 && req.method === 'GET') {
        // Release 10: the Open tables list over plain HTTP (the hub also pushes it live over its socket)
        const r = await env.SOCIAL.get(env.SOCIAL.idFromName('hub')).fetch('https://social/tables');
        return json(await r.json(), {}, origin);
      }
      return handleSocialHttp(req as Request & { cf?: unknown }, env, url, parts, Date.now());
    }

    if (parts[1] === 'story') {
      const slow = await limited(req, env, 'info', origin);
      if (slow) return slow;
      return handleStoryHttp(req, env as CredEnv, url, parts, Date.now());
    }

    if (parts[1] === 'profile' || parts[1] === 'challenges' || parts[1] === 'coins') {
      const slow = await limited(req, env, 'info', origin);
      if (slow) return slow;
      return handleCredHttp(req, env as CredEnv, url, parts, Date.now());
    }

    if (parts[1] === 'push') {
      const slow = await limited(req, env, 'info', origin);
      if (slow) return slow;
      return handlePushHttp(req, env as PushEnv, url, parts, Date.now());
    }

    if (parts[1] === 'tournaments') {
      const slow = await limited(req, env, req.method === 'POST' && !parts[2] ? 'create' : 'info');
      if (slow) return slow;
      return handleTournaments(req, env, url, parts, Date.now(), (id, op: TOp) =>
        env.TOURNAMENTS.get(env.TOURNAMENTS.idFromName(id)).fetch('https://tournament/op', { method: 'POST', body: JSON.stringify(op) }));
    }

    if (parts[1] === 'wager-challenges') {
      const slow = await limited(req, env, req.method === 'POST' && !parts[2] ? 'create' : 'info');
      if (slow) return slow;
      return handleWagerChallenges(req, env, url, parts, Date.now(), (id, op: WOp) =>
        env.CHALLENGES.get(env.CHALLENGES.idFromName(id)).fetch('https://challenge/op', { method: 'POST', body: JSON.stringify(op) }));
    }

    if (parts[1] === 'tables' && parts.length === 2 && req.method === 'POST') {
      const slow = await limited(req, env, 'create', origin);
      if (slow) return slow;
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
        const slow = await limited(req, env, 'join', origin);
        if (slow) return slow;
        return stub.fetch(new Request(`https://table/ws?code=${code}`, req));
      }
      if (parts[3] === 'test-state' && req.method === 'POST') {
        if (env.TEST_HOOKS !== '1') return json({ error: 'not found' }, { status: 404 }, origin);
        const r = await stub.fetch(new Request(`https://table/test-state?code=${code}`, { method: 'POST', body: await req.text() }));
        return json({ ok: r.ok }, { status: r.status }, origin);
      }
      if (parts[3] === 'handlog' && req.method === 'GET') {
        // Hand-history log for testing (Demetrius 2026-10-19): the ground truth of the current
        // game — deals, actions, tricks, run-claim detail. Admins and seated account holders only;
        // the table's Durable Object makes the final call on the requester's identity.
        const slow = await limited(req, env, 'info', origin);
        if (slow) return slow;
        const t = await verifyTicket(env.DB, url.searchParams.get('ticket'), Date.now());
        if (!t) return json({ error: 'ticket required' }, { status: 401 }, origin);
        const h = new Headers();
        h.set('x-uid', t.uid);
        if (isAdmin(env, t.uid, t.name)) h.set('x-admin', '1');
        const r = await stub.fetch(new Request(`https://table/handlog?code=${code}`, { headers: h }));
        const body = await r.json().catch(() => ({ error: 'unavailable' }));
        return json(body, { status: r.status }, origin);
      }
      if (parts.length === 3 && req.method === 'GET') {
        const slow = await limited(req, env, 'info', origin);
        if (slow) return slow;
        const r = await stub.fetch(`https://table/info?code=${code}`);
        return json(await r.json(), { status: r.status }, origin);
      }
    }
    return json({ error: 'not found' }, { status: 404 }, origin);
  },

  /** Cron (see [triggers] in wrangler.toml): daily-bonus + season-ending pushes,
   *  plus story call-backs (open story tables summoning their players back). */
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (!env.DB) return;
    const vapid = pushVapid(env);
    if (!vapid) return; // VAPID secrets not configured yet — nothing to send
    try {
      const now = Date.now();
      const r = await runScheduledPushes(env.DB, vapid, now);
      const story = await runStoryCallbacks(env.DB, vapid, now).catch((e) => {
        console.error(JSON.stringify({ src: 'bwm.push', event: 'story-callback-failed', error: String(e).slice(0, 160) }));
        return { first: 0, last: 0 };
      });
      console.log(JSON.stringify({ src: 'bwm.push', event: 'scheduled', ...r, storyCallbacks: story }));
    } catch (e) {
      console.error(JSON.stringify({ src: 'bwm.push', event: 'scheduled-failed', error: String(e).slice(0, 160) }));
    }
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
      close: (cid, code, reason) => {
        const ws = this.sockets.get(cid);
        this.sockets.delete(cid);
        // Drop the player id before close. Otherwise webSocketClose restores this dying
        // socket as the player and the room treats the reconnect as a disconnect.
        try { ws?.serializeAttachment({ cid, pid: null } satisfies Attachment); } catch { /* gone */ }
        try { ws?.close(code, reason); } catch { /* gone */ }
      },
      wake: (ms) => this.wake(ms),
      setAlarm: (at) => this.armAlarm(at),
      persist: () => this.scheduleSave(),
      randomId: () => crypto.randomUUID().replace(/-/g, ''),
      gameOver: (rec, rated, meta) => {
        if (!this.env.DB) return;
        const db = this.env.DB;
        this.ctx.waitUntil((async () => {
          const events = await saveRecord(db, rec, rated, meta).catch((e) => { console.error('saveRecord', e); return []; });
          if (!events.length) return;
          const vapid = pushVapid(this.env);
          if (!vapid) return; // VAPID secrets not configured yet
          const now = Date.now();
          for (const ev of events) await sendCredPushEvent(db, vapid, ev, now);
        })());
      },
      // Live highlights (league data wave 6b): store for the ticker in
      // waitUntil — never on the game path. Marquee events (item 7) ALSO go
      // to global chat as a League Wire line via the Social hub, which
      // dedupes by event id and caps the cadence.
      highlight: (ev) => {
        if (this.env.DB) {
          const db = this.env.DB;
          this.ctx.waitUntil(recordHighlight(db, ev).catch((e) => console.error('highlight', e)));
        }
        if (ev.marquee && this.env.SOCIAL) {
          const stub = this.env.SOCIAL.get(this.env.SOCIAL.idFromName('hub'));
          this.ctx.waitUntil(stub.fetch('https://social/wire', { method: 'POST', body: JSON.stringify({ id: ev.id, text: wireText(ev) }) }).then(() => undefined).catch((e) => console.error('wire', e)));
        }
      },
      // Voice (c): a thin catalog bucket -> one writer call in waitUntil (never on the game path).
      voiceMiss: (req: WriterRequest) => { if (this.env.AI && this.env.DB) this.ctx.waitUntil(writeVoiceLine({ ai: this.env.AI, store: new D1QueueStore(this.env.DB), breaker: voiceBreaker }, req).then(() => undefined).catch((e) => console.error('voiceWriter', e))); },
      // Push: a fresh turn for an away player. waitUntil — never on the game path.
      turnBegan: (seat, kind) => {
        const room = this.room;
        if (!room || !this.env.DB) return;
        const slot = room.data.seats[seat];
        if (slot?.kind !== 'human') return;
        const pid = slot.playerId;
        if (room.isConnected(pid)) return; // live socket — they're watching
        const uid = room.data.members[pid]?.uid;
        if (!uid) return;
        const vapid = pushVapid(this.env);
        if (!vapid) return; // VAPID secrets not configured yet
        const db = this.env.DB;
        this.ctx.waitUntil(notifyTurn(db, vapid, uid, room.data.code, kind, Date.now()).catch((e) => console.error('turnPush', e)));
      },
      listing: (t) => this.reportListing(t),
      tournamentResult: (t, scores, places) => {
        const stub = this.env.TOURNAMENTS.get(this.env.TOURNAMENTS.idFromName(t.id));
        const op: TOp = { op: 'result', match: t.match, scores, places };
        this.ctx.waitUntil(stub.fetch('https://tournament/op', { method: 'POST', body: JSON.stringify(op) }).then(() => undefined).catch((e) => console.error('tournamentResult', e)));
      },
      challengeResult: (c, r) => {
        const stub = this.env.CHALLENGES.get(this.env.CHALLENGES.idFromName(c.id));
        const op: WOp = { op: 'result', result: r };
        this.ctx.waitUntil(stub.fetch('https://challenge/op', { method: 'POST', body: JSON.stringify(op) }).then(() => undefined).catch((e) => console.error('challengeResult', e)));
      },
    }, data.tournament?.fast && this.env.TEST_HOOKS === '1' ? FAST_TIMING : undefined);
  }

  /** Release 10: Open tables. Only changes are sent (ignoring the timestamp), at most one report per 1.5 s per table. */
  private lastListing: string | null = null;
  private pendingListing: { t: OpenTable | null } | null = null;
  private listingTimer: ReturnType<typeof setTimeout> | null = null;
  private lastListingAt = 0;
  private reportListing(t: OpenTable | null): void {
    const key = t ? JSON.stringify({ ...t, at: 0 }) : 'null';
    if (key === this.lastListing && !this.pendingListing) return;
    this.pendingListing = { t };
    const flush = () => {
      this.listingTimer = null;
      const p = this.pendingListing;
      this.pendingListing = null;
      if (!p) return;
      const k = p.t ? JSON.stringify({ ...p.t, at: 0 }) : 'null';
      if (k === this.lastListing) return;
      this.lastListing = k;
      this.lastListingAt = Date.now();
      const code = this.room?.data.code;
      if (!code || !this.env.SOCIAL) return;
      const stub = this.env.SOCIAL.get(this.env.SOCIAL.idFromName('hub'));
      this.ctx.waitUntil(stub.fetch('https://social/table', { method: 'POST', body: JSON.stringify({ code, table: p.t }) }).then(() => undefined).catch((e) => console.error('listing', e)));
    };
    if (this.listingTimer) return;
    const wait = Math.max(0, this.lastListingAt + 1500 - Date.now());
    if (wait === 0) flush();
    else this.listingTimer = setTimeout(flush, wait);
  }

  private send(cid: string, msg: ServerMsg): void {
    const ws = this.sockets.get(cid);
    if (!ws) return;
    try { ws.send(JSON.stringify(msg)); } catch { /* closing */ }
    // keep the player id on the socket so it survives hibernation
    if (msg.t === 'welcome') ws.serializeAttachment({ cid, pid: msg.you } satisfies Attachment);
  }

  /**
   * Fast path for a bot move while this isolate stays up. Hibernation drops the timer and a
   * WebSocket ping does not wake the object, so the room also arms a storage alarm.
   */
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
    // keep the isolate alive until the alarm is stored; a floating promise is dropped on hibernation
    this.ctx.waitUntil(this.ctx.storage.setAlarm(at));
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
    if (url.pathname === '/tournament-setup' && req.method === 'POST') {
      // internal only (TournamentDO → table); not routed from the public Worker
      if (this.room) return new Response('exists', { status: 409 });
      const b = await req.json() as { tid: string; name: string; match: string; rules: TableRules; reserved: ({ uid: string; name: string } | null)[]; autostartAt: number; bots: boolean; fast?: boolean };
      const data = newRoomData(code, Date.now());
      data.tournament = { id: b.tid, match: b.match, name: b.name, reserved: b.reserved, autostartAt: b.autostartAt, bots: b.bots, ...(b.fast ? { fast: true } : {}) };
      this.attach(data);
      this.room!.setupTournament(data.tournament, b.rules);
      this.flush();
      return new Response('created', { status: 201 });
    }
    if (url.pathname === '/challenge-setup' && req.method === 'POST') {
      // internal only (ChallengeDO → table); not routed from the public Worker
      if (this.room) return new Response('exists', { status: 409 });
      const b = await req.json() as { cid: string; rules: TableRules; reserved: ({ uid: string; name: string } | null)[]; autostartAt: number; teamNames?: [string | null, string | null] };
      const data = newRoomData(code, Date.now());
      data.challenge = { id: b.cid, reserved: b.reserved, autostartAt: b.autostartAt, ...(b.teamNames ? { teamNames: b.teamNames } : {}) };
      this.attach(data);
      this.room!.setupChallenge(data.challenge, b.rules);
      this.flush();
      return new Response('created', { status: 201 });
    }
    if (url.pathname === '/test-state' && req.method === 'POST') {
      // only reachable through the TEST_HOOKS-gated route above
      if (this.env.TEST_HOOKS !== '1' || !this.room) return new Response('not found', { status: 404 });
      this.room.testLoadGame(await req.json());
      return new Response('ok');
    }
    if (url.pathname === '/info') {
      if (!this.room) return Response.json({ exists: false }, { status: 404 });
      return Response.json({ exists: true, ...this.room.summary() });
    }
    if (url.pathname === '/handlog') {
      // Hand-history log for testing (Demetrius 2026-10-19): ground truth of the current game.
      // The outer Worker forwards the verified ticket as x-uid and marks x-admin for admins.
      if (!this.room) return Response.json({ error: 'no such table' }, { status: 404 });
      if (req.headers.get('x-admin') !== '1') {
        const uid = req.headers.get('x-uid');
        const d = this.room.data;
        const participant = !!uid && Object.values(d.members).some((m) => m.uid === uid);
        if (!participant) return Response.json({ error: 'not found' }, { status: 404 });
      }
      const log = this.room.handLogJson();
      if (!log) return Response.json({ error: 'no game yet' }, { status: 404 });
      return Response.json(log, { headers: { 'cache-control': 'no-store' } });
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
    await dispatchTableMessage(this.room, cid, message, async (ticket) => {
      const t = await verifyTicket(this.env.DB, ticket, Date.now());
      if (!t) return null;
      // The Pj's gate: entitlement is computed here, where D1 lives, and stamped on the
      // member by dispatch — the room itself stays synchronous and storage-free.
      return { uid: t.uid, venueAccess: await pjsVenueAccess(this.env, this.env.DB, t.uid, t.name) };
    });
  }

  override async webSocketClose(ws: WebSocket, code: number, reason = '', wasClean = false): Promise<void> {
    const cid = this.cidOf(ws);
    if (!cid) return;
    this.sockets.delete(cid);
    this.room?.noteSocketClose(cid, code, reason, wasClean);
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
      this.room.expire();
      this.room = null;
      await this.ctx.storage.deleteAll();
      return;
    }
    this.room.tick();
    if (this.sockets.size === 0) this.armAlarm(this.room.data.lastActive + IDLE_DELETE_MS);
  }
}

/* ------------------------------------------------------- feedback store */

/** One instance ("all") holds every feedback message + screenshot blobs + the per-IP rate window, in SQLite. */
export class FeedbackDO extends DurableObject<Env> {
  private sql: SqlStorage;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER, type TEXT, message TEXT, name TEXT, email TEXT, context TEXT, ip TEXT);
      CREATE TABLE IF NOT EXISTS shots (id INTEGER PRIMARY KEY AUTOINCREMENT, fb INTEGER, mime TEXT, data BLOB);
      CREATE TABLE IF NOT EXISTS sends (ip TEXT, at INTEGER);
      CREATE INDEX IF NOT EXISTS sends_ip ON sends (ip, at);`);
  }

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const now = Date.now();
    if (url.pathname === '/add' && req.method === 'POST') {
      const ip = req.headers.get('x-ip') ?? 'unknown';
      this.sql.exec('DELETE FROM sends WHERE at < ?', now - 3600_000);
      const times = this.sql.exec<{ at: number }>('SELECT at FROM sends WHERE ip = ?', ip).toArray().map((r) => r.at);
      if (!rateOk(times, now)) return Response.json({ error: 'Too many messages from here: try again in an hour.' }, { status: 429 });
      const p = parseFeedback(await req.json());
      if (!p.ok) return Response.json({ error: p.error }, { status: 400 });
      const f = p.value;
      const id = this.sql.exec<{ id: number }>('INSERT INTO feedback (created, type, message, name, email, context, ip) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
        now, f.type, f.message, f.name, f.email, JSON.stringify(f.context), ip).one().id;
      for (const s of f.shots) this.sql.exec('INSERT INTO shots (fb, mime, data) VALUES (?, ?, ?)', id, s.mime, s.bytes.buffer.slice(s.bytes.byteOffset, s.bytes.byteOffset + s.bytes.byteLength) as ArrayBuffer);
      this.sql.exec('INSERT INTO sends (ip, at) VALUES (?, ?)', ip, now);
      this.ctx.waitUntil(notifyOwner(this.env, f, id, `${req.headers.get('x-base') ?? ''}/api/feedback/admin`).then(() => undefined));
      return Response.json({ id }, { status: 201 });
    }
    if (url.pathname === '/list') {
      const rows = this.sql.exec<{ id: number; created: number; type: string; message: string; name: string; email: string; context: string }>(
        'SELECT id, created, type, message, name, email, context FROM feedback ORDER BY id DESC LIMIT 200').toArray();
      const shots = this.sql.exec<{ id: number; fb: number }>('SELECT id, fb FROM shots WHERE fb >= ?', rows.length ? rows[rows.length - 1]!.id : 0).toArray();
      return Response.json(rows.map((r) => ({ ...r, shots: shots.filter((s) => s.fb === r.id).map((s) => s.id) })));
    }
    const m = /^\/shot\/(\d+)$/.exec(url.pathname);
    if (m) {
      const row = this.sql.exec<{ mime: string; data: ArrayBuffer }>('SELECT mime, data FROM shots WHERE id = ?', Number(m[1])).toArray()[0];
      if (!row) return new Response('not found', { status: 404 });
      return new Response(row.data, { headers: { 'content-type': row.mime, 'cache-control': 'private, max-age=86400' } });
    }
    return new Response('not found', { status: 404 });
  }
}

/* ------------------------------------------------------- rate limiter */

/** One per hashed IP (see limits.ts): in-memory sliding windows only, no storage writes. */
export class RateLimitDO extends DurableObject<Env> {
  private windows = new Map<string, number[]>();
  override async fetch(req: Request): Promise<Response> {
    const b = new URL(req.url).searchParams.get('b') as Bucket | null;
    const l = b && LIMITS[b];
    if (!l) return new Response('bad bucket', { status: 400 });
    const r = hit(this.windows.get(b) ?? [], Date.now(), l);
    this.windows.set(b, r.times);
    return r.ok ? new Response('ok') : new Response(String(Math.ceil(r.retryAfterMs / 1000)), { status: 429 });
  }
}


/* ------------------------------------------------------- social hub */

/** One instance ("hub"): presence + invites in memory (rebuilt from socket attachments), global chat in SQLite. */
export class SocialDO extends DurableObject<Env> {
  private hub: Hub;
  private sockets = new Map<string, WebSocket>();
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS global (id INTEGER PRIMARY KEY AUTOINCREMENT, from_id TEXT, name TEXT, text TEXT, at INTEGER, admin INTEGER DEFAULT 0)`);
    try { this.sql.exec(`ALTER TABLE global ADD COLUMN reactions TEXT`); } catch { /* column already there */ }
    try { this.sql.exec(`ALTER TABLE global ADD COLUMN reply TEXT`); } catch { /* column already there */ }
    try { this.sql.exec(`ALTER TABLE global ADD COLUMN wire INTEGER DEFAULT 0`); } catch { /* column already there */ }
    this.sql.exec(`CREATE TABLE IF NOT EXISTS open_tables (code TEXT PRIMARY KEY, json TEXT, at INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ended_tables (code TEXT PRIMARY KEY)`);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    const sql = this.sql;
    const tables: TableLog = {
      put: (t) => { sql.exec('INSERT OR REPLACE INTO open_tables (code, json, at) VALUES (?, ?, ?)', t.code, JSON.stringify(t), t.at); },
      del: (code) => { sql.exec('DELETE FROM open_tables WHERE code = ?', code); },
      list: () => sql.exec<{ json: string }>('SELECT json FROM open_tables').toArray().map((r) => JSON.parse(r.json) as OpenTable),
    };
    const ended = {
      add: (code: string) => { sql.exec('INSERT OR REPLACE INTO ended_tables (code) VALUES (?)', code); },
      del: (code: string) => { sql.exec('DELETE FROM ended_tables WHERE code = ?', code); },
      list: () => sql.exec<{ code: string }>('SELECT code FROM ended_tables').toArray().map((r) => r.code),
    };
    type GlobalRow = { id: number; from_id: string; name: string; text: string; at: number; admin: number; reactions: string | null; reply: string | null; wire: number | null };
    const rowToLine = (r: GlobalRow): SocialChatLine => ({
      id: r.id, from: r.from_id, name: r.name, text: r.text, at: r.at,
      ...(r.admin ? { admin: true as const } : {}),
      ...(r.reactions ? { reactions: JSON.parse(r.reactions) as ChatReactions } : {}),
      ...(r.reply ? { reply: JSON.parse(r.reply) as ReplyRef } : {}),
      ...(r.wire ? { wire: true as const } : {}),
    });
    const global: GlobalLog = {
      add: (l) => {
        const id = sql.exec<{ id: number }>('INSERT INTO global (from_id, name, text, at, admin, reply, wire) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id', l.from, l.name, l.text, l.at, l.admin ? 1 : 0, l.reply ? JSON.stringify(l.reply) : null, l.wire ? 1 : 0).one().id;
        sql.exec('DELETE FROM global WHERE id <= ?', id - 200);
        return { id, ...l };
      },
      list: (n) => sql.exec<GlobalRow>('SELECT * FROM global ORDER BY id DESC LIMIT ?', n).toArray().reverse().map(rowToLine),
      get: (id) => { const r = sql.exec<GlobalRow>('SELECT * FROM global WHERE id = ?', id).toArray()[0]; return r ? rowToLine(r) : null; },
      setReactions: (id, reactions) => sql.exec('UPDATE global SET reactions = ? WHERE id = ?', Object.keys(reactions).length ? JSON.stringify(reactions) : null, id).rowsWritten > 0,
      del: (id) => sql.exec('DELETE FROM global WHERE id = ?', id).rowsWritten > 0,
    };
    this.hub = new Hub({
      now: () => Date.now(),
      send: (cid, msg: SocialServerMsg) => { const ws = this.sockets.get(cid); if (ws) try { ws.send(JSON.stringify(msg)); } catch { /* closing */ } },
      save: (cid, att) => { try { this.sockets.get(cid)?.serializeAttachment({ cid, att }); } catch { /* closed */ } },
      global,
      tables,
      ended,
      connected: (cid) => this.sockets.get(cid)?.readyState === WebSocket.OPEN,
      drop: (cid) => {
        const ws = this.sockets.get(cid);
        this.sockets.delete(cid);
        try { ws?.close(1000, 'presence'); } catch { /* already closed */ }
      },
      tablePhase: async (code) => {
        if (!/^[A-Z0-9]{3,12}$/.test(code)) return null;
        try {
          const stub = env.TABLES.get(env.TABLES.idFromName(code));
          const r = await stub.fetch(`https://table/info?code=${code}`);
          if (r.status === 404) return 'gone';
          const j = await r.json() as { exists?: boolean; phase?: string };
          if (j.exists === false) return 'gone';
          if (j.phase === 'over') return 'over';
          if (j.phase === 'lobby' || j.phase === 'playing') return 'live';
          return null;
        } catch {
          return null;
        }
      },
      later: (ms, f) => { setTimeout(f, ms); },
      randomId: () => crypto.randomUUID().replace(/-/g, ''),
      // Release 13 push hooks — waitUntil, never on the socket path.
      onOnline: (uid, name) => {
        const db = env.DB; const vapid = pushVapid(env);
        if (!db || !vapid) return;
        this.ctx.waitUntil(notifyFriendsOfOnline(db, vapid, uid, name, Date.now())
          .catch((e) => console.error('onlinePush', e)));
      },
      onOfflineInvite: (toUid, fromName, code, mode) => {
        const db = env.DB; const vapid = pushVapid(env);
        if (!db || !vapid) return;
        this.ctx.waitUntil(notifyInvite(db, vapid, toUid, fromName, code, mode, Date.now())
          .catch((e) => console.error('invitePush', e)));
      },
    }, env.DB);
    ctx.blockConcurrencyWhile(async () => {
      for (const ws of ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() as { cid: string; att?: ConnAtt } | null;
        if (!a?.att) continue;
        // A socket that died while the hub slept must not come back as a seated player.
        if (ws.readyState !== WebSocket.OPEN) {
          try { ws.close(1000, 'presence'); } catch { /* already closed */ }
          continue;
        }
        this.sockets.set(a.cid, ws);
        await this.hub.restore(a.cid, a.att);
      }
      // Tombstones and idle sessions only. Looking up other table DOs from the constructor can deadlock.
      await this.hub.prune(false);
    });
    void ctx.storage.setAlarm(Date.now() + 60_000);
  }

  override async alarm(): Promise<void> {
    await this.hub.prune(true);
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
  }

  override async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === '/notify' && req.method === 'POST') {
      const b = await req.json() as { uids: string[]; notice: { text: string; code?: string; seat?: number; tid?: string; cid?: string } };
      return Response.json({ sent: this.hub.notify(b.uids ?? [], b.notice) });
    }
    if (path === '/tables') return Response.json({ tables: this.hub.openTables() });
    if (path === '/table' && req.method === 'POST') {
      const b = await req.json() as { code: string; table: OpenTable | null };
      if (typeof b.code === 'string' && /^[A-Z0-9]{3,12}$/.test(b.code)) this.hub.tableUpdate(b.code, b.table ?? null);
      return Response.json({ ok: true });
    }
    if (path === '/wire' && req.method === 'POST') {
      // League Wire intake (item 7): table / challenge DOs report marquee
      // moments here; the hub dedupes + cadence-caps before broadcasting.
      const b = await req.json() as { id?: unknown; text?: unknown };
      const posted = typeof b.id === 'string' && typeof b.text === 'string' && b.text.length > 0 && b.text.length <= 300
        ? this.hub.postWire(b.id, b.text) : false;
      return Response.json({ ok: true, posted });
    }
    if (path !== '/ws') return new Response('not found', { status: 404 });
    if (this.sockets.size >= 5000) return new Response('busy', { status: 503 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const cid = crypto.randomUUID();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ cid });
    this.sockets.set(cid, server);
    const uid = req.headers.get('x-uid') ?? undefined;
    const gid = req.headers.get('x-gid') ?? undefined;
    await this.hub.open(cid, { uid, name: req.headers.get('x-name') ?? 'Guest', admin: req.headers.get('x-admin') === '1', ...(gid ? { gid } : {}) });
    return new Response(null, { status: 101, webSocket: client });
  }

  private cidOf(ws: WebSocket): string | null {
    const a = ws.deserializeAttachment() as { cid: string; att?: ConnAtt } | null;
    if (!a) return null;
    if (!this.sockets.has(a.cid)) { this.sockets.set(a.cid, ws); if (a.att) void this.hub.restore(a.cid, a.att); }
    return a.cid;
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const cid = this.cidOf(ws);
    if (!cid || typeof message !== 'string' || message.length > 4000) return;
    await this.hub.message(cid, message).catch((e) => console.error('social', e));
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    const cid = this.cidOf(ws);
    if (!cid) return;
    this.sockets.delete(cid);
    this.hub.close(cid);
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch { /* already closed */ }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws, 1011);
  }
}
