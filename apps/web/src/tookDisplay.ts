/**
 * When a plate's TOOK number may move (owner 2026-10-22): the count ticks
 * only once the won cards have landed in that player's book pile — never at
 * trick resolution, while the cards are still sitting on the felt or in
 * flight. Game state and scoring stay authoritative and untouched; this is
 * display timing only.
 *
 * The flight it keys on already exists: when the finished-trick hold ends,
 * the trick joins `piles` in Table and Scene gathers its cards to the
 * winner's pile spot over BOOK_GATHER_MS. Table counts a trick as landed
 * that long after it piles (see the landed-books tracker in Table.tsx);
 * the displayed count is that landed tally, clamped to the true tally so
 * it can never run ahead of the game.
 */

/** Gather flight of a won trick's cards to the pile, in ms. Must match the
 * 'gather' item duration in three/Scene.tsx (0.55 s). */
export const BOOK_GATHER_MS = 550;

/** Books per seat from the first `landed` completed tricks, in trick order.
 * Tricks beyond `landed` are still on the felt or in flight: not counted. */
export function landedTook(
  tricks: readonly { winner: number | null }[],
  landed: number,
  seats: number,
): number[] {
  const out = Array.from({ length: seats }, () => 0);
  const upto = Math.min(Math.max(landed, 0), tricks.length);
  for (let i = 0; i < upto; i++) {
    const w = tricks[i]!.winner;
    if (w != null && w >= 0 && w < seats) out[w]!++;
  }
  return out;
}

/** What the plates may show: the landed tally, never ahead of the truth
 * (a held snapshot — e.g. the pre-Run tallies — caps it until it clears). */
export function shownTook(landed: readonly number[], truth: readonly number[]): number[] {
  return truth.map((t, i) => Math.min(landed[i] ?? 0, t));
}
