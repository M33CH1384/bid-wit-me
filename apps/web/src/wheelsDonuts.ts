/**
 * Pure choreography for the Wheels car (WheelsCar.tsx) — owner direction, 2026-10-28:
 * the car's signature table behaviour is DOUGHNUTS on the felt. It swings in from the
 * left under the peelOut revs, lays ~1¾ tight circles around the trick centre trailing
 * tyre smoke and dark donut arcs, then straightens and peels off the right edge — same
 * 2.5 s show window and the same `wheelsCar` summons as always (a side taking all 10
 * books); only the driving changed.
 *
 * And the nuke shows no favourites: if a nuke/mega detonates while the car is on the
 * table, the blast sweep takes it with everything else. `carSweepAt` is that sweep,
 * keyed to the flash (BLAST_FLASH_S after the fx event — the same instant fx.blast
 * starts sweeping the cards). Mega throws harder, and its second detonation re-kicks
 * the car mid-flight, mirroring the blast hierarchy. In the 'off' nuke mode there is
 * no visual sweep anywhere on the table, so there is none for the car either; under
 * OS reduce-motion the car is flung without the tumble and fades as it goes.
 *
 * Everything here is a pure function of time so the celebration can be seeked by
 * capture scripts and unit-tested without a DOM.
 */

/** The show's length — WheelsCar's CAR_MS. Unchanged by the doughnuts. */
export const WHEELS_SHOW_S = 2.5;
/** Swinging onto the felt, under the revs. */
export const WHEELS_ENTER_S = 0.62;
/** Doughnuts end; the peel-off begins. */
export const WHEELS_DONUT_END_S = 2.07;
export const WHEELS_DONUT_TURNS = 1.75;
/** Seconds from the fx detonation event to the flash — the sweep lands on the flash.
 *  Mirrors NUKE_FLASH_S in three/nukeVisual.ts (this module is entry-side and must
 *  not import the three chunk). */
export const BLAST_FLASH_S = 0.3;
/** Mega's second detonation, seconds after the flash (MEGA_STAGE2_S 1.45 − flash 0.3, rounded). */
const MEGA_REKICK_U = 1.15;

