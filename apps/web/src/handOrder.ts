import { type Card, type TableRules, sortHand } from '@spades/rules';

/** Stable identity for a hand card: the card id is suit + rank (`AS`, `10H`, `BJ`). Never an array index. */
export function handCardKey(card: Card): string {
  return card;
}

/** React key for a hand slot. Face-up cards key by id so a play cannot swap identities; only a face-down
 *  placeholder (no id yet) falls back to its index. The key does not include legal / selected state. */
export function handReactKey(handNo: number, card: Card | null, index: number): string {
  return card ? `${handNo}-${handCardKey(card)}` : `${handNo}-hb-${index}`;
}

/**
 * Display order is fixed when the hand is dealt. Playing a card only removes it; the others keep their
 * relative order. A later deal (no cards in common) sorts again. Cards gained in an exchange are inserted
 * by suit without moving the cards already in hand.
 */
export function retainHandOrder(previous: readonly Card[] | null, next: readonly Card[], rules: TableRules): Card[] {
  if (!previous || previous.length === 0) return sortHand(next, rules);
  const nextSet = new Set(next);
  const prevSet = new Set(previous);
  const kept = previous.filter((c) => nextSet.has(c));
  if (kept.length === 0) return sortHand(next, rules);
  const added = sortHand(next.filter((c) => !prevSet.has(c)), rules);
  if (added.length === 0) return kept.slice();
  const ranked = sortHand([...kept, ...added], rules);
  const rank = new Map(ranked.map((c, i) => [c, i]));
  const out: Card[] = [];
  let i = 0;
  let j = 0;
  while (i < kept.length && j < added.length) {
    const ka = kept[i]!;
    const kb = added[j]!;
    if ((rank.get(kb) ?? 0) < (rank.get(ka) ?? 0)) out.push(kb), j++;
    else out.push(ka), i++;
  }
  while (i < kept.length) out.push(kept[i++]!);
  while (j < added.length) out.push(added[j++]!);
  return out;
}

/** Where a card that just left the hand was sitting, so the flight starts there and not at the fan's centre. */
export function departureSlot<T>(slots: ReadonlyMap<string, T>, wasInHand: ReadonlySet<string>, card: Card): T | undefined {
  if (!wasInHand.has(card)) return undefined;
  return slots.get(handCardKey(card));
}
