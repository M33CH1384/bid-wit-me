import { type Card, type PlayerView, type Rng, effectiveSuit, isNilBid, isTrump, partnerOf, sideOf, trumpOrder } from '@spades/rules';

/** Estimated tricks for a hand (sure-trick counting heuristic, spec §3.6). */
export function estimateTricks(hand: readonly Card[], v: PlayerView): number {
  const r = v.rules;
  const order = trumpOrder(r);
  const trumps = hand.filter((c) => isTrump(c, r)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const nT = trumps.length;
  let est = 0;
  let high = 0;
  for (const c of trumps) {
    const idx = order.indexOf(c);
    const missingAbove = order.slice(0, idx).filter((x) => !hand.includes(x)).length;
    const lowerMine = trumps.filter((x) => order.indexOf(x) > idx).length;
    if (lowerMine >= missingAbove) { est += 1; high++; }
    else if (lowerMine === missingAbove - 1) est += 0.4;
  }
  // length in trumps (with more trumps in the deck, e.g. 16 in the Joker house order, long trumps are worth less)
  const extraTrumps = Math.max(0, order.length - 13);
  est += Math.max(0, nT - 4 - Math.floor(extraTrumps / 2)) * 0.6;
  let shortness = 0;
  for (const s of ['H', 'D', 'C']) {
    const cards = hand.filter((c) => !isTrump(c, r) && effectiveSuit(c, r) === s);
    const len = cards.length;
    const has = (rk: string) => cards.some((c) => c[0] === rk);
    if (has('A')) est += len <= 6 ? 1 : 0.6;
    if (has('K')) est += has('A') && len >= 2 ? 0.85 : len >= 2 && len <= 5 ? 0.55 : 0.1;
    if (has('Q') && len >= 3 && len <= 4) est += has('A') || has('K') ? 0.35 : 0.2;
    if (len === 0) shortness += 1;
    else if (len === 1 && !has('A')) shortness += 0.6;
    else if (len === 2) shortness += 0.2;
  }
  const spare = Math.max(0, nT - high);
  est += Math.min(shortness, spare * (extraTrumps >= 3 ? 0.55 : 0.75));
  // 3-player games have 17-card hands but only two opponents: high cards are worth slightly more.
  if (r.playerCount === 3) est *= 1.15;
  return est;
}

/** A conservative "can this hand go Nil?" test. */
export function nilWorthy(hand: readonly Card[], v: PlayerView): boolean {
  const r = v.rules;
  const order = trumpOrder(r);
  const trumps = hand.filter((c) => isTrump(c, r));
  if (trumps.length > 3) return false;
  // every trump must be low: in the bottom 7 of the trump order
  if (trumps.some((c) => order.indexOf(c) < order.length - 7)) return false;
  if (trumps.length === 3 && trumps.some((c) => order.indexOf(c) < order.length - 4)) return false;
  for (const s of ['H', 'D', 'C']) {
    const cards = hand.filter((c) => !isTrump(c, r) && effectiveSuit(c, r) === s);
    const len = cards.length;
    const has = (rk: string) => cards.some((c) => c[0] === rk);
    if (has('A')) return false;
    if (has('K') && len < 4) return false;
    if (has('Q') && len < 3) return false;
    if (has('J') && len < 2) return false;
    // need some low cards to duck with
    if (len >= 2 && !cards.some((c) => '23456'.includes(c[0]!))) return false;
  }
  // Without a partner to cover, a Nil has to be much safer.
  if (!r.partnerships && (trumps.length > 2 || trumps.some((c) => order.indexOf(c) < order.length - 5))) return false;
  return estimateTricks(hand, v) < (r.partnerships ? 1.6 : 1.1);
}

export type BotLevel = 'easy' | 'normal';

/** Choose a bid for a revealed hand. */
export function chooseBid(v: PlayerView, level: BotLevel, rng: Rng): number | 'nil' {
  const opt = v.bidOptions!;
  const hand = v.hand!;
  const r = v.rules;
  const partner = partnerOf(v.seat, r);
  const pBid = partner === null ? null : v.bids[partner];
  let est = estimateTricks(hand, v);
  if (level === 'easy') est += rng.float() * 2 - 1;
  const partnerNil = isNilBid(pBid);
  if (level === 'normal' && opt.nil && !partnerNil && nilWorthy(hand, v)) return 'nil';
  if (partnerNil) est += 0.5; // covering a nil partner: we'll be winning extra tricks anyway
  let bid = Math.round(est + (r.partnerships ? 0 : 0.15));
  // Don't overbid the table: total bids above the hand size are a guaranteed set for someone.
  const others = v.bids.reduce<number>((a, b) => a + (typeof b === 'number' ? b : 0), 0);
  const room = r.playerCount === 4 ? 13 : 17;
  if (level === 'normal' && others + bid > room + 1) bid = Math.max(1, room + 1 - others);
  return Math.min(opt.max, Math.max(opt.min, bid, 1));
}

/** Bots decide on Blind Nil before looking (only from scores and the partner's bid). */
export function wantsBlindNil(v: PlayerView, level: BotLevel): boolean {
  const opt = v.bidOptions;
  if (level === 'easy' || !opt?.blindNil) return false;
  const r = v.rules;
  const mine = v.scores[sideOf(v.seat, r)]!;
  const best = Math.max(...v.scores.filter((_, i) => i !== sideOf(v.seat, r)));
  const partner = partnerOf(v.seat, r);
  const pBid = partner === null ? null : v.bids[partner];
  // Only with a partner who has already shown a strong hand to cover (never in Cutthroat).
  // A desperation move: far behind, or the leaders are close to winning.
  const strongPartner = r.blindNil.exchangeCards > 0 ? 4 : 5;
  if (partner === null || typeof pBid !== 'number' || pBid < strongPartner) return false;
  return best - mine >= 350 || (best - mine >= 150 && best >= r.targetScore - 100);
}
