/**
 * Release 9 social client: one websocket to the Social hub (presence, invites, global chat, DMs, friends).
 * Signed-in players connect with a short-lived account ticket from same-origin /api/social/ticket; guests connect
 * without one (they show up as "Guest", can read global chat and receive invites).
 */
import { useSyncExternalStore } from 'react';
import type { DmLine, FriendsState, InviteMsg, OpenTable, PresenceEntry, PresenceStatus, SocialChatLine, SocialClientMsg, SocialServerMsg, SocialSettings } from '@spades/protocol';
import { account, loadAccount } from '../account/api';
import { serverUrl } from '../online/config';
import { loadName } from '../online/identity';

export type SocialTab = 'players' | 'chat' | 'messages' | 'friends' | 'leaders' | 'tournaments' | 'settings';
export interface Toast { id: string; kind: 'info' | 'error' | 'ok'; text: string; at: number }
export interface Notice { id: string; text: string; code?: string; seat?: number; tid?: string; at: number }
export interface MyTable { code: string; mode?: string; seat?: number; open: number }

export interface SocialState {
  status: 'off' | 'connecting' | 'open' | 'retrying';
  you: PresenceEntry | null;
  admin: boolean;
  users: Record<string, PresenceEntry>;
  global: SocialChatLine[];
  friends: FriendsState | null;
  settings: SocialSettings | null;
  unread: Record<string, number>;
  /** DM threads by other player id */
  dms: Record<string, DmLine[]>;
  /** display names learned from DMs (players who may be offline) */
  names: Record<string, string>;
  invites: InviteMsg[];
  sent: Record<string, { to: string; expiresAt: number }>;
  toasts: Toast[];
  open: boolean;
  tab: SocialTab;
  dmWith: string | null;
  profile: string | null;
  globalSeen: number;
  myTable: MyTable | null;
  /** Release 9b: tournament notices (check-in open, match ready, champion) */
  notices: Notice[];
  /** open tournament detail (id) */
  tour: string | null;
  /** Release 10: public tables (Open tables list), by code */
  tables: Record<string, OpenTable>;
}

const GLOBAL_SEEN_KEY = 'bwm.social.globalSeen';
const seen0 = (() => { try { return Number(localStorage.getItem(GLOBAL_SEEN_KEY) ?? '0') || 0; } catch { return 0; } })();

let state: SocialState = {
  status: 'off', you: null, admin: false, users: {}, global: [], friends: null, settings: null, unread: {}, dms: {}, names: {}, invites: [], sent: {}, toasts: [],
  open: false, tab: 'players', dmWith: null, profile: null, globalSeen: seen0, myTable: null, notices: [], tour: null, tables: {},
};
const subs = new Set<() => void>();
function set(p: Partial<SocialState> | ((s: SocialState) => Partial<SocialState>)) {
  state = { ...state, ...(typeof p === 'function' ? p(state) : p) };
  subs.forEach((f) => f());
}
export function useSocial(): SocialState { return useSyncExternalStore(social.subscribe, social.get, social.get); }

let ws: WebSocket | null = null;
let retry = 0;
let retryTimer: number | null = null;
let pingTimer: number | null = null;
let started = false;
let identity: string | null | undefined; // account id the socket was opened as (null = guest)
let status: PresenceStatus = { kind: 'online' };

/** who the socket should be: account + username (a fresh account picks its username after the first connect) */
function idKey(): string | null {
  const u = account.get().user;
  return u?.username ? `${u.id}:${u.username}` : null;
}

const noticeHooks = new Set<(n: Notice) => void>();
export function onNotice(f: (n: Notice) => void): () => void { noticeHooks.add(f); return () => noticeHooks.delete(f); }

function toast(text: string, kind: Toast['kind'] = 'info') {
  const t: Toast = { id: Math.random().toString(36).slice(2), kind, text, at: Date.now() };
  set((s) => ({ toasts: [...s.toasts.slice(-3), t] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), 5000);
}

function send(m: SocialClientMsg): boolean {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(m));
  return true;
}

