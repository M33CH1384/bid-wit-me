/**
 * Release 9: the Social hub protocol (one Social Durable Object: presence, invites, global chat, DMs, friends).
 * Identity comes from the connection (a short-lived signed account ticket, or none = guest), never from messages.
 */

export const SOCIAL_LIMITS = {
  chatMax: 300,          // characters per global/DM message
  globalKeep: 200,       // global chat lines kept
  globalSend: 50,        // sent on connect
  dmPage: 50,
  inviteTtlMs: 60_000,
  /** per user: messages (global + DMs) in a sliding window */
  chatBurst: { n: 5, windowMs: 10_000 },
  chatMinute: { n: 20, windowMs: 60_000 },
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
  /** offline game vs bots (nobody can join) */
  offline?: boolean;
  /** tournament name */
  name?: string;
}

export interface PresenceEntry {
  /** 'u:<userId>' for accounts, 'g:<random>' for guests */
  id: string;
  name: string;
  guest: boolean;
  status: PresenceStatus;
  /** Elo per pool (accounts with rated games only) */
  rating?: { team?: number; cutthroat?: number };
}

export interface SocialChatLine { id: number; from: string; name: string; text: string; at: number; admin?: boolean }
export interface DmLine { id: number; from: string; to: string; text: string; at: number; read?: boolean }
export interface FriendRef { id: string; name: string; since?: number }
export interface FriendsState { friends: FriendRef[]; incoming: FriendRef[]; outgoing: FriendRef[]; blocked: FriendRef[] }
export interface SocialSettings { appearOffline: boolean; friendsOnlyInvites: boolean; hideLocation: boolean }
export interface InviteMsg { id: string; from: string; fromName: string; code: string; mode?: string; seat?: number; expiresAt: number }

export type SocialClientMsg =
  | { t: 'status'; status: PresenceStatus }
  | { t: 'settings'; settings: Partial<SocialSettings> }
  | { t: 'chat'; text: string }
  | { t: 'dm'; to: string; text: string }
  | { t: 'dmHistory'; with: string; before?: number }
  | { t: 'read'; with: string }
  | { t: 'invite'; to: string; code: string; mode?: string; seat?: number }
  | { t: 'inviteReply'; id: string; accept: boolean }
  | { t: 'friend'; op: 'request' | 'accept' | 'decline' | 'remove' | 'block' | 'unblock'; to: string }
  | { t: 'report'; kind: 'global' | 'dm' | 'user'; id?: number; user?: string; reason?: string }
  | { t: 'del'; id: number };

export type SocialServerMsg =
  | { t: 'hello'; you: PresenceEntry; admin: boolean; users: PresenceEntry[]; global: SocialChatLine[]; friends: FriendsState | null; settings: SocialSettings | null; unread: Record<string, number> }
  | { t: 'pres'; up?: PresenceEntry[]; gone?: string[] }
  | { t: 'chat'; line: SocialChatLine }
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
  return out;
}

/** Validate a client message (anything malformed → null, dropped). */
export function parseSocialMsg(raw: unknown): SocialClientMsg | null {
  let m: Record<string, unknown>;
  try { m = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>); } catch { return null; }
  if (!m || typeof m !== 'object') return null;
  switch (m.t) {
    case 'status': { const s = parseStatus(m.status); return s ? { t: 'status', status: s } : null; }
    case 'settings': {
      const s = (m.settings ?? {}) as Record<string, unknown>;
      const out: Partial<SocialSettings> = {};
      for (const k of ['appearOffline', 'friendsOnlyInvites', 'hideLocation'] as const) if (typeof s[k] === 'boolean') out[k] = s[k] as boolean;
      return { t: 'settings', settings: out };
    }
    case 'chat': return isStr(m.text, 2000) ? { t: 'chat', text: m.text } : null;
    case 'dm': return isId(m.to) && isStr(m.text, 2000) ? { t: 'dm', to: m.to, text: m.text } : null;
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
