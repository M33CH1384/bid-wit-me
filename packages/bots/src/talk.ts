/**
 * Bot trash talk engine (pure; the server and the offline game both drive it, so online lines come from the server).
 * - Event-driven: the caller reports a moment (a cut, a set, a nuke…); the engine picks who (if anyone) talks.
 * - Cooldowns: one bot line at a time (global gap), each bot rests between lines; big moments get a shorter gap.
 * - Pre-play lines never see the card about to be played (no tells): prePlayLine() takes no card/hand at all.
 * - Hustler persona plays dumb ('newbie' pool) until it pulls off a cut / lead-taking spade / set, then reveals once.
 */
import { COMMON, LINE_META, PACK_OWNERS, PERSONAS, type LineFact, type LineMeta, type PersonaId, type TalkIntensity, type TalkKind, lineAllowed, lineFitsGender, personaForName, personaSkillFloor } from './personas';
import type { GameState } from '@spades/rules';
import { banterContextFor } from './moments';
import { REV_MALCOLM_CUT_LINES, REV_TRIBUTE_TEXTS } from './revTributes';
import { possessive, voiceGender } from './names';
import { type CatalogMemory, type VoiceMoment, bucketFor, pickCatalog } from './catalog';
import { BOT_SKILLS, type BotSkill, seatSkill } from './bidding';

export { COMMON, LINE_META, PACK_OWNERS, PERSONAS, lineAllowed, personaForName, personaSkillFloor };
export type { LineFact, LineMeta, PersonaId, TalkIntensity, TalkKind };
export const TALK_INTENSITY_LABEL: Record<TalkIntensity, string> = { family: 'Family Friendly', cookout: 'Cookout', nomercy: 'No Mercy' };

export const TALK = {
  /** min gap between any two bot lines */
  globalGapMs: 3500,
  /** big moments (nuke, wheels, win/lose, reveal) only need this gap */
  bigGapMs: 1200,
  /** a bot rests this long after speaking */
  seatGapMs: 9000,
  /** base chance a moment produces a line (× persona freq) */
  chance: {
    prePlay: 0.12, cut: 0.55, gotCut: 0.3, overcut: 0.7, joker: 0.45, nuke: 1, gotNuked: 0.8, setThem: 0.85, gotSet: 0.4,
    made: 0.3, bigBid: 0.5, roastBid: 0.35, wheels: 0.95, nilMade: 0.7, nilBust: 0.8, bags: 0.6, duck: 0.18, slow: 0.6,
    streak: 0.5, runIt: 1, gotRan: 0.6, win: 1, lose: 0.9, rematch: 0.8, hypePartner: 0.55, newbie: 0.3, reveal: 1,
    slam: 0.3, partnerBlunder: 0.7, bidTooHigh: 0.5, nilBid: 0.6, blindNil: 0.9, boston: 1, loudLoser: 0.8, badHand: 0.35, roast: 0.5,
    onNotice: 0.8, shotOut: 1, matchPoint: 0.8,
    // trickPop never rolls on this table: its chance lives on the density profile
    // (TALK_PROFILES.trickPop), so the trigger stays dormant wherever no profile
    // opts a table in — the server's online tables included.
    trickPop: 0,
  } as Record<TalkKind, number>,
  recentMax: 14,
};

/**
 * Speech-density classes (story density pass, owner directive 2026-10-22:
 * "rarely a dull moment" — measured spec in STORY_DENSITY_SPEC.md). A table
 * opts into a class via TalkTable.profile; the story stop → class map is
 * STOP_DENSITY_CLASS (story.ts). `standard` is today's tuning, bit-for-bit,
 * and is what every table without a profile gets — the server's online
 * tables never set one, so online talk is untouched. Slow classes keep
 * their air on purpose: their gaps run ~2× the loud classes' and their
 * speech share is capped by the same numbers that floor the loud stops.
 * The web layer reads answerP/maxChain/murmurMs off the same profile
 * (answer chains + thinking-time murmurs live client-side).
 */
export type DensityClass = 'standard' | 'loud' | 'lively' | 'steady' | 'tense' | 'cold' | 'slow' | 'climax' | 'climaxLate';
export interface TalkProfile {
  globalGapMs: number;
  seatGapMs: number;
  bigGapMs: number;
  /** multiplier on every TALK.chance roll (result capped at 0.97) */
  chanceScale: number;
  /** prePlayLine's chance, stored directly — it is the cadence knob */
  prePlay: number;
  /** trick-completion react chance (before persona freq × gap bias) */
  trickPop: number;
  /** probability a generic line earns an answer (each next link halves) */
  answerP: number;
  /** max answers after the original line */
  maxChain: number;
  /** silence on the human's clock before a murmur may fire (0 = murmurs off) */
  murmurMs: number;
}
export const TALK_PROFILES: Record<DensityClass, TalkProfile> = {
  standard:   { globalGapMs: 3500, seatGapMs: 9000, bigGapMs: 1200, chanceScale: 1.0,  prePlay: 0.12, trickPop: 0,    answerP: 0,    maxChain: 0, murmurMs: 0 },
  loud:       { globalGapMs: 1200, seatGapMs: 4000, bigGapMs: 1200, chanceScale: 1.6,  prePlay: 0.30, trickPop: 0.50, answerP: 0.55, maxChain: 2, murmurMs: 7000 },
  lively:     { globalGapMs: 1500, seatGapMs: 5000, bigGapMs: 1200, chanceScale: 1.45, prePlay: 0.26, trickPop: 0.45, answerP: 0.50, maxChain: 2, murmurMs: 7000 },
  steady:     { globalGapMs: 2000, seatGapMs: 6000, bigGapMs: 1200, chanceScale: 1.3,  prePlay: 0.20, trickPop: 0.35, answerP: 0.45, maxChain: 2, murmurMs: 8000 },
  tense:      { globalGapMs: 2200, seatGapMs: 7000, bigGapMs: 1200, chanceScale: 1.25, prePlay: 0.16, trickPop: 0.34, answerP: 0.30, maxChain: 1, murmurMs: 9000 },
  cold:       { globalGapMs: 2300, seatGapMs: 7000, bigGapMs: 1200, chanceScale: 1.2,  prePlay: 0.18, trickPop: 0.36, answerP: 0.30, maxChain: 1, murmurMs: 9000 },
  slow:       { globalGapMs: 3200, seatGapMs: 9000, bigGapMs: 1200, chanceScale: 1.1,  prePlay: 0.18, trickPop: 0.34, answerP: 0.30, maxChain: 1, murmurMs: 12000 },
  climax:     { globalGapMs: 2000, seatGapMs: 6000, bigGapMs: 1200, chanceScale: 1.3,  prePlay: 0.22, trickPop: 0.40, answerP: 0.50, maxChain: 2, murmurMs: 7000 },
  /** the King's second gear (hand 5+, or a side within 300 of the 750 target):
   * the seated four lean in while the rail goes still (storyRail is unchanged) */
  climaxLate: { globalGapMs: 1500, seatGapMs: 4500, bigGapMs: 1200, chanceScale: 1.5,  prePlay: 0.26, trickPop: 0.48, answerP: 0.55, maxChain: 2, murmurMs: 7000 },
};
/** The density profile a table runs under (standard when it never opted in). */
export const profileOf = (t: TalkTable): TalkProfile => TALK_PROFILES[t.profile ?? 'standard'];
const BIG: TalkKind[] = ['nuke', 'gotNuked', 'wheels', 'runIt', 'win', 'lose', 'reveal', 'rematch', 'boston', 'shotOut', 'blindNil', 'matchPoint'];
/** moments that matter enough for filler to keep quiet right after them:
 * the BIG set plus the hand-swinging set/Nil resolutions and a fresh streak */
