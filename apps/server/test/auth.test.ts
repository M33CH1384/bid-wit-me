import { describe, expect, it, beforeEach } from 'vitest';
import { type AuthEnv, handleAuth, safeReturn } from '../src/auth/routes';
import { authorizeUrl, b64url, enabledProviders, parseSignedRequest, pkceChallenge } from '../src/auth/providers';
import { checkUsername, isProfane, suggestUsername } from '../src/auth/username';
import { mergeProgress, sanitizeProgress } from '../src/auth/progress';
import { makeD1 } from './d1';

const ORIGIN = 'https://bid-wit-me.pages.dev';

/** Drives handleAuth like a browser: keeps cookies, follows nothing automatically. */
class Browser {
  jar = new Map<string, string>();
  constructor(public env: AuthEnv, public t = { now: 1_800_000_000_000 }, public fetcher: typeof fetch = (async () => { throw new Error('no network'); }) as never) {}
  async req(path: string, init: RequestInit & { origin?: string | null } = {}) {
    const url = new URL(path, ORIGIN);
    const h = new Headers(init.headers);
    if (this.jar.size) h.set('cookie', [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '));
    if (init.method === 'POST' && init.origin !== null) h.set('origin', init.origin ?? ORIGIN);
    const req = new Request(url, { ...init, headers: h });
    const res = await handleAuth(req, this.env, url, url.pathname.split('/').filter(Boolean), { fetch: this.fetcher, now: () => this.t.now });
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(';');
      const [k, v] = kv!.split('=');
      if (attrs.some((a) => /max-age=0/i.test(a.trim()))) this.jar.delete(k!.trim()); else this.jar.set(k!.trim(), v!.trim());
    }
    return res;
  }
  post(path: string, body: unknown = {}, origin?: string | null) { return this.req(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, origin }); }
  async me() { return ((await (await this.req('/api/auth/me')).json()) as { user: any }).user; }
  /** full mock-provider round trip; returns the final redirect location */
  async mockSignIn(as: string, extra = '') {
    const start = await this.req(`/api/auth/mock/start?as=${as}&return=/online${extra}`);
    expect(start.status).toBe(302);
    const consent = await this.req(start.headers.get('location')!);
    const cb = new URL(consent.headers.get('location')!);
    expect(cb.pathname).toBe('/api/auth/mock/callback');
    const done = await this.req(cb.pathname + cb.search);
    expect(done.status).toBe(302);
    return done.headers.get('location')!;
  }
}

let env: AuthEnv;
beforeEach(async () => { env = { DB: await makeD1(), PUBLIC_ORIGIN: ORIGIN, AUTH_MOCK: '1' }; });

describe('usernames', () => {
  it('format, reserved names, profanity (incl. l33t and hidden), no false positives on innocent words', () => {
    expect(checkUsername('Demetrius').ok).toBe(true);
    expect(checkUsername('ab').ok).toBe(false);
    expect(checkUsername('1abc').ok).toBe(false);
    expect(checkUsername('has space').ok).toBe(false);
    expect(checkUsername('a'.repeat(17)).ok).toBe(false);
    for (const r of ['admin', 'Admin', 'BWM_Official', 'support', 'bidwitme', 'moderator1', 'guest']) expect(checkUsername(r).ok, r).toBe(false);
    for (const p of ['FuckBoy', 'sh1tlord', 'xXbitchXx', 'big_dick', 'BigDick99', 'n1gga', 'a55', 'Rape_King']) expect(isProfane(p), p).toBe(true);
    for (const ok of ['Grape', 'Raccoon', 'Sussex', 'Dickens', 'Cockpit', 'Classic', 'Bassist', 'Spades_King']) expect(isProfane(ok), ok).toBe(false);
    expect(suggestUsername('Demetrius R.')).toBe('DemetriusR');
    expect(suggestUsername('  ')).toBe('');
  });
});

