import type { Card } from './cards';
import { type TableRules, buildDeck, cardPower, effectiveSuit, handSize, isTrump, shotOutOn, validateRules, RulesConfigError } from './config';
import { evaluateRunIt } from './runIt';
import { createRng, shuffle } from './rng';
import {
  type Bid, type GameResult, type SideHandResult,
  checkGameEnd, isBooksHand, isNilBid, isShot, partnerOf, scoreHand, shotOutResult, shotOutSides, sideCount, sideOf,
} from './scoring';

export type Seat = number;
export type Phase = 'bidding' | 'exchange' | 'playing' | 'handOver' | 'gameOver';

/** `auto`: played automatically when both Jokers landed in the trick (the nuke auto-finish); counts as that seat's play. */
export interface Play { seat: Seat; card: Card; auto?: true; /** played out by a 'Run it!' claim */ run?: true }
export interface Trick { leader: Seat; plays: Play[]; winner: Seat | null }
export interface ExchangeStep { from: Seat; to: Seat; count: number }

export interface HandRecord {
  handNo: number;
  dealer: Seat;
  bids: Bid[];
  tricksWon: number[];
  sides: SideHandResult[];
}

export interface GameState {
  rules: TableRules;
  seed: string;
  phase: Phase;
  handNo: number; // 1-based
  dealer: Seat;
  turn: Seat | null;
  hands: Card[][];
  bids: (Bid | null)[];
  /** False while a player may still choose Blind Nil without having looked at their cards. */
  revealed: boolean[];
  exchange: ExchangeStep[];
  trick: Trick;
  /** Completed tricks this hand. */
  tricks: Trick[];
  tricksWon: number[];
  spadesBroken: boolean;
  /** Per side. */
  scores: number[];
  bags: number[];
  history: HandRecord[];
  result: GameResult | null;
  /** Per side: Big-over-Little-Joker nukes dropped this game (set only once one happens). */
  nukes?: number[];
}

export type Action =
  | { type: 'reveal'; seat: Seat }
  | { type: 'bid'; seat: Seat; bid: Bid }
  | { type: 'exchange'; seat: Seat; cards: Card[] }
  | { type: 'play'; seat: Seat; card: Card }
  /** 'Run it!': `seat` claims every remaining trick, any time in trick play (only legal when canRunIt proves it) */
  | { type: 'runIt'; seat: Seat }
  | { type: 'nextHand' };

export type RuleErrorCode =
  | 'WRONG_PHASE' | 'NOT_YOUR_TURN' | 'BAD_SEAT' | 'BAD_BID' | 'BID_TOO_LOW' | 'NIL_NOT_ALLOWED'
  | 'BLIND_NIL_NOT_ALLOWED' | 'CARD_NOT_IN_HAND' | 'MUST_FOLLOW_SUIT' | 'SPADES_NOT_BROKEN'
  | 'MUST_LEAD_TWO_OF_CLUBS' | 'BAD_EXCHANGE' | 'ALREADY_REVEALED' | 'CANNOT_RUN_IT';

export class RuleError extends Error {
  constructor(public readonly code: RuleErrorCode, message: string) {
    super(message);
    this.name = 'RuleError';
  }
}

/* -------------------------------------------------------------- setup/deal */

/**
 * A new game. The first dealer is random (seeded) unless `opts.dealer` is given — a rematch continues the rotation
 * (`nextDealer(previous game)`). The deal then moves clockwise one seat per hand (seat + 1 = the next seat clockwise
 * on screen: you at the bottom, then left, top, right), and the player to the dealer's left bids and leads first.
 */