const SIGNIFICANT: TalkKind[] = [...BIG, 'setThem', 'gotSet', 'nilMade', 'nilBust', 'streak'];
/** how long a thinking-time murmur stays suppressed after a significant moment */
export const MURMUR_QUIET_MS = 6000;
/** the Silent Assassin only speaks for these */
const SILENT_KINDS: TalkKind[] = ['cut', 'setThem', 'overcut', 'runIt', 'win', 'slam'];
/** the losing side's take on a moment */
const MIRROR: Partial<Record<TalkKind, TalkKind>> = { cut: 'gotCut', overcut: 'gotCut', nuke: 'gotNuked', setThem: 'gotSet', win: 'lose', runIt: 'gotRan', partnerBlunder: 'roast' };
/** moments where the Hustler drops the act (when it did it) */
const REVEAL_ON: TalkKind[] = ['cut', 'overcut', 'setThem'];
/** a human did something good: their bot partner may hype them */
const HYPE_ON: TalkKind[] = ['cut', 'overcut', 'joker', 'nuke', 'setThem', 'nilMade', 'wheels', 'made', 'runIt'];

export interface TalkSeat { bot: boolean; name: string }
export interface TalkTable {
  seats: TalkSeat[];
  partnerships: boolean;
  /** per side display name */
  teamNames: string[];
  /** host's trash-talk intensity (default Cookout) */
  intensity?: TalkIntensity;
  /** Joker deck (gates '@jk' lines) */
  jokers?: boolean;
  /** Voice Phase 3 host flag (default off): Getting set / Wheels / match win may carry a pre-voiced catalog line */
  aiTalk?: boolean;
  /** speech-density class (story tables by stop; offline regular tables run 'lively' — the party profile) */
  profile?: DensityClass;
}
export interface TalkState {
  lastAt: number; seatAt: number[]; revealed: number[]; recent: string[];
  /** anti-repeat memory for the whole game: lines already said per `persona:kind` pool (a pool resets once mostly used) */
  used?: Record<string, string[]>;
  /** the last raw line said at this table (never twice in a row) */
  last?: string;
  /** catalog ids already said this game (Voice Phase 3) */
  ai?: CatalogMemory;
  /** cutthroat seats already seen eliminated (collection banter comments on a NEW elimination once) */
  elimSeen?: boolean[];
  /** trickPop pool-source rotation counter: odd picks draw the prePlay pool, even picks the roast pool */
  trickAlt?: number;
  /** last time a SIGNIFICANT moment (set, Nil resolved, nuke, game decided…)
   * reached the engine — murmurs keep quiet for a window after one so filler
   * never steps on a moment that mattered (moment-fit pass) */
  lastBigAt?: number;
  /** score-claim memory (moment-fit pass): `${kind}:${fact}:${side}` → the
   * bucket-sequence at which that claim was last spoken. The same claim from
   * the same side does not repeat while the facts stand still. */
  claims?: Record<string, { seq: number }>;
  /** per-side counter that advances whenever the side's score bucket changes */
  bucketSeq?: number[];
  /** per-side last observed score bucket */
  lastBucket?: (GapBucket | undefined)[];
  /** repetition budget (owner, 2026-10-22: the same line/phrase ~3× in one
   * hand, and the same phrasings hand after hand): the hand the per-hand
   * sets below belong to, as stamped by any event that carries a hand
   * number — the sets roll when it changes (noteTalkHand) */
  handNo?: number;
  /** normalized phrases already fired THIS hand — table-wide, every seat,
   * pool and trigger: a phrase fires at most once per hand */
  handPhrases?: Set<string>;
  /** catchphrase topic fire counts THIS hand (topics are capped at one
   * fire per hand while alternatives exist — see pick's tiered fallback) */
  handTopics?: Record<string, number>;
  /** bigram catchphrase fire counts for the whole match (capped) */
  matchTopics?: Record<string, number>;
  /** monotonic counter of lines said at this table (LRU recycle order) */
  saySeq?: number;
  /** last saySeq at which each raw line was said (pool rotation memory) */
  lineSeq?: Record<string, number>;
}
export interface TalkEvent {
  kind: TalkKind;
  /** the side that did it / benefited (for MIRROR kinds the other side may answer) */
  side?: number;
  /** the seat that did it */
  seat?: number;
  /** the seat the line is about ({them}); defaults to the actor or a player on the other side */
  them?: number;
  card?: string;
  bid?: number;
  gap?: number;
  /** an Ace got cut (gates '@ace' lines; they're preferred when true) */
  ace?: boolean;
  /** the target side is below zero (gates '@neg' lines) */
  neg?: boolean;
  /** books the side took this hand (Voice Phase 3 buckets: set by N, Wheels bid/books) */
  books?: number;
  /** score-gap bucket for `side` (the moment's side), relative to the target score */
  gapBucket?: GapBucket;
  /** tricks still to play this hand, bucketed (the current trick counts as still to play) */
  tricksLeft?: TricksLeftBucket;
  /** hand/game pressure: a late hand in a close game, a deciding trick, or the game result */
  pressure?: boolean;
  /** the seat that held the contract this moment is about (made / set / Nil), when there is one */
  bidderSeat?: number;
  /** the side that held that contract */
  bidderSide?: number;
  /** thinking-time murmur (density pass): `seat` is the REQUIRED speaker, and the
   * trickPop chance roll is skipped — the murmur timer is itself the gate */
  murmur?: boolean;
  /** answer chain (density pass): draw the trickPop speaker from THIS side
   * (the original speaker's side — the partner's co-sign pop) */
  answerSide?: number;
  /** answer chain: this seat (the original speaker) never answers itself */
  excludeSeat?: number;
  /** sets so far this match, per side (from the hand history): gates lines
   * that reference an earlier set ('oppSet' fact) */
  setsBySide?: number[];
  /** the hand this moment belongs to (the caller's game state): stamps the
   * per-hand repetition budget — phrases/topics roll when it changes */
  handNo?: number;
  /** the side that won the most recently completed hand of this match
   * (stamped by momentsFor / collectionBanter): gates 'wonPrevHand' lines */
  prevWinnerSide?: number;
}
export type GapBucket = 'close' | 'aheadBig' | 'behindBig';
export type TricksLeftBucket = 'early' | 'mid' | 'late';
/** `line`: stable id of the raw line, `<pool>.<kind>.<index>` (pool = persona id or 'common'): clients map it to a recorded clip */
export interface TalkLine { seat: number; name: string; text: string; persona: PersonaId; reveal?: boolean; line?: string; /** the bid number in a '{bid}' line (picks the numbered clip) */ bid?: number; /** Voice Phase 3: a pre-voiced catalog alternative. The client uses it (text + clip together) only when its clip plays; otherwise the canned text/line above */ ai?: { id: string; text: string } }

/** The id of a raw (unfilled) line as picked for this persona + kind. */
export function lineIdOf(persona: PersonaId, kind: TalkKind, raw: string): string | undefined {
  const own = PERSONAS[persona].lines[kind] ?? [];
  if (own.includes(raw)) return `${persona}.${kind}.${own.indexOf(raw)}`;
  const common = COMMON[kind] ?? [];
  return common.includes(raw) ? `common.${kind}.${common.indexOf(raw)}` : undefined;
}

/** The raw line behind a line id (undefined if this build doesn't have it). */
export function lineById(id: string): string | undefined {
  const [pool, kind, idx] = id.split('.');
  if (!pool || !kind || idx === undefined) return undefined;
  // Revolutionaries tributes live outside the persona pools (figure-keyed, not
  // moment-keyed): 'rev.tribute.<n>' / 'rev.malcolm.<n>' resolve into revTributes.
  if (pool === 'rev') return kind === 'malcolm' ? REV_MALCOLM_CUT_LINES[Number(idx)] : REV_TRIBUTE_TEXTS[Number(idx)];
  const list = pool === 'common' ? COMMON[kind as TalkKind] : PERSONAS[pool as PersonaId]?.lines[kind as TalkKind];
  return list?.[Number(idx)];
}

