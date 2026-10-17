import { describe, expect, it } from 'vitest';
import { DECKS, deckArtFile, deckArtUrl, deckName } from '../src/decks';
import { normalizeSettings } from '../src/settings';

describe('Desi decks', () => {
  it('all 7 decks registered, Hip-hop is Boombox Royals, all unlocked', () => {
    expect(DECKS).toHaveLength(7);
    expect(deckName('hiphop')).toBe('Boombox Royals');
    expect(DECKS.every((d) => !d.locked)).toBe(true);
    expect(DECKS.map((d) => d.id)).toEqual(['classic', 'afrofuturist', 'harlem', 'hiphop', 'mali', 'egypt', 'greek']);
  });
  it('only court cards and jokers have art; number cards keep painted faces', () => {
    expect(deckArtFile('KS')).toBe('KS'); expect(deckArtFile('QD')).toBe('QD'); expect(deckArtFile('JH')).toBe('JH');
    expect(deckArtFile('BJ')).toBe('JOKER-BIG'); expect(deckArtFile('LJ')).toBe('JOKER-LIL');
    expect(deckArtFile('7S')).toBeNull(); expect(deckArtFile('AS')).toBeNull();
    expect(deckArtUrl('hiphop', 'KS')).toBe('/assets/decks/hiphop/KS.jpg');
  });
  it('deck setting normalises to a known deck (default classic)', () => {
    expect(normalizeSettings({}).deck).toBe('classic');
    expect(normalizeSettings({ deck: 'hiphop' }).deck).toBe('hiphop');
    expect(normalizeSettings({ deck: 'nope' }).deck).toBe('classic');
  });
});
