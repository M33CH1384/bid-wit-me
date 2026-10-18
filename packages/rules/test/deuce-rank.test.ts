import { describe, expect, it } from 'vitest';
import {
  type Card, type Play, type TableRules, cardPower, effectiveSuit, isTrump, legalPlaysFor, makeRules, sortHand, trickWinner, trumpOrder,
} from '../src';

/**
 * Wild-deuce rank, pinned end to end (Demetrius, live beta: "It doesn't look
 * like the two spades is holding its rank as a wild deuce").
 * The pinned house order is BJ > LJ > 2♦ > 2♠ > A♠ — do not reorder.
 * These tests prove the RULES hold that order in winner evaluation and
 * suit-following in team and Cutthroat; the live-beta issue was display
 * (see apps/web/test/wild-deuce.test.ts).
 */
const MODES: Record<string, TableRules> = {
  'team joker (house)': makeRules('joker'),
  'cutthroat 4': makeRules('cutthroat', { playerCount: 4 }),
  'cutthroat 3': makeRules('cutthroat', { playerCount: 3 }),
};
const plays = (...cards: Card[]): Play[] => cards.map((card, seat) => ({ seat, card }));

for (const [name, r] of Object.entries(MODES)) {
  describe(`wild deuces hold rank — ${name}`, () => {
    it('pins the exact trump order BJ > LJ > 2♦ > 2♠ > A♠ (not reordered)', () => {
      expect(trumpOrder(r).slice(0, 5)).toEqual(['BJ', 'LJ', '2D', '2S', 'AS']);
      expect(cardPower('BJ', r)).toBeGreaterThan(cardPower('LJ', r));
      expect(cardPower('LJ', r)).toBeGreaterThan(cardPower('2D', r));
      expect(cardPower('2D', r)).toBeGreaterThan(cardPower('2S', r));
      expect(cardPower('2S', r)).toBeGreaterThan(cardPower('AS', r));
    });

    it('trick winner: both deuces beat A♠, lose to the jokers above them, 2♦ beats 2♠', () => {
      expect(trickWinner(plays('AS', '2S'), r)).toBe(1); // A♠ led, 2♠ over it
      expect(trickWinner(plays('2S', 'AS'), r)).toBe(0); // 2♠ led, A♠ cannot overtake
      expect(trickWinner(plays('AS', '2D'), r)).toBe(1);
      expect(trickWinner(plays('2S', '2D'), r)).toBe(1); // 2♦ over 2♠
      expect(trickWinner(plays('2D', '2S'), r)).toBe(0);
      expect(trickWinner(plays('2S', 'LJ'), r)).toBe(1); // only jokers sit above the deuces
      expect(trickWinner(plays('2S', 'BJ'), r)).toBe(1);
      expect(trickWinner(plays('2D', 'BJ'), r)).toBe(1);
      expect(trickWinner(plays('AH', '2S'), r)).toBe(1); // trump-in on an off-suit lead
      expect(trickWinner(plays('AH', '2D'), r)).toBe(1);
      expect(trickWinner(plays('2S', 'KH'), r)).toBe(0); // off-suit cannot touch a led deuce
    });

    it('suit-following: 2♦ counts as a spade, never as a diamond', () => {
      expect(effectiveSuit('2D', r)).toBe('S');
      expect(effectiveSuit('2S', r)).toBe('S');
      expect(isTrump('2D', r)).toBe(true);
      expect(isTrump('2S', r)).toBe(true);
      // spades led: the 2♦ must be played (it cannot be held back as a "diamond")
      expect(legalPlaysFor(r, ['2D', '3H'], plays('AS'), true)).toEqual(['2D']);
      expect(legalPlaysFor(r, ['2S', '3H'], plays('AS'), true)).toEqual(['2S']);
      // 2♦ led IS a spade lead: a real spade must follow
      expect(legalPlaysFor(r, ['2S', '3H'], plays('2D'), true)).toEqual(['2S']);
      // diamonds led with a real diamond in hand: the 2♦ is NOT a diamond and cannot follow
      expect(legalPlaysFor(r, ['2D', '3D'], plays('AD'), true)).toEqual(['3D']);
      // diamonds led, void in diamonds: anything (incl. a deuce trump) may go
      expect(legalPlaysFor(r, ['2D', '3H'], plays('AD'), true)).toEqual(['2D', '3H']);
    });

    it('hand sort: both deuces sit in the trump group at deuce rank, above A♠', () => {
      expect(sortHand(['AS', '2S', '3H', '2D', 'LJ', 'BJ', 'KS'], r)).toEqual(['BJ', 'LJ', '2D', '2S', 'AS', 'KS', '3H']);
    });
  });
}

describe('hand sort: Demetrius exact hand (Mansion, jokers)', () => {
  // His fan, L-to-R as dealt: J♠ 10♠ 9♠ 6♠ 5♠ 3♠ 2♠ 9♦ 5♦ with the 2♠ buried
  // as a plain low 2. In a jokers game the 2♠ is a wild deuce: it must head
  // the hand, above the plain J♠ (and above A♠ when present), 2♦ above it.
  const his: Card[] = ['JS', 'TS', '9S', '6S', '5S', '3S', '2S', '9D', '5D'];
  it('sorts 2♠ first in every joker mode', () => {
    for (const r of Object.values(MODES)) {
      expect(sortHand(his, r)).toEqual(['2S', 'JS', 'TS', '9S', '6S', '5S', '3S', '9D', '5D']);
      expect(sortHand([...his, 'AS', '2D', 'BJ'], r).slice(0, 4)).toEqual(['BJ', '2D', '2S', 'AS']);
    }
  });
  it('self-heals a house-shaped trumpOrderTop that dropped 2♠ (stale/serialised rules)', () => {
    const stale = makeRules('joker', { trumpOrderTop: ['BJ', 'LJ', '2D'] });
    expect(trumpOrder(stale).slice(0, 5)).toEqual(['BJ', 'LJ', '2D', '2S', 'AS']);
    expect(sortHand(his, stale)).toEqual(['2S', 'JS', 'TS', '9S', '6S', '5S', '3S', '9D', '5D']);
    expect(cardPower('2S', stale)).toBeGreaterThan(cardPower('AS', stale));
  });
  it('classic shape is unchanged: BJ/LJ top with 2♦ removed keeps its own order', () => {
    const classic = makeRules('joker', { trumpOrderTop: ['BJ', 'LJ'], removedCards: ['2H', '2D'] });
    expect(trumpOrder(classic).slice(0, 3)).toEqual(['BJ', 'LJ', 'AS']);
  });
});
