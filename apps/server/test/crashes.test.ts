import { beforeAll, describe, expect, it } from 'vitest';
import { CRASH_LIMITS, handleCrashes, parseCrash, pruneClientCrashes, type CrashEnv } from '../src/crashes';
import { sha256b64 } from '../src/auth/providers';
import { makeD1 } from './d1';

/**
 * POST /api/crashes + GET /api/crashes/list against a real SQLite D1 loaded
 * with the real migrations — so this suite also proves migration 0035
 * parses and creates client_crashes.
 */

const NOW = 1_800_000_000_000;
let db: D1Database;
let env: CrashEnv;

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const req = new Request('http://localhost/api/crashes', {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'CF-Connecting-IP': '203.0.113.7', ...headers },
    body: text,
  });
  return handleCrashes(req, env, new URL(req.url), ['api', 'crashes'], NOW);
}

function list(headers: Record<string, string> = {}): Promise<Response> {
  const req = new Request('http://localhost/api/crashes/list', { headers });
  return handleCrashes(req, env, new URL(req.url), ['api', 'crashes', 'list'], NOW);
}

const report = {
  kind: 'boundary', message: 'Cannot read properties of undefined (reading "dispose")',
  stack: 'Error: x\n    at Scene (Scene.js:1:1)\n    at Table (Table.js:2:2)',
  route: '/t/ABCD', build: 'abc123', ua: 'test',
  context: { venue: 'pjs', quality: 'high' }, crumbs: [{ t: 1, label: 'scene-mount', detail: 'pjs high' }],
};

beforeAll(async () => {
  db = await makeD1();
  env = { DB: db, FEEDBACK_ADMIN_TOKEN: 'sekret', PUBLIC_ORIGIN: 'http://localhost' };
});

describe('crash reports', () => {
  it('stores a report and returns its row id', async () => {
    const r = await post(report);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ok: boolean; id: number };
    expect(j.ok).toBe(true);
    expect(j.id).toBeGreaterThan(0);
    const row = await db.prepare('SELECT * FROM client_crashes WHERE id = ?').bind(j.id).first<Record<string, unknown>>();
    expect(row!.kind).toBe('boundary');
    expect(row!.route).toBe('/t/ABCD');
    expect(row!.build).toBe('abc123');
    expect(row!.uid).toBeNull(); // no session cookie: anonymous, never body-supplied
    expect(JSON.parse(row!.context as string).venue).toBe('pjs');
  });

  it('attaches the signed-in account from the session cookie, never the body', async () => {
    await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)')
      .bind('u-crash', 'CrashTester', 'crashtester', NOW).run();
    await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256b64('tok-crash'), 'u-crash', NOW, NOW + 60_000).run();
    const r = await post({ ...report, kind: 'error', context: { uid: 'spoofed' } }, { Cookie: 'bwm_sid=tok-crash' });
    const j = (await r.json()) as { id: number };
    const row = await db.prepare('SELECT uid FROM client_crashes WHERE id = ?').bind(j.id).first<{ uid: string }>();
    expect(row!.uid).toBe('u-crash');
  });

  it('rejects bad kind, bad JSON, and oversized bodies', async () => {
    expect((await post({ ...report, kind: 'explosion' })).status).toBe(400);
    expect((await post('{not json')).status).toBe(400);
    expect((await post('x'.repeat(CRASH_LIMITS.bodyBytesMax + 1))).status).toBe(413);
  });

  it('parseCrash clips fields to their caps and folds extra into context', () => {
    const p = parseCrash({ kind: 'error', message: 'm'.repeat(900), stack: 's'.repeat(9000), extra: { code: 4003, reason: 'kicked' } });
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.value.message.length).toBe(CRASH_LIMITS.messageMax);
      expect(p.value.stack!.length).toBe(CRASH_LIMITS.stackMax);
      expect(JSON.parse(p.value.context!).extra).toEqual({ code: 4003, reason: 'kicked' });
    }
    expect(parseCrash(null).ok).toBe(false);
    expect(parseCrash({ kind: 'error', context: 'nope' }).ok).toBe(true); // non-object context tolerated as dropped
  });

  it('drops reports past the per-IP hourly rate with a quiet 204', async () => {
    const ipHashRows = await db.prepare("SELECT ip FROM client_crashes WHERE kind = 'boundary' LIMIT 1").first<{ ip: string }>();
    // Seed the window full for this test's IP, then confirm the next POST is accepted-but-dropped.
    const seed = await post({ ...report, kind: 'manual', message: 'rate seed' });
    expect(seed.status).toBe(200);
    const mine = await db.prepare('SELECT ip, COUNT(*) AS n FROM client_crashes GROUP BY ip ORDER BY n DESC LIMIT 1').first<{ ip: string; n: number }>();
    expect(mine!.ip).toBe(ipHashRows!.ip);
    const filler = db.prepare('INSERT INTO client_crashes (ts, uid, ip, kind, message) VALUES (?, NULL, ?, ?, ?)');
    for (let i = mine!.n; i < CRASH_LIMITS.perIpPerHour; i++) await filler.bind(NOW, mine!.ip, 'error', 'filler').run();
    const before = (await db.prepare('SELECT COUNT(*) AS n FROM client_crashes').first<{ n: number }>())!.n;
    const r = await post({ ...report, kind: 'manual', message: 'one too many' });
    expect(r.status).toBe(204);
    const after = (await db.prepare('SELECT COUNT(*) AS n FROM client_crashes').first<{ n: number }>())!.n;
    expect(after).toBe(before);
  });

  it('lists newest first for admins only', async () => {
    expect((await list()).status).toBe(401);
    expect((await list({ Authorization: 'Bearer wrong' })).status).toBe(401);
    const r = await list({ Authorization: 'Bearer sekret' });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { rows: { id: number; kind: string }[] };
    expect(j.rows.length).toBeGreaterThan(0);
    expect(j.rows[0]!.id).toBeGreaterThan(j.rows[j.rows.length - 1]!.id);
  });

  it('prunes rows older than 30 days and keeps fresh ones', async () => {
    await db.prepare('INSERT INTO client_crashes (ts, kind, message) VALUES (?, ?, ?)')
      .bind(NOW - CRASH_LIMITS.retainMs - 1, 'error', 'ancient').run();
    const deleted = await pruneClientCrashes(db, NOW);
    expect(deleted).toBeGreaterThanOrEqual(1);
    const ancient = await db.prepare("SELECT COUNT(*) AS n FROM client_crashes WHERE message = 'ancient'").first<{ n: number }>();
    expect(ancient!.n).toBe(0);
    const fresh = await db.prepare("SELECT COUNT(*) AS n FROM client_crashes WHERE kind = 'boundary'").first<{ n: number }>();
    expect(fresh!.n).toBeGreaterThan(0);
  });
});
