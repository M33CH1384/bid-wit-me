import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { normalizeWheelsCar, WHEELS_CAR_ANISOTROPY_CAP } from '../src/three/wheelsCarModel';

// The Wheels car read SUPER BLURRY in its animation (owner,
// 2026-11-05) even after the shadow fix (771e5156) lit it: two
// sampling layers the car never got, both already convicted elsewhere
// in this app —
//  1. its texture was squeezed at build: the Forge source bake is
//     2048², the shipped GLB carried 1024² (the exact "2048²
//     photographic texture squeezed into 96–208 KB" pattern the
//     figures program cured on 2026-10-29 by re-encoding at q95);
//  2. its map kept three.js's default anisotropy of 1, while every
//     other GLB in the app (the figures' prepareFigure) is raised to
//     the device max capped at 8 BECAUSE aniso-1 GLB textures smear at
//     grazing angles — and the car is always seen tilted or grazing,
//     in motion.
// Both cures were first applied to the roadster body (2026-11-05);
// when the owner restored the original supercar on 2026-11-08, its
// own 2026-10-28 build had been squeezed the same way (1024² in
// 64 KB), so the restored GLB carries the same native-2048² bake and
// these pins now guard this body. These pins hold both cures at the
// shared points: the asset itself, and normalizeWheelsCar, the ONE
// pass both mounts share.
describe('wheels car sharpness — full-res bake, anisotropic sampling', () => {
  it('the shipped GLB carries the bake at its native 2048²', () => {
    const buf = readFileSync(new URL('../public/assets/cars/wheels-supercar.glb', import.meta.url));
    const jsonLen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
      images: { bufferView: number }[];
      bufferViews: { byteOffset?: number; byteLength: number }[];
    };
    const binOff = 20 + jsonLen + 8;
    const bv = json.bufferViews[json.images[0]!.bufferView]!;
    const img = buf.subarray(binOff + (bv.byteOffset ?? 0), binOff + (bv.byteOffset ?? 0) + bv.byteLength);
    expect(img.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(img.subarray(8, 12).toString('ascii')).toBe('WEBP');
    const fourcc = img.subarray(12, 16).toString('ascii');
    let w = 0;
    let h = 0;
    if (fourcc === 'VP8X') {
      w = img.readUIntLE(24, 3) + 1;
      h = img.readUIntLE(27, 3) + 1;
    } else if (fourcc === 'VP8 ') {
      w = img.readUInt16LE(26) & 0x3fff;
      h = img.readUInt16LE(28) & 0x3fff;
    } else if (fourcc === 'VP8L') {
      const bits = img.readUInt32LE(21);
      w = (bits & 0x3fff) + 1;
      h = ((bits >> 14) & 0x3fff) + 1;
    }
    expect([w, h]).toEqual([2048, 2048]);
  });

  it('normalizeWheelsCar raises the car map to the mount-supplied anisotropy cap', () => {
    const mat = new MeshStandardMaterial();
    const tex = new Texture();
    tex.anisotropy = 1; // three.js's GLB default — the smear
    mat.map = tex;
    const mesh = new Mesh(new BoxGeometry(2, 0.5, 1), mat);
    const scene = new Group();
    scene.add(mesh);
    const versionBefore = tex.version;

    const out = normalizeWheelsCar(scene, 8);
    let seen: MeshStandardMaterial | null = null;
    out.traverse((n) => { if ((n as Mesh).isMesh) seen = (n as Mesh).material as MeshStandardMaterial; });
    expect(seen).not.toBeNull();
    expect(seen!.map!.anisotropy).toBe(8);
    // needsUpdate is setter-only in three; its observable effect is the
    // version bump that makes the renderer re-upload at the new cap.
    expect(tex.version).toBeGreaterThan(versionBefore);
  });

  it('the anisotropy cap constant is the app GLB standard (8), and no cap means no raise', () => {
    expect(WHEELS_CAR_ANISOTROPY_CAP).toBe(8);
    const mat = new MeshStandardMaterial();
    const tex = new Texture();
    tex.anisotropy = 1;
    mat.map = tex;
    const scene = new Group();
    scene.add(new Mesh(new BoxGeometry(2, 0.5, 1), mat));
    normalizeWheelsCar(scene);
    expect(tex.anisotropy).toBe(1); // a mount that cannot name a cap keeps today's behaviour
  });

  it('both mounts pass their renderer cap into the normalization', () => {
    for (const f of ['../src/three/WheelsCar3D.tsx', '../src/three/WheelsStage3D.tsx']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src).toContain('WHEELS_CAR_ANISOTROPY_CAP');
      expect(src).toContain('getMaxAnisotropy()');
      expect(src).toMatch(/normalizeWheelsCar\(gltf\.scene,\s*Math\.min\(WHEELS_CAR_ANISOTROPY_CAP/);
    }
  });
});
