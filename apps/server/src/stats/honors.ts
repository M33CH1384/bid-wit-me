/**
 * League Awards + Record Book (league P-F, Demetrius 2026-10-20).
 *
 * Season awards come from season_ratings (wins / win %) and the per-game
 * stat JSON in game_players (Wheels, Bostons) scoped to the current season.
 * The Record Book is all-time: ratings.peak for the highest rating ever,
 * game_players aggregates for wins / Wheels / Bostons / win %.
 *
 * DROPPED, honestly: "longest streak" honors. Streaks aren't stored
 * anywhere — personalStats derives them by replaying a player's games in
 * order; computing that for every player on each request is a full-base
 * replay, so no streak honor is offered rather than an approximated one.
 * An honor with no qualifying player (e.g. no Wheels yet) is omitted.
 */
import { ensureSeason } from '../cred/seasons';

export interface Honor { id: string; label: string; userId: string; name: string; value: string }

const FINISHED = "COALESCE(g.end_reason, 'finished') != 'abandoned'";

async function topBy(db: D1Database, sql: string, binds: unknown[], id: string, label: string, fmt: (v: number, games: number) => string): Promise<Honor | null> {
  const row = await db.prepare(sql).bind(...binds).first<{ user_id: string; name: string | null; v: number; games: number }>();
  if (!row || !(row.v > 0)) return null;
  return { id, label, userId: row.user_id, name: row.name ?? 'Player', value: fmt(row.v, row.games) };
}

export async function leagueHonors(db: D1Database, now: number): Promise<{ season: string; awards: Honor[]; records: Honor[] }> {
  const season = await ensureSeason(db, now);
  const awards: (Honor | null)[] = await Promise.all([
    topBy(db,
      `SELECT sr.user_id AS user_id, u.username AS name, SUM(sr.wins) AS v, SUM(sr.games) AS games
       FROM season_ratings sr JOIN users u ON u.id = sr.user_id
       WHERE sr.season_id = ? GROUP BY sr.user_id ORDER BY v DESC, games ASC LIMIT 1`,
      [season.id], 'most-wins', 'Most wins this season', (v) => `${v} wins`),
    topBy(db,
      `SELECT sr.user_id AS user_id, u.username AS name, ROUND(100.0 * SUM(sr.wins) / SUM(sr.games), 1) AS v, SUM(sr.games) AS games
       FROM season_ratings sr JOIN users u ON u.id = sr.user_id
       WHERE sr.season_id = ? GROUP BY sr.user_id HAVING games >= 10 ORDER BY v DESC, games DESC LIMIT 1`,
      [season.id], 'best-winpct', 'Best win % this season', (v, g) => `${v}% over ${g} games`),
    topBy(db,
      `SELECT gp.user_id AS user_id, u.username AS name, SUM(json_extract(gp.stats, '$.wheels')) AS v, COUNT(*) AS games
       FROM game_players gp JOIN games g ON g.id = gp.game_id JOIN users u ON u.id = gp.user_id
       WHERE gp.ended_at >= ? AND ${FINISHED} GROUP BY gp.user_id ORDER BY v DESC LIMIT 1`,
      [season.startsAt], 'most-wheels', 'Most Wheels this season', (v) => `${v} Wheels`),
    topBy(db,
      `SELECT gp.user_id AS user_id, u.username AS name, SUM(json_extract(gp.stats, '$.bjWins')) AS v, COUNT(*) AS games
       FROM game_players gp JOIN games g ON g.id = gp.game_id JOIN users u ON u.id = gp.user_id
       WHERE gp.ended_at >= ? AND ${FINISHED} GROUP BY gp.user_id ORDER BY v DESC LIMIT 1`,
      [season.startsAt], 'most-bostons', 'Most Bostons this season', (v) => `${v} Bostons`),
  ]);
  const records: (Honor | null)[] = await Promise.all([
    topBy(db,
      `SELECT r.user_id AS user_id, u.username AS name, ROUND(r.peak) AS v, r.games AS games
       FROM ratings r JOIN users u ON u.id = r.user_id ORDER BY r.peak DESC LIMIT 1`,
      [], 'peak-rating', 'Highest rating ever', (v) => `${v}`),
    topBy(db,
      `SELECT gp.user_id AS user_id, u.username AS name, SUM(gp.won) AS v, COUNT(*) AS games
       FROM game_players gp JOIN games g ON g.id = gp.game_id JOIN users u ON u.id = gp.user_id
       WHERE ${FINISHED} GROUP BY gp.user_id ORDER BY v DESC, games ASC LIMIT 1`,
      [], 'most-wins-ever', 'Most wins all-time', (v) => `${v} wins`),
    topBy(db,
      `SELECT gp.user_id AS user_id, u.username AS name, SUM(json_extract(gp.stats, '$.wheels')) AS v, COUNT(*) AS games
       FROM game_players gp JOIN games g ON g.id = gp.game_id JOIN users u ON u.id = gp.user_id
       WHERE ${FINISHED} GROUP BY gp.user_id ORDER BY v DESC LIMIT 1`,
      [], 'most-wheels-ever', 'Most Wheels all-time', (v) => `${v} Wheels`),
    topBy(db,
      `SELECT gp.user_id AS user_id, u.username AS name, SUM(json_extract(gp.stats, '$.bjWins')) AS v, COUNT(*) AS games
       FROM game_players gp JOIN games g ON g.id = gp.game_id JOIN users u ON u.id = gp.user_id
       WHERE ${FINISHED} GROUP BY gp.user_id ORDER BY v DESC LIMIT 1`,
      [], 'most-bostons-ever', 'Most Bostons all-time', (v) => `${v} Bostons`),
    topBy(db,
      `SELECT gp.user_id AS user_id, u.username AS name, ROUND(100.0 * SUM(gp.won) / COUNT(*), 1) AS v, COUNT(*) AS games
       FROM game_players gp JOIN games g ON g.id = gp.game_id JOIN users u ON u.id = gp.user_id
       WHERE ${FINISHED} GROUP BY gp.user_id HAVING games >= 20 ORDER BY v DESC, games DESC LIMIT 1`,
      [], 'best-winpct-ever', 'Best win % all-time', (v, g) => `${v}% over ${g} games`),
  ]);
  const keep = (xs: (Honor | null)[]) => xs.filter((x): x is Honor => x !== null);
  return { season: season.name, awards: keep(awards), records: keep(records) };
}
