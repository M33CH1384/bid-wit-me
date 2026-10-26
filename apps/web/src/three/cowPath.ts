/**
 * The cow riding the 'Run it!' funnel: pose math and construction spec only — the meshes live
 * in Tornado3D, next to the dust / debris points and the ruby slippers it travels with. Like
 * the slippers it rides both run kinds (ordinary and the both-Jokers mega share the one
 * fx.tornado stage), its poses are driven by the funnel's own clock and envelopes, and Reduce
 * effects suppresses it with the funnel — it has no toggle and no life of its own.
 *
 * Where the slippers loop the full height of the cone, the cow holds a mid-height band and
 * turns slowly around its own spine — legs stuck straight out, one unhurried roll while the
 * funnel whips it around the wall. The comedy is that it is calm up there.
 */

import { funnelFling, funnelGrow, funnelRadius } from './slipperPath';

export interface CowPose {
  x: number;
  y: number;
  z: number;
  /** Slow roll around the body's long axis, radians (applied to the rig's inner roll group). */
  rx: number;
  /** Heading: faces the direction of travel around the funnel wall. */
  ry: number;
  /** A slight perpetual bank. */
  rz: number;
  /** 0..1 body opacity: in with the funnel's grow, out with the fling. */
  alpha: number;
  /** Funnel height fraction it is riding (never wraps — it holds a mid band). */
  h: number;
}

/**
 * Construction spec for the cow, in plan units (the slippers are ~0.21 long; the cow is the
 * biggest single piece of debris in the funnel at ~0.6 overall). +x is forward, y is up,
 * the origin is the body's centre. The meshes in Tornado3D are built from these numbers,
 * and the silhouette they make is pinned by the cow-path tests.
 */
export const COW_SPEC = {
  body: { c: [0, 0, 0] as const, r: [0.185, 0.12, 0.105] as const },
  head: { c: [0.235, 0.045, 0] as const, r: [0.08, 0.072, 0.066] as const },
  muzzle: { c: [0.305, -0.002, 0] as const, r: [0.042, 0.046, 0.05] as const },
  ear: { c: [0.205, 0.105, 0.062] as const, r: [0.052, 0.015, 0.028] as const },
  eye: { c: [0.285, 0.055, 0.052] as const, r: 0.011 },
  leg: { attach: [0.115, -0.095, 0.055] as const, len: 0.165, r: 0.019, splay: 0.38 },
  hoof: { r: 0.024 },
  udder: { c: [-0.025, -0.115, 0] as const, r: [0.052, 0.042, 0.048] as const },
  tail: { base: [-0.185, 0.075, 0] as const, end: [-0.245, -0.115, 0] as const, r: 0.011, tuft: 0.026 },
} as const;

/** Where a leg's foot lands: the attach point pushed out along its splay. Front legs reach
 *  forward, rear legs back — the legs stick OUT, rigid, in both directions. */
export function cowLegFoot(front: boolean): [number, number] {
  const [ax, ay] = COW_SPEC.leg.attach;
  const dx = Math.sin(COW_SPEC.leg.splay) * COW_SPEC.leg.len * (front ? 1 : -1);
  const dy = -Math.cos(COW_SPEC.leg.splay) * COW_SPEC.leg.len;
  return [(front ? ax : -ax) + dx, ay + dy];
}

/**
 * The Holstein patch pattern, as a pure function of sphere UV: 1 inside a black patch,
 * 0 on the white hide. Blob centres/radii in UV space (u wraps around the body); the
 * texture Tornado3D builds samples this, and the tests pin its coverage — patched enough
 * to read black-and-white at phone size, never a mostly-black cow.
 */
const PATCHES: ReadonlyArray<readonly [number, number, number, number]> = [
  // [centre u, centre v, radius u, radius v]
  [0.15, 0.55, 0.16, 0.2],
  [0.38, 0.42, 0.11, 0.14],
  [0.55, 0.62, 0.19, 0.17],
  [0.78, 0.5, 0.13, 0.22],
  [0.93, 0.38, 0.09, 0.12],
  [0.3, 0.74, 0.08, 0.09],
  [0.66, 0.3, 0.09, 0.1],
  [0.05, 0.3, 0.07, 0.1],
];

export function cowPatch(u: number, v: number): number {
  for (const [cu, cv, ru, rv] of PATCHES) {
    let du = Math.abs(u - cu);
    if (du > 0.5) du = 1 - du; // u wraps around the body
    const dv = v - cv;
    if ((du * du) / (ru * ru) + (dv * dv) / (rv * rv) <= 1) return 1;
  }
  return 0;
}

export function cowPose(u: number): CowPose {
  const grow = funnelGrow(u);
  const fling = funnelFling(u);
  // a mid-height band, gently bobbing — it never reaches either end of the loop, so
  // there is no wrap and no teleport: the cow is simply up there for the whole show
  const h = 0.48 + 0.09 * Math.sin(u * 0.85 + 0.6);
  // the funnel's own spin law, so it stays glued to the wall like everything else
  const ang = u * (8.5 - 4.5 * h) + h * 3.0;
  const r = funnelRadius(h, fling);
  return {
    x: Math.cos(ang) * r,
    y: h * 1.9 * grow,
    z: Math.sin(ang) * r,
    // ONE slow roll around the spine — over the visible show it makes most of a single
    // lazy turn (the slippers, by contrast, tumble on two axes at once)
    rx: u * 1.45,
    ry: -(ang + Math.PI / 2),
    rz: 0.35 + u * 0.3,
    alpha: grow * (1 - fling),
    h,
  };
}
