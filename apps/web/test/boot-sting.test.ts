/**
 * App-open sting (owner, 2026-11-04): "When the app opens I want to hear the
 * sound of cards shuffling together and being slammed (whole deck) down to a
 * table" — and its choreography: "Make the sound go off and the ui fade in
 * slowly until the sound happens then snaps in when the app loads."
 * Pins:
 *  - a REAL recorded sting (freesound CC0: a Breviceps riffle played twice +
 *    khiser83's card slap) is a registered one-shot in the event-SFX family
 *    (FILES registry -> SFX_COUNT derives, staged like thunder) and is
 *    credited in CREDITS.md;
 *  - it may sound away from a table (UI_SFX — it plays on the home screen)
 *    but is only ever CALLED by the boot latch: the first unlock whose
 *    context actually lands running, once per page load. The latch spends
 *    exactly once, so no later gesture, resume or route change can refire it;
 *  - the audibility gate is pure and total: master off, zero master volume
 *    or a zeroed SFX category all mean the sting stays silent — and because
 *    the reveal event is dispatched only from the fire path, a silent sting
 *    means NO slow fade either (the UI just appears, full strength);
 *  - the reveal consumes the slam offset from the event payload: the fade
 *    plan's duration IS the offset it was handed (derivation, not a tuned
 *    constant), the wind-up ends below full opacity so the snap to the
 *    resting 1 is structural, and reduced motion snaps outright.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { bootStingAudible } from '../src/audioSession';
import { bootFadePlan, bootRevealKeyframes } from '../src/bootReveal';

const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
const setup = readFileSync(new URL('../src/Setup.tsx', import.meta.url), 'utf8');
const reveal = readFileSync(new URL('../src/bootReveal.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('app-open sting: the sound', () => {
  it('is a registered recorded one-shot in the event-SFX family', () => {
    expect(audio).toContain("'deckSlam'");
    expect(audio).toContain("deckSlam: ['deck-slam']"); // FILES registry -> SFX_COUNT derives
    expect(audio).toContain("case 'deckSlam': return this.sample('deckSlam', t, 0.95 * g)");
    expect(existsSync(new URL('../public/assets/sfx/deck-slam.mp3', import.meta.url))).toBe(true);
    const credits = readFileSync(new URL('../../../CREDITS.md', import.meta.url), 'utf8');
    expect(credits).toContain('deck-slam.mp3');
    expect(credits).toContain('Breviceps');
    expect(credits).toContain('khiser83');
  });

  it('may sound away from a table (UI_SFX) — it plays on the home screen', () => {
    expect(audio).toContain("'dmChime', 'chatBlip', 'deckSlam'");
  });
});

describe('app-open sting: the moment', () => {
  it('the slam offset is the one measured on the shipped file', () => {
    expect(audio).toContain('export const BOOT_SLAM_MS = 1219;');
  });

  it('fires once per page load, from the wake path, under its latch', () => {
    expect(audio).toContain('private bootStingFired = false;');
    expect(audio).toContain('this.maybeBootSting()'); // called from wake()
    expect(audio).toContain('private maybeBootSting()');
  });

  it('the reveal event carries the slam offset and both sides name the same event', () => {
    expect(audio).toContain('new CustomEvent(BOOT_STING_EVENT, { detail: { slamMs: BOOT_SLAM_MS } })');
    expect(audio).toContain("'bwm:bootsting'");
    expect(reveal).toContain("'bwm:bootsting'");
  });

  it('the audibility gate: master off, zero volume or a zeroed sfx category all mean silence', () => {
    expect(bootStingAudible(true, 0.7, 1)).toBe(true);
    expect(bootStingAudible(true, 0.7, 0.5)).toBe(true);
    expect(bootStingAudible(false, 0.7, 1)).toBe(false);
    expect(bootStingAudible(true, 0, 1)).toBe(false);
    expect(bootStingAudible(true, 0.7, 0)).toBe(false);
  });
});

describe('app-open reveal: the choreography', () => {
  it('the fade lasts exactly until the slam — its duration is the offset it was handed', () => {
    expect(bootFadePlan(1219, false)).toEqual({ kind: 'fade', durationMs: 1219 });
    expect(bootFadePlan(800, false)).toEqual({ kind: 'fade', durationMs: 800 }); // derivation, not a constant
    expect(bootFadePlan(2000, false)).toEqual({ kind: 'fade', durationMs: 2000 });
  });

  it('reduced motion snaps: no fade at any offset', () => {
    expect(bootFadePlan(1219, true)).toEqual({ kind: 'snap', durationMs: 0 });
  });

  it('the wind-up stays dim and never reaches full strength — the snap is the arrival', () => {
    const kf = bootRevealKeyframes();
    expect(kf[0]).toMatchObject({ opacity: 0.14, offset: 0 });
    expect(kf[kf.length - 1]).toMatchObject({ opacity: 0.88, offset: 1 });
    for (const f of kf) expect(f.opacity as number).toBeLessThan(1);
  });

  it('the reveal module holds no fade duration of its own', () => {
    expect(reveal).not.toContain('1219');
    expect(reveal).not.toMatch(/durationMs:\s*[1-9]/); // durations only ever arrive via the plan/event
  });

  it('the home surface carries the reveal, presentational while it runs', () => {
    expect(setup).toContain('useBootReveal');
    expect(reveal).toContain('data-boot-reveal');
    expect(styles).toContain('[data-boot-reveal]');
    expect(styles).toContain('pointer-events: none');
  });
});
