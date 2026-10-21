import type { Card } from './cards';
import { type TableRules, blindNilRulesOf, buildDeck, cardPower, effectiveSuit, handSize, hostMinimum, isTrump, minimumFits, nilRulesOf, removedForActive, shotOutOn, tricksForActive, validateRules, withCompleteNil, RulesConfigError } from './config';
import { evaluateRunIt } from './runIt';
import { createRng, shuffle } from './rng';
import {
  type Bid, type GameResult, type SideHandResult,
  checkGameEnd, isBooksHand, isNilBid, isShot, partnerOf, scoreHand, shotCounts, shotOutResult, shotOutSides, sideCount, sideOf, thirdSetResult,
} from './scoring';

export type Seat = number;
export type Phase = 'bidding' | 'exchange' | 'playing' | 'handOver' | 'gameOver';

/** `auto`: legacy flag from the old last-trick nuke auto-finish. The engine no longer sets it — an armed nuke waits for every seat to throw their own card (see nukeArmed). Kept so tricks recorded by older builds keep their meaning. */
export interface Play { seat: Seat; card: Card; /** drag-to-play slam strength 0..1 (optional, cosmetic) */ slam?: number; /** drag release velocity px/ms [x, y] (optional, cosmetic: landing spot) */ rel?: [number, number]; auto?: true; /** played out by a 'Run it!' claim */ run?: true }
export interface Trick { leader: Seat; plays: Play[]; winner: Seat | null }
export interface ExchangeStep { from: Seat; to: Seat; count: number }

export interface HandRecord {
  handNo: number;
  dealer: Seat;
  bids: Bid[];
  tricksWon: number[];
  sides: SideHandResult[];
  /**
   * The nuked trick of this hand, when both Jokers fell in one completed
   * trick (league data wave): the seat who played the Big Joker — the seat
   * the blast is credited to everywhere else (see `nukes` in applyAction).
   * Stamped by finishHand, the one place the hand's tricks still exist;
   * absent on records written before this field existed.
   */
  nuke?: { seat: Seat };
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
  /**
   * Cutthroat: consecutive failed bids per player. A made bid sets it back to 0.
   * Hand 1 eliminates on the first failure; from hand 2, two in a row eliminate.
   * Synced on the seat view. The deal does not touch this.
   */
  failStreak?: number[];
  /** Cutthroat: eliminated players. They cannot bid, play, or sit back down. The next deal counts who is still in and leaves this list alone. */
  eliminated?: boolean[];
  /** Books in this hand when the table is short. Omitted on a full table (13 or 17 from the rules). */
  trickCount?: number;
  /** Face-down cards not dealt when two players are still in. Never copied into a seat's view. */
  undealt?: Card[];
  /** Misdeal redeals taken on the current hand (the hand number does not move). Omitted until one happens. */
  misdeals?: number;
  /**
   * Seats that successfully claimed "Run it!" this game, in claim order. Powers the
   * Run It Up achievement (Street Cred). Omitted until the first claim.
   */
  runItClaims?: number[];
  /**
   * The hand a misdeal caller threw face up on the table: the caller's whole hand, public to every seat
   * (it is the proof of no spades). Set by the misdeal action on the redealt state, cleared by the next deal.
   */
  misdealReveal?: { seat: Seat; cards: Card[] };
}

export type Action =
  | { type: 'reveal'; seat: Seat }
  | { type: 'bid'; seat: Seat; bid: Bid }
  | { type: 'exchange'; seat: Seat; cards: Card[] }
  | { type: 'play'; seat: Seat; card: Card; slam?: number; rel?: [number, number] }
  /** 'Run it!': `seat` claims every remaining trick, any time in trick play (only legal when canRunIt proves it) */
  | { type: 'runIt'; seat: Seat }
  /** 'Call misdeal': `seat` throws a spade-less hand face up and the same hand is reshuffled and redealt (see canMisdeal) */
  | { type: 'misdeal'; seat: Seat }
  | { type: 'nextHand' };

export type RuleErrorCode =
  | 'WRONG_PHASE' | 'NOT_YOUR_TURN' | 'BAD_SEAT' | 'BAD_BID' | 'BID_TOO_LOW' | 'NIL_NOT_ALLOWED'
  | 'BLIND_NIL_NOT_ALLOWED' | 'CARD_NOT_IN_HAND' | 'MUST_FOLLOW_SUIT' | 'SPADES_NOT_BROKEN'
  | 'MUST_LEAD_TWO_OF_CLUBS' | 'BAD_EXCHANGE' | 'ALREADY_REVEALED' | 'ALREADY_PLAYED' | 'CANNOT_RUN_IT' | 'NO_MISDEAL' | 'ELIMINATED' | 'BAD_RULES';

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
/** The pre-deal shell both game constructors share: scores zeroed, no hand dealt yet (handNo 0). */
function baseGame(rules: TableRules, seed: string | number, opts: { dealer?: number } = {}): GameState {
  const problems = validateRules(rules);
  if (problems.length) throw new RulesConfigError(problems);
  const n = rules.playerCount;
  const s = String(seed);
  const dealer = opts.dealer !== undefined && opts.dealer >= 0 && opts.dealer < n ? opts.dealer : createRng(`${s}:dealer`).int(n);
  return {
    rules, seed: s, phase: 'bidding', handNo: 0, dealer, turn: null,
    hands: [], bids: [], revealed: [], exchange: [],
    trick: { leader: 0, plays: [], winner: null }, tricks: [], tricksWon: [], spadesBroken: false,
    scores: Array(sideCount(rules)).fill(0), bags: Array(sideCount(rules)).fill(0),
    history: [], result: null,
    failStreak: Array(n).fill(0), eliminated: Array(n).fill(false),
  };
}

