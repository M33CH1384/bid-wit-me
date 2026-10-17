import { createElement } from 'react';
import { type Card, type TableRules, cardLabel, trumpOrder } from '@spades/rules';

/** How jokers are written. The rung order is always `trumpOrder` (high → low). */
export type JokerStyle = 'short' | 'long' | 'plain' | 'emoji';

const JOKER: Record<JokerStyle, Record<'BJ' | 'LJ', string>> = {
  short: { BJ: 'BJ', LJ: 'LJ' },
  long: { BJ: 'BIG JKR', LJ: 'LIL JKR' },
  plain: { BJ: 'Big Joker', LJ: 'Little Joker' },
  emoji: { BJ: 'Big 🃏', LJ: 'Little 🃏' },
};

/** Spaced so an unspaced › cannot pull 2♠ in front of 2♦ in WebKit. */
export const TRUMP_SEP = ' \u203a ';

export function labelTrump(card: Card, style: JokerStyle): string {
  if (card === 'BJ' || card === 'LJ') return JOKER[style][card];
  return cardLabel(card);
}

/** Trump labels, high → low, taken from the rules ranking. */
export function trumpLadder(r: TableRules, n: number, style: JokerStyle = 'plain'): string[] {
  return trumpOrder(r).slice(0, n).map((c) => labelTrump(c, style));
}

export function trumpLadderText(r: TableRules, n: number, style: JokerStyle = 'plain'): string {
  return trumpLadder(r, n, style).join(TRUMP_SEP);
}

/** Cards ranked above the Ace of spades, besides the jokers, high → low. */
export function promotedTrumpLabels(r: TableRules): string[] {
  const order = trumpOrder(r);
  const aceAt = order.indexOf('AS');
  return order.slice(0, aceAt < 0 ? 0 : aceAt).filter((c) => c !== 'BJ' && c !== 'LJ').map((c) => cardLabel(c));
}

/** One ladder for every surface. Each rung is its own LTR isolate so the deuces cannot swap. */
export function TrumpLadder({ rules, n, style }: { rules: TableRules; n: number; style: JokerStyle }) {
  const rungs = trumpLadder(rules, n, style);
  return createElement('span', { className: 'trump-ladder', dir: 'ltr' }, rungs.map((label, i) => (
    createElement('span', { key: `${i}:${label}`, className: 'trump-rung', dir: 'ltr', 'data-trump': label },
      i > 0 ? createElement('span', { className: 'trump-sep', 'aria-hidden': true }, TRUMP_SEP) : null,
      label)
  )));
}

/** The TRUMPS strip shows through the deal and bidding, and hides once the hand's first card is played. */
export function trumpStripShown(st: { phase: string; tricks: readonly unknown[]; trick: { plays: readonly unknown[] } }): boolean {
  return !(st.phase === 'playing' && (st.tricks.length > 0 || st.trick.plays.length > 0));
}