async function connect() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  const old = ws;
  ws = null;
  try { old?.close(1000, 'reconnect'); } catch { /* ignore */ }
  set({ status: state.status === 'open' ? 'retrying' : 'connecting' });
  await loadAccount().catch(() => undefined);
  identity = idKey();
  let q = `name=${encodeURIComponent(loadName() || 'Guest')}`;
  if (identity) {
    try {
      const r = await fetch('/api/social/ticket', { credentials: 'same-origin' });
      const j = (await r.json()) as { ticket?: string };
      if (j.ticket) q = `ticket=${encodeURIComponent(j.ticket)}`;
    } catch { /* connect as a guest */ }
  }
  const sock = new WebSocket(`${serverUrl().replace(/^http/, 'ws')}/api/social/ws?${q}`);
  ws = sock;
  sock.onopen = () => {
    retry = 0;
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = window.setInterval(() => { if (sock.readyState === WebSocket.OPEN) sock.send('ping'); }, 25_000);
  };
  sock.onmessage = (ev) => {
    if (ev.data === 'pong' || ws !== sock) return;
    let m: SocialServerMsg;
    try { m = JSON.parse(String(ev.data)); } catch { return; }
    onMessage(m);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    set({ status: 'retrying' });
    const delay = Math.min(30_000, 1000 * 2 ** retry++) + Math.random() * 500;
    retryTimer = window.setTimeout(() => { void connect(); }, delay);
  };
}

function onMessage(m: SocialServerMsg) {
  switch (m.t) {
    case 'hello': {
      const users: Record<string, PresenceEntry> = {};
      for (const u of m.users) users[u.id] = u;
      const tables: Record<string, OpenTable> = {};
      for (const t of m.tables ?? []) tables[t.code] = t;
      set({ status: 'open', you: m.you, admin: m.admin, users, global: m.global, friends: m.friends, settings: m.settings, unread: m.unread, tables });
      send({ t: 'status', status });
      break;
    }
    case 'tables':
      set((s) => {
        const tables = { ...s.tables };
        for (const t of m.up ?? []) tables[t.code] = t;
        for (const c of m.gone ?? []) delete tables[c];
        return { tables };
      });
      break;
    case 'pres':
      set((s) => {
        const users = { ...s.users };
        for (const u of m.up ?? []) users[u.id] = u;
        for (const g of m.gone ?? []) delete users[g];
        const you = s.you && users[s.you.id] ? users[s.you.id]! : s.you;
        return { users, you };
      });
      break;
    case 'chat':
      set((s) => {
        const global = [...s.global, m.line].slice(-200);
        // reading the chat tab right now: it's seen
        const seenNow = s.open && s.tab === 'chat' ? m.line.id : s.globalSeen;
        if (seenNow !== s.globalSeen) saveSeen(seenNow);
        return { global, globalSeen: seenNow };
      });
      break;
    case 'deleted':
      set((s) => ({ global: s.global.filter((l) => l.id !== m.id) }));
      break;
    case 'dm': {
      const me = state.you?.id;
      const other = m.line.from === me ? m.line.to : m.line.from;
      set((s) => {
        const reading = s.open && s.tab === 'messages' && s.dmWith === other;
        const unread = m.line.from !== me && !reading ? { ...s.unread, [other]: (s.unread[other] ?? 0) + 1 } : s.unread;
        return { dms: { ...s.dms, [other]: [...(s.dms[other] ?? []), m.line].slice(-200) }, names: { ...s.names, [other]: m.name }, unread };
      });
      if (m.line.from !== me) {
        if (state.open && state.tab === 'messages' && state.dmWith === other) send({ t: 'read', with: other });
        else toast(`💬 ${m.name}: ${m.line.text.slice(0, 80)}`);
      }
      break;
    }
    case 'dmHistory':
      set((s) => ({ dms: { ...s.dms, [m.with]: mergeLines(m.lines, s.dms[m.with] ?? []) } }));
      break;
    case 'invite':
      set((s) => ({ invites: [...s.invites.filter((i) => i.id !== m.invite.id), m.invite] }));
      break;
    case 'inviteGone':
      set((s) => {
        const sent = { ...s.sent };
        const was = sent[m.id];
        delete sent[m.id];
        if (was && m.reason === 'expired') toast(`Your invite to ${s.users[was.to]?.name ?? 'that player'} expired.`);
        return { invites: s.invites.filter((i) => i.id !== m.id), sent };
      });
      break;
    case 'inviteSent':
      set((s) => ({ sent: { ...s.sent, [m.id]: { to: m.to, expiresAt: m.expiresAt } } }));
      toast(`Invite sent to ${state.users[m.to]?.name ?? 'player'}.`, 'ok');
      break;
    case 'inviteReply':
      set((s) => { const sent = { ...s.sent }; delete sent[m.id]; return { sent }; });
      toast(m.accept ? `${m.byName} accepted: they're on the way.` : `${m.byName} declined.`, m.accept ? 'ok' : 'info');
      break;
    case 'friends': {
      const before = new Set((state.friends?.incoming ?? []).map((f) => f.id));
      set({ friends: m.friends });
      for (const f of m.friends.incoming) if (!before.has(f.id)) toast(`👋 ${f.name} sent you a friend request.`);
      break;
    }
    case 'settings':
      set({ settings: m.settings });
      break;
    case 'ok':
      if (m.what === 'report') toast('Thanks: report sent to the moderators.', 'ok');
      break;
    case 'error':
      toast(m.message, 'error');
      break;
    case 'notice': {
      const n: Notice = { id: Math.random().toString(36).slice(2), text: m.text, code: m.code, seat: m.seat, tid: m.tid, at: Date.now() };
      set((st) => ({ notices: [...st.notices.slice(-2), n] }));
      // a match-ready notice stays up longer (you need to get there)
      setTimeout(() => set((st) => ({ notices: st.notices.filter((x) => x.id !== n.id) })), m.code ? 120_000 : 15_000);
      noticeHooks.forEach((f) => f(n));
      break;
    }
  }
}

