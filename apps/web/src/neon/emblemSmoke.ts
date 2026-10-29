/**
 * Emblem smoke — the pure half (no DOM): the geometry that lets a canvas
 * layer repaint EXACTLY where styles.css paints the Neon home emblem
 * (`.wiz-home::before`, `spade-emblem.webp`), plus the spade-glass clip
 * path and the deterministic puff field the engine (EmblemSmoke.tsx)
 * drifts inside it.
 *
 * The CSS paints the emblem three ways, and this module mirrors all
 * three (the layout-home-fit suite pins the CSS; the tests here pin
 * this math against the same rules):
 *  - base (portrait / narrow): the ::before box is the .wiz-home stage
 *    box; the painting is height-driven, `auto 80%`, at `50% -16px`.
 *  - wide (≥700px): the box bleeds to min(1056px, 100vw) centered on
 *    the stage (the layer element's own CSS reproduces that box, so
 *    here boxW/boxH already ARE the bled box); painting is `cover`,
 *    position still `50% -16px`.
 *  - short landscape (landscape, ≤520px tall): painting `auto 94%`
 *    at `10% -8px` — this block sits later in the stylesheet than the
 *    wide block, so it wins the painting whenever both match.
 * Positions use the CSS percentage rule: offset = (box − image) × p.
 *
 * The field itself (tuned 2026-10-29 after the owner "didn't see
 * anything moving" in the first, screen-only, 120 s version): two
 * blend families — bright puffs composited `screen` (light moving in
 * the nebula) and deep indigo/violet puffs composited `multiply`
 * (shadow moving through it). Screen alone only ever lightens, so over
 * the art's already-bright clouds it composited to near-zero visible
 * change; the dark family is what makes cloud SHAPES visibly change.
 * Motion is a 60 s seamless loop: per-puff Lissajous wander, a gentle
 * oscillating swirl around the glass center, and breathing alpha +
 * radius, all with periods that divide the loop — fast enough that the
 * churn is visible within the first seconds of looking, slow enough to
 * stay smoke, not a screensaver.
 */

/** The emblem artwork's own pixel size (spade-emblem.webp). */
export const EMBLEM_W = 690;
export const EMBLEM_H = 770;

export interface EmblemSmokeGate {
  /** Active theme from the theme store. */
  theme: string;
  /** OS `prefers-reduced-motion: reduce`. */
  reducedMotion: boolean;
  /** The app's own "Reduce effects" switch (`fx.reduced`, key `bwm.fx`). */
  reduceEffects: boolean;
  /** Low-end device (inkLowQuality's positive-evidence classification). */
  lowEnd: boolean;
}

/**
 * The gate: the smoke engine runs only in Neon (the emblem exists only
 * there) with motion fully allowed. Any calming signal — OS reduced
 * motion, Reduce effects, a low-end device — leaves the emblem exactly
 * the static painting it has always been.
 */
export function emblemSmokeActive(s: EmblemSmokeGate): boolean {
  return s.theme === 'neon' && !s.reducedMotion && !s.reduceEffects && !s.lowEnd;
}

export interface PaintRect { x: number; y: number; w: number; h: number }

export interface PaintEnv {
  /** The layer box's size in CSS px (the ::before box, incl. the ≥700px bleed). */
  boxW: number;
  boxH: number;
  /** viewport ≥ 700px wide (the bleed + cover regime). */
  wide: boolean;
  /** landscape with ≤ 520px height (the re-seated painting regime). */
  shortLandscape: boolean;
}

/** Where the emblem image paints inside the layer box, in CSS px. */
export function emblemPaintRect(env: PaintEnv): PaintRect {
  const { boxW, boxH } = env;
  const ar = EMBLEM_W / EMBLEM_H;
  if (env.shortLandscape) {
    const h = 0.94 * boxH;
    const w = h * ar;
    return { x: (boxW - w) * 0.1, y: -8, w, h };
  }
  if (env.wide) {
    const s = Math.max(boxW / EMBLEM_W, boxH / EMBLEM_H);
    const w = EMBLEM_W * s;
    const h = EMBLEM_H * s;
    return { x: (boxW - w) / 2, y: -16, w, h };
  }
  const h = 0.8 * boxH;
  const w = h * ar;
  return { x: (boxW - w) / 2, y: -16, w, h };
}

/**
 * The INNER glass outline of the spade, in emblem-image pixel coords —
 * traced inside the gold rim of the artwork (rim excluded: smoke must
 * never paint over it), and stopping at the lobes' underside: the stem
 * glass below the notch is black in the art and takes no smoke.
 * Fitted against the artwork with a debug overlay (see EmblemSmoke).
 */
