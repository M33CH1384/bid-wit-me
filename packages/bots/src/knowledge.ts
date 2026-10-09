import {
  type Card, type PlayerView, type Play, type TableRules,
  buildDeck, cardPower, effectiveSuit, handSize, isNilBid, isTrump, partnerOf, sideOf, trickWinner,
} from '@spades/rules';

/** Derived facts a bot uses for decisions; computed only from the seat's view (no peeking). */
export interface Knowledge {
  v: PlayerView;
  r: TableRules;
  hand: Card[];
  seat: number;
  n: number;
  partner: number | null;
  /** Cards not in my hand and not yet played. */
  unseen: Set<Card>;
  plays: readonly Play[];
  remainingTricks: number;
  /** My side's (non-nil) contract and tricks that count for it. */
  need: number;
  oppNeed: number;
  myNil: boolean;
  partnerCleanNil: boolean;
  oppCleanNils: number[];
}

export function cleanNil(v: PlayerView, s: number): boolean {
  return isNilBid(v.bids[s]) && v.tricksWon[s] === 0;
}

function sideNeed(v: PlayerView, side: number): number {
  const r = v.rules;
  let contract = 0, tricks = 0;
  for (let s = 0; s < r.playerCount; s++) {
    if (sideOf(s, r) !== side) continue;
    const b = v.bids[s];
    if (typeof b === 'number') { contract += b; tricks += v.tricksWon[s]!; }
    else if (r.nilTricksCountForPartner) tricks += v.tricksWon[s]!;
  }
  return contract - tricks;
}

export function know(v: PlayerView): Knowledge {
  const r = v.rules;
  const hand = v.hand ?? [];
  const played = new Set<Card>();
  for (const t of v.tricks) for (const p of t.plays) played.add(p.card);
  for (const p of v.trick.plays) played.add(p.card);
  const unseen = new Set(buildDeck(r).filter((c) => !played.has(c) && !hand.includes(c)));
  const partner = partnerOf(v.seat, r);
  const mySide = sideOf(v.seat, r);
  const opps = Array.from({ length: r.playerCount }, (_, i) => i).filter((s) => s !== v.seat && s !== partner);
  const oppSides = [...new Set(opps.map((s) => sideOf(s, r)))];
  return {
    v, r, hand, seat: v.seat, n: r.playerCount, partner, unseen, plays: v.trick.plays,
    remainingTricks: handSize(r) - v.tricks.length,
    need: sideNeed(v, mySide),
    oppNeed: Math.max(...oppSides.map((s) => sideNeed(v, s))),
    myNil: isNilBid(v.bids[v.seat]),
    partnerCleanNil: partner !== null && cleanNil(v, partner),
    oppCleanNils: opps.filter((s) => cleanNil(v, s)),
  };
}

export const power = (k: Knowledge, c: Card): number => cardPower(c, k.r);
export const suitOf = (k: Knowledge, c: Card): string => effectiveSuit(c, k.r);
export const trump = (k: Knowledge, c: Card): boolean => isTrump(c, k.r);

/** No unseen card of the same effective suit outranks this card. */
export function isBoss(k: Knowledge, c: Card): boolean {
  const s = suitOf(k, c), p = power(k, c);
  for (const u of k.unseen) if (suitOf(k, u) === s && power(k, u) > p) return false;
  return true;
}

/** Would this card currently win the trick in progress? */
export function winsNow(k: Knowledge, c: Card): boolean {
  if (!k.plays.length) return true;
  return trickWinner([...k.plays, { seat: k.seat, card: c }], k.r) === k.seat;
}

export function currentWinner(k: Knowledge): number | null {
  return k.plays.length ? trickWinner(k.plays, k.r) : null;
}

export const byPowerAsc = (k: Knowledge) => (a: Card, b: Card) => {
  const ta = trump(k, a) ? 1 : 0, tb = trump(k, b) ? 1 : 0;
  if (ta !== tb) return ta - tb; // non-trumps first when "low"
  return power(k, a) - power(k, b);
};

export function lowest(k: Knowledge, cards: Card[]): Card {
  return [...cards].sort(byPowerAsc(k))[0]!;
}

export function highest(k: Knowledge, cards: Card[]): Card {
  return [...cards].sort((a, b) => power(k, b) - power(k, a))[0]!;
}

export function suitLength(k: Knowledge, suit: string): number {
  return k.hand.filter((c) => suitOf(k, c) === suit).length;
}
