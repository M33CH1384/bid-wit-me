import { describe, expect, it } from 'vitest';
import {
  canvasToLayer, frameHasAlpha, isAppleWebKit, plateFrame, pulseSources,
} from '../src/pulsePlate';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

describe('pulse plate', () => {
  it('centers the plate on the card at 390px instead of pinning a slab to the left', () => {
    const point = canvasToLayer(150, 420, { left: 0, top: 0 }, { left: 0, top: 0 });
    const frame = plateFrame({ ...point, cardW: 78 });
    expect(frame).not.toBeNull();
    expect(frame!.width).toBeCloseTo(78 * 2.6);
    expect(frame!.height / frame!.width).toBeCloseTo(720 / 512);
    expect(frame!.left + frame!.width / 2).toBeCloseTo(150);
    expect(frame!.top + frame!.height / 2).toBeCloseTo(420);
    expect(frame!.width).toBeLessThan(390);
    expect(frame!.left).toBeGreaterThan(0);
    expect(frame!.left + frame!.width).toBeLessThan(390);
  });

  it('maps a canvas-local card into the overlay when the canvas is offset', () => {
    expect(canvasToLayer(100, 200, { left: 12, top: 40 }, { left: 0, top: 0 })).toEqual({ x: 112, y: 240 });
  });

  it('rejects an opaque frame and waits while the frame is still empty', () => {
    expect(frameHasAlpha(255, 255)).toBe(false);
    expect(frameHasAlpha(40, 200)).toBe(false);
    expect(frameHasAlpha(0, 0)).toBeNull();
    expect(frameHasAlpha(0, 80)).toBe(true);
  });

  it('gives Safari HEVC first and does not hand it an opaque WebM when HEVC is missing', () => {
    expect(pulseSources(true, '')).toEqual([]);
    expect(pulseSources(true, '/fx/joker-pulse.mov').map((s) => s.type)).toEqual([
      'video/mp4; codecs="hvc1"',
      'video/webm; codecs="vp9"',
    ]);
    expect(pulseSources(false).map((s) => s.type)).toEqual(['video/webm; codecs="vp9"']);
    expect(isAppleWebKit(IPHONE)).toBe(true);
    expect(isAppleWebKit(CHROME)).toBe(false);
  });
});
