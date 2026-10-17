import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** Source guards (node env): offered in both contexts, synth-only bed, voices kept wordless. */
describe('Kitchen-Table wiring', () => {
  const controls = readFileSync(new URL('../src/SoundControls.tsx', import.meta.url), 'utf8');
  const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
  it('offered in the menu sound fields AND in the sound sheet without a menu-only gate', () => {
    const switches = controls.split('data-testid="kitchen-table-switch"').length - 1;
    expect(switches).toBe(2); // menu fields + speaker sheet
    const sheetRow = controls.slice(controls.indexOf('Kitchen-Table Spades Night<small'));
    expect(sheetRow).not.toContain("soundContext === 'menu' &&"); // the kitchen row itself is not menu-gated
  });
  it('bed is synthesized and loopable, with conservative event gains (voices low and sparse)', () => {
    expect(audio).toContain('private buildKitchenTable()');
    expect(audio).toContain('kitchenLevel');
    expect(audio).not.toMatch(/kitchenTable[^;]*\.(mp3|wav|ogg)/);
    const bed = audio.slice(audio.indexOf('private buildKitchenTable()'), audio.indexOf('/* ---------- venue ambience'));
    expect(bed).toContain("every(7, 13"); // sparse talk
    expect(bed).toContain("every(24, 38"); // rare mama-from-the-stove
  });
  it('no actual trash-talk words or voice clips in the bed (wordless babble by design)', () => {
    const bed = audio.slice(audio.indexOf('private buildKitchenTable()'), audio.indexOf('/* ---------- venue ambience'));
    expect(bed).not.toContain('speak');
    expect(bed).not.toContain('voices/');
  });
});
