import { fx } from './fx';

/**
 * A called misdeal throws the caller's whole hand face up on the table — the proof of no spades —
 * and holds it there for a beat before the reshuffle/redeal takes over. 1.8s is long enough for the
 * whole table to actually read 13 cards; with reduced motion the spread snaps in for 0.6s instead.
 * The beat rides each source's `dealing` flag (bots, input and dealt slots all wait on it), online
 * and solo alike, because the reveal rides the synced view (`PlayerView.misdealReveal`).
 */
export const MISDEAL_REVEAL_MS = 1800;
/** Reduced motion: a shorter, snap reveal. */
export const MISDEAL_REVEAL_REDUCED_MS = 600;

export function misdealRevealMs(reduced: boolean = fx.osReducedMotion): number {
  return reduced ? MISDEAL_REVEAL_REDUCED_MS : MISDEAL_REVEAL_MS;
}

/** Identity of one thrown hand, so each reveal is shown once (a resume mid-beat may show it again, briefly). */
export function misdealRevealKey(handNo: number, reveal: { seat: number; cards: readonly string[] } | null | undefined): string | null {
  return reveal ? `${handNo}:${reveal.seat}:${reveal.cards.join('.')}` : null;
}
