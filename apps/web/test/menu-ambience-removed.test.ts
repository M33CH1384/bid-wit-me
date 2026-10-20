import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sceneOf, settingsForContext, type SoundSettings } from '../src/audio';

/**
 * Venue-ambience SCENES are no longer offered as menu/settings picks (founder
 * call): Block Party, Front Porch, Beauty Salon, Park Dominoes, Kitchen-Table
 * Spades Night and the Lounge ambience toggle. They were fully synthesized
 * (verified: no baked audio assets ship for them). The per-venue soundscape
 * beds (VenueBed) are a different system and stay: in-venue sound follows
 * the room you're in.
 */
describe('menu ambience scenes removed', () => {
  const controls = readFileSync(new URL('../src/SoundControls.tsx', import.meta.url), 'utf8');
  const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
  it('no scene rows in Settings or the sound sheet', () => {
    for (const gone of ['block-party-switch', 'front-porch-switch', 'beauty-salon-switch', 'park-dominoes-switch', 'kitchen-table-switch', 'Lounge ambience', 'Block Party', 'Front Porch', 'Beauty Salon', 'Park Dominoes']) {
      expect(controls).not.toContain(gone);
    }
    for (const gone of ['buildBlockParty', 'buildFrontPorch', 'buildBeautySalon', 'buildParkDominoes', 'buildKitchenTable', 'blockPartyWanted']) {
      expect(audio).not.toContain(gone);
    }
  });
  it('kept controls stay: Music, Venue sounds (room bed gate), Spatial', () => {
    expect(controls).toContain('data-testid="music-switch"');
    expect(controls).toContain('data-testid="venue-sound-switch"');
    expect(controls).toContain('data-testid="spatial-switch"');
  });
  it('the Room soundscape picker is retired (owner, 2026-10-20): each venue\'s signature sounds are automatic', () => {
    expect(controls).not.toContain('data-testid="soundscape-select"');
    expect(controls).not.toContain('Room (soundscape)');
    // the engine never reads a saved pick anymore, and load() strips it, so an old
    // stored choice simply stops affecting playback (no crash, no orphan override)
    expect(audio).not.toContain('this.settings.soundscape');
    expect(audio).toContain("delete saved['soundscape']");
  });
  it("in-venue soundscape beds are untouched, including Grandma's 'kitchen' bed", () => {
    expect(audio).toContain("case 'kitchen':");
    expect(audio).toContain('private syncVenue()');
    expect(audio).toContain('applySoundscape');
  });
  it('a saved menu ambience scene is no longer applied in menus; in-game ambience still means the venue bed', () => {
    const legacy = { on: true, volume: 0.7, ambient: true, music: false, musicVolume: 0.5, venueSound: true, scenes: { menu: 'ambience', game: 'ambience' } } as SoundSettings;
    const menu = settingsForContext(legacy, 'menu');
    expect(sceneOf(menu)).toBe('none'); // menus: no background scene by default
    const game = settingsForContext(legacy, 'game');
    expect(sceneOf(game)).toBe('ambience'); // game choice kept: venue bed can sound in the room
    expect(game.venueSound).toBe(true);
  });
});