export function newGame(rules: TableRules, seed: string | number, opts: { dealer?: number } = {}): GameState {
  const base = baseGame(rules, seed, opts);
  return dealHand(base, 1, base.dealer);
}

/**
 * A new game whose first hand is NOT dealt yet (handNo 0, every hand empty, no turn).
 * The online room creates games this way so it can hold the first deal behind the
 * pre-deal setup window (players setting cameras/mics on a fully loaded table);
 * `dealFirstHand` then deals exactly the hand `newGame` would have dealt — the deck
 * is seeded from the game seed + hand number, so the cards are identical either way.
 */
export function newGameUndealt(rules: TableRules, seed: string | number, opts: { dealer?: number } = {}): GameState {
  const base = baseGame(rules, seed, opts);
  const n = rules.playerCount;
  return {
    ...base,
    hands: Array.from({ length: n }, () => []),
    bids: Array(n).fill(null),
    revealed: Array(n).fill(true),
    tricksWon: Array(n).fill(0),
  };
}

/** Deal hand 1 into an undealt game (see newGameUndealt). A no-op on a game already dealt. */
export function dealFirstHand(st: GameState): GameState {
  if (st.handNo !== 0) return st;
  return dealHand(st, 1, st.dealer);
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
export function nextBidder(st: Pick<GameState, 'rules' | 'dealer' | 'bids' | 'eliminated'>, seat: Seat): Seat | null {
  const order = bidOrder(st.rules, st.dealer);
  const i = order.indexOf(seat);
  for (let k = i + 1; k < order.length; k++) {
    const s = order[k]!;
    if (isEliminated(st, s)) continue;
    if (st.bids[s] === null) return s;
  }
  return null;
}

/** Cutthroat seat that has already been eliminated. */
export function isEliminated(st: { eliminated?: readonly boolean[] | undefined }, seat: number): boolean {
  return !!st.eliminated?.[seat];
}

/** Seats still being dealt in, in seat order. Partnerships always deal every seat. */
export function liveSeats(st: Pick<GameState, 'rules' | 'eliminated'>): number[] {
  const n = st.rules.playerCount;
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (st.rules.partnerships || !isEliminated(st, i)) out.push(i);
  return out;
}

/**
 * Rules the cards in this hand are ranked by. The saved `rules.removedCards` stay the table's base list.
 * A short Cutthroat hand may put a card back in (3♣ or 2♣) or take one out; play and the seat view use that list.
 */
export function rulesForLive(st: Pick<GameState, 'rules' | 'eliminated'>): TableRules {
  const r = st.rules;
  const removed = removedForActive(r, liveSeats(st).length);
  if (removed.length === r.removedCards.length && removed.every((c, i) => c === r.removedCards[i])) return r;
  return { ...r, removedCards: removed };
}

/** Next clockwise seat that is still in. Partnerships never skip a seat. */
export function nextLive(st: Pick<GameState, 'rules' | 'eliminated'>, seat: number): number {
  const n = st.rules.playerCount;
  for (let k = 1; k <= n; k++) {
    const s = (seat + k) % n;
    if (st.rules.partnerships || !isEliminated(st, s)) return s;
  }
  return seat;
}

/** Tricks this hand deals and plays. A full table uses the normal 13 or 17. */
export function booksInHand(st: { rules: TableRules; trickCount?: number }): number {
  return st.trickCount ?? handSize(st.rules);
}

function dealHand(prev: GameState, handNo: number, dealer: Seat, misdeal = 0): GameState {
  const r = prev.rules;
  const n = r.playerCount;
  const live = liveSeats(prev);
  const active = live.length;
  const tricks = tricksForActive(active);
  if (!r.partnerships && !minimumFits(r, tricks)) {
    throw new RuleError('BAD_RULES', `Minimum books ${hostMinimum(r)} is higher than the ${tricks} in this hand`);
  }
  const removed = removedForActive(r, active);
  // A misdeal redeals the SAME hand number, so the plain hand seed would deal the identical cards back.
  // Misdeal shuffles get their own seed line; every normal deal stays bit-identical to before.
  const deckSeed = misdeal > 0 ? `${prev.seed}:hand:${handNo}:misdeal:${misdeal}` : `${prev.seed}:hand:${handNo}`;
  const deck = shuffle(buildDeck({ ...r, removedCards: removed }), createRng(deckSeed));
  const hands: Card[][] = Array.from({ length: n }, () => []);
  let trickCount: number | undefined;
  let undealt: Card[] | undefined;
  if (live.length === n) {
    // one at a time clockwise, starting left of the dealer. A full table keeps the seeded deck.
    deck.forEach((c, i) => hands[(dealer + 1 + i) % n]!.push(c));
  } else {
    // Three still in: 17 books and the extra low card is out of the deck. Two still in: 13, with the rest face down.
    trickCount = tricks;
    const used = deck.slice(0, tricks * live.length);
    const rest = deck.slice(used.length);
    if (rest.length) undealt = rest;
    const start = nextLive(prev, dealer);
    const at = Math.max(0, live.indexOf(start));
    used.forEach((c, i) => hands[live[(at + i) % live.length]!]!.push(c));
  }
  const order = bidOrder(r, dealer);
  const turn = order.find((s) => r.partnerships || !isEliminated(prev, s)) ?? order[0]!;
  const st: GameState = {
    ...prev, phase: 'bidding', handNo, dealer, turn,
    hands, bids: Array(n).fill(null), revealed: Array(n).fill(true), exchange: [],
    trick: { leader: nextLive(prev, dealer), plays: [], winner: null }, tricks: [],
    tricksWon: Array(n).fill(0), spadesBroken: false,
    trickCount, undealt,
    // a fresh deal (misdeal redeal included) starts clean: the thrown hand only lives on the state
    // the misdeal action itself returns, and the per-hand redeal count restarts with the hand
    misdeals: misdeal, misdealReveal: undefined,
  };
  if (handNo === 1 && r.firstHandBidsItself) {
    // "First hand: books bid themselves": no bidding, straight to play; every book scores 10
    const bids = Array(n).fill(null);
    for (const s of live) bids[s] = 'books';
    return startPlay({ ...st, bids });
  }
  st.revealed = st.revealed.map((_, seat) => isEliminated(st, seat) || !blindNilScoreEligible(st, seat));
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

function blindNilScoreEligible(st: Pick<GameState, 'rules' | 'scores'>, seat: Seat): boolean {
  const r = st.rules;
  const blind = blindNilRulesOf(r);
  if (!blind.allowed) return false;
  if (blind.onlyWhenBehindBy === null) return true;
  const mine = sideOf(seat, r);
  const best = Math.max(...st.scores.filter((_, i) => i !== mine));
  return best - st.scores[mine]! >= blind.onlyWhenBehindBy;
}

export interface BidOptions {
  min: number;
  max: number;
  nil: boolean;
  blindNil: boolean;
  /** Why a number below `min` is blocked. Null when 1 is legal. */
  blockReason: string | null;
  /** Why Nil is blocked because of the partner's bid. Null when Nil is allowed, or when this table has no Nil. */
  nilReason: string | null;
}

/** Bids available to `seat` right now (ignores whose turn it is). */
export function bidOptions(st: Pick<GameState, 'rules' | 'trickCount' | 'bids' | 'revealed' | 'scores'>, seat: Seat): BidOptions {
  const r = st.rules;
  const books = booksInHand(st);
  // Hard cap: a team's numeric bids can never add up to more than the books in the hand.
  // Nil / Blind Nil count as 0 toward that total, so a partner on a nil leaves the whole hand
  // available; a partner still to bid leaves it available too (their own bid gets capped when
  // they bid second), except that with Nil off they must bid at least 1, so one book is held back.
  // Solo / Cutthroat bids stand alone and cap at the hand's own book count (trickCount when a
  // short Cutthroat table is playing 13 of a possible 17, via booksInHand).
  let max = books;
  if (r.partnerships) {
    const partnerSeat = partnerOf(seat, r);
    const partnerBid = partnerSeat === null ? null : st.bids[partnerSeat];
    if (typeof partnerBid === 'number') max = books - partnerBid;
    else if (partnerBid === null && !nilRulesOf(r).allowed) max = books - 1;
  }
  max = Math.max(0, max);
  const floor = Math.min(Math.max(0, hostMinimum(r)), books);
  const partner = partnerOf(seat, r);
  const pBid = partner === null ? null : st.bids[partner];
  let min = 1;
  let nil = nilRulesOf(r).allowed;
  let blockReason: string | null = null;
  let nilReason: string | null = null;
  if (!r.partnerships) {
    // Cutthroat: each bid stands alone. Nil and Blind Nil are off.
    nil = false;
    min = Math.max(1, floor);
    if (min > 1) blockReason = `Minimum bid is ${min}`;
  } else {
    const partnerNil = isNilBid(pBid);
    if (partnerNil && !r.partnerMayAlsoNil) nil = false;
    if (floor > 0 && partnerNil) {
      // Whoever bid Nil first: the other bid alone has to reach the minimum.
      min = Math.max(1, floor);
      nil = false;
      blockReason = `Partner bid Nil — you need ${floor}`;
      nilReason = 'Can\'t Nil — partner bid Nil';
    } else if (floor > 0 && typeof pBid === 'number') {
      min = Math.max(1, floor - pBid);
      if (pBid < floor) {
        nil = false;
        nilReason = `Can't Nil — partner bid ${pBid}`;
      }
      if (min > 1) blockReason = `Minimum is ${floor}`;
    }
    // Partner still to bid: a low number is legal (they can cover it). Nil is legal; they then bid the floor alone.
  }
  // max 0 means the partner already bid every book: no numeric bid is legal, only Nil (when offered).
  min = Math.min(Math.max(1, min), Math.max(1, max));
  return {
    min, max, nil, blockReason, nilReason,
    blindNil: nil && blindNilRulesOf(r).allowed && !st.revealed[seat] && blindNilScoreEligible(st, seat),
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
 * The card picked when a seat has no real choice to make — a 'Run it!' play-out opponent, a bot or
 * turn-timer fallback: its LOWEST LEGAL card (follow the led suit if it can; otherwise its lowest
 * non-trump; otherwise its lowest trump). Renege rules hold because the pick always comes from legalPlaysFor.
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
export function radioactiveBigJoker(st: Pick<GameState, 'rules' | 'phase' | 'tricks' | 'trick' | 'trickCount'>): boolean {
  if (st.rules.deck !== 'joker54' || st.phase !== 'playing' || st.tricks.length !== booksInHand(st) - 1) return false;
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
  // Only the eliminated seat itself is barred. Barring the whole table once ANYONE was out
  // (the guard that landed with Cutthroat elimination) silently killed Run it! in every
  // Cutthroat game after the first ejection, though the claim rule is every-mode by design.
  // The proof already respects empty hands: an out seat holds no unseen cards and is never
  // dealt a turn (nextLive), so a live seat's guarantee is unaffected.
  if (isEliminated(st, seat)) return false;
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
  return { ...s, runItClaims: [...(s.runItClaims ?? []), seat], tricks: s.tricks.map((t, i) => (i < fromTricks ? t : { ...t, plays: t.plays.map((p, k) => (i === fromTricks && k < onTable ? p : { ...p, run: true as const })) })) };
}

/**
 * One card in a resolved 'Run it!' recap.
 * `played` marks a card that was already face up on the table when the claim was made
 * (that play is not flagged `run`). The recap still includes it, so a mid-trick claim
 * shows every seat the same number of cards.
 */
export interface RunCard {
  card: Card;
  played?: true;
}

/**
 * Each seat's cards a resolved 'Run it!' cleared (the claimer's included), in the order they were played out.
 * The trick that was in progress also contributes the cards already on the table, marked `played`.
 * Read only from tricks that contain a `run` play, which do not exist until the claim has resolved.
 * Null while the claim is still unmade — this is not a look at cards still in hand.
 */
export function runClearedHands(st: Pick<GameState, 'rules' | 'tricks'>): RunCard[][] | null {
  const hands: RunCard[][] = Array.from({ length: st.rules.playerCount }, () => []);
  let any = false;
  for (const t of st.tricks) {
    const firstRun = t.plays.findIndex((p) => p.run);
    if (firstRun < 0) continue;
    any = true;
    for (let k = 0; k < t.plays.length; k++) {
      const p = t.plays[k]!;
      // The prefix before the first `run` play is what was already on the table.
      if (k < firstRun) hands[p.seat]!.push({ card: p.card, played: true });
      else if (p.run) hands[p.seat]!.push({ card: p.card });
    }
  }
  return any ? hands : null;
}

/**
 * The tricks a resolved 'Run it!' added, in play order, for every client to animate.
 * Cards already face up when the claim was made are marked `played`. Null when this step was not a run.
 * The cards are the same public plays as `runClearedHands` — nothing that was still hidden.
 */
export interface RunPlayout {
  handNo: number;
  claimer: Seat;
  books: number;
  tricks: { winner: Seat; plays: { seat: Seat; card: Card; played?: true }[] }[];
}

export function runPlayout(before: GameState, after: GameState, claimer: Seat): RunPlayout | null {
  if (before.handNo !== after.handNo) return null;
  const tricks = after.tricks.slice(before.tricks.length).flatMap((t) => {
    const firstRun = t.plays.findIndex((p) => p.run);
    if (firstRun < 0 || t.winner === null) return [];
    return [{
      winner: t.winner,
      plays: t.plays.map((p, k) => ({ seat: p.seat, card: p.card, ...(k < firstRun ? { played: true as const } : {}) })),
    }];
  });
  if (!tricks.length) return null;
  return { handNo: after.handNo, claimer, books: tricks.length, tricks };
}

/** Both Jokers are in this (partial) trick: the nuke. */
export function jokersMet(plays: readonly Play[]): boolean {
  return plays.some((p) => p.card === 'BJ') && plays.some((p) => p.card === 'LJ');
}

/**
 * ☢ Nuke, ARMED (Demetrius 2026-10-20): both Jokers are in the trick on the table but the trick is
 * not done — in ANY trick, first or last; the behavior is uniform. The nuke used to detonate the
 * moment the second Joker landed (on the final trick it even auto-played every remaining seat's
 * last card); now it always waits — each seat still to play throws their own card, and the blast
 * fires only when the trick actually completes (the finished trick then satisfies isNukeTrick).
 * Public information only: both Jokers are face up on the table.
 * A Run it! trick never arms (the tornado is the show).
 */
export function nukeArmed(st: Pick<GameState, 'rules' | 'phase' | 'tricks' | 'trick' | 'trickCount' | 'eliminated'>): boolean {
  if (st.rules.deck !== 'joker54' || st.phase !== 'playing') return false;
  const plays = st.trick.plays;
  if (plays.some((p) => p.run)) return false;
  return jokersMet(plays) && plays.length < liveSeats(st).length;
}

/**
 * 🃏 Last-card throw-in (Demetrius 2026-10-19): the hand's final trick, when every live
 * seat holds exactly one card, is played turn-free — anyone may throw their last card in
 * without waiting for the turn pointer, like real casual table play ("in real games this
 * happens a lot"). Nobody has a choice of card left, so order can't change what anyone
 * holds; the trick leader still sets the led suit because the completed trick's plays
 * are reordered leader-first before the winner is decided (see the 'play' handler).
 * Outside this window turn order is enforced exactly as before.
 */
export function throwInOpen(st: GameState): boolean {
  if (st.phase !== 'playing') return false;
  if (st.tricks.length !== booksInHand(st) - 1) return false;
  // ≤ 1 (not exactly 1): the window stays open while the final trick's cards land,
  // as the seats that already threw drop to zero.
  return liveSeats(st).every((s) => st.hands[s]!.length <= 1);
}

/** Order a completed trick leader-first: the rotation from the trick's leader through every live seat. */
function leaderFirstPlays(st: GameState, plays: readonly Play[]): Play[] {
  const bySeat = new Map(plays.map((p) => [p.seat, p] as const));
  const out: Play[] = [];
  const liveN = liveSeats(st).length;
  for (let s = st.trick.leader, i = 0; i < liveN; s = nextLive(st, s), i++) {
    const p = bySeat.get(s);
    if (p) out.push(p);
  }
  return out.length === plays.length ? out : [...plays];
}

function mustLead2C(st: GameState): boolean {
  return st.rules.firstLead === 'twoOfClubs' && st.tricks.length === 0;
}

export function legalPlays(st: GameState, seat: Seat): Card[] {
  if (st.phase !== 'playing' || st.turn !== seat) return [];
  return legalPlaysFor(rulesForLive(st), st.hands[seat]!, st.trick.plays, st.spadesBroken, mustLead2C(st));
}

/**
 * The cards `seat` may actually send right now: the turn seat's legal plays — plus, during the
 * last-card throw-in (see throwInOpen), this seat's single remaining card even out of turn.
 * Used by the play handler's validation and by the player view, so the engine, the server and
 * the client's tappable cards never disagree about the throw-in window.
 */
export function playableCards(st: GameState, seat: Seat): Card[] {
  if (st.phase !== 'playing') return [];
  if (st.turn === seat) return legalPlays(st, seat);
  if (!throwInOpen(st)) return [];
  return legalPlaysFor(rulesForLive(st), st.hands[seat]!, st.trick.plays, st.spadesBroken, mustLead2C(st));
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
    if (h >= 0 && !isEliminated(st, h)) return h;
  }
  return nextLive(st, st.dealer);
}

function startPlay(st: GameState): GameState {
  const leader = firstLeader(st);
  return { ...st, phase: 'playing', exchange: [], turn: leader, trick: { leader, plays: [], winner: null } };
}

function exchangeSteps(st: GameState): ExchangeStep[] {
  const r = st.rules;
  const exchangeCards = blindNilRulesOf(r).exchangeCards;
  if (!r.partnerships || exchangeCards === 0) return [];
  const steps: ExchangeStep[] = [];
  const done = new Set<Seat>();
  for (let i = 1; i <= r.playerCount; i++) {
    const s = (st.dealer + i) % r.playerCount;
    if (st.bids[s] !== 'blindNil' || done.has(s)) continue;
    const p = partnerOf(s, r)!;
    steps.push({ from: s, to: p, count: exchangeCards }, { from: p, to: s, count: exchangeCards });
    done.add(s).add(p);
  }
  return steps;
}

/** Applies an action and returns the new state. Throws RuleError on illegal actions. Never mutates `st`. */
/**
 * True when `seat` may call a misdeal: the deal is in, they have SEEN their hand (no Blind Nil peeking),
 * and the hand holds no spades at all — no spade-suit card and no Joker or trump deuce (`isTrump` covers
 * all of them in every deck). The offer lives from the deal until that seat's own bidding is done: placing
 * any bid IS the decline, and it never comes back for the hand; it also dies when bidding closes (so a
 * first card played is far too late). Other seats bidding does not decline for you — in a live game the
 * first accepted call wins and the redeal resets the window for everyone. Cutthroat's eliminated seats
 * hold no cards and are out regardless. On the call, the caller's whole hand goes face up on the table
 * (`misdealReveal`, public in every view) and the same hand — same number, scores, series — is
 * reshuffled and redealt, with the deal passing to the next dealer like a normal end of hand.
 * A fresh deal can itself be spade-less: the rule simply applies again (and the deal passes again).
 */
export function canMisdeal(st: GameState, seat: Seat): boolean {
  if (st.phase !== 'bidding' || isEliminated(st, seat)) return false;
  const hand = st.hands[seat];
  if (!hand || hand.length === 0 || !st.revealed[seat]) return false;
  if (st.bids[seat] !== null) return false;
  return !hand.some((c) => isTrump(c, st.rules));
}

export function applyAction(st: GameState, action: Action): GameState {
  const rules = withCompleteNil(st.rules);
  if (rules !== st.rules) st = { ...st, rules };
  const r = rulesForLive(st);
  const n = r.playerCount;
  if (action.type === 'nextHand') {
    if (st.phase !== 'handOver') throw new RuleError('WRONG_PHASE', 'Hand is not over');
    return dealHand(st, st.handNo + 1, (st.dealer + 1) % n);
  }
  const seat = action.seat;
  if (!Number.isInteger(seat) || seat < 0 || seat >= n) throw new RuleError('BAD_SEAT', `Bad seat ${seat}`);
  if (isEliminated(st, seat)) throw new RuleError('ELIMINATED', 'You are out of this game');

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
        if (!opt.nil) throw new RuleError('NIL_NOT_ALLOWED', opt.nilReason ?? (r.partnerships ? 'Nil is not allowed' : 'Nil is off in Cutthroat'));
      } else if (bid === 'blindNil') {
        if (!opt.blindNil) throw new RuleError('BLIND_NIL_NOT_ALLOWED', r.partnerships ? 'Blind Nil is not allowed' : 'Blind Nil is off in Cutthroat');
      } else {
        if (typeof bid !== 'number' || !Number.isInteger(bid) || bid < 0 || bid > opt.max) throw new RuleError('BAD_BID', `Bid must be 0–${opt.max}`);
        if (bid < opt.min) throw new RuleError('BID_TOO_LOW', opt.blockReason ?? `Minimum bid is ${opt.min}`);
      }
      const bids = [...st.bids];
      bids[seat] = bid;
      const revealed = [...st.revealed];
      revealed[seat] = true;
      const after = nextBidder({ ...st, bids }, seat);
      let next: GameState = { ...st, bids, revealed, turn: after ?? nextLive(st, seat) };
      if (liveSeats(st).every((s) => bids[s] !== null)) {
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
    case 'misdeal': {
      if (!canMisdeal(st, seat)) throw new RuleError('NO_MISDEAL', 'A misdeal needs a spade-less hand you have seen, before you have bid');
      // Same hand, same scores and series: only the deck is reshuffled — and the deal passes to
      // the next dealer, exactly as if the hand had ended (owner, 2026-10-21), so a redeal deals
      // out of the incoming dealer's hands. The thrown hand rides on the new state face up, so
      // the whole table (every client's view) sees the proof.
      const next = dealHand(st, st.handNo, nextDealer(st), (st.misdeals ?? 0) + 1);
      return { ...next, misdealReveal: { seat, cards: [...st.hands[seat]!] } };
    }
    case 'runIt': {
      // Release 10: any time during trick play, not only on your turn (the claim is proven before it's applied)
      if (st.phase !== 'playing') throw new RuleError('WRONG_PHASE', 'Not in trick play');
      return playOutRun(st, seat);
    }
    case 'play': {
      if (st.phase !== 'playing') throw new RuleError('WRONG_PHASE', 'Not in trick play');
      // One card per seat per trick. A retry of the card already down is a no-op so a duplicate
      // message cannot add a second play. A different card from that seat is rejected even when
      // the turn pointer still names them.
      const mine = st.trick.plays.find((p) => p.seat === seat);
      if (mine) {
        if (mine.card === action.card) return st;
        throw new RuleError('ALREADY_PLAYED', 'You already played in this trick');
      }
      if (st.turn !== seat && !throwInOpen(st)) throw new RuleError('NOT_YOUR_TURN', 'Not your turn to play');
      const legal = playableCards(st, seat);
      if (!legal.includes(action.card)) throw explainIllegal(st, seat, action.card);
      const hands = [...st.hands];
      hands[seat] = hands[seat]!.filter((c) => c !== action.card);
      const play: Play = { seat, card: action.card };
      if (typeof action.slam === 'number' && Number.isFinite(action.slam)) play.slam = Math.max(0, Math.min(1, action.slam));
      const rel = cleanRel(action.rel);
      if (rel) play.rel = rel;
      const plays: Play[] = [...st.trick.plays, play];
      // ☢ Both Jokers down in any trick: the nuke is ARMED, not fired (Demetrius 2026-10-20). It
      // used to detonate on the second Joker's landing (and, on the final trick, auto-play every
      // remaining seat's last card at once); now the trick stays open (see nukeArmed) and each
      // seat throws their own card — the blast goes off only when the trick completes below,
      // after every live seat that must play has played.
      const spadesBroken = st.spadesBroken || isTrump(action.card, r);
      const liveN = liveSeats(st).length;
      if (plays.length < liveN) {
        // The turn pointer names the next seat that hasn't thrown yet, so bots and the UI
        // stay in sync even when the final trick's cards land out of order.
        const thrown = new Set(plays.map((p) => p.seat));
        let t = nextLive(st, seat);
        while (thrown.has(t)) t = nextLive(st, t);
        return { ...st, hands, spadesBroken, trick: { ...st.trick, plays }, turn: t };
      }
      // 🃏 Throw-in reorder: the led suit (plays[0]) is always the trick leader's card,
      // even when the final trick's cards landed out of turn.
      const ordered = leaderFirstPlays(st, plays);
      const winner = trickWinner(ordered, r);
      const done: Trick = { leader: st.trick.leader, plays: ordered, winner };
      const tricksWon = [...st.tricksWon];
      tricksWon[winner]!++;
      const tricks = [...st.tricks, done];
      const bi = ordered.findIndex((p) => p.card === 'BJ');
      let nukes = st.nukes;
      if (isNukeTrick(ordered)) { nukes = [...(st.nukes ?? Array(sideCount(r)).fill(0))]; nukes[sideOf(ordered[bi]!.seat, r)]!++; }
      let next: GameState = {
        ...st, hands, spadesBroken, tricks, tricksWon, ...(nukes ? { nukes } : {}),
        trick: { leader: winner, plays: [], winner: null }, turn: winner,
      };
      if (tricks.length === booksInHand(st)) next = finishHand(next);
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
  // Stamp the nuke while the hand's tricks are still here — the record
  // itself keeps only counts, so without this the moment is unrecoverable
  // (the Postgame Report's gap). isNukeTrick already excludes Run it!
  // tricks, and one deck holds one Big Joker, so at most one trick in the
  // hand can qualify. Both history producers (the server room and the
  // offline engine) build records here, so both get the stamp.
  for (const t of st.tricks) {
    if (!isNukeTrick(t.plays)) continue;
    const seat = t.plays.find((p) => p.card === 'BJ')?.seat;
    if (seat !== undefined) record.nuke = { seat };
    break;
  }
  if (!r.partnerships) return finishCutthroat(st, sides, scores, bags, record);
  // Third set ends it (game-wide, always on): checked before Shot = out and the score endings so
  // the ending is named for the set even when this hand also crosses the target — the winner is
  // the same either way. The count derives from the hand records via shotCounts, so a resumed
  // game (offline or story save — both serialize the history) keeps its count exactly, and an
  // older save's records carry the same bids/sides the count is derived from.
  const result = thirdSetResult(scores, shotCounts(r, [...st.history, record]), shotCounts(r, st.history))
    ?? shotOutResult(scores, shotOutSides(r, st.handNo, shot, prevShot))
    ?? checkGameEnd(r, scores);
  return {
    ...st, scores, bags, history: [...st.history, record], result, turn: null,
    phase: result ? 'gameOver' : 'handOver',
  };
}

/** A cutthroat bid failed: short of the minimum on the books hand, a missed number, or a busted Nil. */
function cutthroatFailed(r: TableRules, bid: Bid | null, side: SideHandResult, books: boolean): boolean {
  if (books) return hostMinimum(r) > 0 && side.tricks < hostMinimum(r);
  if (bid === null || bid === 'books') return false;
  if (isNilBid(bid)) return side.tricks > 0;
  return side.contractMade === false;
}

function rankedResult(r: TableRules, scores: readonly number[], eliminated: readonly boolean[], winners: number[], endReason: GameResult['endReason'], shotOut: number[]): GameResult {
  const key = (i: number) => (eliminated[i] && !winners.includes(i) ? -1e9 : 0) + scores[i]!;
  const keys = scores.map((_, i) => key(i));
  const placements = keys.map((k) => 1 + keys.filter((o) => o > k).length);
  return { endReason, shotOut, finalScores: [...scores], placements, winners };
}

/**
 * Cutthroat: drop players after the hand is scored. One player left wins. An active player at the host's
 * target wins, and the highest score wins if several get there. A tie plays another hand.
 * Everyone still in who fails on the same hand: the higher score wins; a tie plays on.
 */
function finishCutthroat(st: GameState, sides: SideHandResult[], scores: number[], bags: number[], record: HandRecord): GameState {
  const r = st.rules;
  const n = r.playerCount;
  const wasOut = st.eliminated ?? Array(n).fill(false);
  const streak = [...(st.failStreak ?? Array(n).fill(0))];
  const books = isBooksHand(st.bids as Bid[]);
  const scoreBids = (st.bids as (Bid | null)[]).map((b, i) => (wasOut[i] ? 'books' as const : b)) as Bid[];
  if (wasOut.some(Boolean)) {
    const rescored = scoreHand(r, scoreBids, st.tricksWon, st.scores, st.bags);
    for (let i = 0; i < n; i++) if (wasOut[i]) sides[i] = rescored[i]!;
  }
  const eliminated = [...wasOut];
  // Cumulative failed bids per player over the whole game, counted from the records' shot
  // stamps (every active player's hand is stamped below, and was in past hands too — including
  // in older saves, whose cutthroat records carry the same stamps). The third-set rule maps to
  // cutthroat per player: a third failed bid eliminates even when the failures weren't in a row.
  const cumFails = Array(n).fill(0) as number[];
  for (const h of st.history) for (const s of h.sides) if (s.shot) cumFails[s.side] = (cumFails[s.side] ?? 0) + 1;
  /** players eliminated by THIS hand whose only cause was the third failed bid */
  const thirdOut: number[] = [];
  for (let i = 0; i < n; i++) {
    if (wasOut[i]) {
      scores[i] = st.scores[i]!;
      bags[i] = st.bags[i]!;
      sides[i] = { ...sides[i]!, points: 0, bookPoints: 0, contractPoints: 0, contractMade: null, bagsAdded: 0, totalScore: scores[i]!, totalBags: bags[i]!, shot: false, out: true };
      continue;
    }
    const failed = cutthroatFailed(r, st.bids[i] ?? null, sides[i]!, books);
    streak[i] = failed ? (streak[i] ?? 0) + 1 : 0;
    const cum = (cumFails[i] ?? 0) + (failed ? 1 : 0);
    const out = failed && (st.handNo === 1 || (streak[i] ?? 0) >= 2 || cum >= 3);
    if (out && st.handNo !== 1 && (streak[i] ?? 0) < 2) thirdOut.push(i);
    if (out) eliminated[i] = true;
    sides[i] = { ...sides[i]!, shot: failed, out };
  }
  const active = eliminated.flatMap((out, i) => (out ? [] : [i]));
  const justOut = eliminated.flatMap((out, i) => (out ? [i] : []));
  let result: GameResult | null = null;
  if (active.length === 1) {
    const winner = active[0]!;
    // a game ended by a third-fail elimination is named for it, ahead of the target check —
    // same precedence as team games (the winner is the same either way). Its shotOut list names
    // the third-fail eliminations themselves, as in team games, not everyone ever eliminated.
    result = rankedResult(r, scores, eliminated, [winner], thirdOut.length ? 'third-set' : scores[winner]! >= r.targetScore ? 'target' : 'shotOut', thirdOut.length ? thirdOut : justOut);
  } else if (active.length === 0) {
    const pool = wasOut.flatMap((out, i) => (out ? [] : [i]));
    const top = Math.max(...pool.map((i) => scores[i]!));
    const leaders = pool.filter((i) => scores[i] === top);
    if (leaders.length === 1) {
      result = rankedResult(r, scores, eliminated, leaders, thirdOut.length ? 'third-set' : 'shotOut', thirdOut.length ? thirdOut : justOut);
    } else {
      // Tied for the win: those players stay in and play a tiebreaker hand. The rest stay out.
      for (const i of leaders) {
        eliminated[i] = false;
        sides[i] = { ...sides[i]!, out: false };
      }
    }
  } else {
    const top = Math.max(...active.map((i) => scores[i]!));
    const leaders = active.filter((i) => scores[i] === top);
    const floorHit = r.losingFloor !== null && active.some((i) => scores[i]! <= r.losingFloor!);
    if (leaders.length === 1 && (top >= r.targetScore || floorHit)) {
      result = rankedResult(r, scores, eliminated, leaders, top >= r.targetScore ? 'target' : 'floor', eliminated.flatMap((out, i) => (out ? [i] : [])));
    }
  }
  const saved: HandRecord = { ...record, sides };
  return {
    ...st, scores, bags, failStreak: streak, eliminated, history: [...st.history, saved], result, turn: null,
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
  /** Cutthroat consecutive-fail counters. Empty until a cutthroat hand is scored. */
  failStreak: number[];
  /** Cutthroat seats that are out. */
  eliminated: boolean[];
  /** Books in this hand when the table is short (17 with three still in). */
  trickCount?: number;
  bidOptions: BidOptions | null;
  legal: Card[];
  /** This seat can claim 'Run it!': guaranteed from cards they can see, not from the hidden layout. */
  canRunIt?: boolean;
  /** This seat may call a misdeal right now: spade-less hand, seen, and they have not bid yet. */
  canMisdeal?: boolean;
  /** ☢ Both Jokers are in the trick on the table (any trick) but it isn't done: the nuke is armed — the client glows the trick "ready to blow" until the last card lands and it detonates. */
  nukeArmed?: boolean;
  /**
   * A misdeal was just called on this hand: the caller's whole hand, face up on the table for every seat
   * to verify (the proof of no spades), on the redealt state until the next deal. Absent otherwise.
   */
  misdealReveal?: { seat: Seat; cards: Card[] };
  /**
   * Hands the tornado cleared, one array per seat, the claimer's included.
   * Cards already on the table for the in-progress trick are included and marked `played`.
   * Present only after a 'Run it!' claim has resolved. Omitted while those cards are still hidden.
   */
  runHands?: RunCard[][];
}

function project(st: GameState, seat: Seat, spectate: boolean): PlayerView {
  const hidden = spectate || (st.phase === 'bidding' && !st.revealed[seat]);
  const runHands = runClearedHands(st);
  return {
    seat, rules: withCompleteNil(rulesForLive(st)), phase: st.phase, handNo: st.handNo, dealer: st.dealer, turn: st.turn,
    hand: hidden ? null : [...st.hands[seat]!],
    handCounts: st.hands.map((h) => h.length),
    bids: [...st.bids], revealed: [...st.revealed], exchange: st.exchange.map((e) => ({ ...e })),
    trick: st.trick, tricks: st.tricks, tricksWon: [...st.tricksWon], spadesBroken: st.spadesBroken,
    scores: [...st.scores], bags: [...st.bags], history: st.history, result: st.result,
    failStreak: [...(st.failStreak ?? [])], eliminated: [...(st.eliminated ?? [])], ...(st.trickCount !== undefined ? { trickCount: st.trickCount } : {}),
    bidOptions: spectate ? null : st.phase === 'bidding' && st.turn === seat ? bidOptions(st, seat) : null,
    legal: spectate ? [] : playableCards(st, seat),
    // Spectators never learn whether a seat can run it, and we don't search to find out.
    canRunIt: spectate ? false : canRunIt(st, seat),
    canMisdeal: spectate ? false : canMisdeal(st, seat),
    // Public (the Jokers are face up): spectators glow too.
    nukeArmed: nukeArmed(st),
    // The thrown hand is public by design: every seat (spectators included) gets the same face-up cards.
    ...(st.misdealReveal ? { misdealReveal: { seat: st.misdealReveal.seat, cards: [...st.misdealReveal.cards] } } : {}),
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

/** A drag release vector, finite and capped (px/ms), or null. Cosmetic only. */
export function cleanRel(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const c = (x: number) => Math.round(Math.max(-20, Math.min(20, x)) * 1000) / 1000;
  return [c(v[0]), c(v[1])];
}
