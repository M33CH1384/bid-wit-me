/**
 * Release 9: the Social hub protocol (one Social Durable Object: presence, invites, global chat, DMs, friends).
 * Identity comes from the connection (a short-lived signed account ticket, or none = guest), never from messages.
 */

import { isReactionEmoji, type ChatReactions } from './filter';

export const SOCIAL_LIMITS = {
  chatMax: 300,          // characters per global/DM message
  globalKeep: 200,       // global chat lines kept
  globalSend: 50,        // sent on connect
  dmPage: 50,
  inviteTtlMs: 60_000,
  /** per user: messages (global + DMs) in a sliding window */
  chatBurst: { n: 5, windowMs: 10_000 },
  chatMinute: { n: 20, windowMs: 60_000 },
  /** per user: emoji reactions in a sliding window */
  react: { n: 30, windowMs: 60_000 },
  replySnippet: 80,      // characters of the quoted line kept in a reply snapshot
  invites: { n: 6, windowMs: 60_000 },
  friendOps: { n: 20, windowMs: 60_000 },
  reportReason: 200,
} as const;

export type PresenceKind = 'online' | 'lobby' | 'table' | 'tournament';
export interface PresenceStatus {
  kind: PresenceKind;
  /** rules mode at the table / lobby (joker, aceDown, cutthroat) */
  mode?: string;
  /** seats a new player could take (empty in the lobby; bot seats mid-game) */
  open?: number;
  /** online table code (only set when the player can invite others in) */
  code?: string;
  /**
   * Offline game vs bots. It runs on that player's device: there is no server room,
   * so nobody can join or spectate it.
   */
  offline?: boolean;
  /** tournament name */
  name?: string;
  /** seat a newcomer can take right now (empty, or a bot the table allows). Never a human. */
  seat?: number;
  /** the online table is not accepting more spectators */
  watchFull?: boolean;
}

/** Client-minted guest session suffix. Same browser → one presence row. Not an account id. */
export const GUEST_SESSION = /^[A-Za-z0-9_-]{8,32}$/;

/**
 * Drop a presence row that has not sent a social message in this long.
 * The runtime answers websocket pings without waking the hub, so this is real traffic only.
 */
/** Presence expires ~60 s after the last heartbeat: closed tabs / dead sockets fall off the Online list. */
export const PRESENCE_TTL_MS = 60_000;
export const PRESENCE_HEARTBEAT_MS = PRESENCE_TTL_MS;

export interface PresenceEntry {
  /** 'u:<userId>' for accounts, 'g:<random>' for guests */
  id: string;
  name: string;
  guest: boolean;
  status: PresenceStatus;
  /** epoch ms of this session's last social message */
  at?: number;
  /** Elo per pool (accounts with rated games only) */
  rating?: { team?: number; cutthroat?: number };
}

/**
 * Hide a players-list row for an ended table or an old session.
 * Offline vs-bots games have no table code and stay. A private table is not in `ended`
 * and is not listed as `over`, so it stays too.
 */
export function stalePresence(
  entry: { status: PresenceStatus; at?: number },
  tables: Iterable<{ code: string; status: 'waiting' | 'playing' | 'over' }>,
  ended: Iterable<string>,
  now: number,
): boolean {
  if (typeof entry.at === 'number' && now - entry.at > PRESENCE_TTL_MS) return true;
  const s = entry.status;
  if (s.offline) return false;
  if ((s.kind !== 'table' && s.kind !== 'lobby') || !s.code) return false;
  for (const code of ended) if (code === s.code) return true;
  for (const t of tables) if (t.code === s.code && t.status === 'over') return true;
  return false;
}

/**
 * A reply snapshot stored ON the replying line: the quoted line's id, its author's display
 * name and a text snippet, all captured server-side at post time. Rendering from the snapshot
 * (not a lookup) keeps the quote correct after the original scrolls out of the kept history
 * or its author renames. `fromId` (the quoted author's pid) is carried so the hub can strip
 * the quote for viewers blocked from that author — the quote gets the same visibility the
 * original line itself gets, nothing more.
 */
export interface ReplyRef { id: number; from: string; fromId: string; text: string }

