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
  const side = pos === 'left' || pos === 'right';
  const base = edgePoint(d, side ? 0.3 : 0.05).add(new Vector3(0, 0.3, 0)).add(d.clone().multiplyScalar(0.12));
  const yaw = yawOf(d);
  const off = i - (count - 1) / 2;
  const spread = 0.038;
  const tangent = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)); // local +x of a card facing outward
  const p = base.clone().add(tangent.multiplyScalar(off * spread)).add(new Vector3(0, -Math.abs(off) * off * 0 - off * off * 0.0016, 0)).add(d.clone().multiplyScalar(i * 0.0016));
  // face toward the owner (outward), tilted back, fanned by roll
  return xf([p.x, p.y, p.z], [0.55, yaw, -off * 0.075], 1);
}

/** Trick-card scale: big enough that rank + suit read clearly on a phone. */
export const TRICK_SCALE = 2.3;
const TRICK_LEAN = 0.38; // tilt toward the camera so the faces aren't foreshortened

/**
 * Card's spot in the middle of the table when played by this seat: a non-overlapping "plus" layout
 * (each card toward its player), face up, almost square to the table edge, leaned up toward the camera.
 */
export function trickSpot(pos: SeatPos, n: number, order: number, jitter: number, scale = TRICK_SCALE): Xform {
  const d = seatDir(pos, n);
  const w = CW * scale, h = CH * scale;
  // non-overlapping plus: top/bottom stacked by card height, sides beside them by a full card width,
  // so every card's corner index stays visible whatever the play order
  const off = Math.abs(d.x) > 0.5
    ? new Vector3(Math.sign(d.x) * (w + 0.06), 0, 0.02)
    : new Vector3(0, 0, Math.sign(d.z) * (h / 2 + 0.05 + h * Math.sin(TRICK_LEAN) * 0.42)); // the lean lifts the near card's top edge toward the far one
  if (n === 3 && pos !== 'bottom') off.set(Math.sign(d.x) * (w / 2 + 0.04), 0, -(h / 2 + 0.01));
  const lift = 0.02 + order * 0.004 + (h / 2) * Math.sin(TRICK_LEAN);
  return xf([off.x, lift, off.z + 0.04], [-Math.PI / 2 + TRICK_LEAN, jitter * 0.05, 0], scale, 'XYZ');
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
  // top seat: plate beside (right of) the fan so it never hides under the HUD strips
  return [p.x + 0.42, 0.42, p.z];
}

/* ------------------------------------------------------------- camera */

export interface CamSpec { pos: [number, number, number]; look: [number, number, number]; fov: number }

/** Camera from the human seat looking across the table; framing adapts to portrait/landscape. */
export function cameraFor(aspect: number, short = false): CamSpec {
  if (short) return shortLandscapeCamera(aspect);
  const t = Math.min(1, Math.max(0, (aspect - 0.5) / (1.6 - 0.5))); // 0 = tall phone, 1 = wide desktop
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const pos: [number, number, number] = [0, lerp(4.5, 3.45), lerp(3.75, 3.4)];
  const look: [number, number, number] = [0, 0, lerp(0.38, 0.08)];
  const dist = Math.hypot(pos[1] - look[1], pos[2] - look[2]);
  // fit the table width (with rail) horizontally, and keep at least a minimum vertical fov
  const halfW = FELT.hx + RAIL + lerp(-0.08, 0.1);
  const vFit = 2 * Math.atan(Math.tan(Math.atan(halfW / dist)) / aspect) * (180 / Math.PI);
  const fov = Math.min(80, Math.max(lerp(56, 45.5), vFit));
  return { pos, look, fov };
}

/**
 * Phone landscape: little height, lots of width. A lower, more frontal camera (less foreshortening of the far half)
 * framed so the felt fills the height between the one-line scorebug and the hand, leaving the sides for name plates.
 */
function shortLandscapeCamera(aspect: number): CamSpec {
  void aspect;
  return { pos: [0, 3.1, 3.5], look: [0, 0, 0.22], fov: 42 };
}

export function makeCamera(aspect: number, short = false): PerspectiveCamera {
  const s = cameraFor(aspect, short);
  const cam = new PerspectiveCamera(s.fov, aspect, 0.05, 60);
  cam.position.set(...s.pos);
  cam.lookAt(new Vector3(...s.look));
  cam.updateMatrixWorld(true);
  return cam;
}

export interface FanLayout { s: number; cw: number; ch: number; step: number; maxRoll: number; curveK: number; viewW: number; viewH: number }

/**
 * Solve the human fan so it always fits the camera frustum width at the hand's depth (D = 1 in camera space):
 * the outermost cards — including their roll, the perspective growth from the tilt and a lifted card — stay inside
 * the view with `margin` on both sides (margin = max(6% of width, iOS safe-area inset)). Card scale shrinks only
 * when even a tight overlap (rank index still visible) can't fit.
 */
export interface FanOpts {
  /** Fraction of the width kept clear on each side (e.g. for the HUD corners in landscape). */
  reserveFrac?: number;
  /** Fraction of the height kept clear at the bottom (iOS home indicator). */
  bottomFrac?: number;
  /** Target card height as a fraction of the view height. */
  heightFrac?: number;
  short?: boolean;
}

