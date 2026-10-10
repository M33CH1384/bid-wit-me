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

import { wheelsMade, wheelsTenth } from '../src/landCue';
describe('wheels made / Cutthroat 10th book', () => {
  const team = { partnerships: true, playerCount: 4 };
  it('team: bid 10+ together AND took 10+', () => {
    expect(wheelsMade(team, { bids: [6, 1, 4, 2], sides: [{ side: 0, tricks: 10 }, { side: 1, tricks: 3 }] })).toEqual([{ side: 0, bid: 10, books: 10 }]);
    expect(wheelsMade(team, { bids: [6, 1, 4, 2], sides: [{ side: 0, tricks: 9 }, { side: 1, tricks: 4 }] })).toEqual([]);
    expect(wheelsMade(team, { bids: [4, 1, 4, 2], sides: [{ side: 0, tricks: 11 }, { side: 1, tricks: 2 }] })).toEqual([]);
  });
  it('cutthroat: the moment a player reaches 10 books, once', () => {
    expect(wheelsTenth({ partnerships: false }, [9, 1, 0], [10, 1, 0])).toEqual([0]);
    expect(wheelsTenth({ partnerships: false }, [10, 1, 0], [11, 1, 0])).toEqual([]);
    expect(wheelsTenth({ partnerships: true }, [9, 1, 0, 0], [10, 1, 0, 0])).toEqual([]);
  });
});

import { cutLevel } from '../src/landCue';
import { makeRules } from '@spades/rules';
describe('cut levels / over-cuts', () => {
  const P = (...cs: string[]) => cs.map((card, seat) => ({ seat, card })) as never;
  const joker = makeRules('joker');
  const aceDown = makeRules('aceDown');
  it('first cut = 1, over-cut = 2, double over-cut = 3 (Ace Down)', () => {
    const t = P('KH', '3S', '9S', 'QS');
    expect([1, 2, 3].map((i) => cutLevel(t, i, aceDown))).toEqual([1, 2, 3]);
  });
  it('a lower trump that does not take the lead is level 0; later over-cut still counts it right', () => {
    const t = P('KH', '9S', '3S', 'QS');
    expect([1, 2, 3].map((i) => cutLevel(t, i, aceDown))).toEqual([1, 0, 2]);
  });
  it('trump lead or no cut → 0', () => {
    expect(cutLevel(P('2S', '9S', 'AS', 'KH'), 2, aceDown)).toBe(0);
    expect(cutLevel(P('KH', 'AH', '2H', '3H'), 1, aceDown)).toBe(0);
  });
  it('Joker mode order: 2♦ and Jokers are trumps; Jokers count as levels', () => {
    // hearts led; A♠ cuts (1), 2♦ over-cuts (2), Little Joker over-cuts (3)
    const t = P('KH', 'AS', '2D', 'LJ');
    expect([1, 2, 3].map((i) => cutLevel(t, i, joker))).toEqual([1, 2, 3]);
    // Big Joker first, then a spade can't take the lead → 0
    expect(cutLevel(P('KC', 'BJ', 'AS', '3C'), 2, joker)).toBe(0);
  });
});

import { OVERCUT_CALLOUTS, landCueFor, overcutCallout } from '../src/landCue';
describe('over-cut callouts', () => {
  const r = makeRules('aceDown');
  const T = (...cs: string[]) => ({ leader: 0, winner: null, plays: cs.map((card, seat) => ({ seat, card })) }) as never;
  it('same text for every client, from the pool, never the same twice in a row', () => {
    const st = { handNo: 3, rules: r, tricks: [T('KH', '3S', '9S', '2H'), T('KD', '4S', '8S', 'QS')], trick: T('KC', '5S', 'JS') } as never;
    const a = overcutCallout(st, '9S' as never), b = overcutCallout(st, '8S' as never), c = overcutCallout(st, 'QS' as never), d = overcutCallout(st, 'JS' as never);
    for (const x of [a, b, c, d]) expect(OVERCUT_CALLOUTS).toContain(x);
    expect(b).not.toBe(a); expect(c).not.toBe(b); expect(d).not.toBe(c);
    expect(overcutCallout(st, 'QS' as never)).toBe(c); // deterministic
  });
  it('cue carries level + callout', () => {
    const st = { handNo: 1, rules: r, tricks: [], trick: T('KH', '3S', '9S', 'QS'), phase: 'playing' } as never;
    expect(landCueFor(st, '3S' as never)).toMatch(/cut|broken/);
    expect(landCueFor(st, '9S' as never)).toMatch(/^play,overcut\|/);
    expect(landCueFor(st, 'QS' as never)).toMatch(/^play,overcut3\|/);
  });
});
