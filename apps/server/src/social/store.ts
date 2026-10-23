/** D1 access for the Social hub (friends, blocks, DMs, reports, settings, ratings). Pure async functions over D1. */
import { isFriendActivity, type ChatReactions, type DmLine, type FriendActivity, type FriendRef, type FriendsState, type ReplyRef, type SocialSettings } from '@spades/protocol';
import { usersByKeys } from './mentions';

export const pair = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);
const uidOf = (pid: string) => (pid.startsWith('u:') ? pid.slice(2) : null);
export { uidOf };

export const DEFAULT_SETTINGS: SocialSettings = { appearOffline: false, friendsOnlyInvites: false, hideLocation: false };

export class SocialStore {
  constructor(private db: D1Database) {}

  async settings(uid: string): Promise<SocialSettings> {
    const r = await this.db.prepare('SELECT appear_offline, friends_only_invites, hide_location FROM social_settings WHERE user_id = ?').bind(uid)
      .first<{ appear_offline: number; friends_only_invites: number; hide_location: number }>();
    return r ? { appearOffline: !!r.appear_offline, friendsOnlyInvites: !!r.friends_only_invites, hideLocation: !!r.hide_location } : { ...DEFAULT_SETTINGS };
  }

  async saveSettings(uid: string, s: SocialSettings, now: number): Promise<void> {
    await this.db.prepare(`INSERT INTO social_settings (user_id, appear_offline, friends_only_invites, hide_location, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET appear_offline = excluded.appear_offline, friends_only_invites = excluded.friends_only_invites, hide_location = excluded.hide_location, updated_at = excluded.updated_at`)
      .bind(uid, s.appearOffline ? 1 : 0, s.friendsOnlyInvites ? 1 : 0, s.hideLocation ? 1 : 0, now).run();
  }

  /** coarse region for Local leaderboards (only written, never shown when the user hides it) */
  async saveRegion(uid: string, region: string | null, now: number): Promise<void> {
    if (!region) return;
    await this.db.prepare(`INSERT INTO social_settings (user_id, region, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET region = excluded.region`).bind(uid, region, now).run();
  }

  async ratings(uid: string): Promise<{ team?: number; cutthroat?: number }> {
    const rows = (await this.db.prepare('SELECT kind, elo FROM ratings WHERE user_id = ?').bind(uid).all<{ kind: string; elo: number }>()).results;
    const out: { team?: number; cutthroat?: number } = {};
    for (const r of rows) if (r.kind === 'team' || r.kind === 'cutthroat') out[r.kind] = Math.round(r.elo);
    return out;
  }

  async userExists(uid: string): Promise<string | null> {
    const r = await this.db.prepare('SELECT username FROM users WHERE id = ?').bind(uid).first<{ username: string | null }>();
    return r?.username ?? null;
  }

  /**
   * Record hub-seen activity for the last-online line (migration 0025).
   * The hub calls this throttled (~1/min/user); the upsert keeps the newest.
   */
  async stampLastSeen(uid: string, at: number): Promise<void> {
    await this.db.prepare(`INSERT INTO last_seen (user_id, at) VALUES (?, ?)
      ON CONFLICT (user_id) DO UPDATE SET at = excluded.at WHERE excluded.at > last_seen.at`)
      .bind(uid, at).run();
  }

  /**
   * Record a friend-activity report (migration 0028). Written by the hub
   * (derived from the socket's live status) and by POST /api/social/presence
   * (the client's own report) — one upsert: the latest report wins (>= so a
   * same-millisecond activity change is never swallowed; a genuinely older
   * report still can't overwrite a newer one). Callers validate the value.
   */
  async stampPresence(uid: string, activity: FriendActivity, at: number): Promise<void> {
    await this.db.prepare(`INSERT INTO presence (user_id, activity, at) VALUES (?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET activity = excluded.activity, at = excluded.at WHERE excluded.at >= presence.at`)
      .bind(uid, activity, at).run();
  }

