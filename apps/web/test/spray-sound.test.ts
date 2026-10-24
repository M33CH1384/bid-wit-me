/**
 * @vitest-environment happy-dom
 *
 * Spray-transition SOUND (owner, 2026-10-23: "add sound to it — not no
 * cheesy sounds, let's get authentic"). The engine owns the recordings
 * (real CC0 can foley on the SFX channel); spraySound.ts wires them to
 * the spray controller's phase events. Pins the contract:
 *  - a fresh cover starts the sound with the shake leading (hiss delayed
 *    by the shake's lead), and the hiss decays into the bloom on the
 *    controller's own SPRAY_SPADE_MS schedule — never hard-coded timings;
 *  - the reveal is silent (the cover-end stop is only a safety net);
 *  - a cancelled spray cuts the sound with the paint;
 *  - a snap-back re-cover restarts ONE hiss with no second shake and no
 *    stacking;
 *  - a suppressed spray (Reduce effects / OS reduce-motion) and a missing
 *    renderer both stay completely silent;
 *  - the credits name the recordings (both CC0) in-game and in CREDITS.md.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fxStub = vi.hoisted(() => ({ reduced: false, osReducedMotion: false }));
vi.mock('../src/fx', () => ({ fx: fxStub }));

const engine = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock('../src/audio', () => ({
  sound: { spraySoundStart: engine.start, spraySoundStop: engine.stop },
}));

import {
  SPRAY_COVER_MS,
  SPRAY_REVEAL_MS,
  SPRAY_SPADE_MS,
  cancelSpray,
  coverThen,
  registerSprayRenderer,
} from '../src/spray';
import {
  SPRAY_HISS_BLOOM_FADE_S,
  SPRAY_SHAKE_LEAD_MS,
  SPRAY_SOUND_CANCEL_FADE_S,
  SPRAY_SOUND_COVER_END_FADE_S,
  initSpraySound,
} from '../src/spraySound';

const here = dirname(fileURLToPath(import.meta.url));
const readSrc = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const readRoot = (p: string) => readFileSync(join(here, '../../..', p), 'utf8');

beforeAll(() => {
  initSpraySound();
});

beforeEach(() => {
  vi.useFakeTimers();
  fxStub.reduced = false;
  fxStub.osReducedMotion = false;
  engine.start.mockClear();
  engine.stop.mockClear();
  registerSprayRenderer(true);
});

afterEach(() => {
  cancelSpray();
  registerSprayRenderer(false);
  vi.useRealTimers();
});

describe('spray sound wiring', () => {
  it('a fresh cover leads with the shake, hisses under outline + fill, and decays into the bloom', () => {
    coverThen(vi.fn());
    // Shake leads: the hiss is delayed by exactly the shake's lead.
    expect(engine.start).toHaveBeenCalledTimes(1);
    expect(engine.start).toHaveBeenCalledWith(true, SPRAY_SHAKE_LEAD_MS / 1000);
    expect(engine.stop).not.toHaveBeenCalled();
    // Just before the bloom: still hissing.
    vi.advanceTimersByTime(SPRAY_SPADE_MS - 1);
    expect(engine.stop).not.toHaveBeenCalled();
    // The bloom begins: the hiss decays across its first stretch.
    vi.advanceTimersByTime(1);
    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(engine.stop).toHaveBeenCalledWith(SPRAY_HISS_BLOOM_FADE_S);
    // Full cover: only the safety stop remains, then a silent reveal.
    vi.advanceTimersByTime(SPRAY_COVER_MS - SPRAY_SPADE_MS);
    expect(engine.stop).toHaveBeenCalledTimes(2);
    expect(engine.stop).toHaveBeenLastCalledWith(SPRAY_SOUND_COVER_END_FADE_S);
    vi.advanceTimersByTime(SPRAY_REVEAL_MS + 500);
    expect(engine.start).toHaveBeenCalledTimes(1);
    expect(engine.stop).toHaveBeenCalledTimes(2);
  });

  it('a suppressed spray is silent: the sound belongs to the animation, not to navigation', () => {
    fxStub.reduced = true;
    const m = vi.fn();
    coverThen(m);
    expect(m).toHaveBeenCalledTimes(1); // instant cut, applied immediately
    vi.advanceTimersByTime(SPRAY_COVER_MS + SPRAY_REVEAL_MS + 500);
    expect(engine.start).not.toHaveBeenCalled();
    expect(engine.stop).not.toHaveBeenCalled();

    fxStub.reduced = false;
    fxStub.osReducedMotion = true;
    coverThen(vi.fn());
    vi.advanceTimersByTime(SPRAY_COVER_MS + SPRAY_REVEAL_MS + 500);
    expect(engine.start).not.toHaveBeenCalled();
  });

  it('no renderer mounted: coverThen stays synchronous and silent', () => {
    registerSprayRenderer(false);
    const m = vi.fn();
    coverThen(m);
    expect(m).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SPRAY_COVER_MS + 500);
    expect(engine.start).not.toHaveBeenCalled();
    expect(engine.stop).not.toHaveBeenCalled();
  });

  it('cancelling mid-cover cuts the sound with the paint (no orphaned hiss, no late decay)', () => {
    coverThen(vi.fn());
    expect(engine.start).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300); // mid-outline, hiss running
    cancelSpray();
    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(engine.stop).toHaveBeenCalledWith(SPRAY_SOUND_CANCEL_FADE_S);
    // The scheduled bloom decay must not fire after the cancel.
    vi.advanceTimersByTime(SPRAY_COVER_MS + SPRAY_REVEAL_MS + 500);
    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  it('a snap-back re-cover restarts one hiss with no second shake and no stacking', () => {
    coverThen(vi.fn());
    vi.advanceTimersByTime(SPRAY_COVER_MS); // cover completes -> reveal begins
    expect(engine.stop).toHaveBeenLastCalledWith(SPRAY_SOUND_COVER_END_FADE_S);
    vi.advanceTimersByTime(120); // paint partly dissolved
    engine.start.mockClear();
    engine.stop.mockClear();
    coverThen(vi.fn()); // second navigation snaps back to cover
    expect(engine.start).toHaveBeenCalledTimes(1);
    expect(engine.start).toHaveBeenCalledWith(false, 0); // hiss resumes, NO shake
    // The new cover's own bloom decay is scheduled from its own start.
    vi.advanceTimersByTime(SPRAY_SPADE_MS);
    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(engine.stop).toHaveBeenCalledWith(SPRAY_HISS_BLOOM_FADE_S);
    vi.advanceTimersByTime(SPRAY_COVER_MS - SPRAY_SPADE_MS + SPRAY_REVEAL_MS + 500);
    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  it('a second navigation DURING the cover joins it: still one shake, one hiss', () => {
    coverThen(vi.fn());
    vi.advanceTimersByTime(200);
    coverThen(vi.fn()); // joins the pending flush, no new episode
    expect(engine.start).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SPRAY_SPADE_MS - 200);
    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(engine.stop).toHaveBeenCalledWith(SPRAY_HISS_BLOOM_FADE_S);
  });
});

describe('recordings + credits pins', () => {
  it('the engine loads the two spray recordings through the SFX file registry', () => {
    const audio = readSrc('audio.ts');
    expect(audio).toContain("'spray-shake': ['spray-shake'], 'spray-hiss': ['spray-hiss']");
    expect(audio).toContain('spraySoundStart(');
    expect(audio).toContain('spraySoundStop(');
  });

  it('Root mounts the spray-sound wiring once', () => {
    const main = readSrc('main.tsx');
    expect(main).toContain("import { initSpraySound } from './spraySound';");
    expect(main).toContain('initSpraySound()');
  });

  it('both recordings are credited as CC0 in-game and in CREDITS.md', () => {
    const credits = readSrc('Credits.tsx');
    expect(credits).toContain('Beenjamone');
    expect(credits).toContain('https://freesound.org/people/Beenjamone/sounds/548623/');
    expect(credits).toContain('BorzSounds');
    expect(credits).toContain('https://freesound.org/people/BorzSounds/sounds/842753/');
    const doc = readRoot('CREDITS.md');
    expect(doc).toContain('spray-shake.mp3');
    expect(doc).toContain('spray-hiss.mp3');
    expect(doc).toContain('548623');
    expect(doc).toContain('842753');
  });
});
