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
  /**
   * Minimum combined team bid (or each player's bid in Cutthroat). 0 = no extra bid floor.
   * Together with `firstHandMin`, the higher number is the host minimum for every hand (`hostMinimum`).
   * In 2v2, Nil is allowed, but then the partner's bid alone must reach that minimum.
   */
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
  /**
   * "First hand: books bid themselves". Hand 1 skips bidding: every seat's bid is 'books' and each side scores
   * 10 per book (trick) it takes — no contract, no bags, no penalties, no Nil. Optional only for saves made before it existed.
   */
  firstHandBidsItself?: boolean;
  /**
   * House rule "Shot = out" (on by default; optional for older saves = on). Shot = set (fewer books than bid). Shot on
   * hand 1 loses the game; shot two hands in a row (after hand 1) loses the game. Cutthroat: per player.
   */
  shotOut?: boolean;
  /**
   * Host "minimum books / bid". 3, 4 or 5; null = off (the bid minimum still applies).
   * Every hand: on the books hand, fewer books than the host minimum is a shot, scored as a set at that number.
   * From the next hand on, bids must reach it. Default 4 in team modes, off in Cutthroat
   * (Cutthroat uses `minTeamBid`). Optional for older saves (undefined = the mode default).
   */
  firstHandMin?: 3 | 4 | 5 | null;
  /**
   * "Bags and penalties" (on by default; optional for older saves = on). Off: books over your bid are worth nothing
   * (no +1, no bag count, no bag penalty).
   */
  bagsOn?: boolean;
}

/** The first-hand minimum in effect (resolves the mode default for older rules objects). */
export function firstHandMinOf(r: Pick<TableRules, 'firstHandMin' | 'partnerships'>): number | null {
  if (r.firstHandMin === undefined) return r.partnerships ? 4 : null;
  return r.firstHandMin;
}

/**
 * The host minimum for every hand (books on hand 1, bids after that).
 * The books/bid setting and the minimum-bid setting are one floor: the higher one wins. 0 = off.
 */
export function hostMinimum(r: Pick<TableRules, 'firstHandMin' | 'partnerships' | 'minTeamBid'>): number {
  const books = firstHandMinOf(r);
  const bid = typeof r.minTeamBid === 'number' && Number.isInteger(r.minTeamBid) ? Math.max(0, r.minTeamBid) : 0;
  return books === null ? bid : Math.max(books, bid);
}

/**
 * Nil / Blind Nil as stored on a live game. Older rows and damaged rules can omit the objects entirely;
 * reading `.allowed` on them throws and used to kill a room tick mid-broadcast. Missing pieces fall back
 * to the mode preset (Nil on, except Cutthroat) and a complete object is returned unchanged.
 */
export function nilRulesOf(r: { mode?: string; nil?: Partial<NilRules> | null }): NilRules {
  const n = r.nil;
  const fallbackAllowed = r.mode !== 'cutthroat';
  if (!n || typeof n !== 'object') return { allowed: fallbackAllowed, value: 100 };
  const allowed = typeof n.allowed === 'boolean' ? n.allowed : fallbackAllowed;
  const value = typeof n.value === 'number' && Number.isFinite(n.value) ? n.value : 100;
  if (n.allowed === allowed && n.value === value) return n as NilRules;
  return { allowed, value };
}

export function blindNilRulesOf(r: { mode?: string; blindNil?: Partial<BlindNilRules> | null }): BlindNilRules {
  const b = r.blindNil;
  const fallbackAllowed = r.mode !== 'cutthroat';
  if (!b || typeof b !== 'object') return { allowed: fallbackAllowed, value: 200, onlyWhenBehindBy: 100, exchangeCards: 0 };
  const allowed = typeof b.allowed === 'boolean' ? b.allowed : fallbackAllowed;
  const value = typeof b.value === 'number' && Number.isFinite(b.value) ? b.value : 200;
  const onlyWhenBehindBy = b.onlyWhenBehindBy === null || (typeof b.onlyWhenBehindBy === 'number' && Number.isFinite(b.onlyWhenBehindBy))
    ? b.onlyWhenBehindBy
    : 100;
  const exchangeCards: 0 | 1 | 2 = b.exchangeCards === 0 || b.exchangeCards === 1 || b.exchangeCards === 2 ? b.exchangeCards : 0;
  if (b.allowed === allowed && b.value === value && b.onlyWhenBehindBy === onlyWhenBehindBy && b.exchangeCards === exchangeCards) return b as BlindNilRules;
  return { allowed, value, onlyWhenBehindBy, exchangeCards };
}

