import { describe, expect, it } from 'vitest';
import type { Card } from '@spades/rules';
import { cardControlLabel, spokenCard } from '../src/cardA11y';

describe('spoken card controls', () => {
  it('names an ace the way a screen reader should say it', () => {
    expect(spokenCard('AS')).toBe('Ace of spades');
    expect(cardControlLabel('AS', true)).toBe('Ace of spades, playable');
    expect(cardControlLabel('AS', false)).toBe('Ace of spades, not playable');
  });

  it('spells out tens, face cards, and the other suits', () => {
    expect(spokenCard('TH')).toBe('Ten of hearts');
    expect(spokenCard('QD')).toBe('Queen of diamonds');
    expect(spokenCard('KC')).toBe('King of clubs');
    expect(spokenCard('2S')).toBe('Two of spades');
  });

  it('names both jokers', () => {
    expect(cardControlLabel('BJ', true)).toBe('Big Joker, playable');
    expect(cardControlLabel('LJ', false)).toBe('Little Joker, not playable');
  });

  it('gives every card one label', () => {
    const cards = ['AS', 'TD', '9H', 'BJ', 'LJ'] as const satisfies readonly Card[];
    const labels = cards.map((c) => cardControlLabel(c, true));
    expect(new Set(labels).size).toBe(cards.length);
    for (const label of labels) expect(label.endsWith(', playable')).toBe(true);
  });
});
