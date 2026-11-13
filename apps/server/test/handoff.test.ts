/**
 * Sign-in handoff for the iPhone app shell (owner decision 2026-11-10: stay on the
 * free Personal Team). The shell's WKWebView cannot run passkey ceremonies, so a
 * browser session that is already signed in mints a one-time code and the app
 * redeems it for the ordinary session. These tests drive handleAuth exactly like
 * auth.test.ts does, with two "browsers": the real browser (where the passkey
 * sign-in happened) and the app WebView (its own cookie jar, the shell UA marker).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { type AuthEnv, handleAuth } from '../src/auth/routes';
import { makeD1 } from './d1';

const ORIGIN = 'https://bid-wit-me.pages.dev';
/** Appended to the shell's WebView UA by the native config (ios.appendUserAgent). */
const SHELL_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 BidWitMeApp';
const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';

class Browser {
  jar = new Map<string, string>();
  constructor(public env: AuthEnv, public t = { now: 1_800_000_000_000 }, public ua: string = BROWSER_UA) {}
  async req(path: string, init: RequestInit & { origin?: string | null } = {}) {
    const url = new URL(path, ORIGIN);
    const h = new Headers(init.headers);
    h.set('user-agent', this.ua);
    if (this.jar.size) h.set('cookie', [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '));
    if (init.method === 'POST' && init.origin !== null) h.set('origin', init.origin ?? ORIGIN);
    const req = new Request(url, { ...init, headers: h });
    const res = await handleAuth(req, this.env, url, url.pathname.split('/').filter(Boolean), { fetch: (async () => { throw new Error('no network'); }) as never, now: () => this.t.now });
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(';');
      const [k, v] = kv!.split('=');
      if (attrs.some((a) => /max-age=0/i.test(a.trim()))) this.jar.delete(k!.trim()); else this.jar.set(k!.trim(), v!.trim());
    }
    return res;
  }
  post(path: string, body: unknown = {}, origin?: string | null) { return this.req(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, origin }); }
  async me() { return ((await (await this.req('/api/auth/me')).json()) as { user: any }).user; }
  async mockSignIn(as: string) {
    const start = await this.req(`/api/auth/mock/start?as=${as}&return=/`);
    const consent = await this.req(start.headers.get('location')!);
    const cb = new URL(consent.headers.get('location')!);
    const done = await this.req(cb.pathname + cb.search);
    expect(done.status).toBe(302);
  }
  async mint() {
    const r = await this.post('/api/auth/handoff/mint');
    return { status: r.status, body: (await r.json()) as { ok?: boolean; code?: string; expiresAt?: number; error?: string } };
  }
}

let env: AuthEnv;
beforeEach(async () => { env = { DB: await makeD1(), PUBLIC_ORIGIN: ORIGIN, AUTH_MOCK: '1' }; });

/** A signed-in browser + a fresh app WebView sharing the same test clock. */
async function pair(as = 'm33ch') {
  const web = new Browser(env, { now: 1_800_000_000_000 });
  await web.mockSignIn(as);
  const app = new Browser(env, web.t, SHELL_UA);
  return { web, app };
}

describe('handoff mint', () => {
  it('requires a signed-in session (401 signed out)', async () => {
    const anon = new Browser(env);
    expect((await anon.post('/api/auth/handoff/mint')).status).toBe(401);
  });

  it('mints a high-entropy code, stores only its hash, and leaves the session untouched', async () => {
    const { web } = await pair();
    const meBefore = await web.me();
    const { status, body } = await web.mint();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.code).toBe('string');
    expect(body.code!.length).toBeGreaterThanOrEqual(12); // randomToken(9) = 72 bits
    expect(body.expiresAt! - web.t.now).toBe(10 * 60_000);
    const raw = (env.DB as unknown as { raw: { exec(s: string): { values: unknown[][] }[] } }).raw;
    const rows = raw.exec('SELECT code_hash, user_id FROM handoff_codes')[0]!.values;
    expect(rows.length).toBe(1);
    expect(rows[0]![0]).not.toBe(body.code); // the code itself is never stored
    expect(String(rows[0]![0]).length).toBeGreaterThanOrEqual(40); // a SHA-256 digest
    expect(rows[0]![1]).toBe(meBefore.id);
    expect((await web.me()).id).toBe(meBefore.id); // minting is not a sign-in event
  });

  it('caps live codes per account: a 6th mint retires the oldest', async () => {
    const { web, app } = await pair();
    const codes: string[] = [];
    for (let i = 0; i < 6; i++) codes.push((await web.mint()).body.code!);
    expect((await app.post('/api/auth/handoff/redeem', { code: codes[0] })).status).toBe(400); // retired
    const app2 = new Browser(env, web.t, SHELL_UA);
    expect((await app2.post('/api/auth/handoff/redeem', { code: codes[5] })).status).toBe(200); // newest lives
  });
});

/**
 * The cross-isolate double-redeem race, simulated at the one place it is decided:
 * both isolates read the row, D1 serializes their DELETEs, and the loser's delete
 * matches nothing (meta.changes === 0). This wrapper makes the redeem DELETE
 * report exactly that while still performing it, so the test pins the guard in
 * routes.ts: no session may start unless THIS request's delete removed the row.
 */
