import { describe, expect, it } from 'vitest';
import { DECKS, STORY_DECKS, deckArtFile, deckArtFileFor, deckArtUrl, deckForStop, deckName, deckThumbUrl, getDeckImage, onDeckArtLoad } from '../src/decks';
import { normalizeSettings } from '../src/settings';

describe('Desi decks', () => {
  it('the original 8 decks stay free, in order, Hip-hop is Boombox Royals', () => {
    expect(DECKS.map((d) => d.id).slice(0, 8)).toEqual(['base', 'classic', 'afrofuturist', 'harlem', 'hiphop', 'mali', 'egypt', 'greek']);
    expect(deckName('hiphop')).toBe('Boombox Royals');
    expect(DECKS.slice(0, 8).every((d) => !d.locked && !d.storyStopId)).toBe(true);
  });
  it('11 story decks follow in route order, each gated by its stop', () => {
    expect(DECKS).toHaveLength(19);
    expect(STORY_DECKS.map((d) => d.storyStopId)).toEqual(['porch', 'barbershop', 'rec-center', 'cookout', 'corner', 'church-basement', 'rooftop', 'high-rise', 'the-pjs', 'legends', 'king']);
    expect(STORY_DECKS.every((d) => d.locked && d.storyStopName)).toBe(true);
    expect(deckForStop('the-pjs')?.name).toBe("Pj's Iron");
    expect(deckForStop('king')?.name).toBe('Made It Out');
    expect(deckForStop('barbershop')?.id).toBe('revolutionaries');
  });
  it('only court cards and jokers have art; number cards keep painted faces', () => {
    expect(deckArtFile('KS')).toBe('KS'); expect(deckArtFile('QD')).toBe('QD'); expect(deckArtFile('JH')).toBe('JH');
    expect(deckArtFile('BJ')).toBe('JOKER-BIG'); expect(deckArtFile('LJ')).toBe('JOKER-LIL');
    expect(deckArtFile('7S')).toBeNull(); expect(deckArtFile('AS')).toBeNull();
    expect(deckArtUrl('hiphop', 'KS')).toBe('/assets/decks/hiphop/KS.jpg');
  });
  it("aces get art only in the Pj's Iron deck (which also ships WebP story art)", () => {
    expect(deckArtFileFor('pjs', 'AS')).toBe('AS');
    expect(deckArtFileFor('classic', 'AS')).toBeNull();
    expect(deckArtFileFor('revolutionaries', 'AH')).toBeNull();
    expect(deckArtUrl('pjs', 'AS')).toBe('/assets/decks/pjs/AS.webp');
    expect(deckArtUrl('revolutionaries', 'QC')).toBe('/assets/decks/revolutionaries/QC.webp');
    expect(deckArtUrl('pjs', '7S')).toBeNull();
    expect(deckThumbUrl('classic')).toBe('/assets/decks/classic/KS.jpg');
    expect(deckThumbUrl('madeitout')).toBe('/assets/decks/madeitout/KS.webp');
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
  it('deck setting normalises to a known deck (default classic); story deck ids survive', () => {
    expect(normalizeSettings({}).deck).toBe('classic');
    expect(normalizeSettings({ deck: 'hiphop' }).deck).toBe('hiphop');
    expect(normalizeSettings({ deck: 'pjs' }).deck).toBe('pjs');
    expect(normalizeSettings({ deck: 'madeitout' }).deck).toBe('madeitout');
    expect(normalizeSettings({ deck: 'base' }).deck).toBe('classic');
    expect(normalizeSettings({ deck: 'nope' }).deck).toBe('classic');
  });
});
