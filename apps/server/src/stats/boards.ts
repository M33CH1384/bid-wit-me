/** Release 9b: leaderboards, server stats, personal stat lines (D1 aggregates over game_players). */
export type Board = 'rating' | 'wins' | 'accuracy' | 'duos';
export type Period = 'all' | 'month' | 'week';
export interface BoardRow { rank: number; id: string; name: string; value: number; games: number; extra?: string }

const DAY = 86400_000;
export const since = (p: Period, now: number) => (p === 'week' ? now - 7 * DAY : p === 'month' ? now - 30 * DAY : 0);

export async function leaderboard(db: D1Database, o: { board: Board; kind: 'team' | 'cutthroat'; period: Period; region: string | null; now: number }): Promise<BoardRow[]> {
  const from = since(o.period, o.now);
  // local = same coarse region, and never anyone who hid their location
  const loc = o.region ? 'AND x.user_id IN (SELECT user_id FROM social_settings WHERE region = ? AND hide_location = 0)' : '';
  const locArgs = o.region ? [o.region] : [];
  let rows: { id: string; name: string | null; value: number; games: number; extra?: string }[] = [];
  if (o.board === 'rating' && o.period === 'all') {
    rows = (await db.prepare(`SELECT x.user_id AS id, u.username AS name, ROUND(x.elo) AS value, x.games AS games FROM ratings x JOIN users u ON u.id = x.user_id
      WHERE x.kind = ? AND x.games > 0 ${loc} ORDER BY x.elo DESC LIMIT 50`).bind(o.kind, ...locArgs).all<typeof rows[number]>()).results;
  } else if (o.board === 'rating') {
    // a period's rating board = Elo gained in it
    rows = (await db.prepare(`SELECT x.user_id AS id, u.username AS name, ROUND(SUM(x.elo_after - x.elo_before)) AS value, COUNT(*) AS games FROM game_players x JOIN users u ON u.id = x.user_id
      WHERE x.kind = ? AND x.ended_at >= ? AND x.elo_after IS NOT NULL ${loc} GROUP BY x.user_id ORDER BY value DESC LIMIT 50`).bind(o.kind, from, ...locArgs).all<typeof rows[number]>()).results;
  } else if (o.board === 'wins') {
    rows = (await db.prepare(`SELECT x.user_id AS id, u.username AS name, SUM(x.won) AS value, COUNT(*) AS games FROM game_players x JOIN users u ON u.id = x.user_id
      WHERE x.kind = ? AND x.ended_at >= ? ${loc} GROUP BY x.user_id HAVING value > 0 ORDER BY value DESC, games ASC LIMIT 50`).bind(o.kind, from, ...locArgs).all<typeof rows[number]>()).results;
  } else if (o.board === 'accuracy') {
    const min = o.period === 'all' ? 20 : 8;
    rows = (await db.prepare(`SELECT x.user_id AS id, u.username AS name,
        ROUND(100.0 * SUM(json_extract(x.stats, '$.made')) / SUM(json_extract(x.stats, '$.bids')), 1) AS value, COUNT(*) AS games, SUM(json_extract(x.stats, '$.bids')) AS extra
      FROM game_players x JOIN users u ON u.id = x.user_id
      WHERE x.kind = ? AND x.ended_at >= ? ${loc} GROUP BY x.user_id HAVING SUM(json_extract(x.stats, '$.bids')) >= ${min} ORDER BY value DESC, extra DESC LIMIT 50`).bind(o.kind, from, ...locArgs).all<typeof rows[number]>()).results
      .map((r) => ({ ...r, extra: `${r.extra} bids` }));
  } else {
    // best duos: signed-in partners, by wins together (team games only)
    const locD = o.region ? 'AND x.user_id IN (SELECT user_id FROM social_settings WHERE region = ? AND hide_location = 0) AND x.partner_id IN (SELECT user_id FROM social_settings WHERE region = ? AND hide_location = 0)' : '';
    rows = (await db.prepare(`SELECT x.user_id || ':' || x.partner_id AS id, u.username || ' + ' || p.username AS name, SUM(x.won) AS value, COUNT(*) AS games,
        ROUND(100.0 * SUM(x.won) / COUNT(*)) || '%' AS extra
      FROM game_players x JOIN users u ON u.id = x.user_id JOIN users p ON p.id = x.partner_id
      WHERE x.kind = 'team' AND x.partner_id IS NOT NULL AND x.user_id < x.partner_id AND x.ended_at >= ? ${locD}
      GROUP BY x.user_id, x.partner_id HAVING games >= 2 ORDER BY value DESC, games ASC LIMIT 50`).bind(from, ...locArgs, ...locArgs).all<typeof rows[number]>()).results;
  }
  return rows.map((r, i) => ({ rank: i + 1, id: o.board === 'duos' ? r.id : `u:${r.id}`, name: r.name ?? 'Player', value: Number(r.value) || 0, games: r.games, ...(r.extra ? { extra: String(r.extra) } : {}) }));
}

