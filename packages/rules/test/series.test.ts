import { describe, expect, it } from 'vitest';
import { type GameState, addSeriesGame, makeRules, newGame, seriesSides, seriesTally, summarizeGame } from '../src';

const fakeOver = (st: GameState, scores: number[], winners: number[]): GameState => ({
  ...st, phase: 'gameOver', scores, result: { endReason: 'target', finalScores: scores, placements: scores.map(() => 1), winners },
  nukes: [1, 0],
  history: [
    { handNo: 1, dealer: 0, bids: [], tricksWon: [], sides: [
      { side: 0, seats: [0, 2], contract: 10, contractTricks: 10, tricks: 10, contractMade: true, contractPoints: 200, nils: [], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0, points: 200, totalScore: 200, totalBags: 0 },
      { side: 1, seats: [1, 3], contract: 4, contractTricks: 3, tricks: 3, contractMade: false, contractPoints: -40, nils: [{ seat: 1, kind: 'nil', tricks: 1, made: false, points: -100 }], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0, points: -140, totalScore: -140, totalBags: 0 },
    ] },
  ],
});

describe('rematch series', () => {
  const st = newGame(makeRules('joker'), 'series');
  const sides = seriesSides(st, ['you', 'bot:1', 'bot:2', 'bot:3'], ['Us', 'Them']);
  it('groups partners into team sides keyed by members', () => {
    expect(sides.map((s) => s.members)).toEqual([['bot:2', 'you'], ['bot:1', 'bot:3']]);
    expect(sides[0]!.key).toBe('bot:2+you');
  });
  it('tallies wins, records highlights and hand totals', () => {
    const g1 = summarizeGame(fakeOver(st, [520, 300], [0]), ['Us', 'Them'], 1, 1);
    expect(g1.wheels).toEqual([1, 0]);
    expect(g1.sets).toEqual([0, 1]);
    expect(g1.nukes).toEqual([1, 0]);
    expect(g1.nilsBusted).toEqual([0, 1]);
    expect(g1.totals).toEqual([[200, -140]]);
    let s = addSeriesGame(null, 'joker', sides, g1);
    s = addSeriesGame(s, 'joker', sides, summarizeGame(fakeOver(st, [100, 510], [1]), ['Us', 'Them'], 2, 2));
    s = addSeriesGame(s, 'joker', seriesSides(st, ['you', 'bot:1', 'bot:2', 'bot:3'], ['Renamed', 'Them']), g1);
    expect(seriesTally(s)).toBe('2–1');
    expect(s.games.map((g) => g.no)).toEqual([1, 2, 3]);
    expect(s.sides[0]!.name).toBe('Renamed'); // renaming keeps the series
    expect(s.note).toBeUndefined();
  });
  it('counts 10+ books on the books-bid-themselves first hand as a made wheels (and a set 10+ bid as none)', () => {
    const base = fakeOver(st, [520, 300], [0]);
    const side = (side: number, tricks: number, contract: number, contractMade: boolean | null) => ({ side, seats: [side, side + 2], contract, contractTricks: tricks, tricks, contractMade, contractPoints: 0, nils: [], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0, points: 0, totalScore: 0, totalBags: 0 });
    const books = { ...base, history: [{ handNo: 1, dealer: 0, bids: ['books', 'books', 'books', 'books'], tricksWon: [6, 1, 4, 2], sides: [side(0, 10, 0, null), side(1, 3, 0, null)] }] } as unknown as GameState;
    expect(summarizeGame(books, ['Us', 'Them'], 1, 1).wheels).toEqual([1, 0]);
    const setTen = { ...base, history: [{ handNo: 2, dealer: 0, bids: [6, 1, 6, 2], tricksWon: [6, 1, 4, 2], sides: [side(0, 10, 12, false), side(1, 3, 3, true)] }] } as unknown as GameState;
    expect(summarizeGame(setTen, ['Us', 'Them'], 1, 1).wheels).toEqual([0, 0]);
  });
  it('resets when the team composition changes, with a note', () => {
    const g = summarizeGame(fakeOver(st, [520, 300], [0]), ['Us', 'Them'], 1, 1);
    const s1 = addSeriesGame(null, 'joker', sides, g);
    const swapped = seriesSides(st, ['you', 'bot:2', 'bot:1', 'bot:3'], ['Us', 'Them']);
    const s2 = addSeriesGame(s1, 'joker', swapped, g);
    expect(s2.games).toHaveLength(1);
    expect(s2.note).toMatch(/teams changed/);
  });
  it('cutthroat: one side per player', () => {
    const ct = newGame(makeRules('cutthroat'), 'ct');
    expect(seriesSides(ct, ['you', 'bot:1', 'bot:2', 'bot:3'], ['You', 'A', 'B', 'C'])).toHaveLength(ct.rules.playerCount);
  });
});
