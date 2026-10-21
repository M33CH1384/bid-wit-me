/**
 * League Awards + Record Book (league P-F, Demetrius 2026-10-20).
 *
 * Season awards come from season_ratings (wins / win %) and the per-game
 * stat JSON in game_players (Wheels, Bostons) scoped to the current season.
 * The Record Book is all-time: ratings.peak for the highest rating ever,
 * game_players aggregates for wins / Wheels / Bostons / win %.
 *
 * Streak records (league data wave, item 3): streaks ARE stored — the cred
 * system keeps cred_totals (cur_streak / best_streak per player per kind),
 * bumped at every game credit, with a one-time ordered-replay backfill for
 * players who predate a row (totalsFor in cred/hooks). The honors read
 * backfills any (player, kind) pair still missing a row, then reads the
 * records off the stored totals. There is deliberately NO season streak
 * award: the stored totals are lifetime, and a "this season" streak would
 * need a season-scoped replay — mislabeling the lifetime number as a
 * season one would be fabrication.
 * An honor with no qualifying player (e.g. no Wheels yet) is omitted.
 */
import { ensureSeason } from '../cred/seasons';
import { totalsFor } from '../cred/hooks';

export interface Honor { id: string; label: string; userId: string; name: string; value: string }

const FINISHED = "COALESCE(g.end_reason, 'finished') != 'abandoned'";

async function topBy(db: D1Database, sql: string, binds: unknown[], id: string, label: string, fmt: (v: number, games: number) => string): Promise<Honor | null> {
  const row = await db.prepare(sql).bind(...binds).first<{ user_id: string; name: string | null; v: number; games: number }>();
  if (!row || !(row.v > 0)) return null;
  return { id, label, userId: row.user_id, name: row.name ?? 'Player', value: fmt(row.v, row.games) };
}

/**
 * Backfill cred_totals for any (player, kind) with recorded games but no
 * totals row yet — totalsFor replays that player's stored history in order
 * once and stores it, so the streak records below read stored aggregates
 * for everyone, not just players the cred path has credited since. Bounded
 * per read; the steady state (no missing rows) costs one DISTINCT check.
 */
async function ensureStreakCoverage(db: D1Database): Promise<void> {
  const missing = (await db.prepare(`SELECT DISTINCT gp.user_id AS user_id, gp.kind AS kind FROM game_players gp
    LEFT JOIN cred_totals ct ON ct.user_id = gp.user_id AND ct.kind = gp.kind
    WHERE ct.user_id IS NULL LIMIT 100`).all<{ user_id: string; kind: string }>()).results;
  for (const m of missing) {
    await totalsFor(db, m.user_id, m.kind === 'cutthroat' ? 'cutthroat' : 'team').catch(() => undefined);
  }
}

const kindLabel = (kind: string) => (kind === 'cutthroat' ? 'Cutthroat' : 'Partnership');

/** The all-time streak record off the stored totals (one row across kinds). */
async function streakRecord(db: D1Database, column: 'best_streak' | 'cur_streak', min: number, id: string, label: string, fmt: (v: number, kind: string) => string): Promise<Honor | null> {
  const row = await db.prepare(`SELECT ct.user_id AS user_id, u.username AS name, ct.${column} AS v, ct.kind AS kind
    FROM cred_totals ct JOIN users u ON u.id = ct.user_id
    WHERE ct.${column} >= ? ORDER BY ct.${column} DESC, ct.games DESC LIMIT 1`)
    .bind(min).first<{ user_id: string; name: string | null; v: number; kind: string }>();
  if (!row) return null;
  return { id, label, userId: row.user_id, name: row.name ?? 'Player', value: fmt(row.v, row.kind) };
}

export async function leagueHonors(db: D1Database, now: number): Promise<{ season: string; awards: Honor[]; records: Honor[] }> {
  const season = await ensureSeason(db, now);
  await ensureStreakCoverage(db).catch(() => undefined);
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
    // Streak records from the stored cred_totals (see the header note). A
    // "current streak" under 3 isn't a record worth printing.
    streakRecord(db, 'best_streak', 2, 'longest-streak', 'Longest win streak', (v, kind) => `${v} straight wins · ${kindLabel(kind)}`),
    streakRecord(db, 'cur_streak', 3, 'current-streak', 'Current win streak', (v, kind) => `${v} straight and counting · ${kindLabel(kind)}`),
  ]);
  const keep = (xs: (Honor | null)[]) => xs.filter((x): x is Honor => x !== null);
  return { season: season.name, awards: keep(awards), records: keep(records) };
}
