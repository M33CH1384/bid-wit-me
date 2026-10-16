import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { plateTally, rememberHandTally, type HandTally } from '../src/plateStats';

const hand = (over: Partial<Parameters<typeof plateTally>[0]> = {}) => ({
  handNo: 1,
  phase: 'playing',
  bids: [3, 4, 2, 4] as (number | null)[],
  tricksWon: [1, 0, 2, 0],
  tricks: [{}],
  trick: { plays: [] as unknown[] },
  ...over,
});

const finished: HandTally = { handNo: 1, bids: [3, 4, 2, 4], tricksWon: [3, 4, 2, 4] };

describe('plate bid and books', () => {
  it('keeps the hand that is still on the table', () => {
    expect(plateTally(hand(), null, false)).toEqual({ bids: [3, 4, 2, 4], books: [1, 0, 2, 0] });
    expect(plateTally(hand({ phase: 'handOver', tricksWon: [3, 4, 2, 4] }), null, false).books).toEqual([3, 4, 2, 4]);
  });

  it('resets when the next hand starts, including a tally copied forward from the last hand', () => {
    const copied = hand({
      handNo: 2,
      phase: 'bidding',
      bids: [3, 4, 2, 4],
      tricksWon: [3, 4, 2, 4],
      tricks: [],
    });
    expect(plateTally(copied, finished, true)).toEqual({ bids: [null, null, null, null], books: [0, 0, 0, 0] });
    expect(plateTally(copied, finished, false)).toEqual({ bids: [null, null, null, null], books: [0, 0, 0, 0] });
    expect(rememberHandTally(finished, copied)).toEqual(finished);
    const clean = hand({ handNo: 2, phase: 'bidding', bids: [null, null, null, null], tricksWon: [0, 0, 0, 0], tricks: [] });
    expect(plateTally(clean, finished, true)).toEqual({ bids: [null, null, null, null], books: [0, 0, 0, 0] });
    expect(rememberHandTally(finished, clean).handNo).toBe(2);
  });

  it('opens a books hand at zero taken', () => {
    const books = hand({
      phase: 'playing',
      bids: ['books', 'books', 'books', 'books'],
      tricksWon: [4, 3, 4, 2],
      tricks: [],
    });
    expect(plateTally(books, null, true)).toEqual({ bids: ['books', 'books', 'books', 'books'], books: [0, 0, 0, 0] });
  });

  it('shows this hand once someone has bid or a book has been taken', () => {
    const bidding = hand({ handNo: 2, phase: 'bidding', bids: [3, null, null, null], tricksWon: [0, 0, 0, 0], tricks: [] });
    const prev = rememberHandTally(finished, bidding);
    expect(plateTally(bidding, prev, false)).toEqual({ bids: [3, null, null, null], books: [0, 0, 0, 0] });
    const playing = hand({ handNo: 2 });
    expect(plateTally(playing, rememberHandTally(prev, playing), false).books).toEqual([1, 0, 2, 0]);
  });

  it('reads the plate chips from that tally', () => {
    const src = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(src).toContain('plateTally');
    expect(src).not.toContain('TOOK {sb.tricksWon');
  });
});
