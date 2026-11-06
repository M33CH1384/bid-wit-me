/**
 * BWM Central Phase 3 — "Personal bests" tiles for My Career, built ONLY
 * from fields the profile payloads already carry (verified against the
 * payload types + the server's personalStats):
 *  - peak rating per kind: cred rank.{team,cutthroat}.peak — shown only
 *    for a kind with rated games, because the server seeds an unplayed
 *    kind's peak at the placeholder rating (printing it would dress a
 *    seed up as a best);
 *  - best streak: cred stats.{team,cutthroat}.bestStreak (the social
 *    profile stats carry the same field combined) — the max across
 *    kinds, shown only when > 0;
 *  - most books in a hand: NO profile payload carries it (personalStats
 *    aggregates books/hands sums only). The tile is therefore absent —
 *    absent field = absent tile, never a fabricated 0. This helper has
 *    no books tile by construction.
 */
export interface PersonalBestsInput {
  rank?: {
    team?: { peak?: number | null; games?: number | null } | null;
    cutthroat?: { peak?: number | null; games?: number | null } | null;
  } | null;
  stats?: {
    team?: Record<string, number | string | null> | null;
    cutthroat?: Record<string, number | string | null> | null;
  } | null;
}

export interface PersonalBestTile { label: string; value: string }

const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export function personalBestTiles(input: PersonalBestsInput | null | undefined): PersonalBestTile[] {
  if (!input) return [];
  const tiles: PersonalBestTile[] = [];
  const peakTile = (label: string, r?: { peak?: number | null; games?: number | null } | null) => {
    const peak = numOrNull(r?.peak);
    const games = numOrNull(r?.games);
    if (peak !== null && games !== null && games > 0) {
      tiles.push({ label, value: peak.toLocaleString('en-US') });
    }
  };
  peakTile('Peak rating — Partnership', input.rank?.team);
  peakTile('Peak rating — Cutthroat', input.rank?.cutthroat);
  const streaks = [numOrNull(input.stats?.team?.bestStreak), numOrNull(input.stats?.cutthroat?.bestStreak)]
    .filter((n): n is number => n !== null);
  const best = streaks.length ? Math.max(...streaks) : null;
  if (best !== null && best > 0) tiles.push({ label: 'Best streak', value: String(best) });
  return tiles;
}
