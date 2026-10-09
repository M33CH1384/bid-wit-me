import { describe, expect, it } from 'vitest';
import { cardLabel, isCard, isJoker, naturalSuit, parseCard, rankOf, standardDeck } from '../src';

describe('cards', () => {
  it('has 52 unique standard cards', () => {
    const d = standardDeck();
    expect(d).toHaveLength(52);
    expect(new Set(d).size).toBe(52);
  });
  it('recognises jokers and suits', () => {
    expect(isJoker('BJ')).toBe(true);
    expect(isJoker('AS')).toBe(false);
    expect(naturalSuit('BJ')).toBeNull();
    expect(naturalSuit('TD')).toBe('D');
    expect(rankOf('TD')).toBe('T');
    expect(rankOf('LJ')).toBeNull();
  });
  it('validates and parses card codes', () => {
    expect(isCard('AS')).toBe(true);
    expect(isCard('1S')).toBe(false);
    expect(isCard(5)).toBe(false);
    expect(parseCard('10h')).toBe('TH');
    expect(parseCard(' bj ')).toBe('BJ');
    expect(() => parseCard('ZZ')).toThrow();
  });
  it('labels cards for humans', () => {
    expect(cardLabel('TS')).toBe('10♠');
    expect(cardLabel('AH')).toBe('A♥');
    expect(cardLabel('BJ')).toBe('Big Joker');
    expect(cardLabel('LJ')).toBe('Little Joker');
  });
});