/** Build the snapshot for a reply to `line` (the snippet is server-truncated). */
export function replySnapshot(line: SocialChatLine): ReplyRef {
  return { id: line.id, from: line.name, fromId: line.from, text: line.text.slice(0, SOCIAL_LIMITS.replySnippet) };
}

/**
 * Same snapshot for a reply to a DM line. A DmLine carries no display name of its own
 * (the other participant's name travels beside the line), so the hub supplies the quoted
 * author's current name; shape and truncation are identical to replySnapshot.
 */
export function dmReplySnapshot(line: { id: number; from: string; text: string }, fromName: string): ReplyRef {
  return { id: line.id, from: fromName, fromId: line.from, text: line.text.slice(0, SOCIAL_LIMITS.replySnippet) };
}

export interface SocialChatLine { id: number; from: string; name: string; text: string; at: number; admin?: boolean; /** emoji reactions (emoji -> reactor pids); see REACTION_PALETTE */ reactions?: ChatReactions; /** the line this one replies to, as a post-time snapshot */ reply?: ReplyRef; /** a BWM League Wire system line (league data wave, item 7): posted by the server for marquee moments, not by a player — no author profile, no reply/reactions */ wire?: boolean }
export interface DmLine { id: number; from: string; to: string; text: string; at: number; read?: boolean; /** emoji reactions (emoji -> reactor pids); see REACTION_PALETTE */ reactions?: ChatReactions; /** the DM line this one replies to, as a post-time snapshot (same shape as global chat) */ reply?: ReplyRef }
export interface FriendRef {
  id: string; name: string; since?: number;
  /**
   * Epoch ms the player was last seen online (Social hub activity; see the
   * last_seen table). FRIENDS-ONLY: the server attaches it solely to
   * confirmed-friend refs inside the owner's own FriendsState — never to
   * pending/blocked refs, and it appears on no public payload (profiles,
   * players list, leaderboards). Absent until the player is next seen
   * after tracking began; the client renders nothing extra without it.
   */
  lastSeen?: number;
}
export interface FriendsState { friends: FriendRef[]; incoming: FriendRef[]; outgoing: FriendRef[]; blocked: FriendRef[] }
export interface SocialSettings { appearOffline: boolean; friendsOnlyInvites: boolean; hideLocation: boolean }
export interface InviteMsg { id: string; from: string; fromName: string; code: string; mode?: string; seat?: number; expiresAt: number }

export type SocialClientMsg =
  | { t: 'status'; status: PresenceStatus }
  | { t: 'heartbeat' }
  | { t: 'settings'; settings: Partial<SocialSettings> }
  | { t: 'chat'; text: string; /** reply to this global line id; the hub resolves it to a snapshot, or posts without one */ replyTo?: number }
  /** emoji reaction to a global chat line (toggle): the hub applies it and broadcasts the new reaction map */
  | { t: 'react'; id: number; emoji: string }
  /** emoji reaction to a DM line (toggle): DM ids live in D1, a different namespace than global ids, so it has its own message */
  | { t: 'dmReact'; id: number; emoji: string }
  | { t: 'dm'; to: string; text: string; /** reply to this DM line id (same conversation); the hub resolves it to a snapshot, or posts without one */ replyTo?: number }
  | { t: 'dmHistory'; with: string; before?: number }
  | { t: 'read'; with: string }
  | { t: 'invite'; to: string; code: string; mode?: string; seat?: number }
  | { t: 'inviteReply'; id: string; accept: boolean }
  | { t: 'friend'; op: 'request' | 'accept' | 'decline' | 'remove' | 'block' | 'unblock'; to: string }
  | { t: 'report'; kind: 'global' | 'dm' | 'user'; id?: number; user?: string; reason?: string }
  | { t: 'del'; id: number };

/**
 * Release 10: a public table on the "Open tables" list (the table's Durable Object reports it to the hub on every
 * change; private tables and tables with no connected player are removed).
 */
