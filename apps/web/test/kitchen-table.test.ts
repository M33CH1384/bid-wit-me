// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { blockPartyWanted, kitchenLevel, kitchenTableWanted, sound, type SoundSettings } from '../src/audio';

const persisted = (): SoundSettings => JSON.parse(localStorage.getItem('bwm.sound.v1')!);
const reset = () => { sound.set({ scenes: undefined, blockParty: false, kitchenTable: false }); sound.enterContext('menu'); };

describe('Kitchen-Table Spades Night ambience (menus + in-game)', () => {
  it('is selectable in menus: on records the menu ambience choice and persists', () => {
    reset();
    sound.set({ kitchenTable: true });
    expect(sound.settings.kitchenTable).toBe(true);
    expect(sound.settings.scenes?.menu).toBe('ambience');
    expect(persisted().kitchenTable).toBe(true);
  });
  it('is selectable IN GAME too (not menu-only): choosing it at the table records the game choice', () => {
    reset();
    sound.enterContext('game');
    sound.set({ kitchenTable: true });
    expect(sound.settings.kitchenTable).toBe(true);
    expect(sound.settings.music).toBe(false);
    expect(sound.settings.scenes?.game).toBe('ambience');
    expect(kitchenTableWanted(sound.settings)).toBe(true);
    expect(persisted().scenes?.game).toBe('ambience');
  });
  it('is mutually exclusive with music in both contexts, both directions', () => {
    reset();
    sound.set({ kitchenTable: true });
    expect(sound.settings.music).toBe(false);
    sound.set({ music: true }); // user music-on in menu kills it
    expect(sound.settings.kitchenTable).toBe(false);
    sound.enterContext('game');
    sound.set({ kitchenTable: true });
    sound.set({ music: true }); // user music-on in game kills it
    expect(sound.settings.kitchenTable).toBe(false);
    expect(persisted().kitchenTable).toBe(false);
  });
  it('context defaults do NOT erase the stored choice: menu pick survives a game and returns', () => {
    reset();
    sound.set({ kitchenTable: true }); // menu choice
    sound.enterContext('game'); // game default music applies, kitchen choice stays stored
    expect(sound.settings.music).toBe(true);
    expect(sound.settings.kitchenTable).toBe(true);
    expect(kitchenTableWanted(sound.settings)).toBe(false); // silent while music plays
    sound.enterContext('menu');
    expect(kitchenTableWanted(sound.settings)).toBe(true); // back on in menus
  });
  it('unlike Block Party it is wanted in-game as well as in menus', () => {
    const s = { ...sound.settings, kitchenTable: true, blockParty: true, music: false };
    expect(kitchenTableWanted(s)).toBe(true);
    expect(blockPartyWanted(s, 'game')).toBe(false);
    expect(blockPartyWanted(s, 'menu')).toBe(true);
  });
  it('level restraint: quieter in-game than in menus, always under the music-scale', () => {
    expect(kitchenLevel(1, 'game')).toBeCloseTo(0.3);
    expect(kitchenLevel(1, 'menu')).toBeCloseTo(0.5);
    expect(kitchenLevel(1, 'game')).toBeLessThan(kitchenLevel(1, 'menu'));
    expect(kitchenLevel(0.5, 'game')).toBeCloseTo(0.15); // ambience slider still controls it
    expect(kitchenLevel(2, 'game')).toBeCloseTo(0.3); // clamped
  });
});
