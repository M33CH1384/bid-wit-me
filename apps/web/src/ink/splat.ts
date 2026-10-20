/**
 * Neon Royale ink — splat math (pure, no DOM, no GL).
 *
 * A "splat" is one injection of dye + velocity into the ink field. Everything
 * here works in FIELD UNITS: the field is 1 unit tall and `aspect` units wide
 * (aspect = viewport width / height), so a radius is a fraction of the screen
 * height and blooms stay circular on any screen shape. The pointer observer
 * in InkLayer converts client pixels to field units; the engine renders the
 * field back out.
 *
 * Qualities the spec demands, and where they come from:
 *  - press = bloom      → pressSplat(): generous radius, no velocity.
 *  - drag pulls + curls → dragSplat() imparts a velocity along the drag
 *    direction; the engine advects existing dye along it, and its analytic
 *    flow field supplies the curl.
 *  - faster = stronger  → strength, radius, imparted velocity, and the color's
 *    shift toward cyan all scale with pointer speed (capped at SPLAT_MAX_SPEED).
 *  - release dissipates → the fields decay exponentially (decayFactor below);
 *    a released trail keeps drifting on its imparted velocity while it fades.
 */

/** One dye + velocity injection into the field. */
export interface InkSplat {
  /** Field units: x ∈ [0, aspect], y ∈ [0, 1] (y up). */
  x: number;
  y: number;
  /** Velocity imparted to the field, field-units per second. */
  vx: number;
  vy: number;
  /** Gaussian radius, in field units (fraction of screen height). */
  radius: number;
  /** Dye amount, 0..1. */
  strength: number;
  /** Dye color, linear-ish 0..1 channels. */
  r: number;
  g: number;
  b: number;
}

/** Pointer speed (field-units/sec) at which strength/color/velocity top out. */
export const SPLAT_MAX_SPEED = 2.4;
/** Fraction of the pointer's velocity handed to the field on a drag. */
export const SPLAT_PULL = 0.38;

export const PRESS_RADIUS = 0.085;
export const PRESS_STRENGTH = 0.6;
export const DRAG_MIN_RADIUS = 0.045;
export const DRAG_MAX_RADIUS = 0.11;

/** Idle ambient currents: faint, wide, slow injections the engine adds on a timer. */
export const AMBIENT_STRENGTH = 0.13;
export const AMBIENT_MIN_RADIUS = 0.18;
export const AMBIENT_MAX_RADIUS = 0.32;

/**
 * Field decay, exponential with a per-second rate. Dye fades slowly (a trail
 * stays visible for seconds, drifting); velocity dies faster, so motion
 * settles before the color is gone. The engine turns these into per-frame
 * factors with decayFactor() so the feel is frame-rate independent.
 */
export const DYE_DECAY_RATE = 0.5;
export const VEL_DECAY_RATE = 1.5;

export function decayFactor(ratePerSec: number, dtSec: number): number {
  if (!(ratePerSec > 0) || !(dtSec > 0)) return 1;
  return Math.exp(-ratePerSec * dtSec);
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Palette ramp stops: violet → electric blue → cyan (the Neon Royale hues). */
const STOPS: readonly (readonly [number, number, number, number])[] = [
  [0, 128 / 255, 84 / 255, 1], // #8054FF violet
  [0.55, 38 / 255, 156 / 255, 1], // #269CFF electric blue
  [1, 91 / 255, 223 / 255, 1], // #5BDFFF cyan
];

/** Ink color at ramp position t (0 = slow/violet, 1 = fast/cyan). */
export function inkColor(t: number): [number, number, number] {
  const x = clamp01(t);
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i]!;
    const b = STOPS[i + 1]!;
    if (x <= a[0]) return [a[1], a[2], a[3]];
    if (x <= b[0]) {
      const f = (x - a[0]) / (b[0] - a[0]);
      if (f >= 1) return [b[1], b[2], b[3]];
      return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
    }
  }
  const last = STOPS[STOPS.length - 1]!;
  return [last[1], last[2], last[3]];
}

/** A press: a localized bloom — wide, still, violet leaning blue. */
export function pressSplat(x: number, y: number): InkSplat {
  const [r, g, b] = inkColor(0.15);
  return { x, y, vx: 0, vy: 0, radius: PRESS_RADIUS, strength: PRESS_STRENGTH, r, g, b };
}

/**
 * A drag segment from (x0, y0) to (x1, y1) covered in dtSec. Returns null when
 * the timing is unusable (stalled or non-monotonic event clock) — the caller
 * still advances its position tracking, it just deposits no ink for that step.
 */
export function dragSplat(x0: number, y0: number, x1: number, y1: number, dtSec: number): InkSplat | null {
  if (!(dtSec >= 0.001) || dtSec > 0.25) return null;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const speed = dist / dtSec;
  const t = clamp01(speed / SPLAT_MAX_SPEED);
  const capped = Math.min(speed, SPLAT_MAX_SPEED);
  const [r, g, b] = inkColor(t);
  return {
    x: x1,
    y: y1,
    vx: dist > 0 ? (dx / dist) * capped * SPLAT_PULL : 0,
    vy: dist > 0 ? (dy / dist) * capped * SPLAT_PULL : 0,
    radius: DRAG_MIN_RADIUS + (DRAG_MAX_RADIUS - DRAG_MIN_RADIUS) * t,
    strength: 0.3 + 0.7 * t,
    r,
    g,
    b,
  };
}

/**
 * Stamps splats along a drag segment so a fast flick lays a continuous trail
 * instead of a dotted line. Writes into `out` (reused by the caller — no
 * allocation per event) and returns how many splats were written. Spacing is
 * ~0.6 × radius; the count is capped so a wild jump can't flood the engine.
 */
export function segmentSplats(x0: number, y0: number, x1: number, y1: number, dtSec: number, out: InkSplat[]): number {
  const base = dragSplat(x0, y0, x1, y1, dtSec);
  if (!base) return 0;
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.min(12, Math.ceil(dist / (base.radius * 0.6))));
  let n = 0;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const s = out[n] ?? (out[n] = { ...base });
    s.x = x0 + (x1 - x0) * f;
    s.y = y0 + (y1 - y0) * f;
    s.vx = base.vx;
    s.vy = base.vy;
    s.radius = base.radius;
    s.strength = base.strength;
    s.r = base.r;
    s.g = base.g;
    s.b = base.b;
    n++;
  }
  return n;
}
