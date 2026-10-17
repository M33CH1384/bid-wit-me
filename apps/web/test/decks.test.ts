import { describe, expect, it } from 'vitest';
import { DECKS, deckArtFile, deckArtUrl, deckName, getDeckImage, onDeckArtLoad } from '../src/decks';
import { normalizeSettings } from '../src/settings';

describe('Desi decks', () => {
  it('all 8 decks registered, Hip-hop is Boombox Royals, all unlocked', () => {
    expect(DECKS).toHaveLength(8);
    expect(deckName('hiphop')).toBe('Boombox Royals');
    expect(DECKS.every((d) => !d.locked)).toBe(true);
    expect(DECKS.map((d) => d.id)).toEqual(['base', 'classic', 'afrofuturist', 'harlem', 'hiphop', 'mali', 'egypt', 'greek']);
  });
  it('only court cards and jokers have art; number cards keep painted faces', () => {
    expect(deckArtFile('KS')).toBe('KS'); expect(deckArtFile('QD')).toBe('QD'); expect(deckArtFile('JH')).toBe('JH');
    expect(deckArtFile('BJ')).toBe('JOKER-BIG'); expect(deckArtFile('LJ')).toBe('JOKER-LIL');
    expect(deckArtFile('7S')).toBeNull(); expect(deckArtFile('AS')).toBeNull();
    expect(deckArtUrl('hiphop', 'KS')).toBe('/assets/decks/hiphop/KS.jpg');
  });
  it('art-load listeners stay active: every later court image notifies (not just the first)', () => {
    const imgs: { onload: (() => void) | null; src: string; complete: boolean; naturalWidth: number }[] = [];
    class FakeImage { complete = false; naturalWidth = 0; onload: (() => void) | null = null; private _src = '';
      set src(v: string) { this._src = v; imgs.push(this); } get src() { return this._src; } }
    (globalThis as unknown as { Image: unknown }).Image = FakeImage;
    let notified = 0;
    onDeckArtLoad(() => { notified++; });
    getDeckImage('QD'); getDeckImage('JD');
    expect(imgs.length).toBeGreaterThanOrEqual(2);
    imgs[0]!.onload?.(); expect(notified).toBe(1);
    imgs[1]!.onload?.(); expect(notified).toBe(2); // splice-clearing regression made this stay 1
  });
  it('deck setting normalises to a known deck (default classic)', () => {
    expect(normalizeSettings({}).deck).toBe('classic');
    expect(normalizeSettings({ deck: 'hiphop' }).deck).toBe('hiphop');
    expect(normalizeSettings({ deck: 'nope' }).deck).toBe('classic');
  });
});