export function newTalkState(): TalkState { return { lastAt: -1e12, seatAt: [], revealed: [], recent: [], used: {} }; }

/* ------------------------------------------------------------------ */
/* Repetition budget (owner, 2026-10-22): the same phrase ~3× in one  */
/* hand reads as a glitch, and the same phrasings hand after hand     */
/* read as a loop. Three nested caps, all enforced in pick()/say():   */
/*  1. a normalized phrase fires at most ONCE per hand, table-wide —  */
/*     the COMMON pools are shared text behind per-persona bags, so   */
/*     without this the same sentence lands from three mouths;        */
/*  2. a catchphrase topic fires at most once per hand, and a bigram  */
/*     catchphrase at most MATCH_TOPIC_CAP times per match;           */
/*  3. across hands, a pool rotates LRU-style: a spent bag recycles    */
/*     its least-recently-said line instead of wiping, so a line      */
/*     only returns once the rest of the pool has had its turn.       */
/* Authored beats never pass through pick() (scripted scenes, the     */
/* guide, the rail, tributes) and consultation has its own bags, so   */
/* none of them are capped here.                                      */
/* ------------------------------------------------------------------ */

/** a raw line reduced to its phrase identity: words only, no slots,
 * numbers or punctuation — "{them} cooking 🔥" and "Dee cooking 🔥"
 * are the same phrase at the table */
export function normPhrase(raw: string): string {
  return raw.toLowerCase().replace(/\{[^}]*\}/g, ' ').replace(/[0-9]/g, ' ').replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** dialect-marker unigrams: a persona's verbal tic words (the streamer's
 * "chat", "clip", "viral"…). Topic key is `~word`; capped per hand. */
const TOPIC_UNIGRAMS = new Set(['chat', 'viral', 'clip', 'stream', 'screenshot', 'viewers', 'subscribers', 'content']);
/** catchphrase bigrams, curated from a corpus audit (2026-10-22): the
 * distinctive flavor phrases whose looping the ear catches — the
 * streamer's bits, the table's slogans. A frequency rule can't do this
 * job: at every threshold the set drowns in grammar glue ("for the",
 * "is going"), and capping glue at 2/match would mute whole pools by
 * hand four. Add a phrase here when a new slogan starts to loop. */
const TOPIC_BIGRAMS: Set<string> = new Set([
  'clip it', 'going viral', 'group chat', 'highlight reel', // the streamer's bits
  'let me cook', 'no cap', 'say less', 'scared money', 'mushroom cloud',
  'we eatin', 'frame it', 'wheels up', // table slogans
  'hold on', 'watch this', 'sit down', 'match point', 'my partner', // measured top offenders
]);
/** per-match cap for a bigram catchphrase (the per-hand cap also applies) */
export const MATCH_TOPIC_CAP = 2;

/** the catchphrase topics a raw line carries (bigram keys, `~unigram` keys) */
export function lineTopics(raw: string): string[] {
  const words = normPhrase(raw).split(' ').filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 1 < words.length; i++) {
    const bg = `${words[i]} ${words[i + 1]}`;
    if (TOPIC_BIGRAMS.has(bg)) out.add(bg);
  }
  for (const w of words) if (TOPIC_UNIGRAMS.has(w)) out.add(`~${w}`);
  return [...out];
}

/** stamp the table's current hand: when it changes, the per-hand phrase
 * and topic sets roll (a new hand may hear everything again — once) */
export function noteTalkHand(st: TalkState, handNo: number): void {
  if (st.handNo === handNo) return;
  st.handNo = handNo;
  st.handPhrases = new Set();
  st.handTopics = {};
}

export const sideOfSeat = (t: TalkTable, seat: number) => (t.partnerships ? seat % 2 : seat);
const sideCount = (t: TalkTable) => (t.partnerships ? 2 : t.seats.length);

export function personaOf(t: TalkTable, seat: number): PersonaId { return personaForName(t.seats[seat]?.name ?? ''); }

/** Tag for talk and the Hustler's cover. The plate uses `platePersona`, which does not flip. */
export function personaTag(name: string, revealed: boolean): string {
  const p = PERSONAS[personaForName(name)];
  if (!revealed && p.fakeTag) return p.fakeTag;
  return (voiceGender(name) === 'f' ? p.tagF : p.tagM) ?? p.tag;
}

/**
 * The name plate's personality, for the whole game.
 * The Hustler still talks like a newbie until the act drops, but that reveal
 * used to retitle the plate on the next hand. The plate keeps the real tag.
 */
export function platePersona(name: string): string {
  return personaTag(name, true);
}

export function cardWords(c: string | undefined): string {
  if (!c) return 'that card';
  if (c === 'BJ') return 'Big Joker'; if (c === 'LJ') return 'Little Joker';
  const r = c.slice(0, -1), s = c.slice(-1);
  const R: Record<string, string> = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack', T: '10' };
  const S: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
  return `${R[r] ?? r}${S[s] ?? ''}`;
}

function fill(text: string, t: TalkTable, speaker: number, ev: TalkEvent, them: number | undefined): string {
  const side = sideOfSeat(t, speaker);
  const opp = t.partnerships ? 1 - side : (them !== undefined ? sideOfSeat(t, them) : (side + 1) % sideCount(t));
  const partner = t.partnerships ? (speaker + 2) % t.seats.length : speaker;
  return text
    .replace(/\{me\}/g, t.seats[speaker]?.name ?? 'me')
    .replace(/\{them\}/g, them !== undefined ? (t.seats[them]?.name ?? 'you') : 'y\'all')
    .replace(/\{partner\}/g, t.seats[partner]?.name ?? 'partner')
    .replace(/\{team\}/g, t.teamNames[side] ?? 'us')
    .replace(/\{opp\}/g, t.teamNames[opp] ?? 'y\'all')
    .replace(/\{card\}/g, cardWords(ev.card))
    .replace(/\{their\}/g, them !== undefined ? possessive(t.seats[them]?.bot ? t.seats[them]?.name : undefined) : 'their')
    .replace(/\{bid\}/g, String(ev.bid ?? 'that many'))
    .replace(/\{gap\}/g, String(Math.abs(ev.gap ?? 0)));
}

/** does a line's condition hold for this event? */
/** the score bucket from the SPEAKER's side (a mirrored moment flips ahead/behind; close stays close) */
function speakerBucket(ev: TalkEvent, t: TalkTable, speaker: number | undefined): GapBucket | undefined {
  if (!ev.gapBucket || speaker === undefined) return undefined;
  if (ev.side === undefined || sideOfSeat(t, speaker) === ev.side) return ev.gapBucket;
  return ev.gapBucket === 'aheadBig' ? 'behindBig' : ev.gapBucket === 'behindBig' ? 'aheadBig' : 'close';
}

