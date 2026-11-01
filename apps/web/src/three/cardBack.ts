import { MeshPhysicalMaterial, MeshStandardMaterial, type Texture } from 'three';

/**
 * Card BACK material — matte print, never the face's glossy stock.
 *
 * The 2026-11-01 glare defect: backs shared the face material (clearcoat 0.35,
 * roughness 0.42), whose specular lobes integrate every overhead light into one
 * mirror streak off the tilted opponent fans — the half-vector between the key
 * spot and the south camera sits ~0.98 on the north fan's back normal, so the
 * centre backs blew out to a white slab and the printed design drowned (the
 * felt faces, near-white albedo, read fine in the same frames). Bisected live:
 * killing any single light or the backs' env IBL left the slab; clearcoat 0 +
 * roughness 0.85 restored the brown design in full. A printed card back has no
 * clear coat — these ceilings keep it that way. Faces keep their gloss via
 * createLitCardMaterial; only backs come through here.
 */
export const BACK_ROUGHNESS_HIGH = 0.85;
export const BACK_CLEARCOAT = 0;
export const BACK_ENV_INTENSITY_HIGH = 0.4;
export const BACK_ROUGHNESS_LOW = 0.78;
export const BACK_ENV_INTENSITY_LOW = 0.45;

export function createBackCardMaterial(map: Texture, quality: 'high' | 'low') {
  if (quality === 'high') {
    const m = new MeshPhysicalMaterial({
      map,
      roughness: BACK_ROUGHNESS_HIGH,
      clearcoat: BACK_CLEARCOAT,
      sheen: 0,
    });
    m.envMapIntensity = BACK_ENV_INTENSITY_HIGH;
    return m;
  }
  const m = new MeshStandardMaterial({ map, roughness: BACK_ROUGHNESS_LOW });
  m.envMapIntensity = BACK_ENV_INTENSITY_LOW;
  return m;
}
