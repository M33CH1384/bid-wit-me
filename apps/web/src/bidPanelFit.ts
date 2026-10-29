/**
 * Bid panel × hand fan fit — which hand geometry may anchor the panel.
 *
 * Table.tsx measures the live hand top and sets --hand-clear so the bid
 * panel's column (.me) rests just above the fan. The 3D hand's geometry
 * arrives via window.__bwmLayout, whose rects the Scene projects from ITS
 * canvas size — and the publish stamps that size (w/h) alongside the rects.
 *
 * Rotation with the panel already open (owner, 2026-10-29: "It's only
 * blocked if I switch from portrait mode when the bid window is showing"):
 * on a flip, window.innerHeight becomes the landscape height at once,
 * while the Scene's size/camera commit trails (rotation rounds 1–3 made it
 * fast, not instant — the round-3 frame hold deliberately keeps the old
 * size until the new frame presents). For that whole window the publish
 * still carries the PORTRAIT canvas's rects. Mixing them with the
 * landscape innerHeight produced a negative clear, which the 60px floor
 * then turned into an anchor sitting ON the fan — the panel covered the
 * cards for exactly as long as the publish stayed stale, and every
 * 400ms tick rewrote the bad value. A fresh open in landscape never saw
 * it: by then the publish had converged.
 *
 * So: a publish whose stamped dims disagree with the live window is the
 * OTHER orientation's geometry and must never anchor the panel. Table
 * drops the inline --hand-clear instead, so the panel rides the current
 * orientation's CSS fallback (solver-proven to clear the fan on its own,
 * see test/bid-panel-fan-fit.test.ts) until the publish converges and
 * the measured clear takes over again.
 */

/** The size stamp a layout publish carries (the Scene's canvas CSS size). */
export interface HandLayoutStamp { w: number; h: number }

/**
 * True when a layout publish cannot describe the live window: its canvas
 * is in the other orientation class, or its dims are more than a
 * rounding band away from the window's. Settled states never trip this —
 * the canvas fills the table screen, so a converged publish's stamp
 * equals the window size.
 */
export function layoutPublishStale(pub: HandLayoutStamp, winW: number, winH: number): boolean {
  if (!(pub.w > 0) || !(pub.h > 0)) return true;
  if ((pub.w > pub.h) !== (winW > winH)) return true;
  if (Math.abs(pub.w - winW) > 32 || Math.abs(pub.h - winH) > 32) return true;
  return false;
}

/**
 * The --hand-clear px for a measured hand top (the panel column rests
 * 6px above the hand), or null when the top falls outside the live
 * viewport — a hand top at or past the window's bottom edge is stale
 * geometry in disguise, not a measurement.
 */
export function handClearPx(top: number, winH: number): number | null {
  if (!Number.isFinite(top) || top < 0 || top >= winH) return null;
  return Math.max(60, Math.round(winH - top + 6));
}
