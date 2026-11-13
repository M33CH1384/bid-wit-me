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
import hallSrc from '../src/three/hallEnv.tsx?raw';
import { FloatType, HalfFloatType, DataUtils, type Texture } from 'three';
import { assessBake, bakeLimit, clampSource, HALL_ENV_MAX_MEAN, HALL_ENV_MIN_LIMIT, PROBE_VIEWS, RETRY_SOURCE_MAX, sourceBrightestFace, sourceMeanLuminance, sourceScale } from '../src/three/hallEnv';

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

  it('a dim source is held to its own scale, down to the probe’s resolution floor', () => {
    // 2026-11-12: the limit used to floor at 3 whatever the source, so a bake thirty times
    // too bright for a dim rendered room (Classic Studio's source mean is 0.087) still passed.
    expect(bakeLimit(0.1)).toBe(HALL_ENV_MIN_LIMIT);
    expect(assessBake(0.1, HALL_ENV_MIN_LIMIT + 0.01)).toBe('blown');
    expect(assessBake(0.1, HALL_ENV_MIN_LIMIT - 0.01)).toBe('ok');
    expect(assessBake(0.087, 2.9)).toBe('blown'); // the white-table bake
    expect(assessBake(0.087, 0.16)).toBe('ok'); // a correct bake read through 8 bits
    expect(assessBake(0.021, 0.08)).toBe('ok'); // the Speakeasy, the dimmest room
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

// Owner, 2026-11-12 (Mansion on iPhone): the table still came up washed out after the limit was
// tightened. The probe looked at its sphere from one side only, so a bake blown overhead — the
// light that falls on the felt and the cards — read as normal and passed.
describe('the probe judges the bake from every side', () => {
  const src: string = hallSrc;
  it('looks from above first, and from all six sides', () => {
    expect(PROBE_VIEWS[0]).toEqual([0, 1, 0]);
    expect(PROBE_VIEWS).toHaveLength(6);
    const key = (v: readonly number[]) => v.join(',');
    expect(new Set(PROBE_VIEWS.map(key)).size).toBe(6);
  });
  it('returns the brightest face, not an average', () => {
    expect(src).toContain('for (const [x, y, z] of PROBE_VIEWS)');
    expect(src).toContain('if (worst === null || mean > worst) worst = mean;');
  });
});

describe('the retry bakes a tamed source', () => {
  const tex = (type: number, data: Float32Array | Uint16Array) => ({ type, image: { data }, needsUpdate: false }) as unknown as Texture;
  it('caps hot texels, NaN and Infinity, and leaves alpha and normal values alone', () => {
    const data = new Float32Array([0.2, 74, 0.5, 1, NaN, Infinity, 3.9, 1]);
    const t = tex(FloatType, data);
    expect(clampSource(t, RETRY_SOURCE_MAX)).toBe(3);
    expect([...data]).toEqual([expect.closeTo(0.2), 4, 0.5, 1, 4, 4, expect.closeTo(3.9), 1]);
    expect((t as unknown as { needsUpdate: boolean }).needsUpdate).toBe(true);
  });
  it('works on half-float sources', () => {
    const data = new Uint16Array([DataUtils.toHalfFloat(2621), DataUtils.toHalfFloat(0.25), DataUtils.toHalfFloat(1), DataUtils.toHalfFloat(1)]);
    expect(clampSource(tex(HalfFloatType, data), RETRY_SOURCE_MAX)).toBe(1);
    expect(DataUtils.fromHalfFloat(data[0]!)).toBe(4);
    expect(DataUtils.fromHalfFloat(data[1]!)).toBeCloseTo(0.25);
  });
  it('a sane source is untouched', () => {
    const t = tex(FloatType, new Float32Array([0.1, 0.2, 0.3, 1]));
    expect(clampSource(t, RETRY_SOURCE_MAX)).toBe(0);
    expect((t as unknown as { needsUpdate: boolean }).needsUpdate).toBe(false);
  });
  it('the clamp runs before the retry bake', () => {
    const src: string = hallSrc;
    expect(src.indexOf('clampSource(tex, RETRY_SOURCE_MAX)')).toBeGreaterThan(-1);
    expect(src.indexOf('clampSource(tex, RETRY_SOURCE_MAX)')).toBeLessThan(src.indexOf('pub.fromEquirectangular(tex)'));
  });
});

// A correct Mansion bake reads ~0.6 from above against a room mean of ~0.2 (measured on desktop,
// 2026-11-12): the brightest face must be judged against the source's brightest face.
describe('the bake is held to the source’s brightest face', () => {
  const W = 64, H = 32;
  const equirect = (lum: (row: number, col: number) => number) => {
    const data = new Float32Array(W * H * 4);
    for (let r = 0; r < H; r++) for (let c2 = 0; c2 < W; c2++) { const i = (r * W + c2) * 4; const v = lum(r, c2); data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 1; }
    return { type: FloatType, image: { data, width: W, height: H } } as unknown as Texture;
  };
  it('an even room: every face reads the mean', () => {
    const t = equirect(() => 0.3);
    expect(sourceBrightestFace(t)).toBeCloseTo(0.3, 2);
    expect(sourceScale(t)).toBeCloseTo(0.3, 2);
  });
  it('a room lit from one pole: the brightest face is well above the mean, whichever pole', () => {
    const top = equirect((r) => (r < H / 4 ? 2 : 0.1));
    const bottom = equirect((r) => (r >= (H * 3) / 4 ? 2 : 0.1));
    const face = sourceBrightestFace(top);
    expect(face).toBeGreaterThan(sourceMeanLuminance(top) * 1.8);
    expect(sourceBrightestFace(bottom)).toBeCloseTo(face, 2);
    expect(sourceScale(top)).toBeCloseTo(face, 5);
    // a correct bake of that room (probe ≈ its brightest face) passes; thirty times it does not
    expect(assessBake(sourceScale(top), face)).toBe('ok');
    expect(assessBake(sourceScale(top), face * 30)).toBe('blown');
  });
  it('an unreadable source falls back to the mean, then to unmeasurable', () => {
    const t = { type: FloatType, image: { data: new Float32Array([0.5, 0.5, 0.5, 1]) } } as unknown as Texture;
    expect(sourceBrightestFace(t)).toBeNaN();
    expect(sourceScale(t)).toBeCloseTo(0.5);
  });
  it('filterHall measures the source with it', () => {
    expect(hallSrc as string).toContain('const sourceMean = sourceScale(tex);');
  });
});
