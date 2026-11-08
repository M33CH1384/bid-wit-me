import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The Wheels car is the original Forge/TRELLIS supercar (glossy purple,
// gold stripe and rims, rear wing). A roadster-bodied remodel replaced
// it on 2026-11-04; the owner sent that car away on 2026-11-08 ("let's
// just go back to the old one") and this body was restored from git
// history. These pins hold the asset to its contract — ship-size class
// at the bake's native resolution, real geometry, no brand names
// baked in.
const GLB_PATH = new URL('../public/assets/cars/wheels-supercar.glb', import.meta.url);
const ROADSTER_GLB_PATH = new URL('../public/assets/cars/wheels-roadster.glb', import.meta.url);

function glbJson(buf: Buffer): Record<string, never> {
  expect(buf.subarray(0, 4).toString('ascii')).toBe('glTF');
  expect(buf.readUInt32LE(4)).toBe(2);
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
}

describe('the Wheels supercar asset', () => {
  it('exists at ship size — the 2048² bake at native res, one hero asset', () => {
    // The 2026-10-28 build squeezed this body's 2048² Forge bake to
    // 1024²/64 KB (559,500 B total). The restore carries the bake at
    // native res, WebP q95 — the figures program's cure for the same
    // squeeze, the same one applied to the roadster in between — so
    // the bound reflects the full-res asset (~961 KB), not the
    // squeezed original.
    const buf = readFileSync(GLB_PATH);
    expect(buf.length).toBeGreaterThan(900_000);
    expect(buf.length).toBeLessThan(1_250_000);
  });

  it('the roadster is gone — from disk and from the rig', () => {
    expect(existsSync(ROADSTER_GLB_PATH)).toBe(false);
    const rig = readFileSync(new URL('../src/three/WheelsCar3D.tsx', import.meta.url), 'utf8');
    expect(rig).not.toContain('wheels-roadster');
    const model = readFileSync(new URL('../src/three/wheelsCarModel.ts', import.meta.url), 'utf8');
    expect(model).toContain('wheels-supercar.glb');
    expect(model).not.toContain('wheels-roadster');
  });

  it('carries real fused geometry (triangle count from its own accessors)', () => {
    const json = glbJson(readFileSync(GLB_PATH)) as unknown as {
      meshes: { primitives: { attributes: { POSITION: number }; indices?: number; mode?: number }[] }[];
      accessors: { count: number }[];
    };
    let tris = 0;
    for (const mesh of json.meshes)
      for (const prim of mesh.primitives) {
        if (prim.mode !== undefined && prim.mode !== 4) continue;
        const verts = prim.indices !== undefined ? json.accessors[prim.indices]!.count : json.accessors[prim.attributes.POSITION]!.count;
        tris += verts / 3;
      }
    expect(tris).toBeGreaterThan(10_000);
    expect(tris).toBeLessThan(130_000);
  });

  it('no brand names baked into the file (shape homage only)', () => {
    const buf = readFileSync(GLB_PATH);
    const jsonLen = buf.readUInt32LE(12);
    const jsonText = buf.subarray(20, 20 + jsonLen).toString('utf8').toLowerCase();
    expect(jsonText).not.toContain('tesla');
  });
});
