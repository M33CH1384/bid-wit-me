import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** Source guards (node env): Park Dominoes is offered only in menus, built only from synth, never a venue bed, no real music. Fish Fry stays held. */
describe('Park Dominoes wiring', () => {
  const controls = readFileSync(new URL('../src/SoundControls.tsx', import.meta.url), 'utf8');
  const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
  const bed = audio.slice(audio.indexOf('private buildParkDominoes()'), audio.indexOf('/* ---------- venue ambience'));
  it('offered in the menu sound fields, and in the sound sheet only while in the menu context', () => {
    const switches = controls.split('data-testid="park-dominoes-switch"').length - 1;
    expect(switches).toBe(2); // menu fields + speaker sheet (sheet row is menu-gated)
    expect(controls).toContain("s.soundContext === 'menu'");
    expect(controls).toContain('bones slamming at the park, menu / celebration screens only');
  });
  it('is not a venue/soundscape bed (so a room change in-game can never start it)', () => {
    expect(audio).not.toContain("'parkdominoes'");
    expect(audio).toContain('private buildParkDominoes()');
    expect(audio).toContain("ctx === 'menu'");
  });
  it('the bed is loopable synthesis: looped noise sources + recurring timers, no audio assets', () => {
    expect(audio).toContain('src.loop = true');
    expect(audio).toContain('private buildParkDominoes()');
    expect(audio).not.toMatch(/parkDominoes[^;]*\.(mp3|wav|ogg)/);
  });
  it('spec elements are present: concrete bone slams, shuffle, folding chairs, asphalt ball, birds, far traffic, cooler/ice, two-age crowd', () => {
    expect(bed).toContain('every(2.4, 4.8'); // THE SLAM
    expect(bed).toContain('every(8, 15'); // bones shuffling in the wash
    expect(bed).toContain('every(6, 12'); // birds
    expect(bed).toContain('every(16, 28'); // a car far off
    expect(bed).toContain('every(9, 17'); // cooler / ice
    expect(bed).toContain('every(5.5, 9.5'); // old-heads trash talk, younger crowd reacting
    expect(bed).toContain('every(12, 20'); // folding chairs on concrete
    expect(bed).toContain('every(14, 24'); // a ball bouncing on asphalt nearby
    expect(bed).toContain('CONCRETE');
  });
  it('talk stays wordless babble, there is no real music, and Fish Fry is NOT built (held for Story Mode)', () => {
    expect(bed).not.toContain('TRACKS');
    expect(bed).not.toContain('speak');
    expect(bed).not.toContain('voices/');
    expect(controls + audio).not.toContain('Fish Fry');
  });
});
