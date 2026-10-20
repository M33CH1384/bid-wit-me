// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ambienceOn, sceneOf, settingsForContext, sound, wantsAmbience, wantsMusic, type SoundSettings } from '../src/audio';

const S = (p: Partial<SoundSettings>): SoundSettings => ({ on: true, volume: 0.7, ambient: false, music: false, musicVolume: 0.5, venueSound: false, ...p });
const persisted = (): SoundSettings => JSON.parse(localStorage.getItem('bwm.sound.v1')!);

describe('music / ambience independence (state)', () => {
  it('music-on leaves ambience alone: both stay on, and it persists', () => {
    sound.set({ music: false, ambient: true, venueSound: true });
    expect(sound.settings.ambient).toBe(true);
    sound.set({ music: true });
    expect(sound.settings).toMatchObject({ music: true, ambient: true, venueSound: true });
    expect(persisted()).toMatchObject({ music: true, ambient: true, venueSound: true });
  });
  it('lounge-ambience-on leaves music alone, and it persists', () => {
    sound.set({ music: true, ambient: false, venueSound: false });
    sound.set({ ambient: true });
    expect(sound.settings).toMatchObject({ music: true, ambient: true });
    expect(persisted()).toMatchObject({ music: true, ambient: true });
  });
  it('venue-ambience-on leaves music alone, and it persists', () => {
    sound.set({ music: true, ambient: false, venueSound: false });
    sound.set({ venueSound: true });
    expect(sound.settings).toMatchObject({ music: true, venueSound: true });
    expect(persisted()).toMatchObject({ music: true, venueSound: true });
  });
  it('toggling one switch off keeps the other on', () => {
    sound.set({ music: true, ambient: true, venueSound: true });
    sound.set({ music: false });
    expect(sound.settings).toMatchObject({ music: false, ambient: true, venueSound: true });
    sound.set({ music: true });
    sound.set({ ambient: false });
    expect(sound.settings).toMatchObject({ music: true, ambient: false, venueSound: true });
  });
  it('unrelated patches (volume, quality) never touch the switches', () => {
    sound.set({ music: true, ambient: true, venueSound: true });
    sound.set({ volume: 0.4 });
    expect(sound.settings).toMatchObject({ music: true, ambient: true, venueSound: true });
    sound.set({ ambient: false });
    sound.set({ volume: 0.6 });
    expect(sound.settings).toMatchObject({ music: true, ambient: false, venueSound: true });
  });
  it('a both-on saved state with no recorded choice gets the game default', () => {
    // No explicit per-context choice was ever recorded, so the game default
    // ('music') applies — same as the old music-wins reconciliation outcome.
    const both = S({ music: true, ambient: true, venueSound: true });
    expect(settingsForContext(both, 'game')).toMatchObject({ music: true, ambient: false, venueSound: false });
    expect(sceneOf(settingsForContext(both, 'game'))).toBe('music');
    // ...but a recorded 'both' choice applies both switches.
    const chosen = S({ music: true, ambient: true, venueSound: true, scenes: { game: 'both' } });
    expect(settingsForContext(chosen, 'game')).toMatchObject({ music: true, ambient: true, venueSound: true });
    expect(sceneOf(settingsForContext(chosen, 'game'))).toBe('both');
  });
});

describe('music / ambience independence (engine gates)', () => {
  it('each gate follows its own switches, for every switch combination', () => {
    for (const music of [false, true]) for (const ambient of [false, true]) for (const venueSound of [false, true]) {
      const s = S({ music, ambient, venueSound });
      expect(wantsMusic(s)).toBe(music);
      expect(wantsAmbience(s)).toBe(ambient || venueSound);
      expect(ambienceOn(s)).toBe(ambient || venueSound);
    }
  });
  it('both engines can be live at once (The Pj\'s bed + music)', () => {
    const s = S({ music: true, ambient: false, venueSound: true });
    expect(wantsMusic(s)).toBe(true);
    expect(wantsAmbience(s)).toBe(true);
  });
  it('set() never kills the other side across a toggle sequence', () => {
    sound.set({ music: false, ambient: false, venueSound: false });
    sound.set({ music: true });
    expect(sound.settings).toMatchObject({ music: true, ambient: false, venueSound: false });
    sound.set({ ambient: true });
    expect(sound.settings).toMatchObject({ music: true, ambient: true, venueSound: false });
    sound.set({ venueSound: true });
    expect(sound.settings).toMatchObject({ music: true, ambient: true, venueSound: true });
    expect(persisted()).toMatchObject({ music: true, ambient: true, venueSound: true });
    sound.set({ music: false });
    expect(sound.settings).toMatchObject({ music: false, ambient: true, venueSound: true });
  });
});

