// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parkDominoesLevel, parkDominoesWanted, sound, type SoundSettings } from '../src/audio';

const persisted = (): SoundSettings => JSON.parse(localStorage.getItem('bwm.sound.v1')!);
const reset = () => { sound.set({ scenes: undefined, blockParty: false, kitchenTable: false, frontPorch: false, beautySalon: false, parkDominoes: false }); sound.enterContext('menu'); };

describe('Park Dominoes ambience (menu/celebration only, the outdoor table)', () => {
  it('is selectable in menus: turning it on records the menu ambience choice and persists', () => {
    reset();
    sound.set({ parkDominoes: true });
    expect(sound.settings.parkDominoes).toBe(true);
    expect(sound.settings.scenes?.menu).toBe('ambience');
    expect(persisted().parkDominoes).toBe(true);
  });
  it('is mutually exclusive with music in menus, both directions', () => {
    reset();
    sound.set({ parkDominoes: true });
    expect(sound.settings.music).toBe(false); // park on -> music off
    sound.set({ music: true });
    expect(sound.settings.parkDominoes).toBe(false); // music on -> park off
    expect(sound.settings.music).toBe(true);
    sound.set({ parkDominoes: true });
    expect(sound.settings.music).toBe(false);
    expect(persisted().music).toBe(false);
  });
  it('can never be active in-game: the gate is menu-only, entering a game leaves it dormant and silent, Kitchen-Table stays the in-game choice', () => {
    reset();
    sound.set({ parkDominoes: true });
    expect(parkDominoesWanted(sound.settings, 'menu')).toBe(true);
    expect(parkDominoesWanted(sound.settings, 'game')).toBe(false);
    sound.enterContext('game'); // game default: music
    expect(sound.settings.music).toBe(true);
    expect(sound.settings.parkDominoes).toBe(true); // stored, dormant
    expect(parkDominoesWanted(sound.settings, 'game')).toBe(false);
    expect(sound.parkDominoesNow).toBe(false);
    sound.enterContext('menu'); // back in menus it is the ambience again
    expect(sound.settings.music).toBe(false);
    expect(parkDominoesWanted(sound.settings, 'menu')).toBe(true);
  });
  it('a dormant Park Dominoes flag does not leak into the in-game explicit choice', () => {
    reset();
    sound.set({ parkDominoes: true }); // menu choice
    sound.enterContext('game');
    sound.set({ music: false }); // player turns everything off at the table
    expect(sound.settings.scenes?.game).toBe('none');
    sound.enterContext('menu');
    expect(sound.settings.scenes?.menu).toBe('ambience'); // menu choice untouched
  });
  it('volume rides the existing ambience volume at the lively factor, and the level is clamped', () => {
    expect(parkDominoesLevel(0)).toBe(0);
    expect(parkDominoesLevel(0.8)).toBeCloseTo(0.4);
    expect(parkDominoesLevel(1)).toBeCloseTo(0.5);
    expect(parkDominoesLevel(2)).toBeCloseTo(0.5); // clamped
    expect(parkDominoesLevel(0.25)).toBeLessThan(parkDominoesLevel(0.75)); // slider actually moves it
  });
});
