import { Euler, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';

/** Card size in world units (poker ratio 2.5 × 3.5) and exaggerated stock thickness so the edge reads in 3D. */
export const CW = 0.25;
export const CH = 0.35;
export const CT = 0.004;
export const CR = 0.022;

/** Felt half-extents and rail width. */
export const FELT = { hx: 1.5, hz: 1.78, r: 0.95 };
export const RAIL = 0.2;

export type SeatPos = 'bottom' | 'left' | 'top' | 'right';

export interface Xform {
  p: [number, number, number];
  q: [number, number, number, number];
  s: number;
}

export function xf(p: [number, number, number], e: [number, number, number], s = 1, order: 'YXZ' | 'XYZ' = 'YXZ'): Xform {
  const q = new Quaternion().setFromEuler(new Euler(e[0], e[1], e[2], order));
  return { p, q: [q.x, q.y, q.z, q.w], s };
}

/** Where each seat "is" on the table (unit direction from the centre) for 4 or 3 players. */
export function seatDir(pos: SeatPos, n: number): Vector3 {
  if (n === 3 && pos === 'left') return new Vector3(-0.86, 0, -0.5).normalize();
  if (n === 3 && pos === 'right') return new Vector3(0.86, 0, -0.5).normalize();
  switch (pos) {
    case 'bottom': return new Vector3(0, 0, 1);
    case 'top': return new Vector3(0, 0, -1);
    case 'left': return new Vector3(-1, 0, 0);
    case 'right': return new Vector3(1, 0, 0);
  }
}

/** Point on the felt edge (just inside the rail) in direction d. */
export function edgePoint(d: Vector3, inset = 0): Vector3 {
  // approximate the rounded rectangle with a superellipse-ish clamp
  const sx = (FELT.hx - inset) / Math.max(Math.abs(d.x), 1e-6);
  const sz = (FELT.hz - inset) / Math.max(Math.abs(d.z), 1e-6);
  const s = Math.min(sx, sz);
  const p = d.clone().multiplyScalar(s);
  // pull diagonal points in for the rounded corners
  const diag = Math.abs(d.x) > 0.2 && Math.abs(d.z) > 0.2;
  return diag ? p.multiplyScalar(0.86) : p;
}

const yawOf = (d: Vector3) => Math.atan2(d.x, d.z);

/** Opponent's held fan: upright cards near the rail, backs toward the table centre. */
export function opponentFan(pos: SeatPos, n: number, i: number, count: number): Xform {
  const d = seatDir(pos, n);
  const base = edgePoint(d, 0.05).add(new Vector3(0, 0.3, 0)).add(d.clone().multiplyScalar(0.12));
  const yaw = yawOf(d);
  const off = i - (count - 1) / 2;
  const spread = 0.038;
  const tangent = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)); // local +x of a card facing outward
  const p = base.clone().add(tangent.multiplyScalar(off * spread)).add(new Vector3(0, -Math.abs(off) * off * 0 - off * off * 0.0016, 0)).add(d.clone().multiplyScalar(i * 0.0016));
  // face toward the owner (outward), tilted back, fanned by roll
  return xf([p.x, p.y, p.z], [0.55, yaw, -off * 0.075], 1);
}

/** Card's spot in the middle of the table when played by this seat. */
export function trickSpot(pos: SeatPos, n: number, order: number, jitter: number): Xform {
  const d = seatDir(pos, n);
  const p = d.clone().multiplyScalar(0.36);
  return xf([p.x, 0.012 + order * 0.006, p.z * 1.05], [-Math.PI / 2, yawOf(d) * 0.25 + jitter * 0.35, 0], 1.3);
}

/** Won-trick pile in front of a seat: tricks laid in an overlapping row, face down. */
export function pileSpot(pos: SeatPos, n: number, trickIdx: number, cardIdx: number, jitter: number): Xform {
  const d = seatDir(pos, n);
  let base: Vector3;
  let along: Vector3;
  if (pos === 'bottom') { base = new Vector3(0.55, 0, 1.12); along = new Vector3(0.075, 0, 0); }
  else if (pos === 'top') { base = new Vector3(-0.55, 0, -1.2); along = new Vector3(-0.075, 0, 0); }
  else { base = edgePoint(d, 0.32).add(new Vector3(0, 0, 0.45)); along = new Vector3(0, 0, 0.07); }
  const p = base.add(along.multiplyScalar(trickIdx));
  const yaw = pos === 'left' || pos === 'right' ? Math.PI / 2 : 0;
  return xf([p.x + jitter * 0.008, 0.006 + (trickIdx * 4 + cardIdx) * 0.0045, p.z], [Math.PI / 2, yaw + jitter * 0.06, 0], 0.92);
}