/** does a line's game-state fact fit this moment, for this speaker? */
function factOk(fact: LineFact | undefined, ev: TalkEvent, t: TalkTable, speaker: number | undefined, st?: TalkState): boolean {
  switch (fact) {
    case undefined: return false;
    case 'close': case 'aheadBig': case 'behindBig': return speakerBucket(ev, t, speaker) === fact;
    case 'lateHand': return ev.tricksLeft === 'late';
    case 'deciding': return !!ev.pressure;
    case 'bidderSelf': return speaker !== undefined && ev.bidderSeat === speaker;
    case 'bidderPartner': return speaker !== undefined && ev.bidderSide !== undefined && ev.bidderSeat !== speaker && sideOfSeat(t, speaker) === ev.bidderSide;
    case 'bidderOpp': return speaker !== undefined && ev.bidderSide !== undefined && sideOfSeat(t, speaker) !== ev.bidderSide;
    case 'oppSet': {
      if (speaker === undefined || !ev.setsBySide) return false;
      const mine = sideOfSeat(t, speaker);
      // the OTHER side(s) got set at some earlier point in this match
      return ev.setsBySide.some((n, s) => s !== mine && n > 0);
    }
    case 'priorEvent': {
      // the line claims something happened earlier in THIS match (a last
      // hand, a cut to avenge, a pattern). True only once a hand has been
      // completed before the current one — the event's hand number, or
      // the table's (every production caller stamps one). No hand known
      // = unverifiable = sits out. Cross-match memory lives in the
      // authored channels (rundowns, guide, awareness), never here: a
      // story retry does not make hand 1 of the new match a "last hand".
      const hn = ev.handNo ?? st?.handNo;
      return hn !== undefined && hn >= 2;
    }
    case 'wonPrevHand': {
      // "back to back": the speaker's side won the most recently
      // completed hand of this match (stamped on the event by
      // momentsFor / collectionBanter; unstamped = unverifiable = out),
      // and this is at least the second hand — after hand 1 alone there
      // is no "back" to be back to back with
      const hn = ev.handNo ?? st?.handNo;
      return speaker !== undefined && ev.prevWinnerSide !== undefined && ev.prevWinnerSide === sideOfSeat(t, speaker) && hn !== undefined && hn >= 2;
    }
  }
}

const SCORE_FACTS: LineFact[] = ['close', 'aheadBig', 'behindBig'];
/**
 * Track per-side score buckets as events report them: a side's bucketSeq
 * advances each time its bucket CHANGES, which is what "the facts changed"
 * means for the claim dedupe. `buckets` is indexed by side.
 */
function noteBuckets(st: TalkState, buckets: (GapBucket | undefined)[]): void {
  for (let side = 0; side < buckets.length; side++) {
    const b = buckets[side];
    if (b === undefined) continue;
    (st.lastBucket ??= []);
    if (st.lastBucket[side] !== b) {
      st.lastBucket[side] = b;
      (st.bucketSeq ??= [])[side] = (st.bucketSeq[side] ?? 0) + 1;
    }
  }
}
/** the speaker-relative claim key for a score-fact line, or null when the line makes no tracked claim */
function claimKey(kind: TalkKind, fact: LineFact | undefined, t: TalkTable, speaker: number | undefined): string | null {
  if (!fact || !SCORE_FACTS.includes(fact) || speaker === undefined) return null;
  return `${kind}:${fact}:${sideOfSeat(t, speaker)}`;
}

function condOk(meta: LineMeta | undefined, ev: TalkEvent, t: TalkTable): boolean {
  switch (meta?.cond) {
    case undefined: return true;
    case 'ace': return !!ev.ace;
    case 'neg': return !!ev.neg;
    case 'big': return ev.card === 'BJ';
    case 'little': return ev.card === 'LJ';
    case 'jk': return t.jokers !== false;
  }
}

/** Raw lines a persona draws on for a kind: its own pool, plus COMMON when its own pool is thin (< 3 at this intensity).
 * `self` is the speaking bot's gender (its name's voice gender): gendered self-references ("mama's thinking") only go to
 * bots of that gender. `target` is the gender of the bot the line is about (undefined for a human: never gendered). */
/** Lines that only make sense with partners ("sorry partner", "{team}", "your teammate"): never said in no-teams modes. */
export const PARTNER_LINE = /partner|team ?mate|\{team\}|\b(my|your|whole|our) team\b/i;
export function mentionsPartner(raw: string): boolean { return PARTNER_LINE.test(raw); }

export function poolFor(persona: PersonaId, kind: TalkKind, intensity: TalkIntensity = 'cookout', self?: 'f' | 'm', target?: 'f' | 'm', teams = true): string[] {
  const ok = (l: string) => lineAllowed(l, intensity) && lineFitsGender(l, self, target) && (teams || !mentionsPartner(l));
  const own = (PERSONAS[persona].lines[kind] ?? []).filter(ok);
  const noCommon = persona === 'silent' || (persona === 'hustler' && (kind === 'newbie' || kind === 'reveal'));
  if (noCommon || own.length >= 3) return own;
  return [...own, ...(COMMON[kind] ?? []).filter(ok)];
}

/** Every raw line a persona's `gender` voice can ever say (any intensity, condition or target): what gets a recorded clip. */
export function speakableLines(persona: PersonaId, gender?: 'f' | 'm'): { kind: TalkKind; raw: string; id: string; self?: 'f' | 'm' }[] {
  const out: { kind: TalkKind; raw: string; id: string; self?: 'f' | 'm' }[] = [];
  const seen = new Set<string>();
  const kinds = new Set<TalkKind>([...Object.keys(PERSONAS[persona].lines), ...Object.keys(COMMON)] as TalkKind[]);
  const genders = gender ? [gender] : (['f', 'm'] as const);
  for (const kind of kinds) {
    const lines = genders.flatMap((g) => (['family', 'cookout', 'nomercy'] as const).flatMap((i) =>
      [...poolFor(persona, kind, i, g, undefined), ...poolFor(persona, kind, i, g, 'f'), ...poolFor(persona, kind, i, g, 'm')]));
    for (const raw of [...new Set(lines)]) {
      const id = lineIdOf(persona, kind, raw)!;
      if (seen.has(id)) continue;
      seen.add(id);
      const self = LINE_META[raw]?.self;
      out.push({ kind, raw, id, ...(self ? { self } : {}) });
    }
  }
  return out;
}

/** gender of the bot sitting in a seat (its name's voice gender), undefined for a human */
function botGender(t: TalkTable, seat: number | undefined): 'f' | 'm' | undefined {
  const s = seat === undefined ? undefined : t.seats[seat];
  return s && s.bot ? voiceGender(s.name) : undefined;
}