function mergeLines(a: DmLine[], b: DmLine[]): DmLine[] {
  const byId = new Map<number, DmLine>();
  for (const l of [...a, ...b]) byId.set(l.id, l);
  return [...byId.values()].sort((x, y) => x.id - y.id);
}
function saveSeen(id: number) { try { localStorage.setItem(GLOBAL_SEEN_KEY, String(id)); } catch { /* ignore */ } }

export const social = {
  get: () => state,
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
  /** connect once per page (and again whenever the signed-in account changes) */
  start() {
    if (started) return;
    started = true;
    void connect();
    account.subscribe(() => {
      if (account.get().ready && identity !== undefined && idKey() !== identity) void connect();
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !ws && started) void connect(); });
  },
  setStatus(s: PresenceStatus) {
    status = s;
    send({ t: 'status', status: s });
  },
  setMyTable(t: MyTable | null) { set({ myTable: t }); },
  open(tab?: SocialTab, extra: Partial<Pick<SocialState, 'dmWith' | 'profile'>> = {}) {
    social.start();
    set((s) => ({ open: true, tab: tab ?? s.tab, ...extra }));
    if ((tab ?? state.tab) === 'chat') social.markGlobalSeen();
    if (extra.dmWith) social.openDm(extra.dmWith);
  },
  close() { set({ open: false, profile: null }); },
  showTour(id: string | null) { set({ open: true, tab: 'tournaments', profile: null, tour: id }); },
  dismissNotice(id: string) { set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })); },
  tab(tab: SocialTab) { set({ tab, profile: null, ...(tab === 'tournaments' ? { tour: null } : {}) }); if (tab === 'chat') social.markGlobalSeen(); },
  markGlobalSeen() { const last = state.global[state.global.length - 1]?.id ?? state.globalSeen; saveSeen(last); set({ globalSeen: last }); },
  openDm(pid: string) {
    set((s) => ({ tab: 'messages', dmWith: pid, profile: null, unread: { ...s.unread, [pid]: 0 } }));
    send({ t: 'dmHistory', with: pid });
    send({ t: 'read', with: pid });
  },
  closeDm() { set({ dmWith: null }); },
  showProfile(name: string | null) { set({ profile: name }); },
  chat(text: string) { if (!send({ t: 'chat', text })) toast("Not connected: try again in a moment.", 'error'); },
  dm(to: string, text: string) { if (!send({ t: 'dm', to, text })) toast("Not connected: try again in a moment.", 'error'); },
  invite(to: string, t: MyTable) { send({ t: 'invite', to, code: t.code, ...(t.mode ? { mode: t.mode } : {}), ...(t.seat !== undefined ? { seat: t.seat } : {}) }); },
  replyInvite(inv: InviteMsg, accept: boolean) {
    send({ t: 'inviteReply', id: inv.id, accept });
    set((s) => ({ invites: s.invites.filter((i) => i.id !== inv.id) }));
  },
  friend(op: Extract<SocialClientMsg, { t: 'friend' }>['op'], to: string) { send({ t: 'friend', op, to }); },
  report(kind: 'global' | 'dm' | 'user', o: { id?: number; user?: string; reason?: string }) { send({ t: 'report', kind, ...o }); },
  del(id: number) { send({ t: 'del', id }); },
  saveSettings(p: Partial<SocialSettings>) { send({ t: 'settings', settings: p }); },
  toast,
  dismissToast(id: string) { set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })); },
};