export function newGame(rules: TableRules, seed: string | number, opts: { dealer?: number } = {}): GameState {
  const problems = validateRules(rules);
  if (problems.length) throw new RulesConfigError(problems);
  const n = rules.playerCount;
  const s = String(seed);
  const dealer = opts.dealer !== undefined && opts.dealer >= 0 && opts.dealer < n ? opts.dealer : createRng(`${s}:dealer`).int(n);
  const base: GameState = {
    rules, seed: s, phase: 'bidding', handNo: 0, dealer, turn: null,
    hands: [], bids: [], revealed: [], exchange: [],
    trick: { leader: 0, plays: [], winner: null }, tricks: [], tricksWon: [], spadesBroken: false,
    scores: Array(sideCount(rules)).fill(0), bags: Array(sideCount(rules)).fill(0),
    history: [], result: null,
  };
  return dealHand(base, 1, dealer);
}

/** The dealer for a rematch: one seat clockwise from whoever dealt the last hand of `prev`. */
export function nextDealer(prev: Pick<GameState, 'dealer' | 'rules'>, rules: TableRules = prev.rules): number {
  return (prev.dealer + 1) % rules.playerCount;
}

/** Shuffled deck for a given hand; deterministic from the game seed. */
export function deckForHand(rules: TableRules, seed: string, handNo: number): Card[] {
  return shuffle(buildDeck(rules), createRng(`${seed}:hand:${handNo}`));
}

/**
 * Bidding order for a hand. Team games: the team WITHOUT the deal bids first, both partners back to back (dealer's left,
 * then dealer's right), then the dealer's team: the dealer's partner, and the dealer last. With seats clockwise
 * D, L, P, R that is L, R, P, D. Cutthroat: clockwise from the dealer's left. (Play order is always clockwise from the
 * dealer's left.)
 */
export function bidOrder(r: Pick<TableRules, 'partnerships' | 'playerCount'>, dealer: Seat): Seat[] {
  const n = r.playerCount;
  if (r.partnerships && n === 4) return [1, 3, 2, 0].map((k) => (dealer + k) % 4);
  return Array.from({ length: n }, (_, k) => (dealer + 1 + k) % n);
}
/** Who bids after `seat` this hand (null when `seat` is the last bidder). */
export function nextBidder(st: Pick<GameState, 'rules' | 'dealer' | 'bids'>, seat: Seat): Seat | null {
  const order = bidOrder(st.rules, st.dealer);
  const i = order.indexOf(seat);
  for (let k = i + 1; k < order.length; k++) if (st.bids[order[k]!] === null) return order[k]!;
  return null;
}

function dealHand(prev: GameState, handNo: number, dealer: Seat): GameState {
  const r = prev.rules;
  const n = r.playerCount;
  const deck = deckForHand(r, prev.seed, handNo);
  const hands: Card[][] = Array.from({ length: n }, () => []);
  // one at a time clockwise, starting left of the dealer
  deck.forEach((c, i) => hands[(dealer + 1 + i) % n]!.push(c));
  const st: GameState = {
    ...prev, phase: 'bidding', handNo, dealer, turn: bidOrder(r, dealer)[0]!,
    hands, bids: Array(n).fill(null), revealed: Array(n).fill(true), exchange: [],
    trick: { leader: (dealer + 1) % n, plays: [], winner: null }, tricks: [],
    tricksWon: Array(n).fill(0), spadesBroken: false,
  };
  if (handNo === 1 && r.firstHandBidsItself) {
    // "First hand: books bid themselves": no bidding, straight to play; every book scores 10
    return startPlay({ ...st, bids: Array(n).fill('books') });
  }
  st.revealed = st.revealed.map((_, seat) => !blindNilScoreEligible(st, seat));
  return st;
}

/** True when this hand skipped bidding (first hand: books bid themselves). */
export function booksHand(st: Pick<GameState, 'bids'>): boolean {
  return isBooksHand(st.bids);
}

/**
 * A hand that was just dealt and nobody has acted yet (clients run the shuffle + deal animation; the server waits).
 * Works for normal hands (bidding, no bids yet) and for the books hand (play, no cards played yet).
 */
export function isFreshDeal(st: Pick<GameState, 'phase' | 'bids' | 'tricks' | 'trick'>): boolean {
  if (st.phase === 'bidding') return st.bids.every((b) => b === null);
  return st.phase === 'playing' && isBooksHand(st.bids) && st.tricks.length === 0 && st.trick.plays.length === 0;
}

