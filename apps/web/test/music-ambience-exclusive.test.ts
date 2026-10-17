// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ambienceOn, exclusiveMusicAmbience, sound, wantsAmbience, wantsMusic, type SoundSettings } from '../src/audio';

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
