/**
 * Street Cred hooks: the single integration point between game recording and cred.
 * saveRecord calls processGameCred (best-effort, never throws past its own guard) after writing.
 * Server-authoritative: every number here comes from the recorded game, never the client.
 */
import { type GameRecord, type PlayerGameStats, type RatingKind } from '../stats/record';
import { opponentBucket } from '../stats/boards';
import { divisionOf, divisionRank, type Division } from './divisions';
import { ensureSeason } from './seasons';
import { awardXp } from './xp';
import { bumpProgress, setStreakProgress } from './challenges';
import { ACHIEVEMENTS, checkAchievements, NIGHT_VENUES, type CheckCtx } from './achievements';
import { move } from './coins';
import type { CredPushEvent } from '../push/notify';

export interface CredGameCtx {
  gameId: string;
  userId: string;
  kind: RatingKind;
  won: boolean;
  stats: PlayerGameStats;
  rated: boolean;
  abandoned: boolean;
  /** this user is the leaver of a rated abandon */
  leaver: boolean;
  /** every opponent was a bot */
  vsBots: boolean;
  /** Elo after this game, null when it did not move */
  eloAfter: number | null;
  venue: string | null;
  endedAt: number;
}

interface Totals { games: number; wins: number; shotsGiven: number; curStreak: number; bestStreak: number }

