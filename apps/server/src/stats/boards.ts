/** Release 9b: leaderboards, server stats, personal stat lines (D1 aggregates over game_players). */
export type Board = 'rating' | 'wins' | 'accuracy' | 'duos' | 'winpct' | 'books' | 'nils' | 'streak' | 'pace' | 'tkos';
export type Period = 'all' | 'month' | 'week';
export interface BoardRow { rank: number; id: string; name: string; value: number; games: number; extra?: string; vsPlayers?: number; vsBots?: number; trend?: number }

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

export async function leaderboard(db: D1Database, o: { board: Board; kind: 'team' | 'cutthroat'; period: Period; region: string | null; declaredRegion?: string | null; /** restrict the board to this account id set (BWM Central: friends scope, crew standings); resolved server-side by the caller, never client-supplied */ idSet?: string[]; /** @deprecated Phase 1 name for idSet — kept as an alias so existing callers/tests are untouched */ friendIds?: string[]; now: number }): Promise<BoardRow[]> {
  const from = since(o.period, o.now);
  // local = same coarse region, and never anyone who hid their location
  const loc = o.region ? 'AND x.user_id IN (SELECT user_id FROM social_settings WHERE region = ? AND hide_location = 0)' : '';
  const locArgs = o.region ? [o.region] : [];
  // regions (league P-B) = same SELF-DECLARED region (users.region); duos keep
  // a pair when either partner declared it
  const decl = o.declaredRegion ? 'AND u.region = ?' : '';
  const declArgs = o.declaredRegion ? [o.declaredRegion] : [];
  // id set (BWM Central): the caller resolves a membership set SERVER-side
  // — friends scope (P1: accepted friends + the caller) or a crew's active
  // members (P3) — and the board never sees client-supplied ids. An empty
  // set filters to nobody, never to an invalid IN (). Duos keep a pair
  // when BOTH partners are in the set (the locD precedent for the local
  // scope). With no set passed, the SQL and binds are exactly as before.
  const idSet = o.idSet ?? o.friendIds;
  const frIds = idSet && idSet.length ? idSet : null;
  const fr = idSet ? (frIds ? `AND x.user_id IN (${frIds.map(() => '?').join(',')})` : 'AND 1 = 0') : '';
  const frArgs = frIds ?? [];
  const frD = idSet ? (frIds ? `AND x.user_id IN (${frIds.map(() => '?').join(',')}) AND x.partner_id IN (${frIds.map(() => '?').join(',')})` : 'AND 1 = 0') : '';
  let rows: { id: string; name: string | null; value: number; games: number; extra?: string; trend_cur?: number; trend_prev?: number }[] = [];
  if (o.board === 'rating' && o.period === 'all') {
    rows = (await db.prepare(`SELECT x.user_id AS id, u.username AS name, ROUND(x.elo) AS value, x.games AS games FROM ratings x JOIN users u ON u.id = x.user_id
      WHERE x.kind = ? AND x.games > 0 ${loc} ${decl} ${fr} ORDER BY x.elo DESC LIMIT 50`).bind(o.kind, ...locArgs, ...declArgs, ...frArgs).all<typeof rows[number]>()).results;
  } else if (o.board === 'rating') {
    // a period's rating board = Elo gained in it
    rows = (await db.prepare(`SELECT x.user_id AS id, u.username AS name, ROUND(SUM(x.elo_after - x.elo_before)) AS value, COUNT(*) AS games FROM game_players x JOIN users u ON u.id = x.user_id
      WHERE x.kind = ? AND x.ended_at >= ? AND x.elo_after IS NOT NULL ${loc} ${decl} ${fr} GROUP BY x.user_id ORDER BY value DESC LIMIT 50`).bind(o.kind, from, ...locArgs, ...declArgs, ...frArgs).all<typeof rows[number]>()).results;
  } else if (o.board === 'wins') {
    // vs players: at least one opponent was signed in. vs bots: every opponent was a bot. Guest wins are neither.
    rows = (await db.prepare(`SELECT x.user_id AS id, u.username AS name,
        SUM(CASE WHEN x.won = 1 AND ${VS_PLAYERS} THEN 1 ELSE 0 END) AS value,
        SUM(CASE WHEN x.won = 1 AND ${VS_BOTS} THEN 1 ELSE 0 END) AS vs_bots,
        COUNT(*) AS games
      FROM game_players x JOIN users u ON u.id = x.user_id JOIN games g ON g.id = x.game_id
      WHERE x.kind = ? AND x.ended_at >= ? AND COALESCE(g.end_reason, 'finished') != 'abandoned' ${loc} ${decl} ${fr} GROUP BY x.user_id HAVING value > 0 OR vs_bots > 0 ORDER BY value DESC, vs_bots DESC, games ASC LIMIT 50`).bind(o.kind, from, ...locArgs, ...declArgs, ...frArgs).all<typeof rows[number] & { vs_bots?: number }>()).results;
  } else if (o.board === 'winpct') {
    // Win % (league data wave): the honors precedent — a rate board only
    // means anything over a real sample, so the same 10-game minimum.
    // Like Wins/Accuracy it counts recorded finished games (abandons out).
    rows = (await db.prepare(`SELECT x.user_id AS id, u.username AS name,
        ROUND(100.0 * SUM(x.won) / COUNT(*)) AS value, COUNT(*) AS games,
        SUM(x.won) || '–' || (COUNT(*) - SUM(x.won)) AS extra
      FROM game_players x JOIN users u ON u.id = x.user_id JOIN games g ON g.id = x.game_id
      WHERE x.kind = ? AND x.ended_at >= ? AND COALESCE(g.end_reason, 'finished') != 'abandoned' ${loc} ${decl} ${fr} GROUP BY x.user_id HAVING COUNT(*) >= 10 ORDER BY value DESC, games DESC LIMIT 50`).bind(o.kind, from, ...locArgs, ...declArgs, ...frArgs).all<typeof rows[number]>()).results;
  } else if (o.board === 'streak') {
    // Longest win streak (owner, 2026-11-01: highest win streaks on the
    // ticker). The value is the player's LONGEST run of consecutive wins in
    // the counted-game walk personalStats does — no streak counter is
    // stored anywhere, so the board replays the same stored history with
    // the same counting rules: one record per rematch family (a finished
    // row wins over an abandoned save of the same deal), unrated/unfinished
    // abandons invisible, a rated leaver's abandon counts as a game and
    // breaks the run. Expressed as gaps-and-islands over game_players; a
    // period board counts only games inside the period (the other boards'
    // convention). Minimums follow the rate boards: 5 counted games
    // (books/nils precedent) and a streak of 3+ (the app's own "on fire"
    // threshold — a 1–2 game run is not a streak worth printing). Ties:
    // more counted games first (winpct's tie-break), then name, so the
    // order never depends on scan order.
    rows = (await db.prepare(`WITH picked AS (
        SELECT x.user_id AS uid, x.won AS won, x.ended_at AS ended_at, g.id AS gid,
          COALESCE(g.end_reason, 'finished') AS er, g.rated AS rated, g.leaver_id AS leaver,
          ROW_NUMBER() OVER (PARTITION BY x.user_id, COALESCE(g.family, g.id)
            ORDER BY CASE WHEN COALESCE(g.end_reason, 'finished') = 'abandoned' THEN 1 ELSE 0 END, x.ended_at ASC, g.id ASC) AS pick
        FROM game_players x JOIN games g ON g.id = x.game_id
        WHERE x.kind = ? AND x.ended_at >= ? ${loc} ${fr}
      ),
      counted AS (
        SELECT uid, CASE WHEN er = 'abandoned' THEN 0 ELSE won END AS won, ended_at, gid FROM picked
        WHERE pick = 1 AND (er != 'abandoned' OR (rated = 1 AND leaver = uid))
      ),
      seq AS (
        SELECT uid, won,
          ROW_NUMBER() OVER (PARTITION BY uid ORDER BY ended_at ASC, gid ASC) AS rn,
          ROW_NUMBER() OVER (PARTITION BY uid, won ORDER BY ended_at ASC, gid ASC) AS rnw
        FROM counted
      ),
      runs AS (SELECT uid, COUNT(*) AS len FROM seq WHERE won = 1 GROUP BY uid, rn - rnw),
      totals AS (SELECT uid, COUNT(*) AS games FROM counted GROUP BY uid),
      best AS (SELECT uid, MAX(len) AS value FROM runs GROUP BY uid)
      SELECT b.uid AS id, u.username AS name, b.value AS value, t.games AS games
      FROM best b JOIN totals t ON t.uid = b.uid JOIN users u ON u.id = b.uid
      WHERE b.value >= 3 AND t.games >= 5 ${decl}
      ORDER BY b.value DESC, t.games DESC, u.username ASC LIMIT 50`).bind(o.kind, from, ...locArgs, ...frArgs, ...declArgs).all<typeof rows[number]>()).results;
  } else if (o.board === 'tkos') {
    // 1st Round TKOs dealt (owner, 2026-11-05 — a major stat). A totals
    // board like Wins: ranked by the stored per-game tkoDealt counter,
    // no games floor (the Wins precedent for a marquee counting stat —
    // a new player's first TKO still shows), the row's games column is
    // the sample size, and the extra line carries the suffered side of
    // the record ('taken N'). Games recorded before the counter shipped
    // have no tko keys and contribute 0 — the stat starts at ship,
    // because the ending fact was never stored for them.
    rows = (await db.prepare(`SELECT x.user_id AS id, u.username AS name,
        SUM(json_extract(x.stats, '$.tkoDealt')) AS value, COUNT(*) AS games,
        'taken ' || COALESCE(SUM(json_extract(x.stats, '$.tkoSuffered')), 0) AS extra
      FROM game_players x JOIN users u ON u.id = x.user_id JOIN games g ON g.id = x.game_id
      WHERE x.kind = ? AND x.ended_at >= ? AND COALESCE(g.end_reason, 'finished') != 'abandoned' ${loc} ${decl} ${fr} GROUP BY x.user_id HAVING value > 0 ORDER BY value DESC, games DESC LIMIT 50`).bind(o.kind, from, ...locArgs, ...declArgs, ...frArgs).all<typeof rows[number]>()).results;
  } else if (o.board === 'books') {
    // Books per hand from the stored per-game books/hands counters. A
    // 5-game minimum keeps one hot night off a rate board.
    rows = (await db.prepare(`SELECT x.user_id AS id, u.username AS name,
        ROUND(1.0 * SUM(json_extract(x.stats, '$.books')) / SUM(json_extract(x.stats, '$.hands')), 1) AS value, COUNT(*) AS games,
        SUM(json_extract(x.stats, '$.books')) || ' books · ' || SUM(json_extract(x.stats, '$.hands')) || ' hands' AS extra
      FROM game_players x JOIN users u ON u.id = x.user_id JOIN games g ON g.id = x.game_id
      WHERE x.kind = ? AND x.ended_at >= ? AND COALESCE(g.end_reason, 'finished') != 'abandoned' ${loc} ${decl} ${fr} GROUP BY x.user_id HAVING COUNT(*) >= 5 AND SUM(json_extract(x.stats, '$.hands')) > 0 ORDER BY value DESC, games DESC LIMIT 50`).bind(o.kind, from, ...locArgs, ...declArgs, ...frArgs).all<typeof rows[number]>()).results;
  } else if (o.board === 'nils') {
    // Nils made (career/period totals from the stored nilMade counter).
    rows = (await db.prepare(`SELECT x.user_id AS id, u.username AS name,
        SUM(json_extract(x.stats, '$.nilMade')) AS value, COUNT(*) AS games,
        'made ' || SUM(json_extract(x.stats, '$.nilMade')) || ' of ' || SUM(json_extract(x.stats, '$.nilBids')) || ' bid' AS extra
      FROM game_players x JOIN users u ON u.id = x.user_id JOIN games g ON g.id = x.game_id
      WHERE x.kind = ? AND x.ended_at >= ? AND COALESCE(g.end_reason, 'finished') != 'abandoned' ${loc} ${decl} ${fr} GROUP BY x.user_id HAVING COUNT(*) >= 5 AND SUM(json_extract(x.stats, '$.nilMade')) > 0 ORDER BY value DESC, games DESC LIMIT 50`).bind(o.kind, from, ...locArgs, ...declArgs, ...frArgs).all<typeof rows[number]>()).results;
  } else if (o.board === 'accuracy') {
    const min = o.period === 'all' ? 20 : 8;
    rows = (await db.prepare(`SELECT x.user_id AS id, u.username AS name,
        ROUND(100.0 * SUM(json_extract(x.stats, '$.made')) / SUM(json_extract(x.stats, '$.bids')), 1) AS value, COUNT(*) AS games, SUM(json_extract(x.stats, '$.bids')) AS extra
      FROM game_players x JOIN users u ON u.id = x.user_id JOIN games g ON g.id = x.game_id
      WHERE x.kind = ? AND x.ended_at >= ? AND COALESCE(g.end_reason, 'finished') != 'abandoned' ${loc} ${decl} ${fr} GROUP BY x.user_id HAVING SUM(json_extract(x.stats, '$.bids')) >= ${min} ORDER BY value DESC, extra DESC LIMIT 50`).bind(o.kind, from, ...locArgs, ...declArgs, ...frArgs).all<typeof rows[number]>()).results
      .map((r) => ({ ...r, extra: `${r.extra} bids` }));
  } else if (o.board === 'pace') {
    // Fastest Climbers (owner, 2026-11-02: "track how fast people rank up
    // as a metric" — a public league stat: "a screen that shows progression
    // or regression with an arrow but ranks people like a stat sheet").
    // Rank-up pace = Rep XP EARNED IN RECORDED GAMES in the window. The
    // figure is exact, not estimated: per game, base XP is the deterministic
    // onGameEnd formula in cred/hooks.ts (finish 25 + win 25 at full rate;
    // half rate — 12/12 — when the game was unrated or the opponents were
    // bots), and the Play-Well bonus is read from cred_playwell, whose row
    // IS the settled amount (an absent row for a pre-0034 game = 0, truly:
    // the bonus system did not exist yet). Abandoned games earn nothing and
    // are excluded. XP from achievements / challenge claims / story rewards
    // is NOT in this number (no per-event history exists for it) — the
    // client footer says "XP earned in games", never "total XP". Levels
    // gained are NOT claimed either: level is a function of cumulative XP
    // from every source and no level history is recorded.
    // Windows mirror the siblings on ended_at: week = trailing 7d, month =
    // trailing 30d (value + games from that ranking window); the trend pair
    // is that same span vs the equal span immediately before it. For period
    // 'all' the value is all-time and the trend pair is the last 30d vs the
    // 30d before, which the row's extra line spells out. trend = current-
    // window XP − previous-window XP (signed); the client renders its arrow
    // from the sign and the delta itself rides in the row's extra line — an
    // arrow never ships without its number. Floor: ≥5 games and >0 XP in
    // the ranking window (the books/nils 5-game precedent).
    const span = o.period === 'week' ? 7 * DAY : 30 * DAY;
    const curFrom = o.period === 'all' ? 0 : o.now - span;
    const trendFrom = o.now - span;
    const trendPrevFrom = o.now - 2 * span;
    rows = (await db.prepare(`SELECT p.user_id AS id, p.username AS name,
        SUM(CASE WHEN p.ended_at >= ? THEN p.xp ELSE 0 END) AS value,
        SUM(CASE WHEN p.ended_at >= ? THEN 1 ELSE 0 END) AS games,
        SUM(CASE WHEN p.ended_at >= ? THEN p.xp ELSE 0 END) AS trend_cur,
        SUM(CASE WHEN p.ended_at >= ? AND p.ended_at < ? THEN p.xp ELSE 0 END) AS trend_prev
      FROM (
        SELECT x.user_id AS user_id, u.username AS username, x.ended_at AS ended_at,
          (CASE WHEN g.rated = 0 OR ${VS_BOTS} THEN 12 ELSE 25 END) * (1 + x.won) + COALESCE(pw.xp, 0) AS xp
        FROM game_players x
        JOIN users u ON u.id = x.user_id
        JOIN games g ON g.id = x.game_id
        LEFT JOIN cred_playwell pw ON pw.game_id = x.game_id AND pw.user_id = x.user_id
        WHERE x.kind = ? AND COALESCE(g.end_reason, 'finished') != 'abandoned' ${loc} ${decl} ${fr}
      ) p
      GROUP BY p.user_id HAVING games >= 5 AND value > 0 ORDER BY value DESC, games DESC LIMIT 50`)
      .bind(curFrom, curFrom, trendFrom, trendPrevFrom, trendFrom, o.kind, ...locArgs, ...declArgs, ...frArgs).all<typeof rows[number]>()).results;
  } else {
    // best duos: signed-in partners, by wins together (team games only)
    const locD = o.region ? 'AND x.user_id IN (SELECT user_id FROM social_settings WHERE region = ? AND hide_location = 0) AND x.partner_id IN (SELECT user_id FROM social_settings WHERE region = ? AND hide_location = 0)' : '';
    const declD = o.declaredRegion ? 'AND (u.region = ? OR p.region = ?)' : '';
    rows = (await db.prepare(`SELECT x.user_id || ':' || x.partner_id AS id, u.username || ' + ' || p.username AS name, SUM(x.won) AS value, COUNT(*) AS games,
        ROUND(100.0 * SUM(x.won) / COUNT(*)) || '%' AS extra
      FROM game_players x JOIN users u ON u.id = x.user_id JOIN users p ON p.id = x.partner_id
      WHERE x.kind = 'team' AND x.partner_id IS NOT NULL AND x.user_id < x.partner_id AND x.ended_at >= ? ${locD} ${declD} ${frD}
        AND EXISTS (SELECT 1 FROM games g, json_each(g.seats) je WHERE g.id = x.game_id AND COALESCE(g.end_reason, 'finished') != 'abandoned' AND json_extract(je.value, '$.kind') = 'user' AND json_extract(je.value, '$.side') != x.side)
      GROUP BY x.user_id, x.partner_id HAVING games >= 2 ORDER BY value DESC, games ASC LIMIT 50`).bind(from, ...locArgs, ...locArgs, ...declArgs, ...declArgs, ...frArgs, ...frArgs).all<typeof rows[number]>()).results;
  }
  return rows.map((r, i) => {
    const row: BoardRow = { rank: i + 1, id: o.board === 'duos' ? r.id : `u:${r.id}`, name: r.name ?? 'Player', value: Number(r.value) || 0, games: r.games, ...(r.extra ? { extra: String(r.extra) } : {}) };
    if (o.board === 'wins') {
      const vsBots = Number((r as { vs_bots?: number }).vs_bots) || 0;
      row.vsPlayers = row.value;
      row.vsBots = vsBots;
    }
    if (o.board === 'pace') {
      const delta = (Number(r.trend_cur) || 0) - (Number(r.trend_prev) || 0);
      row.trend = delta;
      const spanLabel = o.period === 'all' ? 'last 30d vs prior 30d' : `vs prior ${o.period === 'week' ? '7d' : '30d'}`;
      row.extra = delta > 0 ? `+${delta} ${spanLabel}` : delta < 0 ? `${delta} ${spanLabel}` : `Even ${spanLabel}`;
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
  accuracy: number | null; bags: number; booksPerHand: number | null; nil: string; shotsGiven: number; shotsTaken: number; tkoDealt: number; tkoSuffered: number; tossesForced: number; tossesConceded: number; wheels: number;
  /** Player of the game awards, and their share of the games an MVP was
   *  named in: every finished game recorded since the stamp shipped,
   *  whoever the opponents were (the books/TKO convention). Older games
   *  and abandoned games are in neither number. Null with no such game. */
  mvps: number; mvpGames: number; mvpPct: number | null;
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
  const s = { games: 0, started: 0, wins: 0, streak: 0, bestStreak: 0, bids: 0, made: 0, books: 0, hands: 0, bags: 0, nilBids: 0, nilMade: 0, shotsGiven: 0, shotsTaken: 0, tkoDealt: 0, tkoSuffered: 0, tossesForced: 0, tossesConceded: 0, wheels: 0, mvps: 0, mvpGames: 0, bidMs: 0, bidN: 0, playMs: 0, playN: 0, winsVsPlayers: 0, winsVsBots: 0, gamesVsPlayers: 0, gamesVsBots: 0 };
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
    for (const k of ['bids', 'made', 'books', 'hands', 'bags', 'nilBids', 'nilMade', 'shotsGiven', 'shotsTaken', 'tkoDealt', 'tkoSuffered', 'tossesForced', 'tossesConceded', 'wheels', 'bidMs', 'bidN', 'playMs', 'playN'] as const) s[k] += Number(st[k]) || 0;
    if (st.mvp !== undefined && st.mvp !== null) { s.mvpGames++; if (Number(st.mvp) > 0) s.mvps++; }
  }
  s.streak = run;
  return {
    games: s.games, started: s.started, wins: s.wins, streak: s.streak, bestStreak: s.bestStreak,
    accuracy: s.bids ? Math.round((1000 * s.made) / s.bids) / 10 : null,
    bags: s.bags,
    booksPerHand: s.hands ? Math.round((100 * s.books) / s.hands) / 100 : null,
    nil: `${s.nilMade}/${s.nilBids}`, shotsGiven: s.shotsGiven, shotsTaken: s.shotsTaken, tkoDealt: s.tkoDealt, tkoSuffered: s.tkoSuffered, tossesForced: s.tossesForced, tossesConceded: s.tossesConceded, wheels: s.wheels,
    mvps: s.mvps, mvpGames: s.mvpGames, mvpPct: s.mvpGames ? Math.round((1000 * s.mvps) / s.mvpGames) / 10 : null,
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
