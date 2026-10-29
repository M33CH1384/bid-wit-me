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
export const SMOKE_LOOP_S = 120;

/** Nebula tints sampled from the artwork (violet → blue). */
export const SMOKE_TINTS: [number, number, number][] = [
  [122, 79, 208], // violet
  [155, 93, 229], // purple
  [96, 72, 205], // deep violet
  [63, 127, 224], // blue
  [96, 165, 255], // light blue
];

export interface SmokePuff {
  /** anchor, in image-fraction coords (0..1 across the painted emblem) */
  nx: number;
  ny: number;
  /** radius, as a fraction of the painted emblem's width */
  r: number;
  /** index into SMOKE_TINTS */
  tint: number;
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
}

/**
 * The puff field: 3 large churn masses (barely-there, they make the
 * whole nebula feel like it's turning over) + 14 wisps. Anchors sit in
 * the glass bulb (y ≈ 0.18..0.72 of the image height); the painted
 * smoke in the art does the heavy lifting — these only move the light.
 */
export const SMOKE_PUFFS: SmokePuff[] = [
  // churn masses
  { nx: 0.38, ny: 0.40, r: 0.46, tint: 0, ax: 0.030, px: 60, ay: 0.022, py: 40, ox: 0.0, oy: 1.7, alpha: 0.075, pa: 30, oa: 0.4, rot: 0.10 },
  { nx: 0.63, ny: 0.47, r: 0.42, tint: 3, ax: 0.034, px: 40, ay: 0.020, py: 60, ox: 2.4, oy: 0.6, alpha: 0.070, pa: 30, oa: 2.2, rot: -0.12 },
  { nx: 0.50, ny: 0.30, r: 0.38, tint: 1, ax: 0.026, px: 30, ay: 0.026, py: 24, ox: 4.1, oy: 3.3, alpha: 0.060, pa: 20, oa: 4.0, rot: 0.08 },
  // wisps
  { nx: 0.34, ny: 0.30, r: 0.17, tint: 1, ax: 0.034, px: 24, ay: 0.028, py: 30, ox: 0.8, oy: 2.9, alpha: 0.16, pa: 20, oa: 1.1, rot: 0.22 },
  { nx: 0.55, ny: 0.24, r: 0.14, tint: 0, ax: 0.030, px: 30, ay: 0.024, py: 24, ox: 3.5, oy: 0.2, alpha: 0.15, pa: 15, oa: 3.9, rot: -0.18 },
  { nx: 0.68, ny: 0.36, r: 0.16, tint: 4, ax: 0.038, px: 20, ay: 0.030, py: 40, ox: 1.9, oy: 4.4, alpha: 0.14, pa: 30, oa: 0.7, rot: 0.26 },
  { nx: 0.27, ny: 0.46, r: 0.19, tint: 0, ax: 0.028, px: 40, ay: 0.022, py: 20, ox: 5.2, oy: 1.3, alpha: 0.17, pa: 20, oa: 5.1, rot: -0.20 },
  { nx: 0.44, ny: 0.48, r: 0.15, tint: 2, ax: 0.040, px: 24, ay: 0.032, py: 30, ox: 2.7, oy: 5.6, alpha: 0.15, pa: 15, oa: 2.6, rot: 0.16 },
  { nx: 0.76, ny: 0.52, r: 0.15, tint: 3, ax: 0.026, px: 30, ay: 0.026, py: 24, ox: 0.4, oy: 3.8, alpha: 0.16, pa: 20, oa: 4.6, rot: -0.24 },
  { nx: 0.58, ny: 0.58, r: 0.18, tint: 4, ax: 0.032, px: 20, ay: 0.020, py: 40, ox: 4.8, oy: 0.9, alpha: 0.13, pa: 30, oa: 1.8, rot: 0.20 },
  { nx: 0.36, ny: 0.62, r: 0.17, tint: 1, ax: 0.036, px: 40, ay: 0.018, py: 20, ox: 1.2, oy: 2.2, alpha: 0.16, pa: 15, oa: 0.3, rot: -0.14 },
  { nx: 0.50, ny: 0.66, r: 0.13, tint: 3, ax: 0.030, px: 24, ay: 0.016, py: 30, ox: 5.8, oy: 4.9, alpha: 0.14, pa: 20, oa: 3.1, rot: 0.28 },
  { nx: 0.22, ny: 0.58, r: 0.13, tint: 2, ax: 0.024, px: 30, ay: 0.024, py: 40, ox: 3.1, oy: 5.3, alpha: 0.13, pa: 30, oa: 5.7, rot: -0.26 },
  { nx: 0.66, ny: 0.68, r: 0.12, tint: 0, ax: 0.028, px: 20, ay: 0.015, py: 24, ox: 0.9, oy: 1.5, alpha: 0.12, pa: 15, oa: 4.2, rot: 0.18 },
  { nx: 0.42, ny: 0.20, r: 0.11, tint: 4, ax: 0.022, px: 40, ay: 0.020, py: 20, ox: 2.2, oy: 0.5, alpha: 0.12, pa: 20, oa: 2.9, rot: -0.16 },
  { nx: 0.80, ny: 0.42, r: 0.11, tint: 1, ax: 0.020, px: 24, ay: 0.028, py: 30, ox: 4.4, oy: 3.6, alpha: 0.12, pa: 30, oa: 1.4, rot: 0.24 },
  { nx: 0.30, ny: 0.70, r: 0.11, tint: 3, ax: 0.026, px: 30, ay: 0.014, py: 40, ox: 5.5, oy: 2.7, alpha: 0.11, pa: 15, oa: 0.9, rot: -0.22 },
];

export interface PuffPose { x: number; y: number; r: number; alpha: number; rot: number }

/** A puff's pose at time t (seconds): position in image-fraction coords, radius in image-width fractions. */
export function puffPose(p: SmokePuff, t: number): PuffPose {
  const wx = Math.sin((2 * Math.PI * t) / p.px + p.ox);
  const wy = Math.sin((2 * Math.PI * t) / p.py + p.oy);
  // breathing: 0.55..1 of peak, never fully gone — the smoke thins, it doesn't blink
  const breathe = 0.775 + 0.225 * Math.sin((2 * Math.PI * t) / p.pa + p.oa);
  return {
    x: p.nx + p.ax * wx,
    y: p.ny + p.ay * wy,
    r: p.r,
    alpha: p.alpha * breathe,
    rot: p.rot * wx,
  };
}
