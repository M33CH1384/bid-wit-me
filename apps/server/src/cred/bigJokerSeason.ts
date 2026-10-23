/**
 * Big Joker seasonal upkeep (owner, 2026-10-23): the Big Joker is a
 * two-layer status. The FEAT is permanent — earned once (level 50 + all
 * badges, latched in users.big_joker_at by cred/card.ts) and never
 * revoked. The ACTIVE crown is seasonal: an earned holder DISPLAYS rank
 * step 51 only while their current season's upkeep challenge set is
 * complete. The season they earn it in counts as active (no instant
 * debt); a season that closes incomplete steps their card back to 50
 * (Little Joker) until a later season's set reactivates the crown.
 *
 * The seasonal-challenges build (2026-10-23, cred/seasonSets.ts) now
 * owns the sets themselves: a 6-of-8 rotation dealt per season, tracked
 * in challenge_progress under the season id. This module owns the
 * per-player per-season completion record and the derivation over it.
 *
 * Record shape (migration 0031):
 *   big_joker_season_upkeep(user_id, season_id, completed_at)
 *   — one row per player per season; completed_at NULL = set not
 *   complete, a timestamp = the moment the season's set was completed.
 *   cred/seasonSets.stampUpkeepIfSetComplete writes these rows (from the
 *   bump path and from the derivation below, as a self-heal).
 *
 * Season-id rule: the game's monthly season id, 'YYYY-MM' (UTC), the
 * same derivation ensureSeason (cred/seasons.ts) uses — seasonIdFor
 * below is that rule for an arbitrary timestamp, e.g. the latch moment.
 */
import { ensureSeason, seasonBounds, seasonName } from './seasons';
import { seasonSetExists, stampUpkeepIfSetComplete } from './seasonSets';

/** The season id ('YYYY-MM', UTC) containing a timestamp — mirrors the
 *  monthId derivation inside cred/seasons.ts exactly. */
export function seasonIdFor(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The registry of seasons that carry a Big Joker upkeep challenge set.
 * LIVE since the seasonal-challenges build: membership is derived, not
 * enumerated — a season is in the registry iff cred/seasonSets deals it
 * a set (every season from the 2026-10 epoch on). A season with no set
 * has nothing to violate. Callers may still pass an explicit registry
 * (tests pin the derivation's branches with their own).
 */
class SeasonUpkeepRegistry extends Set<string> {
  override has(seasonId: string): boolean {
    return seasonSetExists(seasonId);
  }
}
export const SEASON_UPKEEP_SETS: ReadonlySet<string> = new SeasonUpkeepRegistry();

/** Does this season carry an upkeep challenge set at all? */
export function seasonHasUpkeepSet(seasonId: string, registry: ReadonlySet<string> = SEASON_UPKEEP_SETS): boolean {
  return registry.has(seasonId);
}

export interface SeasonUpkeepRecord { userId: string; seasonId: string; completedAt: number | null }

/** The player's upkeep completion record for one season (null = no row). */
export async function seasonUpkeepRecord(db: D1Database, userId: string, seasonId: string): Promise<SeasonUpkeepRecord | null> {
  const row = await db.prepare('SELECT user_id AS userId, season_id AS seasonId, completed_at AS completedAt FROM big_joker_season_upkeep WHERE user_id = ? AND season_id = ?')
    .bind(userId, seasonId).first<SeasonUpkeepRecord>();
  return row ?? null;
}

/**
 * Is an EARNED Big Joker ACTIVE in the current season?
 *   - not earned (earnedAt null) → never active;
 *   - earned THIS season → active (the earn season counts, no instant debt);
 *   - INAUGURAL RULE: the current season carries no upkeep challenge set
 *     → active. Nobody can be in violation of a set that doesn't exist.
 *     This is a named rule here, not a default smeared across the
 *     derivation: with the seasonal-challenges build live, every season
 *     from 2026-10 on carries a set, so this branch now covers only
 *     seasons before the epoch (and explicit test registries);
 *   - otherwise → active iff the player's upkeep record for the current
 *     season is complete. The record is self-healing: before reading it,
 *     a set that stands complete in challenge_progress is stamped (the
 *     bump path stamps at the crossing moment; this covers any accrual
 *     path that didn't).
 */
export async function bigJokerSeasonActive(
  db: D1Database,
  userId: string,
  earnedAt: number | null,
  currentSeasonId: string,
  registry: ReadonlySet<string> = SEASON_UPKEEP_SETS,
  now?: number,
): Promise<boolean> {
  if (earnedAt == null) return false;
  if (seasonIdFor(earnedAt) === currentSeasonId) return true;
  if (!seasonHasUpkeepSet(currentSeasonId, registry)) return true;
  await stampUpkeepIfSetComplete(db, userId, currentSeasonId, now ?? Date.now());
  const rec = await seasonUpkeepRecord(db, userId, currentSeasonId);
  return rec?.completedAt != null;
}

/** Convenience for callers without a season in hand: resolve the current
 *  season (creating its row on first touch, like every cred read) and
 *  answer bigJokerSeasonActive for it. cardFor already holds the season
 *  and calls bigJokerSeasonActive directly. */
export async function bigJokerActiveNow(db: D1Database, userId: string, earnedAt: number | null, now: number): Promise<boolean> {
  if (earnedAt == null) return false;
  const season = await ensureSeason(db, now);
  return bigJokerSeasonActive(db, userId, earnedAt, season.id, SEASON_UPKEEP_SETS, now);
}

export interface SeasonUpkeepView {
  /** the season this view describes */
  id: string;
  name: string;
  endsAt: number;
  /** the whole dealt set stands complete for this player */
  setComplete: boolean;
  /** non-null only for an EARNED Big Joker holder: the crown's state.
   *  Everyone else gets pure challenge content — no unusable framing. */
  bigJoker: { earned: true; active: boolean } | null;
}

/**
 * The Challenges tab's season header + upkeep line, in one server-derived
 * view: season identity/bounds from cred/seasons, set completion from
 * cred/seasonSets, and — for an earned holder (the latch in
 * users.big_joker_at, owned by cred/card.ts) — whether the crown is lit.
 * The latch is read as-is; cardFor refreshes it on every profile read,
 * and the routes layer enriches challenges AFTER cardFor has run.
 */
export async function seasonUpkeepView(db: D1Database, userId: string, seasonId: string, now: number): Promise<SeasonUpkeepView> {
  const { endsAt } = seasonBounds(seasonId);
  const complete = await stampUpkeepIfSetComplete(db, userId, seasonId, now);
  const row = await db.prepare('SELECT big_joker_at AS at FROM users WHERE id = ?').bind(userId).first<{ at: number | null }>();
  const earnedAt = row?.at ?? null;
  const bigJoker = earnedAt != null
    ? { earned: true as const, active: await bigJokerSeasonActive(db, userId, earnedAt, seasonId, SEASON_UPKEEP_SETS, now) }
    : null;
  return { id: seasonId, name: seasonName(seasonId), endsAt, setComplete: complete, bigJoker };
}
