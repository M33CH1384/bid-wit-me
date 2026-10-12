/**
 * Accounts + sign-in (Cloudflare D1). All routes live under /api/auth and are served same-origin on
 * bid-wit-me.pages.dev through the Pages Function proxy, so the session cookie is first-party (Safari-safe).
 *
 *   GET  /api/auth/config                     → { providers: [...enabled], passkeys: true }
 *   GET  /api/auth/me                         → { user | null }
 *   GET  /api/auth/<provider>/start?mode=login|link&return=/path   → 302 to the provider
 *   GET  /api/auth/<provider>/callback        → 302 back to the game (?signin=ok|new|linked|error)
 *   POST /api/auth/passkey/register/options   { username? }  (signed in: add a passkey; else: new account with that username)
 *   POST /api/auth/passkey/register/verify    { flow, response }
 *   POST /api/auth/passkey/login/options      → discoverable-credential sign-in
 *   POST /api/auth/passkey/login/verify       { flow, response }
 *   GET  /api/auth/username/check?u=          → { ok, reason? }
 *   POST /api/auth/username                   { username }
 *   POST /api/auth/unlink                     { provider } | { passkey }
 *   POST /api/auth/logout
 *   POST /api/auth/delete                     → hard delete of the account and everything tied to it
 *   GET/POST /api/auth/progress               one-time "Save my progress" import
 *   POST /api/auth/facebook/data-deletion     Facebook's data deletion callback (signed_request)
 *   GET  /api/auth/deletion-status?code=      status for that confirmation code
 *
 * Every state-changing POST must come from the site itself (Origin check) on top of SameSite=Lax cookies.
 */
