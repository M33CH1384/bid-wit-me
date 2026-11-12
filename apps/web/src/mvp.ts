/**
 * Player of the game (owner, 2026-11-12: "there should be a mvp for each game
 * with stats showing why they are the MVP").
 *
 * The pick itself lives in @spades/rules (pickMvpTally) so the server stamps
 * the same player on the stored game. This file adds the stat lines shown
 * with the pick: the facts behind it. Pure.
 */
import { type HandRecord, type MvpTally, type TableRules, pickMvpTally } from '@spades/rules';

export { LOSER_MVP_MARGIN, LOSER_MVP_RATIO } from '@spades/rules';

export interface MvpStat { label: string; value: string }
export interface Mvp extends MvpTally {
  /** Up to three facts, strongest first. */
  lines: MvpStat[];
}

function linesFor(t: MvpTally): MvpStat[] {
  const out: MvpStat[] = [{ label: 'Books taken', value: String(t.books) }];
  if (t.nilsMade > 0) out.push({ label: t.nilsMade === 1 ? 'Nil made' : 'Nils made', value: String(t.nilsMade) });
  if (t.bidHands > 0) out.push({ label: 'Made own bid', value: `${t.hitBid} of ${t.bidHands}` });
  if (t.bestRun >= 3) out.push({ label: 'Longest run', value: `${t.bestRun} straight` });
  if (t.nukes > 0) out.push({ label: t.nukes === 1 ? 'Nuke' : 'Nukes', value: String(t.nukes) });
  return out.slice(0, 3);
}

/** The game's MVP, or null when no hand was scored. Ties: more books, then the lower seat. */
export function pickMvp(r: TableRules, history: readonly HandRecord[], winners: readonly number[]): Mvp | null {
  const best = pickMvpTally(r, history, winners);
  return best ? { ...best, lines: linesFor(best) } : null;
}

/** Career MVPs on a stat sheet: the total, and the share of games an MVP was named in ("12 · 18%"). */
export function mvpText(total: number | null | undefined, pct: number | null | undefined): string {
  const n = total ?? 0;
  return pct === null || pct === undefined ? String(n) : `${n} · ${Math.round(pct)}%`;
}