export interface OpenTable {
  code: string;
  host: string;
  /** rules mode: joker | cutthroat | aceDown */
  mode: string;
  playerCount: number;
  /** points to win */
  target: number;
  venue: string;
  /** seats with a human / with a bot */
  humans: number;
  bots: number;
  /** seats a newcomer could take now (empty in the lobby; takeable bot seats mid-game; 0 at tournament tables) */
  open: number;
  status: 'waiting' | 'playing' | 'over';
  hand?: number;
  spectators: number;
  /** spectators are full */
  watchFull?: boolean;
  tournament?: string;
  /** a seat index a newcomer can take right now (the Join button deep-links it) */
  seat?: number;
  at: number;
}

export type SocialServerMsg =
  | { t: 'hello'; you: PresenceEntry; admin: boolean; users: PresenceEntry[]; global: SocialChatLine[]; friends: FriendsState | null; settings: SocialSettings | null; unread: Record<string, number>; /** Release 10 */ tables?: OpenTable[] }
  /** Release 10: Open tables changed */
  | { t: 'tables'; up?: OpenTable[]; gone?: string[] }
  | { t: 'pres'; up?: PresenceEntry[]; gone?: string[] }
  | { t: 'chat'; line: SocialChatLine }
  /** a global chat line's reactions changed (toggle): `id` names the line, the client upserts the map (not a new line) */
  | { t: 'chatReact'; id: number; reactions: ChatReactions }
  /**
   * a DM line's reactions changed (toggle). `with` names the other participant's pid from this
   * connection's perspective, so the client can find the right thread.
   */
  | { t: 'dmReact'; id: number; with: string; reactions: ChatReactions }
  | { t: 'deleted'; id: number }
  | { t: 'dm'; line: DmLine; name: string }
  | { t: 'dmHistory'; with: string; lines: DmLine[] }
  | { t: 'invite'; invite: InviteMsg }
  | { t: 'inviteGone'; id: string; reason: 'expired' | 'declined' | 'accepted' | 'cancelled' }
  | { t: 'inviteSent'; id: string; to: string; expiresAt: number }
  | { t: 'inviteReply'; id: string; by: string; byName: string; accept: boolean }
  | { t: 'friends'; friends: FriendsState }
  | { t: 'settings'; settings: SocialSettings }
  | { t: 'ok'; what: string }
  /** Release 9b: tournament reminders / match-ready (code + seat = jump to the table) */
  | { t: 'notice'; text: string; code?: string; seat?: number; tid?: string; cid?: string }
  | { t: 'error'; code: string; message: string };

const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isId = (v: unknown): v is string => typeof v === 'string' && /^[ug]:[A-Za-z0-9_-]{1,64}$/.test(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const KINDS: readonly PresenceKind[] = ['online', 'lobby', 'table', 'tournament'];
const FRIEND_OPS = ['request', 'accept', 'decline', 'remove', 'block', 'unblock'] as const;

function parseStatus(v: unknown): PresenceStatus | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (!KINDS.includes(s.kind as PresenceKind)) return null;
  const out: PresenceStatus = { kind: s.kind as PresenceKind };
  if (isStr(s.mode, 20)) out.mode = s.mode;
  if (isInt(s.open) && s.open >= 0 && s.open <= 8) out.open = s.open;
  if (isStr(s.code, 12) && /^[A-Z0-9]+$/.test(s.code)) out.code = s.code;
  if (s.offline === true) out.offline = true;
  if (isStr(s.name, 40)) out.name = s.name;
  if (isInt(s.seat) && s.seat >= 0 && s.seat < 8) out.seat = s.seat;
  if (s.watchFull === true) out.watchFull = true;
  return out;
}