/* ----------------------------------------------------------------- bidding */

function blindNilScoreEligible(st: GameState, seat: Seat): boolean {
  const r = st.rules;
  if (!r.blindNil.allowed) return false;
  if (r.blindNil.onlyWhenBehindBy === null) return true;
  const mine = sideOf(seat, r);
  const best = Math.max(...st.scores.filter((_, i) => i !== mine));
  return best - st.scores[mine]! >= r.blindNil.onlyWhenBehindBy;
}

export interface BidOptions {
  min: number;
  max: number;
  nil: boolean;
  blindNil: boolean;
}

/** Bids available to `seat` right now (ignores whose turn it is). */
export function bidOptions(st: GameState, seat: Seat): BidOptions {
  const r = st.rules;
  const max = handSize(r);
  const partner = partnerOf(seat, r);
  const pBid = partner === null ? null : st.bids[partner];
  let min = Math.max(1, r.minTeamBid);
  if (partner !== null && typeof pBid === 'number') min = Math.max(1, r.minTeamBid - pBid);
  else if (partner !== null && pBid === null) min = 1; // partner bids second and must reach the minimum
  min = Math.min(min, max);
  const partnerNil = isNilBid(pBid);
  const nilOk = !partnerNil || r.partnerMayAlsoNil;
  return {
    min, max,
    nil: r.nil.allowed && nilOk,
    blindNil: r.blindNil.allowed && nilOk && !st.revealed[seat] && blindNilScoreEligible(st, seat),
  };
}

/* ------------------------------------------------------------------ tricks */

/** Current winner of a (partial or full) trick. */
export function trickWinner(plays: readonly Play[], r: TableRules): Seat {
  if (!plays.length) throw new Error('empty trick');
  let best = plays[0]!;
  for (const p of plays.slice(1)) {
    const pt = isTrump(p.card, r), bt = isTrump(best.card, r);
    if (pt && !bt) best = p;
    else if (pt === bt && effectiveSuit(p.card, r) === effectiveSuit(best.card, r) && cardPower(p.card, r) > cardPower(best.card, r)) best = p;
  }
  return best.seat;
}

/**
 * Legal cards from `hand` given the current trick (pure; used by server, client, and bots).
 * `mustLeadTwoOfClubs` applies to the opening lead when firstLead = twoOfClubs.
 */
export function legalPlaysFor(
  r: TableRules, hand: readonly Card[], trickPlays: readonly Play[], spadesBroken: boolean, mustLeadTwoOfClubs = false,
): Card[] {
  if (trickPlays.length === 0) {
    if (mustLeadTwoOfClubs && hand.includes('2C')) return ['2C'];
    if (r.spadesMustBeBroken && !spadesBroken) {
      const non = hand.filter((c) => !isTrump(c, r));
      if (non.length) return non;
    }
    return [...hand];
  }
  const led = effectiveSuit(trickPlays[0]!.card, r);
  const follow = hand.filter((c) => effectiveSuit(c, r) === led);
  return follow.length ? follow : [...hand];
}

/**
 * Nuke auto-finish (last trick only): the card a seat plays automatically once both Jokers are in the trick — its LOWEST LEGAL card
 * (follow the led suit if it can; otherwise its lowest non-trump; otherwise its lowest trump). Renege rules hold
 * because the pick always comes from legalPlaysFor.
 */
export function lowestLegal(r: TableRules, hand: readonly Card[], trickPlays: readonly Play[], spadesBroken: boolean): Card {
  const legal = legalPlaysFor(r, hand, trickPlays, spadesBroken);
  const non = legal.filter((c) => !isTrump(c, r));
  const pool = non.length ? non : legal;
  // lowest by rank first (cardPower is comparable within a suit and roughly by rank across suits), ties by suit order
  return [...pool].sort((a, b) => cardPower(a, r) - cardPower(b, r) || (a < b ? -1 : 1))[0]!;
}

