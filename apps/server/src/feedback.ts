/**
 * Player feedback: validation, rate limiting, storage schema (DO SQLite), admin listing and an optional email notifier.
 *
 *   POST /api/feedback                    → { ok: true, id } (JSON body, see FeedbackIn)
 *   GET  /api/feedback/admin?token=…      → private HTML listing with thumbnails (FEEDBACK_ADMIN_TOKEN secret)
 *   GET  /api/feedback/list?token=…       → the same as JSON
 *   GET  /api/feedback/shot/:id?token=…   → one screenshot
 *
 * Screenshots live as compressed blobs in the feedback Durable Object's SQLite (R2 isn't enabled on this account);
 * the client already downscales them (≤1600 px, JPEG/WebP ~0.8), the server caps each at 1.5 MB, 3 per message.
 * Email: when FEEDBACK_EMAIL_TO + RESEND_API_KEY secrets exist, the owner gets a mail per message (Resend);
 * otherwise this is skipped silently.
 */

export const FEEDBACK_LIMITS = {
  types: ['bug', 'idea', 'other'] as const,
  messageMax: 4000,
  nameMax: 60,
  emailMax: 120,
  contextMax: 4000,
  shotsMax: 3,
  shotBytesMax: 1_500_000,
  /** whole request body (3 base64 shots + text) */
  bodyBytesMax: 6_600_000,
  perIpPerHour: 5,
} as const;

export type FeedbackType = (typeof FEEDBACK_LIMITS.types)[number];
export interface Shot { mime: string; bytes: Uint8Array }
export interface FeedbackIn { type: FeedbackType; message: string; name: string; email: string; context: Record<string, unknown>; shots: Shot[] }
export type Parsed = { ok: true; value: FeedbackIn; spam: boolean } | { ok: false; error: string };

const MIMES = ['image/jpeg', 'image/webp', 'image/png'];

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Validates a POST /api/feedback body. `website` is a honeypot: humans never see it, bots fill it in. */
export function parseFeedback(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'bad body' };
  const b = raw as Record<string, unknown>;
  const L = FEEDBACK_LIMITS;
  const type = b.type;
  if (typeof type !== 'string' || !(L.types as readonly string[]).includes(type)) return { ok: false, error: 'bad type' };
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  if (message.length < 3) return { ok: false, error: 'message too short' };
  if (message.length > L.messageMax) return { ok: false, error: 'message too long' };
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (name.length > L.nameMax) return { ok: false, error: 'name too long' };
  const email = typeof b.email === 'string' ? b.email.trim() : '';
  if (email.length > L.emailMax || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { ok: false, error: 'bad email' };
  let context: Record<string, unknown> = {};
  if (b.context !== undefined) {
    if (!b.context || typeof b.context !== 'object' || Array.isArray(b.context)) return { ok: false, error: 'bad context' };
    if (JSON.stringify(b.context).length > L.contextMax) return { ok: false, error: 'context too big' };
    context = b.context as Record<string, unknown>;
  }
  const shotsRaw = b.shots ?? [];
  if (!Array.isArray(shotsRaw) || shotsRaw.length > L.shotsMax) return { ok: false, error: 'too many screenshots' };
  const shots: Shot[] = [];
  for (const s of shotsRaw) {
    const m = typeof s === 'string' ? /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(s) : null;
    if (!m || !MIMES.includes(m[1]!)) return { ok: false, error: 'bad screenshot' };
    if (m[2]!.length * 0.75 > L.shotBytesMax + 4) return { ok: false, error: 'screenshot too big' };
    let bytes: Uint8Array;
    try { bytes = b64ToBytes(m[2]!); } catch { return { ok: false, error: 'bad screenshot' }; }
    if (bytes.length > L.shotBytesMax) return { ok: false, error: 'screenshot too big' };
    shots.push({ mime: m[1]!, bytes });
  }
  const spam = typeof b.website === 'string' && b.website.trim() !== '';
  return { ok: true, value: { type: type as FeedbackType, message, name, email, context, shots }, spam };
}

/** Sliding one-hour window: may this IP send another? (timestamps of its earlier sends) */
export function rateOk(times: number[], now: number, limit: number = FEEDBACK_LIMITS.perIpPerHour): boolean {
  return times.filter((t) => now - t < 3600_000).length < limit;
}

