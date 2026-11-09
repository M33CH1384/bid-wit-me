import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resultsWheelsFeats } from '../src/landCue';

// The results page replays the Wheels feat the GAME ITSELF earned in its
// final hand — the contract crossing of a Wheels call (owner, 2026-11-08:
// the car answers the MAKE, not the call), derived from the recorded
// history by the same wheelsEarned the live table uses, never invented.
// A feat the table already showed live is not replayed; a game with no
// feat gets no car and no sound (Table mounts the show only for a
// returned feat). A bare 10th book — lower bid, or a books hand where no
// call was made — is not a feat and never replays.
describe('results wheels — the feat the results page replays', () => {
  const team = { partnerships: true, playerCount: 4 };
  const cut = { partnerships: false, playerCount: 4 };
  const none = new Set<string>();
  const rec = (handNo: number, bids: (number | string | null)[], sides: { side: number; tricks: number; contractMade?: boolean }[]) => ({ handNo, bids, sides });

  it('final-hand team Wheels made → the earned feat with its real numbers', () => {
    const h = [rec(1, [3, 2, 2, 2], [{ side: 0, tricks: 7 }, { side: 1, tricks: 6 }]),
               rec(2, [6, 1, 4, 2], [{ side: 0, tricks: 10 }, { side: 1, tricks: 3 }])];
    expect(resultsWheelsFeats(team, h, [5, 1, 5, 2], none))
      .toEqual([{ key: '2:earned:0', kind: 'earned', side: 0, bid: 10, books: 10 }]);
  });

  it('a higher Wheels call made → the feat carries the called bid and the books taken', () => {
    const h = [rec(2, [6, 1, 6, 2], [{ side: 0, tricks: 12 }, { side: 1, tricks: 1 }])];
    expect(resultsWheelsFeats(team, h, [6, 1, 6, 0], none))
      .toEqual([{ key: '2:earned:0', kind: 'earned', side: 0, bid: 12, books: 12 }]);
  });

  it('a feat earned in an EARLIER hand only → nothing for the results page', () => {
    const h = [rec(1, [6, 1, 4, 2], [{ side: 0, tricks: 10 }, { side: 1, tricks: 3 }]),
               rec(2, [3, 2, 2, 2], [{ side: 0, tricks: 7 }, { side: 1, tricks: 6 }])];
    expect(resultsWheelsFeats(team, h, [3, 2, 4, 4], none)).toEqual([]);
  });

  it('no feat anywhere → nothing (no feat, no car, no sound)', () => {
    expect(resultsWheelsFeats(team, [rec(1, [4, 2, 3, 2], [{ side: 0, tricks: 6 }, { side: 1, tricks: 7 }])], [3, 2, 3, 5], none)).toEqual([]);
    expect(resultsWheelsFeats(team, [], [0, 0, 0, 0], none)).toEqual([]);
  });

  it('a final-hand Wheels SET → nothing (no crossing ever happened)', () => {
    const h = [rec(2, [6, 1, 4, 2], [{ side: 0, tricks: 9 }, { side: 1, tricks: 4 }])];
    expect(resultsWheelsFeats(team, h, [5, 2, 4, 2], none)).toEqual([]);
    // the scored record vetoes even a raw crossing it judged a failed contract
    const vetoed = [rec(2, [6, 1, 4, 2], [{ side: 0, tricks: 10, contractMade: false }, { side: 1, tricks: 3 }])];
    expect(resultsWheelsFeats(team, vetoed, [5, 1, 5, 2], none)).toEqual([]);
  });

  it('an earned feat already shown live is not replayed', () => {
    const h = [rec(2, [6, 1, 4, 2], [{ side: 0, tricks: 10 }, { side: 1, tricks: 3 }])];
    expect(resultsWheelsFeats(team, h, [5, 1, 5, 2], new Set(['2:earned:0']))).toEqual([]);
  });

  it('cutthroat: 10 books on a low bid → nothing; on a 10 call → the earned feat, unless already shown', () => {
    const low = [rec(3, [4, 3, 3, 3], [{ side: 0, tricks: 10 }, { side: 1, tricks: 1 }, { side: 2, tricks: 1 }, { side: 3, tricks: 1 }])];
    expect(resultsWheelsFeats(cut, low, [10, 1, 1, 1], none)).toEqual([]);
    const called = [rec(3, [10, 3, 3, 3], [{ side: 0, tricks: 10 }, { side: 1, tricks: 1 }, { side: 2, tricks: 1 }, { side: 3, tricks: 1 }])];
    expect(resultsWheelsFeats(cut, called, [10, 1, 1, 1], none))
      .toEqual([{ key: '3:earned:0', kind: 'earned', seat: 0, bid: 10, books: 10 }]);
    expect(resultsWheelsFeats(cut, called, [10, 1, 1, 1], new Set(['3:earned:0']))).toEqual([]);
    // 10 books reached in an earlier hand, final hand quiet → nothing
    expect(resultsWheelsFeats(cut, [...called, rec(4, [2, 2, 2, 2], [{ side: 0, tricks: 4 }, { side: 1, tricks: 3 }, { side: 2, tricks: 3 }, { side: 3, tricks: 3 }])], [4, 3, 3, 3], none)).toEqual([]);
  });

  it('books-first-hand: a team 10th book with no call made → no feat', () => {
    const books = ['books', 'books', 'books', 'books'];
    const h = [rec(1, books, [{ side: 0, tricks: 10 }, { side: 1, tricks: 3 }])];
    expect(resultsWheelsFeats(team, h, [6, 1, 4, 2], none)).toEqual([]);
  });

  it('the results show is mounted on the presenting surface, gated on a stashed feat', () => {
    const src = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(src).toContain('WheelsResultsShow');
    expect(src).toContain('showResults && resultsWheels');
  });
});
