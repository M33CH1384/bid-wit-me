/**
 * Release 9 social client: one websocket to the Social hub (presence, invites, global chat, DMs, friends).
 * Signed-in players connect with a short-lived account ticket from same-origin /api/social/ticket; guests connect
 * without one (they show up as "Guest", can read global chat and receive invites).
 */
import { useSyncExternalStore } from 'react';
import { activityOf, type DmLine, type FriendActivity, type FriendsState, type InviteMsg, type OpenTable, type PresenceEntry, type PresenceStatus, type SocialChatLine, type SocialClientMsg, type SocialServerMsg, type SocialSettings, stalePresence } from '@spades/protocol';
import { account, loadAccount } from '../account/api';
import { serverUrl } from '../online/config';
import { guestSessionId, loadName } from '../online/identity';
import { keepUsers } from './presence';
import { playChatSound } from './chatSounds';
import { coverThen } from '../spray';

export type SocialTab = 'players' | 'chat' | 'messages' | 'friends' | 'leaders' | 'tournaments' | 'challenges' | 'settings';
export interface ToastAction { label: string; tab: SocialTab; /** friend-request toast: the requester's id, so the popup can Accept/Decline inline */ friendId?: string }
export interface Toast { id: string; kind: 'info' | 'error' | 'ok'; text: string; at: number; action?: ToastAction }
export interface Notice { id: string; text: string; code?: string; seat?: number; tid?: string; /** Big Bank: the wager challenge this notice is about */ cid?: string; at: number }
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
  /** user id for the open profile when the caller knew it (rows carry ids; names alone resolve in the view) */
  profileId: string | null;
  globalSeen: number;
  /** highest global line id whose mentions have been seen (badge math; mirrors globalSeen) */
  mentionSeen: number;
  myTable: MyTable | null;
  /** Release 9b: tournament notices (check-in open, match ready, champion) */
  notices: Notice[];
  /** open tournament detail (id) */
  tour: string | null;
  /** Big Bank: open wager-challenge detail (id) */
  wager: string | null;
  /** Big Bank: create-flow intent (opponent pre-named from a profile Challenge tap) */
  wagerCreate: { opponent?: string } | null;
  /** Release 10: public tables (Open tables list), by code */
  tables: Record<string, OpenTable>;
  /** public table codes that ended or left the open list */
  ended: Record<string, true>;
  /**
   * Last hub activity (epoch ms) seen for a player this session, by pid.
   * Survives the 'gone' that removes them from `users`: the Friends view
   * takes the max of this and the server's persisted FriendRef.lastSeen,
   * so a friend who logs off mid-session shows when they were actually
   * last active, not a stamp from before you connected. Session-only.
   */
  lastAt: Record<string, number>;
}

const GLOBAL_SEEN_KEY = 'bwm.social.globalSeen';
const seen0 = (() => { try { return Number(localStorage.getItem(GLOBAL_SEEN_KEY) ?? '0') || 0; } catch { return 0; } })();

/**
 * Mention seen-id (the badge's mention half). Unlike globalSeen, a MISSING
 * key must not badge the whole kept history on first run: `mentionSeenKnown`
 * records whether the key existed, and the first 'hello' parks the tracker
 * at the newest history line (everything already on screen counts as seen).
 */
const MENTION_SEEN_KEY = 'bwm.social.mentionSeen';
const mentionSeen0 = (() => { try { const v = localStorage.getItem(MENTION_SEEN_KEY); return { id: Number(v ?? '0') || 0, known: v !== null }; } catch { return { id: 0, known: false }; } })();
let mentionSeenKnown = mentionSeen0.known;
function saveMentionSeen(id: number) { try { localStorage.setItem(MENTION_SEEN_KEY, String(id)); } catch { /* ignore */ } mentionSeenKnown = true; }

/** The exact copy a rejected DM send renders (the hub returns the same text with code NOT_FRIENDS). */
export const NOT_FRIENDS_TEXT = "You're not friends with this player — send a friend request to message them.";

