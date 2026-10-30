/**
 * Client crash / error telemetry (migration 0035, table client_crashes).
 *
 *   POST /api/crashes        → one report from the web client's beacon
 *                              (apps/web/src/telemetry.ts); { ok: true, id }
 *   GET  /api/crashes/list   → newest 200 rows as JSON; admin only (Bearer
 *                              FEEDBACK_ADMIN_TOKEN or the admin cookie —
 *                              the same trust as the feedback listing)
 *
 * Why this exists: until 2026-10-30 the game collected NO error logs at all.
 * Crashes were diagnosed from the owner's verbal reports ("it kicked me back
 * to the menu") after the fact, and the same defect family shipped three
 * times. Rows land in D1 (not a Durable Object) so they can be queried with
 * plain SQL alongside the rest of the game's data:
 *
 *   SELECT id, datetime(ts/1000,'unixepoch') AS utc, uid, kind, message,
 *          route, build FROM client_crashes ORDER BY id DESC LIMIT 50;
 *
 * Discipline: the endpoint can never take the client down with it — a bad,
 * oversized, or over-rate report is dropped with a quiet 204/400 and no
 * partial write; a missing DB is a 204 on POST. The account id comes from
 * the session cookie (currentUser), never from the request body, and the
 * client IP is stored only as the feedback system's salted hash.
 * Retention: pruneClientCrashes (30 days) rides the Worker's hourly
 * scheduled handler (index.ts).
 */
import { hashIp, tokenOk } from './feedback';
import { ADMIN_COOKIE, adminCookieOk, readCookie } from './admin';
import { currentUser, type AuthEnv } from './auth/routes';

export const CRASH_LIMITS = {
  bodyBytesMax: 16_384,
  messageMax: 500,
  stackMax: 4_000,
  routeMax: 200,
  buildMax: 64,
  uaMax: 300,
  /** context JSON and crumbs JSON, each */
  blobMax: 6_000,
  perIpPerHour: 90,
  retainMs: 30 * 24 * 3600_000,
  listMax: 200,
} as const;

/** The kinds the client reporter emits (apps/web/src/telemetry.ts). */
export const CRASH_KINDS = [
  'error', 'rejection', 'boundary', 'chunk',
  'webgl-lost', 'webgl-restored', 'conn-close',
  'unclean-exit', 'manual',
] as const;
export type CrashKind = (typeof CRASH_KINDS)[number];

export interface CrashIn {
  kind: CrashKind;
  message: string;
  stack: string | null;
  route: string | null;
  build: string | null;
  context: string | null;
  crumbs: string | null;
}

export type ParsedCrash = { ok: true; value: CrashIn } | { ok: false; error: string };

const clip = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;

function blob(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length <= CRASH_LIMITS.blobMax ? s : s.slice(0, CRASH_LIMITS.blobMax);
  } catch { return null; }
}

/** Validates a POST /api/crashes body (already JSON-parsed). Pure — unit-tested. */
export function parseCrash(raw: unknown): ParsedCrash {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'bad body' };
  const b = raw as Record<string, unknown>;
  if (typeof b.kind !== 'string' || !(CRASH_KINDS as readonly string[]).includes(b.kind)) {
    return { ok: false, error: 'bad kind' };
  }
  const message = typeof b.message === 'string' ? b.message.slice(0, CRASH_LIMITS.messageMax) : '';
  // Context must be a JSON object (a valid JSON string of one is tolerated);
  // anything else is dropped rather than stored raw.
  let context: string | null = null;
  if (b.context && typeof b.context === 'object' && !Array.isArray(b.context)) context = blob(b.context);
  else if (typeof b.context === 'string') {
    try { JSON.parse(b.context); context = blob(b.context); } catch { context = null; }
  }
  // Fold the free-form `extra` the client sends (close codes, witness facts)
  // into the context blob so no report field is silently dropped.
  if (b.extra && typeof b.extra === 'object' && !Array.isArray(b.extra) && Object.keys(b.extra).length > 0) {
    try {
      const merged = { ...(context ? (JSON.parse(context) as Record<string, unknown>) : {}), extra: b.extra };
      context = blob(merged);
    } catch { /* keep the original context */ }
  }
  return {
    ok: true,
    value: {
      kind: b.kind as CrashKind,
      message,
      stack: clip(b.stack, CRASH_LIMITS.stackMax),
      route: clip(b.route, CRASH_LIMITS.routeMax),
      build: clip(b.build, CRASH_LIMITS.buildMax),
      context,
      crumbs: Array.isArray(b.crumbs) ? blob(b.crumbs) : null,
    },
  };
}

