/**
 * @vitest-environment happy-dom
 *
 * BED WHITE-NOISE GUARD (fix lane, 2026-11-10): in the iOS app shell the
 * Classic room-tone bed played as raw static while the element-routed
 * music decks played perfectly. Every recorded bed now passes
 * bedBufferSane before a buffer source may sound it; an untrusted decode
 * falls back to the element path, never to the speaker as noise. These
 * pins hold the discriminator against the shapes that matter:
 *
 *  - real recordings are correlated sample-to-sample (production beds
 *    measure median step/RMS of 0.03–0.44) and pass at every brightness;
 *  - uncorrelated garbage (step/RMS ≈ 1.13) is rejected, loud or quiet;
 *  - near-silence can only ever play silence, so it passes;
 *  - non-finite samples are an automatic reject.
 *
 * Signals are synthesized here, but their statistics are calibrated to
 * the twelve production beds measured from the live site on 2026-11-10.
 */
import { describe, expect, it } from 'vitest';
import { bedBufferSane, BED_NOISE_RATIO_LIMIT } from '../src/audio';

/** Deterministic PRNG so the pins never flake. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** One-pole lowpass over white noise: `a` small = dark room tone; larger = bright crowd/surf wash. */
function shapedNoise(seconds: number, sampleRate: number, a: number, gain: number, seed: number): Float32Array {
  const rand = rng(seed);
  const out = new Float32Array(Math.floor(seconds * sampleRate));
  let y = 0;
  for (let i = 0; i < out.length; i++) {
    y += a * ((rand() * 2 - 1) - y);
    out[i] = y * gain;
  }
  return out;
}

function whiteNoise(seconds: number, sampleRate: number, gain: number, seed: number, uniform = false): Float32Array {
  const rand = rng(seed);
  const out = new Float32Array(Math.floor(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = (uniform ? rand() * 2 - 1 : (rand() + rand() + rand() - 1.5) / 1.5) * gain;
  return out;
}

function fakeBuffer(channels: Float32Array[], sampleRate = 44100): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    length: channels[0]!.length,
    sampleRate,
    getChannelData: (ch: number) => channels[ch]!,
  } as unknown as AudioBuffer;
}

const SR = 44100;

describe('bedBufferSane: recordings pass', () => {
  it('a dark room tone like the Classic bed (median ratio ~0.10) is sane', () => {
    const ch = shapedNoise(8, SR, 0.015, 2.2, 11);
    expect(bedBufferSane(fakeBuffer([ch, ch]))).toBe(true);
  });

  it('the brightest real bed shape (cookout crowd, median ratio ~0.44) is sane', () => {
    const ch = shapedNoise(8, SR, 0.22, 1.4, 23);
    expect(bedBufferSane(fakeBuffer([ch, ch]))).toBe(true);
  });

  it('a quiet bed under the measurement floor is sane (it can only play silence)', () => {
    const ch = shapedNoise(8, SR, 0.015, 0.01, 31);
    expect(bedBufferSane(fakeBuffer([ch]))).toBe(true);
  });

  it('pure silence is sane', () => {
    expect(bedBufferSane(fakeBuffer([new Float32Array(SR * 4)]))).toBe(true);
  });
});

describe('bedBufferSane: static never passes', () => {
  it('full-scale white noise is rejected', () => {
    const ch = whiteNoise(8, SR, 0.9, 41);
    expect(bedBufferSane(fakeBuffer([ch, ch]))).toBe(false);
  });

  it('quiet white noise is still rejected — volume is not innocence', () => {
    const ch = whiteNoise(8, SR, 0.08, 43);
    expect(bedBufferSane(fakeBuffer([ch]))).toBe(false);
  });

  it('uniform (undecoded-byte shaped) noise is rejected', () => {
    const ch = whiteNoise(8, SR, 0.8, 47, true);
    expect(bedBufferSane(fakeBuffer([ch]))).toBe(false);
  });

  it('one garbled channel convicts the buffer', () => {
    const good = shapedNoise(8, SR, 0.015, 2.2, 53);
    const bad = whiteNoise(8, SR, 0.9, 59);
    expect(bedBufferSane(fakeBuffer([good, bad]))).toBe(false);
  });

  it('a span of non-finite samples is rejected outright', () => {
    const ch = shapedNoise(8, SR, 0.015, 2.2, 61);
    ch.fill(NaN, 0, 2048); // a garbled decode corrupts spans, and the first window is always sampled
    expect(bedBufferSane(fakeBuffer([ch]))).toBe(false);
  });

  it('the limit sits between the brightest real bed and raw static', () => {
    // production medians: beds <= 0.44, white noise ~= 1.13
    expect(BED_NOISE_RATIO_LIMIT).toBeGreaterThan(0.6);
    expect(BED_NOISE_RATIO_LIMIT).toBeLessThan(0.95);
  });
});
