/**
 * Timing shared by the table and the 3D cards for a trick that just resolved.
 * The last-trick nuke is the sharp case: the server finishes the trick (and the hand) in one
 * state, including every auto-played card. The client has to hold that trick on the first paint
 * and let those cards wait out their stagger, or the blast starts over a table that already swept.
 */

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
