import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Cards on the table must not shadow the floor behind it (owner 2026-11-14:
 * a card-shaped dark patch showed on the floor past the far rail). The felt is
 * a one-sided flat face the shadow pass skips, so the table carries an unseen
 * blocker under the felt that casts from both sides.
 */
describe('felt shadow blocker', () => {
  const scene = readFileSync(join(process.cwd(), 'apps/web/src/three/Scene.tsx'), 'utf8');

  it('draws nothing but casts from both sides', () => {
    expect(scene).toContain('new MeshBasicMaterial({ colorWrite: false, depthWrite: false, shadowSide: DoubleSide })');
  });

  it('sits under the felt with the felt shape, casting', () => {
    expect(scene).toContain('<mesh geometry={geos.felt} material={feltBlockMat} position={[0, -0.03, 0]} castShadow renderOrder={-2} />');
  });
});
