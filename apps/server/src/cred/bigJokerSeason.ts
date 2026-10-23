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
 * THIS MODULE IS THE SEAM the seasonal-challenges build (which follows)
 * owns next: it owns the per-player per-season completion record and
 * the season-id derivation. This build ships NO challenge content and
 * NO UI — only the derivation, the record shape, and the inaugural rule.
 *
 * Record shape (migration 0031):
 *   big_joker_season_upkeep(user_id, season_id, completed_at)
 *   — one row per player per season; completed_at NULL = set not
 *   complete, a timestamp = the moment the season's set was completed.
 *   The follow-up build writes these rows as its challenges complete.
 *
 * Season-id rule: the game's monthly season id, 'YYYY-MM' (UTC), the
 * same derivation ensureSeason (cred/seasons.ts) uses — seasonIdFor
 * below is that rule for an arbitrary timestamp, e.g. the latch moment.
 */
import { ensureSeason } from './seasons';

/** The season id ('YYYY-MM', UTC) containing a timestamp — mirrors the
 *  monthId derivation inside cred/seasons.ts exactly. */
export function seasonIdFor(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The registry of seasons that carry a Big Joker upkeep challenge set.
 * EMPTY in this build: the seasonal-challenges build registers each
 * season's set here (or replaces this registry with its own source) as
 * it ships them. A season with no registered set has nothing to violate.
 */
export const SEASON_UPKEEP_SETS: ReadonlySet<string> = new Set<string>();

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
 *     (the registry is empty — no challenges exist yet) → active. Nobody
 *     can be in violation of a set that doesn't exist. This is a named
 *     rule here, not a default smeared across the derivation: when the
 *     follow-up build registers a season's set, this branch stops
 *     covering that season and the record below decides;
 *   - otherwise → active iff the player's upkeep record for the current
 *     season is complete.
 */
export async function bigJokerSeasonActive(
  db: D1Database,
  userId: string,
  earnedAt: number | null,
  currentSeasonId: string,
  registry: ReadonlySet<string> = SEASON_UPKEEP_SETS,
): Promise<boolean> {
  if (earnedAt == null) return false;
  if (seasonIdFor(earnedAt) === currentSeasonId) return true;
  if (!seasonHasUpkeepSet(currentSeasonId, registry)) return true;
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
  return bigJokerSeasonActive(db, userId, earnedAt, season.id);
}
