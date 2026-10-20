/**
 * The Social hub: everything the Social Durable Object does minus the Cloudflare plumbing (unit-testable with
 * fake sockets + sql.js D1). One hub for the whole site.
 *  - presence: in memory, rebuilt from websocket attachments after hibernation (no storage writes)
 *  - invites: in memory, 60 s expiry
 *  - global chat: the DO's own SQLite (last ~200), via GlobalLog
 *  - friends / blocks / DMs / reports / settings: D1 (SocialStore)
 */
import {
  type ChatReactions, type FriendsState, type InviteMsg, type OpenTable, type PresenceEntry, type PresenceStatus, type ReplyRef, type SocialChatLine, type SocialClientMsg, type SocialServerMsg, type SocialSettings,
  GUEST_SESSION, PRESENCE_TTL_MS, SOCIAL_LIMITS, blockLinks, cleanName, cleanText, dmReplySnapshot, maskProfanity, parseSocialMsg, replySnapshot, stalePresence, toggleReaction,
} from '@spades/protocol';
import { isProfane } from '../auth/username';
import { DEFAULT_SETTINGS, SocialStore, uidOf } from './store';

/** What survives hibernation on each socket. */
export interface ConnAtt {
  pid: string;
  name: string;
  guest: boolean;
  status: PresenceStatus;
  admin?: boolean;
  hidden?: boolean;
  friendsOnly?: boolean;
  rating?: { team?: number; cutthroat?: number };
  /** last social message (newest status wins across a user's tabs; old sessions are pruned) */
  at: number;
}

export interface GlobalLog {
  add(line: Omit<SocialChatLine, 'id'>): SocialChatLine;
  list(n: number): SocialChatLine[];
  get(id: number): SocialChatLine | null;
  /** replace a line's reaction map (persisted, so late joiners see it) */
  setReactions(id: number, reactions: ChatReactions): boolean;
  del(id: number): boolean;
}

/** Release 10: Open tables, persisted so they survive the hub's hibernation */
export interface TableLog {
  put(t: OpenTable): void;
  del(code: string): void;
  list(): OpenTable[];
}
/** an entry not refreshed for this long is dropped (a table DO that vanished without reporting) */
export const TABLE_TTL_MS = 3 * 3600_000;

/** Public table codes that ended or were unlisted. Kept so a hibernated hub still knows. */
export interface EndedLog {
  add(code: string): void;
  del(code: string): void;
  list(): string[];
}

export interface HubIO {
  now(): number;
  send(cid: string, msg: SocialServerMsg): void;
  /** persist a socket's attachment (DO: ws.serializeAttachment) */
  save(cid: string, att: ConnAtt): void;
  global: GlobalLog;
  tables?: TableLog;
  ended?: EndedLog;
  /**
   * false when this socket is already gone. Omit to treat every conn as connected.
   * A disconnected session is dropped even if its attachment was restored.
   */
  connected?(cid: string): boolean;
  /** close and forget a socket the hub dropped */
  drop?(cid: string): void;
  /**
   * Is this table still a live room? 'over' / 'gone' drop its presence rows.
   * 'live' keeps them (a private table is live and never listed). null = don't know yet.
   */
  tablePhase?(code: string): Promise<'live' | 'over' | 'gone' | null>;
  /** expire invites etc. (in-memory timer) */
  later(ms: number, f: () => void): void;
  randomId(): string;
  /**
   * Push hooks (Release 13). The DO implements these with its own ctx.waitUntil.
   * onOnline: a signed-in user's first socket attached (fresh online transition).
   * onOfflineInvite: an invite was stored for a user with no live socket.
   */
  onOnline?(uid: string, name: string): void;
  onOfflineInvite?(toUid: string, fromName: string, code: string, mode: string | null): void;
}

export interface Ident { uid?: string; name: string; admin?: boolean; /** stable guest session suffix */ gid?: string }

/**
 * Two guests who picked the same display name need different labels. The same session keeps its own name
 * (callers omit that session from `taken`).
 */
