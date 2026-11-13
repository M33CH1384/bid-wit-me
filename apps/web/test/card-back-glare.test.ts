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
import {
  FACE_REST_CLEARCOAT,
  FACE_REST_ENV_INTENSITY_HIGH,
  FACE_REST_ENV_INTENSITY_LOW,
  FACE_REST_ROUGHNESS_HIGH,
  FACE_REST_ROUGHNESS_LOW,
  FACE_HELD_CLEARCOAT,
  FACE_HELD_ENV_INTENSITY_HIGH,
  FACE_HELD_ROUGHNESS_HIGH,
  createLitCardMaterial,
  createRestCardMaterial,
} from '../src/three/Card3D';

/**
 * The card-glare defect, two reports from the owner on 2026-11-01:
 * (1) opponent fan BACKS shared the face's glossy material (clearcoat 0.35,
 *     roughness 0.42) and its specular lobes mirrored the table lights into a
 *     white slab that drowned the printed back design;
 * (2) a played card's FACE, lying flat on the felt in the trick, bleached the
 *     same way — the partner's A♥ at Grandma's Kitchen read almost blank from
 *     the sitting seat and only cleared up when he stood (the angle change
 *     breaks the mirror path).
 * Backs and played faces are matte print lying/tilted under the lights; held
 * cards keep their gloss. These pins keep the three finishes apart.
 */
describe('card backs are matte print (glare fix, round 1)', () => {
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
});

describe('played faces take the matte rest finish (glare fix, round 2)', () => {
  it('high rest face: physical material with no clearcoat, high roughness, no sheen, capped env', () => {
    const m = createRestCardMaterial(new Texture(), 'high');
    expect(m).toBeInstanceOf(MeshPhysicalMaterial);
    const p = m as MeshPhysicalMaterial;
    expect(p.clearcoat).toBe(FACE_REST_CLEARCOAT);
    expect(p.clearcoat).toBeLessThanOrEqual(0.05);
    expect(p.roughness).toBe(FACE_REST_ROUGHNESS_HIGH);
    expect(p.roughness).toBeGreaterThanOrEqual(0.75);
    expect(p.sheen).toBe(0);
    expect(p.envMapIntensity).toBe(FACE_REST_ENV_INTENSITY_HIGH);
    expect(p.envMapIntensity).toBeLessThanOrEqual(0.5);
  });

  it('low rest face: standard material, high roughness, capped env', () => {
    const m = createRestCardMaterial(new Texture(), 'low');
    expect(m).toBeInstanceOf(MeshStandardMaterial);
    expect(m).not.toBeInstanceOf(MeshPhysicalMaterial);
    expect(m.roughness).toBe(FACE_REST_ROUGHNESS_LOW);
    expect(m.roughness).toBeGreaterThanOrEqual(0.7);
    expect(m.envMapIntensity).toBe(FACE_REST_ENV_INTENSITY_LOW);
    expect(m.envMapIntensity).toBeLessThanOrEqual(0.5);
  });

  it('rest face keeps the face saturation patch and carries the rest flag', () => {
    const m = createRestCardMaterial(new Texture(), 'high');
    const ud = m.userData as { sat?: { value: number }; restFace?: boolean };
    expect(ud.sat?.value).toBe(1);
    expect(ud.restFace).toBe(true);
  });

  it('Card3D picks the rest factory only for restFace cards; held cards take the lit (satin) path', () => {
    const src = readFileSync(new URL('../src/three/Card3D.tsx', import.meta.url), 'utf8');
    expect(src).toContain('restFace ? createRestCardMaterial(map, quality) : createLitCardMaterial(map, quality, true)');
  });

  // 2026-11-13 (owner: "if i tilt my hand enough the glare washes out the cards", standing and
  // sitting): the held face lost its clear coat and sheen. These two replace the pins that kept the
  // gloss stock — a mirror coat on a fan the camera now leans around is what bleached the hand.
  it('held faces are satin: no clear coat, no sheen, rough enough that no angle wipes the print', () => {
    const m = createLitCardMaterial(new Texture(), 'high', true) as MeshPhysicalMaterial;
    expect(m.clearcoat).toBe(FACE_HELD_CLEARCOAT);
    expect(FACE_HELD_CLEARCOAT).toBe(0);
    expect(m.sheen).toBe(0);
    expect(m.roughness).toBe(FACE_HELD_ROUGHNESS_HIGH);
    expect(FACE_HELD_ROUGHNESS_HIGH).toBeGreaterThanOrEqual(0.65);
    expect(m.envMapIntensity).toBe(FACE_HELD_ENV_INTENSITY_HIGH);
    expect(FACE_HELD_ENV_INTENSITY_HIGH).toBeLessThanOrEqual(0.6);
    const low = createLitCardMaterial(new Texture(), 'low', true) as MeshStandardMaterial;
    expect(low.roughness).toBeGreaterThanOrEqual(0.65);
    expect(low.envMapIntensity).toBeLessThanOrEqual(0.6);
  });

  it('a held face stays a little livelier than a card lying on the felt, and nothing re-glosses it', () => {
    expect(FACE_HELD_ROUGHNESS_HIGH).toBeLessThan(FACE_REST_ROUGHNESS_HIGH);
    expect(FACE_HELD_ENV_INTENSITY_HIGH).toBeGreaterThan(FACE_REST_ENV_INTENSITY_HIGH);
    const src = readFileSync(new URL('../src/three/Card3D.tsx', import.meta.url), 'utf8');
    expect(src).not.toMatch(/frontMat\.clearcoat = /);
    expect(src).not.toMatch(/clearcoat: 0\.35/);
  });

  it('Scene deals the rest finish to played (public) cards only', () => {
    const src = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
    expect(src).toContain('restFace={!!it.public}');
  });

  it("Scene's program warm-up warms the rest-face program alongside the gloss one", () => {
    const src = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
    expect(src).toContain('const cardRest = createRestCardMaterial(white, quality);');
  });
});
