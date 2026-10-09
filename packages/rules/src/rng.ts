/**
 * Seeded, deterministic RNG (sfc32 seeded via cyrb128) so any game can be replayed from its seed.
 * Integers are drawn with rejection sampling to avoid modulo bias.
 * The server can create unpredictable seeds with `secureSeed()` (crypto.getRandomValues).
 */

export interface Rng {
  /** Uniform unsigned 32-bit integer. */
  nextUint32(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Uniform float in [0, 1). */
  float(): number;
}

function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** Builds an Rng from a uint32 source using rejection sampling. */
export function rngFromSource(next: () => number): Rng {
  return {
    nextUint32: next,
    int(n: number): number {
      if (!Number.isInteger(n) || n <= 0 || n > 2 ** 32) throw new RangeError(`bad range ${n}`);
      const limit = Math.floor(2 ** 32 / n) * n;
      for (;;) {
        const r = next();
        if (r < limit) return r % n;
      }
    },
    float(): number {
      return next() / 2 ** 32;
    },
  };
}

export function createRng(seed: string | number): Rng {
  let [a, b, c, d] = cyrb128(String(seed));
  const next = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 12; i++) next(); // warm up
  return rngFromSource(next);
}

/** Crypto-backed RNG (for the server; not replayable). */
export function cryptoRng(): Rng {
  const buf = new Uint32Array(64);
  let i = buf.length;
  return rngFromSource(() => {
    if (i >= buf.length) {
      globalThis.crypto.getRandomValues(buf);
      i = 0;
    }
    return buf[i++]!;
  });
}

/** Unpredictable seed string (128 bits, hex). */
export function secureSeed(): string {
  const b = new Uint32Array(4);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(8, '0')).join('');
}

/** In-place Fisher–Yates shuffle; returns the same array. */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}