export function uniqueGuestName(wanted: string, taken: Iterable<string>): string {
  const base = (wanted.trim() || 'Guest').slice(0, 20);
  const used = new Set<string>();
  for (const n of taken) used.add(n.trim().toLowerCase());
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; n < 100; n++) {
    const suffix = ` ${n}`;
    const stem = base.slice(0, Math.max(1, 20 - suffix.length)).trimEnd() || 'Guest';
    const candidate = `${stem}${suffix}`.slice(0, 20);
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base.slice(0, 16)} 99`.slice(0, 20);
}

interface Invite extends InviteMsg { to: string }

/** chat masking: the table filter's word list + the username filter (slurs anywhere in a word, l33t) per word */
export function maskChat(s: string): string {
  return maskProfanity(s).replace(/[\p{L}\p{N}@$!|]+/gu, (w) => (w.length >= 3 && isProfane(w) ? w[0] + '*'.repeat(w.length - 1) : w));
}

function slide(times: number[], now: number, l: { n: number; windowMs: number }): boolean {
  while (times.length && times[0]! <= now - l.windowMs) times.shift();
  if (times.length >= l.n) return false;
  return true;
}

export class Hub {
  private conns = new Map<string, ConnAtt>();
  private blocks = new Map<string, Set<string>>(); // uid → uids blocking/blocked
  private invites = new Map<string, Invite>();
  private windows = new Map<string, number[]>();
  /** hidden from the players list until they send a status that is not an ended table */
  private quiet = new Set<string>();
  private endedCodes = new Set<string>();
  private phaseCache = new Map<string, { at: number; phase: 'live' | 'over' | 'gone' }>();
  private store: SocialStore | null;

  constructor(private io: HubIO, private db: D1Database | undefined) {
    this.store = db ? new SocialStore(db) : null;
    for (const code of io.ended?.list() ?? []) this.endedCodes.add(code);
  }

  /* ------------------------------------------------------------- connections */

  /** a socket that survived hibernation */
  async restore(cid: string, att: ConnAtt): Promise<void> {
    this.conns.set(cid, att);
    const uid = uidOf(att.pid);
    if (uid && !this.blocks.has(uid) && this.store) this.blocks.set(uid, await this.store.blockSet(uid));
  }

  async open(cid: string, who: Ident): Promise<void> {
    const now = this.io.now();
    const s = this.store;
    let att: ConnAtt;
    let friends: FriendsState | null = null;
    let settings: SocialSettings | null = null;
    let unread: Record<string, number> = {};
    if (who.uid && s) {
      const [st, rating, fr, un, bl] = await Promise.all([s.settings(who.uid), s.ratings(who.uid), s.friendsState(who.uid), s.unread(who.uid), s.blockSet(who.uid)]);
      settings = st; friends = fr; unread = un;
      this.blocks.set(who.uid, bl);
      att = { pid: `u:${who.uid}`, name: who.name, guest: false, status: { kind: 'online' }, admin: !!who.admin, hidden: st.appearOffline, friendsOnly: st.friendsOnlyInvites, rating, at: now };
    } else {
      // One browser shares one guest id (localStorage). A second tab or a reconnect is the same player, not a second row.
      const pid = who.gid && GUEST_SESSION.test(who.gid) ? `g:${who.gid}` : `g:${this.io.randomId().slice(0, 10)}`;
      const existing = this.entry(pid);
      const taken: string[] = [];
      const seen = new Set<string>();
      for (const a of this.conns.values()) {
        if (!a.guest || a.pid === pid || seen.has(a.pid)) continue;
        seen.add(a.pid);
        taken.push(a.name);
      }
      const name = existing?.name ?? uniqueGuestName(cleanName(who.name, 20) || 'Guest', taken);
      att = { pid, name, guest: true, status: { kind: 'online' }, at: now };
    }
    const wasOnline = this.online(att.pid);
    // a second tab keeps the newest status of the first, unless that status is a table that already ended
    const prev = this.entry(att.pid);
    if (prev) att.status = this.endedClaim(prev.status) ? { kind: 'online' } : prev.status;
    this.quiet.delete(att.pid);
    this.conns.set(cid, att);
    this.io.save(cid, att);
    await this.prune(true);
    const me = this.entry(att.pid)!;
    const users = this.visibleList(att.pid);
    const global = this.io.global.list(SOCIAL_LIMITS.globalSend)
      .filter((l) => !this.hiddenBetween(att.pid, l.from))
      // same rule for quotes inside kept lines: hidden from the quoted author → no quote
      .map((l) => (l.reply && this.hiddenBetween(att.pid, l.reply.fromId) ? { ...l, reply: undefined } : l));
    this.io.send(cid, { t: 'hello', you: me, admin: !!att.admin, users, global, friends, settings, unread, tables: this.openTables() });
    if (!wasOnline && !this.quiet.has(att.pid)) this.broadcastEntry(att.pid);
    // Release 13: fresh online transition — friend-online pushes + pending offline invites.
    if (who.uid && !wasOnline) {
      this.io.onOnline?.(who.uid, att.name);
      await this.deliverOfflineInvites(cid, who.uid);
    }
  }

  /** Send any unexpired offline invites as live toasts, then clear them. */
  private async deliverOfflineInvites(cid: string, uid: string): Promise<void> {
    const db = this.db;
    if (!db) return;
    const now = this.io.now();
    const rows = await db.prepare(`SELECT id, from_uid AS fromUid, from_name AS fromName, code, mode, seat, expires_at AS expiresAt
      FROM offline_invites WHERE to_uid = ? AND expires_at > ?`).bind(uid, now)
      .all<{ id: string; fromUid: string; fromName: string; code: string; mode: string | null; seat: number | null; expiresAt: number }>();
    for (const r of rows.results) {
      this.io.send(cid, {
        t: 'invite',
        invite: {
          id: r.id, from: `u:${r.fromUid}`, fromName: r.fromName, code: r.code,
          ...(r.mode ? { mode: r.mode } : {}), ...(r.seat != null ? { seat: r.seat } : {}), expiresAt: r.expiresAt,
        },
      });
    }
    if (rows.results.length) await db.prepare('DELETE FROM offline_invites WHERE to_uid = ?').bind(uid).run();
    await db.prepare('DELETE FROM offline_invites WHERE expires_at <= ?').bind(now).run(); // opportunistic cleanup
  }

  /* ------------------------------------------------------------- open tables (Release 10) */

  openTables(): OpenTable[] {
    const log = this.io.tables;
    if (!log) return [];
    const now = this.io.now();
    const out: OpenTable[] = [];
    for (const t of log.list()) { if (now - t.at > TABLE_TTL_MS) log.del(t.code); else out.push(t); }
    return out.sort((a, b) => (a.status === 'waiting' ? 0 : 1) - (b.status === 'waiting' ? 0 : 1) || b.open - a.open || b.at - a.at).slice(0, 100);
  }

  /** a table DO reports its entry (null = unlisted) → everyone online gets the change */
  tableUpdate(code: string, t: OpenTable | null): void {
    const log = this.io.tables;
    if (!log) return;
    const had = log.list().some((row) => row.code === code);
    if (t && t.status !== 'over') {
      this.clearEnded(code);
      log.put({ ...t, code });
    } else if (t) {
      log.put({ ...t, code });
      this.markEnded(code);
      this.retire(code);
    } else {
      log.del(code);
      // A private table is never listed, so its null report must not erase the people sitting there.
      if (had) {
        this.markEnded(code);
        this.retire(code);
      }
    }
    const msg: SocialServerMsg = t ? { t: 'tables', up: [{ ...t, code }] } : { t: 'tables', gone: [code] };
    for (const c of this.conns.keys()) this.io.send(c, msg);
  }

  close(cid: string): void {
    this.removeConn(cid);
  }

  /** Release 9b: server-side notice to accounts (tournament check-in / match ready); returns how many tabs got it */
  notify(uids: string[], n: { text: string; code?: string; seat?: number; tid?: string; cid?: string }): number {
    let sent = 0;
    for (const uid of new Set(uids)) for (const c of this.connsOf(`u:${uid}`)) { this.io.send(c, { t: 'notice', ...n }); sent++; }
    return sent;
  }

  /* ---------------------------------------------------------------- presence */

  private online(pid: string): boolean {
    for (const a of this.conns.values()) if (a.pid === pid) return true;
    return false;
  }

  private connsOf(pid: string): string[] {
    return [...this.conns].filter(([, a]) => a.pid === pid).map(([c]) => c);
  }

  /** a user's merged entry across their tabs (newest status) */
  private entry(pid: string): PresenceEntry | null {
    let best: ConnAtt | null = null;
    for (const a of this.conns.values()) if (a.pid === pid && (!best || a.at >= best.at)) best = a;
    if (!best) return null;
    return { id: pid, name: best.name, guest: best.guest, status: best.status, at: best.at, ...(best.rating && Object.keys(best.rating).length ? { rating: best.rating } : {}) };
  }

  private isHidden(pid: string): boolean {
    for (const a of this.conns.values()) if (a.pid === pid) return !!a.hidden;
    return false;
  }

  /** blocked either way (accounts only) */
  private hiddenBetween(viewer: string, other: string): boolean {
    const v = uidOf(viewer), o = uidOf(other);
    if (!v || !o || v === o) return false;
    return !!this.blocks.get(v)?.has(o) || !!this.blocks.get(o)?.has(v);
  }

  private visibleTo(viewer: string, pid: string): boolean {
    if (viewer === pid) return true;
    return !this.isHidden(pid) && !this.hiddenBetween(viewer, pid);
  }

  private visibleList(viewer: string): PresenceEntry[] {
    const seen = new Set<string>();
    const out: PresenceEntry[] = [];
    const now = this.io.now();
    const tables = this.openTables();
    for (const a of this.conns.values()) {
      if (seen.has(a.pid)) continue;
      seen.add(a.pid);
      if (a.pid !== viewer && this.quiet.has(a.pid)) continue;
      if (!this.visibleTo(viewer, a.pid)) continue;
      const e = this.entry(a.pid)!;
      if (a.pid !== viewer && stalePresence(e, tables, this.endedCodes, now)) continue;
      out.push(e);
    }
    return out;
  }

  /** tell everyone (who may see it) about pid's current entry; those who may not see it get 'gone' */
  private broadcastEntry(pid: string): void {
    if (this.quiet.has(pid)) {
      this.broadcastGone(pid);
      return;
    }
    const e = this.entry(pid);
    for (const [cid, v] of this.conns) {
      if (!e || (v.pid !== pid && stalePresence(e, this.openTables(), this.endedCodes, this.io.now()))) this.io.send(cid, { t: 'pres', gone: [pid] });
      else if (this.visibleTo(v.pid, pid)) this.io.send(cid, { t: 'pres', up: [e] });
      else if (v.pid !== pid) this.io.send(cid, { t: 'pres', gone: [pid] });
    }
  }

  private broadcastGone(pid: string): void {
    for (const [cid, v] of this.conns) if (v.pid !== pid) this.io.send(cid, { t: 'pres', gone: [pid] });
  }

  /** count of distinct visible players (for tests / health) */
  onlineCount(): number {
    return new Set([...this.conns.values()].map((a) => a.pid)).size;
  }

  /**
   * Drop presence for ended tables, disconnected sockets, and sessions with no social message
   * inside PRESENCE_TTL_MS. `lookup` asks the table DO about codes that are no longer listed
   * (a room that died without a final report). Do not call that from the DO constructor.
   */
  async prune(lookup = false): Promise<void> {
    const now = this.io.now();
    for (const [cid, a] of [...this.conns]) {
      const dead = this.io.connected?.(cid) === false;
      const old = now - a.at > PRESENCE_TTL_MS;
      if (!dead && !old) continue;
      this.io.drop?.(cid);
      this.removeConn(cid);
    }
    for (const t of this.openTables()) if (t.status === 'over') this.markEnded(t.code);
    if (lookup && this.io.tablePhase) {
      const need = new Set<string>();
      for (const a of this.conns.values()) {
        const code = a.status.code;
        if (!code || a.status.offline) continue;
        if (a.status.kind !== 'table' && a.status.kind !== 'lobby') continue;
        if (this.endedCodes.has(code)) continue;
        const listed = this.openTables().find((t) => t.code === code);
        if (listed && listed.status !== 'over') continue;
        need.add(code);
      }
      for (const code of need) {
        const hit = this.phaseCache.get(code);
        let phase = hit && now - hit.at < 60_000 ? hit.phase : null;
        if (!hit || now - hit.at >= 60_000) {
          phase = await this.io.tablePhase(code);
          if (phase) this.phaseCache.set(code, { at: now, phase });
        }
        if (phase === 'over' || phase === 'gone') this.markEnded(code);
      }
    }
    for (const code of this.endedCodes) this.retire(code);
  }

  private endedClaim(status: PresenceStatus): boolean {
    if (status.offline || !status.code) return false;
    if (status.kind !== 'table' && status.kind !== 'lobby') return false;
    if (this.endedCodes.has(status.code)) return true;
    return this.openTables().some((t) => t.code === status.code && t.status === 'over');
  }

  private markEnded(code: string): void {
    if (this.endedCodes.has(code)) return;
    this.endedCodes.add(code);
    this.io.ended?.add(code);
  }

  private clearEnded(code: string): void {
    if (!this.endedCodes.delete(code)) return;
    this.io.ended?.del(code);
    this.phaseCache.delete(code);
  }

  /** Take an ended table's rows off the list. A live socket stays up, hidden until it sends a real status. */
  private retire(code: string): void {
    const pids = new Set<string>();
    for (const [cid, a] of this.conns) {
      if (a.status.offline || a.status.code !== code) continue;
      if (a.status.kind !== 'table' && a.status.kind !== 'lobby') continue;
      a.status = { kind: 'online' };
      this.io.save(cid, a);
      pids.add(a.pid);
    }
    for (const pid of pids) {
      if (this.quiet.has(pid)) continue;
      this.quiet.add(pid);
      this.broadcastGone(pid);
    }
  }

  private removeConn(cid: string): void {
    const att = this.conns.get(cid);
    if (!att) return;
    this.conns.delete(cid);
    if (this.online(att.pid)) {
      if (this.quiet.has(att.pid)) this.broadcastGone(att.pid);
      else this.broadcastEntry(att.pid);
      return;
    }
    this.quiet.delete(att.pid);
    this.broadcastGone(att.pid);
    for (const inv of [...this.invites.values()]) if (inv.to === att.pid || inv.from === att.pid) this.dropInvite(inv, 'cancelled');
  }

  /* ---------------------------------------------------------------- messages */

  async message(cid: string, raw: string): Promise<void> {
    const att = this.conns.get(cid);
    if (!att) return;
    const msg = parseSocialMsg(raw);
    if (!msg) return this.err(cid, 'BAD_MESSAGE', 'Malformed message');
    try {
      await this.handle(cid, att, msg);
    } catch (e) {
      this.err(cid, 'SERVER', 'Something went wrong. Try again.');
      throw e;
    }
  }

  private rate(key: string, l: { n: number; windowMs: number }): boolean {
    const now = this.io.now();
    const w = this.windows.get(key) ?? [];
    if (!slide(w, now, l)) { this.windows.set(key, w); return false; }
    w.push(now);
    this.windows.set(key, w);
    return true;
  }

  private chatOk(cid: string, pid: string): boolean {
    const now = this.io.now();
    const burst = this.windows.get(`c:${pid}`) ?? [];
    const minute = this.windows.get(`m:${pid}`) ?? [];
    if (!slide(burst, now, SOCIAL_LIMITS.chatBurst) || !slide(minute, now, SOCIAL_LIMITS.chatMinute)) {
      this.windows.set(`c:${pid}`, burst); this.windows.set(`m:${pid}`, minute);
      this.err(cid, 'SLOW_DOWN', 'Slow down: too many messages.');
      return false;
    }
    burst.push(now); minute.push(now);
    this.windows.set(`c:${pid}`, burst); this.windows.set(`m:${pid}`, minute);
    return true;
  }

  private clean(text: string): string {
    return maskChat(blockLinks(cleanText(text, SOCIAL_LIMITS.chatMax)));
  }

  private async handle(cid: string, att: ConnAtt, msg: SocialClientMsg): Promise<void> {
    const now = this.io.now();
    // Any real message keeps the session. Status sets `at` itself, after the ended-table check.
    if (msg.t !== 'status') {
      att.at = now;
      const woke = this.quiet.delete(att.pid);
      this.io.save(cid, att);
      if (woke) this.broadcastEntry(att.pid);
    }
    const uid = uidOf(att.pid);
    const s = this.store;
    const needUser = (): boolean => {
      if (uid && s) return true;
      this.err(cid, 'SIGN_IN', 'Sign in to do that.');
      return false;
    };
    switch (msg.t) {
      case 'heartbeat': return; // `at` was refreshed above: this socket is alive; nothing else to do
      case 'status': {
        // every tab of the user reports; the newest wins
        att.at = now;
        if (this.endedClaim(msg.status)) {
          // Still announcing a table that ended (6SAQ2 next to a new session): keep the socket, hide the row.
          att.status = { kind: 'online' };
          this.io.save(cid, att);
          this.quiet.add(att.pid);
          this.broadcastGone(att.pid);
          return;
        }
        att.status = msg.status;
        this.quiet.delete(att.pid);
        this.io.save(cid, att);
        if (!att.hidden) this.broadcastEntry(att.pid);
        else for (const c of this.connsOf(att.pid)) this.io.send(c, { t: 'pres', up: [this.entry(att.pid)!] });
        return;
      }
      case 'settings': {
        if (!needUser()) return;
        const cur = await s!.settings(uid!);
        const next = { ...DEFAULT_SETTINGS, ...cur, ...msg.settings };
        await s!.saveSettings(uid!, next, now);
        for (const [c, a] of this.conns) if (a.pid === att.pid) { a.hidden = next.appearOffline; a.friendsOnly = next.friendsOnlyInvites; this.io.save(c, a); this.io.send(c, { t: 'settings', settings: next }); }
        this.broadcastEntry(att.pid);
        return;
      }
      case 'chat': {
        if (!needUser() || !this.chatOk(cid, att.pid)) return;
        const text = this.clean(msg.text);
        if (!text) return;
        // Resolve the reply reference now: the stored line carries a snapshot of the quoted
        // line, so the quote still renders if the original later scrolls out of the kept
        // history. An id that no longer resolves posts the message without a reference.
        let reply: ReplyRef | undefined;
        if (msg.replyTo !== undefined) {
          const orig = this.io.global.get(msg.replyTo);
          if (orig) reply = replySnapshot(orig);
        }
        const line = this.io.global.add({ from: att.pid, name: att.name, text, at: now, ...(att.admin ? { admin: true } : {}), ...(reply ? { reply } : {}) });
        for (const [c, v] of this.conns) {
          if (this.hiddenBetween(v.pid, att.pid)) continue;
          // a viewer blocked from the quoted author sees the reply, but not the quote
          const wire = line.reply && this.hiddenBetween(v.pid, line.reply.fromId) ? { ...line, reply: undefined } : line;
          this.io.send(c, { t: 'chat', line: wire });
        }
        return;
      }
      case 'del': {
        if (!att.admin) return this.err(cid, 'FORBIDDEN', 'Admins only.');
        if (this.io.global.del(msg.id)) for (const c of this.conns.keys()) this.io.send(c, { t: 'deleted', id: msg.id });
        return;
      }
      case 'react': {
        if (!needUser()) return;
        if (!this.rate(`re:${att.pid}`, SOCIAL_LIMITS.react)) return this.err(cid, 'SLOW_DOWN', 'Slow down.');
        const line = this.io.global.get(msg.id);
        if (!line) return;
        const reactions = toggleReaction(line.reactions, msg.emoji, att.pid);
        this.io.global.setReactions(msg.id, reactions);
        for (const [c, v] of this.conns) if (!this.hiddenBetween(v.pid, att.pid)) this.io.send(c, { t: 'chatReact', id: msg.id, reactions });
        return;
      }
      case 'dm': {
        if (!needUser()) return;
        const to = uidOf(msg.to);
        if (!to || to === uid) return this.err(cid, 'BAD_TARGET', 'You can only message signed-in players.');
        if (this.blocks.get(uid!)?.has(to) || (await s!.blockSet(uid!)).has(to)) return this.err(cid, 'BLOCKED', "You can't message this player.");
        const toName = await s!.userExists(to);
        if (toName === null) return this.err(cid, 'BAD_TARGET', 'No such player.');
        if (!this.chatOk(cid, att.pid)) return;
        const text = this.clean(msg.text);
        if (!text) return;
        // Resolve the reply reference inside this conversation only: the snapshot is
        // stored on the new line, so the quote renders after a refresh and even if the
        // original is pruned. An id that doesn't resolve (another conversation, deleted,
        // never existed) posts the DM without a reference.
        let reply: ReplyRef | undefined;
        if (msg.replyTo !== undefined) {
          const q = await s!.dmReplyTarget(uid!, to, msg.replyTo);
          if (q) reply = dmReplySnapshot({ id: q.id, from: `u:${q.sender}`, text: q.text }, q.sender === uid ? att.name : toName);
        }
        const line = await s!.sendDm(uid!, to, text, now, reply);
        for (const c of this.connsOf(msg.to)) this.io.send(c, { t: 'dm', line, name: att.name });
        for (const c of this.connsOf(att.pid)) this.io.send(c, { t: 'dm', line, name: toName });
        return;
      }
      case 'dmReact': {
        if (!needUser()) return;
        if (!this.rate(`re:${att.pid}`, SOCIAL_LIMITS.react)) return this.err(cid, 'SLOW_DOWN', 'Slow down.');
        // participant-scoped fetch: a DM nobody sent you is indistinguishable from one that doesn't exist
        const d = await s!.dmLineFor(uid!, msg.id);
        if (!d) return;
        const otherPid = `u:${d.sender === uid ? d.recipient : d.sender}`;
        if (this.hiddenBetween(att.pid, otherPid)) return; // a blocked pair can't interact, reactions included
        const reactions = toggleReaction(d.reactions, msg.emoji, att.pid);
        await s!.setDmReactions(msg.id, reactions);
        // both participants, live; `with` names the thread from each side's perspective
        for (const c of this.connsOf(otherPid)) this.io.send(c, { t: 'dmReact', id: msg.id, with: att.pid, reactions });
        for (const c of this.connsOf(att.pid)) this.io.send(c, { t: 'dmReact', id: msg.id, with: otherPid, reactions });
        return;
      }
      case 'dmHistory': {
        if (!needUser()) return;
        const other = uidOf(msg.with);
        if (!other) return;
        this.io.send(cid, { t: 'dmHistory', with: msg.with, lines: await s!.dmHistory(uid!, other, msg.before, SOCIAL_LIMITS.dmPage) });
        return;
      }
      case 'read': {
        if (!needUser()) return;
        const other = uidOf(msg.with);
        if (other) await s!.markRead(uid!, other, now);
        return;
      }
      case 'invite': return this.invite(cid, att, msg);
      case 'inviteReply': {
        let inv = this.invites.get(msg.id);
        // Release 13: fall back to a stored offline invite (delivered as a live toast on open()).
        if (!inv && this.db && uid) {
          const row = await this.db.prepare(`SELECT id, from_uid AS fromUid, from_name AS fromName, code, mode, seat, expires_at AS expiresAt
            FROM offline_invites WHERE id = ? AND to_uid = ? AND expires_at > ?`).bind(msg.id, uid, now)
            .first<{ id: string; fromUid: string; fromName: string; code: string; mode: string | null; seat: number | null; expiresAt: number }>();
          if (row) {
            await this.db.prepare('DELETE FROM offline_invites WHERE id = ?').bind(msg.id).run();
            inv = {
              id: row.id, from: `u:${row.fromUid}`, fromName: row.fromName, to: att.pid, code: row.code,
              ...(row.mode ? { mode: row.mode } : {}), ...(row.seat != null ? { seat: row.seat } : {}), expiresAt: row.expiresAt,
            };
          }
        }
        if (!inv || inv.to !== att.pid) return this.err(cid, 'INVITE_GONE', 'That invite expired.');
        this.invites.delete(inv.id);
        for (const c of this.connsOf(inv.from)) this.io.send(c, { t: 'inviteReply', id: inv.id, by: att.pid, byName: att.name, accept: msg.accept });
        for (const c of this.connsOf(inv.to)) this.io.send(c, { t: 'inviteGone', id: inv.id, reason: msg.accept ? 'accepted' : 'declined' });
        return;
      }
      case 'friend': {
        if (!needUser()) return;
        const other = uidOf(msg.to);
        if (!other) return this.err(cid, 'BAD_TARGET', 'Guests can’t be added as friends: ask them to sign in.');
        if (!this.rate(`f:${att.pid}`, SOCIAL_LIMITS.friendOps)) return this.err(cid, 'SLOW_DOWN', 'Slow down.');
        const e = await s!.friendOp(uid!, msg.op, other, now);
        if (e) return this.err(cid, 'FRIEND', e);
        if (msg.op === 'block' || msg.op === 'unblock') {
          this.blocks.set(uid!, await s!.blockSet(uid!));
          this.blocks.set(other, await s!.blockSet(other));
          for (const inv of [...this.invites.values()]) if ((inv.from === att.pid && inv.to === msg.to) || (inv.from === msg.to && inv.to === att.pid)) this.dropInvite(inv, 'cancelled');
          // each side sees (or stops seeing) the other
          for (const [a, b] of [[att.pid, msg.to], [msg.to, att.pid]] as const) {
            const e2 = this.entry(b);
            for (const c of this.connsOf(a)) this.io.send(c, e2 && this.visibleTo(a, b) ? { t: 'pres', up: [e2] } : { t: 'pres', gone: [b] });
          }
        }
        await this.pushFriends(uid!);
        await this.pushFriends(other);
        this.io.send(cid, { t: 'ok', what: `friend:${msg.op}` });
        return;
      }
      case 'report': {
        if (!needUser()) return;
        if (!this.rate(`r:${att.pid}`, { n: 10, windowMs: 3600_000 })) return this.err(cid, 'SLOW_DOWN', 'Too many reports: try later.');
        let text: string | null = null, target: string | null = msg.user ? uidOf(msg.user) : null;
        if (msg.kind === 'global' && msg.id !== undefined) {
          const l = this.io.global.get(msg.id);
          if (l) { text = l.text; target = uidOf(l.from); }
        } else if (msg.kind === 'dm' && msg.id !== undefined) {
          const d = await s!.dmText(uid!, msg.id);
          if (d) { text = d.text; target = d.sender; }
        }
        await s!.report({ reporter: uid!, target, kind: msg.kind, msgId: msg.id ?? null, text, reason: msg.reason ? cleanText(msg.reason, SOCIAL_LIMITS.reportReason) : null, at: now });
        this.io.send(cid, { t: 'ok', what: 'report' });
        return;
      }
    }
  }

  private async pushFriends(uid: string): Promise<void> {
    const cs = this.connsOf(`u:${uid}`);
    if (!cs.length || !this.store) return;
    const friends = await this.store.friendsState(uid);
    for (const c of cs) this.io.send(c, { t: 'friends', friends });
  }

  private async invite(cid: string, att: ConnAtt, msg: Extract<SocialClientMsg, { t: 'invite' }>): Promise<void> {
    const uid = uidOf(att.pid);
    if (!uid) return this.err(cid, 'SIGN_IN', 'Sign in to invite players.');
    if (msg.to === att.pid) return;
    const target = [...this.conns.values()].find((a) => a.pid === msg.to);
    // Release 13: inviting a signed-in user with no live socket stores an offline
    // invite (10 min) and pushes them. Appearing-offline / blocked still look offline.
    if (!target && uidOf(msg.to)) return this.inviteOffline(cid, att, uid, uidOf(msg.to)!, msg);
    // appearing offline / blocked either way look exactly like offline
    if (!target || target.hidden || this.hiddenBetween(att.pid, msg.to)) return this.err(cid, 'OFFLINE', 'That player is offline.');
    const toUid = uidOf(msg.to);
    if (target.friendsOnly && toUid && !(await this.store!.areFriends(uid, toUid))) return this.err(cid, 'FRIENDS_ONLY', `${target.name} only takes invites from friends.`);
    if (!this.rate(`i:${att.pid}`, SOCIAL_LIMITS.invites)) return this.err(cid, 'SLOW_DOWN', 'Too many invites: wait a minute.');
    for (const old of [...this.invites.values()]) if (old.from === att.pid && old.to === msg.to) this.dropInvite(old, 'cancelled');
    const now = this.io.now();
    const inv: Invite = { id: this.io.randomId().slice(0, 16), from: att.pid, fromName: att.name, to: msg.to, code: msg.code, ...(msg.mode ? { mode: msg.mode } : {}), ...(msg.seat !== undefined ? { seat: msg.seat } : {}), expiresAt: now + SOCIAL_LIMITS.inviteTtlMs };
    this.invites.set(inv.id, inv);
    const { to: _to, ...wire } = inv;
    for (const c of this.connsOf(msg.to)) this.io.send(c, { t: 'invite', invite: wire });
    this.io.send(cid, { t: 'inviteSent', id: inv.id, to: msg.to, expiresAt: inv.expiresAt });
    this.io.later(SOCIAL_LIMITS.inviteTtlMs + 50, () => { const cur = this.invites.get(inv.id); if (cur && this.io.now() >= cur.expiresAt) this.dropInvite(cur, 'expired'); });
  }

  private dropInvite(inv: Invite, reason: 'expired' | 'cancelled'): void {
    this.invites.delete(inv.id);
    for (const c of [...this.connsOf(inv.to), ...this.connsOf(inv.from)]) this.io.send(c, { t: 'inviteGone', id: inv.id, reason });
  }

  /**
   * Release 13: invite a signed-in user who has no live socket. Validates like the
   * online path (exists, not blocked either way, friends-only setting), stores the
   * invite for 10 minutes, and fires the push hook. Delivered as a live toast on
   * their next `open()`; accepted by code from the push itself.
   */
  private async inviteOffline(cid: string, att: ConnAtt, uid: string, toUid: string, msg: Extract<SocialClientMsg, { t: 'invite' }>): Promise<void> {
    const db = this.db;
    if (!db) return this.err(cid, 'OFFLINE', 'That player is offline.');
    const target = await db.prepare('SELECT username FROM users WHERE id = ?').bind(toUid).first<{ username: string }>();
    // unknown users and blocked pairs look exactly like offline
    if (!target) return this.err(cid, 'OFFLINE', 'That player is offline.');
    const blocked = await db.prepare('SELECT 1 AS ok FROM blocks WHERE (blocker = ? AND blocked = ?) OR (blocker = ? AND blocked = ?)')
      .bind(uid, toUid, toUid, uid).first();
    if (blocked) return this.err(cid, 'OFFLINE', 'That player is offline.');
    const settings = await db.prepare('SELECT friends_only_invites FROM social_settings WHERE user_id = ?').bind(toUid).first<{ friends_only_invites: number }>();
    if (settings?.friends_only_invites && !(await this.store!.areFriends(uid, toUid))) {
      return this.err(cid, 'FRIENDS_ONLY', `${target.username} only takes invites from friends.`);
    }
    if (!this.rate(`i:${att.pid}`, SOCIAL_LIMITS.invites)) return this.err(cid, 'SLOW_DOWN', 'Too many invites: wait a minute.');
    const now = this.io.now();
    const id = this.io.randomId().slice(0, 16);
    const expiresAt = now + 10 * 60_000;
    await db.prepare(`INSERT INTO offline_invites (id, from_uid, from_name, to_uid, code, mode, seat, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, uid, att.name, toUid, msg.code, msg.mode ?? null, msg.seat ?? null, now, expiresAt).run();
    this.io.send(cid, { t: 'inviteSent', id, to: msg.to, expiresAt });
    this.io.onOfflineInvite?.(toUid, att.name, msg.code, msg.mode ?? null);
  }

  private err(cid: string, code: string, message: string): void {
    this.io.send(cid, { t: 'error', code, message });
  }
}