  async friendsState(uid: string): Promise<FriendsState> {
    const rows = (await this.db.prepare(`SELECT f.a, f.b, f.status, f.requested_by, f.created_at, u.id AS oid, u.username, ls.at AS last_seen, p.activity AS p_activity, p.at AS p_at FROM friends f
      JOIN users u ON u.id = CASE WHEN f.a = ? THEN f.b ELSE f.a END LEFT JOIN last_seen ls ON ls.user_id = u.id LEFT JOIN presence p ON p.user_id = u.id WHERE f.a = ? OR f.b = ?`).bind(uid, uid, uid)
      .all<{ status: string; requested_by: string; created_at: number; oid: string; username: string | null; last_seen: number | null; p_activity: string | null; p_at: number | null }>()).results;
    const blocked = (await this.db.prepare('SELECT u.id, u.username, b.created_at FROM blocks b JOIN users u ON u.id = b.blocked WHERE b.blocker = ?').bind(uid)
      .all<{ id: string; username: string | null; created_at: number }>()).results;
    const muted = (await this.db.prepare('SELECT u.id, u.username, m.created_at FROM mutes m JOIN users u ON u.id = m.muted WHERE m.muter = ?').bind(uid)
      .all<{ id: string; username: string | null; created_at: number }>()).results;
    const ref = (id: string, name: string | null, since?: number): FriendRef => ({ id: `u:${id}`, name: name ?? 'Player', ...(since ? { since } : {}) });
    const byName = (a: FriendRef, b: FriendRef) => a.name.localeCompare(b.name);
    return {
      // lastSeen + presence ride ONLY confirmed-friend refs, in the owner's
      // own state: pending (either direction) and blocked refs never carry
      // them. A presence row whose stored activity doesn't parse (written
      // by nothing current — the writers validate) attaches nothing rather
      // than junk; freshness is the client's call (PRESENCE_STALE_MS).
      friends: rows.filter((r) => r.status === 'friends').map((r) => ({
        ...ref(r.oid, r.username, r.created_at),
        ...(r.last_seen ? { lastSeen: r.last_seen } : {}),
        ...(isFriendActivity(r.p_activity) && r.p_at ? { presence: { activity: r.p_activity, at: r.p_at } } : {}),
      })).sort(byName),
      incoming: rows.filter((r) => r.status === 'pending' && r.requested_by !== uid).map((r) => ref(r.oid, r.username, r.created_at)).sort(byName),
      outgoing: rows.filter((r) => r.status === 'pending' && r.requested_by === uid).map((r) => ref(r.oid, r.username, r.created_at)).sort(byName),
      blocked: blocked.map((r) => ref(r.id, r.username, r.created_at)).sort(byName),
      // the owner's own mutes (migration 0030): one-directional, private —
      // they ride ONLY the muter's own FriendsState, like blocked.
      muted: muted.map((r) => ref(r.id, r.username, r.created_at)).sort(byName),
    };
  }

  /** Resolve @mention username_keys to account ids (users.username_key). */
  async usersByKeys(keys: string[]): Promise<Map<string, string>> {
    return usersByKeys(this.db, keys);
  }

  /** uids this user has muted (one-directional; migration 0030) */
  async muteSet(uid: string): Promise<Set<string>> {
    const rows = (await this.db.prepare('SELECT muted FROM mutes WHERE muter = ?').bind(uid).all<{ muted: string }>()).results;
    return new Set(rows.map((r) => r.muted));
  }

  /** mute / unmute a player. Returns an error message, or null when done. */
  async setMute(uid: string, other: string, on: boolean, now: number): Promise<string | null> {
    if (uid === other) return "That's you.";
    if (!(await this.db.prepare('SELECT 1 AS ok FROM users WHERE id = ?').bind(other).first())) return 'No such player.';
    if (on) await this.db.prepare('INSERT OR IGNORE INTO mutes (muter, muted, created_at) VALUES (?, ?, ?)').bind(uid, other, now).run();
    else await this.db.prepare('DELETE FROM mutes WHERE muter = ? AND muted = ?').bind(uid, other).run();
    return null;
  }

  async areFriends(x: string, y: string): Promise<boolean> {
    const [a, b] = pair(x, y);
    return !!(await this.db.prepare("SELECT 1 AS ok FROM friends WHERE a = ? AND b = ? AND status = 'friends'").bind(a, b).first());
  }

