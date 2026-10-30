import { describe, expect, it } from 'vitest';
import {
  type Card, type GameState, type PlayerView, type Rng, createRng, legalPlaysFor, makeRules, newGame, viewFor,
} from '@spades/rules';
import { choosePlay } from '../src';

/**
 * Regression: the novice 'sloppy' path threw `RangeError: bad range 0`
 * (rng.int(0) in sloppy(), play.ts) when a bot was asked to play from a
 * view whose legal list was EMPTY while the seat still held cards — the
 * all-off-suit filler hand shape the deuce-FX lane hit after resume
 * (reproduced in Node + browser, 2026-10-30). An empty candidate range
 * must never reach the RNG: the play selection recomputes the legal set
 * from the hand (the engine's legalPlaysFor) and follows the normal path.
 */
const rules = makeRules('joker');

// Seat 1's pinned hand: ALL off-suit filler vs a spade lead — diamonds and
// hearts only, no spades, no trumps (2D would be trump; it is not here).
const FILLER: Card[] = ['3D', '4D', '5D', '6D', '7D', '8D', '9D', '3H', '4H', '5H', '6H', '7H', '8H'];

function rigMidTrick(): GameState {
  const hands: Card[][] = [
    ['KS', 'QS', 'JS', 'TS', '9S', '8S', '7S', '6S', '5S', '4S', '3S', '2S'], // seat 0, A♠ already led
    FILLER,
    ['BJ', 'LJ', '2D', 'TD', 'JD', 'QD', 'KD', 'AD', '9H', 'TH', 'JH', 'QH', 'KH'],
    ['AH', '3C', '4C', '5C', '6C', '7C', '8C', '9C', 'TC', 'JC', 'QC', 'KC', 'AC'],
  ];
  const st = newGame(rules, 'empty-legal-repro');
  return {
    ...st, phase: 'playing', bids: [4, 4, 4, 4], dealer: 3, turn: 1, hands,
    revealed: [true, true, true, true],
    trick: { leader: 0, plays: [{ seat: 0, card: 'AS' }], winner: null },
  };
}

/** An rng whose float() forces the novice blunder branch; int/nextUint32 are the real seeded rng. */
function blunderRng(): Rng {
  const real = createRng('empty-legal-pinned');
  return { nextUint32: () => real.nextUint32(), int: (n) => real.int(n), float: () => 0 };
}

describe('choosePlay with an empty legal list (rng.int(0) regression)', () => {
  it('the engine view itself is never empty for this hand — the bug needs the emptied view', () => {
    const v = viewFor(rigMidTrick(), 1);
    // Off-suit: legalPlaysFor falls back to the whole hand.
    expect(v.legal).toEqual(FILLER);
  });

  it('novice sloppy path: does not throw, plays a card from the hand', () => {
    const v: PlayerView = { ...viewFor(rigMidTrick(), 1), legal: [] };
    let card: Card | undefined;
    expect(() => { card = choosePlay(v, 'novice', blunderRng()); }).not.toThrow();
    expect(card).toBeDefined();
    expect(FILLER).toContain(card);
    expect(legalPlaysFor(rules, FILLER, v.trick.plays, v.spadesBroken)).toContain(card);
  });

  it('novice leading (no plays yet) with an empty legal list: does not throw, plays from the hand', () => {
    const st = rigMidTrick();
    const lead: GameState = { ...st, turn: 1, trick: { leader: 1, plays: [], winner: null } };
    const v: PlayerView = { ...viewFor(lead, 1), legal: [] };
    let card: Card | undefined;
    expect(() => { card = choosePlay(v, 'novice', blunderRng()); }).not.toThrow();
    expect(card).toBeDefined();
    expect(FILLER).toContain(card);
  });

  it('regular and pro on the same emptied view return a real card, not undefined', () => {
    const v: PlayerView = { ...viewFor(rigMidTrick(), 1), legal: [] };
    for (const level of ['regular', 'pro'] as const) {
      const card = choosePlay(v, level, createRng('empty-legal-other-skills'));
      expect(card).toBeDefined();
      expect(FILLER).toContain(card);
    }
  });

  it('the same hand through the normal (non-emptied) view still plays legally', () => {
    const v = viewFor(rigMidTrick(), 1);
    const card = choosePlay(v, 'novice', blunderRng());
    expect(FILLER).toContain(card);
  });
});
