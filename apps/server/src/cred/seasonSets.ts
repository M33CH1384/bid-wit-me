/**
 * Seasonal challenge sets (owner, 2026-10-23) — the content layer behind
 * the Big Joker's seasonal upkeep (cred/bigJokerSeason.ts) and a
 * season-long challenge track for EVERY player.
 *
 * The game's season already exists (cred/seasons.ts): monthly, UTC, id
 * 'YYYY-MM', Season 1 = 2026-10, lazily ensured on first touch with a
 * ratings soft-reset. This module hangs the challenge set on THAT season —
 * same id, same boundaries. A season's progress period_id IS the season
 * id, so challenge_progress rows for a season challenge are scoped to the
 * month exactly like a daily row is scoped to its date.
 *
 * The set: a pool of 8 season-long challenges (defs seeded into
 * challenge_defs by migration 0032, cadence 'season'); each season deals
 * 6 of the 8, chosen by a deterministic rotation over the season index —
 * the same set for every player in a season, rotating as seasons turn
 * (the daily/weekly rotations in cred/challenges.ts are the pattern).
 * Every metric is one the game-completion path already feeds
 * (cred/hooks.ts → bumpProgress): games, wins (both kinds), books, nils,
 * shots. No fabricated progress, no new tracking surface.
 *
 * Completion of the whole set is the Big Joker upkeep fact: it is stamped
 * into big_joker_season_upkeep (migration 0031) by
 * stampUpkeepIfSetComplete below, called from the bump path (the moment
 * the last challenge crosses) and from the active-derivation (self-heal).
 * Claiming is separate and per-challenge, exactly like daily/weekly:
 * upkeep reads COMPLETION (targets reached), never claim state.
 */
import type { ChallengeDef } from './challenges';

/**
 * The first season that carries a challenge set. 2026-10 is Season 1 —
 * the month the card/upkeep system itself shipped (2026-10-23), so its
 * set is the inaugural one. Seasons before it never had sets; seasons
 * from it on always do (the pool is finite code, the rotation endless).
 */
export const SEASON_SET_EPOCH = '2026-10';

/** The season id ('YYYY-MM', UTC) containing a timestamp — mirrors the
 *  monthId derivation in cred/seasons.ts / cred/bigJokerSeason.ts. */