/** Validate a client message (anything malformed → null, dropped). */
export function parseSocialMsg(raw: unknown): SocialClientMsg | null {
  let m: Record<string, unknown>;
  try { m = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>); } catch { return null; }
  if (!m || typeof m !== 'object') return null;
  switch (m.t) {
    case 'status': { const s = parseStatus(m.status); return s ? { t: 'status', status: s } : null; }
    case 'heartbeat': return { t: 'heartbeat' };
    case 'settings': {
      const s = (m.settings ?? {}) as Record<string, unknown>;
      const out: Partial<SocialSettings> = {};
      for (const k of ['appearOffline', 'friendsOnlyInvites', 'hideLocation'] as const) if (typeof s[k] === 'boolean') out[k] = s[k] as boolean;
      return { t: 'settings', settings: out };
    }
    case 'chat':
      if (!isStr(m.text, 2000)) return null;
      // a malformed replyTo drops the reference, never the message
      return isInt(m.replyTo) && m.replyTo > 0 ? { t: 'chat', text: m.text, replyTo: m.replyTo } : { t: 'chat', text: m.text };
    case 'react':
      return isInt(m.id) && m.id > 0 && typeof m.emoji === 'string' && isReactionEmoji(m.emoji)
        ? { t: 'react', id: m.id, emoji: m.emoji }
        : null;
    case 'dmReact':
      return isInt(m.id) && m.id > 0 && typeof m.emoji === 'string' && isReactionEmoji(m.emoji)
        ? { t: 'dmReact', id: m.id, emoji: m.emoji }
        : null;
    case 'dm':
      if (!isId(m.to) || !isStr(m.text, 2000)) return null;
      // a malformed replyTo drops the reference, never the message
      return isInt(m.replyTo) && m.replyTo > 0 ? { t: 'dm', to: m.to, text: m.text, replyTo: m.replyTo } : { t: 'dm', to: m.to, text: m.text };
    case 'dmHistory': return isId(m.with) ? { t: 'dmHistory', with: m.with, ...(isInt(m.before) ? { before: m.before } : {}) } : null;
    case 'read': return isId(m.with) ? { t: 'read', with: m.with } : null;
    case 'invite':
      if (!isId(m.to) || !isStr(m.code, 12) || !/^[A-Z0-9]+$/.test(m.code)) return null;
      return { t: 'invite', to: m.to, code: m.code, ...(isStr(m.mode, 20) ? { mode: m.mode } : {}), ...(isInt(m.seat) && m.seat >= 0 && m.seat < 8 ? { seat: m.seat } : {}) };
    case 'inviteReply': return isStr(m.id, 40) && typeof m.accept === 'boolean' ? { t: 'inviteReply', id: m.id, accept: m.accept } : null;
    case 'friend': return FRIEND_OPS.includes(m.op as never) && isId(m.to) ? { t: 'friend', op: m.op as (typeof FRIEND_OPS)[number], to: m.to } : null;
    case 'report':
      if (!['global', 'dm', 'user'].includes(m.kind as string)) return null;
      return { t: 'report', kind: m.kind as 'global' | 'dm' | 'user', ...(isInt(m.id) ? { id: m.id } : {}), ...(isId(m.user) ? { user: m.user } : {}), ...(isStr(m.reason, 400) ? { reason: m.reason } : {}) };
    case 'del': return isInt(m.id) ? { t: 'del', id: m.id } : null;
    default: return null;
  }
}

/** Short status line for the players list ("At a table · Cutthroat · 1 seat open"). */
export function statusLabel(s: PresenceStatus, modeName: (m: string) => string = (m) => m): string {
  switch (s.kind) {
    case 'online': return 'Online';
    case 'lobby': return `In lobby${s.open ? ` · ${s.open} seat${s.open > 1 ? 's' : ''} open` : ''}`;
    case 'tournament': return `In tournament${s.name ? ` · ${s.name}` : ''}`;
    case 'table': {
      const bits = ['At a table'];
      if (s.mode) bits.push(modeName(s.mode));
      if (s.offline) bits.push('vs bots');
      else if (s.open) bits.push(`${s.open} seat${s.open > 1 ? 's' : ''} open`);
      return bits.join(' · ');
    }
  }
}

/**
 * Join a presence base with its activity detail ("Online" + "At a table · Joker").
 * When the detail just repeats the base — statusLabel returns "Online" for a plain
 * online status — the base renders once, never "Online — Online".
 */
export function joinPresence(base: string, detail: string): string {
  const b = base.trim();
  const d = detail.trim();
  if (!d || d.toLowerCase() === b.toLowerCase()) return b;
  return `${b} — ${d}`;
}

/** Full presence line for profile headers: "Online", "Online — In lobby", … */
export function presenceLine(s: PresenceStatus, modeName: (m: string) => string = (m) => m): string {
  return joinPresence('Online', statusLabel(s, modeName));
}