/** Lazy-backfilled lifetime counters from game_players (finished games; rated-abandon losses count for the leaver). */
async function totalsFor(db: D1Database, userId: string, kind: RatingKind): Promise<Totals> {
  const row = await db.prepare('SELECT games, wins, shots_given AS shotsGiven, cur_streak AS curStreak, best_streak AS bestStreak FROM cred_totals WHERE user_id = ? AND kind = ?')
    .bind(userId, kind).first<Totals>();
  if (row) return row;
  // backfill once from history
  const agg = await db.prepare(`SELECT COUNT(*) AS games, COALESCE(SUM(won),0) AS wins,
      COALESCE(SUM(json_extract(stats,'$.shotsGiven')),0) AS shotsGiven
    FROM game_players gp JOIN games g ON g.id = gp.game_id
    WHERE gp.user_id = ? AND gp.kind = ?
      AND (COALESCE(g.end_reason,'finished') != 'abandoned' OR (g.rated = 1 AND g.leaver_id = gp.user_id))`)
    .bind(userId, kind).first<{ games: number; wins: number; shotsGiven: number }>();
  const order = (await db.prepare(`SELECT gp.won AS won FROM game_players gp JOIN games g ON g.id = gp.game_id
    WHERE gp.user_id = ? AND gp.kind = ? AND COALESCE(g.end_reason,'finished') != 'abandoned'
    ORDER BY gp.ended_at DESC`).bind(userId, kind).all<{ won: number }>()).results;
  let cur = 0;
  for (const r of order) { if (r.won) cur++; else break; } // leading run of wins, most recent first
  let best = 0, run = 0;
  for (let i = order.length - 1; i >= 0; i--) { // chronological for the best run
    if (order[i]!.won) { run++; best = Math.max(best, run); } else run = 0;
  }
  const t: Totals = { games: agg?.games ?? 0, wins: agg?.wins ?? 0, shotsGiven: agg?.shotsGiven ?? 0, curStreak: cur, bestStreak: best };
  await db.prepare('INSERT OR IGNORE INTO cred_totals (user_id, kind, games, wins, shots_given, cur_streak, best_streak) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(userId, kind, t.games, t.wins, t.shotsGiven, t.curStreak, t.bestStreak).run();
  return t;
}

async function bumpTotals(db: D1Database, userId: string, kind: RatingKind, won: boolean, shotsGiven: number, abandonedLeaver: boolean): Promise<Totals> {
  const t = await totalsFor(db, userId, kind);
  if (abandonedLeaver) {
    t.games++; t.curStreak = 0;
  } else {
    t.games++;
    if (won) { t.wins++; t.curStreak++; t.bestStreak = Math.max(t.bestStreak, t.curStreak); }
    else t.curStreak = 0;
    t.shotsGiven += shotsGiven;
  }
  await db.prepare('UPDATE cred_totals SET games = ?, wins = ?, shots_given = ?, cur_streak = ?, best_streak = ? WHERE user_id = ? AND kind = ?')
    .bind(t.games, t.wins, t.shotsGiven, t.curStreak, t.bestStreak, userId, kind).run();
  return t;
}

/** Per-user cred pass for one recorded game. Idempotency is handled by the caller (processGameCred). */
export async function onGameEnd(db: D1Database, ctx: CredGameCtx): Promise<CredPushEvent[]> {
  const now = ctx.endedAt;
  const season = await ensureSeason(db, now);
  const events: CredPushEvent[] = [];

  // season_ratings row (lazy): default 1000/Block for players with no carried rating
  let sr = await db.prepare('SELECT rating, division, games, wins, losses, peak_rating AS peakRating FROM season_ratings WHERE user_id = ? AND season_id = ? AND kind = ?')
    .bind(ctx.userId, season.id, ctx.kind).first<{ rating: number; division: Division; games: number; wins: number; losses: number; peakRating: number }>();
  if (!sr) {
    await db.prepare(`INSERT OR IGNORE INTO season_ratings (user_id, season_id, kind, rating, division, games, wins, losses, peak_rating)
      VALUES (?, ?, ?, 1000, 'block', 0, 0, 0, 1000)`).bind(ctx.userId, season.id, ctx.kind).run();
    sr = { rating: 1000, division: 'block', games: 0, wins: 0, losses: 0, peakRating: 1000 };
  }

  const countsAsGame = !ctx.abandoned || ctx.leaver; // personalStats parity: abandon counts for the leaver only
  if (countsAsGame) {
    const rating = ctx.eloAfter ?? sr.rating;
    const division = divisionOf(Math.round(rating));
    const oldDivision = sr.division;
    await db.prepare(`UPDATE season_ratings SET rating = ?, division = ?, games = games + 1,
        wins = wins + ?, losses = losses + ?, peak_rating = MAX(peak_rating, ?)
      WHERE user_id = ? AND season_id = ? AND kind = ?`)
      .bind(Math.round(rating), division, ctx.won ? 1 : 0, ctx.won ? 0 : 1, Math.round(rating), ctx.userId, season.id, ctx.kind).run();
    sr = { ...sr, rating: Math.round(rating), division };
    // push: division went up (rated games only — bot games never change division)
    if (ctx.rated && !ctx.vsBots && divisionRank(division) > divisionRank(oldDivision)) {
      events.push({ userId: ctx.userId, type: 'rankup', title: division, kind: ctx.kind });
    }
  }

  // lifetime totals (drives lifetime achievements + streak challenges)
  const t = await bumpTotals(db, ctx.userId, ctx.kind, ctx.won, ctx.stats.shotsGiven ?? 0, ctx.abandoned && ctx.leaver);

  // venue history (finished games only)
  if (!ctx.abandoned && ctx.venue) {
    await db.prepare(`INSERT INTO cred_venue_stats (user_id, venue, games, wins) VALUES (?, ?, 1, ?)
      ON CONFLICT (user_id, venue) DO UPDATE SET games = cred_venue_stats.games + 1, wins = cred_venue_stats.wins + excluded.wins`)
      .bind(ctx.userId, ctx.venue, ctx.won ? 1 : 0).run();
  }

  // XP: 25 finish + 25 win; bot/unrated games pay half (rounded down); abandoned games pay nothing
  if (!ctx.abandoned) {
    const half = !ctx.rated || ctx.vsBots;
    const finish = half ? 12 : 25;
    const awarded = await awardXp(db, ctx.userId, finish + (ctx.won ? (half ? 12 : 25) : 0), now);
    // coins: level-up bonus only — bot games pay zero coins, and per-game coin
    // rewards don't exist (stakes settle separately via stakes.ts)
    if (awarded.leveledUp && !ctx.vsBots) {
      try { await move(db, ctx.userId, 50 * awarded.level, 'level_up', `game:${ctx.gameId}`, now); } catch { /* best-effort */ }
    }
  }

  if (!ctx.abandoned) {
    // challenge progress (completed titles feed the "challenge complete" push)
    const done: string[] = [];
    done.push(...await bumpProgress(db, ctx.userId, 'games', 1, ctx.kind, now));
    if (ctx.won) done.push(...await bumpProgress(db, ctx.userId, 'wins', 1, ctx.kind, now));
    if (ctx.stats.books) done.push(...await bumpProgress(db, ctx.userId, 'books', ctx.stats.books, ctx.kind, now));
    const nils = (ctx.stats.nilMade ?? 0);
    if (nils > 0) done.push(...await bumpProgress(db, ctx.userId, 'nils_made', nils, ctx.kind, now));
    if (ctx.stats.shotsGiven) done.push(...await bumpProgress(db, ctx.userId, 'shots_given', ctx.stats.shotsGiven, ctx.kind, now));
    await setStreakProgress(db, ctx.userId, t.curStreak, ctx.kind, now);
    for (const title of done) events.push({ userId: ctx.userId, type: 'challenge', title });

    // achievements
    const [team, cut] = await Promise.all([
      totalsFor(db, ctx.userId, 'team'),
      totalsFor(db, ctx.userId, 'cutthroat'),
    ]);
    const venues = (await db.prepare('SELECT venue, wins FROM cred_venue_stats WHERE user_id = ?').bind(ctx.userId).all<{ venue: string; wins: number }>()).results;
    const nightWins = venues.filter((v) => NIGHT_VENUES.includes(v.venue)).reduce((s, v) => s + v.wins, 0);
    // best division across both ladders this season (for the After Dark achievement)
    const divs = (await db.prepare('SELECT division FROM season_ratings WHERE user_id = ? AND season_id = ?').bind(ctx.userId, season.id).all<{ division: Division }>()).results;
    const bestDivision = divs.reduce<Division>((b, r) => (divisionRank(r.division) > divisionRank(b) ? r.division : b), 'stoop');
    const checkCtx: CheckCtx = {
      vsBots: ctx.vsBots,
      game: {
        kind: ctx.kind, won: ctx.won,
        nilMade: (ctx.stats.nilMade ?? 0),
        blindNilMade: (ctx.stats as { blindNilMade?: number }).blindNilMade ?? 0,
        bags: ctx.stats.bags ?? 0, wheels: ctx.stats.wheels ?? 0,
        maxBooksHand: (ctx.stats as { maxBooksHand?: number }).maxBooksHand ?? 0,
        runItClaims: (ctx.stats as { runItClaims?: number }).runItClaims ?? 0,
        maxDeficit: (ctx.stats as { maxDeficit?: number }).maxDeficit ?? 0,
        foeEliminated: !!(ctx.stats as { foeEliminated?: boolean }).foeEliminated,
      },
      life: {
        wins: team.wins + cut.wins, teamWins: team.wins, cutthroatWins: cut.wins,
        games: team.games + cut.games, shotsGiven: team.shotsGiven + cut.shotsGiven,
        bestStreak: Math.max(team.bestStreak, cut.bestStreak),
        venuesPlayed: venues.length, nightVenueWins: nightWins,
        bestDivision,
      },
    };
    const unlocked = await checkAchievements(db, ctx.userId, checkCtx, now);
    const titles = new Map(ACHIEVEMENTS.map((a) => [a.id, a.title]));
    for (const u of unlocked) events.push({ userId: ctx.userId, type: 'achievement', title: titles.get(u.id) ?? u.id });
  }
  return events;
}

/**
 * Anti-farming tripwires (Phase 3b): structured warnings for manual review, never auto-ban.
 * - One player winning 90%+ of 10+ head-to-head games in 30 days (chip dumping / farming).
 * - The same pair appearing together in 10+ games with a lopsided winner is the
 *   same signal; groups are covered pairwise.
 */
async function tripwireCheck(db: D1Database, userIds: string[], gameId: string, now: number): Promise<void> {
  const since = now - 30 * 86_400_000;
  for (let i = 0; i < userIds.length; i++) {
    for (let j = i + 1; j < userIds.length; j++) {
      const a = userIds[i]!, b = userIds[j]!;
      const row = await db.prepare(`SELECT COUNT(*) AS games,
          COALESCE(SUM(CASE WHEN x.won = 1 AND y.won = 0 THEN 1 ELSE 0 END), 0) AS aWins,
          COALESCE(SUM(CASE WHEN y.won = 1 AND x.won = 0 THEN 1 ELSE 0 END), 0) AS bWins
        FROM game_players x JOIN game_players y ON x.game_id = y.game_id
        JOIN games g ON g.id = x.game_id
        WHERE x.user_id = ? AND y.user_id = ? AND g.ended_at > ? AND COALESCE(g.end_reason,'finished') = 'finished'`)
        .bind(a, b, since).first<{ games: number; aWins: number; bWins: number }>();
      const games = row?.games ?? 0;
      if (games < 10) continue;
      const top = Math.max(row?.aWins ?? 0, row?.bWins ?? 0);
      if (top / games >= 0.9) {
        console.warn('cred', 'collusion_tripwire', {
          game: gameId, pair: [a, b], games, aWins: row?.aWins ?? 0, bWins: row?.bWins ?? 0,
          note: 'one side won 90%+ of 10+ head-to-head games in 30d — review for farming/collusion',
        });
      }
    }
  }
}

/**
 * Per-game wrapper: idempotent via cred_processed, then one onGameEnd per signed-in player.
 * Called from saveRecord; never throws (best-effort so cred can never break recording).
 */
export async function processGameCred(
  db: D1Database,
  rec: GameRecord,
  meta: { rated: boolean; endReason?: 'finished' | 'abandoned'; leaverId?: string | null; venue?: string | null },
  elo: Record<string, { before: number; after: number }>,
): Promise<CredPushEvent[]> {
  const events: CredPushEvent[] = [];
  try {
    const ins = await db.prepare('INSERT OR IGNORE INTO cred_processed (game_id, processed_at) VALUES (?, ?)').bind(rec.id, rec.endedAt).run();
    const changed = (ins as unknown as { meta?: { changes?: number } }).meta?.changes ?? 1;
    if (!changed) return events; // already processed (retry / concurrent waitUntil)
    const humanIds = rec.players.map((p) => p.uid).filter(Boolean);
    for (const p of rec.players) {
      let seats: { side: number; kind: string }[] = [];
      try { seats = JSON.parse(rec.seats as unknown as string); } catch { /* ignore */ }
      const vsBots = opponentBucket(seats, p.side) === 'bots';
      const abandoned = meta.endReason === 'abandoned';
      events.push(...await onGameEnd(db, {
        gameId: rec.id, userId: p.uid, kind: rec.kind, won: p.won, stats: p.stats,
        rated: meta.rated, abandoned, leaver: abandoned && !!meta.rated && meta.leaverId === p.uid,
        vsBots, eloAfter: elo[p.uid]?.after ?? null, venue: meta.venue ?? null, endedAt: rec.endedAt,
      }));
    }
    // anti-farming tripwires (best-effort, log only)
    try { await tripwireCheck(db, humanIds, rec.id, rec.endedAt); } catch { /* ignore */ }
  } catch (e) {
    console.error('cred', e);
  }
  return events;
}