/** total for the Social button badge: unread DMs + friend requests + pending invites */
export function badgeCount(s: SocialState): number {
  return Object.values(s.unread).reduce((a, b) => a + b, 0) + (s.friends?.incoming.length ?? 0) + s.invites.length;
}
export function globalUnread(s: SocialState): number {
  return s.global.filter((l) => l.id > s.globalSeen && l.from !== s.you?.id).length;
}

/* ---- account ticket for table websockets (links your seat to your account for stats + ratings) */
let ticketCache: { t: string; until: number; uid: string } | null = null;
/** Don't block joining the table longer than this. A miss retries; it is not a permanent guest. */
export const TICKET_RACE_MS = 1500;
/** Keep asking while a signed-in player still has no ticket. */
export const TICKET_RETRY_MS = 4000;
export const STATS_OFF_LABEL = 'Stats off, tap to reconnect';

export function clearAccountTicket(): void { ticketCache = null; }

/**
 * A slow /api/auth/me is a retry, not a guest. A signed-in user with no ticket is "stats off"
 * until a later try links the seat. A real guest does not retry.
 */
export function ticketPlan(o: { ready: boolean; userId: string | null; username: string | null; ticket: string | null }): { ticket: string | null; retry: boolean; statsOff: boolean } {
  if (!o.ready) return { ticket: null, retry: true, statsOff: false };
  const signedIn = !!o.userId && !!o.username;
  if (!signedIn) return { ticket: null, retry: false, statsOff: false };
  if (!o.ticket) return { ticket: null, retry: true, statsOff: true };
  return { ticket: o.ticket, retry: false, statsOff: false };
}

export async function accountTicketState(): Promise<{ ticket: string | null; retry: boolean; statsOff: boolean }> {
  try {
    if (!account.get().ready) {
      await Promise.race([loadAccount().then(() => undefined), new Promise((r) => setTimeout(r, TICKET_RACE_MS))]);
    }
    const user = account.get().user;
    if (!account.get().ready) return ticketPlan({ ready: false, userId: null, username: null, ticket: null });
    if (!user?.id || !user.username) return ticketPlan({ ready: true, userId: user?.id ?? null, username: user?.username ?? null, ticket: null });
    if (ticketCache && ticketCache.uid === user.id && ticketCache.until > Date.now()) {
      return ticketPlan({ ready: true, userId: user.id, username: user.username, ticket: ticketCache.t });
    }
    const r = await fetch('/api/social/ticket', { credentials: 'same-origin' });
    const j = (await r.json()) as { ticket?: string };
    if (!j.ticket) return ticketPlan({ ready: true, userId: user.id, username: user.username, ticket: null });
    ticketCache = { t: j.ticket, until: Date.now() + 3 * 60_000, uid: user.id };
    return ticketPlan({ ready: true, userId: user.id, username: user.username, ticket: j.ticket });
  } catch {
    const user = account.get().user;
    return { ticket: null, retry: true, statsOff: !!user?.id && !!user.username };
  }
}

export async function accountTicket(): Promise<string | null> {
  return (await accountTicketState()).ticket;
}

// e2e / debugging: peek at social state, and drop in an invite the hub would have sent
if (typeof window !== 'undefined') (window as unknown as { __bwmSocial: unknown }).__bwmSocial = {
  get: () => state,
  debugInvite(invite: InviteMsg) { set((s) => ({ invites: [...s.invites.filter((i) => i.id !== invite.id), invite] })); },
};
