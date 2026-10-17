import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** Source guards (node env): Front Porch is offered only in menus, built only from synth, never a venue bed, no real radio music. */
describe('Front Porch wiring', () => {
  const controls = readFileSync(new URL('../src/SoundControls.tsx', import.meta.url), 'utf8');
  const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
  const bed = audio.slice(audio.indexOf('private buildFrontPorch()'), audio.indexOf('/* ---------- venue ambience'));
  it('offered in the menu sound fields, and in the sound sheet only while in the menu context', () => {
    const switches = controls.split('data-testid="front-porch-switch"').length - 1;
    expect(switches).toBe(2); // menu fields + speaker sheet (sheet row is menu-gated)
    expect(controls).toContain("s.soundContext === 'menu'");
    expect(controls).toContain('stoop at dusk, menu / celebration screens only');
  });
  it('is not a venue/soundscape bed (so a room change in-game can never start it)', () => {
    expect(audio).not.toContain("'frontporch'");
    expect(audio).toContain('private buildFrontPorch()');
    expect(audio).toContain("ctx === 'menu'");
  });
  it('the bed is loopable synthesis: looped noise sources + recurring timers, no audio assets', () => {
    expect(audio).toContain('src.loop = true');
    expect(audio).toContain('private buildFrontPorch()');
    expect(audio).not.toMatch(/frontPorch[^;]*\.(mp3|wav|ogg)/);
  });
  it('spec elements are present: cicadas, iced tea, screen door, passing neighbour roast, window radio', () => {
    expect(bed).toContain('5600'); // cicada shimmer band
    expect(bed).toContain('every(1.4, 2.8'); // cicada chirp pulses
    expect(bed).toContain('every(6, 11'); // iced tea tinks
    expect(bed).toContain('every(21, 34'); // neighbour passes and gets roasted
    expect(bed).toContain('every(19, 31'); // screen door creak/slam/latch
    expect(bed).toContain('every(17, 29'); // radio tuning drift
  });
  it('the radio is between-stations warmth, never a track, and voices stay wordless babble', () => {
    expect(bed).toContain('between-stations');
    expect(bed).not.toContain('TRACKS');
    expect(bed).not.toContain('speak');
    expect(bed).not.toContain('voices/');
  });
});
