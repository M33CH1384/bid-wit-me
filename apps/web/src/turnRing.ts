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
