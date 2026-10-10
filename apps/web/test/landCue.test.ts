import { describe, expect, it } from 'vitest';
import { type Card, type GameState, makeRules, newGame } from '@spades/rules';
import { landCueFor } from '../src/landCue';
import { handWinner, streakLabel, streakOf } from '../src/fx';

function withTrick(plays: Card[], done: Card[][] = []): GameState {
  const st = newGame(makeRules('joker'), 'cue');
  const mk = (cs: Card[]) => ({ ...st.trick, plays: cs.map((card, seat) => ({ seat, card })) });
  return { ...st, tricks: done.map(mk), trick: mk(plays) } as GameState;
}

describe('joker landing cues', () => {
  it('Little Joker alone rumbles small, Big Joker alone rumbles big', () => {
    expect(landCueFor(withTrick(['AH', 'LJ']), 'LJ')).toContain('jokerLittle');
    expect(landCueFor(withTrick(['AH', 'BJ']), 'BJ')).toContain('jokerBig');
  });
  it('Big Joker landing on a Little Joker in the same trick nukes', () => {
    expect(landCueFor(withTrick(['LJ', '3H', 'BJ']), 'BJ')).toMatch(/,nuke$/);
    // the Little Joker itself (played first) only rumbles
    expect(landCueFor(withTrick(['LJ', '3H', 'BJ']), 'LJ')).toMatch(/jokerLittle$/);
  });
  it('Little Joker after the Big Joker in the same trick also nukes (BJ still wins)', () => {
    expect(landCueFor(withTrick(['BJ', 'LJ']), 'LJ')).toMatch(/,nuke$/);
  });
  it('jokers in different tricks never nuke', () => {
    expect(landCueFor(withTrick(['BJ', '2H'], [['LJ', '3H', '4H', '5H']]), 'BJ')).toMatch(/jokerBig$/);
  });
});

describe('streaks', () => {
  const h = (a: number, b: number) => ({ sides: [{ points: a }, { points: b }] });
  it('counts consecutive outright wins', () => {
    expect(streakOf([h(10, 50), h(60, 20), h(70, 30)], 0)).toBe(2);
    expect(streakOf([h(60, 20), h(40, 40)], 0)).toBe(0);
    expect(handWinner([40, 40])).toBeNull();
    expect(streakLabel(2)).toBe('HEAT CHECK');
    expect(streakLabel(3)).toBe('ON FIRE');
    expect(streakLabel(1)).toBeNull();
  });
});

import { wheelsFor } from '../src/landCue';
describe('wheels (team bids 10+)', () => {
  const team = { partnerships: true, playerCount: 4 };
  it('only when both partners have bid and the total is 10+', () => {
    expect(wheelsFor(team, [7, null, null, null])).toEqual([]);
    expect(wheelsFor(team, [10, null, null, null])).toEqual([]); // individual 10 alone: not yet
    expect(wheelsFor(team, [6, 2, 4, 3])).toEqual([{ side: 0, total: 10 }]);
    expect(wheelsFor(team, [6, 5, 'nil', 5])).toEqual([{ side: 1, total: 10 }]);
    expect(wheelsFor(team, [5, 5, 4, 4])).toEqual([]);
  });
  it('never in Cutthroat, never on a books-bid-themselves hand', () => {
    expect(wheelsFor({ partnerships: false, playerCount: 4 }, [8, 7, 6, 5])).toEqual([]);
    expect(wheelsFor(team, ['books', 'books', 'books', 'books'])).toEqual([]);
  });
});
