/**
 * Screen-crack cue — registry + sync-constant pins (node environment;
 * the behavioral layer pins live in animfx-crack-sound.test.ts and the
 * engine pins in audio-glass-crack.test.ts).
 *
 * Sync derivation, from the animation's own constants: in animfx.css the
 * crack's MAIN vein (`.animfx-crack polyline`, nth-of-type 1) draws with
 * NO animation-delay, so the fracture's onset is the shot's mount
 * instant (t=0) — there is no future impact frame to schedule toward.
 * The branch veins follow at +70ms/+130ms and the draw completes at
 * 500ms, which is the shape the recorded cue was built to (attack at
 * 1.8ms into the file, crystalline settle out to ~0.8s). These pins
 * hold the CSS side of that derivation: if anyone ever delays the main
 * vein, the cue's zero-offset contract must be revisited with it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/animfx/animfx.css', import.meta.url), 'utf8');
const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
const layer = readFileSync(new URL('../src/animfx/AnimFxLayer.tsx', import.meta.url), 'utf8');
const credits = readFileSync(new URL('../../../CREDITS.md', import.meta.url), 'utf8');

describe('the visual onset the cue is synced to (the animation constants)', () => {
  it('the main vein draws with NO delay — fracture onset is the mount instant', () => {
    const base = /\.animfx-crack \.crack-svg polyline,[^{]*\{([^}]*)\}/.exec(css);
    expect(base).not.toBeNull();
    expect(base![1]).toContain('animfx-crackdraw');
    expect(base![1]).not.toContain('animation-delay');
    // the spread follows in branches: +70ms, then +130ms — the settle's shape
    expect(css).toContain('.crack-svg polyline:nth-of-type(2), .crack-svg polyline:nth-of-type(3) { animation-delay: .07s; }');
    expect(css).toContain('.crack-svg polyline:nth-of-type(4), .crack-svg polyline:nth-of-type(5), .crack-svg polyline:nth-of-type(6) { animation-delay: .13s; }');
  });
});

describe('the cue registry (family pattern)', () => {
  it('glassCrack is an Sfx, a FILES sample, and a play() case staged like fireOut', () => {
    expect(audio).toContain("| 'glassCrack'");
    expect(audio).toContain("glassCrack: ['glass-crack']"); // FILES registry → SFX_COUNT derives
    expect(audio).toContain("case 'glassCrack': return this.sample('glassCrack', t, 0.85 * g");
    expect(audio).toContain('glassCrack: 700'); // DUCK_MS, the strike family
  });

  it('the layer calls the cue at the crack sites', () => {
    // elimination branch + both nil-bust branches (slot and plate fallback)
    expect(layer.match(/sound\.play\('glassCrack'\)/g)).toHaveLength(3);
  });

  it('the recorded sample is credited', () => {
    expect(credits).toContain('glass-crack.mp3');
  });

  it('the recorded sample ships in the sfx folder', () => {
    const mp3 = readFileSync(new URL('../public/assets/sfx/glass-crack.mp3', import.meta.url));
    expect(mp3.length).toBeGreaterThan(1000);
    expect(mp3.subarray(0, 3).toString('latin1')).toBe('ID3');
  });
});
