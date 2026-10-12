/**
 * Feedback admin sign-in without the token in the URL: a small form POSTs the token once, the Worker answers with a
 * short-lived HttpOnly cookie (HMAC-signed with FEEDBACK_ADMIN_TOKEN, 8 h, Path=/api/feedback, SameSite=Strict).
 * Scripts can still send `Authorization: Bearer <token>`. `?token=` is no longer accepted.
 */
export const ADMIN_COOKIE = 'bwm_admin';
export const ADMIN_TTL_MS = 8 * 3600_000;

const enc = new TextEncoder();
export const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function makeAdminCookie(secret: string, now: number): Promise<string> {
  const exp = now + ADMIN_TTL_MS;
  return `${exp}.${await hmac(secret, `bwm-admin:${exp}`)}`;
}

export async function adminCookieOk(value: string | null | undefined, secret: string | undefined, now: number): Promise<boolean> {
  if (!value || !secret) return false;
  const [exp, sig] = value.split('.');
  if (!exp || !sig || !(Number(exp) > now)) return false;
  return safeEqual(sig, await hmac(secret, `bwm-admin:${exp}`));
}

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function adminLoginHtml(error = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>BWM feedback admin</title><style>
body{font:16px/1.4 system-ui,sans-serif;background:#140a24;color:#eee;display:grid;place-items:center;min-height:90vh;margin:0}
form{background:#24123f;border:1px solid #4a2b80;border-radius:8px;padding:18px;display:grid;gap:10px;width:min(92vw,360px)}
input,button{font:inherit;padding:10px;border-radius:6px;border:1px solid #555}button{background:#f5c542;color:#140a24;font-weight:700;border:0}p{color:#ff8a8a;margin:0}
</style></head><body><form method="post" action="/api/feedback/admin"><b>Bid Wit Me feedback</b>${error ? `<p>${error}</p>` : ''}<input type="password" name="token" autocomplete="current-password" placeholder="Admin token" required autofocus><button>Open</button></form></body></html>`;
}