/**
 * Last trick of the hand, the Big Joker is on the table and the Little Joker hasn't shown up anywhere this hand: by
 * elimination someone still to play holds it, so the Big Joker "goes radioactive". Public information only.
 */
export function radioactiveBigJoker(st: Pick<GameState, 'rules' | 'phase' | 'tricks' | 'trick'>): boolean {
  if (st.rules.deck !== 'joker54' || st.phase !== 'playing' || st.tricks.length !== handSize(st.rules) - 1) return false;
  if (!st.trick.plays.some((p) => p.card === 'BJ')) return false;
  return !st.trick.plays.some((p) => p.card === 'LJ') && !st.tricks.some((t) => t.plays.some((p) => p.card === 'LJ'));
}

/**
 * A nuked trick: both Jokers fell in it, in EITHER order (Little then Big, or Big then Little — the Big Joker wins
 * either way). Every client/server hold ("nuke allowance") keys off this, so the trick stays on the table for the blast.
 * A Run it! trick never counts (the tornado is the show).
 */
export function isNukeTrick(plays: readonly { card: Card; run?: boolean }[]): boolean {
  if (plays.some((p) => p.run)) return false;
  return plays.some((p) => p.card === 'BJ') && plays.some((p) => p.card === 'LJ');
}

/* ------------------------------------------------------------- Run it! */

/** 'Run it!' is a late-hand claim: 2..RUN_IT_MAX cards left (any turn, see canRunIt). */
export const RUN_IT_MAX = 4;

/**
 * Full-information line for PLAYING OUT a claim that was already proved from the claimer's own view.
 * Used only after `canRunIt` says yes, so the yes/no itself never depends on which hidden hand holds which card.
 * The cards are about to be face up anyway. Trump order, Ace Down, following suit, breaking spades and the
 * last-trick nuke all come from the real engine (`applyAction`).
 */
function runSolver(seat: Seat) {
  const memo = new Map<string, boolean>();
  const key = (s: GameState) => s.hands.map((h) => [...h].sort().join('.')).join('|') + '/' + s.trick.plays.map((p) => `${p.seat}${p.card}`).join(',') + (s.spadesBroken ? '!' : '') + s.turn;
  const won = (s: GameState, from: number) => { for (let i = from; i < s.tricks.length; i++) if (s.tricks[i]!.winner !== seat) return false; return true; };
  /** true when every trick completed from here (index ≥ done) goes to `seat` */
  const ok = (s: GameState, done: number): boolean => {
    if (!won(s, done)) return false;
    if (s.phase !== 'playing' || (s.hands[seat]!.length === 0 && s.trick.plays.length === 0)) return true;
    const k = key(s);
    const m = memo.get(k);
    if (m !== undefined) return m;
    const who = s.turn!;
    const legal = legalPlays(s, who);
    const next = (c: Card) => ok(applyAction(s, { type: 'play', seat: who, card: c }), s.tricks.length);
    const r = who === seat ? legal.some(next) : legal.every(next);
    memo.set(k, r);
    return r;
  };
  /** the claimer's card now (its turn) that keeps the guarantee, or null */
  const pick = (s: GameState): Card | null => legalPlays(s, seat).find((c) => ok(applyAction(s, { type: 'play', seat, card: c }), s.tricks.length)) ?? null;
  return { ok, pick };
}

/**
 * True when `seat` may claim 'Run it!' (Release 10): 2..RUN_IT_MAX cards left and every remaining trick — the one on
 * the table included — is guaranteed to be theirs against every way the unseen cards could be split. Any time during
 * trick play: on lead, following, or even when it's not their turn. With 1 card left there's nothing to claim: it
 * just plays. Every mode (2v2, Cutthroat 3/4, Ace Down). Memoized once per seat per state; see `evaluateRunIt`.
 */
export function canRunIt(st: GameState, seat: Seat): boolean {
  return evaluateRunIt(st, seat);
}

