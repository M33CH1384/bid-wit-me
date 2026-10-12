import { describe, expect, it } from 'vitest';
import { type Card, makeRules, sortHand } from '@spades/rules';
import { departureSlot, handCardKey, handReactKey, retainHandOrder } from '../src/handOrder';

const rules = makeRules('joker', { firstHandBidsItself: false });

describe('hand order', () => {
  it('sorts when the hand is dealt and never again after a play', () => {
    const dealt = ['3H', 'AS', 'BJ', 'KC', '9D', 'AH'] as Card[];
    const sorted = retainHandOrder(null, dealt, rules);
    expect(sorted).toEqual(['BJ', 'AS', 'AH', '3H', 'KC', '9D']);
    expect(sorted).toEqual(sortHand(dealt, rules));

    // a fan the player is already looking at, even if it is not the sorted order
    const frozen = ['9D', 'AH', 'KC', '3H', 'AS', 'BJ'] as Card[];
    const played = retainHandOrder(frozen, frozen.filter((c) => c !== 'KC'), rules);
    expect(played).toEqual(['9D', 'AH', '3H', 'AS', 'BJ']);
    expect(played).not.toEqual(sortHand(played, rules));
  });

  it('keeps that order when the server sends the same cards in a different array', () => {
    const dealt = ['3H', 'AS', 'BJ', 'KC', '9D', 'AH'] as Card[];
    const once = retainHandOrder(null, dealt, rules);
    const echoed = retainHandOrder(once, [...once].reverse(), rules);
    expect(echoed).toEqual(once);
    const after = retainHandOrder(echoed, echoed.filter((c) => c !== 'AH'), rules);
    expect(after).toEqual(once.filter((c) => c !== 'AH'));
  });

  it('sorts a new deal that shares no cards, and inserts an exchange without moving the rest', () => {
    const prev = ['AS', 'KH', 'QD'] as Card[];
    expect(retainHandOrder(prev, ['5C', '3C', '4C'], rules)).toEqual(sortHand(['5C', '3C', '4C'], rules));

    const held = ['AH', '9D'] as Card[];
    expect(retainHandOrder(held, ['AH', '9D', '3H'], rules)).toEqual(['AH', '3H', '9D']);
    expect(retainHandOrder(['9D', 'AH', '3H'], ['9D', 'AH', '3H', 'BJ', 'KC'], rules)).toEqual(['BJ', 'KC', '9D', 'AH', '3H']);
  });

  it('keys a face-up card by suit and rank, not by its index or whether it is legal', () => {
    expect(handCardKey('10H')).toBe('10H');
    expect(handCardKey('BJ')).toBe('BJ');
    expect(handReactKey(3, 'AS', 0)).toBe('3-AS');
    expect(handReactKey(3, 'AS', 4)).toBe(handReactKey(3, 'AS', 0));
    expect(handReactKey(4, 'AS', 0)).toBe('4-AS');
    expect(handReactKey(3, null, 2)).toBe('3-hb-2');
    const before = ['AS', 'KH', '2C'].map((c, i) => handReactKey(1, c as Card, i));
    const after = ['AS', '2C'].map((c, i) => handReactKey(1, c as Card, i));
    expect(after).toEqual(['1-AS', '1-2C']);
    expect(before.filter((k) => k !== '1-KH')).toEqual(after);
  });

  it('starts a played card from the slot it left, not from a card that was never in hand', () => {
    const slots = new Map<string, { at: string }>([
      ['AS', { at: 'left' }],
      ['KH', { at: 'middle' }],
    ]);
    const was = new Set(['AS', 'KH']);
    expect(departureSlot(slots, was, 'KH')).toEqual({ at: 'middle' });
    expect(departureSlot(slots, was, '2C')).toBeUndefined();
    expect(departureSlot(slots, new Set(['AS']), 'KH')).toBeUndefined();
  });
});
