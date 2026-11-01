import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const card3d = readFileSync(fileURLToPath(new URL('../src/three/Card3D.tsx', import.meta.url)), 'utf8');

describe("'Run it!' slam disturbance firing (source pin)", () => {
  it("the disturbance fires only from the full-show striking card's landing frame", () => {
    const i = card3d.indexOf('if (!fx.reduced) { dkS.dipAt = performance.now(); dkS.dipDepth = 0.014; }');
    expect(i).toBeGreaterThanOrEqual(0);
    const region = card3d.slice(Math.max(0, i - 2400), i + 400);
    expect(region).toMatch(/pushSlamDisturbance\(\{ at:/);
  });
});
