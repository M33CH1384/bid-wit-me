/**
 * Web Push delivery: prefs gating, per-user fan-out, cooldowns, dead-subscription cleanup.
 * Every failure is contained — pushes never throw into the game path.
 */
import { encryptPushPayload, vapidAuthorization, type VapidKeys } from './crypto';

export type NotifType =
  | 'turn' | 'invite' | 'friend_online' | 'achievement'
  | 'daily' | 'rankup' | 'challenge' | 'season' | 'wager' | 'story_callback';

export const NOTIF_TYPES: NotifType[] = [
  'turn', 'invite', 'friend_online', 'achievement', 'daily', 'rankup', 'challenge', 'season', 'wager', 'story_callback',
];

export const NOTIF_LABELS: Record<NotifType, string> = {
  turn: 'Your turn',
  invite: 'Game invites',
  friend_online: 'Friend comes online',
  achievement: 'Achievements',
  daily: 'Daily bonus',
  rankup: 'Rank ups',
  challenge: 'Challenge complete',
  season: 'Season ending',
  wager: 'Big Bank challenges',
  story_callback: 'Story table calls',
};

export interface PushPayload {
  title: string;
  body: string;
  /** URL opened on tap, e.g. "/t/AB12CD" */
  url: string;
  /** groups replaceable notifications, e.g. "turn-AB12CD" */
  tag: string;
  type: NotifType;
}

export interface PushVapidEnv {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export function vapidFromEnv(env: PushVapidEnv): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}

interface Subscription { endpoint: string; p256dh: string; auth: string }

/** True when the user has this notification type enabled (opt-out: default true). */
export async function prefEnabled(db: D1Database, userId: string, type: NotifType): Promise<boolean> {
  const row = await db.prepare('SELECT enabled FROM push_prefs WHERE user_id = ? AND type = ?')
    .bind(userId, type).first<{ enabled: number }>();
  return row ? row.enabled === 1 : true;
}

/** All prefs for the settings UI (defaults true). */
export async function allPrefs(db: D1Database, userId: string): Promise<Record<NotifType, boolean>> {
  const rows = await db.prepare('SELECT type, enabled FROM push_prefs WHERE user_id = ?')
    .bind(userId).all<{ type: string; enabled: number }>();
  const out = {} as Record<NotifType, boolean>;
  for (const t of NOTIF_TYPES) out[t] = true;
  for (const r of rows.results) if ((NOTIF_TYPES as string[]).includes(r.type)) out[r.type as NotifType] = r.enabled === 1;
  return out;
}

/**
 * Cooldown gate: at most one send per (kind, key) per `ms`. Returns true when the send
 * may proceed (and records it); false when still cooling down.
 */
export async function cooldownOk(db: D1Database, userId: string, kind: string, key: string, ms: number, now: number): Promise<boolean> {
  const row = await db.prepare('SELECT last_sent FROM push_cooldowns WHERE user_id = ? AND kind = ? AND key = ?')
    .bind(userId, kind, key).first<{ last_sent: number }>();
  if (row && now - row.last_sent < ms) return false;
  await db.prepare(`INSERT INTO push_cooldowns (user_id, kind, key, last_sent) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, kind, key) DO UPDATE SET last_sent = excluded.last_sent`)
    .bind(userId, kind, key, now).run();
  return true;
}

/** Send one encrypted push; 404/410 from the push service means the subscription is dead. */
async function sendToSubscription(
  fetchFn: typeof fetch,
  sub: Subscription,
  vapid: VapidKeys,
  payload: PushPayload,
  opts: { ttl: number; urgency: 'very-low' | 'low' | 'normal' | 'high'; now: number },
): Promise<'ok' | 'dead' | 'failed'> {
  try {
    const body = await encryptPushPayload(sub.p256dh, sub.auth, new TextEncoder().encode(JSON.stringify(payload)));
    const audience = new URL(sub.endpoint).origin;
    const res = await fetchFn(sub.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'content-encoding': 'aes128gcm',
        ttl: String(opts.ttl),
        urgency: opts.urgency,
        authorization: await vapidAuthorization(vapid, audience, opts.now),
      },
      body: body as BodyInit,
    });
    if (res.status === 404 || res.status === 410) return 'dead';
    if (!res.ok) { console.error(JSON.stringify({ src: 'bwm.push', event: 'send-failed', status: res.status, endpoint: sub.endpoint.slice(0, 60) })); return 'failed'; }
    return 'ok';
  } catch (e) {
    console.error(JSON.stringify({ src: 'bwm.push', event: 'send-error', error: String(e).slice(0, 120) }));
    return 'failed';
  }
}

/**
 * Fan out a push to every live subscription of a user (after pref check).
 * Returns how many were accepted. Dead (404/410) subscriptions are deleted.
 */
export async function sendPushToUser(
  db: D1Database,
  fetchFn: typeof fetch,
  vapid: VapidKeys,
  userId: string,
  payload: PushPayload,
  opts: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; now?: number; force?: boolean } = {},
): Promise<number> {
  const now = opts.now ?? Date.now();
  if (!opts.force && !(await prefEnabled(db, userId, payload.type))) return 0;
  const subs = (await db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
    .bind(userId).all<Subscription>()).results;
  if (!subs.length) return 0;
  let sent = 0;
  const dead: string[] = [];
  for (const sub of subs) {
    const r = await sendToSubscription(fetchFn, sub, vapid, payload, {
      ttl: opts.ttl ?? 86400,
      urgency: opts.urgency ?? 'normal',
      now,
    });
    if (r === 'ok') sent++;
    else if (r === 'dead') dead.push(sub.endpoint);
  }
  for (const endpoint of dead) {
    await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
  }
  return sent;
}
