/**
 * Your-turn hand: legal cards rise together, cards you can't play sink and dim, a tap lifts one card further.
 * Distances are CSS pixels on the canvas. The fan lives on the depth-1 camera plane, so a pixel is
 * `viewH / screenH` plane units (see handCardPlane).
 */

export const LEGAL_LIFT_PX = 14;
export const ILLEGAL_DROP_PX = 4;
export const SELECT_LIFT_PX = 10;
/** Group lift (and the return to flat) in seconds. */
export const LIFT_S = 0.2;

/** One continuous outline around each run of legal cards. No per-card border. */
export const OUTLINE_COLOR = '#F2C14E';
export const OUTLINE_PX = 2;
/** `box-shadow: 0 0 16px rgba(242,193,78,.45)` — same gold, blur radius 16px, peak alpha 0.45. */
export const GLOW_BLUR_PX = 16;
export const GLOW_ALPHA = 0.45;
/** The glow mesh extends this many blur-radii so the gaussian has faded out at the edge. */
export const GLOW_TAIL = 3;

/**
 * Not-playable cards read at 55% brightness. The albedo below was tuned on the lit, tone-mapped card so that
 * (0.20, 0.195, 0.25) is about 60% on screen; scale it to the 55% target and keep the cool tint.
 */
export const ILLEGAL_BRIGHTNESS = 0.55;
const DIM_AT_60 = [0.2, 0.195, 0.25] as const;
const DIM_SCALE = ILLEGAL_BRIGHTNESS / 0.6;
export const ILLEGAL_COLOR: readonly [number, number, number] = [
  DIM_AT_60[0] * DIM_SCALE,
  DIM_AT_60[1] * DIM_SCALE,
  DIM_AT_60[2] * DIM_SCALE,
];

export type HandPose = 'flat' | 'illegal' | 'legal' | 'selected';
export type HandStack = 'rest' | 'play' | 'selected';

/** Off turn everything is flat, even a card that was selected. Illegal cards never take the extra tap lift. */
export function playablePose(yourTurn: boolean, isLegal: boolean, selected: boolean): HandPose {
  if (!yourTurn) return 'flat';
  if (!isLegal) return 'illegal';
  return selected ? 'selected' : 'legal';
}

export function canTapCard(pose: HandPose): boolean {
  return pose === 'legal' || pose === 'selected';
}

export function posePx(pose: HandPose): number {
  switch (pose) {
    case 'flat': return 0;
    case 'illegal': return -ILLEGAL_DROP_PX;
    case 'legal': return LEGAL_LIFT_PX;
    case 'selected': return LEGAL_LIFT_PX + SELECT_LIFT_PX;
  }
}

/** Rest stays in the fan stack. The legal group comes forward, and the tapped card tops that. */
export function stackFor(pose: HandPose): HandStack {
  if (pose === 'selected') return 'selected';
  if (pose === 'legal') return 'play';
  return 'rest';
}

/** Plane-space distance of `px` CSS pixels at depth 1. */
export function cssPxToPlane(px: number, viewH: number, screenH: number): number {
  return (px / Math.max(1, screenH)) * viewH;
}

/** `handFan` / `handCardPlane` lift, as a fraction of card height. Positive raises the card. */
export function handLift(pose: HandPose, viewH: number, screenH: number, cardH: number): number {
  return cssPxToPlane(posePx(pose), viewH, screenH) / Math.max(1e-6, cardH);
}

/** Half-width of the 2px outline, in CSS pixels (the stroke is centered on the halo). */
export function outlineRadiusPx(): number {
  return OUTLINE_PX / 2;
}

/** Half-width of the glow ribbon, in CSS pixels. */
export function glowRadiusPx(): number {
  return GLOW_BLUR_PX * GLOW_TAIL;
}

/**
 * Gaussian falloff of a 16px blur. `edge` is 0 on the outline and 1 at the ribbon edge (3 blur-radii out).
 * Peak is 1; multiply by GLOW_ALPHA for the shadow colour.
 */
export function glowFalloff(edge: number): number {
  const sigmas = edge * GLOW_TAIL;
  return Math.exp(-0.5 * sigmas * sigmas);
}

/** CSS cubic-bezier(x1, y1, x2, y2) sampled by x (time). Control x's must be in [0, 1]. */
export function cssCubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = sampleX(t) - x;
    if (Math.abs(err) < 1e-6) break;
    const d = sampleDX(t);
    if (Math.abs(d) < 1e-6) break;
    t = Math.min(1, Math.max(0, t - err / d));
  }
  return sampleY(t);
}

/** cubic-bezier(.2, .8, .2, 1) — the group lift. */
export function liftEase(t: number): number {
  return cssCubicBezier(0.2, 0.8, 0.2, 1, t);
}