describe('context defaults (menus: none, game: music)', () => {
  const reset = () => { sound.set({ scenes: undefined }); sound.enterContext('menu'); };
  it('menu context defaults to no background scene, game to music on / ambience off', () => {
    reset();
    expect(sound.soundContext).toBe('menu');
    expect(sound.settings).toMatchObject({ music: false, ambient: false, venueSound: false });
    sound.enterContext('game');
    expect(sound.settings).toMatchObject({ music: true, ambient: false, venueSound: false });
    sound.enterContext('menu');
    expect(sound.settings).toMatchObject({ music: false, ambient: false, venueSound: false });
    // applying a DEFAULT never records an explicit choice
    expect(sound.settings.scenes?.menu).toBeUndefined();
    expect(sound.settings.scenes?.game).toBeUndefined();
  });
  it('an explicit choice in one context is respected there and never leaks into the other', () => {
    reset();
    sound.set({ music: true }); // in menus: explicit menu choice = music
    expect(sound.settings.scenes?.menu).toBe('music');
    sound.enterContext('game'); // game still on its default
    expect(sound.settings).toMatchObject({ music: true, ambient: false });
    sound.set({ ambient: true }); // in game: music stays on from the default, so the recorded scene is 'both'
    expect(sound.settings.scenes?.game).toBe('both');
    sound.enterContext('menu'); // menu remembers music
    expect(sound.settings).toMatchObject({ music: true, ambient: false, venueSound: false });
    sound.enterContext('game'); // game remembers both
    expect(sound.settings).toMatchObject({ music: true, ambient: true, venueSound: true });
    expect(persisted().scenes).toEqual({ menu: 'music', game: 'both' });
  });
  it('an explicit "neither" choice is respected and persisted per context', () => {
    reset();
    sound.enterContext('game');
    sound.set({ music: false }); // deliberate off, in game
    expect(sceneOf(sound.settings)).toBe('none');
    expect(sound.settings.scenes?.game).toBe('none');
    sound.enterContext('menu');
    sound.enterContext('game'); // still neither in game
    expect(sceneOf(sound.settings)).toBe('none');
    expect(persisted().scenes?.game).toBe('none');
  });
  it('mute-all does not overwrite explicit per-context choices', () => {
    reset();
    sound.set({ music: true }); // explicit menu = music
    sound.toggleMuteAll();
    expect(sound.settings.scenes?.menu).toBe('music');
    sound.toggleMuteAll();
    expect(sound.settings.scenes?.menu).toBe('music');
  });
  it('a both-on save applies per context (no scene in menus, default music in game)', () => {
    const both = S({ music: true, ambient: true, venueSound: true });
    expect(settingsForContext(both, 'menu')).toMatchObject({ music: false, ambient: false, venueSound: false });
    expect(settingsForContext(both, 'game')).toMatchObject({ music: true, ambient: false, venueSound: false });
    const withChoices = S({ music: true, ambient: true, venueSound: true, scenes: { menu: 'music', game: 'none' } });
    expect(settingsForContext(withChoices, 'menu')).toMatchObject({ music: true, ambient: false });
    expect(sceneOf(settingsForContext(withChoices, 'game'))).toBe('none');
  });
  it('persisted state reloads into the menu context scene (the load path)', () => {
    reset();
    sound.enterContext('game'); sound.set({ ambient: true }); // explicit game = both (music was on from default)
    const reloaded = settingsForContext(persisted(), 'menu'); // what load() computes at boot
    expect(reloaded).toMatchObject({ music: false, ambient: false }); // menu default is no background scene now
    expect(settingsForContext(persisted(), 'game')).toMatchObject({ music: true, ambient: true }); // game choice kept
  });
});