describe('providers', () => {
  it('a provider is on only when both secrets exist', () => {
    expect(enabledProviders({})).toEqual([]);
    expect(enabledProviders({ GOOGLE_CLIENT_ID: 'x' })).toEqual([]);
    expect(enabledProviders({ GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', FACEBOOK_APP_ID: 'a', FACEBOOK_APP_SECRET: 'b' })).toEqual(['google', 'facebook']);
    expect(enabledProviders({ X_CLIENT_ID: 'x', X_CLIENT_SECRET: 'y', DISCORD_CLIENT_ID: 'd', DISCORD_CLIENT_SECRET: 'e' })).toEqual(['discord', 'x']);
  });
  it('authorize URLs carry state, exact redirect URI, minimal scopes, PKCE where supported', async () => {
    const ch = await pkceChallenge('v');
    const g = new URL(authorizeUrl('google', { clientId: 'cid', redirectUri: `${ORIGIN}/api/auth/google/callback`, state: 's1', challenge: ch, origin: ORIGIN }));
    expect(g.searchParams.get('redirect_uri')).toBe('https://bid-wit-me.pages.dev/api/auth/google/callback');
    expect(g.searchParams.get('scope')).toBe('openid profile');
    expect(g.searchParams.get('code_challenge_method')).toBe('S256');
    const x = new URL(authorizeUrl('x', { clientId: 'cid', redirectUri: 'r', state: 's', challenge: ch, origin: ORIGIN }));
    expect(x.origin).toBe('https://x.com');
    expect(x.searchParams.get('scope')).toBe('users.read tweet.read');
    const d = new URL(authorizeUrl('discord', { clientId: 'cid', redirectUri: 'r', state: 's', challenge: ch, origin: ORIGIN }));
    expect(d.searchParams.get('scope')).toBe('identify');
    expect(d.searchParams.has('code_challenge')).toBe(false);
  });
  it('config hides providers without secrets', async () => {
    const b = new Browser({ ...env, AUTH_MOCK: undefined, GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's' });
    expect(await (await b.req('/api/auth/config')).json()).toEqual({ providers: ['google'], passkeys: true, accounts: true });
    expect((await b.req('/api/auth/discord/start')).status).toBe(404);
  });
  it('return paths stay on the site', () => {
    expect(safeReturn('/online')).toBe('/online');
    expect(safeReturn('//evil.com')).toBe('/');
    expect(safeReturn('https://evil.com')).toBe('/');
    expect(safeReturn('/\\evil.com')).toBe('/');
    expect(safeReturn('/api/auth/delete')).toBe('/');
  });
});

describe('OAuth sign-in (mock provider, full round trip)', () => {
  it('new account → username → me → logout → sign back in to the same account', async () => {
    const b = new Browser(env);
    const loc = await b.mockSignIn('alice');
    expect(loc).toBe('/online?signin=new&via=mock');
    expect(b.jar.has('__Host-bwm_sid')).toBe(true);
    let me = await b.me();
    expect(me.needsUsername).toBe(true);
    expect(me.identities).toEqual([expect.objectContaining({ provider: 'mock', name: 'Test alice' })]);
    expect(me.suggestion).toBe('TestAlice');
    expect((await b.post('/api/auth/username', { username: 'admin' })).status).toBe(400);
    expect((await b.post('/api/auth/username', { username: 'Alice_W' })).status).toBe(200);
    me = await b.me();
    expect(me.username).toBe('Alice_W');
    expect((await b.post('/api/auth/logout')).status).toBe(200);
    expect(await b.me()).toBe(null);
    expect(await b.mockSignIn('alice')).toBe('/online?signin=ok&via=mock');
    expect((await b.me()).id).toBe(me.id);
  });
  it('usernames are unique ignoring case', async () => {
    const a = new Browser(env), c = new Browser(env);
    await a.mockSignIn('a1'); await a.post('/api/auth/username', { username: 'Kingpin' });
    await c.mockSignIn('c1');
    expect(await (await c.req('/api/auth/username/check?u=kingpin')).json()).toEqual({ ok: false, reason: 'That name is taken.' });
    expect((await c.post('/api/auth/username', { username: 'KINGPIN' })).status).toBe(409);
    expect(await (await a.req('/api/auth/username/check?u=kingpin')).json()).toEqual({ ok: true, username: 'kingpin' });
  });
  it('rejects a callback whose state cookie is missing (login CSRF) or reused', async () => {
    const b = new Browser(env);
    const start = await b.req('/api/auth/mock/start?as=bob');
    const cb = new URL((await b.req(start.headers.get('location')!)).headers.get('location')!);
    const attacker = new Browser(env);
    expect((await attacker.req(cb.pathname + cb.search)).headers.get('location')).toBe('/?signin=error&reason=state');
    // the attacker's attempt burned the state: the real browser can't reuse it either
    expect((await b.req(cb.pathname + cb.search)).headers.get('location')).toBe('/?signin=error&reason=state');
  });
  it('expired state fails', async () => {
    const b = new Browser(env);
    const start = await b.req('/api/auth/mock/start?as=bob');
    const cb = new URL((await b.req(start.headers.get('location')!)).headers.get('location')!);
    b.t.now += 11 * 60_000;
    expect((await b.req(cb.pathname + cb.search)).headers.get('location')).toContain('reason=state');
  });
  it('link a second login, refuse a login already on another account, unlink, never strand an account', async () => {
    const b = new Browser(env);
    await b.mockSignIn('main');
    expect((await b.post('/api/auth/unlink', { provider: 'mock' })).status).toBe(400); // only login
    const other = new Browser(env); await other.mockSignIn('taken');
    // linking mock:taken (already another account's) fails; linking mock:alt works
    expect(await b.mockSignIn('taken', '&mode=link')).toContain('reason=linked_elsewhere');
    expect(await b.mockSignIn('alt', '&mode=link')).toBe('/online?signin=linked&via=mock');
    const me = await b.me();
    expect(me.identities.length).toBe(2);
  });
  it('link requires being signed in', async () => {
    const b = new Browser(env);
    const r = await b.req('/api/auth/mock/start?as=x&mode=link&return=/account');
    expect(r.headers.get('location')).toBe('/account?signin=error&reason=signed_out');
  });
  it('delete account removes everything and signs out', async () => {
    const b = new Browser(env);
    await b.mockSignIn('gone'); await b.post('/api/auth/username', { username: 'GoneGirl' });
    expect((await b.post('/api/auth/delete')).status).toBe(200);
    expect(await b.me()).toBe(null);
    const raw = (env.DB as unknown as { raw: { exec(s: string): { values: unknown[][] }[] } }).raw;
    for (const t of ['users', 'identities', 'sessions', 'progress', 'passkeys']) expect(raw.exec(`SELECT COUNT(*) FROM ${t}`)[0]!.values[0]![0], t).toBe(0);
    // signing in again makes a fresh account; the name is free again
    expect(await b.mockSignIn('gone')).toContain('signin=new');
    expect((await b.post('/api/auth/username', { username: 'GoneGirl' })).status).toBe(200);
  });
  it('POSTs from other sites (or with no Origin) are refused', async () => {
    const b = new Browser(env);
    await b.mockSignIn('csrf');
    expect((await b.post('/api/auth/delete', {}, 'https://evil.example')).status).toBe(403);
    expect((await b.post('/api/auth/delete', {}, null)).status).toBe(403);
    expect(await b.me()).not.toBe(null);
  });
  it('google: code exchange + userinfo with the exact redirect URI and the PKCE verifier', async () => {
    const calls: { url: string; body?: string }[] = [];
    const f = (async (u: string, init?: RequestInit) => {
      calls.push({ url: String(u), body: init?.body ? String(init.body) : undefined });
      if (String(u).includes('/token')) return Response.json({ access_token: 'at' });
      return Response.json({ sub: 'g-123', name: 'Demetrius Robinson' });
    }) as typeof fetch;
    const b = new Browser({ ...env, GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsec' }, undefined, f);
    const start = await b.req('/api/auth/google/start?return=/');
    const auth = new URL(start.headers.get('location')!);
    expect(auth.origin + auth.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const state = auth.searchParams.get('state')!;
    const done = await b.req(`/api/auth/google/callback?code=abc&state=${state}`);
    expect(done.headers.get('location')).toBe('/?signin=new&via=google');
    const tok = new URLSearchParams(calls[0]!.body);
    expect(tok.get('redirect_uri')).toBe('https://bid-wit-me.pages.dev/api/auth/google/callback');
    expect(await pkceChallenge(tok.get('code_verifier')!)).toBe(auth.searchParams.get('code_challenge'));
    expect(tok.get('client_secret')).toBe('gsec');
    expect((await b.me()).suggestion).toBe('DemetriusR');
  });
  it('a failed exchange or a cancelled consent comes back as an error, no account', async () => {
    const f = (async () => new Response('no', { status: 400 })) as unknown as typeof fetch;
    const b = new Browser({ ...env, DISCORD_CLIENT_ID: 'd', DISCORD_CLIENT_SECRET: 's' }, undefined, f);
    let s = new URL((await b.req('/api/auth/discord/start')).headers.get('location')!).searchParams.get('state');
    expect((await b.req(`/api/auth/discord/callback?code=x&state=${s}`)).headers.get('location')).toBe('/?signin=error&reason=exchange');
    s = new URL((await b.req('/api/auth/discord/start')).headers.get('location')!).searchParams.get('state');
    expect((await b.req(`/api/auth/discord/callback?error=access_denied&state=${s}`)).headers.get('location')).toBe('/?signin=error&reason=cancelled');
    expect(await b.me()).toBe(null);
  });
});

describe('progress import', () => {
  it('one time only, sanitized, merged', async () => {
    const b = new Browser(env);
    await b.mockSignIn('prog');
    const local = { badges: [{ id: 'storm-chaser', earnedAt: 5, context: { hand: 3 } }, { id: 'storm-chaser', earnedAt: 9 }, { id: '<bad>', earnedAt: 1 }], series: { v: 1, games: [], sides: [] }, teamName: 'Shot Callers' };
    const r = await (await b.post('/api/auth/progress', { import: local })).json() as any;
    expect(r.progress.badges).toEqual([{ id: 'storm-chaser', earnedAt: 5, context: { hand: 3 } }, { id: 'bad', earnedAt: 1 }]);
    expect(r.progress.teamName).toBe('Shot Callers');
    expect((await b.me()).progressImported).toBe(true);
    expect((await b.post('/api/auth/progress', { import: local })).status).toBe(409);
    expect(((await (await b.post('/api/auth/progress', {})).json()) as any).progress.badges.length).toBe(2);
  });
  it('merge keeps the earliest badge and the account series', () => {
    const acct = sanitizeProgress({ badges: [{ id: 'a', earnedAt: 10 }], series: { v: 1, n: 'acct' } });
    const dev = sanitizeProgress({ badges: [{ id: 'a', earnedAt: 3 }, { id: 'b', earnedAt: 4 }], series: { v: 1, n: 'dev' }, teamName: 'X Team' });
    const m = mergeProgress(acct, dev);
    expect(m.badges).toEqual([{ id: 'a', earnedAt: 3 }, { id: 'b', earnedAt: 4 }]);
    expect(m.series).toEqual({ v: 1, n: 'acct' });
    expect(m.teamName).toBe('X Team');
  });
});

describe('passkeys', () => {
  it('new-account registration needs a valid, free username first; options carry the RP id', async () => {
    const b = new Browser(env);
    expect((await b.post('/api/auth/passkey/register/options', { username: 'admin' })).status).toBe(400);
    const r = await (await b.post('/api/auth/passkey/register/options', { username: 'FaceIdFan' })).json() as any;
    expect(r.options.rp).toEqual({ name: 'Bid Wit Me', id: 'bid-wit-me.pages.dev' });
    expect(r.options.authenticatorSelection.residentKey).toBe('required');
    const l = await (await b.post('/api/auth/passkey/login/options')).json() as any;
    expect(l.options.rpId).toBe('bid-wit-me.pages.dev');
    // garbage responses are rejected and the challenge is single use
    expect((await b.post('/api/auth/passkey/login/verify', { flow: l.flow, response: { id: 'nope' } })).status).toBe(404);
    expect((await b.post('/api/auth/passkey/login/verify', { flow: l.flow, response: { id: 'nope' } })).status).toBe(400);
    expect((await b.post('/api/auth/passkey/register/verify', { flow: r.flow, response: {} })).status).toBe(400);
  });
});

describe('Facebook data deletion callback', () => {
  async function signed(payload: object, secret: string) {
    const p = b64url(new TextEncoder().encode(JSON.stringify(payload)));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return `${b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(p)))}.${p}`;
  }
  it('verifies signed_request, deletes the Facebook login (and an account left with no login), returns a status URL + code', async () => {
    const f = (async (u: string) => (String(u).includes('access_token?') ? Response.json({ access_token: 't' }) : Response.json({ id: 'fb-42', name: 'FB Person' }))) as typeof fetch;
    const fbEnv = { ...env, FACEBOOK_APP_ID: 'app', FACEBOOK_APP_SECRET: 'appsecret' };
    const b = new Browser(fbEnv, undefined, f);
    const s = new URL((await b.req('/api/auth/facebook/start')).headers.get('location')!);
    expect(s.origin + s.pathname).toBe('https://www.facebook.com/v24.0/dialog/oauth');
    await b.req(`/api/auth/facebook/callback?code=c&state=${s.searchParams.get('state')}`);
    expect((await b.me()).identities[0].provider).toBe('facebook');
    expect(await parseSignedRequest(await signed({ algorithm: 'HMAC-SHA256', user_id: 'fb-42' }, 'wrong'), 'appsecret')).toBe(null);
    const body = new URLSearchParams({ signed_request: await signed({ algorithm: 'HMAC-SHA256', user_id: 'fb-42', issued_at: 1 }, 'appsecret') });
    const fb = new Browser(fbEnv);
    const res = await fb.req('/api/auth/facebook/data-deletion', { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' }, origin: null });
    const j = await res.json() as { url: string; confirmation_code: string };
    expect(j.url).toBe(`https://bid-wit-me.pages.dev/data-deletion?code=${j.confirmation_code}`);
    expect(await b.me()).toBe(null); // account gone (Facebook was its only login)
    expect(await (await fb.req(`/api/auth/deletion-status?code=${j.confirmation_code}`)).json()).toMatchObject({ found: true, status: 'deleted' });
    const bad = await fb.req('/api/auth/facebook/data-deletion', { method: 'POST', body: new URLSearchParams({ signed_request: 'x.y' }), headers: { 'content-type': 'application/x-www-form-urlencoded' }, origin: null });
    expect(bad.status).toBe(400);
  });
});
