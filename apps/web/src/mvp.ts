/**
 * Player of the game (owner, 2026-11-12: "there should be a mvp for each game
 * with stats showing why they are the MVP").
 *
 * Picked from the scored hands alone (HandRecord keeps counts, not plays), so
 * every client, offline or online, names the same player. The MVP comes from
 * the winning side, as a broadcast would name it; the score rewards what a
 * spades player is actually judged on — books taken, making your OWN bid,
 * nils, and runs — and the stat lines shown are the facts behind the pick.
 * Pure.
 */
import { type HandRecord, type TableRules, sideOf } from '@spades/rules';

export interface MvpStat { label: string; value: string }
export interface Mvp {
  seat: number;
  side: number;
  /** Books taken across the game. */
  books: number;
  /** Hands with a numeric bid, and how many of them the player's own books covered. */
  bidHands: number;
  hitBid: number;
  nilsMade: number;
  nilsBusted: number;
  /** Longest run of consecutive books in any one hand. */
  bestRun: number;
  nukes: number;
  score: number;
  /** Up to three facts, strongest first. */
  lines: MvpStat[];
}

type Tally = Omit<Mvp, 'lines'>;

function tally(r: TableRules, history: readonly HandRecord[], seat: number): Tally {
  const t: Tally = { seat, side: sideOf(seat, r), books: 0, bidHands: 0, hitBid: 0, nilsMade: 0, nilsBusted: 0, bestRun: 0, nukes: 0, score: 0 };
  for (const h of history) {
    const took = h.tricksWon[seat] ?? 0;
    const bid = h.bids[seat];
    t.books += took;
    t.score += took;
    if (typeof bid === 'number') {
      t.bidHands++;
      if (took >= bid) { t.hitBid++; t.score += took === bid ? 3 : 2; } else t.score -= 1;
    } else if (bid === 'nil' || bid === 'blindNil') {
      const nil = h.sides.flatMap((s) => s.nils).find((n) => n.seat === seat);
      if (nil?.made) { t.nilsMade++; t.score += bid === 'blindNil' ? 10 : 6; } else { t.nilsBusted++; t.score -= 4; }
    }
    const run = h.bestRuns?.[seat] ?? 0;
    if (run > t.bestRun) t.bestRun = run;
    if (h.nuke?.seat === seat) { t.nukes++; t.score += 3; }
  }
  if (t.bestRun > 2) t.score += (t.bestRun - 2) * 0.5;
  return t;
}

function linesFor(t: Tally): MvpStat[] {
  const out: MvpStat[] = [{ label: 'Books taken', value: String(t.books) }];
  if (t.nilsMade > 0) out.push({ label: t.nilsMade === 1 ? 'Nil made' : 'Nils made', value: String(t.nilsMade) });
  if (t.bidHands > 0) out.push({ label: 'Made own bid', value: `${t.hitBid} of ${t.bidHands}` });
  if (t.bestRun >= 3) out.push({ label: 'Longest run', value: `${t.bestRun} straight` });
  if (t.nukes > 0) out.push({ label: t.nukes === 1 ? 'Nuke' : 'Nukes', value: String(t.nukes) });
  return out.slice(0, 3);
}

/** The game's MVP, or null when no hand was scored. Ties: more books, then the lower seat. */
export function pickMvp(r: TableRules, history: readonly HandRecord[], winners: readonly number[]): Mvp | null {
  if (!history.length) return null;
  const seats = (history[0]!.tricksWon ?? []).map((_, i) => i);
  if (!seats.length) return null;
  const onWinner = seats.filter((s) => winners.includes(sideOf(s, r)));
  const pool = (onWinner.length ? onWinner : seats).map((s) => tally(r, history, s));
  pool.sort((a, b) => b.score - a.score || b.books - a.books || a.seat - b.seat);
  const best = pool[0]!;
  return { ...best, lines: linesFor(best) };
}
