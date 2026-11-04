import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The remodelled Wheels car (owner, 2026-11-04: "change the car to look
// like the new Tesla roadster") ships the same way the outgoing supercar
// did: a Forge/TRELLIS body, optimised into a fused GLB, normalised by
// the rig onto the doughnut footprint. These pins hold the asset to that
// contract — ship-size class, real geometry, no brand names baked in.
const GLB_PATH = new URL('../public/assets/cars/wheels-roadster.glb', import.meta.url);
const OLD_GLB_PATH = new URL('../public/assets/cars/wheels-supercar.glb', import.meta.url);

function glbJson(buf: Buffer): Record<string, never> {
  expect(buf.subarray(0, 4).toString('ascii')).toBe('glTF');
  expect(buf.readUInt32LE(4)).toBe(2);
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
}

describe('the Wheels roadster asset', () => {
  it('exists at ship size — same class as the 559,500-byte supercar it replaces', () => {
    const buf = readFileSync(GLB_PATH);
    expect(buf.length).toBeGreaterThan(100_000);
    expect(buf.length).toBeLessThan(900_000);
  });

  it('the old supercar is gone — from disk and from the rig', () => {
    expect(existsSync(OLD_GLB_PATH)).toBe(false);
    const rig = readFileSync(new URL('../src/three/WheelsCar3D.tsx', import.meta.url), 'utf8');
    expect(rig).not.toContain('wheels-supercar');
    const model = readFileSync(new URL('../src/three/wheelsCarModel.ts', import.meta.url), 'utf8');
    expect(model).toContain('wheels-roadster.glb');
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