  /** users either blocking or blocked by uid */
  async blockSet(uid: string): Promise<Set<string>> {
    const rows = (await this.db.prepare('SELECT blocked AS o FROM blocks WHERE blocker = ? UNION SELECT blocker AS o FROM blocks WHERE blocked = ?').bind(uid, uid).all<{ o: string }>()).results;
    return new Set(rows.map((r) => r.o));
  }

  /** returns an error message, or null when done */
  async friendOp(uid: string, op: 'request' | 'accept' | 'decline' | 'remove' | 'block' | 'unblock', other: string, now: number): Promise<string | null> {
    if (uid === other) return "That's you.";
    if (!(await this.db.prepare('SELECT 1 AS ok FROM users WHERE id = ?').bind(other).first())) return 'No such player.';
    const [a, b] = pair(uid, other);
    const row = await this.db.prepare('SELECT status, requested_by FROM friends WHERE a = ? AND b = ?').bind(a, b).first<{ status: string; requested_by: string }>();
    const blocks = await this.blockSet(uid);
    switch (op) {
      case 'request':
        if (blocks.has(other)) return "You can't add this player.";
        if (row?.status === 'friends') return null;
        if (row?.status === 'pending' && row.requested_by === other) {
          await this.db.prepare("UPDATE friends SET status = 'friends', created_at = ? WHERE a = ? AND b = ?").bind(now, a, b).run();
          return null;
        }
        if (row) return null;
        {
          const n = await this.db.prepare("SELECT COUNT(*) AS n FROM friends WHERE (a = ? OR b = ?) AND status = 'pending' AND requested_by = ?").bind(uid, uid, uid).first<{ n: number }>();
          if ((n?.n ?? 0) >= 100) return 'Too many pending requests.';
        }
        await this.db.prepare("INSERT INTO friends (a, b, status, requested_by, created_at) VALUES (?, ?, 'pending', ?, ?)").bind(a, b, uid, now).run();
        return null;
      case 'accept':
        if (!row || row.status !== 'pending' || row.requested_by !== other) return 'No request to accept.';
        await this.db.prepare("UPDATE friends SET status = 'friends', created_at = ? WHERE a = ? AND b = ?").bind(now, a, b).run();
        return null;
      case 'decline':
      case 'remove':
        await this.db.prepare('DELETE FROM friends WHERE a = ? AND b = ?').bind(a, b).run();
        return null;
      case 'block':
        await this.db.batch([
          this.db.prepare('DELETE FROM friends WHERE a = ? AND b = ?').bind(a, b),
          this.db.prepare('INSERT OR IGNORE INTO blocks (blocker, blocked, created_at) VALUES (?, ?, ?)').bind(uid, other, now),
        ]);
        return null;
      case 'unblock':
        await this.db.prepare('DELETE FROM blocks WHERE blocker = ? AND blocked = ?').bind(uid, other).run();
        return null;
    }
  }

