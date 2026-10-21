import { type OpenTable, type PresenceEntry, stalePresence } from '@spades/protocol';

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
