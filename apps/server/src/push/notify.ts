/**
 * Push trigger helpers — one per notification type. Each is cooldown-gated and
 * never throws; callers run them inside ctx.waitUntil(...).
 */
import { cooldownOk, sendPushToUser, type NotifType, type PushPayload, type PushVapidEnv } from './send';
import { vapidFromEnv } from './send';
import type { VapidKeys } from './crypto';

const DAY = 86_400_000;

type Opts = { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high' };

async function guarded(
  db: D1Database, vapid: VapidKeys, userId: string,
  cooldown: { kind: string; key: string; ms: number },
  payload: PushPayload, opts: Opts, now: number,
): Promise<number> {
  if (!(await cooldownOk(db, userId, cooldown.kind, cooldown.key, cooldown.ms, now))) return 0;
  return sendPushToUser(db, fetch, vapid, userId, payload, { ...opts, now });
}

/** It's your move and you have no live socket on the table. */
export async function notifyTurn(db: D1Database, vapid: VapidKeys, userId: string, code: string, kind: 'bid' | 'play', now: number): Promise<number> {
  return guarded(db, vapid, userId, { kind: 'turn', key: code, ms: 15 * 60_000 }, {
    title: 'Your turn',
    body: kind === 'bid' ? `Your bid is up at table ${code}` : `Your play is up at table ${code}`,
    url: `/t/${code}`,
    tag: `turn-${code}`,
    type: 'turn',
  }, { ttl: 1800, urgency: 'high' }, now);
}

/**
 * True when `muter` has muted `muted` (migration 0030). Mute suppression is
 * upstream of notification types: a muted player's DM / mention pushes
 * never fire — the message itself still lands in the thread / chat history
 * for when the muter chooses to look. A missing table (older test DBs)
 * reads as "not muted" rather than breaking the push path.
 */
async function isMuted(db: D1Database, muter: string, muted: string): Promise<boolean> {
  try {
    return !!(await db.prepare('SELECT 1 AS ok FROM mutes WHERE muter = ? AND muted = ?').bind(muter, muted).first());
  } catch { return false; }
}

/**
 * A friend DM'd you and you have no live socket. Cooldown: at most one DM
 * push per sender per 10 minutes (the thread itself keeps every message).
 */
export async function notifyDm(db: D1Database, vapid: VapidKeys, userId: string, fromUid: string, fromName: string, text: string, now: number): Promise<number> {
  if (await isMuted(db, userId, fromUid)) return 0;
  return guarded(db, vapid, userId, { kind: 'dm', key: fromUid, ms: 10 * 60_000 }, {
    title: `Message from ${fromName}`,
    body: text.slice(0, 140),
    url: '/social',
    tag: `dm-${fromUid}`,
    type: 'dm',
  }, { ttl: 3600, urgency: 'high' }, now);
}

/**
 * Someone @mentioned you in chat (global or at a table) and you have no
 * live socket there. Cooldown: at most one mention push per author per
 * 5 minutes, keyed by the author's account pid. `url` lands on the global
 * chat ('/social') or the table ('/t/<code>').
 */
export async function notifyMention(db: D1Database, vapid: VapidKeys, userId: string, authorUid: string, authorName: string, text: string, url: string, now: number): Promise<number> {
  if (await isMuted(db, userId, authorUid)) return 0;
  return guarded(db, vapid, userId, { kind: 'mention', key: `u:${authorUid}`, ms: 5 * 60_000 }, {
    title: `${authorName} mentioned you`,
    body: text.slice(0, 140),
    url,
    tag: `mention-${authorUid}`,
    type: 'mention',
  }, { ttl: 3600, urgency: 'normal' }, now);
}

/** Someone invited you to a table. */
export async function notifyInvite(db: D1Database, vapid: VapidKeys, userId: string, fromName: string, code: string, mode: string | null, now: number): Promise<number> {
  return guarded(db, vapid, userId, { kind: 'invite', key: `${fromName}:${code}`, ms: 2 * 60_000 }, {
    title: 'Game invite',
    body: `${fromName} invited you to a table${mode ? ` (${mode})` : ''} — code ${code}`,
    url: `/t/${code}`,
    tag: `invite-${code}`,
    type: 'invite',
  }, { ttl: 300, urgency: 'high' }, now);
}

/** Big Bank wager-challenge events (invite / check-in open / table ready / outcome). */
export type WagerPushKind = 'invite' | 'checkin' | 'ready' | 'outcome';
export async function notifyWager(db: D1Database, vapid: VapidKeys, userId: string, kind: WagerPushKind, title: string, body: string, challengeId: string, now: number): Promise<number> {
  const urgent = kind === 'checkin' || kind === 'ready';
  return guarded(db, vapid, userId, { kind: `wager_${kind}`, key: challengeId, ms: 60_000 }, {
    title,
    body,
    url: '/social',
    tag: `wager-${challengeId}`,
    type: 'wager',
  }, { ttl: urgent ? 1800 : DAY, urgency: urgent ? 'high' : 'normal' }, now);
}

/** A friend just came online. Max 1/hour per friend. */
export async function notifyFriendOnline(db: D1Database, vapid: VapidKeys, userId: string, friendName: string, now: number): Promise<number> {
  return guarded(db, vapid, userId, { kind: 'friend_online', key: friendName.toLowerCase(), ms: 60 * 60_000 }, {
    title: 'Friend online',
    body: `${friendName} is on the block — go run it.`,
    url: '/social',
    tag: `online-${friendName.toLowerCase()}`,
    type: 'friend_online',
  }, { ttl: 3600, urgency: 'normal' }, now);
}

/**
 * A user just came online: push "friend online" to each of their friends.
 * Skips users who appear offline (their setting hides presence entirely).
 */
export async function notifyFriendsOfOnline(db: D1Database, vapid: VapidKeys, uid: string, name: string, now: number): Promise<number> {
  const hidden = await db.prepare('SELECT appear_offline FROM social_settings WHERE user_id = ?').bind(uid)
    .first<{ appear_offline: number }>();
  if (hidden?.appear_offline) return 0;
  const friends = await db.prepare(`SELECT CASE WHEN a = ? THEN b ELSE a END AS fid FROM friends
    WHERE (a = ? OR b = ?) AND status = 'friends'`).bind(uid, uid, uid).all<{ fid: string }>();
  let sent = 0;
  for (const f of friends.results) sent += await notifyFriendOnline(db, vapid, f.fid, name, now);
  return sent;
}

/** Achievement unlocked. */
export async function notifyAchievement(db: D1Database, vapid: VapidKeys, userId: string, title: string, now: number): Promise<number> {
  return guarded(db, vapid, userId, { kind: 'achievement', key: title, ms: 24 * 60_60_000 }, {
    title: 'Achievement unlocked 🏆',
    body: title,
    url: '/profile',
    tag: `ach-${title}`,
    type: 'achievement',
  }, { ttl: DAY, urgency: 'normal' }, now);
}

/**
 * Rating crossed into a higher band after a rated game. Copy is metric-only
 * (owner, 2026-10-20: no division names in user-facing text) — it reports the
 * player's actual new rating, carried on the event. The division id survives
 * only in the internal cooldown key / tag (one push per band per day).
 */
export async function notifyRankup(db: D1Database, vapid: VapidKeys, userId: string, division: string, kind: string, rating: number | undefined, now: number): Promise<number> {
  const mode = kind === 'team' ? 'Partnership' : 'Cutthroat';
  return guarded(db, vapid, userId, { kind: 'rankup', key: `${kind}:${division}`, ms: 24 * 60_60_000 }, {
    title: 'Rating up ⬆️',
    body: rating != null ? `Your ${mode} rating climbed to ${rating.toLocaleString('en-US')}` : `Your ${mode} rating just went up`,
    url: '/profile',
    tag: `rank-${kind}-${division}`,
    type: 'rankup',
  }, { ttl: DAY, urgency: 'normal' }, now);
}

/** A daily/weekly challenge hit 100%. */
export async function notifyChallenge(db: D1Database, vapid: VapidKeys, userId: string, challengeTitle: string, now: number): Promise<number> {
  return guarded(db, vapid, userId, { kind: 'challenge', key: challengeTitle, ms: 24 * 60_60_000 }, {
    title: 'Challenge complete ✅',
    body: `${challengeTitle} — claim your reward.`,
    url: '/profile',
    tag: `chal-${challengeTitle}`,
    type: 'challenge',
  }, { ttl: DAY, urgency: 'normal' }, now);
}

/** Users with a push subscription and recent activity (played or logged in within 14 days). */
async function activePushUsers(db: D1Database, now: number): Promise<string[]> {
  const since = now - 14 * DAY;
  const dayCutoff = new Date(since).toISOString().slice(0, 10); // daily_logins has no timestamp; day is 'YYYY-MM-DD'
  const rows = await db.prepare(`
    SELECT DISTINCT ps.user_id AS id FROM push_subscriptions ps
    WHERE EXISTS (SELECT 1 FROM daily_logins dl WHERE dl.user_id = ps.user_id AND dl.day >= ?)
       OR EXISTS (SELECT 1 FROM game_players gp WHERE gp.user_id = ps.user_id AND gp.ended_at > ?)`)
    .bind(dayCutoff, since).all<{ id: string }>();
  return rows.results.map((r) => r.id);
}

/**
 * Scheduled (cron) pushes:
 *  - daily: once per UTC day, shortly after midnight, to active subscribers
 *  - season: one reminder per season when it ends within 3 days
 */
export async function runScheduledPushes(db: D1Database, vapid: VapidKeys, now: number): Promise<{ daily: number; season: number }> {
  const out = { daily: 0, season: 0 };
  const users = await activePushUsers(db, now);
  if (!users.length) return out;

  // daily bonus: fire once per UTC day (first cron run after midnight wins the cooldown)
  const day = new Date(now).toISOString().slice(0, 10);
  for (const uid of users) {
    if (!(await cooldownOk(db, uid, 'daily', day, 20 * 60_60_000, now))) continue;
    out.daily += await sendPushToUser(db, fetch, vapid, uid, {
      title: 'Daily bonus 🪙',
      body: 'Your daily coins are ready — open the app to claim.',
      url: '/profile',
      tag: `daily-${day}`,
      type: 'daily',
    }, { ttl: DAY, urgency: 'normal', now });
  }

  // season ending: one reminder per season when < 3 days remain
  try {
    const { ensureSeason } = await import('../cred/seasons');
    const season = await ensureSeason(db, now);
    if (season.endsAt - now < 3 * DAY && season.endsAt > now) {
      for (const uid of users) {
        if (!(await cooldownOk(db, uid, 'season', season.id, 30 * DAY, now))) continue;
        out.season += await sendPushToUser(db, fetch, vapid, uid, {
          title: 'Season ending ⏳',
          body: `${season.name} ends in under 3 days — final push for rank!`,
          url: '/profile',
          tag: `season-${season.id}`,
          type: 'season',
        }, { ttl: 2 * DAY, urgency: 'normal', now });
      }
    }
  } catch (e) {
    console.error(JSON.stringify({ src: 'bwm.push', event: 'season-check-failed', error: String(e).slice(0, 120) }));
  }
  return out;
}

export function pushVapid(env: PushVapidEnv): VapidKeys | null {
  return vapidFromEnv(env);
}

/** Events the cred layer emits for push (achievements, rank-ups, completed challenges). */
export interface CredPushEvent {
  userId: string;
  type: 'achievement' | 'rankup' | 'challenge';
  /** achievement/challenge title, or division name for rankup */
  title: string;
  /** 'team' | 'cutthroat' for rankup */
  kind?: string;
  /** rankup only: the player's new rating after the game (drives the push copy) */
  rating?: number;
}

/** Dispatch one cred push event to its notify helper. Never throws. */
export async function sendCredPushEvent(db: D1Database, vapid: VapidKeys, ev: CredPushEvent, now: number): Promise<number> {
  try {
    if (ev.type === 'achievement') return notifyAchievement(db, vapid, ev.userId, ev.title, now);
    if (ev.type === 'rankup') return notifyRankup(db, vapid, ev.userId, ev.title, ev.kind ?? 'team', ev.rating, now);
    return notifyChallenge(db, vapid, ev.userId, ev.title, now);
  } catch (e) {
    console.error(JSON.stringify({ src: 'bwm.push', event: 'cred-push-failed', error: String(e).slice(0, 120) }));
    return 0;
  }
}
export type { VapidKeys, NotifType };