/** Same rules object when Nil and Blind Nil are already complete; otherwise a copy with both filled in. */
export function withCompleteNil<T extends { mode?: string; nil?: Partial<NilRules> | null; blindNil?: Partial<BlindNilRules> | null }>(r: T): T {
  const nil = nilRulesOf(r);
  const blindNil = blindNilRulesOf(r);
  if (r.nil === nil && r.blindNil === blindNil) return r;
  return { ...r, nil, blindNil };
}
export const bagsOnOf = (r: Pick<TableRules, 'bagsOn'>) => r.bagsOn !== false;
export const shotOutOn = (r: Pick<TableRules, 'shotOut'>) => r.shotOut !== false;

/**
 * Default removals: always the lowest NON-TRUMP cards (never a spade, joker or promoted trump), fixed and known to
 * everyone (shown in the setup summary and glossary). Joker deck (confirmed by Demetrius): remove 2♣ and 2♥; the 2♦ stays
 * and is promoted to trump. 3-player (Cutthroat 3, 17 cards each, 17 books): standard 52 removes the 2♣ (51 cards);
 * the joker deck (54) removes 2♣, 2♥, 3♣ in that order (51 cards).
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
  firstHandBidsItself: true,
  shotOut: true,
};

/** Default preset for a mode (spec §3.2–3.4 and §15 defaults). */
export function defaultRules(mode: Mode, playerCount: 3 | 4 = 4): TableRules {
  switch (mode) {
    case 'joker':
      return { ...BASE, mode, partnerships: true, playerCount: 4, deck: 'joker54', removedCards: defaultRemovedCards('joker54', 4), trumpOrderTop: [...JOKER_TRUMP_TOP], targetScore: 500, firstHandMin: 4 };
    case 'cutthroat':
      // Cutthroat: min bid 1, Nil and Blind Nil off, bags on, books minimum off (the bid minimum still applies), to 300
      return {
        ...BASE, mode, partnerships: false, playerCount, deck: 'joker54', removedCards: defaultRemovedCards('joker54', playerCount),
        trumpOrderTop: [...JOKER_TRUMP_TOP], targetScore: 300, firstHandMin: null, minTeamBid: 1,
        nil: { ...BASE.nil, allowed: false },
        blindNil: { ...BASE.blindNil, allowed: false, onlyWhenBehindBy: null },
      };
    case 'aceDown':
      return { ...BASE, mode, partnerships: true, playerCount: 4, deck: 'standard52', removedCards: [], trumpOrderTop: [], targetScore: 500, firstHandMin: 4 };
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
  if (mode === 'cutthroat') {
    // Nil and Blind Nil are off for the whole mode. A host toggle cannot turn them back on.
    r.nil = { ...r.nil, allowed: false };
    r.blindNil = { ...r.blindNil, allowed: false };
  }
  const problems = validateRules(r);
  if (problems.length) throw new RulesConfigError(problems);
  return r;
}

function isRec(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function has(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined;
}

function pickBool(src: Record<string, unknown>, key: string, problems: string[]): boolean | undefined {
  if (!has(src, key)) return undefined;
  if (typeof src[key] !== 'boolean') { problems.push(`${key} must be a boolean`); return undefined; }
  return src[key];
}

function pickFinite(src: Record<string, unknown>, key: string, problems: string[]): number | undefined {
  if (!has(src, key)) return undefined;
  const v = src[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) { problems.push(`${key} must be a number`); return undefined; }
  return v;
}

function pickNil(src: Record<string, unknown>, problems: string[]): Partial<NilRules> | undefined {
  if (!has(src, 'nil')) return undefined;
  const n = src.nil;
  if (!isRec(n)) { problems.push('nil must be an object'); return undefined; }
  const out: Partial<NilRules> = {};
  if (has(n, 'allowed')) {
    if (typeof n.allowed !== 'boolean') problems.push('nil.allowed must be a boolean');
    else out.allowed = n.allowed;
  }
  if (has(n, 'value')) {
    if (typeof n.value !== 'number' || !Number.isFinite(n.value)) problems.push('nil.value must be a number');
    else out.value = n.value;
  }
  return out;
}

function pickBlind(src: Record<string, unknown>, problems: string[]): Partial<BlindNilRules> | undefined {
  if (!has(src, 'blindNil')) return undefined;
  const n = src.blindNil;
  if (!isRec(n)) { problems.push('blindNil must be an object'); return undefined; }
  const out: Partial<BlindNilRules> = {};
  if (has(n, 'allowed')) {
    if (typeof n.allowed !== 'boolean') problems.push('blindNil.allowed must be a boolean');
    else out.allowed = n.allowed;
  }
  if (has(n, 'value')) {
    if (typeof n.value !== 'number' || !Number.isFinite(n.value)) problems.push('blindNil.value must be a number');
    else out.value = n.value;
  }
  if (has(n, 'onlyWhenBehindBy')) {
    const b = n.onlyWhenBehindBy;
    if (b !== null && (typeof b !== 'number' || !Number.isFinite(b))) problems.push('blindNil.onlyWhenBehindBy must be a number or null');
    else out.onlyWhenBehindBy = b;
  }
  if (has(n, 'exchangeCards')) {
    const e = n.exchangeCards;
    if (e !== 0 && e !== 1 && e !== 2) problems.push('blindNil.exchangeCards must be 0, 1 or 2');
    else out.exchangeCards = e;
  }
  return out;
}

/**
 * Turns untrusted host input into table rules. Starts from the mode preset and applies only allowlisted,
 * type-checked overrides; anything else is dropped. A present field of the wrong type is an error (it is not
 * coerced). Omitted fields keep the preset, so a missing `nil` cannot reach bidding. Timers are clamped to
 * 3–120s. Throws RulesConfigError when the result is not a valid rules object.
 */
export function acceptRules(input: unknown): TableRules {
  if (!isRec(input)) throw new RulesConfigError(['rules must be an object']);
  const mode = input.mode;
  if (mode !== 'joker' && mode !== 'cutthroat' && mode !== 'aceDown') {
    throw new RulesConfigError(['mode must be joker, cutthroat or aceDown']);
  }
  const problems: string[] = [];
  const o: RulesOverrides = {};
  const partnerships = pickBool(input, 'partnerships', problems);
  if (partnerships !== undefined) o.partnerships = partnerships;
  if (has(input, 'playerCount')) {
    if (input.playerCount !== 3 && input.playerCount !== 4) problems.push('playerCount must be 3 or 4');
    else o.playerCount = input.playerCount;
  }
  if (has(input, 'deck')) {
    if (input.deck !== 'joker54' && input.deck !== 'standard52') problems.push('deck must be joker54 or standard52');
    else o.deck = input.deck;
  }
  if (has(input, 'removedCards')) {
    if (!Array.isArray(input.removedCards)) problems.push('removedCards must be an array');
    else o.removedCards = input.removedCards.slice() as Card[];
  }
  if (has(input, 'trumpOrderTop')) {
    if (!Array.isArray(input.trumpOrderTop)) problems.push('trumpOrderTop must be an array');
    else o.trumpOrderTop = input.trumpOrderTop.slice() as Card[];
  }
  const deuce = pickBool(input, 'deuceOfSpadesHigh', problems);
  if (deuce !== undefined) o.deuceOfSpadesHigh = deuce;
  const broken = pickBool(input, 'spadesMustBeBroken', problems);
  if (broken !== undefined) o.spadesMustBeBroken = broken;
  if (has(input, 'firstLead')) {
    if (input.firstLead !== 'leftOfDealer' && input.firstLead !== 'twoOfClubs') problems.push('firstLead must be leftOfDealer or twoOfClubs');
    else o.firstLead = input.firstLead;
  }
  if (has(input, 'minTeamBid')) {
    if (typeof input.minTeamBid !== 'number' || !Number.isInteger(input.minTeamBid)) problems.push('minTeamBid must be an integer');
    else o.minTeamBid = input.minTeamBid;
  }
  const nil = pickNil(input, problems);
  if (nil) o.nil = nil;
  const blind = pickBlind(input, problems);
  if (blind) o.blindNil = blind;
  const partnerNil = pickBool(input, 'partnerMayAlsoNil', problems);
  if (partnerNil !== undefined) o.partnerMayAlsoNil = partnerNil;
  const nilForPartner = pickBool(input, 'nilTricksCountForPartner', problems);
  if (nilForPartner !== undefined) o.nilTricksCountForPartner = nilForPartner;
  const bagsPer = pickFinite(input, 'bagsPerPenalty', problems);
  if (bagsPer !== undefined) o.bagsPerPenalty = bagsPer;
  const bagPen = pickFinite(input, 'bagPenalty', problems);
  if (bagPen !== undefined) o.bagPenalty = bagPen;
  const ten = pickBool(input, 'tenForTwoHundred', problems);
  if (ten !== undefined) o.tenForTwoHundred = ten;
  const target = pickFinite(input, 'targetScore', problems);
  if (target !== undefined) o.targetScore = target;
  if (has(input, 'losingFloor')) {
    const f = input.losingFloor;
    if (f !== null && (typeof f !== 'number' || !Number.isFinite(f))) problems.push('losingFloor must be a number or null');
    else o.losingFloor = f;
  }
  const books = pickBool(input, 'firstHandBidsItself', problems);
  if (books !== undefined) o.firstHandBidsItself = books;
  const shot = pickBool(input, 'shotOut', problems);
  if (shot !== undefined) o.shotOut = shot;
  const bagsOn = pickBool(input, 'bagsOn', problems);
  if (bagsOn !== undefined) o.bagsOn = bagsOn;
  if (has(input, 'firstHandMin')) {
    const n = input.firstHandMin;
    if (n === null || n === 3 || n === 4 || n === 5) o.firstHandMin = n;
    else problems.push('firstHandMin must be 3, 4, 5 or off');
  }
  // Pace, not scoring: a non-number falls back to the preset instead of rejecting the rest of the rules.
  const timer = isRec(input.turnTimerSec) ? input.turnTimerSec : {};
  const clamp = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(3, Math.min(120, Math.round(x))) : d);
  o.turnTimerSec = { bid: clamp(timer.bid, 30), play: clamp(timer.play, 20) };
  if (problems.length) throw new RulesConfigError(problems);
  return makeRules(mode, o);
}

/** Returns a list of problems (empty if valid). Malformed input is reported; this does not throw. */
export function validateRules(r: TableRules): string[] {
  const p: string[] = [];
  if (!isRec(r)) return ['rules must be an object'];
  if (r.mode !== 'joker' && r.mode !== 'cutthroat' && r.mode !== 'aceDown') p.push('mode must be joker, cutthroat or aceDown');
  if (r.playerCount !== 3 && r.playerCount !== 4) p.push('playerCount must be 3 or 4');
  if (typeof r.partnerships !== 'boolean') p.push('partnerships must be a boolean');
  else if (r.partnerships && r.playerCount !== 4) p.push('partnerships require 4 players');
  if (r.mode === 'cutthroat' && r.partnerships === true) p.push('cutthroat has no partnerships');
  if (r.deck !== 'joker54' && r.deck !== 'standard52') p.push('deck must be joker54 or standard52');
  if (r.mode === 'joker' && r.deck !== 'joker54') p.push('joker mode uses the joker54 deck');
  if (typeof r.deuceOfSpadesHigh !== 'boolean') p.push('deuceOfSpadesHigh must be a boolean');
  if (typeof r.spadesMustBeBroken !== 'boolean') p.push('spadesMustBeBroken must be a boolean');
  if (r.firstLead !== 'leftOfDealer' && r.firstLead !== 'twoOfClubs') p.push('firstLead must be leftOfDealer or twoOfClubs');
  if (r.mode === 'aceDown') {
    if (r.deck !== 'standard52') p.push('aceDown uses a standard 52-card deck (no jokers)');
    if (Array.isArray(r.trumpOrderTop) && r.trumpOrderTop.length) p.push('aceDown has no extra trumps above A♠');
    if (r.deuceOfSpadesHigh === true) p.push('aceDown forces deuceOfSpadesHigh off');
  }
  const removed = Array.isArray(r.removedCards) ? r.removedCards : null;
  if (!removed) p.push('removedCards must be an array');
  else {
    const seen = new Set<string>();
    for (const c of removed) {
      if (!isCard(c)) { p.push(`removedCards: unknown card ${String(c)}`); continue; }
      if (isJoker(c)) p.push('removedCards cannot include jokers');
      else if (naturalSuit(c) === 'S') p.push('removedCards cannot include spades');
      if (seen.has(c)) p.push(`removedCards: duplicate ${c}`);
      seen.add(c);
    }
  }
  const top = Array.isArray(r.trumpOrderTop) ? r.trumpOrderTop : null;
  const topSeen = new Set<string>();
  if (!top) p.push('trumpOrderTop must be an array');
  else {
    for (const c of top) {
      if (!isCard(c)) { p.push(`trumpOrderTop: unknown card ${String(c)}`); continue; }
      if (topSeen.has(c)) p.push(`trumpOrderTop: duplicate ${c}`);
      topSeen.add(c);
      if (removed?.includes(c)) p.push(`trumpOrderTop card ${c} cannot also be removed`);
      if (isJoker(c) && r.deck !== 'joker54') p.push('jokers in trumpOrderTop need the joker54 deck');
    }
  }
  if (removed && (r.playerCount === 3 || r.playerCount === 4) && (r.deck === 'joker54' || r.deck === 'standard52')) {
    const deckSize = (r.deck === 'joker54' ? 54 : 52) - removed.length;
    const want = r.playerCount === 4 ? 52 : 51;
    if (deckSize !== want) p.push(`deck must have ${want} cards for ${r.playerCount} players after removals (has ${deckSize})`);
  }
  if (r.deck === 'joker54' && top && !(topSeen.has('BJ') && topSeen.has('LJ'))) p.push('joker54 deck needs BJ and LJ in trumpOrderTop');
  if (r.firstLead === 'twoOfClubs' && removed?.includes('2C')) p.push('firstLead twoOfClubs needs the 2♣ in the deck');
  const handSize = r.playerCount === 4 ? 13 : 17;
  if (typeof r.minTeamBid !== 'number' || !Number.isInteger(r.minTeamBid) || r.minTeamBid < 0 || r.minTeamBid > handSize) p.push('minTeamBid out of range');
  if (typeof r.bagsPerPenalty !== 'number' || !Number.isFinite(r.bagsPerPenalty) || r.bagsPerPenalty < 1) p.push('bagsPerPenalty must be ≥ 1');
  if (typeof r.bagPenalty !== 'number' || !Number.isFinite(r.bagPenalty)) p.push('bagPenalty must be a number');
  if (typeof r.targetScore !== 'number' || !(r.targetScore > 0)) p.push('targetScore must be positive');
  if (r.losingFloor !== null && (typeof r.losingFloor !== 'number' || !Number.isFinite(r.losingFloor) || !(r.losingFloor < 0))) p.push('losingFloor must be negative or null');
  if (typeof r.partnerMayAlsoNil !== 'boolean') p.push('partnerMayAlsoNil must be a boolean');
  if (typeof r.nilTricksCountForPartner !== 'boolean') p.push('nilTricksCountForPartner must be a boolean');
  if (typeof r.tenForTwoHundred !== 'boolean') p.push('tenForTwoHundred must be a boolean');
  if (r.firstHandBidsItself !== undefined && typeof r.firstHandBidsItself !== 'boolean') p.push('firstHandBidsItself must be a boolean');
  if (r.shotOut !== undefined && typeof r.shotOut !== 'boolean') p.push('shotOut must be a boolean');
  if (r.bagsOn !== undefined && typeof r.bagsOn !== 'boolean') p.push('bagsOn must be a boolean');
  if (r.firstHandMin !== undefined && r.firstHandMin !== null && ![3, 4, 5].includes(r.firstHandMin)) p.push('firstHandMin must be 3, 4, 5 or off');
  if (!isRec(r.turnTimerSec) || typeof r.turnTimerSec.bid !== 'number' || !Number.isFinite(r.turnTimerSec.bid) || typeof r.turnTimerSec.play !== 'number' || !Number.isFinite(r.turnTimerSec.play)) {
    p.push('turnTimerSec.bid and turnTimerSec.play must be numbers');
  }
  if (!isRec(r.nil)) p.push('nil must be an object');
  else {
    if (typeof r.nil.allowed !== 'boolean') p.push('nil.allowed must be a boolean');
    if (typeof r.nil.value !== 'number' || !Number.isFinite(r.nil.value)) p.push('nil.value must be a number');
  }
  if (!isRec(r.blindNil)) p.push('blindNil must be an object');
  else {
    if (typeof r.blindNil.allowed !== 'boolean') p.push('blindNil.allowed must be a boolean');
    if (typeof r.blindNil.value !== 'number' || !Number.isFinite(r.blindNil.value)) p.push('blindNil.value must be a number');
    if (r.blindNil.onlyWhenBehindBy !== null && (typeof r.blindNil.onlyWhenBehindBy !== 'number' || !Number.isFinite(r.blindNil.onlyWhenBehindBy))) {
      p.push('blindNil.onlyWhenBehindBy must be a number or null');
    }
    if (![0, 1, 2].includes(r.blindNil.exchangeCards)) p.push('blindNil.exchangeCards must be 0, 1 or 2');
  }
  return p;
}

export function handSize(r: TableRules): number {
  return r.playerCount === 4 ? 13 : 17;
}

/** Books dealt when this many Cutthroat players are still in. Three players take 17; two or four take 13. */
export function tricksForActive(active: number): number {
  return active === 3 ? 17 : 13;
}

/**
 * Cards pulled from the deck for this many active players. The table's saved removals stay put.
 * Three still in also drop 3♣ (joker) or 2♣ (standard) so 51 cards split 17 ways.
 * Two still in play the wide deck: joker is 54−2♣−2♥, and the extra 3-player card comes back, with 26 face down.
 */
export function removedForActive(r: TableRules, active: number): Card[] {
  if (r.partnerships || active === r.playerCount || active >= 4 || active < 2) return [...r.removedCards];
  if (active === 3) {
    const add: Card = r.deck === 'joker54' ? '3C' : '2C';
    return r.removedCards.includes(add) ? [...r.removedCards] : [...r.removedCards, add];
  }
  const drop: Card = r.deck === 'joker54' ? '3C' : '2C';
  return r.removedCards.filter((c) => c !== drop);
}

/** The host minimum can be bid and made with this many books in the hand. */
export function minimumFits(r: Pick<TableRules, 'firstHandMin' | 'partnerships' | 'minTeamBid'>, tricks: number): boolean {
  return hostMinimum(r) <= tricks;
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