function pick(st: TalkState, t: TalkTable, persona: PersonaId, kind: TalkKind, ev: TalkEvent, rnd: () => number, self?: 'f' | 'm', target?: 'f' | 'm', speaker?: number): string | null {
  // MOMENT FIT (owner, 2026-10-22: lines "just don't fit the moment"): a line
  // that ASSERTS a checkable claim only fires when the claim is verifiably
  // true under this event's fact snapshot. Tagged lines used to be merely
  // PREFERRED when they fit (85%) and stayed drawable when they didn't — a
  // "we're on a heater" could land while down 200. Now the tag is a gate:
  // false or unverifiable (the snapshot doesn't carry the fact) → the line
  // sits out. Claim-free lines are always eligible, so a pool that gates to
  // empty falls back to them before it ever falls silent. {bid}/{gap} lines
  // are claims too: without the number on the event they fill as "that
  // many"/"0", so they sit out as well.
  const claimOk = (l: string): boolean => {
    const meta = LINE_META[l];
    if (meta?.fact && !factOk(meta.fact, ev, t, speaker, st)) return false;
    if (l.includes('{bid}') && typeof ev.bid !== 'number') return false;
    if (l.includes('{gap}') && typeof ev.gap !== 'number') return false;
    // topic dedupe: the same score claim from the same side of the same pool
    // does not repeat while the score facts stand still (bucket unchanged)
    const key = claimKey(kind, meta?.fact, t, speaker);
    if (key) {
      const said = st.claims?.[key];
      if (said && said.seq === (speaker !== undefined ? (st.bucketSeq?.[sideOfSeat(t, speaker)] ?? 0) : 0)) return false;
    }
    return true;
  };
  // repetition budget: a phrase already fired this hand (by ANY seat — the
  // COMMON text behind four personas' bags is one sentence at the table)
  // sits out, as does a line carrying a catchphrase topic the hand has
  // already heard or the match has capped. Applied to the whole eligible
  // pool BEFORE the preference slices, so a capped favourite falls back to
  // a fresh line in the same pool, never to a fact-false one. The PHRASE
  // cap is hard; the TOPIC cap is a preference: when it alone empties the
  // pool, the topic lines come back (a persona's dialect shouldn't mute
  // her seat) — a repeated phrase is a glitch, a repeated tic is a person.
  const budgetOn = st.handNo !== undefined;
  const phraseOk = (l: string): boolean => !budgetOn || !st.handPhrases?.has(normPhrase(l));
  const topicOk = (l: string): boolean => {
    if (!budgetOn) return true;
    for (const tp of lineTopics(l)) {
      if ((st.handTopics?.[tp] ?? 0) >= 1) return false;
      if (!tp.startsWith('~') && (st.matchTopics?.[tp] ?? 0) >= MATCH_TOPIC_CAP) return false;
    }
    return true;
  };
  const eligible = poolFor(persona, kind, t.intensity ?? 'cookout', self, target, t.partnerships).filter((l) => condOk(LINE_META[l], ev, t) && claimOk(l) && phraseOk(l));
  const all = eligible.filter(topicOk);
  if (!all.length && eligible.length) {
    // topic-only exhaustion, tiered: first re-admit lines whose topics
    // have fired at most once this hand (a topic may reach 2 in a hand
    // only when the pool has nothing fresher) — the per-MATCH bigram cap
    // stays hard at this tier, so a catchphrase can't ride the fallback
    // hand after hand; only if even that is empty does the bare
    // phrase-fresh pool speak (the phrase cap itself never relaxes)
    const soft = !budgetOn ? [] : eligible.filter((l) => lineTopics(l).every((tp) => (st.handTopics?.[tp] ?? 0) < 2 && (tp.startsWith('~') || (st.matchTopics?.[tp] ?? 0) < MATCH_TOPIC_CAP)));
    // last resort: the phrase-fresh pool, but a match-capped catchphrase
    // still may not pass twice its cap — beyond that the seat goes quiet
    // rather than looping the slogan the owner complained about
    const capped = !budgetOn ? eligible : eligible.filter((l) => lineTopics(l).every((tp) => tp.startsWith('~') || (st.matchTopics?.[tp] ?? 0) < MATCH_TOPIC_CAP * 2));
    all.push(...(soft.length ? soft : capped));
  }
  if (!all.length) return null;
  // an Ace got cut: the Ace lines are the point
  const ace = ev.ace ? all.filter((l) => LINE_META[l]?.cond === 'ace') : [];
  // lines tagged with a game-state fact that fits this moment are preferred just as strongly;
  // when nothing tagged fits (or the roll misses) the whole pool still speaks — never silence
  const factFit = all.filter((l) => factOk(LINE_META[l]?.fact, ev, t, speaker, st));
  let base = all;
  if (ace.length && rnd() < 0.7) base = ace;
  else if (factFit.length && rnd() < 0.85) base = factFit;
  const key = `${persona}:${kind}`;
  const used = ((st.used ??= {})[key] ??= []);
  let fresh = base.filter((l) => !used.includes(l) && l !== st.last && !st.recent.includes(l));
  if (!fresh.length && base !== all) {
    // The preferred slice (Ace lines / fact fits) is often only 1–2 lines. The old code
    // reset `used` here, so in a persistent context (a side ahead big all game, the same
    // bidder making contracts) those same 1–2 "preferred" lines cycled every couple of
    // fires — the loudest repetition at the table. Widen to the full pool first; only
    // reset when the WHOLE pool has been heard.
    fresh = all.filter((l) => !used.includes(l) && l !== st.last && !st.recent.includes(l));
  }
  if (!fresh.length) {
    // The pool is spent for this match. The old code wiped the bag here, so
    // the rotation restarted mid-match and the pool's first lines (often
    // the fact-preferred slice) hammered again — the hand-after-hand loop
    // the owner hears. Recycle ONE line instead: the least-recently-said
    // line of the slice, so a line only returns once everything else in
    // the pool has had its turn since. `used` is left intact (the bag
    // stays spent; only the LRU line is re-admitted, once).
    const cands = base.filter((l) => l !== st.last);
    if (!cands.length) return null;
    cands.sort((a, b) => (st.lineSeq?.[a] ?? 0) - (st.lineSeq?.[b] ?? 0));
    return cands[0]!;
  }
  // own (non-COMMON) lines weigh double
  const own = PERSONAS[persona].lines[kind] ?? [];
  const weighted = fresh.flatMap((l) => (own.includes(l) ? [l, l] : [l]));
  const raw = weighted[Math.floor(rnd() * weighted.length)]!;
  st.used[key] = [...(st.used[key] ?? []), raw];
  return raw;
}

function say(st: TalkState, t: TalkTable, seat: number, kind: TalkKind, ev: TalkEvent, them: number | undefined, now: number, rnd: () => number, reveal = false): TalkLine | null {
  const persona = personaOf(t, seat);
  const name = t.seats[seat]?.name ?? '';
  const raw = pick(st, t, persona, kind, ev, rnd, voiceGender(name), botGender(t, them), seat);
  if (!raw) return null;
  // record the score claim this line just made (topic dedupe in pick)
  const cKey = claimKey(kind, LINE_META[raw]?.fact, t, seat);
  if (cKey) (st.claims ??= {})[cKey] = { seq: st.bucketSeq?.[sideOfSeat(t, seat)] ?? 0 };
  // repetition budget bookkeeping: this phrase + its catchphrase topics
  // are spent for the hand; bigram catchphrases also count toward the
  // match cap; the say order feeds the LRU pool rotation
  (st.handPhrases ??= new Set()).add(normPhrase(raw));
  for (const tp of lineTopics(raw)) {
    (st.handTopics ??= {})[tp] = (st.handTopics?.[tp] ?? 0) + 1;
    if (!tp.startsWith('~')) (st.matchTopics ??= {})[tp] = (st.matchTopics?.[tp] ?? 0) + 1;
  }
  st.saySeq = (st.saySeq ?? 0) + 1;
  (st.lineSeq ??= {})[raw] = st.saySeq;
  st.recent = [...st.recent, raw].slice(-TALK.recentMax);
  st.last = raw;
  st.lastAt = now;
  st.seatAt[seat] = now;
  let text = fill(raw, t, seat, ev, them);
  if (PERSONAS[persona].caps) text = text.toUpperCase();
  const line = lineIdOf(persona, kind, raw);
  const ai = aiAlternative(st, t, persona, voiceGender(name), kind, ev, rnd);
  return { ...(ai ? { ai } : {}), seat, name: t.seats[seat]!.name, text, persona, ...(reveal ? { reveal: true } : {}), ...(line ? { line } : {}), ...(raw.includes('{bid}') && typeof ev.bid === 'number' ? { bid: ev.bid } : {}) };
}

const AI_MOMENT: Partial<Record<TalkKind, VoiceMoment>> = { setThem: 'set', wheels: 'wheels', win: 'win' };
/** Voice Phase 3: a catalog line for this moment's facts, only behind the host flag. Null → the canned line alone. */
function aiAlternative(st: TalkState, t: TalkTable, persona: PersonaId, g: 'f' | 'm' | undefined, kind: TalkKind, ev: TalkEvent, rnd: () => number): { id: string; text: string } | null {
  const moment = AI_MOMENT[kind];
  if (!t.aiTalk || !moment || !g) return null;
  const bucket = bucketFor(moment, { bid: ev.bid, books: ev.books });
  if (!bucket) return null;
  const hit = pickCatalog((st.ai ??= {}), persona, g, bucket, rnd);
  if (!hit) return null;
  const text = PERSONAS[persona].caps ? hit.text.toUpperCase() : hit.text;
  return { id: hit.id, text };
}