function withLosingHandoffDelete(db: D1Database): D1Database {
  const wrapStmt = (stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(stmt, {
      get(t, p) {
        if (p === 'bind') return (...a: unknown[]) => wrapStmt(t.bind(...(a as never[])));
        if (p === 'run')
          return async () => {
            const r = await t.run();
            return (t as unknown as { sql?: string }).sql?.includes('DELETE FROM handoff_codes WHERE code_hash')
              ? { ...r, meta: { ...r.meta, changes: 0 } }
              : r;
          };
        const v = Reflect.get(t, p) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    }) as D1PreparedStatement;
  return { ...db, prepare: (sql: string) => wrapStmt(db.prepare(sql)) } as D1Database;
}

describe('handoff redeem', () => {
  it('happy path: the app gets the ordinary session for the same account', async () => {
    const { web, app } = await pair();
    const me = await web.me();
    const { body } = await web.mint();
    const r = await app.post('/api/auth/handoff/redeem', { code: body.code });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ok?: boolean; user?: { id: string } };
    expect(j.user?.id).toBe(me.id);
    expect(app.jar.has('__Host-bwm_sid')).toBe(true); // the same cookie the passkey flow sets
    expect((await app.me()).id).toBe(me.id);
    expect((await web.me()).id).toBe(me.id); // the browser session is untouched
  });

  it('a redeem whose delete removes nothing (lost the cross-isolate race) starts no session', async () => {
    const { web } = await pair();
    const { body } = await web.mint();
    const raced = new Browser({ ...env, DB: withLosingHandoffDelete(env.DB!) }, web.t, SHELL_UA);
    const r = await raced.post('/api/auth/handoff/redeem', { code: body.code });
    expect(r.status).toBe(400); // the generic failure, not a session
    expect(raced.jar.has('__Host-bwm_sid')).toBe(false);
    expect(await raced.me()).toBeNull();
    // the delete really did land (the "winning" request consumed the code)
    const app = new Browser(env, web.t, SHELL_UA);
    expect((await app.post('/api/auth/handoff/redeem', { code: body.code })).status).toBe(400);
  });

  it('a code is single-use: the second redeem gets the generic failure', async () => {
    const { web, app } = await pair();
    const { body } = await web.mint();
    expect((await app.post('/api/auth/handoff/redeem', { code: body.code })).status).toBe(200);
    expect((await app.post('/api/auth/handoff/redeem', { code: body.code })).status).toBe(400);
  });

  it('expired codes fail — and are burned, not revivable by rewinding the clock', async () => {
    const { web, app } = await pair();
    const { body } = await web.mint();
    app.t.now += 10 * 60_000 + 1;
    expect((await app.post('/api/auth/handoff/redeem', { code: body.code })).status).toBe(400);
    app.t.now -= 10 * 60_000 + 1; // back inside the TTL: still dead
    expect((await app.post('/api/auth/handoff/redeem', { code: body.code })).status).toBe(400);
  });

  it('wrong, unknown and used codes are indistinguishable (one generic error body)', async () => {
    const { web, app } = await pair();
    const { body } = await web.mint();
    const unknown = await (await app.post('/api/auth/handoff/redeem', { code: 'AAAAAAAAAAAAAAAA' })).json();
    expect((await app.post('/api/auth/handoff/redeem', { code: body.code })).status).toBe(200);
    const reused = await (await app.post('/api/auth/handoff/redeem', { code: body.code })).json();
    expect(reused).toEqual(unknown);
  });

  it('refuses to spend a code in a plain browser (no shell marker), and does NOT consume it', async () => {
    const { web } = await pair();
    const { body } = await web.mint();
    const plain = new Browser(env, web.t, BROWSER_UA);
    const r = await plain.post('/api/auth/handoff/redeem', { code: body.code });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error?: string }).error).toContain('app');
    const app = new Browser(env, web.t, SHELL_UA); // the same code still works where it belongs
    expect((await app.post('/api/auth/handoff/redeem', { code: body.code })).status).toBe(200);
  });

  it('both endpoints sit behind the same Origin gate as every auth POST', async () => {
    const { web, app } = await pair();
    const { body } = await web.mint();
    expect((await web.post('/api/auth/handoff/mint', {}, 'https://evil.example')).status).toBe(403);
    expect((await web.post('/api/auth/handoff/mint', {}, null)).status).toBe(403);
    expect((await app.post('/api/auth/handoff/redeem', { code: body.code }, 'https://evil.example')).status).toBe(403);
    expect((await app.post('/api/auth/handoff/redeem', { code: body.code }, null)).status).toBe(403);
    expect((await app.post('/api/auth/handoff/redeem', { code: body.code })).status).toBe(200); // gate rejections never consumed it
  });

  it('deleting the account kills its outstanding codes', async () => {
    const { web, app } = await pair();
    const { body } = await web.mint();
    expect((await web.post('/api/auth/delete')).status).toBe(200);
    expect((await app.post('/api/auth/handoff/redeem', { code: body.code })).status).toBe(400);
    const raw = (env.DB as unknown as { raw: { exec(s: string): { values: unknown[][] }[] } }).raw;
    expect(raw.exec('SELECT COUNT(*) FROM handoff_codes')[0]!.values[0]![0]).toBe(0);
  });

  it('GET on the handoff paths is not a route', async () => {
    const b = new Browser(env);
    expect((await b.req('/api/auth/handoff/mint')).status).toBe(404);
    expect((await b.req('/api/auth/handoff/redeem')).status).toBe(404);
  });
});
