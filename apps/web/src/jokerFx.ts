/**
 * Detonation clock for the canvas nuke.
 * The blast is the canvas overlay: flash, mushroom, shockwave, whole-screen shake, embers.
 * A joker on the table does not pulse or count down.
 */

export type JokerKind = 'BJ' | 'LJ';

/**
 * How long the detonation clock stays up. The Big Joker matches the canvas blast.
 * The Little Joker win is haptic only, long enough for that pattern.
 */
export const BURST_MS: Record<JokerKind, number> = { BJ: 1800, LJ: 500 };

export interface BurstClock { start: number; kind: JokerKind; reduced: boolean; elapsed: number; last: number }

let burst: BurstClock | null = null;
const listeners = new Set<() => void>();

export function getBurst(): BurstClock | null { return burst; }
export function subscribeBurst(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function startBurst(kind: JokerKind, reduced: boolean, now = performance.now()): BurstClock {
  burst = { start: now, kind, reduced, elapsed: 0, last: 0 };
  listeners.forEach((f) => f());
  return burst;
}
/**
 * Advance the detonation on painted frames. A long hitch (shader compile, a stalled GPU) counts as one
 * frame, so the opening shake still plays when the browser can paint instead of being skipped.
 */
export function advanceBurst(now = performance.now()): BurstClock | null {
  if (!burst) return null;
  if (burst.last) {
    const dt = Math.max(0, now - burst.last);
    // Opening flash stays frame-capped so a hitch cannot skip it. After that, allow a longer
    // step so the mushroom keeps up with the wall clock when a frame is late.
    const cap = burst.elapsed < 300 ? 50 : 200;
    burst.elapsed += Math.min(cap, dt);
  }
  burst.last = now;
  return burst;
}
export function clearBurst(): void {
  if (!burst) return;
  burst = null;
  listeners.forEach((f) => f());
}