/** Dealer's deck spot (cards fly from here when dealing). */
export function deckSpot(pos: SeatPos, n: number): Xform {
  const d = seatDir(pos, n);
  const p = edgePoint(d, 0.45);
  return xf([p.x, 0.02, p.z], [Math.PI / 2, yawOf(d), 0], 1);
}

/** Turn-ring location on the felt. */
export function ringSpot(pos: SeatPos, n: number): Vector3 {
  return edgePoint(seatDir(pos, n), 0.36);
}

/** Seat badge anchor (above the opponent's cards). */
export function badgeSpot(pos: SeatPos, n: number): [number, number, number] {
  const d = seatDir(pos, n);
  const p = edgePoint(d, 0).add(d.clone().multiplyScalar(0.12));
  if (pos === 'left' || pos === 'right') return [p.x * 0.78, 0.62, p.z - 0.55];
  return [p.x, 0.72, p.z];
}

/* ------------------------------------------------------------- camera */

export interface CamSpec { pos: [number, number, number]; look: [number, number, number]; fov: number }

/** Camera from the human seat looking across the table; framing adapts to portrait/landscape. */
export function cameraFor(aspect: number): CamSpec {
  const t = Math.min(1, Math.max(0, (aspect - 0.5) / (1.6 - 0.5))); // 0 = tall phone, 1 = wide desktop
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const pos: [number, number, number] = [0, lerp(4.7, 3.55), lerp(3.9, 3.55)];
  const look: [number, number, number] = [0, 0, lerp(0.38, 0.32)];
  const dist = Math.hypot(pos[1] - look[1], pos[2] - look[2]);
  // fit the table width (with rail) horizontally, and keep at least a minimum vertical fov
  const halfW = FELT.hx + RAIL + lerp(0.22, 0.25);
  const vFit = 2 * Math.atan(Math.tan(Math.atan(halfW / dist)) / aspect) * (180 / Math.PI);
  const fov = Math.min(80, Math.max(lerp(62, 46), vFit));
  return { pos, look, fov };
}

export function makeCamera(aspect: number): PerspectiveCamera {
  const s = cameraFor(aspect);
  const cam = new PerspectiveCamera(s.fov, aspect, 0.05, 60);
  cam.position.set(...s.pos);
  cam.lookAt(new Vector3(...s.look));
  cam.updateMatrixWorld(true);
  return cam;
}

/** The human hand, fanned in camera space at the bottom of the view, converted to world transforms. */
export function handFan(aspect: number, count: number, i: number, lift: number): Xform {
  const cam = makeCamera(aspect);
  const D = 1;
  const viewH = 2 * Math.tan((cam.fov * Math.PI) / 360) * D;
  const viewW = viewH * aspect;
  const ch = Math.min(viewH * 0.16, viewW * 0.25 * 1.4);
  const s = ch / CH;
  const cw = CW * s;
  const step = count > 1 ? Math.min(cw * 0.62, (viewW * 0.88 - cw) / (count - 1)) : 0;
  const off = i - (count - 1) / 2;
  const x = off * step;
  const curve = (x * x) / (viewW * 1.6);
  const y = -viewH / 2 + ch * 0.62 + viewH * 0.02 - curve + lift * ch;
  const local = new Matrix4().compose(
    new Vector3(x, y, -D + i * 0.0025),
    new Quaternion().setFromEuler(new Euler(-0.18, 0, -x * 0.55, 'XYZ')),
    new Vector3(s, s, s),
  );
  const world = cam.matrixWorld.clone().multiply(local);
  const p = new Vector3(), q = new Quaternion(), sc = new Vector3();
  world.decompose(p, q, sc);
  return { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], s: sc.x };
}

/** Deterministic small jitter in [-1, 1] from a string. */
export function jitterOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) / 2 ** 32) * 2 - 1;
}