export const SPADE_GLASS_PATH_D =
  'M 345 82 ' +
  'C 399 124 464 190 515 272 ' +
  'C 560 346 588 415 586 481 ' +
  'C 583 534 551 571 496 585 ' +
  'C 454 596 412 589 386 566 ' +
  'C 371 540 359 534 345 536 ' +
  'C 331 534 319 540 304 566 ' +
  'C 278 589 236 596 194 585 ' +
  'C 139 571 107 534 104 481 ' +
  'C 102 415 130 346 175 272 ' +
  'C 226 190 291 124 345 82 Z';

/** The master loop: every period below divides it, so the field repeats seamlessly. */
export const SMOKE_LOOP_S = 60;

/** The swirl center — the middle of the glass bulb, in image fractions. */
export const SWIRL_CX = 0.50;
export const SWIRL_CY = 0.44;

/** Nebula tints sampled from the artwork (violet → blue) — the bright (`screen`) family. */
export const SMOKE_TINTS: [number, number, number][] = [
  [122, 79, 208], // violet
  [155, 93, 229], // purple
  [96, 72, 205], // deep violet
  [63, 127, 224], // blue
  [96, 165, 255], // light blue
];

/**
 * The dark (`multiply`) family: deep indigo / violet-blacks. Multiplied
 * over the art's bright clouds they read as shadowed smoke rolling
 * through the nebula — the contrast half of the motion.
 */
export const SMOKE_DARK_TINTS: [number, number, number][] = [
  [46, 20, 96], // deep violet
  [34, 38, 116], // indigo
  [58, 24, 110], // violet-black
];

export interface SmokePuff {
  /** anchor, in image-fraction coords (0..1 across the painted emblem) */
  nx: number;
  ny: number;
  /** radius, as a fraction of the painted emblem's width */
  r: number;
  /** index into SMOKE_TINTS (bright) or SMOKE_DARK_TINTS (dark) */
  tint: number;
  /** dark family: composited `multiply`; bright family: `screen` */
  dark?: boolean;
  /** wander amplitudes (image fractions) and periods (s) per axis */
  ax: number;
  px: number;
  ay: number;
  py: number;
  /** phase offsets (radians) */
  ox: number;
  oy: number;
  /** peak alpha and its breathing period (s) + phase */
  alpha: number;
  pa: number;
  oa: number;
  /** slow rotation swing (radians) with the x-wander period */
  rot: number;
  /** swirl: oscillation amplitude (radians) around the glass center, period (s), phase */
  sw: number;
  psw: number;
  osw: number;
  /** radius breathing: amplitude (fraction of r), period (s), phase */
  rb: number;
  pr: number;
  opr: number;
}

/**
 * The puff field: 3 large bright churn masses + 14 bright wisps (the
 * light), 8 dark wisps parked over the art's brightest cloud regions
 * (the shadow). Anchors sit in the glass bulb (y ≈ 0.20..0.70 of the
 * image height). Every period divides SMOKE_LOOP_S.
 */
