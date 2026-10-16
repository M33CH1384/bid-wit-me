/** Velocity slam: how hard a dragged card hits the felt. Pure, shared by the scene, the sender and tests. */

export interface DragSample { t: number; x: number; y: number }

/** Only the last ~80ms of the drag counts toward release speed. */
export const SLAM_WINDOW_MS = 80;
/** Bots, tap plays and plays without a slam field land at this strength. */
export const DEFAULT_SLAM = 0.3;
/** Below this speed (px/ms) a drop is a gentle place; at SLAM_FULL it is a full slam (capped there). */
export const SLAM_SOFT = 0.25;
export const SLAM_FULL = 2.5;

/** Release speed in px/ms over the last SLAM_WINDOW_MS of samples (0 if there is not enough to tell). */
export function releaseVelocity(samples: readonly DragSample[], windowMs = SLAM_WINDOW_MS): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1]!;
  let first = last;
  for (let i = samples.length - 2; i >= 0; i--) {
    first = samples[i]!;
    if (last.t - first.t >= windowMs) break;
  }
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  return Math.hypot(last.x - first.x, last.y - first.y) / dt;
}

/** Speed → intensity 0..1, continuous, clamped so a wild flick is never sillier than a full slam. */
export function slamIntensity(pxPerMs: number): number {
  if (!Number.isFinite(pxPerMs) || pxPerMs <= SLAM_SOFT) return 0;
  return Math.min(1, (pxPerMs - SLAM_SOFT) / (SLAM_FULL - SLAM_SOFT));
}

export interface SlamFeel {
  /** flight seconds from the release point to the trick spot */
  duration: number;
  /** hop height of the flight */
  arc: number;
  /** landing bounce height (world units) */
  bounce: number;
  /** camera shake amplitude (world units); 0 = none */
  shake: number;
  /** slam sound volume 0..1 */
  volume: number;
  /** the intensity this feel came from (drives the card-smack sound) */
  intensity: number;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_SLAM);

export function slamFeel(intensity: number, reducedMotion = false): SlamFeel {
  const i = clamp01(intensity);
  return {
    duration: 0.42 - 0.22 * i,
    arc: 0.22 - 0.16 * i,
    bounce: reducedMotion ? 0.006 : 0.012 + 0.05 * i,
    shake: reducedMotion || i < 0.45 ? 0 : 0.012 + 0.03 * ((i - 0.45) / 0.55),
    volume: 0.45 + 0.55 * i,
    intensity: i,
  };
}

/** A drag release still waiting for its card to show on the table. Read once by the scene. */
export interface PendingDrop { card: string; x: number; y: number; intensity: number; at: number }
let pending: PendingDrop | null = null;
export function noteDrop(d: PendingDrop): void { pending = d; }
export function takeDrop(card: string, now = performance.now()): PendingDrop | null {
  const d = pending;
  if (!d || d.card !== card || now - d.at > 3000) return null;
  return d;
}
export function clearDrop(card: string): void { if (pending?.card === card) pending = null; }
