import { describe, expect, it } from 'vitest';
import { queenTail } from '../src/cardArt';

describe('queen rank glyph', () => {
  it('draws a tail that leaves the bowl, so a phone-sized Q is not a zero', () => {
    for (const fs of [12, 28, 48]) {
      const t = queenTail(40, 50, fs);
      const start = Math.hypot(t.x1 - 40, t.y1 - 50);
      const end = Math.hypot(t.x2 - 40, t.y2 - 50);
      expect(end).toBeGreaterThan(start);
      expect(t.x2).toBeGreaterThan(t.x1);
      expect(t.y2).toBeGreaterThan(t.y1);
      // clear of a bowl about 0.4em across, and thick enough to survive the corner index
      expect(end).toBeGreaterThan(fs * 0.6);
      expect(Math.hypot(t.x2 - t.x1, t.y2 - t.y1)).toBeGreaterThan(fs * 0.4);
      expect(t.width).toBeGreaterThan(fs * 0.12);
      // stays above the suit pip under the corner index
      expect(t.y2).toBeLessThan(50 + fs * 0.48);
    }
  });

  it('shortens the court tail so it stays inside the frame', () => {
    const fs = 48;
    const t = queenTail(40, 50, fs, 0.55);
    expect(t.x2).toBeGreaterThan(t.x1);
    expect(t.y2).toBeGreaterThan(t.y1);
    expect(t.x2).toBeLessThan(40 + fs * 0.45);
    expect(Math.hypot(t.x2 - 40, t.y2 - 50)).toBeGreaterThan(fs * 0.4);
  });
});
