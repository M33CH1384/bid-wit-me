/**
 * The Wheels car's body: a Forge (three.ws) TRELLIS generation in the new
 * EV roadster's shape — low wedge nose with no grille, full-width light
 * bars, flush glass canopy, turbine wheels, deep prototype red, no logos
 * or badges (shape homage only). Remodelled 2026-11-04 on the owner's
 * word; provenance (creation id, engine, date) is ledgered in CREDITS.md.
 *
 * One fused mesh, like the supercar before it — the wheels cannot steer
 * or spin independently, so the powerslide keeps reading from the body's
 * yaw, slip and lean. This module owns the asset URL and the ONE
 * normalization every mount applies (the table rig and the results-page
 * stage share it): clone → longest axis onto WHEELS_CAR_LEN → model yaw
 * → recentered with its floor on y = 0.
 */
import { Box3, Group, Vector3 } from 'three';
import { WHEELS_CAR_LEN } from './wheelsCar3d';

export const WHEELS_CAR_URL = '/assets/cars/wheels-roadster.glb';
/** Baked from look-at renders of the raw Forge mesh: where its nose
 *  points, turned onto this scene's forward (+X). */
export const WHEELS_MODEL_YAW = Math.PI / 2;
/** Car footprint after normalization (the raw mesh's bbox proportions:
 *  0.4616 wide over 0.9997 long) — the wheel points the smoke and arcs
 *  are keyed to. */
export const WHEELS_CAR_DIMS = { len: WHEELS_CAR_LEN, wid: WHEELS_CAR_LEN * (0.4616 / 0.9997) };

export function normalizeWheelsCar(scene: Group): Group {
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
    const mesh = n as { isMesh?: boolean; castShadow?: boolean };
    if (mesh.isMesh) mesh.castShadow = true;
  });
  return o;
}