import {
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { DEFS, type ProviderEnv, type ProviderId, authorizeUrl, enabledProviders, isProvider, parseSignedRequest, pkceChallenge, randomToken, sha256b64 } from './providers';
import { checkUsername, suggestUsername, usernameKey } from './username';
import { mergeProgress, type Progress, sanitizeProgress } from './progress';

export interface AuthEnv extends ProviderEnv {
  DB?: D1Database;
  PUBLIC_ORIGIN?: string;
  ALLOWED_ORIGINS?: string;
}
export interface AuthDeps { fetch: typeof fetch; now: () => number }

export const SESSION_TTL_MS = 30 * 24 * 3600_000;
const STATE_TTL_MS = 10 * 60_000;
const CHALLENGE_TTL_MS = 5 * 60_000;
const RP_NAME = 'Bid Wit Me';

interface UserRow { id: string; username: string | null; created_at: number; progress_imported_at: number | null }

/* ------------------------------------------------------------------ helpers */
export function publicOrigin(env: AuthEnv, url: URL): string { return (env.PUBLIC_ORIGIN || url.origin).replace(/\/$/, ''); }
export function redirectUri(env: AuthEnv, url: URL, p: ProviderId): string { return `${publicOrigin(env, url)}/api/auth/${p}/callback`; }
function secure(origin: string) { return origin.startsWith('https://'); }
export function sessionCookieName(origin: string) { return secure(origin) ? '__Host-bwm_sid' : 'bwm_sid'; }
const STATE_COOKIE = 'bwm_oauth';

function cookie(origin: string, name: string, value: string, maxAgeS: number, path = '/'): string {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAgeS}; HttpOnly; SameSite=Lax${secure(origin) ? '; Secure' : ''}`;
}
function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
}
function redirect(to: string, cookies: string[] = []): Response {
  const h = new Headers({ location: to, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  for (const c of cookies) h.append('set-cookie', c);
  return new Response(null, { status: 302, headers: h });
}
export function safeReturn(r: string | null | undefined): string {
  const s = String(r ?? '/');
  return /^\/(?![/\\])[\w\-./?=&%#]*$/.test(s) && !s.startsWith('/api/') ? s : '/';
}
function withParams(path: string, params: Record<string, string>): string {
  const u = new URL(path, 'https://x');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.pathname + u.search;
}
/** CSRF: POSTs must come from the site (exact public origin or an allowed dev origin). */
function fromSite(req: Request, env: AuthEnv, url: URL): boolean {
  const o = req.headers.get('Origin');
  if (!o) return false;
  if (o === publicOrigin(env, url)) return true;
  return (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter((s) => s.startsWith('http://localhost') || s.startsWith('http://127.0.0.1')).includes(o);
}
const newId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');

/* ------------------------------------------------------------------ sessions */
export async function currentUser(req: Request, env: AuthEnv, url: URL, now: number): Promise<UserRow | null> {
  if (!env.DB) return null;
  const tok = readCookie(req, sessionCookieName(publicOrigin(env, url)));
  if (!tok) return null;
  const row = await env.DB.prepare('SELECT u.id, u.username, u.created_at, u.progress_imported_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ?')
    .bind(await sha256b64(tok), now).first<UserRow>();
  return row ?? null;
}
async function startSession(env: AuthEnv, url: URL, userId: string, now: number): Promise<string> {
  const tok = randomToken(32);
  const db = env.DB!;
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256b64(tok), userId, now, now + SESSION_TTL_MS),
  ]);
  const o = publicOrigin(env, url);
  return cookie(o, sessionCookieName(o), tok, SESSION_TTL_MS / 1000);
}
function clearSession(env: AuthEnv, url: URL): string { const o = publicOrigin(env, url); return cookie(o, sessionCookieName(o), '', 0); }

async function userView(env: AuthEnv, u: UserRow) {
  const db = env.DB!;
  const [ids, keys] = await Promise.all([
    db.prepare('SELECT provider, display_name, created_at FROM identities WHERE user_id = ? ORDER BY created_at').bind(u.id).all<{ provider: string; display_name: string | null; created_at: number }>(),
    db.prepare('SELECT id, device_type, backed_up, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at').bind(u.id).all<{ id: string; device_type: string | null; backed_up: number; created_at: number; last_used_at: number | null }>(),
  ]);
  const suggestion = u.username ? null : suggestUsername(ids.results.find((i) => i.display_name)?.display_name);
  return {
    id: u.id,
    username: u.username,
    needsUsername: !u.username,
    suggestion,
    createdAt: u.created_at,
    progressImported: !!u.progress_imported_at,
    identities: ids.results.map((i) => ({ provider: i.provider, name: i.display_name, linkedAt: i.created_at })),
    passkeys: keys.results.map((k) => ({ id: k.id, synced: !!k.backed_up, createdAt: k.created_at, lastUsedAt: k.last_used_at })),
  };
}
async function loginCount(db: D1Database, userId: string): Promise<number> {
  const r = await db.prepare('SELECT (SELECT COUNT(*) FROM identities WHERE user_id = ?1) + (SELECT COUNT(*) FROM passkeys WHERE user_id = ?1) AS n').bind(userId).first<{ n: number }>();
  return r?.n ?? 0;
}
async function deleteUser(db: D1Database, userId: string): Promise<void> {
  // explicit deletes (D1 enforces foreign keys, but don't rely on cascade settings)
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM identities WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM passkeys WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM progress WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM oauth_states WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM webauthn_challenges WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
}

/* ------------------------------------------------------------------ router */
export async function handleAuth(req: Request, env: AuthEnv, url: URL, parts: string[], deps: AuthDeps): Promise<Response> {
  const [, , a, b, c] = parts; // api / auth / a / b / c
  const now = deps.now();
  if (a === 'config' && req.method === 'GET') return json({ providers: enabledProviders(env), passkeys: !!env.DB, accounts: !!env.DB });
  if (!env.DB) return json({ error: 'Accounts are not set up on this server yet.' }, 503);
  const db = env.DB;
  const origin = publicOrigin(env, url);

  if (a === 'me' && req.method === 'GET') {
    const u = await currentUser(req, env, url, now);
    return json({ user: u ? await userView(env, u) : null });
  }

  // Facebook's servers call this (no Origin, no cookie): verified by the signed_request HMAC
  if (a === 'facebook' && b === 'data-deletion' && req.method === 'POST') return facebookDeletion(req, env, origin, now);
  if (a === 'deletion-status' && req.method === 'GET') {
    const code = (url.searchParams.get('code') ?? '').slice(0, 64);
    const r = await db.prepare('SELECT status, created_at FROM deletion_requests WHERE code = ?').bind(code).first<{ status: string; created_at: number }>();
    return json(r ? { found: true, status: r.status, at: r.created_at } : { found: false });
  }

  // ---- OAuth
  if (a && isProvider(a) && (b === 'start' || b === 'callback') && req.method === 'GET') {
    if (!enabledProviders(env).includes(a)) return b === 'start' ? json({ error: `${DEFS[a].label} sign-in isn't available yet.` }, 404) : redirect(withParams('/', { signin: 'error', reason: 'provider_off' }));
    return b === 'start' ? oauthStart(req, env, url, a, now) : oauthCallback(req, env, url, a, deps);
  }
  if (a === 'mock' && b === 'authorize' && req.method === 'GET' && env.AUTH_MOCK === '1') {
    // fake provider consent screen: bounce straight back with code = ?as (the fake user's id)
    const back = new URL(url.searchParams.get('redirect_uri') ?? '/');
    back.searchParams.set('code', url.searchParams.get('as') ?? url.searchParams.get('login_hint') ?? 'tester');
    back.searchParams.set('state', url.searchParams.get('state') ?? '');
    return redirect(back.toString());
  }

  if (a === 'username' && b === 'check' && req.method === 'GET') {
    const v = checkUsername(url.searchParams.get('u'));
    if (!v.ok) return json(v);
    const me = await currentUser(req, env, url, now);
    const taken = await db.prepare('SELECT id FROM users WHERE username_key = ?').bind(usernameKey(v.username)).first<{ id: string }>();
    return json(taken && taken.id !== me?.id ? { ok: false, reason: 'That name is taken.' } : { ok: true, username: v.username });
  }

  if (req.method !== 'POST') return json({ error: 'not found' }, 404);
  if (!fromSite(req, env, url)) return json({ error: 'bad origin' }, 403);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (a === 'passkey') return passkey(req, env, url, b, c, body, now);

  const me = await currentUser(req, env, url, now);
  if (a === 'logout') {
    const tok = readCookie(req, sessionCookieName(origin));
    if (tok) await db.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256b64(tok)).run();
    return json({ ok: true }, 200, { 'set-cookie': clearSession(env, url) });
  }
  if (!me) return json({ error: 'Sign in first.' }, 401);

  if (a === 'username') {
    const v = checkUsername(body.username);
    if (!v.ok) return json(v, 400);
    try {
      await db.prepare('UPDATE users SET username = ?, username_key = ? WHERE id = ?').bind(v.username, usernameKey(v.username), me.id).run();
    } catch { return json({ ok: false, reason: 'That name is taken.' }, 409); }
    return json({ ok: true, user: await userView(env, { ...me, username: v.username }) });
  }
  if (a === 'unlink') {
    if (await loginCount(db, me.id) <= 1) return json({ error: "That's your only way to sign in. Add another login first, or delete the account." }, 400);
    if (typeof body.provider === 'string') await db.prepare('DELETE FROM identities WHERE user_id = ? AND provider = ?').bind(me.id, body.provider).run();
    else if (typeof body.passkey === 'string') await db.prepare('DELETE FROM passkeys WHERE user_id = ? AND id = ?').bind(me.id, body.passkey).run();
    else return json({ error: 'nothing to unlink' }, 400);
    return json({ ok: true, user: await userView(env, me) });
  }
  if (a === 'delete') {
    await deleteUser(db, me.id);
    return json({ ok: true }, 200, { 'set-cookie': clearSession(env, url) });
  }
  if (a === 'progress') {
    const stored = await db.prepare('SELECT data FROM progress WHERE user_id = ?').bind(me.id).first<{ data: string }>();
    let current: Progress | null = null;
    try { current = stored ? sanitizeProgress(JSON.parse(stored.data)) : null; } catch { current = null; }
    if (body.import) {
      if (me.progress_imported_at) return json({ ok: false, reason: 'Progress was already saved to this account.', progress: current }, 409);
      const merged = mergeProgress(current, sanitizeProgress(body.import));
      await db.batch([
        db.prepare('INSERT INTO progress (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').bind(me.id, JSON.stringify(merged), now),
        db.prepare('UPDATE users SET progress_imported_at = ? WHERE id = ?').bind(now, me.id),
      ]);
      return json({ ok: true, progress: merged });
    }
    return json({ ok: true, progress: current });
  }
  return json({ error: 'not found' }, 404);
}

