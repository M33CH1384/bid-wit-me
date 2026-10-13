import { type OpenTable, type PresenceEntry, stalePresence } from '@spades/protocol';

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
