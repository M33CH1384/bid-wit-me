import { type Card, type Suit, RANKS, isCard, isJoker, naturalSuit } from './cards';

export type Mode = 'joker' | 'cutthroat' | 'aceDown';
export type DeckKind = 'joker54' | 'standard52';

export interface NilRules {
  allowed: boolean;
  value: number;
}

export interface BlindNilRules {
  allowed: boolean;
  value: number;
  /** Only allowed when your side trails the leading other side by at least this many points (null = always). */
  onlyWhenBehindBy: number | null;
  /** Partner card exchange after a Blind Nil (partner modes only). */
  exchangeCards: 0 | 1 | 2;
}

/** All house rules for a table (spec §3.5). */
export interface TableRules {
  mode: Mode;
  partnerships: boolean;
  playerCount: 3 | 4;
  deck: DeckKind;
  /** Non-spade cards removed so the deck divides evenly (52 for 4 players, 51 for 3). */
  removedCards: Card[];
  /** Trumps ranked above A♠, highest first, e.g. ['BJ','LJ'] or ['BJ','LJ','2D','2S']. */
  trumpOrderTop: Card[];
  /** Shortcut: insert 2♠ directly after the jokers. Forced off in Ace Down. */
  deuceOfSpadesHigh: boolean;
  spadesMustBeBroken: boolean;
  firstLead: 'leftOfDealer' | 'twoOfClubs';
  /** Minimum combined team bid (or individual bid in Cutthroat). 0 = no minimum. Nil is always exempt. */
  minTeamBid: number;
  nil: NilRules;
  blindNil: BlindNilRules;
  /** May the partner of a Nil / Blind Nil bidder also bid Nil? */
  partnerMayAlsoNil: boolean;
  /** Do tricks taken by a Nil bidder count toward the partner's contract? (false = they count as bags). */
  nilTricksCountForPartner: boolean;
  bagsPerPenalty: number;
  bagPenalty: number;
  /** Bid ≥10 and make it: score 20 × bid instead of 10 × bid. */
  tenForTwoHundred: boolean;
  targetScore: number;
  /** A side at or below this score loses immediately (null = off). */
  losingFloor: number | null;
  turnTimerSec: { bid: number; play: number };
}

/**
 * Default removals. Joker deck (confirmed by Demetrius): remove 2♣ and 2♥; the 2♦ stays and is promoted to trump.
 * 3-player joker deck needs one more removal: 3♣ (our choice, the lowest remaining non-trump club).
 */
export function defaultRemovedCards(deck: DeckKind, playerCount: 3 | 4): Card[] {
  if (deck === 'joker54') return playerCount === 4 ? ['2C', '2H'] : ['2C', '2H', '3C'];
  return playerCount === 4 ? [] : ['2C'];
}

/** Joker-deck trump order above A♠ (confirmed by Demetrius): Big Joker › Little Joker › 2♦ › 2♠ › A♠ … 3♠. */
export const JOKER_TRUMP_TOP: Card[] = ['BJ', 'LJ', '2D', '2S'];

/** Classic joker variant (2♥ + 2♦ removed, jokers then A♠ … 2♠) kept as a house-rule option. */
export const CLASSIC_JOKER: { removedCards: Card[]; trumpOrderTop: Card[] } = { removedCards: ['2H', '2D'], trumpOrderTop: ['BJ', 'LJ'] };

const BASE: Omit<TableRules, 'mode' | 'partnerships' | 'playerCount' | 'deck' | 'removedCards' | 'trumpOrderTop' | 'targetScore'> = {
  deuceOfSpadesHigh: false,
  spadesMustBeBroken: true,
  firstLead: 'leftOfDealer',
  minTeamBid: 0,
  nil: { allowed: true, value: 100 },
  blindNil: { allowed: true, value: 200, onlyWhenBehindBy: 100, exchangeCards: 0 },
  partnerMayAlsoNil: true,
  nilTricksCountForPartner: false,
  bagsPerPenalty: 10,
  bagPenalty: 100,
  tenForTwoHundred: false,
  losingFloor: -200,
  turnTimerSec: { bid: 30, play: 20 },
};

