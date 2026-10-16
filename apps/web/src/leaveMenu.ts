/**
 * The in-game menu's Leave table item.
 *
 * The menu is a backdrop-filter layer. WebKit can deliver the click to the full-screen
 * scrim underneath, which used to only close the menu. A gesture that starts on Leave
 * still leaves. Touch and mouse both act on pointerup; the click that follows is ignored
 * so the confirm dialog's backdrop cannot swallow the same tap. Keyboard fires click alone.
 */

export type LeaveChoice = 'leave' | 'confirm';

/** Online play and a finished game leave immediately. An offline game still in progress asks first. */
export function leaveChoice(online: boolean, phase: string): LeaveChoice {
  return online || phase === 'gameOver' ? 'leave' : 'confirm';
}

export interface LeaveGesture {
  /** Pointer went down on Leave table. */
  armed: boolean;
  /** When that gesture already performed leave, so the following click is ignored. */
  actedAt: number;
}

export type LeaveMenuResult = 'arm' | 'disarm' | 'leave' | 'close' | 'ignore';

export function leaveMenuAction(
  e: { type: 'pointerdown' | 'pointerup' | 'click'; pointerType?: string },
  where: 'leave' | 'scrim' | 'other',
  g: LeaveGesture,
  now: number,
): LeaveMenuResult {
  if (e.type === 'pointerdown') return where === 'leave' ? 'arm' : 'disarm';
  if (e.type === 'pointerup') {
    if (!g.armed || (where !== 'leave' && where !== 'scrim')) return 'ignore';
    return 'leave';
  }
  if (g.actedAt > 0 && now - g.actedAt < 800) return 'ignore';
  if (where === 'leave') return 'leave';
  if (g.armed && where === 'scrim') return 'leave';
  if (where === 'scrim') return 'close';
  return 'ignore';
}
