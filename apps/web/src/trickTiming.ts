/**
 * Timing shared by the table and the 3D cards for a trick that just resolved.
 * The last-trick nuke is the sharp case: the server finishes the trick (and the hand) in one
 * state, including every auto-played card. The client has to hold that trick on the first paint
 * and let those cards wait out their stagger, or the blast starts over a table that already swept.
 *
 * Hand end (the score screen) is a different clock from the mid-hand sweep:
 *  - normal: HAND_END_REVEAL_MS from the play (700 ms after the 500 ms flight, at normal speed)
 *  - nuke: the mid-hand trick hold plus that level's allowance, then the score — the blast is the wait
 *  - Run it!: RUN_SHOW_MS, then the score — the tornado is the wait
 * Scoring toasts (3200 ms) and the old 1200 ms beat used to run after all of these. They don't anymore.
 */
import { NUKE_ALLOWANCE_MS, TRICK_HOLD_MS, HAND_END_REVEAL_MS, type NukeIntensity } from '@spades/protocol';
import { RUN_SHOW_MS } from './runIt';

export { TRICK_HOLD_MS, HAND_END_REVEAL_MS, RUN_SHOW_MS };

/** Cards flying to the book pile (Scene duration 0.55 s). Starts as the score opens; it does not delay the screen. */
export const TRICK_SWEEP_MS = 550;
/** Scoring toasts stay up this long. They used to gate the score screen; they don't anymore. */
export const SCORE_TOAST_MS = 3200;

/**
 * How long `pause` stays up after a trick resolves.
 * `speed` is the table speed multiplier (1 = normal). Nuke allowance and the run show are not scaled:
 * those animations play at a fixed length. A hand-ending trick with neither show uses the reveal
 * window (the flight plus a short beat) and nothing after it.
 */
export function finishedTrickHoldMs(opts: {
  speed: number;
  handEnding: boolean;
  run: boolean;
  nuke: NukeIntensity | null;
}): number {
  if (opts.run) return RUN_SHOW_MS;
  const scaled = Math.round((opts.handEnding ? HAND_END_REVEAL_MS : TRICK_HOLD_MS) * opts.speed);
  if (opts.nuke) return Math.round(TRICK_HOLD_MS * opts.speed) + NUKE_ALLOWANCE_MS[opts.nuke];
  return scaled;
}

/** What to do with the on-table trick when a newer state arrives. */
export function nextTrickPause(
  prev: { handNo: number; trickCount: number } | null,
  next: { handNo: number; trickCount: number },
): 'hold' | 'release' | 'same' {
  if (!prev) return 'same';
  if (next.handNo !== prev.handNo) return 'release';
  if (next.trickCount > prev.trickCount) return 'hold';
  return 'same';
}

/**
 * How long a card waits before flying to a new target.
 * Returns null when the card is already in flight (don't restart the auto-play stagger on a
 * layout nudge). A resting card — including the player's last card, which keeps its hand key
 * when the server auto-plays it — waits out `delay`.
 */
export function restingFlightWait(delay: number | undefined, wasResting: boolean): number | null {
  if (!wasResting) return null;
  return delay ?? 0;
}
