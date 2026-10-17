/** Hand 1 banner: no bids by house rule. `min` is the table's real minimum (hostMinimum). */
export function booksBanner(min: number, partnerships: boolean): string {
  if (min <= 0) return 'First hand: no bids — 10 points per book';
  return `First hand: no bids — ${partnerships ? 'your team must make' : 'make'} at least ${min} books`;
}

/** The house minimum is for the team in partnership games. Your own bid can still start at 1. */
export function minimumChip(min: number, partnerships: boolean): string {
  if (min <= 0) return 'No minimum';
  return partnerships ? `Team minimum ${min}` : `Minimum ${min}`;
}

export function teamMinNote(min: number, partnerships: boolean): string | null {
  if (!partnerships || min <= 0) return null;
  return `Team minimum ${min}: you + partner together. Your own bid can start at 1.`;
}
