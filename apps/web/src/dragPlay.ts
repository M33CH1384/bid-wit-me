/** Drag-to-play: a second way to play, alongside two taps. Pure rules, shared by the scene and tests. */

/** A press only becomes a drag past this many CSS pixels, so a normal tap still selects. */
export const DRAG_THRESHOLD_PX = 10;

export function dragStarted(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}

/**
 * A release plays when it is over the felt / trick area: above the fan (with a small margin)
 * and below the scorebug band at the top of the screen.
 */
export function dropPlays(y: number, handTop: number, screenH: number): boolean {
  return y < handTop - 12 && y > screenH * 0.12;
}

export type DropResult = 'play' | 'snap' | 'shake';

export function dropResult(o: { legal: boolean; y: number; handTop: number; screenH: number }): DropResult {
  if (!o.legal) return 'shake';
  return dropPlays(o.y, o.handTop, o.screenH) ? 'play' : 'snap';
}
