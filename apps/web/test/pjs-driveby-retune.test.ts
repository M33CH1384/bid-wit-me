/**
 * The Pj's drive-by — retune B (owner decision, 2026-11-02: "follow your
 * recommendation" on the 2026-10-29 audio audit). The event stays a Pj's-only
 * street-bed event, but rare, far away, and wail-only:
 *   cadence  every 3–7 min → every 10–20 min
 *   gunfire  4-variant rotation placed 8–20 m → the distant-pop variant only,
 *            its gains halved, placed 20–34 m out (blocks away, not at the table)
 *   siren    3-variant rotation (recorded wail + synth yelp + synth hi-lo) at
 *            gains 0.9/0.4 → recorded Whelen wail only, both passes at 0.4
 *   flash    the edge wash stays, its peak alphas cut ~⅔ in styles.css
 * These are source pins: the staging numbers ARE the owner's decision, so a
 * future "liven the Pj's back up" change must revise them deliberately.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (rel: string) => readFileSync(join(process.cwd(), 'apps/web/src', rel), 'utf8');
const audio = src('audio.ts');
const driveby = audio.slice(
  audio.indexOf("streetEvents.includes('driveby')"),
  audio.indexOf("streetEvents.includes('headlights')"),
);

describe("the Pj's drive-by — retune B (owner, 2026-11-02)", () => {
  it('cadence: every 10–20 minutes, no longer every 3–7', () => {
    expect(driveby).toContain('vEvery(600, 1200,');
    expect(audio).not.toContain('vEvery(180, 420,');
  });

  it('siren: the recorded Whelen wail only — the synth rotation is gone', () => {
    expect(driveby).toContain('const sv = 0;');
    expect(driveby).toContain('drivebySirenVariant(sirenT, sv, sirenPan, B, 0.4)');
    expect(driveby).toContain('drivebySirenVariant(sirenT + 3.1, sv, sirenPan, B, 0.4)');
    expect(audio).not.toContain('lastSirenVariant');
    expect(audio).not.toContain('pickVariant(3, this');
    // both wails at the receding-pass level — the old 0.9 near pass is retired
    expect(driveby).not.toContain(', 0.9)');
  });

  it('gunfire: the distant-pop variant only, from blocks away', () => {
    expect(driveby).toContain('const gv = 1;');
    expect(audio).not.toContain('lastGunfireVariant');
    expect(audio).not.toContain('pickVariant(4, this');
    expect(driveby).toContain('20 + Math.random() * 14'); // 20–34 m (was 8–20 m)
    expect(driveby).not.toContain('8 + Math.random() * 12');
  });

  it('distant-pop gains are halved; the retired variants keep their authored gains', () => {
    const gun = audio.slice(audio.indexOf('private drivebyGunshot'), audio.indexOf('private drivebySirenVariant'));
    const distant = gun.slice(gun.indexOf('case 1:'), gun.indexOf('case 2:'));
    expect(distant).toContain("'lowpass', 900, 0.15");
    expect(distant).toContain("'sine', 0.15, { glideTo: 45");
    const close = gun.slice(gun.indexOf('case 0:'), gun.indexOf('case 1:'));
    expect(close).toContain("'highpass', 1800, 0.5"); // untouched — out of rotation, not re-staged
  });

  it('flash: still dispatched, softened to a distant spill in the keyframes', () => {
    expect(driveby).toContain("window.dispatchEvent(new CustomEvent('pj-driveby'))");
    const css = src('styles.css');
    const kf = css.slice(css.indexOf('@keyframes driveby-flash'), css.indexOf('@keyframes driveby-flash') + 500);
    expect(kf).toContain('rgba(255, 30, 30, 0.08)');
    expect(kf).not.toContain('0.22');
    expect(kf).not.toContain('0.20');
  });
});
