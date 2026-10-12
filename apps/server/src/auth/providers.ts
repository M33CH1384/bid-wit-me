/**
 * OAuth 2.0 sign-in providers (authorization-code flow, server-side token exchange, `state` bound to the browser,
 * PKCE S256 where the provider supports it). A provider is enabled only when both of its secrets are set.
 * Scopes are the minimum that yields a stable user id + display name: no email, no posting, no friends list.
 */
export type ProviderId = 'google' | 'discord' | 'x' | 'facebook' | 'mock';
export const PROVIDERS: ProviderId[] = ['google', 'discord', 'x', 'facebook'];
export const FB_GRAPH = 'v24.0';

export interface ProviderEnv {
  GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string;
  DISCORD_CLIENT_ID?: string; DISCORD_CLIENT_SECRET?: string;
  X_CLIENT_ID?: string; X_CLIENT_SECRET?: string;
  FACEBOOK_APP_ID?: string; FACEBOOK_APP_SECRET?: string;
  /** local tests only: a fake provider that signs in whoever is named in ?as= */
  AUTH_MOCK?: string;
}

export interface Profile { id: string; name: string | null }
type Fetcher = typeof fetch;

interface Def {
  label: string;
  authorize: string;
  scope: string;
  pkce: boolean;
  creds(env: ProviderEnv): { id?: string; secret?: string };
  extra?: Record<string, string>;
  exchange(a: { code: string; verifier: string | null; redirectUri: string; id: string; secret: string; f: Fetcher }): Promise<Profile>;
}

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
async function ok<T>(r: Response, what: string): Promise<T> {
  if (!r.ok) throw new Error(`${what} ${r.status}`);
  return (await r.json()) as T;
}

export const DEFS: Record<ProviderId, Def> = {
  google: {
    label: 'Google',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'openid profile',
    pkce: true,
    extra: { prompt: 'select_account' },
    creds: (e) => ({ id: e.GOOGLE_CLIENT_ID, secret: e.GOOGLE_CLIENT_SECRET }),
    async exchange({ code, verifier, redirectUri, id, secret, f }) {
      const t = await ok<{ access_token: string }>(await f('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({ code, client_id: id, client_secret: secret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier ?? '' }),
      }), 'google token');
      const u = await ok<{ sub: string; name?: string }>(await f('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${t.access_token}` } }), 'google userinfo');
      return { id: u.sub, name: u.name ?? null };
    },
  },
  discord: {
    label: 'Discord',
    authorize: 'https://discord.com/oauth2/authorize',
    scope: 'identify',
    pkce: false,
    creds: (e) => ({ id: e.DISCORD_CLIENT_ID, secret: e.DISCORD_CLIENT_SECRET }),
    async exchange({ code, redirectUri, id, secret, f }) {
      const t = await ok<{ access_token: string }>(await f('https://discord.com/api/oauth2/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({ client_id: id, client_secret: secret, grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
      }), 'discord token');
      const u = await ok<{ id: string; username?: string; global_name?: string | null }>(await f('https://discord.com/api/users/@me', { headers: { authorization: `Bearer ${t.access_token}` } }), 'discord user');
      return { id: u.id, name: u.global_name || u.username || null };
    },
  },
  x: {
    label: 'X',
    authorize: 'https://x.com/i/oauth2/authorize',
    scope: 'users.read tweet.read',
    pkce: true,
    creds: (e) => ({ id: e.X_CLIENT_ID, secret: e.X_CLIENT_SECRET }),
    async exchange({ code, verifier, redirectUri, id, secret, f }) {
      const t = await ok<{ access_token: string }>(await f('https://api.x.com/2/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${btoa(`${id}:${secret}`)}` },
        body: form({ code, grant_type: 'authorization_code', redirect_uri: redirectUri, code_verifier: verifier ?? '', client_id: id }),
      }), 'x token');
      const u = await ok<{ data: { id: string; name?: string; username?: string } }>(await f('https://api.x.com/2/users/me', { headers: { authorization: `Bearer ${t.access_token}` } }), 'x user');
      return { id: u.data.id, name: u.data.name || u.data.username || null };
    },
  },
  facebook: {
    label: 'Facebook',
    authorize: `https://www.facebook.com/${FB_GRAPH}/dialog/oauth`,
    scope: 'public_profile',
    pkce: false,
    creds: (e) => ({ id: e.FACEBOOK_APP_ID, secret: e.FACEBOOK_APP_SECRET }),
    async exchange({ code, redirectUri, id, secret, f }) {
      const t = await ok<{ access_token: string }>(await f(`https://graph.facebook.com/${FB_GRAPH}/oauth/access_token?${form({ client_id: id, client_secret: secret, redirect_uri: redirectUri, code })}`), 'facebook token');
      const u = await ok<{ id: string; name?: string }>(await f(`https://graph.facebook.com/${FB_GRAPH}/me?${form({ fields: 'id,name', access_token: t.access_token })}`), 'facebook me');
      return { id: u.id, name: u.name ?? null };
    },
  },
  mock: {
    label: 'Test login',
    authorize: '/api/auth/mock/authorize',
    scope: 'test',
    pkce: true,
    creds: (e) => (e.AUTH_MOCK === '1' ? { id: 'mock-client', secret: 'mock-secret' } : {}),
    // the "code" is the fake user's id, signed nowhere: only ever enabled in local test runs
    async exchange({ code }) {
      const id = code.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
      if (!id) throw new Error('mock code');
      return { id, name: `Test ${id}` };
    },
  },
};

export function enabledProviders(env: ProviderEnv): ProviderId[] {
  const list: ProviderId[] = PROVIDERS.filter((p) => { const c = DEFS[p].creds(env); return !!(c.id && c.secret); });
  if (env.AUTH_MOCK === '1') list.push('mock');
  return list;
}
export function isProvider(p: string): p is ProviderId { return p in DEFS; }

export function authorizeUrl(p: ProviderId, a: { clientId: string; redirectUri: string; state: string; challenge: string | null; origin: string }): string {
  const d = DEFS[p];
  const u = new URL(d.authorize, a.origin);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', a.clientId);
  u.searchParams.set('redirect_uri', a.redirectUri);
  u.searchParams.set('scope', d.scope);
  u.searchParams.set('state', a.state);
  if (d.pkce && a.challenge) { u.searchParams.set('code_challenge', a.challenge); u.searchParams.set('code_challenge_method', 'S256'); }
  for (const [k, v] of Object.entries(d.extra ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

/* ------------------------------------------------------------ crypto helpers */
export function b64url(b: ArrayBuffer | Uint8Array): string {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
export function randomToken(bytes = 32): string { return b64url(crypto.getRandomValues(new Uint8Array(bytes))); }
export async function sha256b64(s: string): Promise<string> { return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); }
export const pkceChallenge = sha256b64;

/**
 * Facebook data deletion callback: `signed_request` = base64url(HMAC-SHA256(payload, app secret)) + '.' + base64url(JSON).
 * Returns the Facebook user id (app-scoped) when the signature checks out.
 */
export async function parseSignedRequest(sr: string, appSecret: string): Promise<{ user_id: string } | null> {
  const [sig, payload] = sr.split('.');
  if (!sig || !payload) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  let good = false;
  try { good = await crypto.subtle.verify('HMAC', key, fromB64url(sig), new TextEncoder().encode(payload)); } catch { return null; }
  if (!good) return null;
  try {
    const j = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { algorithm?: string; user_id?: string };
    if (String(j.algorithm).toUpperCase() !== 'HMAC-SHA256' || !j.user_id) return null;
    return { user_id: String(j.user_id) };
  } catch { return null; }
}