export interface CrashRow {
  id: number; ts: number; uid: string | null; ip: string | null; kind: string; message: string;
  stack: string | null; route: string | null; build: string | null;
  context: string | null; crumbs: string | null; ua: string | null;
}

/** Insert one report; returns the new row id (the proof a row landed). */
export async function insertCrash(db: D1Database, row: Omit<CrashRow, 'id'>): Promise<number> {
  const r = await db.prepare(
    'INSERT INTO client_crashes (ts, uid, ip, kind, message, stack, route, build, context, crumbs, ua) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
  ).bind(row.ts, row.uid, row.ip, row.kind, row.message, row.stack, row.route, row.build, row.context, row.crumbs, row.ua)
    .first<{ id: number }>();
  return r?.id ?? 0;
}

/** Rows this (hashed) IP already filed inside the rate window. */
export async function recentCrashCount(db: D1Database, ipHash: string, now: number): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM client_crashes WHERE ip = ? AND ts > ?')
    .bind(ipHash, now - 3600_000).first<{ n: number }>();
  return r?.n ?? 0;
}

/** 30-day retention; called from the scheduled handler. Returns rows deleted. */
export async function pruneClientCrashes(db: D1Database, now: number): Promise<number> {
  const r = await db.prepare('DELETE FROM client_crashes WHERE ts < ?')
    .bind(now - CRASH_LIMITS.retainMs).run();
  return r.meta?.changes ?? 0;
}

export interface CrashEnv extends AuthEnv {
  FEEDBACK_ADMIN_TOKEN?: string;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  const h = new Headers(init.headers);
  h.set('content-type', 'application/json');
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { ...init, headers: h });
}

async function isCrashAdmin(req: Request, env: CrashEnv, now: number): Promise<boolean> {
  const auth = req.headers.get('Authorization') ?? '';
  if (auth.startsWith('Bearer ') && tokenOk(auth.slice(7), env.FEEDBACK_ADMIN_TOKEN)) return true;
  return adminCookieOk(readCookie(req, ADMIN_COOKIE), env.FEEDBACK_ADMIN_TOKEN, now);
}

/** POST /api/crashes + GET /api/crashes/list. Routed from index.ts. */
export async function handleCrashes(req: Request, env: CrashEnv, url: URL, parts: string[], now: number): Promise<Response> {
  if (parts[2] === 'list' && req.method === 'GET') {
    if (!env.DB) return json({ error: 'telemetry not set up' }, { status: 503 });
    if (!(await isCrashAdmin(req, env, now))) return json({ error: 'admin only' }, { status: 401 });
    const { results } = await env.DB.prepare(
      'SELECT id, ts, uid, kind, message, stack, route, build, context, crumbs, ua FROM client_crashes ORDER BY id DESC LIMIT ?',
    ).bind(CRASH_LIMITS.listMax).all<CrashRow>();
    return json({ rows: results });
  }
  if (parts.length !== 2 || req.method !== 'POST') return json({ error: 'not found' }, { status: 404 });
  // A report we cannot store is dropped quietly: telemetry never errors a client.
  if (!env.DB) return new Response(null, { status: 204 });
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > CRASH_LIMITS.bodyBytesMax) return json({ error: 'too big' }, { status: 413 });
  const text = await req.text();
  if (text.length > CRASH_LIMITS.bodyBytesMax) return json({ error: 'too big' }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json({ error: 'bad json' }, { status: 400 }); }
  const p = parseCrash(body);
  if (!p.ok) return json({ error: p.error }, { status: 400 });
  const ip = await hashIp(req.headers.get('CF-Connecting-IP') ?? 'unknown');
  if (await recentCrashCount(env.DB, ip, now) >= CRASH_LIMITS.perIpPerHour) {
    return new Response(null, { status: 204 }); // over rate: accept-and-drop, no signal to a flooder
  }
  const user = await currentUser(req, env, url, now).catch(() => null);
  const id = await insertCrash(env.DB, {
    ts: now,
    uid: user?.id ?? null,
    ip,
    kind: p.value.kind,
    message: p.value.message,
    stack: p.value.stack,
    route: p.value.route,
    build: p.value.build,
    context: p.value.context,
    crumbs: p.value.crumbs,
    ua: clip(req.headers.get('User-Agent'), CRASH_LIMITS.uaMax),
  });
  return json({ ok: true, id });
}
