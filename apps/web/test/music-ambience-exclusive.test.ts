// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ambienceOn, exclusiveMusicAmbience, sceneOf, settingsForContext, sound, wantsAmbience, wantsMusic, type SoundSettings } from '../src/audio';

const S = (p: Partial<SoundSettings>): SoundSettings => ({ on: true, volume: 0.7, ambient: false, music: false, musicVolume: 0.5, venueSound: false, ...p });
const persisted = (): SoundSettings => JSON.parse(localStorage.getItem('bwm.sound.v1')!);

describe('music / ambience mutual exclusivity (state)', () => {
  it('music-on kills ambience: both the lounge pad and the venue bed go off, and it persists', () => {
    sound.set({ music: false, ambient: true, venueSound: true });
    expect(sound.settings.ambient).toBe(true);
    sound.set({ music: true });
    expect(sound.settings).toMatchObject({ music: true, ambient: false, venueSound: false });
    expect(persisted()).toMatchObject({ music: true, ambient: false, venueSound: false });
  });
  it('lounge-ambience-on kills music, and it persists', () => {
    sound.set({ music: true, ambient: false, venueSound: false });
    sound.set({ ambient: true });
    expect(sound.settings).toMatchObject({ music: false, ambient: true });
    expect(persisted()).toMatchObject({ music: false, ambient: true });
  });
  it('venue-ambience-on kills music, and it persists', () => {
    sound.set({ music: true, ambient: false, venueSound: false });
    sound.set({ venueSound: true });
    expect(sound.settings).toMatchObject({ music: false, venueSound: true });
    expect(persisted()).toMatchObject({ music: false, venueSound: true });
  });
  it('whichever was chosen last wins, back and forth', () => {
    sound.set({ ambient: true });
    expect(sound.settings.music).toBe(false);
    sound.set({ music: true });
    expect(sound.settings.ambient).toBe(false);
    sound.set({ venueSound: true });
    expect(sound.settings.music).toBe(false);
    sound.set({ music: true });
    expect(sound.settings.venueSound).toBe(false);
  });
  it('unrelated patches (volume, quality) never resurrect the other side', () => {
    sound.set({ music: true, ambient: false, venueSound: false });
    sound.set({ volume: 0.4 });
    expect(sound.settings).toMatchObject({ music: true, ambient: false, venueSound: false });
    sound.set({ ambient: true });
    sound.set({ volume: 0.6 });
    expect(sound.settings).toMatchObject({ music: false, ambient: true });
  });
  it('a legacy both-on saved state reloads reconciled (music wins) via the load-path rule', () => {
    const legacy = S({ music: true, ambient: true, venueSound: true });
    const loaded = exclusiveMusicAmbience(legacy); // exactly what load() applies to stored JSON
    expect(loaded).toMatchObject({ music: true, ambient: false, venueSound: false });
    expect(exclusiveMusicAmbience(S({ music: false, ambient: true }))).toMatchObject({ music: false, ambient: true });
    expect(exclusiveMusicAmbience(S({ music: true }))).toMatchObject({ music: true, venueSound: false });
  });
});

describe('music / ambience mutual exclusivity (engine gates)', () => {
  it('the engine can never output both, for every switch combination', () => {
    for (const music of [false, true]) for (const ambient of [false, true]) for (const venueSound of [false, true]) {
      const s = S({ music, ambient, venueSound });
      const musicOut = wantsMusic(s);
      const ambienceOut = ambienceOn(s) && wantsAmbience(s);
      expect(musicOut && ambienceOut).toBe(false);
      if (music && ambienceOn(s)) expect(musicOut).toBe(false); // any ambience on blocks music
      if (music && !ambienceOn(s)) expect(musicOut).toBe(true);
      if (!music && ambienceOn(s)) expect(ambienceOut).toBe(true);
    }
  });
  it('after any set(), the live engine state itself is never both-on', () => {
    const seq: Partial<SoundSettings>[] = [{ music: true }, { ambient: true }, { venueSound: true }, { music: true }, { venueSound: false }, { ambient: true }, { music: false }];
    for (const patch of seq) {
      sound.set(patch);
      const s = sound.settings;
      expect(s.music && ambienceOn(s)).toBe(false);
      expect(persisted().music && ambienceOn(persisted())).toBe(false);
    }
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
    sound.set({ ambient: true }); // in game: explicit game choice = ambience
    expect(sound.settings.scenes?.game).toBe('ambience');
    sound.enterContext('menu'); // menu remembers music
    expect(sound.settings).toMatchObject({ music: true, ambient: false, venueSound: false });
    sound.enterContext('game'); // game remembers ambience
    expect(sound.settings).toMatchObject({ music: false, ambient: true });
    expect(persisted().scenes).toEqual({ menu: 'music', game: 'ambience' });
  });
  it('an explicit "neither" choice is respected and persisted per context', () => {
    reset();
    sound.enterContext('game');
    sound.set({ music: true });
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
  it('a legacy both-on save reconciles PER CONTEXT (no scene in menus, music in game)', () => {
    const legacy = S({ music: true, ambient: true, venueSound: true });
    expect(settingsForContext(legacy, 'menu')).toMatchObject({ music: false, ambient: false, venueSound: false });
    expect(settingsForContext(legacy, 'game')).toMatchObject({ music: true, ambient: false, venueSound: false });
    const withChoices = S({ music: true, ambient: true, venueSound: true, scenes: { menu: 'music', game: 'none' } });
    expect(settingsForContext(withChoices, 'menu')).toMatchObject({ music: true, ambient: false });
    expect(sceneOf(settingsForContext(withChoices, 'game'))).toBe('none');
  });
  it('persisted state reloads into the menu context scene (the load path)', () => {
    reset();
    sound.enterContext('game'); sound.set({ ambient: true }); // explicit game = ambience, live = ambience
    const reloaded = settingsForContext(persisted(), 'menu'); // what load() computes at boot
    expect(reloaded).toMatchObject({ music: false, ambient: false }); // menu default is no background scene now
    expect(settingsForContext(persisted(), 'game')).toMatchObject({ music: false, ambient: true }); // game choice kept
  });
});