export const SMOKE_PUFFS: SmokePuff[] = [
  // bright churn masses — broad, soft, they turn the whole nebula over
  { nx: 0.38, ny: 0.40, r: 0.46, tint: 0, ax: 0.050, px: 20, ay: 0.040, py: 15, ox: 0.0, oy: 1.7, alpha: 0.23, pa: 15, oa: 0.4, rot: 0.10, sw: 0.30, psw: 30, osw: 0.3, rb: 0.15, pr: 20, opr: 1.2 },
  { nx: 0.63, ny: 0.47, r: 0.43, tint: 3, ax: 0.050, px: 15, ay: 0.040, py: 20, ox: 2.4, oy: 0.6, alpha: 0.216, pa: 20, oa: 2.2, rot: -0.12, sw: -0.30, psw: 30, osw: 2.8, rb: 0.15, pr: 15, opr: 4.4 },
  { nx: 0.50, ny: 0.30, r: 0.38, tint: 1, ax: 0.045, px: 12, ay: 0.045, py: 10, ox: 4.1, oy: 3.3, alpha: 0.203, pa: 12, oa: 4.0, rot: 0.08, sw: 0.35, psw: 20, osw: 5.1, rb: 0.18, pr: 12, opr: 2.6 },
  // bright wisps
  { nx: 0.34, ny: 0.30, r: 0.17, tint: 1, ax: 0.060, px: 7.5, ay: 0.050, py: 10, ox: 0.8, oy: 2.9, alpha: 0.459, pa: 10, oa: 1.1, rot: 0.22, sw: 0.60, psw: 15, osw: 1.9, rb: 0.22, pr: 10, opr: 0.7 },
  { nx: 0.55, ny: 0.24, r: 0.15, tint: 0, ax: 0.055, px: 10, ay: 0.050, py: 7.5, ox: 3.5, oy: 0.2, alpha: 0.432, pa: 7.5, oa: 3.9, rot: -0.18, sw: 0.55, psw: 12, osw: 4.2, rb: 0.20, pr: 7.5, opr: 3.3 },
  { nx: 0.68, ny: 0.36, r: 0.16, tint: 4, ax: 0.065, px: 7.5, ay: 0.055, py: 12, ox: 1.9, oy: 4.4, alpha: 0.405, pa: 15, oa: 0.7, rot: 0.26, sw: 0.70, psw: 10, osw: 0.9, rb: 0.24, pr: 12, opr: 5.5 },
  { nx: 0.27, ny: 0.46, r: 0.19, tint: 0, ax: 0.050, px: 12, ay: 0.045, py: 7.5, ox: 5.2, oy: 1.3, alpha: 0.48, pa: 10, oa: 5.1, rot: -0.20, sw: 0.50, psw: 20, osw: 3.7, rb: 0.20, pr: 15, opr: 2.1 },
  { nx: 0.44, ny: 0.48, r: 0.15, tint: 2, ax: 0.070, px: 7.5, ay: 0.060, py: 10, ox: 2.7, oy: 5.6, alpha: 0.432, pa: 7.5, oa: 2.6, rot: 0.16, sw: 0.65, psw: 15, osw: 5.8, rb: 0.22, pr: 10, opr: 4.8 },
  { nx: 0.76, ny: 0.52, r: 0.15, tint: 3, ax: 0.050, px: 10, ay: 0.050, py: 7.5, ox: 0.4, oy: 3.8, alpha: 0.459, pa: 10, oa: 4.6, rot: -0.24, sw: -0.60, psw: 12, osw: 1.4, rb: 0.20, pr: 7.5, opr: 0.2 },
  { nx: 0.58, ny: 0.58, r: 0.18, tint: 4, ax: 0.060, px: 7.5, ay: 0.040, py: 12, ox: 4.8, oy: 0.9, alpha: 0.405, pa: 15, oa: 1.8, rot: 0.20, sw: 0.55, psw: 10, osw: 2.5, rb: 0.24, pr: 12, opr: 3.9 },
  { nx: 0.36, ny: 0.62, r: 0.17, tint: 1, ax: 0.065, px: 12, ay: 0.040, py: 7.5, ox: 1.2, oy: 2.2, alpha: 0.459, pa: 7.5, oa: 0.3, rot: -0.14, sw: -0.55, psw: 15, osw: 4.9, rb: 0.20, pr: 10, opr: 5.9 },
  { nx: 0.50, ny: 0.66, r: 0.13, tint: 3, ax: 0.055, px: 7.5, ay: 0.035, py: 10, ox: 5.8, oy: 4.9, alpha: 0.405, pa: 10, oa: 3.1, rot: 0.28, sw: 0.70, psw: 12, osw: 0.5, rb: 0.22, pr: 15, opr: 1.6 },
  { nx: 0.22, ny: 0.58, r: 0.13, tint: 2, ax: 0.050, px: 10, ay: 0.050, py: 12, ox: 3.1, oy: 5.3, alpha: 0.378, pa: 15, oa: 5.7, rot: -0.26, sw: 0.50, psw: 20, osw: 3.1, rb: 0.20, pr: 12, opr: 4.1 },
  { nx: 0.66, ny: 0.68, r: 0.12, tint: 0, ax: 0.055, px: 7.5, ay: 0.035, py: 7.5, ox: 0.9, oy: 1.5, alpha: 0.378, pa: 7.5, oa: 4.2, rot: 0.18, sw: -0.65, psw: 10, osw: 5.4, rb: 0.24, pr: 7.5, opr: 2.9 },
  { nx: 0.42, ny: 0.20, r: 0.11, tint: 4, ax: 0.045, px: 12, ay: 0.045, py: 7.5, ox: 2.2, oy: 0.5, alpha: 0.378, pa: 10, oa: 2.9, rot: -0.16, sw: 0.60, psw: 15, osw: 1.1, rb: 0.20, pr: 10, opr: 0.9 },
  { nx: 0.80, ny: 0.42, r: 0.11, tint: 1, ax: 0.040, px: 7.5, ay: 0.055, py: 10, ox: 4.4, oy: 3.6, alpha: 0.378, pa: 15, oa: 1.4, rot: 0.24, sw: 0.55, psw: 12, osw: 4.6, rb: 0.22, pr: 12, opr: 3.6 },
  { nx: 0.30, ny: 0.70, r: 0.11, tint: 3, ax: 0.050, px: 10, ay: 0.030, py: 12, ox: 5.5, oy: 2.7, alpha: 0.351, pa: 7.5, oa: 0.9, rot: -0.22, sw: -0.50, psw: 20, osw: 2.2, rb: 0.20, pr: 15, opr: 5.2 },
  // dark wisps (multiply) — parked on the art's brightest clouds so
  // their drift reshapes them: bottom purple mass, bottom blue mass,
  // the center glow, the top swirl, both flanks, the lobe floors.
  { nx: 0.30, ny: 0.60, r: 0.23, tint: 0, dark: true, ax: 0.055, px: 10, ay: 0.040, py: 12, ox: 1.5, oy: 0.8, alpha: 0.648, pa: 12, oa: 2.4, rot: 0.14, sw: 0.55, psw: 15, osw: 3.4, rb: 0.20, pr: 12, opr: 1.8 },
  { nx: 0.63, ny: 0.57, r: 0.23, tint: 1, dark: true, ax: 0.055, px: 12, ay: 0.040, py: 10, ox: 4.3, oy: 2.1, alpha: 0.621, pa: 15, oa: 0.6, rot: -0.16, sw: -0.55, psw: 12, osw: 0.7, rb: 0.20, pr: 15, opr: 4.7 },
  { nx: 0.48, ny: 0.47, r: 0.21, tint: 2, dark: true, ax: 0.060, px: 7.5, ay: 0.050, py: 7.5, ox: 2.9, oy: 5.0, alpha: 0.594, pa: 10, oa: 4.5, rot: 0.20, sw: 0.70, psw: 10, osw: 5.6, rb: 0.24, pr: 10, opr: 2.3 },
  { nx: 0.53, ny: 0.29, r: 0.19, tint: 0, dark: true, ax: 0.050, px: 10, ay: 0.050, py: 10, ox: 0.3, oy: 3.2, alpha: 0.567, pa: 12, oa: 1.5, rot: -0.12, sw: 0.60, psw: 20, osw: 1.8, rb: 0.20, pr: 7.5, opr: 5.8 },
  { nx: 0.23, ny: 0.43, r: 0.17, tint: 2, dark: true, ax: 0.055, px: 7.5, ay: 0.050, py: 12, ox: 5.6, oy: 4.1, alpha: 0.567, pa: 7.5, oa: 3.4, rot: 0.18, sw: -0.60, psw: 15, osw: 4.4, rb: 0.22, pr: 12, opr: 0.4 },
  { nx: 0.73, ny: 0.44, r: 0.17, tint: 1, dark: true, ax: 0.055, px: 12, ay: 0.050, py: 7.5, ox: 3.8, oy: 1.0, alpha: 0.567, pa: 10, oa: 5.5, rot: -0.20, sw: 0.65, psw: 10, osw: 2.9, rb: 0.22, pr: 10, opr: 3.1 },
  { nx: 0.39, ny: 0.68, r: 0.20, tint: 0, dark: true, ax: 0.050, px: 7.5, ay: 0.030, py: 10, ox: 1.1, oy: 5.9, alpha: 0.621, pa: 15, oa: 2.8, rot: 0.12, sw: 0.50, psw: 12, osw: 5.2, rb: 0.20, pr: 15, opr: 4.2 },
  { nx: 0.68, ny: 0.69, r: 0.19, tint: 1, dark: true, ax: 0.050, px: 10, ay: 0.030, py: 7.5, ox: 4.9, oy: 0.4, alpha: 0.594, pa: 12, oa: 0.9, rot: -0.14, sw: -0.50, psw: 15, osw: 1.2, rb: 0.24, pr: 12, opr: 5.6 },
];