/** Default preset for a mode (spec §3.2–3.4 and §15 defaults). */
export function defaultRules(mode: Mode, playerCount: 3 | 4 = 4): TableRules {
  switch (mode) {
    case 'joker':
      return { ...BASE, mode, partnerships: true, playerCount: 4, deck: 'joker54', removedCards: defaultRemovedCards('joker54', 4), trumpOrderTop: [...JOKER_TRUMP_TOP], targetScore: 500 };
    case 'cutthroat':
      return { ...BASE, mode, partnerships: false, playerCount, deck: 'joker54', removedCards: defaultRemovedCards('joker54', playerCount), trumpOrderTop: [...JOKER_TRUMP_TOP], targetScore: 300 };
    case 'aceDown':
      return { ...BASE, mode, partnerships: true, playerCount: 4, deck: 'standard52', removedCards: [], trumpOrderTop: [], targetScore: 500 };
  }
}

export type RulesOverrides = Partial<Omit<TableRules, 'nil' | 'blindNil' | 'turnTimerSec'>> & {
  nil?: Partial<NilRules>;
  blindNil?: Partial<BlindNilRules>;
  turnTimerSec?: Partial<TableRules['turnTimerSec']>;
};

export class RulesConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid table rules: ${problems.join('; ')}`);
    this.name = 'RulesConfigError';
  }
}

/**
 * Builds a validated rules object from a mode preset plus overrides.
 * When deck/playerCount change but removedCards isn't given, the default removal for that deck/size is used.
 * When the deck changes to standard52 without an explicit trumpOrderTop, jokers are dropped from the top (and vice versa).
 * Throws RulesConfigError if the result is invalid.
 */
export function makeRules(mode: Mode, overrides: RulesOverrides = {}): TableRules {
  const pc = overrides.playerCount ?? (mode === 'cutthroat' ? 4 : 4);
  const base = defaultRules(mode, pc);
  const r: TableRules = {
    ...base,
    ...overrides,
    mode,
    nil: { ...base.nil, ...overrides.nil },
    blindNil: { ...base.blindNil, ...overrides.blindNil },
    turnTimerSec: { ...base.turnTimerSec, ...overrides.turnTimerSec },
  } as TableRules;
  if (overrides.removedCards === undefined) r.removedCards = defaultRemovedCards(r.deck, r.playerCount);
  if (overrides.trumpOrderTop === undefined)
    r.trumpOrderTop = r.deck === 'joker54' ? JOKER_TRUMP_TOP.filter((c) => !r.removedCards.includes(c)) : [];
  if (mode === 'aceDown') r.deuceOfSpadesHigh = false; // forced off (spec §3.4)
  const problems = validateRules(r);
  if (problems.length) throw new RulesConfigError(problems);
  return r;
}

/** Returns a list of problems (empty if valid). */
export function validateRules(r: TableRules): string[] {
  const p: string[] = [];
  if (r.playerCount !== 3 && r.playerCount !== 4) p.push('playerCount must be 3 or 4');
  if (r.partnerships && r.playerCount !== 4) p.push('partnerships require 4 players');
  if (r.mode === 'cutthroat' && r.partnerships) p.push('cutthroat has no partnerships');
  if (r.mode === 'joker' && r.deck !== 'joker54') p.push('joker mode uses the joker54 deck');
  if (r.mode === 'aceDown') {
    if (r.deck !== 'standard52') p.push('aceDown uses a standard 52-card deck (no jokers)');
    if (r.trumpOrderTop.length) p.push('aceDown has no extra trumps above A♠');
    if (r.deuceOfSpadesHigh) p.push('aceDown forces deuceOfSpadesHigh off');
  }
  const seen = new Set<string>();
  for (const c of r.removedCards) {
    if (!isCard(c)) { p.push(`removedCards: unknown card ${String(c)}`); continue; }
    if (isJoker(c)) p.push('removedCards cannot include jokers');
    else if (naturalSuit(c) === 'S') p.push('removedCards cannot include spades');
    if (seen.has(c)) p.push(`removedCards: duplicate ${c}`);
    seen.add(c);
  }
  const deckSize = (r.deck === 'joker54' ? 54 : 52) - r.removedCards.length;
  const want = r.playerCount === 4 ? 52 : 51;
  if (deckSize !== want) p.push(`deck must have ${want} cards for ${r.playerCount} players after removals (has ${deckSize})`);
  const topSeen = new Set<string>();
  for (const c of r.trumpOrderTop) {
    if (!isCard(c)) { p.push(`trumpOrderTop: unknown card ${String(c)}`); continue; }
    if (topSeen.has(c)) p.push(`trumpOrderTop: duplicate ${c}`);
    topSeen.add(c);
    if (r.removedCards.includes(c)) p.push(`trumpOrderTop card ${c} cannot also be removed`);
    if (isJoker(c) && r.deck !== 'joker54') p.push('jokers in trumpOrderTop need the joker54 deck');
  }
  if (r.deck === 'joker54' && !(topSeen.has('BJ') && topSeen.has('LJ'))) p.push('joker54 deck needs BJ and LJ in trumpOrderTop');
  if (r.firstLead === 'twoOfClubs' && r.removedCards.includes('2C')) p.push('firstLead twoOfClubs needs the 2♣ in the deck');
  const handSize = r.playerCount === 4 ? 13 : 17;
  if (!Number.isInteger(r.minTeamBid) || r.minTeamBid < 0 || r.minTeamBid > handSize) p.push('minTeamBid out of range');
  if (!(r.bagsPerPenalty >= 1)) p.push('bagsPerPenalty must be ≥ 1');
  if (!(r.targetScore > 0)) p.push('targetScore must be positive');
  if (r.losingFloor !== null && !(r.losingFloor < 0)) p.push('losingFloor must be negative or null');
  if (![0, 1, 2].includes(r.blindNil.exchangeCards)) p.push('blindNil.exchangeCards must be 0, 1 or 2');
  return p;
}

export function handSize(r: TableRules): number {
  return r.playerCount === 4 ? 13 : 17;
}

/* ------------------------------------------------------------------ ranking */

interface RankCtx {
  order: Card[]; // trumps high → low
  trumpSet: Set<Card>;
  power: Map<Card, number>;
  deck: Card[];
}

const cache = new WeakMap<TableRules, RankCtx>();

function ctx(r: TableRules): RankCtx {
  let c = cache.get(r);
  if (c) return c;
  const top = [...r.trumpOrderTop];
  if (r.deuceOfSpadesHigh && !top.includes('2S')) {
    let i = 0;
    while (i < top.length && isJoker(top[i]!)) i++;
    top.splice(i, 0, '2S');
  }
  const spades = [...RANKS].reverse().map((rk) => `${rk}S` as Card).filter((x) => !top.includes(x));
  const order = [...top, ...spades].filter((x) => !r.removedCards.includes(x));
  const trumpSet = new Set(order);
  const power = new Map<Card, number>();
  order.forEach((card, i) => power.set(card, 1000 - i));
  const deck: Card[] = [];
  for (const s of ['S', 'H', 'D', 'C'] as Suit[]) {
    RANKS.forEach((rk, i) => {
      const card = `${rk}${s}` as Card;
      if (r.removedCards.includes(card)) return;
      deck.push(card);
      if (!trumpSet.has(card)) power.set(card, i);
    });
  }
  if (r.deck === 'joker54') deck.push('BJ', 'LJ');
  c = { order, trumpSet, power, deck };
  cache.set(r, c);
  return c;
}

/** Trump ranking high → low for these rules (jokers, promoted cards, then A♠…2♠). */
export function trumpOrder(r: TableRules): Card[] {
  return [...ctx(r).order];
}

/** The cards in play for these rules (unshuffled). */
export function buildDeck(r: TableRules): Card[] {
  return [...ctx(r).deck];
}

export function isTrump(card: Card, r: TableRules): boolean {
  return ctx(r).trumpSet.has(card);
}

/** Suit for following purposes: every trump (jokers, promoted cards) counts as a spade. */
export function effectiveSuit(card: Card, r: TableRules): Suit {
  return isTrump(card, r) ? 'S' : (naturalSuit(card) as Suit);
}

/** Comparable strength within an effective suit; all trumps outrank all non-trumps. */
export function cardPower(card: Card, r: TableRules): number {
  const v = ctx(r).power.get(card);
  if (v === undefined) throw new Error(`Card ${card} is not in this deck`);
  return v;
}

/** Sort cards for display: spades/trumps first (high→low), then H, C, D, each high→low. */
export function sortHand(cards: readonly Card[], r: TableRules): Card[] {
  const suitOrder: Record<Suit, number> = { S: 0, H: 1, C: 2, D: 3 };
  return [...cards].sort((a, b) => {
    const sa = effectiveSuit(a, r), sb = effectiveSuit(b, r);
    if (sa !== sb) return suitOrder[sa] - suitOrder[sb];
    return cardPower(b, r) - cardPower(a, r);
  });
}