const ready = (st: TalkState, t: TalkTable, seat: number, now: number, big: boolean) => {
  const prof = profileOf(t);
  return now - (st.seatAt[seat] ?? -1e12) >= (big ? prof.bigGapMs : prof.seatGapMs);
};

/**
 * The trick-completion react (density pass). trickPop has NO recorded lines
 * of its own and must never get any: the line resolves to the speaker's
 * recorded `prePlay` pool (odd picks) or `roast` pool (even picks) — the
 * rotation keeps one small pool from draining 13× a hand — so at story
 * tables it rides the fence merge's cast-sprite template path exactly like
 * a prePlay line, and no second voice can appear. The loser chirps more
 * than the winner gloats (60/40). Silent-persona seats never pop: their
 * rare lines stay rare.
 */
function trickPopTalk(st: TalkState, t: TalkTable, ev: TalkEvent, now: number, rnd: () => number): TalkLine | null {
  const prof = profileOf(t);
  const bots = t.seats.map((s, i) => (s.bot ? i : -1)).filter((i) => i >= 0);
  const readyBots = bots.filter((c) => personaOf(t, c) !== 'silent' && ready(st, t, c, now, false));
  if (ev.murmur) {
    // thinking-time murmur: the caller named the seat; the timer was the gate
    if (ev.seat === undefined || !readyBots.includes(ev.seat)) return null;
    // …but never on top of a moment that mattered: a set, a busted Nil, a
    // nuke in the last few seconds owns the table's attention, not filler
    if (st.lastBigAt !== undefined && now - st.lastBigAt < MURMUR_QUIET_MS) return null;
    return sayTrickPop(st, t, ev.seat, ev, now, rnd);
  }
  if (prof.trickPop <= 0) return null; // standard tables: the trigger is dormant
  if (!readyBots.length) return null;
  let pool: number[];
  if (ev.answerSide !== undefined) {
    // an answer chain's partner co-sign: draw from the original speaker's side
    const same = readyBots.filter((c) => sideOfSeat(t, c) === ev.answerSide && c !== ev.excludeSeat);
    const other = readyBots.filter((c) => sideOfSeat(t, c) !== ev.answerSide && c !== ev.excludeSeat);
    pool = same.length ? same : other;
  } else {
    const winSide = ev.side;
    const losers = readyBots.filter((c) => winSide === undefined || sideOfSeat(t, c) !== winSide);
    const winners = readyBots.filter((c) => winSide !== undefined && sideOfSeat(t, c) === winSide);
    const preferLosers = rnd() < 0.6;
    const first = preferLosers ? losers : winners;
    pool = first.length ? first : (preferLosers ? winners : losers);
  }
  if (!pool.length) return null;
  const seat = pool[Math.floor(rnd() * pool.length)]!;
  if (rnd() >= prof.trickPop * freqOf(st, t, seat) * gapBiasOf(personaOf(t, seat), speakerBucket(ev, t, seat))) return null;
  return sayTrickPop(st, t, seat, ev, now, rnd);
}

/** Say a trickPop line: alternate the recorded pool the pick draws from. */
function sayTrickPop(st: TalkState, t: TalkTable, seat: number, ev: TalkEvent, now: number, rnd: () => number): TalkLine | null {
  const alt = (st.trickAlt ?? 0) + 1;
  st.trickAlt = alt;
  const kind: TalkKind = alt % 2 === 1 ? 'prePlay' : 'roast';
  return speak(st, t, seat, kind, ev, ev.them, now, rnd);
}

/** React to a moment. Returns at most one line (or null), and updates the cooldown state. */
export function botTalk(st: TalkState, t: TalkTable, ev: TalkEvent, now: number, rnd: () => number): TalkLine | null {
  const bots = t.seats.map((s, i) => (s.bot ? i : -1)).filter((i) => i >= 0);
  if (!bots.length) return null;
  // the per-hand repetition budget rolls with the caller's hand number
  if (ev.handNo !== undefined) noteTalkHand(st, ev.handNo);
  // moment-fit bookkeeping runs on EVERY event, spoken or not: a significant
  // moment stamps the murmur-quiet window, and reported score buckets feed
  // the claim dedupe's "facts changed" test
  if (SIGNIFICANT.includes(ev.kind)) st.lastBigAt = now;
  if (ev.gapBucket && ev.side !== undefined) {
    if (t.partnerships) {
      const flip = (b: GapBucket): GapBucket => (b === 'aheadBig' ? 'behindBig' : b === 'behindBig' ? 'aheadBig' : 'close');
      const buckets: (GapBucket | undefined)[] = [];
      buckets[ev.side] = ev.gapBucket;
      buckets[1 - ev.side] = flip(ev.gapBucket);
      noteBuckets(st, buckets);
    } else {
      const buckets: (GapBucket | undefined)[] = [];
      buckets[ev.side] = ev.gapBucket;
      noteBuckets(st, buckets);
    }
  }
  // no teams (Cutthroat): partner moments don't exist
  if (!t.partnerships && (ev.kind === 'partnerBlunder' || ev.kind === 'hypePartner')) return null;
  const big = BIG.includes(ev.kind);
  const actor = ev.seat;
  const side = ev.side ?? (actor !== undefined ? sideOfSeat(t, actor) : undefined);
  const onSide = (s: number) => side !== undefined && sideOfSeat(t, s) === side;
  const otherThem = (speaker: number) => ev.them ?? (actor !== undefined && sideOfSeat(t, actor) !== sideOfSeat(t, speaker) ? actor : t.seats.findIndex((_, i) => side !== undefined && !onSide(i) && i !== speaker));
  // a bot that runs the board always gets its line in (it's the centrepiece of the Run it! zoom)
  const claim = ev.kind === 'runIt' && ev.seat !== undefined && !!t.seats[ev.seat]?.bot && personaOf(t, ev.seat) !== 'hustler';
  if (claim) {
    const line = say(st, t, ev.seat!, 'runIt', ev, otherThem(ev.seat!), now, rnd);
    if (line) return line;
  }
  const prof = profileOf(t);
  if (now - st.lastAt < (big ? prof.bigGapMs : prof.globalGapMs)) return null;

  // the Hustler drops the act when it pulls one off itself (once)
  if (actor !== undefined && t.seats[actor]?.bot && personaOf(t, actor) === 'hustler' && !st.revealed.includes(actor) && REVEAL_ON.includes(ev.kind)) {
    st.revealed = [...st.revealed, actor];
    return say(st, t, actor, 'reveal', ev, otherThem(actor), now, rnd, true);
  }

  // a human on a bot's team did something good → the bot partner hypes them
  if (t.partnerships && actor !== undefined && !t.seats[actor]?.bot && HYPE_ON.includes(ev.kind)) {
    const p = (actor + 2) % t.seats.length;
    if (t.seats[p]?.bot && ready(st, t, p, now, big) && rnd() < Math.min(0.97, TALK.chance.hypePartner * prof.chanceScale) * freqOf(st, t, p) * gapBiasOf(personaOf(t, p), speakerBucket(ev, t, p))) return speak(st, t, p, 'hypePartner', ev, actor, now, rnd);
  }

  // trick-completion react (density pass): the cadence floor — 13 tricks a
  // hand and the table notices most of them at loud tables, some everywhere
  // a profile runs. Dormant at standard tables (profile.trickPop = 0).
  if (ev.kind === 'trickPop') return trickPopTalk(st, t, ev, now, rnd);

  // who talks: the actor (if a bot), else a bot on the benefiting side; for MIRROR kinds sometimes the other side answers
  let kind: TalkKind = ev.kind;
  let cands: number[];
  if (kind === 'duck' || kind === 'roastBid' || kind === 'bidTooHigh' || kind === 'nilBid' || kind === 'blindNil' || kind === 'loudLoser') cands = bots.filter((b) => !onSide(b) && b !== ev.them);
  else if (kind === 'slow' || kind === 'rematch' || kind === 'prePlay') cands = bots.filter((b) => b !== ev.them);
  else if (kind === 'badHand') cands = actor !== undefined && t.seats[actor]?.bot ? [actor] : [];
  else if (kind === 'partnerBlunder') {
    // the blunderer's partner (a bot) groans at them; sometimes the other side laughs instead
    const p = t.partnerships && actor !== undefined ? (actor + 2) % t.seats.length : -1;
    cands = p >= 0 && t.seats[p]?.bot ? [p] : [];
    const others = bots.filter((b) => !onSide(b));
    if (others.length && (!cands.length || rnd() > 0.75)) { kind = 'roast'; cands = others; }
  }
  else {
    // 'runIt' lines are first person ('the rest are mine'): only the bot that ran it says them; otherwise the other side answers
    cands = actor !== undefined && t.seats[actor]?.bot && onSide(actor) ? [actor] : kind === 'runIt' ? [] : bots.filter(onSide);
    const mirror = MIRROR[kind];
    const others = bots.filter((b) => !onSide(b));
    if (mirror && others.length && (!cands.length || rnd() > 0.7)) { kind = mirror; cands = others; }
  }
  cands = cands.filter((c) => c !== ev.excludeSeat && ready(st, t, c, now, big) && (personaOf(t, c) !== 'silent' || SILENT_KINDS.includes(kind)));
  if (!cands.length) return null;
  const seat = cands[Math.floor(rnd() * cands.length)]!;
  if (rnd() >= Math.min(0.97, (TALK.chance[kind] ?? 0.3) * prof.chanceScale) * freqOf(st, t, seat) * gapBiasOf(personaOf(t, seat), speakerBucket(ev, t, seat))) return null;
  const them = kind === 'slow' || kind === 'partnerBlunder' ? ev.them ?? actor : otherThem(seat);
  // a set can come back as a petty one-liner
  if (kind === 'setThem' && rnd() < 0.15) kind = 'roast';
  return speak(st, t, seat, kind, ev, them === -1 ? undefined : them, now, rnd);
}