export interface PuffPose { x: number; y: number; r: number; alpha: number; rot: number }

const TAU = Math.PI * 2;

/** A puff's pose at time t (seconds): position in image-fraction coords, radius in image-width fractions. */
export function puffPose(p: SmokePuff, t: number): PuffPose {
  // swirl: the anchor's offset from the glass center, rotated by an
  // oscillating angle — done in image-pixel space so the rotation is
  // round, not elliptical, in the (non-square) fraction space.
  const dx = (p.nx - SWIRL_CX) * EMBLEM_W;
  const dy = (p.ny - SWIRL_CY) * EMBLEM_H;
  const ang = p.sw * Math.sin((TAU * t) / p.psw + p.osw);
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const bx = SWIRL_CX + (dx * cos - dy * sin) / EMBLEM_W;
  const by = SWIRL_CY + (dx * sin + dy * cos) / EMBLEM_H;
  const wx = Math.sin((TAU * t) / p.px + p.ox);
  const wy = Math.sin((TAU * t) / p.py + p.oy);
  // breathing: 0.56..1 of peak, never fully gone — the smoke thins, it doesn't blink
  const breathe = 0.78 + 0.22 * Math.sin((TAU * t) / p.pa + p.oa);
  return {
    x: bx + p.ax * wx,
    y: by + p.ay * wy,
    r: p.r * (1 + p.rb * Math.sin((TAU * t) / p.pr + p.opr)),
    alpha: p.alpha * breathe,
    rot: p.rot * wx,
  };
}
