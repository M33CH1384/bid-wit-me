/**
 * HIGH CONTRACT ring removal pins (owner, 2026-10-23: "What's this circle
 * that keeps moving around the screen? I don't like it."). The wandering
 * element was the wave-3 `.animfx-hotring`: an orange pulsing ring pinned
 * to the centroid of the current trick's cards whenever every side's
 * contract ran "hot" (contractHeat) — so it drifted around the middle of
 * the felt for whole hands at a time. Node environment so the sources can
 * be read from disk, the recap-finale-compose-css.test.ts pattern: the
 * ring must be gone from the stylesheet, the layer and the detector —
 * not merely unrendered.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/animfx/animfx.css', import.meta.url), 'utf8');
const layer = readFileSync(new URL('../src/animfx/AnimFxLayer.tsx', import.meta.url), 'utf8');
const detect = readFileSync(new URL('../src/animfx/detect.ts', import.meta.url), 'utf8');

describe('the wandering high-contract ring is removed (owner 2026-10-23)', () => {
  it('no hotring rule or keyframes remain in the stylesheet', () => {
    expect(css).not.toContain('animfx-hotring');
    expect(css).not.toContain('@keyframes animfx-hotring');
  });
  it('the layer never creates the ring node', () => {
    expect(layer).not.toContain('animfx-hotring');
    expect(layer).not.toContain('hotRing');
  });
  it('the contract-heat detector that fed it is gone', () => {
    expect(detect).not.toContain('contractHeat');
    expect(detect).not.toContain('HOT_SIDE_CONTRACT');
    expect(detect).not.toContain('HOT_SEAT_BID');
  });
});