/**
 * Plays a guaranteed 'Run it!' out as if it were played: each trick the claimer leads a proven winning card, everyone
 * else plays their lowest legal card; every play is marked `run`. Equivalent to playing it out, so scoring, history,
 * stats and the nuke trigger all stay exact.
 */
function playOutRun(st: GameState, seat: Seat): GameState {
  if (!canRunIt(st, seat)) throw new RuleError('CANNOT_RUN_IT', 'Running the rest is only allowed when every remaining book is guaranteed');
  const fromTricks = st.tricks.length;
  const onTable = st.trick.plays.length;
  const solver = runSolver(seat);
  let s = st;
  // the rest of the hand as if played: the claimer plays a proven card, everyone else their lowest legal card
  while (s.phase === 'playing') {
    const who = s.turn!;
    const card = who === seat ? solver.pick(s) : lowestLegal(s.rules, s.hands[who]!, s.trick.plays, s.spadesBroken);
    if (!card) throw new Error('run it: lost the guaranteed line'); // can't happen: proven for every response
    s = applyAction(s, { type: 'play', seat: who, card });
  }
  // every play from the claim on is marked `run` (cards already on the table when it was claimed are not)
  return { ...s, tricks: s.tricks.map((t, i) => (i < fromTricks ? t : { ...t, plays: t.plays.map((p, k) => (i === fromTricks && k < onTable ? p : { ...p, run: true as const })) })) };
}

/**
 * Each seat's cards a resolved 'Run it!' cleared (the claimer's included), in the order they were played out.
 * Read only from plays already marked `run`, which do not exist until the claim has resolved.
 * Null while the claim is still unmade — this is not a look at cards still in hand.
 */
export function runClearedHands(st: Pick<GameState, 'rules' | 'tricks'>): Card[][] | null {
  const hands: Card[][] = Array.from({ length: st.rules.playerCount }, () => []);
  let any = false;
  for (const t of st.tricks) for (const p of t.plays) if (p.run) {
    any = true;
    hands[p.seat]!.push(p.card);
  }
  return any ? hands : null;
}

/** Both Jokers are in this (partial) trick: the nuke. */
export function jokersMet(plays: readonly Play[]): boolean {
  return plays.some((p) => p.card === 'BJ') && plays.some((p) => p.card === 'LJ');
}

function mustLead2C(st: GameState): boolean {
  return st.rules.firstLead === 'twoOfClubs' && st.tricks.length === 0;
}

export function legalPlays(st: GameState, seat: Seat): Card[] {
  if (st.phase !== 'playing' || st.turn !== seat) return [];
  return legalPlaysFor(st.rules, st.hands[seat]!, st.trick.plays, st.spadesBroken, mustLead2C(st));
}

function explainIllegal(st: GameState, seat: Seat, card: Card): RuleError {
  const r = st.rules;
  const hand = st.hands[seat]!;
  if (!hand.includes(card)) return new RuleError('CARD_NOT_IN_HAND', `${card} is not in seat ${seat}'s hand`);
  if (st.trick.plays.length === 0) {
    if (mustLead2C(st) && hand.includes('2C')) return new RuleError('MUST_LEAD_TWO_OF_CLUBS', 'The 2♣ must lead the first trick');
    return new RuleError('SPADES_NOT_BROKEN', 'Spades have not been broken');
  }
  void r;
  return new RuleError('MUST_FOLLOW_SUIT', 'You must follow the suit led');
}

/* ----------------------------------------------------------------- reducer */

function firstLeader(st: GameState): Seat {
  if (st.rules.firstLead === 'twoOfClubs') {
    const h = st.hands.findIndex((hand) => hand.includes('2C'));
    if (h >= 0) return h;
  }
  return (st.dealer + 1) % st.rules.playerCount;
}

function startPlay(st: GameState): GameState {
  const leader = firstLeader(st);
  return { ...st, phase: 'playing', exchange: [], turn: leader, trick: { leader, plays: [], winner: null } };
}

