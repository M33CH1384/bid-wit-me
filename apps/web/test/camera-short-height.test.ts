/**
 * Owner, 2026-11-13 (phone on its side, new game, tilt reading −1°): "The sitting view still feels
 * like standing and the standing view feels like I'm hovering over the table."
 *
 * The phone-landscape cameras were the highest in the game: standing looked down on the felt at 43°
 * and sitting sat where a standing view belongs. Both are lower now. Upright phones and desktop are
 * untouched (their specs are pinned in camera-view.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { SHORT_SITTING_Y, SHORT_STANDING_Y, cameraFor } from '../src/three/layout';

const pitchDeg = (s: { pos: number[]; look: number[] }) => (Math.atan2(s.pos[1]! - s.look[1]!, s.pos[2]! - s.look[2]!) * 180) / Math.PI;

describe('phone-landscape camera heights', () => {
  for (const aspect of [1.5, 844 / 390, 2.39]) {
    const st = cameraFor(aspect, true, 'standing');
    const si = cameraFor(aspect, true, 'sitting');

    it(`${aspect.toFixed(2)}: standing no longer hovers — below the old 3.1 and under 35° of pitch`, () => {
      expect(st.pos[1]).toBe(SHORT_STANDING_Y);
      expect(SHORT_STANDING_Y).toBeLessThan(2.6);
      expect(pitchDeg(st)).toBeLessThan(35);
      expect(pitchDeg(st)).toBeGreaterThan(24); // still looking down at the cards, not across them
    });

    it(`${aspect.toFixed(2)}: sitting is a seated look across the table — below the old 1.95`, () => {
      expect(si.pos[1]).toBe(SHORT_SITTING_Y);
      expect(SHORT_SITTING_Y).toBeLessThan(1.6);
      expect(pitchDeg(si)).toBeLessThan(30);
      expect(pitchDeg(si)).toBeGreaterThan(18); // the felt and the trick stay in view
    });

    it(`${aspect.toFixed(2)}: sitting is clearly lower than standing, and a touch wider`, () => {
      expect(st.pos[1]! - si.pos[1]!).toBeGreaterThan(0.7);
      expect(si.fov).toBeGreaterThan(st.fov);
    });
  }

  it('upright phones and desktop keep the cameras they had', () => {
    expect(cameraFor(390 / 844, false, 'standing').pos).toEqual([0, 4.5, 3.75]);
    expect(cameraFor(1.6, false, 'standing').pos[1]).toBeCloseTo(3.45);
  });
});
