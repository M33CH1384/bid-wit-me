import { type HandRecord, type TableRules, sideOf } from '@spades/rules';

/**
 * PLAYER BOX SCORE (owner, 2026-11-13: "We need a box score button here to look at all the
 * players performances side by side separated by team").
 *
 * One line per player for the whole game, grouped by side with a team total — every number read
 * straight off the scored hand records, the same ones the score pad and the MVP pick use. Pure.
 */
export interface BoxLine {
  seat: number;
  /** Sum of the player's numeric bids. */
  bid: number;
  /** Books taken across the game. */
  books: number;
  /** Books minus bid over the hands the player bid a number (their own over/under). */
  diff: number;
  /** Hands with a numeric bid, and how many of those the player's own books covered. */
  bidHands: number;
  hitBid: number;
  nilsTried: number;
  nilsMade: number;
  /** Longest run of consecutive books in any one hand. */
  bestRun: number;
  nukes: number;
}

export interface BoxTeam {
  side: number;
  score: number;
  players: BoxLine[];
  /** The side's totals; hitBid / bidHands are the side's CONTRACTS made / bid. */
  total: Omit<BoxLine, 'seat'>;
  /** Hands the side was set, and bags it collected. */
  sets: number;
  bags: number;
}

function lineFor(history: readonly HandRecord[], seat: number): BoxLine {
  const l: BoxLine = { seat, bid: 0, books: 0, diff: 0, bidHands: 0, hitBid: 0, nilsTried: 0, nilsMade: 0, bestRun: 0, nukes: 0 };
  for (const h of history) {
    const took = h.tricksWon[seat] ?? 0;
    const bid = h.bids[seat];
    l.books += took;
    if (typeof bid === 'number') {
      l.bid += bid; l.bidHands++; l.diff += took - bid;
      if (took >= bid) l.hitBid++;
    } else if (bid === 'nil' || bid === 'blindNil') {
      l.nilsTried++;
      if (h.sides.flatMap((s) => s.nils).find((n) => n.seat === seat)?.made) l.nilsMade++;
    }
    const run = h.bestRuns?.[seat] ?? 0;
    if (run > l.bestRun) l.bestRun = run;
    if (h.nuke?.seat === seat) l.nukes++;
  }
  return l;
}

/** Every side's box, in side order. `scores` are the final scores by side. */
export function playerBoxScore(r: TableRules, history: readonly HandRecord[], scores: readonly number[]): BoxTeam[] {
  const seats = Array.from({ length: r.playerCount }, (_, i) => i);
  const sides = [...new Set(seats.map((s) => sideOf(s, r)))].sort((a, b) => a - b);
  return sides.map((side) => {
    const players = seats.filter((s) => sideOf(s, r) === side).map((s) => lineFor(history, s));
    const sum = (k: keyof Omit<BoxLine, 'seat'>) => players.reduce((n, p) => n + p[k], 0);
    let contracts = 0, made = 0, sets = 0, bags = 0;
    for (const h of history) {
      const sh = h.sides.find((s) => s.side === side);
      if (!sh) continue;
      bags += sh.bagsAdded ?? 0;
      if (sh.contractMade === null) continue;
      contracts++;
      if (sh.contractMade) made++; else sets++;
    }
    return {
      side, score: scores[side] ?? 0, players, sets, bags,
      total: {
        bid: sum('bid'), books: sum('books'), diff: sum('diff'), bidHands: contracts, hitBid: made,
        nilsTried: sum('nilsTried'), nilsMade: sum('nilsMade'),
        bestRun: Math.max(0, ...players.map((p) => p.bestRun)), nukes: sum('nukes'),
      },
    };
  });
}

/** "+2", "−1", "E" (even) — the over/under column. */
export function diffText(n: number): string {
  return n === 0 ? 'E' : n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}
/** "3/5" — made of tried; "—" when there was nothing to make. */
export function ofText(made: number, tried: number): string {
  return tried > 0 ? `${made}/${tried}` : '—';
}