export function currentSeasonId(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Months since Season 1 (2026-10 = 0) — the same count seasonName uses. */
export function seasonIndexFor(seasonId: string): number {
  const [y, m] = seasonId.split('-').map(Number);
  return (y! - 2026) * 12 + (m! - 10);
}

/** Does this season carry a challenge set? Every season from the epoch on. */
export function seasonSetExists(seasonId: string): boolean {
  return seasonIndexFor(seasonId) >= seasonIndexFor(SEASON_SET_EPOCH);
}

/**
 * The season pool. Targets are sized for a month of real play (the daily
 * set implies ~4 games/day for a fully engaged player): the marathon
 * 70-game slot and the 4-nil slot are the stretch picks, and the rotation
 * rests two of the eight each season. XP/coins sit a tier above weekly
 * (the premium track) on the existing challenge economy — no real-money
 * anything, per the beta rule.
 */
export const SEASON_POOL: ChallengeDef[] = [
  { id: 'szn-games-40', cadence: 'season', title: 'Play 40 games this season', metric: 'games', target: 40, xp: 500, coins: 400 },
  { id: 'szn-win-20', cadence: 'season', title: 'Win 20 games this season', metric: 'wins', target: 20, xp: 650, coins: 500 },
  { id: 'szn-team-12', cadence: 'season', title: 'Win 12 partnership games this season', metric: 'wins', target: 12, xp: 550, coins: 425, kind: 'team' },
  { id: 'szn-cut-6', cadence: 'season', title: 'Win 6 cutthroat games this season', metric: 'wins', target: 6, xp: 600, coins: 475, kind: 'cutthroat' },
  { id: 'szn-books-300', cadence: 'season', title: 'Take 300 books this season', metric: 'books', target: 300, xp: 450, coins: 325 },
  { id: 'szn-nil-4', cadence: 'season', title: 'Make 4 nils this season', metric: 'nils_made', target: 4, xp: 800, coins: 650 },
  { id: 'szn-shots-12', cadence: 'season', title: 'Give 12 shots this season', metric: 'shots_given', target: 12, xp: 700, coins: 550 },
  { id: 'szn-games-70', cadence: 'season', title: 'Play 70 games this season', metric: 'games', target: 70, xp: 800, coins: 650 },
];

/** How many of the pool a season deals. Upkeep = ALL of them complete. */
export const SEASON_SET_SIZE = 6;

/**
 * The set a season deals: a 6-of-8 window over the pool, slid by 3 per
 * season index — consecutive seasons share four of the six (a 6-of-8
 * window always overlaps), two challenges rest and two rotate in, and
 * the full pool cycles every 8 seasons. Deterministic in the season id
 * alone — every player in a season faces the same six.
 */
export function seasonChallengesFor(seasonId: string): ChallengeDef[] {
  if (!seasonSetExists(seasonId)) return [];
  const idx = seasonIndexFor(seasonId);
  return Array.from({ length: SEASON_SET_SIZE }, (_, i) => SEASON_POOL[(idx * 3 + i) % SEASON_POOL.length]!);
}

/** The set the season containing `now` deals. */
export function seasonChallenges(now: number): ChallengeDef[] {
  return seasonChallengesFor(currentSeasonId(now));
}

/** This player's raw progress rows for one season's set. */
export async function seasonProgressRows(db: D1Database, userId: string, seasonId: string): Promise<Map<string, { progress: number; claimedAt: number | null }>> {
  const defs = seasonChallengesFor(seasonId);
  if (!defs.length) return new Map();
  const rows = (await db.prepare('SELECT challenge_id AS challengeId, progress, claimed_at AS claimedAt FROM challenge_progress WHERE user_id = ? AND period_id = ?')
    .bind(userId, seasonId).all<{ challengeId: string; progress: number; claimedAt: number | null }>()).results;
  return new Map(rows.map((r) => [r.challengeId, { progress: r.progress, claimedAt: r.claimedAt }]));
}

/** Has this player completed EVERY challenge in the season's set?
 *  (Completion = targets reached; claiming is a separate, per-challenge act.) */
export async function seasonSetComplete(db: D1Database, userId: string, seasonId: string): Promise<boolean> {
  const defs = seasonChallengesFor(seasonId);
  if (!defs.length) return false;
  const rows = await seasonProgressRows(db, userId, seasonId);
  return defs.every((d) => (rows.get(d.id)?.progress ?? 0) >= d.target);
}

/**
 * If the player has completed the season's whole set, stamp the upkeep
 * record (big_joker_season_upkeep, migration 0031) with the completion
 * moment. Idempotent: an existing completed_at is never moved, and the
 * stamp lands at most once per player per season. Returns whether the
 * set is complete. Called from the bump path (the crossing moment) and
 * from cred/bigJokerSeason's derivation (self-heal for any path that
 * reached the targets without passing a bump, e.g. direct accrual).
 */
export async function stampUpkeepIfSetComplete(db: D1Database, userId: string, seasonId: string, now: number): Promise<boolean> {
  if (!seasonSetExists(seasonId)) return false;
  if (!(await seasonSetComplete(db, userId, seasonId))) return false;
  await db.prepare(`INSERT INTO big_joker_season_upkeep (user_id, season_id, completed_at) VALUES (?, ?, ?)
    ON CONFLICT (user_id, season_id) DO UPDATE SET completed_at = COALESCE(big_joker_season_upkeep.completed_at, excluded.completed_at)`)
    .bind(userId, seasonId, now).run();
  return true;
}