/** Has this player muted that pid? (their own FriendsState is the only place mutes live) */
export function isMuted(s: SocialState, pid: string): boolean {
  return (s.friends?.muted ?? []).some((f) => f.id === pid);
}

/**
 * "Chat is a stable place" (owner, 2026-10-20): which chat view the player was in (panel open,
 * tab, open DM thread) persists in sessionStorage so a refresh comes back to the same view.
 * Session-scoped: a refresh in this tab restores it; a new tab starts clean.
 */
export const SOCIAL_VIEW_KEY = 'bwm.social.view';
const SOCIAL_TABS: SocialTab[] = ['players', 'chat', 'messages', 'friends', 'leaders', 'tournaments', 'challenges', 'settings'];
export interface SocialView { open: boolean; tab: SocialTab; dmWith: string | null; names: Record<string, string> }
export function serializeSocialView(s: Pick<SocialState, 'open' | 'tab' | 'dmWith' | 'names'>): string {
  return JSON.stringify({ open: s.open, tab: s.tab, dmWith: s.dmWith, names: s.names });
}
export interface ParsedSocialView { open?: boolean; tab?: SocialTab; dmWith?: string | null; names?: Record<string, string> }
export function parseSocialView(raw: string | null): ParsedSocialView {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Partial<SocialView>;
    const out: ParsedSocialView = {};
    if (typeof v.open === 'boolean') out.open = v.open;
    if (typeof v.tab === 'string' && (SOCIAL_TABS as string[]).includes(v.tab)) out.tab = v.tab;
    if (typeof v.dmWith === 'string' || v.dmWith === null) out.dmWith = v.dmWith ?? null;
    if (v.names && typeof v.names === 'object') {
      const names = Object.fromEntries(Object.entries(v.names).filter(([, x]) => typeof x === 'string'));
      if (Object.keys(names).length) out.names = names;
    }
    return out;
  } catch { return {}; }
}
const view0: ParsedSocialView = (() => { try { return parseSocialView(sessionStorage.getItem(SOCIAL_VIEW_KEY)); } catch { return {}; } })();
function persistView(): void {
  try { sessionStorage.setItem(SOCIAL_VIEW_KEY, serializeSocialView(state)); } catch { /* private mode */ }
}

let state: SocialState = {
  status: 'off', you: null, admin: false, users: {}, lastAt: {}, global: [], friends: null, settings: null, unread: {}, dms: {}, names: view0.names ?? {}, invites: [], sent: {}, toasts: [],
  open: view0.open ?? false, tab: view0.tab ?? 'players', dmWith: view0.dmWith ?? null, profile: null, profileId: null, globalSeen: seen0, mentionSeen: mentionSeen0.id, myTable: null, notices: [], tour: null, wager: null, wagerCreate: null, tables: {}, ended: {},
};
const subs = new Set<() => void>();
function set(p: Partial<SocialState> | ((s: SocialState) => Partial<SocialState>)) {
  const partial = typeof p === 'function' ? p(state) : p;
  state = { ...state, ...partial };
  // Any chat-view change is worth surviving a refresh; everything else is transient data.
  if ('open' in partial || 'tab' in partial || 'dmWith' in partial || 'names' in partial) persistView();
  subs.forEach((f) => f());
}
export function useSocial(): SocialState { return useSyncExternalStore(social.subscribe, social.get, social.get); }

let ws: WebSocket | null = null;
let retry = 0;
let retryTimer: number | null = null;
let pingTimer: number | null = null;
let heartbeatPaused = false;
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

function toast(text: string, kind: Toast['kind'] = 'info', opts?: { ms?: number; action?: ToastAction }) {
  const t: Toast = { id: Math.random().toString(36).slice(2), kind, text, at: Date.now(), ...(opts?.action ? { action: opts.action } : {}) };
  set((s) => ({ toasts: [...s.toasts.slice(-3), t] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), opts?.ms ?? 5000);
}

function send(m: SocialClientMsg): boolean {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(m));
  return true;
}

/* ---- friend-activity presence reporting (migration 0028) ---- */

let lastReported: { uid: string; activity: FriendActivity } | null = null;

