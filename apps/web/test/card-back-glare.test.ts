import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MeshPhysicalMaterial, MeshStandardMaterial, Texture } from 'three';
import {
  BACK_CLEARCOAT,
  BACK_ENV_INTENSITY_HIGH,
  BACK_ENV_INTENSITY_LOW,
  BACK_ROUGHNESS_HIGH,
  BACK_ROUGHNESS_LOW,
  createBackCardMaterial,
} from '../src/three/cardBack';

/**
 * The 2026-11-01 card-glare defect: opponent fan backs shared the face's glossy
 * material (clearcoat 0.35, roughness 0.42) and its specular lobes mirrored the
 * table lights into a white slab that drowned the printed back design. Backs
 * are matte print — these pins keep them that way, and keep faces glossy.
 */
describe('card backs are matte print (glare fix)', () => {
  it('high back: physical material with no clearcoat, high roughness, capped env', () => {
    const m = createBackCardMaterial(new Texture(), 'high');
    expect(m).toBeInstanceOf(MeshPhysicalMaterial);
    const p = m as MeshPhysicalMaterial;
    expect(p.clearcoat).toBe(BACK_CLEARCOAT);
    expect(p.clearcoat).toBeLessThanOrEqual(0.05);
    expect(p.roughness).toBe(BACK_ROUGHNESS_HIGH);
    expect(p.roughness).toBeGreaterThanOrEqual(0.75);
    expect(p.sheen).toBe(0);
    expect(p.envMapIntensity).toBe(BACK_ENV_INTENSITY_HIGH);
    expect(p.envMapIntensity).toBeLessThanOrEqual(0.5);
  });

  it('low back: standard material, high roughness, capped env', () => {
    const m = createBackCardMaterial(new Texture(), 'low');
    expect(m).toBeInstanceOf(MeshStandardMaterial);
    expect(m).not.toBeInstanceOf(MeshPhysicalMaterial);
    expect(m.roughness).toBe(BACK_ROUGHNESS_LOW);
    expect(m.roughness).toBeGreaterThanOrEqual(0.7);
    expect(m.envMapIntensity).toBe(BACK_ENV_INTENSITY_LOW);
    expect(m.envMapIntensity).toBeLessThanOrEqual(0.5);
  });

  it('Card3D builds its back from the matte factory, never the glossy face path', () => {
    const src = readFileSync(new URL('../src/three/Card3D.tsx', import.meta.url), 'utf8');
    expect(src).toContain('createBackCardMaterial(back, quality)');
    expect(src).not.toContain('createLitCardMaterial(back');
  });

  it("Scene's program warm-up warms the matte back program, not the glossy one", () => {
    const src = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
    expect(src).toContain('const cardBack = createBackCardMaterial(white, quality);');
    expect(src).not.toContain('createLitCardMaterial(white, quality, false)');
  });

  it('faces keep their gloss (face-up rendering is untouched by the fix)', () => {
    const src = readFileSync(new URL('../src/three/Card3D.tsx', import.meta.url), 'utf8');
    expect(src).toContain('clearcoat: 0.35');
    expect(src).toContain('roughness: 0.42');
  });
});
