/**
 * MATCHUP PREDICTOR (owner, 2026-11-13: the screen before the venue should read like a sports
 * app's matchup page — a headline, a win-probability ring, the players).
 *
 * The number is only ever built from things the game really knows, in this order:
 *  1. ratings — every side has a league rating: the standard rating-gap expectation;
 *  2. record — a two-sided table where the viewer has played these opponents before: the viewer's
 *     own win rate against them, pulled toward even while the sample is small;
 *  3. even — nothing to go on: 50/50 (or an equal split), and the caption says so.
 * It never guesses a skill for a person, and it says which of the three it used. Pure.
 */
export type PredictionBasis = 'ratings' | 'record' | 'even';
export interface MatchupPrediction {
  /** Whole percentages by side, summing to 100. */
  pct: number[];
  basis: PredictionBasis;
  /** For 'record': how many games the rate comes from. */
  games?: number;
}

/** No side is ever shown below this or above its complement: an upset is always possible. */
export const PREDICTION_FLOOR = 8;
/** Phantom even games added to a head-to-head record, so two games do not read as 100%. */
export const RECORD_PRIOR_GAMES = 4;

function toWhole(shares: number[]): number[] {
  const total = shares.reduce((a, b) => a + b, 0) || 1;
  const n = shares.length;
  const floor = Math.min(PREDICTION_FLOOR, Math.floor(100 / n));
  // floor each side, then share what is left in proportion
  const spare = 100 - floor * n;
  const raw = shares.map((s) => floor + (s / total) * spare);
  const out = raw.map((v) => Math.floor(v));
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k++, left--) out[order[k % n]![1]]!++;
  return out;
}

export function predictMatchup(o: {
  /** League rating by side; null where a side has none (bots, new players). */
  ratings: readonly (number | null)[];
  /** The viewer's side index, or -1 when spectating. */
  viewerSide: number;
  /** The viewer's record against the other side at a two-sided table, when one exists. */
  vsRecord?: { games: number; wins: number } | null;
}): MatchupPrediction | null {
  const n = o.ratings.length;
  if (n < 2) return null;
  if (o.ratings.every((r): r is number => typeof r === 'number' && Number.isFinite(r))) {
    const top = Math.max(...(o.ratings as number[]));
    return { pct: toWhole((o.ratings as number[]).map((r) => Math.pow(10, (r - top) / 400))), basis: 'ratings' };
  }
  const rec = o.vsRecord;
  if (n === 2 && o.viewerSide >= 0 && o.viewerSide < 2 && rec && rec.games >= 1) {
    const p = (rec.wins + RECORD_PRIOR_GAMES / 2) / (rec.games + RECORD_PRIOR_GAMES);
    const shares = o.viewerSide === 0 ? [p, 1 - p] : [1 - p, p];
    return { pct: toWhole(shares), basis: 'record', games: rec.games };
  }
  return { pct: toWhole(Array.from({ length: n }, () => 1)), basis: 'even' };
}

/** The line under the ring: what the number is made of. */
export function predictionCaption(p: MatchupPrediction): string {
  if (p.basis === 'ratings') return 'BWM projection · from league ratings';
  if (p.basis === 'record') return `BWM projection · from your ${p.games} game${p.games === 1 ? '' : 's'} against them`;
  return 'No history between these sides yet · even odds';
}
