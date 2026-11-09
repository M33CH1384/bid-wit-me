/**
 * WHEELS CAR TIMING (owner, 2026-11-08: "The car shouldn't play when you
 * say you have ten books it should happen whenever you achieve 10").
 * The supercar used to fire on a Cutthroat player's bare 10th book (any
 * bid), on a books-bid-themselves hand's 10th book, and at the hand-end
 * recap for a made Wheels. It now rides landCue.wheelsEarned — the same
 * contract crossing the gold rain already used (0f6813d5) — so the car
 * plays at the MAKE: the 10th book of a bid-10 hand (for a higher Wheels
 * call, the contract-making book, together with the rain). Never at the
 * declaration, never for a set, never for a 10-book haul on a lower bid,
 * never on a books hand where no call was made. Behaviour pins for the
 * detection live here; the wiring pins are source-level, the
 * wheels-confetti-source pattern.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resultsWheelsFeats, wheelsEarned } from '../src/landCue';

const team = { partnerships: true, playerCount: 4 };
const cut = { partnerships: false, playerCount: 4 };

describe('the car trigger: the contract crossing of a Wheels call', () => {
  it('(1) a bid of 10 declared, nothing banked yet → no car', () => {
    // the declaration transition changes bids, not books: the trigger
    // sees only book transitions, and an unchanged count crosses nothing
    expect(wheelsEarned(team, [6, 1, 4, 2], [0, 0, 0, 0], [0, 0, 0, 0])).toEqual([]);
    expect(wheelsEarned(cut, [10, 3, 3, 3], [0, 0, 0, 0], [0, 0, 0, 0])).toEqual([]);
  });

  it('(2) books banking up to 9 on a bid-10 hand → still no car', () => {
    expect(wheelsEarned(team, [6, 1, 4, 2], [5, 1, 3, 1], [5, 1, 4, 1])).toEqual([]); // side 8 -> 9
    expect(wheelsEarned(cut, [10, 3, 3, 3], [8, 0, 0, 0], [9, 0, 0, 0])).toEqual([]);
  });

  it('(3) the 10th book banked on a bid-10 hand → the car, exactly once', () => {
    expect(wheelsEarned(team, [6, 1, 4, 2], [5, 1, 4, 1], [6, 1, 4, 1])).toEqual([{ side: 0 }]); // side 9 -> 10
    expect(wheelsEarned(team, [6, 1, 4, 2], [6, 1, 4, 1], [7, 1, 4, 1])).toEqual([]); // already across: no second show
    expect(wheelsEarned(cut, [10, 3, 3, 3], [9, 0, 0, 0], [10, 0, 0, 0])).toEqual([{ seat: 0 }]);
  });

  it('(4) a bid-10 hand ending at 9 books (set) → no car, ever', () => {
    // the last banking transition lands on 9 — nothing crosses
    expect(wheelsEarned(team, [6, 1, 4, 2], [4, 2, 4, 2], [5, 2, 4, 2])).toEqual([]); // side 8 -> 9, hand over
  });

  it('(5) a 10-book haul on a lower bid → no car', () => {
    expect(wheelsEarned(team, [5, 1, 3, 2], [5, 1, 4, 1], [6, 1, 4, 1])).toEqual([]); // bid 8 together, took 10
    expect(wheelsEarned(cut, [6, 3, 3, 3], [9, 0, 0, 0], [10, 0, 0, 0])).toEqual([]); // bid 6, took 10
  });

  it('a books-bid-themselves hand declares nothing and earns nothing', () => {
    const books = ['books', 'books', 'books', 'books'] as const;
    expect(wheelsEarned(team, [...books], [5, 1, 4, 1], [6, 1, 4, 1])).toEqual([]);
  });
});

describe('the results page replays only the make, derived from the final hand', () => {
  const none = new Set<string>();
  const rec = (handNo: number, bids: (number | string | null)[], sides: { side: number; tricks: number; contractMade?: boolean }[]) => ({ handNo, bids, sides });

  it('final-hand team Wheels made → the earned feat with its real numbers', () => {
    const h = [rec(2, [6, 1, 4, 2], [{ side: 0, tricks: 10 }, { side: 1, tricks: 3 }])];
    expect(resultsWheelsFeats(team, h, [5, 1, 5, 2], none))
      .toEqual([{ key: '2:earned:0', kind: 'earned', side: 0, bid: 10, books: 10 }]);
    expect(resultsWheelsFeats(team, h, [5, 1, 5, 2], new Set(['2:earned:0']))).toEqual([]); // shown live: never doubled
  });

  it('final-hand team Wheels SET → nothing (no crossing ever happened)', () => {
    const h = [rec(2, [6, 1, 4, 2], [{ side: 0, tricks: 9 }, { side: 1, tricks: 4 }])];
    expect(resultsWheelsFeats(team, h, [5, 2, 4, 2], none)).toEqual([]);
  });

  it('final-hand Cutthroat: 10 books on a low bid → nothing; on a 10 call → the earned feat', () => {
    const low = [rec(3, [4, 3, 3, 3], [{ side: 0, tricks: 10 }, { side: 1, tricks: 1 }, { side: 2, tricks: 1 }, { side: 3, tricks: 1 }])];
    expect(resultsWheelsFeats(cut, low, [10, 1, 1, 1], none)).toEqual([]);
    const called = [rec(3, [10, 3, 3, 3], [{ side: 0, tricks: 10 }, { side: 1, tricks: 1 }, { side: 2, tricks: 1 }, { side: 3, tricks: 1 }])];
    expect(resultsWheelsFeats(cut, called, [10, 1, 1, 1], none))
      .toEqual([{ key: '3:earned:0', kind: 'earned', seat: 0, bid: 10, books: 10 }]);
  });

  it('final hand is a books hand → nothing (no call was made)', () => {
    const books = ['books', 'books', 'books', 'books'];
    const h = [rec(1, books, [{ side: 0, tricks: 10 }, { side: 1, tricks: 3 }])];
    expect(resultsWheelsFeats(team, h, [6, 1, 4, 2], none)).toEqual([]);
  });
});

describe('the wiring: one live emit site, on the shared earn computation', () => {
  const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');

  it('the car is emitted from exactly one live site — the earn block', () => {
    expect(table.match(/fx\.emit\('wheelsCar'/g) ?? []).toHaveLength(1);
  });

  it('the hand-end recap no longer summons the car', () => {
    expect(table).not.toContain("fx.later('wheelsCar'");
  });

  it('car and rain share the single wheelsEarned computation', () => {
    expect(table.match(/wheelsEarned\(r, st\.bids, p\.tricksWon, st\.tricksWon\)/g) ?? []).toHaveLength(1);
    expect(table).toContain("fx.emit('wheelsRain', { silent: true })");
  });

  it('the declaration still gets its pop — and only its pop', () => {
    expect(table).toContain("fx.emit('wheels', { sub:");
  });
});
