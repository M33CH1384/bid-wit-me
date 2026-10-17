// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { beautySalonWanted, blockPartyWanted, exclusiveMenuAmbience, frontPorchWanted, kitchenTableWanted, menuAmbienceOf, parkDominoesWanted, settingsForContext, sound, type SoundSettings } from '../src/audio';

const persisted = (): SoundSettings => JSON.parse(localStorage.getItem('bwm.sound.v1')!);
const reset = () => { sound.set({ scenes: undefined, blockParty: false, frontPorch: false, beautySalon: false, parkDominoes: false, kitchenTable: false, menuAmbience: undefined }); sound.enterContext('menu'); };
const menuFlags = (s: SoundSettings) => ({ ambient: s.ambient, venueSound: s.venueSound, blockParty: !!s.blockParty, frontPorch: !!s.frontPorch, beautySalon: !!s.beautySalon, parkDominoes: !!s.parkDominoes, kitchenTable: !!s.kitchenTable });

describe('menu ambience is ONE AT A TIME (Demetrius, Sat)', () => {
  it('picking scene B switches scene A off in the store, immediately, and persists only the last pick', () => {
    reset();
    sound.set({ blockParty: true });
    expect(menuFlags(sound.settings)).toEqual({ ambient: false, venueSound: false, blockParty: true, frontPorch: false, beautySalon: false, parkDominoes: false, kitchenTable: false });
    sound.set({ frontPorch: true });
    expect(menuFlags(sound.settings)).toEqual({ ambient: false, venueSound: false, blockParty: false, frontPorch: true, beautySalon: false, parkDominoes: false, kitchenTable: false });
    sound.set({ beautySalon: true });
    expect(sound.settings.beautySalon).toBe(true);
    expect(sound.settings.frontPorch).toBe(false);
    sound.set({ parkDominoes: true });
    expect(menuFlags(persisted())).toEqual({ ambient: false, venueSound: false, blockParty: false, frontPorch: false, beautySalon: false, parkDominoes: true, kitchenTable: false });
    expect(persisted().menuAmbience).toBe('parkDominoes'); // the last choice is recorded, so reload keeps exactly one
  });
  it('Lounge/Venue count as one menu scene: picking Lounge/Venue switches a named scene off, and vice versa', () => {
    reset();
    sound.set({ parkDominoes: true });
    sound.set({ ambient: true }); // Lounge on
    expect(sound.settings.parkDominoes).toBe(false);
    expect(sound.settings.menuAmbience).toBe('loungeVenue');
    sound.set({ frontPorch: true }); // a named scene switches Lounge/Venue off
    expect(sound.settings.ambient).toBe(false);
    expect(sound.settings.venueSound).toBe(false);
    expect(sound.settings.frontPorch).toBe(true);
    sound.set({ venueSound: true }); // Venue on also takes the menu back
    expect(sound.settings.frontPorch).toBe(false);
    expect(sound.settings.menuAmbience).toBe('loungeVenue');
  });
  it('the engine gates only ever allow the single winner in menus, whatever the flags say', () => {
    const stacked = { ...sound.settings, music: false, blockParty: true, frontPorch: true, beautySalon: true, parkDominoes: true, menuAmbience: 'frontPorch' as const };
    expect(frontPorchWanted(stacked, 'menu')).toBe(true);
    expect(blockPartyWanted(stacked, 'menu')).toBe(false);
    expect(beautySalonWanted(stacked, 'menu')).toBe(false);
    expect(parkDominoesWanted(stacked, 'menu')).toBe(false);
  });
  it('reload keeps only the last picked: settingsForContext (the load path) restores that single scene', () => {
    reset();
    sound.set({ beautySalon: true });
    const reloaded = settingsForContext(persisted(), 'menu'); // exactly what load() computes at boot
    expect(menuFlags(reloaded)).toEqual({ ambient: false, venueSound: false, blockParty: false, frontPorch: false, beautySalon: true, parkDominoes: false, kitchenTable: false });
    expect(reloaded.menuAmbience).toBe('beautySalon');
    expect(beautySalonWanted(reloaded, 'menu')).toBe(true);
  });
  it('a legacy stacked save with no recency reconciles deterministically: the newest-shipped scene on wins', () => {
    const legacy: SoundSettings = { on: true, volume: 0.7, ambient: true, music: false, musicVolume: 0.5, venueSound: true, blockParty: true, frontPorch: true, parkDominoes: true };
    const out = exclusiveMenuAmbience(legacy);
    expect(menuAmbienceOf(out)).toBe('parkDominoes'); // Park shipped after Block Party/Front Porch, and Venue (default-on) never outranks a real pick
    expect(menuFlags(out)).toEqual({ ambient: false, venueSound: false, blockParty: false, frontPorch: false, beautySalon: false, parkDominoes: true, kitchenTable: false });
    expect(out.menuAmbience).toBe('parkDominoes'); // the reconciled winner is recorded for next time
    const loungeOnly = exclusiveMenuAmbience({ ...legacy, blockParty: false, frontPorch: false, parkDominoes: false });
    expect(menuAmbienceOf(loungeOnly)).toBe('loungeVenue'); // a stack of only Lounge/Venue stays Lounge/Venue, pair intact
    expect(loungeOnly.ambient).toBe(true); expect(loungeOnly.venueSound).toBe(true);
  });
  it('a legacy stacked save WITH a recorded last pick keeps that pick (recency beats priority)', () => {
    const legacy: SoundSettings = { on: true, volume: 0.7, ambient: false, music: false, musicVolume: 0.5, venueSound: false, blockParty: true, parkDominoes: true, menuAmbience: 'blockParty' };
    const out = exclusiveMenuAmbience(legacy);
    expect(menuAmbienceOf(out)).toBe('blockParty');
    expect(out.parkDominoes).toBe(false);
  });
  it('Kitchen-Table in-game still works, menu scenes stay dormant, and returning to menus restores the single menu choice', () => {
    reset();
    sound.set({ parkDominoes: true }); // the menu choice
    sound.enterContext('game');
    sound.set({ kitchenTable: true }); // picked at the table
    expect(kitchenTableWanted(sound.settings)).toBe(true);
    expect(parkDominoesWanted(sound.settings, 'game')).toBe(false);
    expect(sound.parkDominoesNow).toBe(false);
    expect(sound.settings.menuAmbience).toBe('parkDominoes'); // in-game picks never touch the menu choice
    sound.enterContext('menu');
    expect(sound.settings.parkDominoes).toBe(true);
    expect(parkDominoesWanted(sound.settings, 'menu')).toBe(true);
    expect(sound.settings.menuAmbience).toBe('parkDominoes'); // exactly one menu scene back on
  });
  it('music-vs-ambience (#202) still sits on top: music in menus clears every menu scene, context defaults unchanged', () => {
    reset();
    sound.set({ beautySalon: true });
    sound.set({ music: true });
    expect(menuFlags(sound.settings)).toEqual({ ambient: false, venueSound: false, blockParty: false, frontPorch: false, beautySalon: false, parkDominoes: false, kitchenTable: false });
    sound.enterContext('game');
    expect(sound.settings.music).toBe(true); // game default still music
    sound.enterContext('menu');
    expect(sound.settings.scenes?.menu).toBe('music'); // the explicit menu music choice is still respected
  });
});
