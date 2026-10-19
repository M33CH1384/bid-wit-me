/**
 * Web Push HTTP routes:
 *   GET  /api/push/vapid-key    → { publicKey } (or 503 until VAPID secrets exist)
 *   POST /api/push/subscribe    → { endpoint, keys: { p256dh, auth } } (signed in)
 *   POST /api/push/unsubscribe  → { endpoint } (signed in)
 *   GET  /api/push/prefs        → { prefs: Record<NotifType, boolean> } (signed in)
 *   PUT  /api/push/prefs        → { type, enabled } (signed in)
 *   POST /api/push/test         → sends a test push to the caller's devices (signed in)
 */
import { type AuthEnv, currentUser } from '../auth/routes';
import { allPrefs, cooldownOk, NOTIF_TYPES, sendPushToUser, vapidFromEnv, type NotifType } from './send';

export interface PushEnv extends AuthEnv {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

function validB64u(s: unknown, minLen: number): s is string {
  return typeof s === 'string' && s.length >= minLen && /^[A-Za-z0-9\-_]+$/.test(s);
}

export async function handlePushHttp(req: Request, env: PushEnv, url: URL, parts: string[], now: number): Promise<Response> {
  if (!env.DB) return json({ error: 'accounts are not configured' }, 503);
  const db = env.DB;

  if (parts[2] === 'vapid-key' && req.method === 'GET') {
    const vapid = vapidFromEnv(env);
    if (!vapid) return json({ error: 'push is not configured yet' }, 503);
    return json({ publicKey: vapid.publicKey });
  }

  const me = await currentUser(req, env, url, now);
  if (!me) return json({ error: 'Sign in to manage notifications.' }, 401);

  if (parts[2] === 'subscribe' && req.method === 'POST') {
    let body: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; ua?: unknown };
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
    const p256dh = body.keys?.p256dh;
    const auth = body.keys?.auth;
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 2000) return json({ error: 'bad endpoint' }, 400);
    if (!validB64u(p256dh, 80) || !validB64u(auth, 20)) return json({ error: 'bad keys' }, 400);
    const ua = typeof body.ua === 'string' ? body.ua.slice(0, 200) : null;
    // one device, one row; moving a subscription between users re-homes it
    await db.prepare(`INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, ua, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh,
        auth = excluded.auth, ua = excluded.ua, created_at = excluded.created_at`)
      .bind(endpoint, me.id, p256dh, auth, ua, now).run();
    return json({ ok: true });
  }

  if (parts[2] === 'unsubscribe' && req.method === 'POST') {
    let body: { endpoint?: unknown; all?: unknown };
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    if (body.all === true) {
      // Clear all subscriptions for this user (iOS sometimes loses the local subscription handle)
      await db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').bind(me.id).run();
      return json({ ok: true });
    }
    if (typeof body.endpoint !== 'string') return json({ error: 'bad endpoint' }, 400);
    await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').bind(body.endpoint, me.id).run();
    return json({ ok: true });
  }

  if (parts[2] === 'prefs' && req.method === 'GET') {
    return json({ prefs: await allPrefs(db, me.id) });
  }

  if (parts[2] === 'prefs' && (req.method === 'PUT' || req.method === 'PATCH')) {
    let body: { type?: unknown; enabled?: unknown };
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    if (!(NOTIF_TYPES as string[]).includes(body.type as string) || typeof body.enabled !== 'boolean') {
      return json({ error: 'bad pref' }, 400);
    }
    await db.prepare(`INSERT INTO push_prefs (user_id, type, enabled) VALUES (?, ?, ?)
      ON CONFLICT (user_id, type) DO UPDATE SET enabled = excluded.enabled`)
      .bind(me.id, body.type as NotifType, body.enabled ? 1 : 0).run();
    return json({ ok: true });
  }

  if (parts[2] === 'test' && req.method === 'POST') {
    const vapid = vapidFromEnv(env);
    if (!vapid) return json({ error: 'push is not configured yet' }, 503);
    // gentle test cooldown: one test push per minute per user
    if (!(await cooldownOk(db, me.id, 'test', 'self', 60_000, now))) {
      return json({ error: 'slow down — one test per minute' }, 429);
    }
    const sent = await sendPushToUser(db, fetch, vapid, me.id, {
      title: 'Bid Wit Me',
      body: 'Push is working 🎉 — you’ll get turn alerts and invites here.',
      url: '/',
      tag: 'bwm-test',
      type: 'invite',
    }, { ttl: 60, urgency: 'normal', now, force: true }); // explicit user action: bypass pref gate
    return json({ ok: true, sent });
  }

  return json({ error: 'not found' }, 404);
}
