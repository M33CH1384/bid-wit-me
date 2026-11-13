import { describe, expect, it } from 'vitest';
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { normalizeWheelsCar, WHEELS_CAR_METALNESS, WHEELS_CAR_ROUGHNESS } from '../src/three/wheelsCarModel';

// The Wheels supercar is a TRELLIS appearance bake: its GLB material
// declares ONLY a baseColorTexture, so the glTF defaults would make it
// metallicFactor 1.0 / roughnessFactor 1.0 — a metal has no diffuse
// response, and neither render home (the table Scene's venue light, the
// results stage's own small rig) supplies an environment map to feed
// it. It rendered as a dark silhouette — "looks like a shadow" (owner,
// 2026-11-05). normalizeWheelsCar is the ONE normalization both mounts
// share, so it corrects the material for display there.
describe('wheels car material — the appearance bake must not render as a metal', () => {
  it('corrects the fused body material to a paint read', () => {
    // a mesh carrying the GLB's own material shape: map-only PBR, which
    // three.js instantiates at the glTF defaults (metalness 1, roughness 1)
    const mat = new MeshStandardMaterial();
    mat.metalness = 1;
    mat.roughness = 1;
    const mesh = new Mesh(new BoxGeometry(2, 0.5, 1), mat);
    const scene = new Group();
    scene.add(mesh);

    const out = normalizeWheelsCar(scene);
    let seen: MeshStandardMaterial | null = null;
    out.traverse((n) => {
      const m = n as Mesh;
      if (m.isMesh) seen = m.material as MeshStandardMaterial;
    });
    expect(seen).not.toBeNull();
    expect(seen!.metalness).toBe(WHEELS_CAR_METALNESS);
    expect(seen!.roughness).toBe(WHEELS_CAR_ROUGHNESS);
    expect(WHEELS_CAR_METALNESS).toBe(0); // an appearance bake is a dielectric read
    expect(WHEELS_CAR_ROUGHNESS).toBeLessThan(1); // paint keeps a sheen, not a matte wrap
  });

  it('normalization itself is untouched: footprint, floor, shadows', () => {
    const mesh = new Mesh(new BoxGeometry(2, 0.5, 1), new MeshStandardMaterial());
    const scene = new Group();
    scene.add(mesh);
    const out = normalizeWheelsCar(scene);
    let seen: (Mesh & { castShadow: boolean }) | null = null;
    out.traverse((n) => { if ((n as Mesh).isMesh) seen = n as Mesh & { castShadow: boolean }; });
    expect(seen!.castShadow).toBe(true);
    out.updateMatrixWorld(true);
    const floor = new Box3().setFromObject(out);
    expect(floor.min.y).toBeCloseTo(0, 5); // the car's floor sits on y=0 after recentering
    expect(Math.max(floor.max.x - floor.min.x, floor.max.z - floor.min.z)).toBeCloseTo(1.15, 5); // WHEELS_CAR_LEN
  });
});
