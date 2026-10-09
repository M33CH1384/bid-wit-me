import { describe, expect, it } from 'vitest';
import { createRng, cryptoRng, rngFromSource, secureSeed, shuffle } from '../src';

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = createRng('abc'), b = createRng('abc'), c = createRng('abd');
    const xa = Array.from({ length: 10 }, () => a.nextUint32());
    const xb = Array.from({ length: 10 }, () => b.nextUint32());
    const xc = Array.from({ length: 10 }, () => c.nextUint32());
    expect(xa).toEqual(xb);
    expect(xa).not.toEqual(xc);
  });
  it('accepts numeric seeds', () => {
    expect(createRng(42).nextUint32()).toBe(createRng('42').nextUint32());
  });
  it('int() stays in range and floats are in [0,1)', () => {
    const r = createRng('range');
    for (let i = 0; i < 2000; i++) {
      const v = r.int(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
      const f = r.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
    expect(() => r.int(0)).toThrow(RangeError);
    expect(() => r.int(1.5)).toThrow(RangeError);
  });
  it('uses rejection sampling (rejects values in the biased tail)', () => {
    // n = 3: limit = floor(2^32/3)*3 = 4294967295; 4294967295 must be rejected.
    const vals = [4294967295, 5];
    const r = rngFromSource(() => vals.shift()!);
    expect(r.int(3)).toBe(5 % 3);
  });
  it('is roughly uniform', () => {
    const r = createRng('uniform');
    const counts = Array(6).fill(0);
    for (let i = 0; i < 60000; i++) counts[r.int(6)]++;
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(500);
  });
  it('shuffle is a permutation and deterministic', () => {
    const items = Array.from({ length: 54 }, (_, i) => i);
    const s1 = shuffle([...items], createRng('s'));
    const s2 = shuffle([...items], createRng('s'));
    expect(s1).toEqual(s2);
    expect([...s1].sort((a, b) => a - b)).toEqual(items);
    expect(s1).not.toEqual(items);
  });
  it('crypto rng and secure seeds work', () => {
    const r = cryptoRng();
    for (let i = 0; i < 100; i++) expect(r.int(52)).toBeLessThan(52);
    expect(secureSeed()).toMatch(/^[0-9a-f]{32}$/);
    expect(secureSeed()).not.toBe(secureSeed());
  });
});
