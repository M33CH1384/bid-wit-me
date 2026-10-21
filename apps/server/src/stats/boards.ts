/** Release 9b: leaderboards, server stats, personal stat lines (D1 aggregates over game_players). */
export type Board = 'rating' | 'wins' | 'accuracy' | 'duos';
export type Period = 'all' | 'month' | 'week';
export interface BoardRow { rank: number; id: string; name: string; value: number; games: number; extra?: string; vsPlayers?: number; vsBots?: number }

/** Who the opponents were, from the seats stored on the game. Guest opponents are 'other' (neither bucket). */
export type OpponentBucket = 'players' | 'bots' | 'other';
export function opponentBucket(seats: { side: number; kind: string }[], side: number): OpponentBucket {
  const opp = seats.filter((s) => Number(s.side) !== side);
  if (opp.some((s) => s.kind === 'user')) return 'players';
  if (opp.length > 0 && opp.every((s) => s.kind === 'bot')) return 'bots';
  return 'other';
}

const VS_PLAYERS = `EXISTS (SELECT 1 FROM json_each(g.seats) je WHERE json_extract(je.value, '$.kind') = 'user' AND json_extract(je.value, '$.side') != x.side)`;
const VS_BOTS = `EXISTS (SELECT 1 FROM json_each(g.seats) je WHERE json_extract(je.value, '$.side') != x.side) AND NOT EXISTS (SELECT 1 FROM json_each(g.seats) je WHERE json_extract(je.value, '$.side') != x.side AND json_extract(je.value, '$.kind') != 'bot')`;

const DAY = 86400_000;
export const since = (p: Period, now: number) => (p === 'week' ? now - 7 * DAY : p === 'month' ? now - 30 * DAY : 0);