export async function hashIp(ip: string, salt = 'bwm-feedback'): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`));
  return [...new Uint8Array(d)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Constant-time-ish token compare (the token is a long random string). */
export function tokenOk(given: string | null, expected: string | undefined): boolean {
  if (!expected || !given || given.length !== expected.length) return false;
  let d = 0;
  for (let i = 0; i < given.length; i++) d |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return d === 0;
}

export interface FeedbackRow { id: number; created: number; type: string; message: string; name: string; email: string; context: string; shots: number[] }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function adminHtml(rows: FeedbackRow[], token: string, base: string): string {
  const t = encodeURIComponent(token);
  const items = rows.map((r) => {
    let ctx = r.context;
    try { ctx = JSON.stringify(JSON.parse(r.context), null, 1); } catch { /* raw */ }
    const shots = r.shots.map((s) => `<a href="${base}/api/feedback/shot/${s}?token=${t}" target="_blank"><img src="${base}/api/feedback/shot/${s}?token=${t}" loading="lazy" alt="screenshot ${s}"></a>`).join('');
    return `<article><header><b class="t-${esc(r.type)}">${esc(r.type.toUpperCase())}</b> #${r.id} · ${new Date(r.created).toISOString().replace('T', ' ').slice(0, 16)} UTC${r.name ? ` · ${esc(r.name)}` : ''}${r.email ? ` · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : ''}</header><p>${esc(r.message).replace(/\n/g, '<br>')}</p>${shots ? `<div class="shots">${shots}</div>` : ''}<details><summary>context</summary><pre>${esc(ctx)}</pre></details></article>`;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>BWM feedback (${rows.length})</title><style>
body{font:15px/1.4 system-ui,sans-serif;background:#140a24;color:#eee;margin:0;padding:16px;max-width:1000px;margin:auto}
h1{font-size:20px;color:#f5c542}article{background:#24123f;border:1px solid #4a2b80;border-radius:8px;padding:10px 12px;margin:10px 0}
header{color:#bbb;font-size:13px}header b{color:#140a24;background:#f5c542;padding:1px 6px;border-radius:3px;margin-right:4px}header b.t-bug{background:#ff7a7a}header b.t-idea{background:#7dff9b}
p{white-space:normal}.shots{display:flex;gap:8px;flex-wrap:wrap}.shots img{height:140px;border-radius:4px;border:1px solid #555}pre{white-space:pre-wrap;font-size:12px;color:#ccc}a{color:#cdb8ff}
</style></head><body><h1>Bid Wit Me feedback · ${rows.length} newest</h1>${items || '<p>No feedback yet.</p>'}</body></html>`;
}

/** Pluggable notifier: email the owner through Resend when configured, otherwise do nothing. */
export interface NotifyEnv { FEEDBACK_EMAIL_TO?: string; RESEND_API_KEY?: string; FEEDBACK_EMAIL_FROM?: string }
export async function notifyOwner(env: NotifyEnv, fb: FeedbackIn, id: number, adminUrl: string, fetcher: typeof fetch = fetch): Promise<'sent' | 'skipped' | 'failed'> {
  if (!env.FEEDBACK_EMAIL_TO || !env.RESEND_API_KEY) return 'skipped';
  const text = [
    `${fb.type.toUpperCase()} #${id}${fb.name ? ` from ${fb.name}` : ''}${fb.email ? ` <${fb.email}>` : ''}`,
    '', fb.message, '', `${fb.shots.length} screenshot(s). Context: ${JSON.stringify(fb.context)}`, '', `All feedback: ${adminUrl}`,
  ].join('\n');
  try {
    const r = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env.FEEDBACK_EMAIL_FROM || 'Bid Wit Me <onboarding@resend.dev>',
        to: env.FEEDBACK_EMAIL_TO.split(',').map((s) => s.trim()).filter(Boolean),
        subject: `[BWM ${fb.type}] ${fb.message.slice(0, 60)}`,
        text,
        ...(fb.email ? { reply_to: fb.email } : {}),
      }),
    });
    return r.ok ? 'sent' : 'failed';
  } catch { return 'failed'; }
}
