/**
 * The Wheels car in WORLD space — the 3D rebuild (owner verdict on the 2D sprite
 * show, 2026-10-28: "That car animation looks terrible honestly" → "Rebuild it as a
 * real 3D car"). The glossy purple-and-gold supercar is now a real GLB body in the
 * three.js scene (WheelsCar3D.tsx): it drives onto the felt, lays its ~1¾ doughnuts
 * around the trick centre as a 3D body — yaw on the circle, nose slipped toward the
 * centre in a powerslide read, body leaning into the turn — trailing tyre smoke from
 * its rear wheels and dark arcs on the felt, then peels off the right edge. Same
 * `wheelsCar` summons (a side taking all 10 books), same 2.5 s window, same
 * rev-then-peel audio; only the render and the driving changed.
 *
 * And the nuke still shows no favourites: if a nuke/mega detonates while the car is
 * on the table, the blast takes it in 3D too — radial launch + tumble on the cards'
 * own profile (mirroring pjsSedanBlast), mega farther with the second detonation's
 * re-kick. In the 'off' nuke mode there is no visual sweep anywhere, so there is
 * none for the car either; under OS reduce-motion the car is flung without the
 * tumble and is gone sooner. (The gate itself stays entry-side in wheelsDonuts.ts —
 * this module lives in the three chunk and must not be imported from entry code.)
 *
 * Everything here is a pure function of time so the show can be seeked by capture
 * scripts and unit-tested without a renderer.
 *
 * Conventions: the felt surface is y = 0, the table centre is the origin, the human
 * sits at +Z. A pose's `yaw` is the outer group's rotation.y with the car's nose
 * along local +X: forward = (cos yaw, 0, −sin yaw). `roll`/`pitch` ride an inner
 * group whose local +X is the car's forward: roll = rotation.x (lean around the
 * forward axis), pitch = rotation.z (nose up/down around the lateral axis).
 */
import { FELT } from './layout';

/** The show's length — the DOM celebration's CAR_MS, unchanged by the rebuild. */
export const WHEELS3D_SHOW_S = 2.5;
/** Driving onto the felt, under the revs. */
export const WHEELS3D_ENTER_S = 0.62;
/** Doughnuts end; the peel-off begins. */
export const WHEELS3D_DONUT_END_S = 2.07;
export const WHEELS3D_DONUT_TURNS = 1.75;
/** Seconds from the fx detonation event to the flash — the sweep lands on the flash.
 *  Mirrors NUKE_FLASH_S in nukeVisual.ts (and BLAST_FLASH_S entry-side). */
export const WHEELS3D_FLASH_S = 0.3;
/** Mega's second detonation, seconds after the flash (MEGA_STAGE2_S 1.45 − flash 0.3, rounded). */
const MEGA_REKICK_U = 1.15;

/** The doughnut ellipse: centred on the trick, sized so the whole car stays on the
 *  felt (car half-length + radius < FELT.hx on the tight side). */
export const DONUT = { cx: 0, cz: -0.15, rx: 0.58, rz: 0.5 } as const;
/** The car's table scale: overall length in world units (≈4½ card lengths — a big
 *  RC-scale supercar on the felt, the same read the 2D sprite had at 36vw). */
export const WHEELS_CAR_LEN = 1.15;
/** Powerslide slip at full doughnut: the nose sits this far (rad) inside the tangent. */
const SLIP_RAD = 0.38;
/** Body lean into the turn at full doughnut (rad, around the forward axis). */
const LEAN_RAD = 0.13;