export async function leaderboard(db: D1Database, o: { board: Board; kind: 'team' | 'cutthroat'; period: Period; region: string | null; declaredRegion?: string | null; now: number }): Promise<BoardRow[]> {
  const from = since(o.period, o.now);
  // local = same coarse region, and never anyone who hid their location
  const loc = o.region ? 'AND x.user_id IN (SELECT user_id FROM social_settings WHERE region = ? AND hide_location = 0)' : '';
  const locArgs = o.region ? [o.region] : [];
  // regions (league P-B) = same SELF-DECLARED region (users.region); duos keep
  // a pair when either partner declared it
  const decl = o.declaredRegion ? 'AND u.region = ?' : '';
  const declArgs = o.declaredRegion ? [o.declaredRegion] : [];
  let rows: { id: string; name: string | null; value: number; games: number; extra?: string }[] = [];
  if (o.board === 'rating' && o.period === 'all') {
    rows = (await db.prepare(`SELECT x.user_id AS id, u.username AS name, ROUND(x.elo) AS value, x.games AS games FROM ratings x JOIN users u ON u.id = x.user_id
      WHERE x.kind = ? AND x.games > 0 ${loc} ${decl} ORDER BY x.elo DESC LIMIT 50`).bind(o.kind, ...locArgs, ...declArgs).all<typeof rows[number]>()).results;
  } else if (o.board === 'rating') {
    // a period's rating board = Elo gained in it
    rows = (await db.prepare(`SELECT x.user_id AS id, u.username AS name, ROUND(SUM(x.elo_after - x.elo_before)) AS value, COUNT(*) AS games FROM game_players x JOIN users u ON u.id = x.user_id
      WHERE x.kind = ? AND x.ended_at >= ? AND x.elo_after IS NOT NULL ${loc} ${decl} GROUP BY x.user_id ORDER BY value DESC LIMIT 50`).bind(o.kind, from, ...locArgs, ...declArgs).all<typeof rows[number]>()).results;
  } else if (o.board === 'wins') {
    // vs players: at least one opponent was signed in. vs bots: every opponent was a bot. Guest wins are neither.
    rows = (await db.prepare(`SELECT x.user_id AS id, u.username AS name,
        SUM(CASE WHEN x.won = 1 AND ${VS_PLAYERS} THEN 1 ELSE 0 END) AS value,
        SUM(CASE WHEN x.won = 1 AND ${VS_BOTS} THEN 1 ELSE 0 END) AS vs_bots,
        COUNT(*) AS games
      FROM game_players x JOIN users u ON u.id = x.user_id JOIN games g ON g.id = x.game_id
      WHERE x.kind = ? AND x.ended_at >= ? AND COALESCE(g.end_reason, 'finished') != 'abandoned' ${loc} ${decl} GROUP BY x.user_id HAVING value > 0 OR vs_bots > 0 ORDER BY value DESC, vs_bots DESC, games ASC LIMIT 50`).bind(o.kind, from, ...locArgs, ...declArgs).all<typeof rows[number] & { vs_bots?: number }>()).results;
  } else if (o.board === 'accuracy') {
    const min = o.period === 'all' ? 20 : 8;
    rows = (await db.prepare(`SELECT x.user_id AS id, u.username AS name,
        ROUND(100.0 * SUM(json_extract(x.stats, '$.made')) / SUM(json_extract(x.stats, '$.bids')), 1) AS value, COUNT(*) AS games, SUM(json_extract(x.stats, '$.bids')) AS extra
      FROM game_players x JOIN users u ON u.id = x.user_id JOIN games g ON g.id = x.game_id
      WHERE x.kind = ? AND x.ended_at >= ? AND COALESCE(g.end_reason, 'finished') != 'abandoned' ${loc} ${decl} GROUP BY x.user_id HAVING SUM(json_extract(x.stats, '$.bids')) >= ${min} ORDER BY value DESC, extra DESC LIMIT 50`).bind(o.kind, from, ...locArgs, ...declArgs).all<typeof rows[number]>()).results
      .map((r) => ({ ...r, extra: `${r.extra} bids` }));
  } else {
    // best duos: signed-in partners, by wins together (team games only)
    const locD = o.region ? 'AND x.user_id IN (SELECT user_id FROM social_settings WHERE region = ? AND hide_location = 0) AND x.partner_id IN (SELECT user_id FROM social_settings WHERE region = ? AND hide_location = 0)' : '';
    const declD = o.declaredRegion ? 'AND (u.region = ? OR p.region = ?)' : '';
    rows = (await db.prepare(`SELECT x.user_id || ':' || x.partner_id AS id, u.username || ' + ' || p.username AS name, SUM(x.won) AS value, COUNT(*) AS games,
        ROUND(100.0 * SUM(x.won) / COUNT(*)) || '%' AS extra
      FROM game_players x JOIN users u ON u.id = x.user_id JOIN users p ON p.id = x.partner_id
      WHERE x.kind = 'team' AND x.partner_id IS NOT NULL AND x.user_id < x.partner_id AND x.ended_at >= ? ${locD} ${declD}
        AND EXISTS (SELECT 1 FROM games g, json_each(g.seats) je WHERE g.id = x.game_id AND COALESCE(g.end_reason, 'finished') != 'abandoned' AND json_extract(je.value, '$.kind') = 'user' AND json_extract(je.value, '$.side') != x.side)
      GROUP BY x.user_id, x.partner_id HAVING games >= 2 ORDER BY value DESC, games ASC LIMIT 50`).bind(from, ...locArgs, ...locArgs, ...declArgs, ...declArgs).all<typeof rows[number]>()).results;
  }
  return rows.map((r, i) => {
    const row: BoardRow = { rank: i + 1, id: o.board === 'duos' ? r.id : `u:${r.id}`, name: r.name ?? 'Player', value: Number(r.value) || 0, games: r.games, ...(r.extra ? { extra: String(r.extra) } : {}) };
    if (o.board === 'wins') {
      const vsBots = Number((r as { vs_bots?: number }).vs_bots) || 0;
      row.vsPlayers = row.value;
      row.vsBots = vsBots;
    }
    return row;
  });
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
  /** games that count as a win or a loss (a rated abandon is a loss for the leaver only) */
  games: number;
  /** every deal this player was in, including ones that were abandoned */
  started: number;
  wins: number; streak: number; bestStreak: number;
  accuracy: number | null; bags: number; booksPerHand: number | null; nil: string; shotsGiven: number; shotsTaken: number; wheels: number; bjWins: number;
  bidSec: number | null; playSec: number | null;
  bids: number;
  /** wins (and games) split by who the opponents were; a win against only guests is in neither */
  winsVsPlayers: number; winsVsBots: number; gamesVsPlayers: number; gamesVsBots: number;
}

