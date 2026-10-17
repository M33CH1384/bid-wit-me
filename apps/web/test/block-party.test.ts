// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { blockPartyLevel, blockPartyWanted, sound, type SoundSettings } from '../src/audio';

const persisted = (): SoundSettings => JSON.parse(localStorage.getItem('bwm.sound.v1')!);
const reset = () => { sound.set({ scenes: undefined, blockParty: false }); sound.enterContext('menu'); };

describe('Block Party ambience (menu/celebration only)', () => {
  it('is selectable in menus: turning it on records the menu ambience choice and persists', () => {
    reset();
    sound.set({ blockParty: true });
    expect(sound.settings.blockParty).toBe(true);
    expect(sound.settings.scenes?.menu).toBe('ambience');
    expect(persisted().blockParty).toBe(true);
  });
  it('is mutually exclusive with music in menus, both directions', () => {
    reset();
    sound.set({ blockParty: true });
    expect(sound.settings.music).toBe(false); // party on -> music off
    sound.set({ music: true });
    expect(sound.settings.blockParty).toBe(false); // music on -> party off
    expect(sound.settings.music).toBe(true);
    sound.set({ blockParty: true });
    expect(sound.settings.music).toBe(false);
    expect(persisted().music).toBe(false);
  });
  it('can never be active in-game: the gate is menu-only, and entering a game leaves it dormant and silent', () => {
    reset();
    sound.set({ blockParty: true });
    expect(blockPartyWanted(sound.settings, 'menu')).toBe(true);
    expect(blockPartyWanted(sound.settings, 'game')).toBe(false);
    sound.enterContext('game'); // game default: music
    expect(sound.settings.music).toBe(true);
    expect(blockPartyWanted(sound.settings, 'game')).toBe(false);
    expect(sound.blockPartyNow).toBe(false);
    sound.enterContext('menu'); // back in menus it is the ambience again
    expect(sound.settings.music).toBe(false);
    expect(blockPartyWanted(sound.settings, 'menu')).toBe(true);
  });
  it('a dormant Block Party flag does not leak into the in-game explicit choice', () => {
    reset();
    sound.set({ blockParty: true }); // menu choice
    sound.enterContext('game');
    sound.set({ music: false }); // player turns everything off at the table
    expect(sound.settings.scenes?.game).toBe('none');
    sound.enterContext('menu');
    expect(sound.settings.scenes?.menu).toBe('ambience'); // menu choice untouched
  });
  it('volume rides the existing ambience volume, and the bed loops', () => {
    expect(blockPartyLevel(0)).toBe(0);
    expect(blockPartyLevel(0.8)).toBeCloseTo(0.4);
    expect(blockPartyLevel(1)).toBe(0.5);
    expect(blockPartyLevel(2)).toBe(0.5); // clamped
    expect(blockPartyLevel(0.25)).toBeLessThan(blockPartyLevel(0.75)); // slider actually moves it
  });
});
