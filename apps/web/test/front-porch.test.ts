// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { frontPorchLevel, frontPorchWanted, sound, type SoundSettings } from '../src/audio';

const persisted = (): SoundSettings => JSON.parse(localStorage.getItem('bwm.sound.v1')!);
const reset = () => { sound.set({ scenes: undefined, blockParty: false, kitchenTable: false, frontPorch: false }); sound.enterContext('menu'); };

describe('Front Porch / Stoop at Dusk ambience (menu/celebration only, the calm contrast)', () => {
  it('is selectable in menus: turning it on records the menu ambience choice and persists', () => {
    reset();
    sound.set({ frontPorch: true });
    expect(sound.settings.frontPorch).toBe(true);
    expect(sound.settings.scenes?.menu).toBe('ambience');
    expect(persisted().frontPorch).toBe(true);
  });
  it('is mutually exclusive with music in menus, both directions', () => {
    reset();
    sound.set({ frontPorch: true });
    expect(sound.settings.music).toBe(false); // porch on -> music off
    sound.set({ music: true });
    expect(sound.settings.frontPorch).toBe(false); // music on -> porch off
    expect(sound.settings.music).toBe(true);
    sound.set({ frontPorch: true });
    expect(sound.settings.music).toBe(false);
    expect(persisted().music).toBe(false);
  });
  it('can never be active in-game: the gate is menu-only, entering a game leaves it dormant and silent, Kitchen-Table stays the in-game choice', () => {
    reset();
    sound.set({ frontPorch: true });
    expect(frontPorchWanted(sound.settings, 'menu')).toBe(true);
    expect(frontPorchWanted(sound.settings, 'game')).toBe(false);
    sound.enterContext('game'); // game default: music
    expect(sound.settings.music).toBe(true);
    expect(sound.settings.frontPorch).toBe(true); // stored, dormant
    expect(frontPorchWanted(sound.settings, 'game')).toBe(false);
    expect(sound.frontPorchNow).toBe(false);
    sound.enterContext('menu'); // back in menus it is the ambience again
    expect(sound.settings.music).toBe(false);
    expect(frontPorchWanted(sound.settings, 'menu')).toBe(true);
  });
  it('a dormant Front Porch flag does not leak into the in-game explicit choice', () => {
    reset();
    sound.set({ frontPorch: true }); // menu choice
    sound.enterContext('game');
    sound.set({ music: false }); // player turns everything off at the table
    expect(sound.settings.scenes?.game).toBe('none');
    sound.enterContext('menu');
    expect(sound.settings.scenes?.menu).toBe('ambience'); // menu choice untouched
  });
  it('volume rides the existing ambience volume (calmer than Block Party), and the level is clamped', () => {
    expect(frontPorchLevel(0)).toBe(0);
    expect(frontPorchLevel(0.8)).toBeCloseTo(0.36);
    expect(frontPorchLevel(1)).toBeCloseTo(0.45);
    expect(frontPorchLevel(1)).toBeLessThan(0.5); // under Block Party's factor: the calm contrast
    expect(frontPorchLevel(2)).toBeCloseTo(0.45); // clamped
    expect(frontPorchLevel(0.25)).toBeLessThan(frontPorchLevel(0.75)); // slider actually moves it
  });
});
