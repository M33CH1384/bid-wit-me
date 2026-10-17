import type { Settings } from './settings';

/**
 * Seated at the start of every hand: a saved Standing preference decides the FIRST hand a
 * table shows, but each NEW hand seats the player again. A manual toggle during a hand
 * rules until that hand ends; the next hand seats them again. The saved preference itself
 * is never rewritten by this — it still decides the first view of the next table/session.
 */
export interface HandViewState { seenHand: number | null; autoSeated: boolean }

export const initialHandView: HandViewState = { seenHand: null, autoSeated: false };

/** Call when the table's hand number is observed/changes. */
export function handStarted(s: HandViewState, handNo: number): HandViewState {
  if (s.seenHand === null) return { seenHand: handNo, autoSeated: false }; // first hand seen: saved preference decides
  if (handNo === s.seenHand) return s;
  return { seenHand: handNo, autoSeated: true };
}

/** The player toggled the view themselves: their choice rules until the hand ends. */
export function userToggledView(s: HandViewState): HandViewState {
  return s.autoSeated ? { ...s, autoSeated: false } : s;
}

export function effectiveView(saved: Settings['view'], s: HandViewState): Settings['view'] {
  return s.autoSeated ? 'sitting' : saved;
}