function exchangeSteps(st: GameState): ExchangeStep[] {
  const r = st.rules;
  if (!r.partnerships || r.blindNil.exchangeCards === 0) return [];
  const steps: ExchangeStep[] = [];
  const done = new Set<Seat>();
  for (let i = 1; i <= r.playerCount; i++) {
    const s = (st.dealer + i) % r.playerCount;
    if (st.bids[s] !== 'blindNil' || done.has(s)) continue;
    const p = partnerOf(s, r)!;
    steps.push({ from: s, to: p, count: r.blindNil.exchangeCards }, { from: p, to: s, count: r.blindNil.exchangeCards });
    done.add(s).add(p);
  }
  return steps;
}

/** Applies an action and returns the new state. Throws RuleError on illegal actions. Never mutates `st`. */
export function applyAction(st: GameState, action: Action): GameState {
  const r = st.rules;
  const n = r.playerCount;
  if (action.type === 'nextHand') {
    if (st.phase !== 'handOver') throw new RuleError('WRONG_PHASE', 'Hand is not over');
    return dealHand(st, st.handNo + 1, (st.dealer + 1) % n);
  }
  const seat = action.seat;
  if (!Number.isInteger(seat) || seat < 0 || seat >= n) throw new RuleError('BAD_SEAT', `Bad seat ${seat}`);

  switch (action.type) {
    case 'reveal': {
      if (st.phase !== 'bidding') throw new RuleError('WRONG_PHASE', 'Not bidding');
      if (st.bids[seat] !== null) throw new RuleError('WRONG_PHASE', 'Already bid');
      if (st.revealed[seat]) throw new RuleError('ALREADY_REVEALED', 'Cards already revealed');
      const revealed = [...st.revealed];
      revealed[seat] = true;
      return { ...st, revealed };
    }
    case 'bid': {
      if (st.phase !== 'bidding') throw new RuleError('WRONG_PHASE', 'Not bidding');
      if (st.turn !== seat) throw new RuleError('NOT_YOUR_TURN', 'Not your turn to bid');
      const bid: Bid = action.bid === 0 ? 'nil' : action.bid;
      if (bid === 'books') throw new RuleError('BAD_BID', 'Books is not a bid you can choose');
      const opt = bidOptions(st, seat);
      if (bid === 'nil') {
        if (!opt.nil) throw new RuleError('NIL_NOT_ALLOWED', 'Nil is not allowed');
      } else if (bid === 'blindNil') {
        if (!opt.blindNil) throw new RuleError('BLIND_NIL_NOT_ALLOWED', 'Blind Nil is not allowed');
      } else {
        if (typeof bid !== 'number' || !Number.isInteger(bid) || bid < 0 || bid > opt.max) throw new RuleError('BAD_BID', `Bid must be 0–${opt.max}`);
        if (bid < opt.min) throw new RuleError('BID_TOO_LOW', `Minimum bid is ${opt.min}`);
      }
      const bids = [...st.bids];
      bids[seat] = bid;
      const revealed = [...st.revealed];
      revealed[seat] = true;
      let next: GameState = { ...st, bids, revealed, turn: nextBidder({ ...st, bids }, seat) ?? (seat + 1) % n };
      if (bids.every((b) => b !== null)) {
        const steps = exchangeSteps(next);
        next = steps.length ? { ...next, phase: 'exchange', exchange: steps, turn: steps[0]!.from } : startPlay(next);
      }
      return next;
    }
    case 'exchange': {
      if (st.phase !== 'exchange') throw new RuleError('WRONG_PHASE', 'No exchange in progress');
      const step = st.exchange[0]!;
      if (step.from !== seat) throw new RuleError('NOT_YOUR_TURN', 'Not your turn to pass cards');
      const cards = action.cards;
      const hand = st.hands[seat]!;
      if (cards.length !== step.count || new Set(cards).size !== cards.length || !cards.every((c) => hand.includes(c)))
        throw new RuleError('BAD_EXCHANGE', `Pass exactly ${step.count} distinct cards from your hand`);
      const hands = st.hands.map((h) => [...h]);
      hands[seat] = hand.filter((c) => !cards.includes(c));
      hands[step.to] = [...hands[step.to]!, ...cards];
      const rest = st.exchange.slice(1);
      const next: GameState = { ...st, hands, exchange: rest };
      return rest.length ? { ...next, turn: rest[0]!.from } : startPlay(next);
    }
    case 'runIt': {
      // Release 10: any time during trick play, not only on your turn (the claim is proven before it's applied)
      if (st.phase !== 'playing') throw new RuleError('WRONG_PHASE', 'Not in trick play');
      return playOutRun(st, seat);
    }
    case 'play': {
      if (st.phase !== 'playing') throw new RuleError('WRONG_PHASE', 'Not in trick play');
      if (st.turn !== seat) throw new RuleError('NOT_YOUR_TURN', 'Not your turn to play');
      const legal = legalPlays(st, seat);
      if (!legal.includes(action.card)) throw explainIllegal(st, seat, action.card);
      const hands = [...st.hands];
      hands[seat] = hands[seat]!.filter((c) => c !== action.card);
      const plays: Play[] = [...st.trick.plays, { seat, card: action.card }];
      let spadesBroken = st.spadesBroken || isTrump(action.card, r);
      // ☢ last-trick nuke: once both Jokers are in the hand's final trick, everyone still to play auto-plays their last
      // card at once (one card each, so no choice is made for them); other tricks play out normally
      if (st.tricks.length === handSize(r) - 1 && jokersMet(plays)) {
        for (let k = plays.length, s2 = (seat + 1) % n; k < n; k++, s2 = (s2 + 1) % n) {
          const card = lowestLegal(r, hands[s2]!, plays, spadesBroken);
          hands[s2] = hands[s2]!.filter((c) => c !== card);
          plays.push({ seat: s2, card, auto: true });
          spadesBroken = spadesBroken || isTrump(card, r);
        }
      }
      if (plays.length < n) {
        return { ...st, hands, spadesBroken, trick: { ...st.trick, plays }, turn: (seat + 1) % n };
      }
      const winner = trickWinner(plays, r);
      const done: Trick = { leader: st.trick.leader, plays, winner };
      const tricksWon = [...st.tricksWon];
      tricksWon[winner]!++;
      const tricks = [...st.tricks, done];
      const bi = plays.findIndex((p) => p.card === 'BJ');
      let nukes = st.nukes;
      if (isNukeTrick(plays)) { nukes = [...(st.nukes ?? Array(sideCount(r)).fill(0))]; nukes[sideOf(plays[bi]!.seat, r)]!++; }
      let next: GameState = {
        ...st, hands, spadesBroken, tricks, tricksWon, ...(nukes ? { nukes } : {}),
        trick: { leader: winner, plays: [], winner: null }, turn: winner,
      };
      if (tricks.length === handSize(r)) next = finishHand(next);
      return next;
    }
  }
}

