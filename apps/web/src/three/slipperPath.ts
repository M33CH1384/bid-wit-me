/**
 * The pair of ruby slippers riding the 'Run it!' funnel: pose math only — the meshes live in
 * Tornado3D, next to the dust / debris points they travel with. Both run kinds (ordinary and
 * the both-Jokers mega) set the same fx.tornado, so the pair rides both, and because the poses
 * are driven by the funnel's own clock and envelopes, the slippers exist exactly while the
 * funnel does — Reduce effects suppresses the funnel, and them with it.
 *
 * The path mirrors the funnel shader in Tornado3D: a particle's height fraction loops upward,
 * its radius follows the cone profile, and it spins at the funnel's rate. The second slipper
 * rides a fixed step up the cycle and around the wall from the first, so the two travel as a
 * pair — near each other, tumbling independently — instead of scattering like the debris.
 */

export interface SlipperPose {
  x: number;
  y: number;
  z: number;
  /** Euler tumble, radians. */
  rx: number;
  ry: number;
  rz: number;
  /** 0..1 body opacity: in with the funnel's grow, out at the height wrap and with the fling. */
  alpha: number;
  /** 0..1 sparkle glint strength (never above the body envelope). */
  glint: number;
  /** Funnel height fraction this slipper is riding. */
  h: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const frac = (v: number) => v - Math.floor(v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** The funnel's own clocks, mirrored from Tornado3D's shader uniforms. u = tornado seconds (0.4 = spin-up). */
export const funnelGrow = (u: number) => clamp01(u / 0.7);
export const funnelFling = (u: number) => clamp01((u - 1.65) / 0.6);

/** Radius of the funnel wall at height fraction h (the dust shader's cone profile). */
export function funnelRadius(h: number, fling: number): number {
  return (0.07 + 0.62 * h * h + 0.08 * h) * (1 + fling * 4);
}

const RISE = 0.5; // height loops per tornado second — the debris band's pace
const PAIR_DH = 0.1; // the second slipper rides this far up the cycle from the first…
const PAIR_DANG = 0.38; // …and this far around the funnel wall
const PAIR_DR = 0.02; // …and floats a hair off the wall

export function slipperPose(u: number, i: 0 | 1): SlipperPose {
  const grow = funnelGrow(u);
  const fling = funnelFling(u);
  const h = frac(0.1 + u * RISE + (i === 1 ? PAIR_DH : 0));
  // the shader's spin: base rate less the height term, plus the cone's twist
  const ang = u * (8.5 - 4.5 * h) + h * 3.0 + (i === 1 ? PAIR_DANG : 0);
  const r = funnelRadius(h, fling) + (i === 1 ? PAIR_DR : 0);
  // Vanish at both ends of the height loop — the wrap reads as a fresh pick-up, never a
  // teleport — and with the fling, exactly like the dust's alpha envelope.
  const alpha = smooth(0, 0.07, h) * (1 - smooth(0.8, 0.95, h)) * (1 - fling) * grow;
  const tw = 0.5 + 0.5 * Math.sin(u * 10 + i * 2.4);
  return {
    x: Math.cos(ang) * r,
    y: h * 1.9 * grow,
    z: Math.sin(ang) * r,
    rx: u * (i === 0 ? 2.3 : 1.9) + i * 1.7,
    // toe roughly along the direction of travel, with a wobble — the pair never quite syncs
    ry: -(ang + Math.PI / 2) + Math.sin(u * 1.3 + i) * 0.4,
    rz: u * (i === 0 ? 1.7 : 2.1) + i * 2.9,
    alpha,
    glint: alpha * (0.3 + 0.7 * tw * tw),
    h,
  };
}
