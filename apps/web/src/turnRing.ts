/**
 * Turn countdown ring. The only inputs are the server clock window
 * (`turnClockStart` … `deadline`). Nothing here invents a timer length.
 */

export const TURN_RING_GOLD = '#f5c542';
export const TURN_RING_RED = '#ff4d6d';
/** The arc shifts from gold to red across this tail of the clock. */
export const TURN_RING_WARN_MS = 5000;
/** Own-turn haptic ticks as the clock crosses 3s, 2s, and 1s. */
export const TURN_BUZZ_MARKS_MS = [3000, 2000, 1000] as const;
/** Circle radius in the 36×36 ring viewBox. Stroke sits just inside the SVG edge. */
export const TURN_RING_R = 16.2;

const GOLD: readonly [number, number, number] = [245, 197, 66];
const RED: readonly [number, number, number] = [255, 77, 109];

export interface TurnRingSample {
  /** Milliseconds until `deadline`. Negative once the clock has run out. */
  remaining: number;
  /** 1 = full (including lead-in, before the clock starts), 0 = deadline. */
  fraction: number;
  color: string;
  track: string;
}

function mixChannel(remainingMs: number): [number, number, number] {
  const t = remainingMs >= TURN_RING_WARN_MS ? 0 : 1 - Math.max(0, remainingMs) / TURN_RING_WARN_MS;
  return [
    Math.round(GOLD[0] + (RED[0] - GOLD[0]) * t),
    Math.round(GOLD[1] + (RED[1] - GOLD[1]) * t),
    Math.round(GOLD[2] + (RED[2] - GOLD[2]) * t),
  ];
}