function finishHand(st: GameState): GameState {
  const bids = st.bids as Bid[];
  const r = st.rules;
  const sides = scoreHand(r, bids, st.tricksWon, st.scores, st.bags);
  const scores = sides.map((s) => s.totalScore);
  const bags = sides.map((s) => s.totalBags);
  // Shot = out: mark who was shot this hand; out on hand 1, or twice in a row
  const shot = sides.map((s) => isShot(r, bids, s));
  if (shotOutOn(r)) sides.forEach((s, i) => { s.shot = shot[i]; });
  const prev = st.history[st.history.length - 1];
  const prevShot = sides.map((_, i) => !!prev?.sides[i]?.shot);
  const record: HandRecord = { handNo: st.handNo, dealer: st.dealer, bids: [...bids], tricksWon: [...st.tricksWon], sides };
  const result = shotOutResult(scores, shotOutSides(r, st.handNo, shot, prevShot)) ?? checkGameEnd(r, scores);
  return {
    ...st, scores, bags, history: [...st.history, record], result, turn: null,
    phase: result ? 'gameOver' : 'handOver',
  };
}

/** Whose move is it and what kind (null when waiting for nextHand / game over). */
export function pendingTurn(st: GameState): { seat: Seat; kind: 'bid' | 'exchange' | 'play' } | null {
  if (st.turn === null) return null;
  if (st.phase === 'bidding') return { seat: st.turn, kind: 'bid' };
  if (st.phase === 'exchange') return { seat: st.turn, kind: 'exchange' };
  if (st.phase === 'playing') return { seat: st.turn, kind: 'play' };
  return null;
}

