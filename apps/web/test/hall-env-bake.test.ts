/**
 * @vitest-environment happy-dom
 *
 * HALL-ENV BAKE GUARD (fix lane, 2026-11-10): the Classic Studio hall
 * environment is baked by driving PMREMGenerator's private internals. In
 * the iOS app shell that bake came back blown — the room rendered washed
 * to white while other venues (no hall bake) were fine. filterHall now
 * measures the baked map before it may reach the scene and rejects a
 * blown result (public-path retry, then no environment at all). These
 * pins hold the pure decision math:
 *
 *  - a correct bake of a real interior (probe ≈ source) passes;
 *  - a bake delivering many times its source's light is 'blown';
 *  - the cap has an absolute floor, so a dim source cannot license a flood;
 *  - a legitimately bright source scales its allowance proportionally;
 *  - an unmeasurable bake (probe null) is NOT convicted — working
 *    platforms must render exactly as before;
 *  - sourceMeanLuminance reads half-float and float HDR texels alike and
 *    shrugs off non-finite texels.
 */
import { describe, expect, it } from 'vitest';
import { DataUtils, FloatType, HalfFloatType, type Texture } from 'three';
import { assessBake, bakeLimit, HALL_ENV_MAX_MEAN, sourceMeanLuminance } from '../src/three/hallEnv';

function fakeTex(data: ArrayLike<number>, type: typeof HalfFloatType | typeof FloatType): Texture {
  return { image: { data, width: 4, height: 1 }, type } as unknown as Texture;
}

describe('assessBake: a sane bake passes untouched', () => {
  it('probe near the source mean is ok', () => {
    expect(assessBake(0.6, 0.55)).toBe('ok');
    expect(assessBake(0.6, 1.4)).toBe('ok');
  });

  it('an unmeasurable bake is not convicted', () => {
    expect(assessBake(0.6, null)).toBe('ok');
    expect(assessBake(NaN, null)).toBe('ok');
    expect(assessBake(0.6, NaN)).toBe('ok');
  });
});

describe('assessBake: a blown bake is rejected', () => {
  it('probe many times the source mean is blown', () => {
    expect(assessBake(0.6, 9.5)).toBe('blown');
    expect(assessBake(0.3, 20)).toBe('blown');
  });

  it('the absolute floor convicts a flood from a dim source', () => {
    expect(bakeLimit(0.1)).toBe(HALL_ENV_MAX_MEAN);
    expect(assessBake(0.1, HALL_ENV_MAX_MEAN + 0.01)).toBe('blown');
    expect(assessBake(0.1, HALL_ENV_MAX_MEAN - 0.01)).toBe('ok');
  });

  it('a bright source scales its allowance — but only 4x', () => {
    expect(bakeLimit(2)).toBe(8);
    expect(assessBake(2, 7.9)).toBe('ok');
    expect(assessBake(2, 8.1)).toBe('blown');
  });

  it('a missing/degenerate source mean falls back to the absolute cap', () => {
    expect(bakeLimit(NaN)).toBe(HALL_ENV_MAX_MEAN);
    expect(bakeLimit(0)).toBe(HALL_ENV_MAX_MEAN);
    expect(bakeLimit(-1)).toBe(HALL_ENV_MAX_MEAN);
  });
});

describe('sourceMeanLuminance', () => {
  it('averages float texels with Rec.709 weights', () => {
    // one texel: pure green at 1.0 -> luminance 0.7152; others black
    const data = new Float32Array([0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(sourceMeanLuminance(fakeTex(data, FloatType))).toBeCloseTo(0.7152 / 4, 5);
  });

  it('decodes half-float texels (the RGBELoader output format)', () => {
    const one = DataUtils.toHalfFloat(1);
    const zero = DataUtils.toHalfFloat(0);
    const data = new Uint16Array([one, one, one, one, zero, zero, zero, one, zero, zero, zero, one, zero, zero, zero, one]);
    expect(sourceMeanLuminance(fakeTex(data, HalfFloatType))).toBeCloseTo(0.25, 3);
  });

  it('skips non-finite texels instead of poisoning the mean', () => {
    // texel 0 is (Inf,0,0) and drops out; the rest average (0.5 + 0 + 0) / 3
    const data = new Float32Array([Infinity, 0, 0, 1, 0.5, 0.5, 0.5, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(sourceMeanLuminance(fakeTex(data, FloatType))).toBeCloseTo(0.5 / 3, 5);
  });

  it('returns NaN when there is nothing to measure', () => {
    expect(Number.isNaN(sourceMeanLuminance({ image: undefined, type: FloatType } as unknown as Texture))).toBe(true);
    expect(Number.isNaN(sourceMeanLuminance(fakeTex(new Float32Array(0), FloatType)))).toBe(true);
  });
});