export async function serverStats(db: D1Database, now: number) {
  const [a, g, t, l] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM users WHERE username IS NOT NULL').first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN ended_at >= ? THEN 1 ELSE 0 END), 0) AS today, COALESCE(SUM(hands), 0) AS hands FROM games').bind(now - DAY).first<{ n: number; today: number; hands: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM tournaments WHERE status = 'finished'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM tournaments WHERE status IN ('upcoming','live')").first<{ n: number }>(),
  ]);
  return { accounts: a?.n ?? 0, games: g?.n ?? 0, gamesToday: g?.today ?? 0, hands: g?.hands ?? 0, tournamentsDone: t?.n ?? 0, tournamentsOpen: l?.n ?? 0 };
}

export interface PersonalStats {
  games: number; wins: number; streak: number; bestStreak: number;
  accuracy: number | null; booksPerHand: number | null; nil: string; shotsGiven: number; shotsTaken: number; wheels: number; bjWins: number;
  bidSec: number | null; playSec: number | null;
}

export async function personalStats(db: D1Database, uid: string): Promise<PersonalStats> {
  const rows = (await db.prepare('SELECT won, stats FROM game_players WHERE user_id = ? ORDER BY ended_at ASC').bind(uid).all<{ won: number; stats: string }>()).results;
  const s = { games: 0, wins: 0, streak: 0, bestStreak: 0, bids: 0, made: 0, books: 0, hands: 0, nilBids: 0, nilMade: 0, shotsGiven: 0, shotsTaken: 0, wheels: 0, bjWins: 0, bidMs: 0, bidN: 0, playMs: 0, playN: 0 };
  let run = 0;
  for (const r of rows) {
    let st: Record<string, number> = {};
    try { st = JSON.parse(r.stats); } catch { /* skip */ }
    s.games++;
    if (r.won) { s.wins++; run++; s.bestStreak = Math.max(s.bestStreak, run); } else run = 0;
    for (const k of ['bids', 'made', 'books', 'hands', 'nilBids', 'nilMade', 'shotsGiven', 'shotsTaken', 'wheels', 'bjWins', 'bidMs', 'bidN', 'playMs', 'playN'] as const) s[k] += Number(st[k]) || 0;
  }
  s.streak = run;
  return {
    games: s.games, wins: s.wins, streak: s.streak, bestStreak: s.bestStreak,
    accuracy: s.bids ? Math.round((1000 * s.made) / s.bids) / 10 : null,
    booksPerHand: s.hands ? Math.round((100 * s.books) / s.hands) / 100 : null,
    nil: `${s.nilMade}/${s.nilBids}`, shotsGiven: s.shotsGiven, shotsTaken: s.shotsTaken, wheels: s.wheels, bjWins: s.bjWins,
    bidSec: s.bidN ? Math.round(s.bidMs / s.bidN / 100) / 10 : null, playSec: s.playN ? Math.round(s.playMs / s.playN / 100) / 10 : null,
  };
}