export interface WheelsPose3d {
  x: number; y: number; z: number;
  yaw: number; roll: number; pitch: number;
  phase: 'enter' | 'donuts' | 'exit' | 'gone';
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const easeOutCubic = (u: number) => 1 - (1 - u) ** 3;
const smooth = (u: number) => { const t = clamp(u, 0, 1); return t * t * (3 - 2 * t); };

/** three.js yaw for a travel direction (dx, dz): forward = (cos yaw, −sin yaw) in xz. */
function yawOf(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}

function quad(p0: number, p1: number, p2: number, u: number): number {
  const v = 1 - u;
  return v * v * p0 + 2 * v * u * p1 + u * u * p2;
}
function quadD(p0: number, p1: number, p2: number, u: number): number {
  return 2 * (1 - u) * (p1 - p0) + 2 * u * (p2 - p1);
}

/** The point at the top (far side) of the doughnut ellipse — where the enter lands. */
const TOP = { x: DONUT.cx + DONUT.rx * Math.cos(-Math.PI / 2), z: DONUT.cz + DONUT.rz * Math.sin(-Math.PI / 2) };

function ellipseAt(th: number): { x: number; z: number } {
  return { x: DONUT.cx + DONUT.rx * Math.cos(th), z: DONUT.cz + DONUT.rz * Math.sin(th) };
}

/** Where the car is at `t` seconds into its show (no blast). */
export function wheelsPose3dAt(t: number): WheelsPose3d {
  if (t >= WHEELS3D_SHOW_S) {
    return { x: FELT.hx + WHEELS_CAR_LEN + 0.9, y: 0, z: DONUT.cz + DONUT.rz + 0.5, yaw: 0.1, roll: 0, pitch: 0, phase: 'gone' };
  }
  if (t < WHEELS3D_ENTER_S) {
    const u = easeOutCubic(clamp(t / WHEELS3D_ENTER_S, 0, 1));
    const p0 = { x: -(FELT.hx + WHEELS_CAR_LEN * 0.95), z: TOP.z + 0.1 };
    const p1 = { x: -DONUT.rx * 1.2, z: TOP.z - 0.34 };
    const x = quad(p0.x, p1.x, TOP.x, u), z = quad(p0.z, p1.z, TOP.z, u);
    const yaw = yawOf(quadD(p0.x, p1.x, TOP.x, u), quadD(p0.z, p1.z, TOP.z, u));
    // it hops the rail on the way in (the rail ring stands proud of the felt),
    // with a touch of nose-down squat as it brakes onto the cloth
    return { x, y: 0.15 * Math.sin(u * Math.PI), z, yaw, roll: 0.02 * Math.sin(u * Math.PI), pitch: -0.028 * Math.sin(u * Math.PI), phase: 'enter' };
  }
  if (t < WHEELS3D_DONUT_END_S) {
    const prog = (t - WHEELS3D_ENTER_S) / (WHEELS3D_DONUT_END_S - WHEELS3D_ENTER_S);
    const th = -Math.PI / 2 + prog * WHEELS3D_DONUT_TURNS * Math.PI * 2;
    const p = ellipseAt(th);
    // tangent (direction of travel)
    const vx = -DONUT.rx * Math.sin(th), vz = DONUT.rz * Math.cos(th);
    const vl = Math.hypot(vx, vz) || 1;
    // powerslide: blend the heading from the tangent toward the circle centre
    const slip = SLIP_RAD * smooth(prog / 0.14) * smooth((1 - prog) / 0.14);
    const tx = vx / vl, tz = vz / vl;
    const cx = DONUT.cx - p.x, cz = DONUT.cz - p.z;
    const cl = Math.hypot(cx, cz) || 1;
    const hx = tx * Math.cos(slip) + (cx / cl) * Math.sin(slip);
    const hz = tz * Math.cos(slip) + (cz / cl) * Math.sin(slip);
    // lean into the turn: the turn centre stays on the car's right for this
    // direction of travel (verified against the scene captures), so a positive
    // roll (top toward +Z when facing +X) is a lean IN.
    const roll = LEAN_RAD * smooth(prog / 0.14) * smooth((1 - prog) / 0.14);
    return { x: p.x, y: 0, z: p.z, yaw: yawOf(hx, hz), roll, pitch: 0.012 * Math.sin(prog * Math.PI * 4), phase: 'donuts' };
  }
  // peel off: ease-in Bézier from wherever the doughnuts ended, out the right edge
  const thE = -Math.PI / 2 + WHEELS3D_DONUT_TURNS * Math.PI * 2;
  const p0 = ellipseAt(thE);
  const tan = { x: -DONUT.rx * Math.sin(thE), z: DONUT.rz * Math.cos(thE) };
  const tl = Math.hypot(tan.x, tan.z) || 1;
  const p1 = { x: p0.x + (tan.x / tl) * 0.6, z: p0.z + (tan.z / tl) * 0.6 };
  const p2 = { x: FELT.hx + WHEELS_CAR_LEN + 0.9, z: DONUT.cz + DONUT.rz + 0.5 };
  const u0 = clamp((t - WHEELS3D_DONUT_END_S) / (WHEELS3D_SHOW_S - WHEELS3D_DONUT_END_S), 0, 1);
  const u = u0 ** 1.6;
  const x = quad(p0.x, p1.x, p2.x, u), z = quad(p0.z, p1.z, p2.z, u);
  const yaw = yawOf(quadD(p0.x, p1.x, p2.x, u), quadD(p0.z, p1.z, p2.z, u));
  // and hops the rail again on the way out, in the second half of the peel
  const hop = 0.15 * Math.sin(clamp((u0 - 0.5) / 0.5, 0, 1) * Math.PI);
  return { x, y: hop, z, yaw, roll: 0.03 * (1 - u), pitch: 0.02 * u, phase: 'exit' };
}

/** The car's footprint dims (length along its forward, width across), for wheel points. */
export interface CarDims { len: number; wid: number }

/**
 * Tyre contact points on the felt for a pose: the rear pair lays the rubber (and
 * breathes the smoke); the front pair is here for the steering read. Local frame:
 * forward +X (axles at ±0.31·len), lateral ±0.38·wid, y = 0 (on the felt).
 */
export function wheelPoints3d(pose: Pick<WheelsPose3d, 'x' | 'z' | 'yaw'>, dims: CarDims): { rearL: [number, number]; rearR: [number, number]; frontL: [number, number]; frontR: [number, number] } {
  const fx = Math.cos(pose.yaw), fz = -Math.sin(pose.yaw); // forward in xz
  const lx = fz, lz = -fx; // left in xz (facing +X, up +Y: left is −Z)
  const axle = 0.31 * dims.len, half = 0.38 * dims.wid;
  const at = (along: number, side: number): [number, number] => [
    pose.x + fx * along + lx * side,
    pose.z + fz * along + lz * side,
  ];
  return { rearL: at(-axle, half), rearR: at(-axle, -half), frontL: at(axle, half), frontR: at(axle, -half) };
}

export interface CarBlastPose {
  /** Offset from the car's position at the flash, world units. */
  off: [number, number, number];
  /** Outer-group rotation (order YXZ): the tumble, carrying the car's flash yaw. */
  rot: [number, number, number];
  visible: boolean;
}

/**
 * The car, caught by the blast: `u` is seconds since the FLASH (negative = the
 * fireball is still forming, car not yet touched → null). Launched radially off
 * the table centre on the card sweep's profile (cubic-out sweep ≈0.55 s, sin rise
 * ≈0.7 s — pjsSedanBlast's numbers), tumbling away; mega reaches farther and its
 * second detonation re-kicks mid-flight. `calm` (OS reduce-motion): slid away
 * with no tumble, gone sooner.
 */
export function wheelsCarBlastPoseAt(u: number, from: Pick<WheelsPose3d, 'x' | 'z' | 'yaw'>, opts: { mega: boolean; calm: boolean }): CarBlastPose | null {
  if (u < 0) return null;
  const { mega, calm } = opts;
  let dx = from.x, dz = from.z;
  if (Math.hypot(dx, dz) < 0.2) { dx = 1; dz = -0.35; }
  const dl = Math.hypot(dx, dz);
  const ux = dx / dl, uz = dz / dl;
  const sweepWin = calm ? 0.4 : 0.55;
  const s = u < sweepWin ? 1 - (1 - u / sweepWin) ** 3 : 1;
  let reach = (mega ? 7.0 : 5.2) * s + (mega ? 1.7 : 1.15) * Math.max(0, u - sweepWin);
  if (mega && u > MEGA_REKICK_U) reach += 1.7 * (1 - (1 - Math.min(1, (u - MEGA_REKICK_U) / 0.4)) ** 3);
  const rise = Math.sin(Math.min(1, u / 0.7) * (Math.PI / 2));
  let lift = (mega ? 1.9 : 1.35) * rise + 0.85 * Math.max(0, u - 0.7);
  if (calm) lift *= 0.45;
  const tumble = calm ? 0 : (mega ? 3.1 : 2.3) * s;
  const visible = u <= (calm ? 1.05 : mega ? 4.1 : 3.3);
  return {
    off: [ux * reach, lift, uz * reach],
    rot: [tumble * 0.8, from.yaw + tumble * 0.35, tumble * 0.6],
    visible,
  };
}

/** How long after the flash the swept car can still be on screen (its unmount cap). */
export function wheelsCarBlastLen(mega: boolean, calm: boolean): number {
  return calm ? 1.05 : mega ? 4.1 : 3.3;
}