export function fanLayout(aspect: number, count: number, safeFrac = 0, o: FanOpts = {}): FanLayout {
  const cam = makeCamera(aspect, o.short);
  const D = 1;
  const viewH = 2 * Math.tan((cam.fov * Math.PI) / 360) * D;
  const viewW = viewH * aspect;
  const margin = viewW * Math.max(0.06, safeFrac + 0.025, o.reserveFrac ?? 0);
  const halfAvail = viewW / 2 - margin;
  const persp = 1.0; // cards are parallel to the image plane → no perspective growth
  const halfN = Math.max(0, (count - 1) / 2);
  const maxRoll = count > 1 ? Math.min(0.32, 0.03 * count) : 0;
  let s = Math.min(viewH * (o.heightFrac ?? 0.16), viewW * 0.25 * 1.4) / CH;
  let step = 0;
  for (let k = 0; k < 40; k++) {
    const cw = CW * s, ch = CH * s;
    const outer = (cw / 2) * Math.cos(maxRoll) + (ch / 2) * Math.sin(maxRoll); // half-extent of a rolled card
    const room = halfAvail / persp - outer;
    step = halfN > 0 ? Math.min(cw * 0.62, room / halfN) : 0;
    if (halfN === 0 ? room >= 0 : step >= cw * 0.3) break; // ≥30% of a card exposed keeps the corner index readable
    s *= 0.96;
  }
  return { s, cw: CW * s, ch: CH * s, step: Math.max(0, step), maxRoll, curveK: 1 / (viewW * 1.6), viewW, viewH };
}

/**
 * The human hand, laid out in *screen space*: every card sits on a plane parallel to the image plane (no tilt), so
 * perspective projects it as an exact, undistorted copy. Cards are stacked a hair nearer the camera left→right for a
 * stable z-order (each card on top of the one to its left), and both position and scale are multiplied by that depth
 * so every card projects at exactly the same size and spacing — a perfectly symmetric fan. Only the lifted card moves.
 */
export function handFan(aspect: number, count: number, i: number, lift: number, safeFrac = 0, o: FanOpts = {}): Xform {
  const cam = makeCamera(aspect, o.short);
  const L = fanLayout(aspect, count, safeFrac, o);
  const halfN = (count - 1) / 2;
  const off = i - halfN;
  const x = off * L.step;
  const roll = halfN > 0 ? -(off / halfN) * L.maxRoll : 0;
  const curve = x * x * L.curveK;
  // the outermost (most rolled, most curved-down) card's lowest corner sits exactly on the bottom margin
  const xo = halfN * L.step;
  const lowest = xo * xo * L.curveK + (L.ch / 2) * Math.cos(L.maxRoll) + (L.cw / 2) * Math.sin(L.maxRoll);
  const y = -L.viewH / 2 + L.viewH * (0.015 + (o.bottomFrac ?? 0)) + lowest - curve + lift * L.ch;
  const depth = 1 - (i + 1) * 0.0015 - (lift > 0.2 ? 0.01 : 0); // z-order only; projection is depth-compensated
  const local = new Matrix4().compose(
    new Vector3(x * depth, y * depth, -depth),
    new Quaternion().setFromEuler(new Euler(0, 0, roll, 'XYZ')),
    new Vector3(L.s * depth, L.s * depth, L.s * depth),
  );
  const world = cam.matrixWorld.clone().multiply(local);
  const p = new Vector3(), q = new Quaternion(), sc = new Vector3();
  world.decompose(p, q, sc);
  return { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], s: sc.x };
}

/** Screen-space (NDC) corner positions of a card transform (for symmetry/fit tests). */
export function ndcCorners(aspect: number, t: Xform): [number, number][] {
  const cam = makeCamera(aspect);
  cam.updateProjectionMatrix();
  const m = new Matrix4().compose(new Vector3(...t.p), new Quaternion(...t.q), new Vector3(t.s, t.s, t.s));
  return ([[-CW / 2, -CH / 2], [CW / 2, -CH / 2], [CW / 2, CH / 2], [-CW / 2, CH / 2]] as const).map(([cx, cy]) => {
    const v = new Vector3(cx, cy, 0).applyMatrix4(m).project(cam);
    return [v.x, v.y];
  });
}

/** Screen-space (NDC) x-extent of a set of card transforms, for fit checks in tests. */
export function ndcExtentX(aspect: number, xs: Xform[]): [number, number] {
  const cam = makeCamera(aspect);
  cam.updateProjectionMatrix();
  let lo = Infinity, hi = -Infinity;
  for (const t of xs) {
    const m = new Matrix4().compose(new Vector3(...t.p), new Quaternion(...t.q), new Vector3(t.s, t.s, t.s));
    for (const [cx, cy] of [[-CW / 2, -CH / 2], [CW / 2, -CH / 2], [-CW / 2, CH / 2], [CW / 2, CH / 2]] as const) {
      const v = new Vector3(cx, cy, 0).applyMatrix4(m).project(cam);
      lo = Math.min(lo, v.x); hi = Math.max(hi, v.x);
    }
  }
  return [lo, hi];
}

/** Deterministic small jitter in [-1, 1] from a string. */
export function jitterOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) / 2 ** 32) * 2 - 1;
}