/* ------------------------------------------------------------------ OAuth */
async function oauthStart(req: Request, env: AuthEnv, url: URL, p: ProviderId, now: number): Promise<Response> {
  const db = env.DB!;
  const mode = url.searchParams.get('mode') === 'link' ? 'link' : 'login';
  const me = mode === 'link' ? await currentUser(req, env, url, now) : null;
  if (mode === 'link' && !me) return redirect(withParams(safeReturn(url.searchParams.get('return')), { signin: 'error', reason: 'signed_out' }));
  const state = randomToken(24);
  const verifier = DEFS[p].pkce ? randomToken(48) : null;
  await db.batch([
    db.prepare('DELETE FROM oauth_states WHERE created_at < ?').bind(now - STATE_TTL_MS),
    db.prepare('INSERT INTO oauth_states (state, provider, verifier, mode, user_id, return_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(state, p, verifier, mode, me?.id ?? null, safeReturn(url.searchParams.get('return')), now),
  ]);
  const creds = DEFS[p].creds(env);
  const origin = publicOrigin(env, url);
  let to = authorizeUrl(p, { clientId: creds.id!, redirectUri: redirectUri(env, url, p), state, challenge: verifier ? await pkceChallenge(verifier) : null, origin });
  if (p === 'mock') to += `&as=${encodeURIComponent((url.searchParams.get('as') ?? 'tester').slice(0, 40))}`;
  return redirect(to, [cookie(origin, STATE_COOKIE, state, STATE_TTL_MS / 1000, '/api/auth')]);
}

async function oauthCallback(req: Request, env: AuthEnv, url: URL, p: ProviderId, deps: AuthDeps): Promise<Response> {
  const db = env.DB!;
  const now = deps.now();
  const origin = publicOrigin(env, url);
  const clearState = cookie(origin, STATE_COOKIE, '', 0, '/api/auth');
  const fail = (reason: string, ret = '/') => redirect(withParams(ret, { signin: 'error', reason }), [clearState]);
  const state = url.searchParams.get('state') ?? '';
  const row = state ? await db.prepare('SELECT * FROM oauth_states WHERE state = ?').bind(state).first<{ state: string; provider: string; verifier: string | null; mode: string; user_id: string | null; return_to: string | null; created_at: number }>() : null;
  if (row) await db.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run(); // single use
  // the state must exist, be fresh, be for this provider, and match the cookie set on this browser at /start
  if (!row || row.provider !== p || now - row.created_at > STATE_TTL_MS || readCookie(req, STATE_COOKIE) !== state) return fail('state');
  const ret = safeReturn(row.return_to);
  if (url.searchParams.get('error')) return fail('cancelled', ret);
  const code = url.searchParams.get('code');
  if (!code) return fail('no_code', ret);

  let profile;
  try {
    const creds = DEFS[p].creds(env);
    profile = await DEFS[p].exchange({ code, verifier: row.verifier, redirectUri: redirectUri(env, url, p), id: creds.id!, secret: creds.secret!, f: deps.fetch });
  } catch { return fail('exchange', ret); }
  const name = profile.name ? profile.name.slice(0, 80) : null;

  const existing = await db.prepare('SELECT user_id FROM identities WHERE provider = ? AND provider_user_id = ?').bind(p, profile.id).first<{ user_id: string }>();
  let userId: string;
  let outcome: 'ok' | 'new' | 'linked';
  if (row.mode === 'link') {
    const me = await currentUser(req, env, url, now);
    if (!me || me.id !== row.user_id) return fail('signed_out', ret);
    if (existing && existing.user_id !== me.id) return fail('linked_elsewhere', ret);
    if (!existing) await db.prepare('INSERT INTO identities (provider, provider_user_id, user_id, display_name, created_at) VALUES (?, ?, ?, ?, ?)').bind(p, profile.id, me.id, name, now).run();
    userId = me.id; outcome = 'linked';
  } else if (existing) {
    userId = existing.user_id; outcome = 'ok';
    await db.prepare('UPDATE identities SET display_name = ? WHERE provider = ? AND provider_user_id = ?').bind(name, p, profile.id).run();
  } else {
    userId = newId(); outcome = 'new';
    await db.batch([
      db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, NULL, NULL, ?)').bind(userId, now),
      db.prepare('INSERT INTO identities (provider, provider_user_id, user_id, display_name, created_at) VALUES (?, ?, ?, ?, ?)').bind(p, profile.id, userId, name, now),
    ]);
  }
  const cookies = [clearState];
  if (outcome !== 'linked') cookies.push(await startSession(env, url, userId, now));
  return redirect(withParams(ret, { signin: outcome, via: p }), cookies);
}

