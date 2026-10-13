/**
 * The Social hub: everything the Social Durable Object does minus the Cloudflare plumbing (unit-testable with
 * fake sockets + sql.js D1). One hub for the whole site.
 *  - presence: in memory, rebuilt from websocket attachments after hibernation (no storage writes)
 *  - invites: in memory, 60 s expiry
 *  - global chat: the DO's own SQLite (last ~200), via GlobalLog
 *  - friends / blocks / DMs / reports / settings: D1 (SocialStore)
 */
import {
  type FriendsState, type InviteMsg, type OpenTable, type PresenceEntry, type PresenceStatus, type SocialChatLine, type SocialClientMsg, type SocialServerMsg, type SocialSettings,
  GUEST_SESSION, SOCIAL_LIMITS, blockLinks, cleanName, cleanText, maskProfanity, parseSocialMsg,
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
  /** when this socket last changed status (newest wins across a user's tabs) */
  at: number;
}

export interface GlobalLog {
  add(line: Omit<SocialChatLine, 'id'>): SocialChatLine;
  list(n: number): SocialChatLine[];
  get(id: number): SocialChatLine | null;
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

export interface HubIO {
  now(): number;
  send(cid: string, msg: SocialServerMsg): void;
  /** persist a socket's attachment (DO: ws.serializeAttachment) */
  save(cid: string, att: ConnAtt): void;
  global: GlobalLog;
  tables?: TableLog;
  /** expire invites etc. (in-memory timer) */
  later(ms: number, f: () => void): void;
  randomId(): string;
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
  private store: SocialStore | null;

  constructor(private io: HubIO, db: D1Database | undefined) {
    this.store = db ? new SocialStore(db) : null;
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
    // a second tab keeps the newest status of the first
    const prev = this.entry(att.pid);
    if (prev) att.status = prev.status;
    this.conns.set(cid, att);
    this.io.save(cid, att);
    const me = this.entry(att.pid)!;
    const users = this.visibleList(att.pid);
    const global = this.io.global.list(SOCIAL_LIMITS.globalSend).filter((l) => !this.hiddenBetween(att.pid, l.from));
    this.io.send(cid, { t: 'hello', you: me, admin: !!att.admin, users, global, friends, settings, unread, tables: this.openTables() });
    if (!wasOnline) this.broadcastEntry(att.pid);
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
    if (t) log.put({ ...t, code });
    else log.del(code);
    const msg: SocialServerMsg = t ? { t: 'tables', up: [{ ...t, code }] } : { t: 'tables', gone: [code] };
    for (const c of this.conns.keys()) this.io.send(c, msg);
  }

  close(cid: string): void {
    const att = this.conns.get(cid);
    if (!att) return;
    this.conns.delete(cid);
    if (this.online(att.pid)) { this.broadcastEntry(att.pid); return; } // another tab: its status wins now
    for (const [vcid, v] of this.conns) if (v.pid !== att.pid) this.io.send(vcid, { t: 'pres', gone: [att.pid] });
    // pending invites to/from them go away
    for (const inv of [...this.invites.values()]) if (inv.to === att.pid || inv.from === att.pid) this.dropInvite(inv, 'cancelled');
  }

  /** Release 9b: server-side notice to accounts (tournament check-in / match ready); returns how many tabs got it */
  notify(uids: string[], n: { text: string; code?: string; seat?: number; tid?: string }): number {
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
    return { id: pid, name: best.name, guest: best.guest, status: best.status, ...(best.rating && Object.keys(best.rating).length ? { rating: best.rating } : {}) };
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
    for (const a of this.conns.values()) {
      if (seen.has(a.pid)) continue;
      seen.add(a.pid);
      if (this.visibleTo(viewer, a.pid)) out.push(this.entry(a.pid)!);
    }
    return out;
  }

  /** tell everyone (who may see it) about pid's current entry; those who may not see it get 'gone' */
  private broadcastEntry(pid: string): void {
    const e = this.entry(pid);
    for (const [cid, v] of this.conns) {
      if (!e) this.io.send(cid, { t: 'pres', gone: [pid] });
      else if (this.visibleTo(v.pid, pid)) this.io.send(cid, { t: 'pres', up: [e] });
      else if (v.pid !== pid) this.io.send(cid, { t: 'pres', gone: [pid] });
    }
  }

  /** count of distinct visible players (for tests / health) */
  onlineCount(): number {
    return new Set([...this.conns.values()].map((a) => a.pid)).size;
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
    const uid = uidOf(att.pid);
    const s = this.store;
    const needUser = (): boolean => {
      if (uid && s) return true;
      this.err(cid, 'SIGN_IN', 'Sign in to do that.');
      return false;
    };
    switch (msg.t) {
      case 'status': {
        // every tab of the user reports; the newest wins
        att.status = msg.status;
        att.at = now;
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
        const line = this.io.global.add({ from: att.pid, name: att.name, text, at: now, ...(att.admin ? { admin: true } : {}) });
        for (const [c, v] of this.conns) if (!this.hiddenBetween(v.pid, att.pid)) this.io.send(c, { t: 'chat', line });
        return;
      }
      case 'del': {
        if (!att.admin) return this.err(cid, 'FORBIDDEN', 'Admins only.');
        if (this.io.global.del(msg.id)) for (const c of this.conns.keys()) this.io.send(c, { t: 'deleted', id: msg.id });
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
        const line = await s!.sendDm(uid!, to, text, now);
        for (const c of this.connsOf(msg.to)) this.io.send(c, { t: 'dm', line, name: att.name });
        for (const c of this.connsOf(att.pid)) this.io.send(c, { t: 'dm', line, name: toName });
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
        const inv = this.invites.get(msg.id);
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

  private err(cid: string, code: string, message: string): void {
    this.io.send(cid, { t: 'error', code, message });
  }
}
