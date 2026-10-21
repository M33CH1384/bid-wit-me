/**
 * Power Rankings (league P-E, Demetrius 2026-10-20): a weekly Top 10 per
 * kind with movement against last week.
 *
 * SNAPSHOT MECHANISM: the first leaderboard read of each ISO week captures
 * the week's snapshot (both kinds, top 25 stored) into
 * league_power_snapshots — see ensurePowerSnapshot, called from the
 * leaderboard route. Movement compares against the PREVIOUS week's stored
 * snapshot, so it never drifts as live ratings change mid-week. The first
 * week has no predecessor: every row reads "new".
 *
 * POWER SCORE (documented formula): power = current rating
 *   + 2 × (win % over the last 14 days − 50)
 * so recent form moves a player at most ±100 around their rating; a player
 * with no games in the window gets a neutral form term (0). Eligibility
 * mirrors the rating board: at least 5 rated games in the kind.
 */
const DAY = 86400_000;
const FORM_WINDOW_MS = 14 * DAY;

/** ISO-8601 week key, e.g. '2026-W43' (UTC). */
export function isoWeekKey(now: number): string {
  const d = new Date(now);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const fday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fday + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * DAY));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The previous ISO week's key (via the Thursday anchor, 7 days back). */
export function prevWeekKey(now: number): string {
  return isoWeekKey(now - 7 * DAY);
}

/** power = rating + 2 × (recent win % − 50); no recent games → neutral. */
export function powerScore(rating: number, recentWins: number, recentGames: number): number {
  if (!recentGames) return Math.round(rating);
  return Math.round(rating + 2 * ((100 * recentWins) / recentGames - 50));
}

interface PowerRow { user_id: string; power: number }

async function computePower(db: D1Database, kind: 'team' | 'cutthroat', now: number): Promise<PowerRow[]> {
  const rows = (await db.prepare(`SELECT r.user_id AS user_id, r.elo AS elo,
      COUNT(gp.game_id) AS recent_games, COALESCE(SUM(CASE WHEN gp.won = 1 THEN 1 ELSE 0 END), 0) AS recent_wins
    FROM ratings r JOIN users u ON u.id = r.user_id
    LEFT JOIN game_players gp ON gp.user_id = r.user_id AND gp.kind = ? AND gp.ended_at >= ?
      AND EXISTS (SELECT 1 FROM games g WHERE g.id = gp.game_id AND COALESCE(g.end_reason, 'finished') != 'abandoned')
    WHERE r.kind = ? AND r.games >= 5
    GROUP BY r.user_id, r.elo`)
    .bind(kind, now - FORM_WINDOW_MS, kind).all<{ user_id: string; elo: number; recent_games: number; recent_wins: number }>()).results;
  return rows
    .map((r) => ({ user_id: r.user_id, power: powerScore(r.elo, r.recent_wins, r.recent_games) }))
    .sort((a, b) => b.power - a.power)
    .slice(0, 25);
}

/** Capture this week's snapshot if it doesn't exist yet (both kinds). */
export async function ensurePowerSnapshot(db: D1Database, now: number): Promise<void> {
  const week = isoWeekKey(now);
  const existing = await db.prepare('SELECT COUNT(*) AS n FROM league_power_snapshots WHERE week = ?').bind(week).first<{ n: number }>();
  if (existing && existing.n > 0) return;
  for (const kind of ['team', 'cutthroat'] as const) {
    const rows = await computePower(db, kind, now);
    for (const [i, r] of rows.entries()) {
      await db.prepare('INSERT OR IGNORE INTO league_power_snapshots (week, kind, user_id, power, rank) VALUES (?, ?, ?, ?, ?)')
        .bind(week, kind, r.user_id, r.power, i + 1).run();
    }
  }
}

export interface PowerRankingRow {
  rank: number; id: string; name: string; power: number; rating: number;
  /** places moved vs last week's snapshot (positive = up), 0 = same, 'new' = not ranked last week */
  movement: number | 'new';
}

/** The current week's Top 10 with movement vs last week's snapshot. */
export async function powerRankings(db: D1Database, kind: 'team' | 'cutthroat', now: number): Promise<{ week: string; hasPrev: boolean; rows: PowerRankingRow[] }> {
  await ensurePowerSnapshot(db, now);
  const week = isoWeekKey(now);
  const prev = prevWeekKey(now);
  const [cur, prevRows, ratings] = await Promise.all([
    db.prepare(`SELECT s.user_id AS user_id, s.power AS power, s.rank AS rank, u.username AS name
      FROM league_power_snapshots s JOIN users u ON u.id = s.user_id
      WHERE s.week = ? AND s.kind = ? ORDER BY s.rank ASC LIMIT 10`).bind(week, kind).all<{ user_id: string; power: number; rank: number; name: string | null }>(),
    db.prepare('SELECT user_id, rank FROM league_power_snapshots WHERE week = ? AND kind = ?').bind(prev, kind).all<{ user_id: string; rank: number }>(),
    db.prepare('SELECT user_id, elo FROM ratings WHERE kind = ?').bind(kind).all<{ user_id: string; elo: number }>(),
  ]);
  const prevRank = new Map(prevRows.results.map((r) => [r.user_id, r.rank]));
  const elo = new Map(ratings.results.map((r) => [r.user_id, Math.round(r.elo)]));
  return {
    week,
    hasPrev: prevRows.results.length > 0,
    rows: cur.results.map((r) => ({
      rank: r.rank,
      id: `u:${r.user_id}`,
      name: r.name ?? 'Player',
      power: r.power,
      rating: elo.get(r.user_id) ?? r.power,
      movement: !prevRows.results.length ? 'new' : prevRank.has(r.user_id) ? prevRank.get(r.user_id)! - r.rank : 'new',
    })),
  };
}