/** how chatty a persona is right now: base freq × its score-gap mood for the speaker's own side */
export function gapBiasOf(persona: PersonaId, bucket: GapBucket | undefined): number {
  if (!bucket) return 1;
  return PERSONAS[persona].gapBias?.[bucket] ?? 1;
}

function freqOf(_st: TalkState, t: TalkTable, seat: number): number { return PERSONAS[personaOf(t, seat)].freq; }

/** Hustler still acting → everything comes out of the 'newbie' pool. */
function speak(st: TalkState, t: TalkTable, seat: number, kind: TalkKind, ev: TalkEvent, them: number | undefined, now: number, rnd: () => number): TalkLine | null {
  const acting = personaOf(t, seat) === 'hustler' && !st.revealed.includes(seat);
  return say(st, t, seat, acting ? 'newbie' : kind, ev, them, now, rnd);
}

interface BanterSlot {
  kind: TalkKind; side: number; loser: boolean;
  them?: number; bid?: number; books?: number; preferSeat?: number; bidderSeat?: number; bidderSide?: number;
}

/**
 * The card-collection banter (offline): up to two lines about the hand that just ended —
 * one from the winning perspective, one from the losing side when there is one.
 *
 * This used to be drawn in the client from the raw pack with pure Math.random(): no
 * persona, no memory, and two of its three winner kinds ('made' / 'gotSet') had no pack
 * section at all, so those slots silently fired nothing. It now routes through the same
 * engine as every other line — persona pools, the per-game anti-repeat memory, fact
 * preference, persona chattiness × score-gap mood for speaker choice — and the context
 * comes from `banterContextFor` (the same hand-record predicates as momentsFor).
 * Cooldowns are the caller's business: the collection window owns the schedule.
 */
/** sets so far this match, per side, from the hand history (the 'oppSet' fact's snapshot) */
export function setsBySideOf(state: GameState): number[] {
  const out: number[] = [];
  for (const h of state.history ?? []) for (const s of h.sides) if (s.contractMade === false) out[s.side] = (out[s.side] ?? 0) + 1;
  return out;
}

