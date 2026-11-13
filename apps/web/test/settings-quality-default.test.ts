/**
 * @vitest-environment happy-dom
 *
 * GRAPHICS-QUALITY DEFAULT (incident lane, 2026-11-10): a fresh settings
 * store on an iPhone started on Low graphics — visibly, the new app
 * shell's empty WebView store — because the load-time heuristic trusted
 * `hardwareConcurrency`, which WebKit clamps to 2 on iOS, while Safari
 * and WKWebView report no `deviceMemory` at all. The ink layer's gate
 * was fixed to demand positive evidence of a weak device (ink.test.ts);
 * these pins hold the same doctrine for the 3D scene's quality:
 *
 *  - absent signals are "unknown", never "weak" (an iPhone is High);
 *  - a browser-reported memory figure <= 3 GB is real evidence (Low);
 *  - core counts never classify a device, in either direction;
 *  - a stored 'low' the player never picked heals to High on load;
 *  - an explicit pick (qualityPicked) and a genuinely weak device's
 *    stored 'low' both survive the heal.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { defaultQuality, normalizeSettings } from '../src/settings';

const nav = navigator as Navigator & { deviceMemory?: number };

function setSignals(deviceMemory: number | undefined, hardwareConcurrency: number | undefined): void {
  Object.defineProperty(nav, 'deviceMemory', { value: deviceMemory, configurable: true });
  Object.defineProperty(nav, 'hardwareConcurrency', { value: hardwareConcurrency, configurable: true });
}

afterEach(() => {
  setSignals(undefined, undefined);
});

describe('defaultQuality: positive evidence only', () => {
  it('an iPhone (no deviceMemory, cores clamped to 2 by WebKit) defaults to High', () => {
    setSignals(undefined, 2);
    expect(defaultQuality()).toBe('high');
  });

  it('no signals at all defaults to High', () => {
    setSignals(undefined, undefined);
    expect(defaultQuality()).toBe('high');
  });

  it('a reported memory figure of 3 GB or less is real evidence of a weak device', () => {
    setSignals(3, 8);
    expect(defaultQuality()).toBe('low');
    setSignals(2, 8);
    expect(defaultQuality()).toBe('low');
    setSignals(1, 2);
    expect(defaultQuality()).toBe('low');
  });

  it('a reported memory figure above 3 GB is High even with a clamped core count', () => {
    setSignals(4, 2);
    expect(defaultQuality()).toBe('high');
    setSignals(8, 2);
    expect(defaultQuality()).toBe('high');
  });

  it('core counts alone never classify a device as weak', () => {
    setSignals(undefined, 1);
    expect(defaultQuality()).toBe('high');
  });
});

describe('normalizeSettings: healing a defaulted low', () => {
  it("a stored 'low' the player never picked heals to High where the device reads high-capable", () => {
    setSignals(undefined, 2); // iPhone signals
    expect(normalizeSettings({ quality: 'low' }).quality).toBe('high');
  });

  it("an explicit Low pick (qualityPicked) survives the heal", () => {
    setSignals(undefined, 2);
    const s = normalizeSettings({ quality: 'low', qualityPicked: true });
    expect(s.quality).toBe('low');
    expect(s.qualityPicked).toBe(true);
  });

  it("a weak device's stored 'low' survives on the heuristic's own word", () => {
    setSignals(2, 8); // genuinely low-memory device
    expect(normalizeSettings({ quality: 'low' }).quality).toBe('low');
  });

  it('a junk quality value falls back to the device default', () => {
    setSignals(undefined, 2);
    expect(normalizeSettings({ quality: 'ultra' as never }).quality).toBe('high');
    setSignals(2, 8);
    expect(normalizeSettings({ quality: 'ultra' as never }).quality).toBe('low');
  });

  it("a stored 'high' is never downgraded by the heal", () => {
    setSignals(2, 8);
    expect(normalizeSettings({ quality: 'high' }).quality).toBe('high');
  });
});