/** Gold until the last 5s, then a linear shift that lands on red at the deadline. */
export function turnRingColor(remainingMs: number): string {
  if (remainingMs >= TURN_RING_WARN_MS) return TURN_RING_GOLD;
  if (remainingMs <= 0) return TURN_RING_RED;
  const [r, g, b] = mixChannel(remainingMs);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Fraction of the server window still left.
 * `now < start` (deal / trick lead-in) stays full. A shortened deadline
 * (disconnect grace) shrinks the window immediately — the deadline wins.
 */
export function turnRingSample(now: number, start: number, deadline: number): TurnRingSample {
  const span = Math.max(1, deadline - start);
  const remaining = deadline - now;
  const fraction = Math.min(1, Math.max(0, remaining / span));
  const [r, g, b] = mixChannel(remaining);
  return {
    remaining,
    fraction,
    color: turnRingColor(remaining),
    track: `rgba(${r}, ${g}, ${b}, 0.5)`,
  };
}

export function ringDash(fraction: number, radius = TURN_RING_R): { length: number; offset: number; cap: 'round' | 'butt' } {
  const length = 2 * Math.PI * radius;
  const f = Math.min(1, Math.max(0, fraction));
  return { length, offset: length * (1 - f), cap: f > 0.985 ? 'butt' : 'round' };
}

/** Marks crossed while time moved forward. One entry per second in the last 3s. */
export function turnBuzzMarks(prevRemaining: number, remaining: number): number[] {
  if (!(remaining < prevRemaining)) return [];
  return TURN_BUZZ_MARKS_MS.filter((m) => prevRemaining > m && remaining <= m);
}

/**
 * `navigator.vibrate(10)` when the platform has it. Returns false when vibration
 * is off, the page is hidden, or the call is missing / throws.
 */
export function ownTurnBuzz(enabled: boolean): boolean {
  if (!enabled || typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { vibrate?: (ms: number) => boolean };
  if (typeof nav.vibrate !== 'function') return false;
  try { return nav.vibrate(10) !== false; } catch { return false; }
}

/* ------------------------------------------------------------------ fuse --
 * FUSE CLOCK (Wave B rebuild, program row "Fuse Clock"): the burn-down READ
 * of the active player's remaining turn time through its final 5 s. This
 * model is a pure, seekable function of (remainingMs, tMs) — the spark head
 * crawls the fuse exactly with the remaining fraction, and a deterministic
 * ember trail (sin-hash seeded by ember index, never Math.random/Date.now)
 * falls off behind it. It reads the clock only: no timer is created, shifted
 * or blocked here, and nothing appears before the 5 s window opens.
 */

/** The fuse window: the final 5 s of the clock — the ring's warn tail. */
export const FUSE_WINDOW_MS = TURN_RING_WARN_MS;
/** Ember particles trailing the spark head (budget: 7, far under hero caps). */
export const FUSE_EMBER_COUNT = 7;

export interface FuseEmber {
  /** Horizontal offset from the spark head, in fuse-width fractions (≤ 0: behind the head). */
  dx: number;
  /** Vertical fall below the fuse line, 0..1 of the ember lane height. */
  dy: number;
  /** Ember diameter in px. */
  size: number;
  /** 0..1 opacity, hottest nearest the head. */
  alpha: number;
}

export interface FuseSparkFrame {
  /** Inside the final-5s window with time still on the clock. */
  lit: boolean;
  /** Burn progress: 0 = window just opened (5 s left), 1 = deadline. */
  progress: number;
  /** Spark head position along the fuse, as a fraction of its width. */
  head: number;
  /** Deterministic flicker 0..1 (a pure function of tMs, quantized to 40 ms). */
  flicker: number;
  embers: FuseEmber[];
}

function fuseHash(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The spark frame at a moment. `remainingMs` is the clock read (the same
 * sample the ring paints); `tMs` is the caller's rAF clock, passed in so the
 * frame is reproducible for any (remaining, t) pair.
 */
export function fuseSparkFrame(remainingMs: number, tMs: number, calm = false): FuseSparkFrame {
  const lit = remainingMs <= FUSE_WINDOW_MS && remainingMs > 0;
  const progress = Math.min(1, Math.max(0, 1 - remainingMs / FUSE_WINDOW_MS));
  const head = 1 - progress;
  const step = calm ? 0 : Math.floor(tMs / 40);
  const flicker = calm ? 0.65 : 0.55 + 0.45 * fuseHash(step, 7);
  const embers: FuseEmber[] = [];
  if (lit) {
    for (let i = 0; i < FUSE_EMBER_COUNT; i++) {
      // Each ember is born at the head at a seeded phase of the burn and
      // falls behind/below it as progress advances past its birth.
      const birth = fuseHash(i, 13) * 0.85;
      const age = progress - birth;
      if (age < 0) continue;
      const life = Math.min(1, age / 0.14);
      if (life >= 1) continue; // spent — a dead ember is not emitted
      embers.push({
        dx: -life * (0.02 + fuseHash(i, 17) * 0.05),
        dy: life * life * (0.4 + fuseHash(i, 19) * 0.6),
        size: 1 + fuseHash(i, 23) * 1.8 * (1 - life * 0.5),
        alpha: (1 - life) * (0.35 + 0.55 * fuseHash(i, 29)),
      });
    }
  }
  return { lit, progress, head, flicker, embers };
}

export function applyTurnRing(
  root: SVGSVGElement | null,
  track: SVGCircleElement | null,
  glow: SVGCircleElement | null,
  shade: SVGCircleElement | null,
  arc: SVGCircleElement | null,
  sample: TurnRingSample,
): void {
  const { length, offset, cap } = ringDash(sample.fraction);
  const show = sample.fraction > 0.004;
  if (root) {
    root.dataset.fraction = sample.fraction.toFixed(4);
    root.dataset.remaining = String(Math.max(0, Math.round(sample.remaining)));
    root.dataset.color = sample.color;
    root.dataset.hot = sample.remaining < TURN_RING_WARN_MS ? '1' : '0';
  }
  // Inline stroke beats the stylesheet. A presentation attribute does not, so WebKit
  // would keep painting the gold rule through the red tail.
  if (track) track.style.stroke = sample.track;
  const dash = length.toFixed(3);
  const off = offset.toFixed(3);
  for (const el of [glow, shade, arc]) {
    if (!el) continue;
    el.style.strokeDasharray = dash;
    el.style.strokeDashoffset = off;
    el.style.strokeLinecap = cap;
    el.style.opacity = show ? '' : '0';
  }
  if (glow) glow.style.stroke = sample.color;
  if (arc) arc.style.stroke = sample.color;
}
