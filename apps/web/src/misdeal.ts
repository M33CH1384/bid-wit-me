import { fx } from './fx';
import { dealTimeline } from './three/dealTimeline';

/**
 * A called misdeal gets a real moment, in the game's own motion language — never a silent swap:
 *  1. ANNOUNCE + GATHER (`MISDEAL_REVEAL_MS`): the call is announced — who called it, why
 *     (no spades), and who the deal passes to — with the thrown hand face up as the table's
 *     proof, while every hand glides across to the INCOMING dealer's deck spot on the same
 *     glide the end-of-hand collection uses (a misdeal passes the deal like a normal end of
 *     hand, so the pile travels to the seat about to deal). Bids already placed die with the
 *     hand, and the announcement says so.
 *  2. SHUFFLE + DEAL OUT: the card layer restarts the hand's deal (same hand number, fresh deal
 *     epoch), so the normal shuffle + deal flight replays — shuffled and dealt out of the new
 *     dealer's hands, since the deck spot sits in front of whoever holds the deal — a touch
 *     brisker than a fresh hand (`MISDEAL_DEAL_SPEED`) to keep the moment near three seconds.
 *  3. Bidding opens when the last card lands.
 * The sequence rides each source's `dealing` flag for its FULL length (bots, input and dealt
 * slots all wait), online and solo alike, because the reveal rides the synced view
 * (`PlayerView.misdealReveal`) — every seat's client runs the same sequence off the same event.
 * Reduced motion collapses it to the announcement + instant swap.
 */
export const MISDEAL_REVEAL_MS = 1200;
/** Reduced motion: a shorter, snap announcement, then the hand simply swaps. */
export const MISDEAL_REVEAL_REDUCED_MS = 600;
/** The redeal's shuffle + deal timeline runs at this multiple of the table's speed factor. */
export const MISDEAL_DEAL_SPEED = 0.7;

export function misdealRevealMs(reduced: boolean = fx.osReducedMotion): number {
  return reduced ? MISDEAL_REVEAL_REDUCED_MS : MISDEAL_REVEAL_MS;
}

/** How long the redeal's shuffle + deal flight runs (ms) at the table's speed factor `k`. */
export function misdealDealMs(k: number, players: number, cards: number): number {
  return dealTimeline(k * MISDEAL_DEAL_SPEED, players, cards).total * 1000 + 150;
}

/** The full misdeal moment (ms): announcement/gather + the redeal. Sources hold play this long. */
export function misdealSequenceMs(k: number, players: number, cards: number, reduced: boolean = fx.osReducedMotion): number {
  if (reduced) return MISDEAL_REVEAL_REDUCED_MS;
  return misdealRevealMs(false) + misdealDealMs(k, players, cards);
}

/** Identity of one thrown hand, so each reveal is shown once (a resume mid-beat may show it again, briefly). */
export function misdealRevealKey(handNo: number, reveal: { seat: number; cards: readonly string[] } | null | undefined): string | null {
  return reveal ? `${handNo}:${reveal.seat}:${reveal.cards.join('.')}` : null;
}