/* ------------------------------------------------------------- seat views */

/** Everything one seat is allowed to know (what the server would send; what bots get). */
export interface PlayerView {
  seat: Seat;
  rules: TableRules;
  phase: Phase;
  handNo: number;
  dealer: Seat;
  turn: Seat | null;
  /** Own cards, or null while still eligible for Blind Nil and not yet looked. */
  hand: Card[] | null;
  handCounts: number[];
  bids: (Bid | null)[];
  revealed: boolean[];
  exchange: ExchangeStep[];
  trick: Trick;
  tricks: Trick[];
  tricksWon: number[];
  spadesBroken: boolean;
  scores: number[];
  bags: number[];
  history: HandRecord[];
  result: GameResult | null;
  bidOptions: BidOptions | null;
  legal: Card[];
  /** This seat can claim 'Run it!': guaranteed from cards they can see, not from the hidden layout. */
  canRunIt?: boolean;
  /**
   * Hands the tornado cleared, one array per seat, the claimer's included.
   * Present only after a 'Run it!' claim has resolved. Omitted while those cards are still hidden.
   */
  runHands?: Card[][];
}

function project(st: GameState, seat: Seat, spectate: boolean): PlayerView {
  const hidden = spectate || (st.phase === 'bidding' && !st.revealed[seat]);
  const runHands = runClearedHands(st);
  return {
    seat, rules: st.rules, phase: st.phase, handNo: st.handNo, dealer: st.dealer, turn: st.turn,
    hand: hidden ? null : [...st.hands[seat]!],
    handCounts: st.hands.map((h) => h.length),
    bids: [...st.bids], revealed: [...st.revealed], exchange: st.exchange.map((e) => ({ ...e })),
    trick: st.trick, tricks: st.tricks, tricksWon: [...st.tricksWon], spadesBroken: st.spadesBroken,
    scores: [...st.scores], bags: [...st.bags], history: st.history, result: st.result,
    bidOptions: spectate ? null : st.phase === 'bidding' && st.turn === seat ? bidOptions(st, seat) : null,
    legal: spectate ? [] : legalPlays(st, seat),
    // Spectators never learn whether a seat can run it, and we don't search to find out.
    canRunIt: spectate ? false : canRunIt(st, seat),
    // Cleared hands ride along only once the claim has resolved (the plays are public then). Never before.
    ...(runHands ? { runHands } : {}),
  };
}

export function viewFor(st: GameState, seat: Seat): PlayerView {
  return project(st, seat, false);
}

/**
 * Release 10: what a spectator may see. A table view anchored at `anchor` (seat order only) with NO hand at all
 * (hand null = face-down placeholders of handCounts length), no legal moves, no bid options, no Run-it hint.
 * Everything else in PlayerView is public (bids, played tricks, scores, history). A resolved 'Run it!'
 * adds `runHands` — the hands the tornado cleared — which is absent until that claim resolves.
 */
export function spectatorView(st: GameState, anchor: Seat = 0): PlayerView {
  return project(st, anchor, true);
}

/** True if this view's opening lead must be the 2♣. */
export function viewMustLeadTwoOfClubs(v: PlayerView): boolean {
  return v.rules.firstLead === 'twoOfClubs' && v.tricks.length === 0;
}
