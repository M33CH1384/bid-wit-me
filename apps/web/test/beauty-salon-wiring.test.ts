import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** Source guards (node env): Beauty Salon is offered only in menus, built only from synth, never a venue bed, no real music. */
describe('Beauty Salon wiring', () => {
  const controls = readFileSync(new URL('../src/SoundControls.tsx', import.meta.url), 'utf8');
  const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
  const bed = audio.slice(audio.indexOf('private buildBeautySalon()'), audio.indexOf('/* ---------- venue ambience'));
  it('offered in the menu sound fields, and in the sound sheet only while in the menu context', () => {
    const switches = controls.split('data-testid="beauty-salon-switch"').length - 1;
    expect(switches).toBe(2); // menu fields + speaker sheet (sheet row is menu-gated)
    expect(controls).toContain("s.soundContext === 'menu'");
    expect(controls).toContain('lively shop chatter, menu / celebration screens only');
  });
  it('is not a venue/soundscape bed (so a room change in-game can never start it)', () => {
    expect(audio).not.toContain("'beautysalon'");
    expect(audio).toContain('private buildBeautySalon()');
    expect(audio).toContain("ctx === 'menu'");
  });
  it('the bed is loopable synthesis: looped noise sources + recurring timers, no audio assets', () => {
    expect(audio).toContain('src.loop = true');
    expect(audio).toContain('private buildBeautySalon()');
    expect(audio).not.toMatch(/beautySalon[^;]*\.(mp3|wav|ogg)/);
  });
  it('spec elements are present: dryers, scissors/clippers, spray, swivel chairs, chatter/laughs, door chime', () => {
    expect(bed).toContain('every(13, 21'); // dryer kicks up
    expect(bed).toContain('every(1.8, 3.6'); // scissors double-snips
    expect(bed).toContain('every(9, 16'); // clippers buzz
    expect(bed).toContain('every(7, 13'); // spray bottles
    expect(bed).toContain('every(11, 19'); // chairs swivelling
    expect(bed).toContain('every(4.5, 8'); // lively stylist-client chatter
    expect(bed).toContain('every(23, 36'); // door chime
  });
  it('chatter stays wordless babble and there is no real music in the bed', () => {
    expect(bed).not.toContain('TRACKS');
    expect(bed).not.toContain('speak');
    expect(bed).not.toContain('voices/');
  });
});
