/**
 * Player of the game (owner, 2026-11-12: "there should be a mvp for each game
 * with stats showing why they are the MVP").
 *
 * Picked from the scored hands alone (HandRecord keeps counts, not plays), so
 * every client and the server name the same player: the web shows the pick at
 * game over, the server stamps it on the stored game for the career stat. The
 * MVP comes from the winning side, as a broadcast would name it; the score
 * rewards what a spades player is actually judged on — books taken, making
 * your OWN bid, nils, and runs. Pure.
 */
import type { TableRules } from './config';
import { sideOf } from './scoring';
import type { HandRecord } from './game';

export interface MvpTally {
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
}

function tally(r: TableRules, history: readonly HandRecord[], seat: number): MvpTally {
  const t: MvpTally = { seat, side: sideOf(seat, r), books: 0, bidHands: 0, hitBid: 0, nilsMade: 0, nilsBusted: 0, bestRun: 0, nukes: 0, score: 0 };
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

/** The game's MVP, or null when no hand was scored. Ties: more books, then the lower seat. */
export function pickMvpTally(r: TableRules, history: readonly HandRecord[], winners: readonly number[]): MvpTally | null {
  if (!history.length) return null;
  const seats = (history[0]!.tricksWon ?? []).map((_, i) => i);
  if (!seats.length) return null;
  const onWinner = seats.filter((s) => winners.includes(sideOf(s, r)));
  const pool = (onWinner.length ? onWinner : seats).map((s) => tally(r, history, s));
  pool.sort((a, b) => b.score - a.score || b.books - a.books || a.seat - b.seat);
  return pool[0]!;
}