export async function personalStats(db: D1Database, uid: string, kind?: 'team' | 'cutthroat'): Promise<PersonalStats> {
  const rows = (await db.prepare(`SELECT gp.won AS won, gp.stats AS stats, gp.side AS side, g.seats AS seats, gp.ended_at AS ended_at,
      COALESCE(g.end_reason, 'finished') AS end_reason, g.leaver_id AS leaver_id, g.rated AS rated, COALESCE(g.family, g.id) AS family
    FROM game_players gp JOIN games g ON g.id = gp.game_id
    WHERE gp.user_id = ? ${kind ? 'AND gp.kind = ?' : ''} ORDER BY gp.ended_at ASC, g.id ASC`)
    .bind(...(kind ? [uid, kind] : [uid])).all<{ won: number; stats: string; side: number; seats: string; ended_at: number; end_reason: string; leaver_id: string | null; rated: number; family: string }>()).results;
  const s = { games: 0, started: 0, wins: 0, streak: 0, bestStreak: 0, bids: 0, made: 0, books: 0, hands: 0, bags: 0, nilBids: 0, nilMade: 0, shotsGiven: 0, shotsTaken: 0, wheels: 0, bjWins: 0, bidMs: 0, bidN: 0, playMs: 0, playN: 0, winsVsPlayers: 0, winsVsBots: 0, gamesVsPlayers: 0, gamesVsBots: 0 };
  const order: string[] = [];
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = groups.get(r.family);
    if (list) list.push(r);
    else { groups.set(r.family, [r]); order.push(r.family); }
  }
  let run = 0;
  for (const family of order) {
    const list = groups.get(family)!;
    // a deal that later finished counts once, from the finished row. The abandon is only the record when nothing else was saved.
    const finished = list.find((r) => r.end_reason !== 'abandoned');
    const use = finished ?? list.find((r) => r.end_reason === 'abandoned');
    if (!use) continue;
    s.started++;
    if (use.end_reason === 'abandoned') {
      if (!(use.rated && use.leaver_id === uid)) continue;
      let seats: { side: number; kind: string }[] = [];
      try { seats = JSON.parse(use.seats); } catch { /* skip */ }
      const bucket = opponentBucket(seats, use.side);
      s.games++;
      if (bucket === 'players') s.gamesVsPlayers++;
      else if (bucket === 'bots') s.gamesVsBots++;
      run = 0;
      continue;
    }
    let st: Record<string, number> = {};
    try { st = JSON.parse(use.stats); } catch { /* skip */ }
    let seats: { side: number; kind: string }[] = [];
    try { seats = JSON.parse(use.seats); } catch { /* skip */ }
    const bucket = opponentBucket(seats, use.side);
    s.games++;
    if (bucket === 'players') s.gamesVsPlayers++;
    else if (bucket === 'bots') s.gamesVsBots++;
    if (use.won) {
      s.wins++; run++; s.bestStreak = Math.max(s.bestStreak, run);
      if (bucket === 'players') s.winsVsPlayers++;
      else if (bucket === 'bots') s.winsVsBots++;
    } else run = 0;
    for (const k of ['bids', 'made', 'books', 'hands', 'bags', 'nilBids', 'nilMade', 'shotsGiven', 'shotsTaken', 'wheels', 'bjWins', 'bidMs', 'bidN', 'playMs', 'playN'] as const) s[k] += Number(st[k]) || 0;
  }
  s.streak = run;
  return {
    games: s.games, started: s.started, wins: s.wins, streak: s.streak, bestStreak: s.bestStreak,
    accuracy: s.bids ? Math.round((1000 * s.made) / s.bids) / 10 : null,
    bags: s.bags,
    booksPerHand: s.hands ? Math.round((100 * s.books) / s.hands) / 100 : null,
    nil: `${s.nilMade}/${s.nilBids}`, shotsGiven: s.shotsGiven, shotsTaken: s.shotsTaken, wheels: s.wheels, bjWins: s.bjWins,
    bidSec: s.bidN ? Math.round(s.bidMs / s.bidN / 100) / 10 : null, playSec: s.playN ? Math.round(s.playMs / s.playN / 100) / 10 : null,
    bids: s.bids, winsVsPlayers: s.winsVsPlayers, winsVsBots: s.winsVsBots, gamesVsPlayers: s.gamesVsPlayers, gamesVsBots: s.gamesVsBots,
  };
}

export const UNRATED_NOTE = 'Unrated: play another signed-in player to get a rating.';

export interface MyModeStats extends PersonalStats {
  winPct: number | null;
  winPctPlayers: number | null;
  winPctBots: number | null;
  elo: number | null;
  unrated: string | null;
}

const pctOf = (wins: number, games: number) => (games ? Math.round((1000 * wins) / games) / 10 : null);

function withRating(s: PersonalStats, elo: number | undefined): MyModeStats {
  return {
    ...s,
    winPct: pctOf(s.wins, s.games),
    winPctPlayers: pctOf(s.winsVsPlayers, s.gamesVsPlayers),
    winPctBots: pctOf(s.winsVsBots, s.gamesVsBots),
    elo: elo ?? null,
    unrated: elo == null ? UNRATED_NOTE : null,
  };
}

/** Signed-in stats for both pools. Elo is null until a game had signed-in players on two sides. */
export async function myStats(db: D1Database, uid: string): Promise<{ team: MyModeStats; cutthroat: MyModeStats }> {
  const [team, cutthroat, ratings] = await Promise.all([
    personalStats(db, uid, 'team'),
    personalStats(db, uid, 'cutthroat'),
    db.prepare('SELECT kind, elo FROM ratings WHERE user_id = ?').bind(uid).all<{ kind: string; elo: number }>(),
  ]);
  const elo: Record<string, number> = {};
  for (const r of ratings.results) elo[r.kind] = Math.round(r.elo);
  return { team: withRating(team, elo.team), cutthroat: withRating(cutthroat, elo.cutthroat) };
}