export interface WheelsView { w: number; h: number; carW: number }
export interface WheelsPose {
  /** Car centre, CSS px. */
  cx: number; cy: number;
  /** Visual tilt, degrees (damped travel pitch — the car never goes upside down). */
  rot: number;
  /** Travelling leftward: the sprite is mirrored rather than rolled over. */
  flip: boolean;
  phase: 'enter' | 'donuts' | 'exit' | 'swept' | 'gone';
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const easeOutCubic = (u: number) => 1 - (1 - u) ** 3;

/** The doughnut ellipse for a car of this rendered width: tight around the trick centre,
 *  squashed vertically for the felt's perspective. */
export function donutRadii(carW: number): { rx: number; ry: number } {
  const rx = clamp(carW * 0.42, 52, 120);
  return { rx, ry: rx * 0.52 };
}

function quad(p0: number, p1: number, p2: number, u: number): number {
  const v = 1 - u;
  return v * v * p0 + 2 * v * u * p1 + u * u * p2;
}
function quadD(p0: number, p1: number, p2: number, u: number): number {
  return 2 * (1 - u) * (p1 - p0) + 2 * u * (p2 - p1);
}

/** Tilt + mirror from a velocity vector: damped pitch, mirrored when heading left. */
function heading(dx: number, dy: number): { rot: number; flip: boolean } {
  const ang = Math.atan2(dy, dx);
  const flip = Math.cos(ang) < 0;
  const deg = (a: number) => (a * 180) / Math.PI;
  const tilt = flip ? deg(ang - Math.PI) : deg(ang); // −90..90 in both cases
  return { rot: clamp(tilt, -38, 38) * 0.55, flip };
}

/** Where the car is at `t` seconds into its show (no blast). */
export function wheelsPoseAt(t: number, view: WheelsView, center: { x: number; y: number }): WheelsPose {
  const { rx, ry } = donutRadii(view.carW);
  if (t >= WHEELS_SHOW_S) {
    return { cx: view.w + view.carW, cy: center.y + ry + 110, rot: 6, flip: false, phase: 'gone' };
  }
  if (t < WHEELS_ENTER_S) {
    const u = easeOutCubic(clamp(t / WHEELS_ENTER_S, 0, 1));
    const p0 = { x: center.x - rx - view.carW * 1.15, y: center.y - ry + 6 };
    const p1 = { x: center.x - rx * 0.9, y: center.y - ry - 16 };
    const p2 = { x: center.x, y: center.y - ry };
    const cx = quad(p0.x, p1.x, p2.x, u), cy = quad(p0.y, p1.y, p2.y, u);
    const hd = heading(quadD(p0.x, p1.x, p2.x, u), quadD(p0.y, p1.y, p2.y, u));
    return { cx, cy, ...hd, phase: 'enter' };
  }
  if (t < WHEELS_DONUT_END_S) {
    const th = -Math.PI / 2 + ((t - WHEELS_ENTER_S) / (WHEELS_DONUT_END_S - WHEELS_ENTER_S)) * WHEELS_DONUT_TURNS * Math.PI * 2;
    const cx = center.x + rx * Math.cos(th), cy = center.y + ry * Math.sin(th);
    // A doughnut is a powerslide, not a slot car: the side-view car stays facing
    // right and slides around the circle with a lean that swings with the rear end.
    // (Mirroring the sprite mid-circle pops; a full roll reads wrong from this angle.)
    return { cx, cy, rot: 12 * Math.sin(th + 0.6), flip: false, phase: 'donuts' };
  }
  // peel off: ease-in Bézier from wherever the doughnuts ended, out the right edge
  const thE = -Math.PI / 2 + WHEELS_DONUT_TURNS * Math.PI * 2;
  const p0 = { x: center.x + rx * Math.cos(thE), y: center.y + ry * Math.sin(thE) };
  const tan = { x: -rx * Math.sin(thE), y: ry * Math.cos(thE) };
  const tl = Math.hypot(tan.x, tan.y) || 1;
  const p1 = { x: p0.x + (tan.x / tl) * 150, y: p0.y + (tan.y / tl) * 150 };
  const p2 = { x: view.w + view.carW * 0.9, y: center.y + ry + 110 };
  const u0 = clamp((t - WHEELS_DONUT_END_S) / (WHEELS_SHOW_S - WHEELS_DONUT_END_S), 0, 1);
  const u = u0 ** 1.6;
  const cx = quad(p0.x, p1.x, p2.x, u), cy = quad(p0.y, p1.y, p2.y, u);
  const hd = heading(quadD(p0.x, p1.x, p2.x, u), quadD(p0.y, p1.y, p2.y, u));
  return { cx, cy, ...hd, phase: 'exit' };
}

/** Wheel contact points for a pose (the SuperCar SVG's wheel centres: rear 78/360,
 *  front 284/360, axle line 82/110), mirrored and rotated with the car. Smoke and
 *  skid arcs key off these. */
export function wheelPoints(pose: WheelsPose, view: WheelsView): { rear: { x: number; y: number }; front: { x: number; y: number } } {
  const carH = (view.carW * 110) / 360;
  const local = (fx: number) => ({ x: (fx - 0.5) * view.carW * (pose.flip ? -1 : 1), y: (82 / 110 - 0.5) * carH });
  const a = (pose.rot * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const place = (fx: number) => {
    const l = local(fx);
    return { x: pose.cx + l.x * cos - l.y * sin, y: pose.cy + l.x * sin + l.y * cos };
  };
  return { rear: place(78 / 360), front: place(284 / 360) };
}

export interface CarSweepFrom { cx: number; cy: number; flip: boolean }
export interface CarSweepPose { cx: number; cy: number; rot: number; flip: boolean; opacity: number; gone: boolean }

/**
 * The car, caught by the blast: `u` is seconds since the FLASH (negative = the
 * fireball is still forming, car not yet touched → null). Launched radially off the
 * felt centre with an upward bias, tumbling away from the table; gravity bends the
 * arc down as it leaves. `calm` (OS reduce-motion): no tumble, a quicker fade-out.
 */
export function carSweepAt(u: number, from: CarSweepFrom, center: { x: number; y: number }, mega: boolean, calm: boolean, view: WheelsView): CarSweepPose | null {
  if (u < 0) return null;
  let dx = from.cx - center.x, dy = from.cy - center.y;
  if (Math.hypot(dx, dy) < 24) { dx = 1; dy = -0.35; }
  const dl = Math.hypot(dx, dy);
  let ux = dx / dl, uy = dy / dl - 0.55;
  const ul = Math.hypot(ux, uy) || 1;
  ux /= ul; uy /= ul;
  const v0 = (mega ? 1750 : 1250) * (calm ? 1.2 : 1);
  let dist = v0 * u;
  if (mega && u > MEGA_REKICK_U) dist += v0 * 0.38 * (u - MEGA_REKICK_U); // the second detonation shoves it again
  const cx = from.cx + ux * dist;
  const cy = from.cy + uy * dist + 0.5 * 1450 * u * u;
  const spin = calm ? 0 : mega ? 640 : 440;
  const rot = spin === 0 ? 0 : (from.cx < center.x ? -1 : 1) * spin * u;
  const opacity = calm ? clamp(1 - u / 0.45, 0, 1) : 1;
  const m = view.carW;
  const gone = u > 1.7 || cx < -m || cx > view.w + m || cy > view.h + m || cy < -m * 1.6 || (calm && opacity <= 0);
  return { cx, cy, rot, flip: from.flip, opacity, gone };
}

/**
 * Whether a detonation sweeps the car. The gate mirrors Nuke3D's own: with the nuke
 * mode 'off' the blast has no visual sweep at all (banner + boom), so nothing on the
 * table moves — the car included.
 */
export function wheelsBlastReaction(kind: 'nuke' | 'mega', nukeMode: string): 'swept' | 'mega-swept' | 'none' {
  if (nukeMode === 'off') return 'none';
  return kind === 'mega' ? 'mega-swept' : 'swept';
}
