import { type Card, type PlayerView, type Rng, effectiveSuit, isNilBid, isTrump, partnerOf, sideOf, trumpOrder } from '@spades/rules';

/** One line of a hand's book count (shared by the bots' bidding and the player-facing bid coach). */
export interface BookItem { cards: Card[]; value: number; note: string }

/** How a hand's estimated books break down, by counting strategy (spec §3.6). `total` is what the bots bid from. */
export interface HandAnalysis {
  /** Trumps that win (or nearly win) on rank, in the mode's trump order. */
  sureTrumps: BookItem[];
  /** Off-suit aces, kings with backup, protected queens. */
  sideWinners: BookItem[];
  /** Extra books from trump length beyond the usual share. */
  length: BookItem | null;
  /** Ruffing: voids / singletons / doubletons you can cut with spare trumps. */
  cutting: BookItem | null;
  trumpCount: number;
  /** 3-player bonus multiplier applied to the total (1 in 4-player games). */
  factor: number;
  total: number;
}

const SUIT_NAME: Record<string, string> = { H: '♥', D: '♦', C: '♣' };

/** Breaks a hand down into estimated books, strategy by strategy. */
export function analyzeHand(hand: readonly Card[], v: Pick<PlayerView, 'rules'>): HandAnalysis {
  const r = v.rules;
  const order = trumpOrder(r);
  const trumps = hand.filter((c) => isTrump(c, r)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const nT = trumps.length;
  let est = 0;
  let high = 0;
  const sureTrumps: BookItem[] = [];
  for (const c of trumps) {
    const idx = order.indexOf(c);
    const missingAbove = order.slice(0, idx).filter((x) => !hand.includes(x)).length;
    const lowerMine = trumps.filter((x) => order.indexOf(x) > idx).length;
    if (lowerMine >= missingAbove) {
      est += 1; high++;
      sureTrumps.push({ cards: [c], value: 1, note: missingAbove === 0 ? 'the strongest card left: nothing can beat it' : `safe: you have ${lowerMine} smaller spade${lowerMine === 1 ? '' : 's'} (trump${lowerMine === 1 ? '' : 's'}) to play first` });
    } else if (lowerMine === missingAbove - 1) {
      est += 0.4;
      sureTrumps.push({ cards: [c], value: 0.4, note: 'maybe' });
    }
  }
  // length in trumps (with more trumps in the deck, e.g. 16 in the Joker house order, long trumps are worth less)
  const extraTrumps = Math.max(0, order.length - 13);
  const lenBase = 4 + Math.floor(extraTrumps / 2);
  const lenVal = Math.max(0, nT - lenBase) * 0.6;
  est += lenVal;
  const length: BookItem | null = lenVal > 0 ? { cards: [], value: lenVal, note: `${nT} spades (trumps): ${nT - lenBase} more than most players get, and the extras win near the end` } : null;
  let shortness = 0;
  const sideWinners: BookItem[] = [];
  const shortSuits: string[] = [];
  for (const s of ['H', 'D', 'C']) {
    const cards = hand.filter((c) => !isTrump(c, r) && effectiveSuit(c, r) === s);
    const len = cards.length;
    const card = (rk: string) => cards.find((c) => c[0] === rk);
    const has = (rk: string) => !!card(rk);
    if (has('A')) { const val = len <= 6 ? 1 : 0.6; est += val; sideWinners.push({ cards: [card('A')!], value: val, note: len <= 6 ? 'ace: top card of its suit' : 'ace, but its suit is long, so someone may run out and beat it with a spade' }); }
    if (has('K')) {
      const val = has('A') && len >= 2 ? 0.85 : len >= 2 && len <= 5 ? 0.55 : 0.1;
      est += val;
      sideWinners.push({ cards: [card('K')!], value: val, note: has('A') && len >= 2 ? 'king, with your ace above it' : len >= 2 && len <= 5 ? 'king with a smaller card to protect it' : len < 2 ? 'king alone: the ace can catch it' : 'king in a long suit: someone may beat it with a spade' });
    }
    if (has('Q') && len >= 3 && len <= 4) { const val = has('A') || has('K') ? 0.35 : 0.2; est += val; sideWinners.push({ cards: [card('Q')!], value: val, note: 'queen with smaller cards to protect it' }); }
    if (len === 0) { shortness += 1; shortSuits.push(`no ${SUIT_NAME[s]}`); }
    else if (len === 1 && !has('A')) { shortness += 0.6; shortSuits.push(`one ${SUIT_NAME[s]}`); }
    else if (len === 2) { shortness += 0.2; shortSuits.push(`two ${SUIT_NAME[s]}`); }
  }
  const spare = Math.max(0, nT - high);
  const cutVal = Math.min(shortness, spare * (extraTrumps >= 3 ? 0.55 : 0.75));
  est += cutVal;
  const cutting: BookItem | null = shortSuits.length
    ? { cards: [], value: cutVal, note: cutVal > 0 ? `${shortSuits.join(', ')}: once you run out, your ${spare} spare spade${spare === 1 ? '' : 's'} can win those books (cutting)` : `${shortSuits.join(', ')}, but no spare spades to win those books with` }
    : null;
  // 3-player games have 17-card hands but only two opponents: high cards are worth slightly more.
  const factor = r.playerCount === 3 ? 1.15 : 1;
  if (r.playerCount === 3) est *= 1.15;
  return { sureTrumps, sideWinners, length, cutting, trumpCount: nT, factor, total: est };
}

/** Estimated tricks for a hand (sure-trick counting heuristic, spec §3.6). */
export function estimateTricks(hand: readonly Card[], v: Pick<PlayerView, 'rules'>): number {
  return analyzeHand(hand, v).total;
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

/**
 * Bot skill: novice (sloppy at a set rate, never illegal), regular (sound basics, no counting), pro (counts cards and
 * voids, cheapest winners, saves Jokers/2s), shark (pro + sampled endgame search). 'easy' / 'normal' are the old names
 * (saved settings, older clients) and map to novice / pro.
 */
export type BotSkill = 'novice' | 'regular' | 'pro' | 'shark';
export type BotLevel = BotSkill | 'easy' | 'normal';
export const BOT_SKILLS: readonly BotSkill[] = ['novice', 'regular', 'pro', 'shark'];
export function skillOf(level: BotLevel | string | undefined | null): BotSkill {
  if (level === 'easy') return 'novice';
  if (level === 'normal' || level === undefined || level === null) return 'pro';
  return (BOT_SKILLS as readonly string[]).includes(level) ? (level as BotSkill) : 'pro';
}
/** The table setting: one fixed skill for every bot, or 'mixed' (each seat rolls its own, seeded per game). Default mixed. */
export type BotSkillSetting = BotSkill | 'mixed';
export const BOT_SKILL_SETTINGS: readonly BotSkillSetting[] = ['mixed', 'novice', 'regular', 'pro', 'shark'];
export const SKILL_SETTING_LABEL: Record<BotSkillSetting, string> = { mixed: 'Mixed (default)', novice: 'Novice', regular: 'Regular', pro: 'Pro', shark: 'Shark' };
export const MIXED_WEIGHTS: Record<BotSkill, number> = { novice: 20, regular: 35, pro: 30, shark: 15 };
export function skillSettingOf(v: unknown): BotSkillSetting {
  if (v === 'mixed' || v === undefined || v === null) return 'mixed';
  return skillOf(v as BotLevel);
}
const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
/**
 * The skill a bot seat actually plays at. Mixed: a weighted roll seeded by the game seed + seat, so it's stable across
 * refreshes / reconnects and hidden from players. `floor` lets a persona bias it (the Hustler is never below Pro).
 */
export function seatSkill(setting: BotLevel | BotSkillSetting | undefined, gameSeed: string, seat: number, floor?: BotSkill): BotSkill {
  let sk: BotSkill;
  if (setting === 'mixed' || setting === undefined) {
    const roll = fnv(`${gameSeed}:skill:${seat}`) % 100;
    let acc = 0; sk = 'pro';
    for (const k of BOT_SKILLS) { acc += MIXED_WEIGHTS[k]; if (roll < acc) { sk = k; break; } }
  } else sk = skillOf(setting);
  if (floor && BOT_SKILLS.indexOf(sk) < BOT_SKILLS.indexOf(floor)) sk = floor;
  return sk;
}
export const BOT_SKILL_LABEL: Record<BotSkill, string> = { novice: 'Novice', regular: 'Regular', pro: 'Pro', shark: 'Shark' };

/** Choose a bid for a revealed hand. */
export function chooseBid(v: PlayerView, level: BotLevel, rng: Rng): number | 'nil' {
  const opt = v.bidOptions!;
  const hand = v.hand!;
  const r = v.rules;
  const partner = partnerOf(v.seat, r);
  const pBid = partner === null ? null : v.bids[partner];
  const skill = skillOf(level);
  let est = estimateTricks(hand, v);
  if (skill === 'novice') est += rng.float() * 2.4 - 0.9; // sloppy, leans greedy
  else if (skill === 'regular') est += rng.float() * 0.8 - 0.4;
  const partnerNil = isNilBid(pBid);
  if ((skill === 'pro' || skill === 'shark') && opt.nil && !partnerNil && nilWorthy(hand, v)) return 'nil';
  if (partnerNil) est += 0.5; // covering a nil partner: we'll be winning extra tricks anyway
  let bid = Math.round(est + (r.partnerships ? 0 : 0.15));
  // Don't overbid the table: total bids above the hand size are a guaranteed set for someone.
  const others = v.bids.reduce<number>((a, b) => a + (typeof b === 'number' ? b : 0), 0);
  const room = r.playerCount === 4 ? 13 : 17;
  if (skill !== 'novice' && others + bid > room + 1) bid = Math.max(1, room + 1 - others);
  return Math.min(opt.max, Math.max(opt.min, bid, 1));
}

/** Bots decide on Blind Nil before looking (only from scores and the partner's bid). */
export function wantsBlindNil(v: PlayerView, level: BotLevel): boolean {
  const opt = v.bidOptions;
  if (skillOf(level) === 'novice' || skillOf(level) === 'regular' || !opt?.blindNil) return false;
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

/** Why a hand isn't a Nil (null = it looks Nil-worthy). Mirrors `nilWorthy`, in words. */
export function nilProblem(hand: readonly Card[], v: PlayerView): string | null {
  const r = v.rules;
  const order = trumpOrder(r);
  const trumps = hand.filter((c) => isTrump(c, r));
  const name = (c: Card) => (c === 'BJ' ? 'Big Joker' : c === 'LJ' ? 'Little Joker' : c);
  if (trumps.length > 3) return `${trumps.length} spades (trumps) is too many to stay under everyone`;
  const high = trumps.filter((c) => order.indexOf(c) < order.length - 7);
  if (high.length) return `${high.map(name).join(', ')} will win a trick`;
  for (const s of ['H', 'D', 'C']) {
    const cards = hand.filter((c) => !isTrump(c, r) && effectiveSuit(c, r) === s);
    const len = cards.length;
    const has = (rk: string) => cards.some((c) => c[0] === rk);
    if (has('A')) return `the A${s === 'H' ? '♥' : s === 'D' ? '♦' : '♣'} is a sure book`;
    if (has('K') && len < 4) return 'a short king can get stuck winning';
    if (has('Q') && len < 3) return 'a short queen can get stuck winning';
  }
  if (!nilWorthy(hand, v)) return 'not enough low cards to duck under';
  return null;
}

export interface BidAdvice {
  analysis: HandAnalysis;
  /** Books estimate after the partner adjustment. */
  estimate: number;
  /** Suggested numeric range (inclusive), within the legal bids. */
  low: number;
  high: number;
  /** What a Normal bot would bid with this hand right now. */
  botBid: number | 'nil';
  partnerNote: string | null;
  tableNote: string | null;
  nil: { ok: boolean; note: string } | null;
}

/** Player-facing bid coach: the bots' own count, explained, with a suggested range (spec §3.6). */
export function bidAdvice(v: PlayerView, rng: Rng): BidAdvice | null {
  const hand = v.hand;
  const opt = v.bidOptions;
  if (!hand || !opt) return null;
  const r = v.rules;
  const analysis = analyzeHand(hand, v);
  const partner = partnerOf(v.seat, r);
  const pBid = partner === null ? null : v.bids[partner];
  const partnerNil = isNilBid(pBid);
  const estimate = analysis.total + (partnerNil ? 0.5 : 0) + (r.partnerships ? 0 : 0.15);
  const botBid = chooseBid(v, 'normal', rng);
  const clamp = (x: number) => Math.min(opt.max, Math.max(opt.min, 1, x));
  let low = clamp(Math.floor(estimate)), high = clamp(Math.ceil(estimate));
  const numericBot = typeof botBid === 'number' ? botBid : null;
  if (numericBot !== null) { low = Math.min(low, numericBot); high = Math.max(high, numericBot); }
  const room = r.playerCount === 4 ? 13 : 17;
  const others = v.bids.reduce<number>((a, b, s) => a + (s !== v.seat && typeof b === 'number' ? b : 0), 0);
  let partnerNote: string | null = null;
  if (partner !== null) {
    if (typeof pBid === 'number') {
      const t0 = pBid + low, t1 = pBid + high;
      partnerNote = `Partner bid ${pBid} → team total ${t0 === t1 ? t0 : `${t0}–${t1}`}.${t1 > room ? ` More than ${room} can't all be made — trim it.` : ''}${r.minTeamBid && t0 < r.minTeamBid ? ` Your team needs at least ${r.minTeamBid}.` : ''}`;
    } else if (partnerNil) {
      partnerNote = 'Partner is going Nil (zero books): win with your high cards to protect them (+½ book).';
    } else {
      partnerNote = "Partner bids after you — bid what you'll take; they'll fill in the rest.";
    }
  }
  const tableNote = others > 0 ? `${others} of ${room} books already bid at the table${others + high > room ? ' — books are scarce, bid low' : ''}.` : null;
  let nil: BidAdvice['nil'] = null;
  if (opt.nil) {
    const problem = nilProblem(hand, v);
    nil = problem ? { ok: false, note: `Nil? Not this hand: ${problem}.` } : { ok: true, note: `Nil looks good: low cards everywhere (±${r.nil.value}).${r.partnerships ? ' Your partner covers you.' : ''}` };
  }
  return { analysis, estimate, low, high, botBid, partnerNote, tableNote, nil };
}