  async sendDm(from: string, to: string, text: string, now: number, reply?: ReplyRef): Promise<DmLine> {
    const [a, b] = pair(from, to);
    const r = await this.db.prepare('INSERT INTO dms (a, b, sender, recipient, text, at, reply) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
      .bind(a, b, from, to, text, now, reply ? JSON.stringify(reply) : null).first<{ id: number }>();
    // keep each conversation bounded (last 500)
    await this.db.prepare('DELETE FROM dms WHERE a = ? AND b = ? AND id <= (SELECT id FROM dms WHERE a = ? AND b = ? ORDER BY id DESC LIMIT 1 OFFSET 500)').bind(a, b, a, b).run();
    return { id: r!.id, from: `u:${from}`, to: `u:${to}`, text, at: now, ...(reply ? { reply } : {}) };
  }

  /**
   * Resolve a reply target inside ONE conversation: the line must sit between exactly
   * `uid` and `other` (the pair columns), so a reply can only ever quote a line both
   * participants already share — an id from another conversation (or a third party's
   * DM) resolves to null and the message posts without a reference.
   */
  async dmReplyTarget(uid: string, other: string, id: number): Promise<{ id: number; sender: string; text: string } | null> {
    const [a, b] = pair(uid, other);
    const r = await this.db.prepare('SELECT id, sender, text FROM dms WHERE id = ? AND a = ? AND b = ? AND deleted = 0').bind(id, a, b)
      .first<{ id: number; sender: string; text: string }>();
    return r ?? null;
  }

  async dmHistory(uid: string, other: string, before: number | undefined, limit: number): Promise<DmLine[]> {
    const [a, b] = pair(uid, other);
    const rows = (await this.db.prepare(`SELECT id, sender, recipient, text, at, read_at, reactions, reply FROM dms WHERE a = ? AND b = ? AND deleted = 0 AND id < ? ORDER BY id DESC LIMIT ?`)
      .bind(a, b, before ?? Number.MAX_SAFE_INTEGER, limit).all<{ id: number; sender: string; recipient: string; text: string; at: number; read_at: number | null; reactions: string | null; reply: string | null }>()).results;
    return rows.reverse().map((r) => ({ id: r.id, from: `u:${r.sender}`, to: `u:${r.recipient}`, text: r.text, at: r.at, ...(r.read_at ? { read: true } : {}), ...(r.reactions ? { reactions: JSON.parse(r.reactions) as ChatReactions } : {}), ...(r.reply ? { reply: JSON.parse(r.reply) as ReplyRef } : {}) }));
  }

  /**
   * One DM line for reactions — only when `uid` is a participant (sender or recipient).
   * Anyone else gets null, indistinguishable from a nonexistent line: reactions can never
   * leak a DM to a third party.
   */
  async dmLineFor(uid: string, id: number): Promise<{ sender: string; recipient: string; reactions: ChatReactions } | null> {
    const r = await this.db.prepare('SELECT sender, recipient, reactions FROM dms WHERE id = ? AND deleted = 0 AND (sender = ? OR recipient = ?)').bind(id, uid, uid)
      .first<{ sender: string; recipient: string; reactions: string | null }>();
    if (!r) return null;
    let reactions: ChatReactions = {};
    try { reactions = r.reactions ? (JSON.parse(r.reactions) as ChatReactions) : {}; } catch { reactions = {}; }
    return { sender: r.sender, recipient: r.recipient, reactions };
  }

  /** replace a DM line's reaction map (persisted, so both participants see it on history load) */
  async setDmReactions(id: number, reactions: ChatReactions): Promise<boolean> {
    const r = await this.db.prepare('UPDATE dms SET reactions = ? WHERE id = ?').bind(Object.keys(reactions).length ? JSON.stringify(reactions) : null, id).run();
    return (r.meta?.changes ?? 0) > 0;
  }

  async markRead(uid: string, other: string, now: number): Promise<void> {
    await this.db.prepare('UPDATE dms SET read_at = ? WHERE recipient = ? AND sender = ? AND read_at IS NULL').bind(now, uid, other).run();
  }

  async unread(uid: string): Promise<Record<string, number>> {
    // muted senders contribute NO unread count (migration 0030): their DMs
    // still arrive and read normally — they just never badge.
    const rows = (await this.db.prepare(`SELECT sender, COUNT(*) AS n FROM dms WHERE recipient = ? AND read_at IS NULL AND deleted = 0
      AND sender NOT IN (SELECT muted FROM mutes WHERE muter = ?) GROUP BY sender`).bind(uid, uid).all<{ sender: string; n: number }>()).results;
    return Object.fromEntries(rows.map((r) => [`u:${r.sender}`, r.n]));
  }

  async dmText(uid: string, id: number): Promise<{ text: string; sender: string } | null> {
    return this.db.prepare('SELECT text, sender FROM dms WHERE id = ? AND (sender = ? OR recipient = ?)').bind(id, uid, uid).first<{ text: string; sender: string }>();
  }

  async report(r: { reporter: string; target: string | null; kind: string; msgId: number | null; text: string | null; reason: string | null; at: number }): Promise<void> {
    await this.db.prepare('INSERT INTO reports (reporter, target_user, kind, msg_id, text, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(r.reporter, r.target, r.kind, r.msgId, r.text, r.reason, r.at).run();
  }
}
