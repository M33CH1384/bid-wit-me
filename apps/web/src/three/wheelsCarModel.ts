/**
 * The Wheels car's body: the original Forge (three.ws) TRELLIS supercar
 * — glossy purple paint, gold stripe and rims, rear wing, no logos or
 * badges. A roadster-bodied remodel replaced it on 2026-11-04; the
 * owner sent that car away on 2026-11-08 ("let's just go back to the
 * old one" — the roadster still read blurry to him) and this body was
 * restored from git history, its bake carried at the native 2048² the
 * 2026-10-28 build had squeezed to 1024². Provenance (engine, dates)
 * is ledgered in CREDITS.md.
 *
 * One fused mesh — the wheels cannot steer or spin independently, so
 * the powerslide keeps reading from the body's yaw, slip and lean.
 * This module owns the asset URL and the ONE normalization every mount
 * applies (the table rig and the results-page stage share it): clone →
 * longest axis onto WHEELS_CAR_LEN → model yaw → recentered with its
 * floor on y = 0.
 */
import { Box3, Group, MeshStandardMaterial, Vector3 } from 'three';
import { WHEELS_CAR_LEN } from './wheelsCar3d';

export const WHEELS_CAR_URL = '/assets/cars/wheels-supercar.glb';
/** Baked from look-at renders of the raw Forge mesh: where its nose
 *  points, turned onto this scene's forward (+X). */
export const WHEELS_MODEL_YAW = Math.PI / 2;
/** Car footprint after normalization (the raw mesh's bbox proportions:
 *  0.487 wide over 0.999 long — the dims this body originally shipped
 *  with, restored with it) — the wheel points the smoke and arcs are
 *  keyed to. */
export const WHEELS_CAR_DIMS = { len: WHEELS_CAR_LEN, wid: WHEELS_CAR_LEN * (0.487 / 0.999) };

/** Display correction for the TRELLIS material. The GLB's one material
 *  declares ONLY its baseColorTexture — an appearance bake (paint,
 *  glass, wheels, gold stripe, lamps all painted in) — so the glTF defaults
 *  would instantiate it at metallicFactor 1.0 / roughnessFactor 1.0.
 *  A metal has NO diffuse response: neither render home can light it
 *  (the results stage has no environment map at all; the table's venue
 *  light is diffuse-class with at most a dim venue env), so the car
 *  played as a black silhouette — "looks like a shadow" (owner,
 *  2026-11-05; rig A/B in _wheels-shadow-work: mean luminance 17.5
 *  as-shipped vs 64.9 with only this correction, same lights).
 *  Read the bake as what it is: a dielectric paint surface with a
 *  clearcoat-style sheen. */
export const WHEELS_CAR_METALNESS = 0;
export const WHEELS_CAR_ROUGHNESS = 0.4;

/** Anisotropic-sampling cap for the car's bake — the app's GLB standard
 *  (the figures' prepareFigure raises every GLB map to the device max
 *  capped at 8, because three.js's default anisotropy of 1 smears GLB
 *  textures at grazing angles). The car is ALWAYS seen tilted or
 *  grazing, and in motion: the results stage looks down ~36° at it,
 *  the table rig sees it across the felt, and the doughnuts keep its
 *  screen-space footprint rotating — the worst case for aniso 1. It
 *  read SUPER BLURRY in its animation (owner, 2026-11-05) while every
 *  neighbouring surface sampled at 4–8. Mounts pass
 *  min(this cap, their renderer's getMaxAnisotropy()). */
export const WHEELS_CAR_ANISOTROPY_CAP = 8;

export function normalizeWheelsCar(scene: Group, maxAniso = 1): Group {
  const o = scene.clone(true) as Group;
  o.updateMatrixWorld(true);
  const box0 = new Box3().setFromObject(o);
  const size0 = box0.getSize(new Vector3());
  const longest = Math.max(size0.x, size0.z);
  if (longest > 0) o.scale.setScalar(WHEELS_CAR_LEN / longest);
  o.rotation.y = WHEELS_MODEL_YAW;
  o.updateMatrixWorld(true);
  const box = new Box3().setFromObject(o);
  const c = box.getCenter(new Vector3());
  o.position.set(-c.x, -box.min.y, -c.z);
  o.traverse((n) => {
    const mesh = n as { isMesh?: boolean; castShadow?: boolean; material?: unknown };
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    // The material correction above, applied here because this
    // normalization is the ONE pass both mounts (table rig, results
    // stage) share. The GLB's materials are shared with the loader
    // cache across mounts, so the assignment is idempotent.
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (m instanceof MeshStandardMaterial) {
        m.metalness = WHEELS_CAR_METALNESS;
        m.roughness = WHEELS_CAR_ROUGHNESS;
        // The sampling raise above, at the same shared point: the
        // bake's texture is shared with the loader cache across
        // mounts, so the assignment is idempotent, and needsUpdate
        // makes an already-uploaded texture re-upload at the new cap.
        if (maxAniso > 1) {
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'] as const) {
            const tex = m[key];
            if (tex && tex.anisotropy !== maxAniso) {
              tex.anisotropy = maxAniso;
              tex.needsUpdate = true;
            }
          }
        }
      }
    }
  });
  return o;
}
