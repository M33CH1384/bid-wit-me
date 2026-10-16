import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RUN_AREA, RUN_DROP_WINDOW, RUN_MAX_SPIN, runScatter } from '../src/three/landing';

describe("'Run it!' drop and scatter", () => {
  it('is deterministic from the seed', () => {
    expect(runScatter(1234, 4)).toEqual(runScatter(1234, 4));
    expect(runScatter(1234, 4)).not.toEqual(runScatter(1235, 4));
  });
  it('stays on the felt, staggered within the drop window, never squarely stacked', () => {
    for (let seed = 1; seed < 400; seed++) for (const k of [2, 3, 4]) {
      const d = runScatter(seed, k);
      expect(d).toHaveLength(k);
      d.forEach((x, i) => {
        expect(Math.abs(x.dx)).toBeLessThanOrEqual(RUN_AREA.hx);
        expect(x.dz).toBeGreaterThanOrEqual(RUN_AREA.zMin);
        expect(x.dz).toBeLessThanOrEqual(RUN_AREA.zMax);
        expect(Math.abs(x.spin)).toBeLessThanOrEqual(RUN_MAX_SPIN);
        expect(x.delay).toBeLessThanOrEqual(RUN_DROP_WINDOW);
        if (i) expect(x.delay).toBeGreaterThan(d[i - 1]!.delay);
      });
      for (let i = 0; i < k; i++) for (let j = 0; j < i; j++) {
        const exact = Math.abs(d[i]!.dx - d[j]!.dx) < 0.02 && Math.abs(d[i]!.dz - d[j]!.dz) < 0.02;
        expect(exact).toBe(false);
      }
    }
  });
  it('scatters: varied rotation and position', () => {
    const d = runScatter(42, 4);
    expect(Math.max(...d.map((x) => Math.abs(x.spin)))).toBeGreaterThan(0.15);
    expect(new Set(d.map((x) => x.dz.toFixed(2))).size).toBeGreaterThan(1);
  });
  it('the scene scatters regardless of Tips, tidy row on reduced motion; the pile slam fires on the last card's landing', () => {
    const scene = readFileSync(fileURLToPath(new URL('../src/three/Scene.tsx', import.meta.url)), 'utf8');
    expect(scene).toMatch(/const drops = reduced \? null : runScatter\(playSeed\(props\.gameSeed/);
    const table = readFileSync(fileURLToPath(new URL('../src/Table.tsx', import.meta.url)), 'utf8');
    // the pile slam is not scheduled from the claim: the last dropped card fires it on its landing frame
    expect(table).not.toMatch(/sound\.play\('runSlam', \{ delay/);
    expect(scene).toMatch(/sfxLand: i === k - 1 \? 'play,runSlam' : 'play'/);
  });
});
