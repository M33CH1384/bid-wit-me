import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The table BODY (apron) must read solid at every venue. The mansion's crystal apron once
 * shipped transparent (opacity 0.4): the bright marble floor bled through the near wall and
 * the table read hollow around the player's seat (owner, 2026-10-25). The crystal RAIL ring
 * keeps its translucency — that is the venue's signature — but no venue's apron may ever be
 * see-through again. Source pins in the Scene.tsx idiom (see card-backs / hand-lift).
 */
const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');

function blockBetween(start: string, end: string): string {
  const a = scene.indexOf(start);
  const b = scene.indexOf(end, a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return scene.slice(a, b);
}

describe('table apron solidity (owner, 2026-10-25: "the table looks transparent down near me")', () => {
  const apronBlock = blockBetween('const apron =', 'const floor =');

  it('no venue apron is transparent — the body never lets the floor bleed through', () => {
    expect(apronBlock).not.toContain('transparent');
    expect(apronBlock).not.toContain('opacity');
  });

  it('the crystal body stays a glossy physical material (frosted glass, not a flat stand-in)', () => {
    expect(apronBlock).toContain("def.rail === 'crystal'");
    expect(apronBlock).toContain('MeshPhysicalMaterial');
    expect(apronBlock).toContain('clearcoat: 1');
    expect(apronBlock).toContain('color: def.apron');
  });

  it('the crystal RAIL keeps its translucency (the fix did not overcorrect the venue signature)', () => {
    const railBlock = blockBetween("case 'crystal':", "case 'chrome':");
    expect(railBlock).toContain('transparent: true');
    expect(railBlock).toContain('opacity: 0.55');
  });

  it('the apron is built per rail kind for every venue family, not a mansion special case', () => {
    expect(apronBlock).toContain("def.rail === 'chrome' || def.rail === 'metal'");
    expect(apronBlock).toContain('MeshStandardMaterial');
  });
});
