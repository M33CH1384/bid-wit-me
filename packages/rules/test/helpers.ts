import { type Card, type GameState, type TableRules, applyAction, bidOrder, buildDeck, newGame } from '../src';

/** A game whose current hand is replaced by the given hands; bidding starts with the first bidder for `dealer` (team games: dealer's left, then dealer's right, dealer's partner, dealer). */
export function rigged(rules: TableRules, hands: Card[][], dealer = 3, seed = 'test'): GameState {
  const st = newGame(rules, seed);
  const n = rules.playerCount;
  return {
    ...st, phase: 'bidding', bids: Array(n).fill(null), dealer, hands: hands.map((h) => [...h]), turn: bidOrder(rules, dealer)[0]!,
    trick: { leader: (dealer + 1) % n, plays: [], winner: null },
    revealed: Array(n).fill(true),
  };
}

/** Applies bids (indexed by SEAT) in bidding order from the current turn, stopping at the first seat with no bid given. */
export function bidAll(st: GameState, bids: (number | 'nil' | 'blindNil' | undefined)[]): GameState {
  while (st.phase === 'bidding' && st.turn !== null && bids[st.turn] !== undefined) st = applyAction(st, { type: 'bid', seat: st.turn, bid: bids[st.turn]! });
  return st;
}

export function play(st: GameState, ...cards: Card[]): GameState {
  for (const card of cards) st = applyAction(st, { type: 'play', seat: st.turn!, card });
  return st;
}

/** 13-card hands for 4 players: deals a sorted deck round-robin. */
export function splitDeck(deck: Card[], n: number): Card[][] {
  const hands: Card[][] = Array.from({ length: n }, () => []);
  deck.forEach((c, i) => hands[i % n]!.push(c));
  return hands;
}

/** Gives each seat its listed cards, then fills every hand to full size with the remaining deck cards in order. */
export function fill(rules: TableRules, partial: Card[][], filler?: Card[]): Card[][] {
  const used = new Set(partial.flat());
  const size = rules.playerCount === 4 ? 13 : 17;
  const rest = (filler ?? buildDeck(rules)).filter((c) => !used.has(c));
  return partial.map((h) => {
    const out = [...h];
    while (out.length < size) out.push(rest.shift()!);
    return out;
  });
}
