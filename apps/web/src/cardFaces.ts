import { type Card, type TableRules, isJoker, isTrump } from '@spades/rules';
/** a non-spade card promoted to trump (2♦ in the Joker deck): its face carries the trump badge */
export const isPromoted = (c: Card, r: TableRules) => !isJoker(c) && c[1] !== 'S' && isTrump(c, r);