export function collectionBanter(st: TalkState, t: TalkTable, after: GameState, now: number, rnd: () => number, maxLines = 2): TalkLine[] {
  // banter speaks about the hand that just ended — it belongs to that
  // hand's repetition budget (after.handNo is still the finished hand)
  noteTalkHand(st, after.handNo);
  const ctx = banterContextFor(after);
  if (!ctx) return [];
  noteBuckets(st, ctx.buckets);
  const alive = (seat: number) => !(after.eliminated?.[seat]);
  const botsOn = (side: number) => t.seats.map((s, i) => (s.bot && sideOfSeat(t, i) === side && alive(i) ? i : -1)).filter((i) => i >= 0);
  /** who profits when `side` suffers: the other team, or (cutthroat) the side that scored most this hand */
  const beneficiaryOf = (side: number): number | undefined => {
    if (t.partnerships) return 1 - side;
    let best: number | undefined; let bestPts = -Infinity;
    ctx.handPoints.forEach((pts, s) => { if (s !== side && pts > bestPts) { bestPts = pts; best = s; } });
    return best;
  };
  const winners: BanterSlot[] = [];
  const losers: BanterSlot[] = [];
  for (const side of ctx.bostonSides) winners.push({ kind: 'boston', side, loser: false, bid: ctx.contractBid[side], bidderSeat: ctx.contractSeat[side], bidderSide: side });
  for (const side of ctx.setSides) {
    const ben = beneficiaryOf(side);
    if (ben === undefined) continue;
    winners.push({ kind: 'setThem', side: ben, loser: false, them: ctx.contractSeat[side], bid: ctx.contractBid[side], books: ctx.handTricks[side], bidderSeat: ctx.contractSeat[side], bidderSide: side });
    losers.push({ kind: 'gotSet', side, loser: true, them: ctx.contractSeat[ben], bidderSeat: ctx.contractSeat[side], bidderSide: side });
  }
  for (const side of ctx.wheelsSides) winners.push({ kind: 'wheels', side, loser: false, bid: ctx.contractBid[side], books: ctx.handTricks[side], bidderSeat: ctx.contractSeat[side], bidderSide: side });
  for (const seat of ctx.nilBustSeats) {
    const ben = beneficiaryOf(sideOfSeat(t, seat));
    if (ben !== undefined) winners.push({ kind: 'nilBust', side: ben, loser: false, them: seat, bidderSeat: seat, bidderSide: sideOfSeat(t, seat) });
  }
  // a NEW elimination (cutthroat): survivors mark it, once per seat per game
  const elimNow = after.eliminated ?? [];
  const seen = st.elimSeen ?? [];
  elimNow.forEach((out, seat) => {
    if (out && !seen[seat]) {
      const ben = beneficiaryOf(seat) ?? ctx.handPoints.indexOf(Math.max(...ctx.handPoints));
      winners.push({ kind: 'shotOut', side: ben, loser: false, them: seat });
    }
  });
  st.elimSeen = [...elimNow];
  for (const side of ctx.matchPointSides) winners.push({ kind: 'matchPoint', side, loser: false });
  for (const side of [...ctx.bagsSides, ...ctx.bagsHotSides]) {
    const ben = beneficiaryOf(side);
    if (ben !== undefined) winners.push({ kind: 'bags', side: ben, loser: false, them: ctx.contractSeat[side], bidderSeat: ctx.contractSeat[side], bidderSide: side });
  }
  for (const seat of ctx.nilMadeSeats) winners.push({ kind: 'nilMade', side: sideOfSeat(t, seat), loser: false, preferSeat: seat, bidderSeat: seat, bidderSide: sideOfSeat(t, seat) });
  for (const side of ctx.madeSides) winners.push({ kind: 'made', side, loser: false, bid: ctx.contractBid[side], preferSeat: ctx.contractSeat[side], bidderSeat: ctx.contractSeat[side], bidderSide: side });
  if (ctx.streakSide !== undefined) winners.push({ kind: 'streak', side: ctx.streakSide, loser: false });
  for (const side of ctx.shotSides) {
    const ben = beneficiaryOf(side);
    if (ben !== undefined) winners.push({ kind: 'onNotice', side: ben, loser: false, them: ctx.contractSeat[side], bidderSeat: ctx.contractSeat[side], bidderSide: side });
  }
  if (!losers.length) {
    // no set: the hand's low scorer cops a roast from their own side of the table talk
    const winSide = ctx.handPoints.indexOf(Math.max(...ctx.handPoints));
    let lowSide: number | undefined; let low = Infinity;
    ctx.handPoints.forEach((pts, s) => { if (s !== winSide && pts < low) { low = pts; lowSide = s; } });
    if (lowSide !== undefined && low < (ctx.handPoints[winSide] ?? 0)) losers.push({ kind: 'roast', side: lowSide, loser: true, them: ctx.contractSeat[winSide] });
  }

  const spoken = new Set<number>();
  const usedKinds = new Set<TalkKind>();
  const speakSlot = (slot: BanterSlot): TalkLine | null => {
    const pool = botsOn(slot.side).filter((s) => !spoken.has(s) && (personaOf(t, s) !== 'silent' || SILENT_KINDS.includes(slot.kind)));
    while (pool.length) {
      // speaker draw weighted by persona chattiness × mood; the contract holder is favoured for made/nil lines
      const weights = pool.map((s) => PERSONAS[personaOf(t, s)].freq * gapBiasOf(personaOf(t, s), ctx.buckets[slot.side]) * (s === slot.preferSeat ? 3 : 1));
      let x = rnd() * weights.reduce((a, b) => a + b, 0);
      let ix = 0;
      while (ix < pool.length - 1 && (x -= weights[ix]!) >= 0) ix++;
      const seat = pool.splice(ix, 1)[0]!;
      const ev: TalkEvent = {
        kind: slot.kind, side: slot.side,
        ...(slot.them !== undefined ? { them: slot.them } : {}),
        ...(slot.bid !== undefined ? { bid: slot.bid } : {}),
        ...(slot.books !== undefined ? { books: slot.books } : {}),
        ...(ctx.buckets[slot.side] ? { gapBucket: ctx.buckets[slot.side] } : {}),
        tricksLeft: 'late',
        ...(slot.kind === 'matchPoint' ? { pressure: true } : {}),
        ...(slot.bidderSeat !== undefined ? { bidderSeat: slot.bidderSeat } : {}),
        ...(slot.bidderSide !== undefined ? { bidderSide: slot.bidderSide } : {}),
        setsBySide: setsBySideOf(after),
        // the hand that just ended is the most recently completed one:
        // its winner gates 'wonPrevHand' lines in this banter
        prevWinnerSide: ctx.handPoints.indexOf(Math.max(...ctx.handPoints)),
      };
      const line = speak(st, t, seat, slot.kind, ev, slot.them, now, rnd);
      if (line) { spoken.add(seat); usedKinds.add(slot.kind); return line; }
    }
    return null;
  };
  const out: TalkLine[] = [];
  const take = (slots: BanterSlot[]) => {
    for (const slot of slots) {
      if (usedKinds.has(slot.kind)) continue;
      const line = speakSlot(slot);
      if (line) { out.push(line); return true; }
    }
    return false;
  };
  take(winners);
  take(losers);
  if (out.length < 2) take(winners);
  // A third line (density pass: story tables at loud/lively stops pass
  // maxLines 3) takes the next unused context slot in the function's own
  // priority order — bags/streak/matchPoint context is already in the
  // winners list above the plain made/roast fallback.
  while (maxLines > 2 && out.length < maxLines) { if (!take(winners)) break; }
  return out.slice(0, Math.max(2, maxLines));
}

/**
 * Maybe say something BEFORE this bot plays. Deliberately takes no card or hand: the line can't be a tell.
 * The caller adds a short beat before the card lands when a line comes back.
 */
export function prePlayLine(st: TalkState, t: TalkTable, seat: number, now: number, rnd: () => number): TalkLine | null {
  if (!t.seats[seat]?.bot || personaOf(t, seat) === 'silent') return null;
  const prof = profileOf(t);
  if (now - st.lastAt < prof.globalGapMs || !ready(st, t, seat, now, false)) return null;
  if (rnd() >= prof.prePlay * freqOf(st, t, seat)) return null;
  return speak(st, t, seat, 'prePlay', { kind: 'prePlay' }, undefined, now, rnd);
}

/** Persona bid lean: sometimes nudge a numeric bid by the persona's lean (±1), Hustler only while acting. Never below 1. */
export function leanBid(bid: number, name: string, revealed: boolean, rnd: () => number): number {
  const p = PERSONAS[personaForName(name)];
  if (p.lean.bid === 0 || (p.id === 'hustler' && revealed)) return bid;
  if (p.lean.bid < 0 && bid >= 3 && rnd() < 0.5) return bid - 1;
  if (p.lean.bid > 0 && bid >= 2 && bid <= 6 && rnd() < 0.3) return bid + 1;
  return bid;
}

/** Nil lean: a persona that dislikes Nil sometimes turns a (non-blind) Nil into a 1 bid. */
export function leanNil(name: string, rnd: () => number): boolean {
  const p = PERSONAS[personaForName(name)];
  return p.lean.nil < 0 && rnd() < -p.lean.nil * 0.5;
}

/** "Clean talk": mask mild cursing (sh*t, a**, d*mn, h*ll). */
export function maskMild(s: string): string {
  return s
    .replace(/\b(shit)/gi, (w) => `${w.slice(0, 2)}*${w.slice(3)}`)
    .replace(/\b(ass)\b/gi, (w) => `${w[0]}**`)
    .replace(/\b(damn)/gi, (w) => `${w[0]}*${w.slice(2)}`)
    .replace(/\b(hell)\b/gi, (w) => `${w[0]}*${w.slice(2)}`);
}

/**
 * A bot seat's play skill for this game: the table setting (Mixed rolls per seat, seeded by the game), then the
 * persona's bias (Hustler never below Pro; Lil Cuz wobbles a level up or down per game). Stable across refresh.
 */
export function botSkillFor(setting: Parameters<typeof seatSkill>[0], gameSeed: string, seat: number, name: string): BotSkill {
  const p = PERSONAS[personaForName(name)];
  let sk = seatSkill(setting, gameSeed, seat, p.skillFloor);
  if (p.skillJitter) {
    let h = 2166136261;
    for (const ch of `${gameSeed}:cuz:${seat}`) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619); }
    const d = ((h >>> 0) % 3) - 1;
    sk = BOT_SKILLS[Math.max(0, Math.min(BOT_SKILLS.length - 1, BOT_SKILLS.indexOf(sk) + d))]!;
  }
  return sk;
}
