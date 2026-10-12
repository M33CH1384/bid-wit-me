/**
 * Per-IP abuse limits for table create / join (and sign-in), Workers Free plan friendly:
 * one tiny Durable Object per hashed IP keeps sliding windows in memory only (no storage writes).
 * If the object is evicted the counters simply restart, which is fine for abuse limiting.
 */

export interface Limit { limit: number; windowMs: number }
export const LIMITS = {
  /** new tables */
  create: { limit: 15, windowMs: 10 * 60_000 },
  /** websocket joins / rejoins (reconnects count too) */
  join: { limit: 60, windowMs: 60_000 },
  /** join-screen lookups */
  info: { limit: 120, windowMs: 60_000 },
  /** sign-in starts, callbacks, passkey ceremonies, username checks */
  auth: { limit: 40, windowMs: 10 * 60_000 },
} satisfies Record<string, Limit>;
export type Bucket = keyof typeof LIMITS;

/** Sliding window: drops expired hits, returns whether one more is allowed (and records it when it is). */
export function hit(times: number[], now: number, l: Limit): { ok: boolean; times: number[]; retryAfterMs: number } {
  const live = times.filter((t) => now - t < l.windowMs);
  if (live.length >= l.limit) return { ok: false, times: live, retryAfterMs: l.windowMs - (now - live[0]!) };
  live.push(now);
  return { ok: true, times: live, retryAfterMs: 0 };
}

export interface LimitEnv { LIMITER?: DurableObjectNamespace; RATE_LIMITS_OFF?: string }

/** null = allowed; otherwise a 429 Response to return. Non-fatal: if the limiter itself fails, let the request through. */
export async function limited(req: Request, env: LimitEnv, bucket: Bucket, origin: string | null = null): Promise<Response | null> {
  if (!env.LIMITER || env.RATE_LIMITS_OFF === '1') return null;
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  try {
    const key = await ipKey(ip);
    const r = await env.LIMITER.get(env.LIMITER.idFromName(key)).fetch(`https://rl/hit?b=${bucket}`);
    if (r.status !== 429) return null;
    const retry = await r.text();
    const h: Record<string, string> = { 'content-type': 'application/json', 'retry-after': retry, 'cache-control': 'no-store' };
    if (origin) { h['access-control-allow-origin'] = origin; h.vary = 'Origin'; }
    return new Response(JSON.stringify({ error: 'Slow down: too many requests from your network. Try again in a minute.' }), { status: 429, headers: h });
  } catch { return null; }
}

async function ipKey(ip: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`bwm-rl:${ip}`));
  return [...new Uint8Array(d)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
}
