/**
 * Lightning strike (owner, 2026-11-04): "the lightning strike has no noise
 * and its animation is a tad bit too slow."
 * Pins:
 *  - the photoreal lightning module runs on a 0.8x clock: its 3.6 s timeline
 *    is presented in 2.88 s, so the return stroke lands at 0.44 s instead
 *    of 0.55 s (phases keep their proportions — a uniform warp);
 *  - a REAL recorded thunder (SSE Library WEATHER, CC0) is a registered
 *    one-shot in the event-SFX family (FILES registry -> SFX_COUNT derives,
 *    staged like trump-cut / fire-out) and is credited in CREDITS.md;
 *  - the fx bus schedules that thunder for the big over-cut (level >= 3,
 *    the only event that draws the bolt) at the strike's presented time,
 *    gated exactly like the overlay itself (Reduce effects / OS reduced
 *    motion -> no bolt, no thunder). The card's own overcut3 slam is
 *    untouched — the thunder is the sky's sound, not the card's.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const lightning = readFileSync(new URL('../src/photoreal/modules/lightning.js', import.meta.url), 'utf8');
const fx = readFileSync(new URL('../src/fx.ts', import.meta.url), 'utf8');
const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');

describe('lightning strike: speed', () => {
  it('the module timeline runs on the 0.8x clock (3.6 s -> 2.88 s presented)', () => {
    expect(lightning).toContain('const CLOCK = 0.8;');
    expect(lightning).toContain('duration: e.duration * CLOCK');
    expect(lightning).toContain('t /= CLOCK'); // render consumes warped time
    expect(lightning).toContain('D=3.6'); // the authored timeline itself is unchanged
  });
});

describe('lightning strike: thunder', () => {
  it('the thunder is a registered recorded one-shot in the event-SFX family', () => {
    expect(audio).toContain("'thunder'");
    expect(audio).toContain("thunder: ['thunder']"); // FILES registry -> SFX_COUNT derives
    expect(audio).toContain("case 'thunder': return this.sample('thunder'");
    expect(existsSync(new URL('../public/assets/sfx/thunder.mp3', import.meta.url))).toBe(true);
    const credits = readFileSync(new URL('../../../CREDITS.md', import.meta.url), 'utf8');
    expect(credits).toContain('thunder.mp3');
    expect(credits).toContain('SSE_Library_WEATHER');
  });

  it('the fx bus cracks the thunder at the strike frame of a level-3 over-cut', () => {
    expect(fx).toContain('const THUNDER_DELAY_S = 0.44;'); // 0.55 module strike x 0.8 clock
    expect(fx).toContain("sound.play('thunder', { delay: THUNDER_DELAY_S, gain: 1 })");
    // gated like the overlay (host.ts startPhotoreal): reduced fx / OS reduced motion -> neither
    expect(fx).toContain("kind === 'overcut' && (e.level ?? 2) >= 3 && !this.reduced && !this.osReducedMotion");
  });
});
