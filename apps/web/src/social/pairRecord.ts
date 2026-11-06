/**
 * BWM Central Phase 2 — the pair record (pure): the caller's record WITH
 * one partner, from GET /api/profile/pair/:id ({games, wins, losses,
 * streak}, streak signed: + win run / − loss run). The endpoint carries
 * no team names and no rating — a pair has none of its own.
 *
 * Praise gate (owner's data-honesty law): verdict copy about a pair is
 * earned by sample, never vibes. "You two play well together" may only
 * render at >= MIN_PAIR_PRAISE_GAMES games AND >= MIN_PAIR_PRAISE_WIN_PCT
 * win %, and the actual record always renders next to it. Below the
 * sample the record still shows — there is just no verdict.
 */
export interface PairRecordLike {
  games: number; wins: number; losses: number; streak?: number;
}

export const MIN_PAIR_PRAISE_GAMES = 10;
export const MIN_PAIR_PRAISE_WIN_PCT = 55;

/** Win % to one decimal from the real record; null with no games —
 *  an empty record has no percentage, not 0% and not 100%. */
export function pairWinPct(rec: PairRecordLike): number | null {
  if (!rec.games) return null;
  return Math.round((1000 * rec.wins) / rec.games) / 10;
}

export function pairPraise(rec: PairRecordLike): boolean {
  const pct = pairWinPct(rec);
  return rec.games >= MIN_PAIR_PRAISE_GAMES && pct !== null && pct >= MIN_PAIR_PRAISE_WIN_PCT;
}

/** The signed streak as it reads on a card: W-run / L-run, '—' at 0. */
export function pairStreakText(streak: number | undefined): string {
  if (!streak) return '—';
  return streak > 0 ? `W${streak}` : `L${-streak}`;
}
