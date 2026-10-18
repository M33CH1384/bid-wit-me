import { type Card, type TableRules, isJoker, isTrump, trumpOrder } from '@spades/rules';
/** a non-spade card promoted to trump (2♦ in the Joker deck): its face carries the trump badge */
export const isPromoted = (c: Card, r: TableRules) => !isJoker(c) && c[1] !== 'S' && isTrump(c, r);
/**
 * A wild deuce: a 2 the house trump order lifts above A♠ (2♦ and 2♠ in the
 * default Joker order BJ › LJ › 2♦ › 2♠ › A♠; just 2♠ in classic deuce-high).
 * Both deuces carry the trump badge on their face. Before this, only the
 * off-suit 2♦ was badged (isPromoted), so the 2♠ rendered as a plain low 2
 * even while it was outranking the A♠ on the table — Demetrius, watching a
 * trick: "It doesn't look like the two spades is holding its rank as a
 * wild deuce." The rules always ranked it correctly; the face didn't say so.
 */
export const isWildDeuce = (c: Card, r: TableRules) => {
  if (isJoker(c) || c[0] !== '2' || !isTrump(c, r)) return false;
  const order = trumpOrder(r); // computed order: classic deuce-high inserts 2♠ here, not in trumpOrderTop
  const at = order.indexOf(c), ace = order.indexOf('AS');
  return at !== -1 && ace !== -1 && at < ace;
};
