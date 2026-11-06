/**
 * Team rosters (owner, 2026-11-05; migration 0038): a team name is an owned
 * team — the owner plus up to ROSTER_MAX_MEMBERS human partners. Rosters are
 * per (owner, name): the same string on another player's record is their own
 * team. Bot partners never appear here — they hold no account, take no spot,
 * and bot games field any name freely, exactly as before.
 *
 * A human partner joins when a game is recorded under the name with them
 * (see the saveRecord hook in stats/record.ts), if a spot is free. The owner
 * ejects from My Career; ejecting deletes only the member row — the recorded
 * history (game_players) that every team record aggregates is never touched.
 *
 * Grandfathering: the first time a roster is materialised (first read or
 * first join), it seeds from the owner's recorded history under the name —
 * their most-played human partners (partner_id rows), up to the cap. The
 * team_rosters header row is the seeded marker: once it exists, seeding
 * never runs again, so an owner who ejects everyone stays ejected.
 */

export const ROSTER_MAX_MEMBERS = 3;

export interface RosterMemberOut { id: string; name: string }
export interface RosterOut { name: string; members: RosterMemberOut[]; full: boolean }

/** Materialise the (owner, name) roster if it has never existed, seeding it
 *  from the owner's recorded human partners under the name. Idempotent. */
export async function ensureRoster(db: D1Database, ownerId: string, name: string, now: number): Promise<void> {
  if (!ownerId || !name) return;
  const head = await db.prepare('SELECT 1 AS ok FROM team_rosters WHERE owner_id = ? AND team_name = ?')
    .bind(ownerId, name).first<{ ok: number }>();
  if (head) return;
  const seeds = (await db.prepare(`SELECT partner_id AS pid, COUNT(*) AS n, MIN(ended_at) AS first_at
      FROM game_players
      WHERE user_id = ? AND team_name = ? AND partner_id IS NOT NULL AND partner_id <> ?
      GROUP BY partner_id ORDER BY n DESC, first_at ASC LIMIT ?`)
    .bind(ownerId, name, ownerId, ROSTER_MAX_MEMBERS).all<{ pid: string }>()).results;
  const stmts = [
    db.prepare('INSERT OR IGNORE INTO team_rosters (owner_id, team_name, created_at) VALUES (?, ?, ?)')
      .bind(ownerId, name, now),
    ...seeds.map((s) => db.prepare('INSERT OR IGNORE INTO team_roster_members (owner_id, team_name, member_id, joined_at) VALUES (?, ?, ?, ?)')
      .bind(ownerId, name, s.pid, now)),
  ];
  await db.batch(stmts);
}

/** Current member ids, in the order they joined. Seeded members share a
 *  joined_at, so the rowid tiebreak keeps their seed rank (most games
 *  first) instead of falling back to alphabetical. */
export async function rosterMemberIds(db: D1Database, ownerId: string, name: string): Promise<string[]> {
  const rows = (await db.prepare('SELECT member_id AS id FROM team_roster_members WHERE owner_id = ? AND team_name = ? ORDER BY joined_at ASC, rowid ASC')
    .bind(ownerId, name).all<{ id: string }>()).results;
  return rows.map((r) => r.id);
}

/** Add a human partner to the owner's roster for `name` if a spot is free.
 *  Returns true when the member was added by this call. */
export async function joinRoster(db: D1Database, ownerId: string, name: string, memberId: string, now: number): Promise<boolean> {
  if (!ownerId || !name || !memberId || memberId === ownerId) return false;
  await ensureRoster(db, ownerId, name, now);
  const ids = await rosterMemberIds(db, ownerId, name);
  if (ids.includes(memberId) || ids.length >= ROSTER_MAX_MEMBERS) return false;
  await db.prepare('INSERT OR IGNORE INTO team_roster_members (owner_id, team_name, member_id, joined_at) VALUES (?, ?, ?, ?)')
    .bind(ownerId, name, memberId, now).run();
  return true;
}

/** Remove a member (the spot frees immediately). Returns true when a row went. */
export async function ejectFromRoster(db: D1Database, ownerId: string, name: string, memberId: string): Promise<boolean> {
  const r = await db.prepare('DELETE FROM team_roster_members WHERE owner_id = ? AND team_name = ? AND member_id = ?')
    .bind(ownerId, name, memberId).run();
  return (r.meta?.changes ?? 0) > 0;
}

/** One roster as the management surfaces show it: members resolved to display
 *  names, rows whose account is gone dropped from view (they keep no spot in
 *  spirit — but the row is only removed by an eject, never silently). */
export async function rosterOut(db: D1Database, ownerId: string, name: string, now: number): Promise<RosterOut> {
  await ensureRoster(db, ownerId, name, now);
  const rows = (await db.prepare(`SELECT m.member_id AS id, u.username AS name FROM team_roster_members m
      JOIN users u ON u.id = m.member_id
      WHERE m.owner_id = ? AND m.team_name = ? ORDER BY m.joined_at ASC, m.rowid ASC`)
    .bind(ownerId, name).all<{ id: string; name: string | null }>()).results;
  const members = rows.map((r) => ({ id: r.id, name: r.name ?? 'Player' }));
  return { name, members, full: members.length >= ROSTER_MAX_MEMBERS };
}

/** The caller's team names, derived exactly as profileFor derives the
 *  profile chips: their own recorded names by game count (top 6), with the
 *  retired global progress name first when it isn't already there. */
export async function myTeamNameList(db: D1Database, uid: string): Promise<string[]> {
  const names = (await db.prepare('SELECT team_name, COUNT(*) AS n FROM game_players WHERE user_id = ? AND team_name IS NOT NULL GROUP BY team_name ORDER BY n DESC LIMIT 6')
    .bind(uid).all<{ team_name: string }>()).results.map((r) => r.team_name);
  const prog = await db.prepare('SELECT data FROM progress WHERE user_id = ?').bind(uid).first<{ data: string }>();
  let legacy: string | null = null;
  try { legacy = (prog ? JSON.parse(prog.data) : null)?.teamName ?? null; } catch { /* ignore */ }
  if (legacy && !names.includes(legacy)) names.unshift(legacy);
  return names.slice(0, 6);
}

/** Every roster on the caller's own team list (My Career management view). */
export async function myRosters(db: D1Database, uid: string, now: number): Promise<RosterOut[]> {
  const names = await myTeamNameList(db, uid);
  return Promise.all(names.map((n) => rosterOut(db, uid, n, now)));
}
