/**
 * Stand-in chairs (owner, 2026-11-13: "my opponents don't have chairs"; "We need to make sure All venues
 * have chairs").
 *
 * Most rooms build their chairs in code, so they are always there. A few load the chair MODEL instead
 * (the Classic Studio, the dressing for every rendered room, the old Barbershop shell, the King's
 * lounge), and the seated figures do not wait for it — on a phone it can land late or not at all, and
 * the figures sat on air. Every one of those rooms now goes through chairStandIns: if the model is not
 * in by CHAIR_STAND_IN_MS, or its load fails, plain built chairs stand at the seats until (and unless)
 * the model arrives.
 */
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';

/** How long the seated figures may go without the chair model before built chairs stand in (ms). */
export const CHAIR_STAND_IN_MS = 2500;
/** Seat height of the built chair above the floor: the fleet standard the seated figures are posed to. */
export const SIMPLE_CHAIR_SEAT = 0.49;
/** Triangles in one built chair (seven boxes). */
export const SIMPLE_CHAIR_TRIS = 7 * 12;

/**
 * A plain dining chair out of seven boxes — seat, back, back rail and four legs — facing +z like the
 * chair model, feet on y = 0. It stands in wherever the model is not loaded (Low quality, or a failed
 * load), so a seated figure always has something under it.
 */
export function buildSimpleChair(): Group {
  const g = new Group();
  g.name = 'simple-chair';
  const wood = new MeshStandardMaterial({ color: '#2a1a12', roughness: 0.7 });
  const pad = new MeshStandardMaterial({ color: '#3b2a44', roughness: 0.85 });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: MeshStandardMaterial) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
  };
  const S = SIMPLE_CHAIR_SEAT;
  box(0.5, 0.07, 0.5, 0, S - 0.035, 0, pad); // seat, top at S
  box(0.5, 0.42, 0.06, 0, S + 0.33, -0.24, pad); // back pad
  box(0.54, 0.06, 0.07, 0, S + 0.57, -0.24, wood); // top rail
  for (const [x, z] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]] as const) {
    const tall = z < 0; // rear legs run up into the back
    const h = tall ? S + 0.56 : S - 0.07;
    box(0.05, h, 0.05, x, h / 2, z, wood);
  }
  return g;
}



function disposeSimpleChair(g: Group): void {
  const mats = new Set<MeshStandardMaterial>();
  g.traverse((o) => { const m = o as Mesh; if (m.isMesh) { m.geometry.dispose(); mats.add(m.material as MeshStandardMaterial); } });
  mats.forEach((m) => m.dispose());
}

export interface ChairStandIns {
  /** The chair model is in: any stand-ins step aside. Call just before adding the model chairs. */
  arrived(): void;
  /** The model's load failed: stand the built chairs in now. */
  failed(): void;
  /** Unmount: drop the timer and any stand-ins. */
  dispose(): void;
}

/**
 * Watches one room's chair-model load. `spots` are the seats that should have a chair (the caller has
 * already left out the viewer's own), `floorY` the floor they stand on, in the host group's space.
 */
export function chairStandIns(host: () => Group | null, spots: readonly { x: number; z: number; ry: number }[], floorY: number, invalidate: () => void): ChairStandIns {
  const up: Group[] = [];
  let done = false;
  const clear = () => { for (const g of up) { g.parent?.remove(g); disposeSimpleChair(g); } up.length = 0; };
  const stand = () => {
    const h = host();
    if (done || !h || up.length) return;
    for (const spot of spots) {
      const c = buildSimpleChair();
      c.rotation.y = spot.ry; c.position.set(spot.x, floorY, spot.z);
      h.add(c); up.push(c);
    }
    invalidate();
  };
  const timer = setTimeout(stand, CHAIR_STAND_IN_MS);
  return {
    arrived() { done = true; clearTimeout(timer); clear(); },
    failed() { clearTimeout(timer); stand(); },
    dispose() { done = true; clearTimeout(timer); clear(); },
  };
}
