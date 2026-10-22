import { PRESENCE_STALE_MS, activityLabel, activityOf, statusLabel, type FriendRef, type OpenTable, type PresenceEntry, type PresenceStatus, stalePresence } from '@spades/protocol';

/**
 * The Friends-row "Last online …" label for a friend's last_seen stamp
 * (epoch ms, friends-only payload — see FriendRef.lastSeen). Same compact
 * family as the Recent list's timeAgo: minutes/hours/days with "ago",
 * then an absolute short date past ~30 days.
 */
export function lastOnlineLabel(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * True when a room snapshot carries a story descriptor (co-op spec §2.3:
 * RoomData.story, mirrored onto the client's RoomInfo by the co-op build).
 * Read defensively — until that build lands no room carries one, and the
 * story-coop presence state simply never reports.
 */
export function roomHasStory(room: object | null | undefined): boolean {
  return !!(room as { story?: unknown } | null | undefined)?.story;
}

/**
 * The Friends-tab line for a LIVE status (owner, 2026-10-22): the activity
 * in the game's language — "In a bot game", "In a match", "Story mode ·
 * Solo" — keeping the detail the old statusLabel carried where it earns
 * its place (lobby seats, tournament name, match mode).
 */
export function friendStatusLabel(s: PresenceStatus, modeName: (m: string) => string = (m) => m): string {
  if (s.story) return activityLabel(activityOf(s));
  switch (activityOf(s)) {
    case 'bot-game': return 'In a bot game';
    case 'online-match':
      return s.kind === 'tournament' ? statusLabel(s, modeName) : `In a match${s.mode ? ` · ${modeName(s.mode)}` : ''}`;
    default:
      return s.kind === 'lobby' ? statusLabel(s, modeName) : 'Online';
  }
}

export interface FriendPresenceView { label: string; online: boolean }

/**
 * The Friends-row presence for one friend (owner, 2026-10-22), freshest
 * honest source first: the live hub entry; then the persisted activity
 * (FriendRef.presence) while it is fresh (PRESENCE_STALE_MS) — a fresh
 * report means their app is open even when this client holds no live row
 * for them, so the row reads as online with that activity; then the
 * existing last-online line, whose stamp is the max of the server ref, this
 * session's remembered activity, and the presence row's own time (a stale
 * presence row is still proof of when they were last active).
 */
export function friendPresenceView(
  ref: { lastSeen?: number; presence?: FriendRef['presence'] },
  live: PresenceEntry | undefined,
  sessionLastAt: number,
  modeName: (m: string) => string = (m) => m,
  now = Date.now(),
): FriendPresenceView {
  if (live) return { label: friendStatusLabel(live.status, modeName), online: true };
  const p = ref.presence;
  if (p && now - p.at <= PRESENCE_STALE_MS) return { label: activityLabel(p.activity), online: true };
  const seenAt = Math.max(ref.lastSeen ?? 0, sessionLastAt, p?.at ?? 0);
  return { label: seenAt ? `Last online ${lastOnlineLabel(seenAt, now)}` : 'Offline', online: false };
}

/** Players-list rows after ended tables and old sessions are removed. */
export function shownPlayers(
  users: Iterable<PresenceEntry>,
  tables: Record<string, OpenTable>,
  ended: Iterable<string>,
  now: number,
): PresenceEntry[] {
  const listed = Object.values(tables);
  return [...users].filter((u) => !stalePresence(u, listed, ended, now));
}

/** Drop those rows from the presence map. Same object when nothing changed. */
export function keepUsers(
  users: Record<string, PresenceEntry>,
  tables: Record<string, OpenTable>,
  ended: Iterable<string>,
  now: number,
): Record<string, PresenceEntry> {
  const listed = Object.values(tables);
  const out: Record<string, PresenceEntry> = {};
  let dropped = false;
  for (const u of Object.values(users)) {
    if (stalePresence(u, listed, ended, now)) { dropped = true; continue; }
    out[u.id] = u;
  }
  return dropped ? out : users;
}
