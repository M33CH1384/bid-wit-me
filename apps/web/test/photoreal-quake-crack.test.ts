/**
 * Big Joker crack cue — the photoreal quake's fracture sound (node
 * environment; the engine pins for the cue itself live in
 * audio-glass-crack.test.ts, the plate-crack pins in
 * glass-crack-registry.test.ts — together they are the crack map).
 *
 * The Big Joker's screen crack is NOT the animfx plate crack: it is the
 * photoreal `quake` overlay (photorealFor: jokerBig → 'quake'), whose
 * module (quake.js, generated — never edited here) grows five fractal
 * cracks from the table centre. Each crack's first point carries module
 * time t0 = .45 + rr()*.25 and points reveal as presented time passes
 * them, so the fracture opens across .45–.70s of module time. The host
 * fires the recorded glassCrack once as presented T crosses
 * QUAKE_CRACK_T — inside that window on every seed, and on the
 * presented clock so a stalled frame stretches sight and sound
 * together. If quake.js is ever regenerated with a different t0, the
 * derivation pin below fails and QUAKE_CRACK_T must be re-derived.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const host = readFileSync(new URL('../src/photoreal/host.ts', import.meta.url), 'utf8');
const quake = readFileSync(new URL('../src/photoreal/modules/quake.js', import.meta.url), 'utf8');
const layer = readFileSync(new URL('../src/animfx/AnimFxLayer.tsx', import.meta.url), 'utf8');
const fx = readFileSync(new URL('../src/fx.ts', import.meta.url), 'utf8');
const deuceFx = readFileSync(new URL('../src/deuceFx.ts', import.meta.url), 'utf8');
const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');

describe('the quake crack onset the cue is synced to (the module constants)', () => {
  it('quake.js grows its cracks from t0 = .45 + rr()*.25 (onset window .45–.70s)', () => {
    expect(quake).toContain('.45+rr()*.25');
  });

  it('QUAKE_CRACK_T sits inside the onset window', () => {
    const m = /export const QUAKE_CRACK_T = ([0-9.]+)/.exec(host);
    expect(m).not.toBeNull();
    const t = Number(m![1]);
    expect(t).toBeGreaterThanOrEqual(0.45);
    expect(t).toBeLessThanOrEqual(0.7);
  });
});

describe('the host binding (the fix)', () => {
  it('the host plays the recorded glassCrack cue', () => {
    expect(host).toContain("sound.play('glassCrack'");
    expect(host).toMatch(/import \{ sound \} from '\.\.\/audio'/);
  });

  it('fires once per quake run, on presented time, live runs only', () => {
    expect(host).toContain("name === 'quake'");
    expect(host).toContain('T >= QUAKE_CRACK_T');
    expect(host).toContain('opts.at === undefined'); // pinned QA captures stay silent
    expect(host).toMatch(/!cracked/);
    expect(host).toMatch(/cracked = true/);
  });
});

describe('the crack map stays complete — every fracture visual has its cue', () => {
  it('the cue itself is registered (FILES sample)', () => {
    expect(audio).toContain("glassCrack: ['glass-crack']");
  });

  it('animfx plate crack: elimination + both nil-bust branches call the cue', () => {
    expect(layer.match(/sound\.play\('glassCrack'\)/g)).toHaveLength(3);
  });

  it('the lightning sky-crack keeps its thunder (fx-scheduled for the stroke)', () => {
    expect(fx).toContain("sound.play('thunder'");
  });

  it('the Deuce Duel crack of light keeps its deuceDuel cue (deuceLandCue)', () => {
    expect(deuceFx).toContain("cue += ',deuceDuel'");
  });
});
