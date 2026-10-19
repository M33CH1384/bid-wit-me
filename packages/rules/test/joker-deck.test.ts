import { describe, expect, it } from 'vitest';
import {
  CLASSIC_JOKER, buildDeck, deckForHand, makeRules, newGame, removedForActive,
} from '../src';

/**
 * Exact joker-deck composition (Demetrius, live beta: "I'm playing a joker
 * game, but I'm seeing the two of clubs that should be removed in addition
 * to the two of hearts. The only remaining twos should be the two of spades
 * and the two of diamonds.").
 * Spec for every joker-deck path: BJ + LJ in, 2♠ + 2♦ the only deuces,
 * 2♥ and 2♣ removed. Deal counts: 4p = 52 (13 each), 3p = 51 (17 each).
 */
function expectExactJokerDeck(r: ReturnType<typeof makeRules>, size: number, perHand: number) {
  const deck = buildDeck(r);
  expect(deck).toHaveLength(size);
  expect(deck).toContain('BJ');
  expect(deck).toContain('LJ');
  expect(deck).toContain('2S');
  expect(deck).toContain('2D');
  expect(deck).not.toContain('2H');
  expect(deck).not.toContain('2C');
  expect(deck.filter((c) => c[0] === '2')).toEqual(['2S', '2D']);
  expect(new Set(deck).size).toBe(size); // no duplicates reintroduced anywhere
  const st = newGame(r, 'exact-joker-deck');
  expect(st.hands.map((h) => h.length)).toEqual(r.playerCount === 3 ? [perHand, perHand, perHand] : [perHand, perHand, perHand, perHand]);
  expect(st.hands.flat()).not.toContain('2C');
  expect(st.hands.flat()).not.toContain('2H');
  expect(deckForHand(r, 'exact-joker-deck', 1)).toEqual(expect.arrayContaining(['BJ', 'LJ', '2S', '2D']));
}

describe('exact joker-deck composition on every deck-building path', () => {
  it('team Joker (house): 52 cards, 13 each', () => {
    expectExactJokerDeck(makeRules('joker'), 52, 13);
  });
  it('Cutthroat 4 (joker deck): 52 cards, 13 each', () => {
    expectExactJokerDeck(makeRules('cutthroat', { playerCount: 4 }), 52, 13);
  });
  it('Cutthroat 3 (joker deck): 51 cards, 17 each (2♣, 2♥, 3♣ out)', () => {
    const r = makeRules('cutthroat', { playerCount: 3 });
    expect(r.removedCards).toEqual(['2C', '2H', '3C']);
    expectExactJokerDeck(r, 51, 17);
  });
  it('Cutthroat active-count transitions never reintroduce 2♣/2♥ (3 still in drops 3♣; 2 still in keeps both deuces out)', () => {
    const r = makeRules('cutthroat', { playerCount: 4 });
    expect(removedForActive(r, 4)).toEqual(['2C', '2H']);
    expect(removedForActive(r, 3)).toEqual(['2C', '2H', '3C']);
    expect(removedForActive(r, 2)).toEqual(['2C', '2H']);
  });
  it('Classic joker-order variant removes 2♥+2♣ (Demetrius 2026-10-19: no 2s of hearts/clubs in any Joker game)', () => {
    // Updated 2026-10-19: Classic now removes 2♥+2♣ like all Joker variants.
    // The 2♦ stays in the deck as a regular diamond (not a trump in Classic).
    const r = makeRules('joker', CLASSIC_JOKER);
    const deck = buildDeck(r);
    expect(deck).toHaveLength(52);
    expect(deck).not.toContain('2C');
    expect(deck).not.toContain('2H');
    expect(deck).toContain('2D');
    expect(deck.filter((c) => c[0] === '2')).toEqual(['2S', '2D']);
  });
});
