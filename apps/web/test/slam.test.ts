import { describe, expect, it } from 'vitest';
import { DEFAULT_SLAM, releaseVelocity, slamFeel, slamIntensity } from '../src/slam';

describe('release velocity', () => {
  it('measures px/ms over the last ~80ms only', () => {
    const s = [{ t: 0, x: 0, y: 0 }, { t: 500, x: 0, y: 10 }, { t: 540, x: 0, y: 50 }, { t: 580, x: 0, y: 90 }];
    expect(releaseVelocity(s)).toBeCloseTo(1, 5);
  });
  it('is 0 without enough samples', () => {
    expect(releaseVelocity([])).toBe(0);
    expect(releaseVelocity([{ t: 1, x: 1, y: 1 }])).toBe(0);
  });
});

describe('slam intensity', () => {
  it('slow drops are gentle, fast flicks slam, capped', () => {
    expect(slamIntensity(0.1)).toBe(0);
    expect(slamIntensity(1.375)).toBeCloseTo(0.5, 5);
    expect(slamIntensity(2.5)).toBe(1);
    expect(slamIntensity(40)).toBe(1);
    expect(slamIntensity(NaN)).toBe(0);
  });
  it('is continuous and monotonic', () => {
    let prev = -1;
    for (let v = 0; v <= 3; v += 0.01) { const i = slamIntensity(v); expect(i).toBeGreaterThanOrEqual(prev); expect(i - Math.max(prev, 0)).toBeLessThan(0.01); prev = i; }
  });
  it('a faster slam flies shorter, bounces harder, shakes and is louder', () => {
    const soft = slamFeel(0), hard = slamFeel(1);
    expect(hard.duration).toBeLessThan(soft.duration);
    expect(hard.bounce).toBeGreaterThan(soft.bounce);
    expect(soft.shake).toBe(0);
    expect(hard.shake).toBeGreaterThan(0);
    expect(hard.volume).toBeGreaterThan(soft.volume);
    expect(hard.volume).toBeLessThanOrEqual(1);
  });
  it('reduced motion: no shake, minimal bounce', () => {
    const r = slamFeel(1, true);
    expect(r.shake).toBe(0);
    expect(r.bounce).toBeLessThan(0.01);
  });
  it('bad intensity falls back to default', () => {
    expect(slamFeel(NaN)).toEqual(slamFeel(DEFAULT_SLAM));
  });
});

import { parseClientMsg } from '@spades/protocol';

describe('online slam field', () => {
  it('is optional and back-compatible', () => {
    expect(parseClientMsg({ t: 'act', action: { type: 'play', card: 'AS' } })).toMatchObject({ action: { type: 'play', card: 'AS' } });
    const old = parseClientMsg({ t: 'act', action: { type: 'play', card: 'AS' } }) as { action: { slam?: number } };
    expect(old.action.slam).toBeUndefined();
  });
  it('carries and clamps the intensity', () => {
    expect((parseClientMsg({ t: 'act', action: { type: 'play', card: 'AS', slam: 0.7 } }) as { action: { slam?: number } }).action.slam).toBe(0.7);
    expect((parseClientMsg({ t: 'act', action: { type: 'play', card: 'AS', slam: 9 } }) as { action: { slam?: number } }).action.slam).toBe(1);
    expect((parseClientMsg({ t: 'act', action: { type: 'play', card: 'AS', slam: 'x' } }) as { action: { slam?: number } }).action.slam).toBeUndefined();
  });
});