/**
 * Report this client's current activity to POST /api/social/presence —
 * the persisted half of friend presence. The hub stamps the same row from
 * the socket's live status; both writers share one server upsert, so a
 * missed report self-heals. Fires on activity change (via setStatus) and
 * on a 30 s heartbeat while the app is visible (see start). Signed-in
 * only, settings loaded only, and never while appearing offline — a
 * hidden player's activity is not their friends' business (the server
 * enforces the same rule). Fire-and-forget: a failed report retries on
 * the next heartbeat.
 */
function reportPresence(force = false): void {
  const u = account.get().user;
  if (!account.get().ready || !u || !state.settings || state.settings.appearOffline) return;
  const activity = activityOf(status);
  if (!force && lastReported?.uid === u.id && lastReported.activity === activity) return;
  lastReported = { uid: u.id, activity };
  void fetch('/api/social/presence', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ activity }),
  }).then((r) => { if (!r.ok) lastReported = null; }).catch(() => { lastReported = null; });
}

async function connect() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  const old = ws;
  ws = null;
  try { old?.close(1000, 'reconnect'); } catch { /* ignore */ }
  set({ status: state.status === 'open' ? 'retrying' : 'connecting' });
  await loadAccount().catch(() => undefined);
  identity = idKey();
  let q = `name=${encodeURIComponent(loadName() || 'Guest')}&gid=${encodeURIComponent(guestSessionId())}`;
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
    pingTimer = window.setInterval(() => {
      if (sock.readyState !== WebSocket.OPEN) return;
      sock.send('ping');
      // ~60 s server presence expiry: a real heartbeat refreshes `at`; paused at 15 min idle so the row expires.
      if (!heartbeatPaused && ws === sock) send({ t: 'heartbeat' });
    }, 25_000);
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
      const tables: Record<string, OpenTable> = {};
      const ended: Record<string, true> = {};
      for (const t of m.tables ?? []) {
        tables[t.code] = t;
        if (t.status === 'over') ended[t.code] = true;
      }
      const users: Record<string, PresenceEntry> = {};
      for (const u of m.users) users[u.id] = u;
      const lastAt: Record<string, number> = { ...state.lastAt };
      for (const u of m.users) if (typeof u.at === 'number') lastAt[u.id] = Math.max(lastAt[u.id] ?? 0, u.at);
      const now = Date.now();
      // First ever hello with no stored mention tracker: everything in the
      // kept history counts as seen (no badge for lines from before mentions
      // existed on this device).
      let mentionSeen = state.mentionSeen;
      if (!mentionSeenKnown) {
        mentionSeen = m.global[m.global.length - 1]?.id ?? 0;
        saveMentionSeen(mentionSeen);
      }
      set({ status: 'open', you: m.you, admin: m.admin, users: keepUsers(users, tables, Object.keys(ended), now), lastAt, global: m.global, friends: m.friends, settings: m.settings, unread: m.unread, tables, ended, mentionSeen });
      send({ t: 'status', status });
      // A refresh restored an open DM thread (session persistence): refill it, as openDm would on tap.
      // Also refreshes the thread on reconnect, so a dropped socket doesn't leave a stale thread.
      if (state.dmWith) { send({ t: 'dmHistory', with: state.dmWith }); send({ t: 'read', with: state.dmWith }); }
      break;
    }
    case 'tables':
      set((s) => {
        const tables = { ...s.tables };
        const ended = { ...s.ended };
        for (const t of m.up ?? []) {
          tables[t.code] = t;
          if (t.status === 'over') ended[t.code] = true;
          else delete ended[t.code];
        }
        for (const c of m.gone ?? []) {
          // Only a table we had listed was public. A private table's "gone" must not hide its players.
          if (tables[c]) ended[c] = true;
          delete tables[c];
        }
        return { tables, ended, users: keepUsers(s.users, tables, Object.keys(ended), Date.now()) };
      });
      break;
    case 'pres':
      set((s) => {
        const users = { ...s.users };
        const lastAt = { ...s.lastAt };
        const listed = Object.values(s.tables);
        const codes = Object.keys(s.ended);
        const now = Date.now();
        for (const u of m.up ?? []) {
          // remember the activity time even for rows about to be filtered:
          // it is the honest "last seen" if this player then goes offline
          if (typeof u.at === 'number') lastAt[u.id] = Math.max(lastAt[u.id] ?? 0, u.at);
          if (stalePresence(u, listed, codes, now)) { delete users[u.id]; continue; }
          users[u.id] = u;
        }
        for (const g of m.gone ?? []) delete users[g];
        const you = s.you && users[s.you.id] ? users[s.you.id]! : s.you;
        return { users, you, lastAt };
      });
      break;
    case 'chat': {
      set((s) => {
        const global = [...s.global, m.line].slice(-200);
        // reading the chat tab right now: it's seen
        const seenNow = s.open && s.tab === 'chat' ? m.line.id : s.globalSeen;
        if (seenNow !== s.globalSeen) saveSeen(seenNow);
        // mentions are seen exactly when the chat tab view is (same advance)
        const mentionSeen = s.open && s.tab === 'chat' ? Math.max(s.mentionSeen, m.line.id) : s.mentionSeen;
        if (mentionSeen !== s.mentionSeen) saveMentionSeen(mentionSeen);
        return { global, globalSeen: seenNow, mentionSeen };
      });
      // live arrivals only reach this case (history rides 'hello'); blip only while the
      // chat view is actually on screen — the gating lives in chatSounds.ts.
      // League Wire lines (item 7) never blip: they're the league talking,
      // not a player message, and must not impersonate one.
      if (!m.line.wire) playChatSound('global', { own: m.line.from === state.you?.id, chatViewOpen: state.open && state.tab === 'chat' });
      // A line that tags ME: toast + blip wherever I am in the app — unless
      // I'm already looking at the chat (the highlight there is enough), or I
      // muted the author (their lines are filtered server-side, so this is
      // belt-and-braces for a mute that landed mid-session).
      const meId = state.you?.id;
      if (meId && !m.line.wire && m.line.from !== meId && (m.line.mentions ?? []).includes(meId)
        && !isMuted(state, m.line.from) && !(state.open && state.tab === 'chat')) {
        toast(`📣 ${m.line.name} mentioned you: ${m.line.text.slice(0, 80)}`, 'info', { action: { label: 'View', tab: 'chat' } });
        playChatSound('mention', { own: false });
      }
      break;
    }
    case 'chatReact':
      set((s) => ({ global: s.global.map((l) => (l.id === m.id ? { ...l, reactions: m.reactions } : l)) }));
      break;
    case 'deleted':
      set((s) => ({ global: s.global.filter((l) => l.id !== m.id) }));
      break;
    case 'dm': {
      const me = state.you?.id;
      const other = m.line.from === me ? m.line.to : m.line.from;
      // A muted sender's DMs still ARRIVE (the thread reads normally) but
      // silently: no unread increment, no ding, no toast.
      const mutedSender = m.line.from !== me && isMuted(state, other);
      set((s) => {
        const reading = s.open && s.tab === 'messages' && s.dmWith === other;
        const unread = m.line.from !== me && !reading && !mutedSender ? { ...s.unread, [other]: (s.unread[other] ?? 0) + 1 } : s.unread;
        return { dms: { ...s.dms, [other]: [...(s.dms[other] ?? []), m.line].slice(-200) }, names: { ...s.names, [other]: m.name }, unread };
      });
      if (m.line.from !== me) {
        // a DM dings no matter where you are in the app (chatSounds.ts gates hidden/muted/throttle);
        // a muted sender is the one exception: total silence, the line just lands in the thread.
        if (!mutedSender) playChatSound('dm', { own: false });
        if (state.open && state.tab === 'messages' && state.dmWith === other) send({ t: 'read', with: other });
        else if (!mutedSender) toast(`💬 ${m.name}: ${m.line.text.slice(0, 80)}`);
      }
      break;
    }
    case 'dmHistory':
      set((s) => ({ dms: { ...s.dms, [m.with]: mergeLines(m.lines, s.dms[m.with] ?? []) } }));
      break;
    case 'dmReact':
      set((s) => {
        const cur = s.dms[m.with];
        if (!cur) return {};
        return { dms: { ...s.dms, [m.with]: cur.map((l) => (l.id === m.id ? { ...l, reactions: m.reactions } : l)) } };
      });
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
      for (const f of m.friends.incoming) if (!before.has(f.id)) toast(`👋 ${f.name} sent you a friend request.`, 'info', { ms: 10_000, action: { label: 'View requests', tab: 'friends', friendId: f.id } });
      break;
    }
    case 'settings':
      set({ settings: m.settings });
      break;
    case 'ok':
      if (m.what === 'report') toast('Thanks: report sent to the moderators.', 'ok');
      break;
    case 'error':
      // The friend-DM gate renders its exact copy, whatever the server text says.
      toast(m.code === 'NOT_FRIENDS' ? NOT_FRIENDS_TEXT : m.message, 'error');
      break;
    case 'notice': {
      const n: Notice = { id: Math.random().toString(36).slice(2), text: m.text, code: m.code, seat: m.seat, tid: m.tid, cid: m.cid, at: Date.now() };
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
  // the fresh server page (`a`) wins on id conflict: line content is server-authoritative, and a
  // reaction that landed while this socket was down only shows up through the refetched history.
  for (const l of [...b, ...a]) byId.set(l.id, l);
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
    // Friend-presence heartbeat: keep the persisted activity fresh while
    // the app is open and visible. A hidden tab reports nothing, so its
    // row goes stale and friends fall back to last-seen — the clean stop.
    window.setInterval(() => { if (document.visibilityState === 'visible') reportPresence(true); }, 30_000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reportPresence(true); });
    account.subscribe(() => {
      if (account.get().ready && identity !== undefined && idKey() !== identity) void connect();
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !ws && started) void connect(); });
  },
  /** Idle >= 15 min: stop heartbeating so the server drops this user off the Online list (~60 s). */
  setHeartbeatPaused(paused: boolean) {
    heartbeatPaused = paused;
    if (!paused) send({ t: 'heartbeat' });
  },
  setStatus(s: PresenceStatus) {
    status = s;
    send({ t: 'status', status: s });
    reportPresence();
  },
  setMyTable(t: MyTable | null) { set({ myTable: t }); },
  open(tab?: SocialTab, extra: Partial<Pick<SocialState, 'dmWith' | 'profile'>> = {}) {
    social.start();
    const apply = () => {
      set((s) => ({ open: true, tab: tab ?? s.tab, ...extra }));
      if ((tab ?? state.tab) === 'chat') social.markGlobalSeen();
      if (extra.dmWith) social.openDm(extra.dmWith);
    };
    // Card Fan transition (transitions.ts): the panel is a full
    // screen — its closed->open swap rides the fan (profile-social
    // class). Already open (a tab/deep-link re-target) applies
    // instantly; there is no screen change to cover.
    if (state.open) apply();
    else coverThen(apply, 'profile-social');
  },
  close() {
    const apply = () => set({ open: false, profile: null, profileId: null });
    if (state.open) coverThen(apply, 'profile-social');
    else apply();
  },
  showTour(id: string | null) {
    const apply = () => set({ open: true, tab: 'tournaments', profile: null, profileId: null, tour: id });
    if (state.open) apply();
    else coverThen(apply, 'profile-social');
  },
  /** open the Big Bank tab; with an id, straight to that challenge's detail */
  showChallenge(id: string | null) {
    const apply = () => set({ open: true, tab: 'challenges', profile: null, profileId: null, wager: id });
    if (state.open) apply();
    else coverThen(apply, 'profile-social');
  },
  /** open the Big Bank create flow (optionally with the opponent pre-named from a profile) */
  startChallenge(opponent?: string) {
    social.start();
    const apply = () => set({ open: true, tab: 'challenges', profile: null, profileId: null, wager: null, wagerCreate: opponent ? { opponent } : {} });
    if (state.open) apply();
    else coverThen(apply, 'profile-social');
  },
  clearWagerCreate() { set({ wagerCreate: null }); },
  dismissNotice(id: string) { set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })); },
  tab(tab: SocialTab) { set({ tab, profile: null, profileId: null, ...(tab === 'tournaments' ? { tour: null } : {}), ...(tab === 'challenges' ? { wager: null } : {}) }); if (tab === 'chat') social.markGlobalSeen(); },
  markGlobalSeen() { const last = state.global[state.global.length - 1]?.id ?? state.globalSeen; saveSeen(last); saveMentionSeen(Math.max(state.mentionSeen, last)); set({ globalSeen: last, mentionSeen: Math.max(state.mentionSeen, last) }); },
  openDm(pid: string) {
    set((s) => ({ tab: 'messages', dmWith: pid, profile: null, profileId: null, unread: { ...s.unread, [pid]: 0 } }));
    send({ t: 'dmHistory', with: pid });
    send({ t: 'read', with: pid });
  },
  closeDm() { set({ dmWith: null }); },
  showProfile(name: string | null, id?: string) { set({ profile: name, profileId: name ? id ?? null : null }); },
  chat(text: string, replyTo?: number) { if (!send({ t: 'chat', text, ...(replyTo ? { replyTo } : {}) })) toast("Not connected: try again in a moment.", 'error'); },
  /** emoji reaction to a global chat line (toggle; the hub broadcasts the new map) */
  react(id: number, emoji: string) { send({ t: 'react', id, emoji }); },
  /** emoji reaction to a DM line (toggle; the hub sends both participants the new map) */
  dmReact(id: number, emoji: string) { send({ t: 'dmReact', id, emoji }); },
  dm(to: string, text: string, replyTo?: number) { if (!send({ t: 'dm', to, text, ...(replyTo ? { replyTo } : {}) })) toast("Not connected: try again in a moment.", 'error'); },
  invite(to: string, t: MyTable) { send({ t: 'invite', to, code: t.code, ...(t.mode ? { mode: t.mode } : {}), ...(t.seat !== undefined ? { seat: t.seat } : {}) }); },
  /** Story co-op invite: the code names a story room (created via /api/story/room);
   *  accepting lands the partner on /story?coop=<code>, which binds them server-side. */
  inviteStory(to: string, code: string, stopId: string) { send({ t: 'invite', to, code, kind: 'story-coop', stopId }); },
  replyInvite(inv: InviteMsg, accept: boolean) {
    send({ t: 'inviteReply', id: inv.id, accept });
    set((s) => ({ invites: s.invites.filter((i) => i.id !== inv.id) }));
  },
  friend(op: Extract<SocialClientMsg, { t: 'friend' }>['op'], to: string) { send({ t: 'friend', op, to }); },
  /** mute / unmute a player (private, one-directional; the hub answers with a fresh FriendsState) */
  mute(to: string, on: boolean) { send({ t: 'mute', to, on }); },
  report(kind: 'global' | 'dm' | 'user', o: { id?: number; user?: string; reason?: string }) { send({ t: 'report', kind, ...o }); },
  del(id: number) { send({ t: 'del', id }); },
  saveSettings(p: Partial<SocialSettings>) { send({ t: 'settings', settings: p }); },
  toast,
  dismissToast(id: string) { set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })); },
};

/** global-chat lines that @mention me and haven't been seen yet (id past the mention tracker, my pid in mentions) */
export function unseenMentions(s: SocialState): number {
  if (!s.you) return 0;
  const me = s.you.id;
  return s.global.filter((l) => l.id > s.mentionSeen && l.from !== me && (l.mentions ?? []).includes(me)).length;
}

/** total for the Social button badge: unread DMs + friend requests + pending invites + unseen mentions */
export function badgeCount(s: SocialState): number {
  return Object.values(s.unread).reduce((a, b) => a + b, 0) + (s.friends?.incoming.length ?? 0) + s.invites.length + unseenMentions(s);
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

// e2e / debugging: read-only peek at the social state
if (typeof window !== 'undefined') (window as unknown as { __bwmSocial: unknown }).__bwmSocial = { get: () => state };
