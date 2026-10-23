import type { Trick } from '@spades/rules';

/**
 * Browsing state for the last-trick readout (owner, 2026-10-23: "Last trick
 * should have a fwd / back option to cycle thru tricks quickly").
 *
 * The selection is an ABSOLUTE index into the current hand's completed
 * tricks, or null while pinned to the newest trick. Absolute — never an
 * offset from the end — so when a new trick lands while the player is
 * looking at an older one, the view stays on the trick they chose instead
 * of sliding forward underneath them. A new hand replaces the tricks
 * array wholesale; the caller clears the selection on hand change and
 * every read here clamps, so a stale index can never point off the end.
 */

/** The index to display: the selection clamped into range, or the newest trick when unpinned. */
export function resolveTrickIndex(selected: number | null, count: number): number {
  if (count <= 0) return -1;
  if (selected === null) return count - 1;
  return Math.min(Math.max(selected, 0), count - 1);
}

/** One step back (delta -1) or forward (+1), clamped at both ends — no wrap. */
export function stepTrickIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  return Math.min(Math.max(index + delta, 0), count - 1);
}

/** The trick to show for a selection, with its resolved index; null when the hand has no completed tricks. */
export function browsedTrick(
  tricks: readonly Trick[],
  selected: number | null,
): { trick: Trick; index: number } | null {
  const index = resolveTrickIndex(selected, tricks.length);
  if (index < 0) return null;
  return { trick: tricks[index]!, index };
}

/** Position line in the readout's voice: the newest trick is the LAST TRICK; anything older names its place. */
export function trickPositionLabel(index: number, count: number): string {
  if (count <= 0 || index >= count - 1) return 'LAST TRICK';
  return `TRICK ${index + 1} OF ${count}`;
}