/* ------------------------------------------------------------------ passkeys */
function rp(env: AuthEnv, url: URL) { const o = publicOrigin(env, url); return { origin: o, rpID: new URL(o).hostname }; }

async function passkey(req: Request, env: AuthEnv, url: URL, b: string | undefined, c: string | undefined, body: Record<string, unknown>, now: number): Promise<Response> {
  const db = env.DB!;
  const { origin, rpID } = rp(env, url);
  const me = await currentUser(req, env, url, now);
  await db.prepare('DELETE FROM webauthn_challenges WHERE created_at < ?').bind(now - CHALLENGE_TTL_MS).run();

  if (b === 'register' && c === 'options') {
    let userId: string, userName: string, newName: string | null = null;
    if (me) {
      userId = me.id; userName = me.username ?? 'Bid Wit Me player';
    } else {
      const v = checkUsername(body.username);
      if (!v.ok) return json(v, 400);
      const taken = await db.prepare('SELECT 1 FROM users WHERE username_key = ?').bind(usernameKey(v.username)).first();
      if (taken) return json({ ok: false, reason: 'That name is taken.' }, 409);
      userId = newId(); userName = v.username; newName = v.username;
    }
    const existing = me ? (await db.prepare('SELECT id, transports FROM passkeys WHERE user_id = ?').bind(me.id).all<{ id: string; transports: string | null }>()).results : [];
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID, userName, userDisplayName: userName,
      userID: new TextEncoder().encode(userId),
      attestationType: 'none',
      excludeCredentials: existing.map((k) => ({ id: k.id, transports: k.transports ? (JSON.parse(k.transports) as AuthenticatorTransportFuture[]) : undefined })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    const flow = randomToken(18);
    await db.prepare('INSERT INTO webauthn_challenges (id, challenge, kind, user_id, username, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(flow, options.challenge, 'register', userId, newName, now).run();
    return json({ ok: true, flow, options });
  }

  if (b === 'register' && c === 'verify') {
    const ch = await takeChallenge(db, body.flow, 'register');
    if (!ch) return json({ error: 'That passkey request expired. Try again.' }, 400);
    if (me && me.id !== ch.user_id) return json({ error: 'Signed-in account changed. Try again.' }, 400);
    if (!me && !ch.username) return json({ error: 'Pick a username first.' }, 400);
    let v;
    try {
      v = await verifyRegistrationResponse({ response: body.response as never, expectedChallenge: ch.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false });
    } catch (e) { return json({ error: `Passkey check failed: ${(e as Error).message}` }, 400); }
    if (!v.verified || !v.registrationInfo) return json({ error: 'Passkey check failed.' }, 400);
    const { credential, credentialDeviceType, credentialBackedUp } = v.registrationInfo;
    const stmts: D1PreparedStatement[] = [];
    if (!me) {
      const taken = await db.prepare('SELECT 1 FROM users WHERE username_key = ?').bind(usernameKey(ch.username!)).first();
      if (taken) return json({ ok: false, reason: 'That name was just taken. Pick another.' }, 409);
      stmts.push(db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind(ch.user_id, ch.username, usernameKey(ch.username!), now));
    }
    stmts.push(db.prepare('INSERT INTO passkeys (id, user_id, public_key, counter, transports, device_type, backed_up, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(credential.id, ch.user_id, credential.publicKey.buffer.slice(credential.publicKey.byteOffset, credential.publicKey.byteOffset + credential.publicKey.byteLength), credential.counter, JSON.stringify(credential.transports ?? []), credentialDeviceType, credentialBackedUp ? 1 : 0, now));
    try { await db.batch(stmts); } catch { return json({ error: 'That passkey is already registered.' }, 409); }
    const headers: Record<string, string> = me ? {} : { 'set-cookie': await startSession(env, url, ch.user_id!, now) };
    const u = await db.prepare('SELECT id, username, created_at, progress_imported_at FROM users WHERE id = ?').bind(ch.user_id).first<UserRow>();
    return json({ ok: true, outcome: me ? 'linked' : 'new', user: await userView(env, u!) }, 200, headers);
  }

  if (b === 'login' && c === 'options') {
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
    const flow = randomToken(18);
    await db.prepare('INSERT INTO webauthn_challenges (id, challenge, kind, created_at) VALUES (?, ?, ?, ?)').bind(flow, options.challenge, 'login', now).run();
    return json({ ok: true, flow, options });
  }

  if (b === 'login' && c === 'verify') {
    const ch = await takeChallenge(db, body.flow, 'login');
    if (!ch) return json({ error: 'That passkey request expired. Try again.' }, 400);
    const credId = String((body.response as { id?: string } | undefined)?.id ?? '');
    const key = await db.prepare('SELECT id, user_id, public_key, counter, transports FROM passkeys WHERE id = ?').bind(credId).first<{ id: string; user_id: string; public_key: ArrayBuffer; counter: number; transports: string | null }>();
    if (!key) return json({ error: "This passkey isn't linked to a Bid Wit Me account." }, 404);
    let v;
    try {
      v = await verifyAuthenticationResponse({
        response: body.response as never, expectedChallenge: ch.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
        credential: { id: key.id, publicKey: new Uint8Array(key.public_key), counter: key.counter, transports: key.transports ? JSON.parse(key.transports) : undefined },
      });
    } catch (e) { return json({ error: `Passkey check failed: ${(e as Error).message}` }, 400); }
    if (!v.verified) return json({ error: 'Passkey check failed.' }, 400);
    await db.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?').bind(v.authenticationInfo.newCounter, now, key.id).run();
    const u = await db.prepare('SELECT id, username, created_at, progress_imported_at FROM users WHERE id = ?').bind(key.user_id).first<UserRow>();
    return json({ ok: true, outcome: 'ok', user: await userView(env, u!) }, 200, { 'set-cookie': await startSession(env, url, key.user_id, now) });
  }
  return json({ error: 'not found' }, 404);
}

async function takeChallenge(db: D1Database, flow: unknown, kind: string) {
  if (typeof flow !== 'string' || !flow) return null;
  const ch = await db.prepare('SELECT challenge, user_id, username FROM webauthn_challenges WHERE id = ? AND kind = ?').bind(flow, kind).first<{ challenge: string; user_id: string | null; username: string | null }>();
  await db.prepare('DELETE FROM webauthn_challenges WHERE id = ?').bind(flow).run();
  return ch ?? null;
}

/* ------------------------------------------------------------------ Facebook data deletion */
async function facebookDeletion(req: Request, env: AuthEnv, origin: string, now: number): Promise<Response> {
  const db = env.DB!;
  if (!env.FACEBOOK_APP_SECRET) return json({ error: 'not configured' }, 404);
  const form = await req.formData().catch(() => null);
  const sr = form?.get('signed_request');
  const parsed = typeof sr === 'string' ? await parseSignedRequest(sr, env.FACEBOOK_APP_SECRET) : null;
  if (!parsed) return json({ error: 'bad signed_request' }, 400);
  const ident = await db.prepare("SELECT user_id FROM identities WHERE provider = 'facebook' AND provider_user_id = ?").bind(parsed.user_id).first<{ user_id: string }>();
  if (ident) {
    // remove the Facebook login; if it was the account's only way in, the whole account goes
    await db.prepare("DELETE FROM identities WHERE provider = 'facebook' AND provider_user_id = ?").bind(parsed.user_id).run();
    if (await loginCount(db, ident.user_id) === 0) await deleteUser(db, ident.user_id);
  }
  const code = randomToken(12);
  await db.prepare('INSERT INTO deletion_requests (code, provider, status, created_at) VALUES (?, ?, ?, ?)').bind(code, 'facebook', ident ? 'deleted' : 'not_found', now).run();
  return json({ url: `${origin}/data-deletion?code=${code}`, confirmation_code: code });
}
