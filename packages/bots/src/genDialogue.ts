/**
 * PROTOTYPE (branch proto/nemotron-dialogue — not on master): model-generated
 * table dialogue as a LINE SOURCE for the existing talk engine.
 *
 * The engine (talk.ts) still decides WHO speaks and WHEN — every gate it
 * owns (cooldowns, density, moment-fit, repetition budget) runs exactly as
 * today, and the curated pool line it picked is the fallback. This module
 * only competes for the WORDING of a line the engine already awarded to
 * the prototype persona's seat, for three slow moments:
 *   - 'set'     a side missed its bid (hand end; engine kinds setThem/gotSet)
 *   - 'nilBust' a player failed Nil (hand end; engine kind nilBust)
 *   - 'matchEnd' the match ended (engine kinds win/lose)
 *
 * VOICE FENCE (owner amendment, 2026-11-03): a generated line may be
 * SPOKEN only in the persona's own cast voice through the in-house
 * Chatterbox studio chain (see apps/web/src/genDialogue/speech.ts).
 * Anything else — external/catalog TTS, web speech, a substitute voice —
 * is forbidden; when the studio voice can't speak, the line stays TEXT.
 *
 * FACT DISCIPLINE mirrors the engine's moment-fit law: the payload is an
 * ALLOWLIST of public facts (public bids, public results, scores — never
 * a hand, never the deck), and every generated line is fact-checked
 * against it before it may display (factCheckLine). An unverifiable or
 * false claim kills the line; the curated fallback owns the moment.
 */
import type { GameState } from '@spades/rules';
import { PERSONAS, type PersonaId } from './personas';
import { normPhrase, sideOfSeat, type TalkKind, type TalkTable } from './talk';

/** The only persona in the prototype (see the lane NOTES for the pick evidence). */
export const GEN_PROTO_PERSONA: PersonaId = 'deacon';

export type GenEventKind = 'set' | 'nilBust' | 'matchEnd';
/** engine TalkKinds the prototype may re-word, per event kind */
export const GEN_LINE_KINDS: Record<GenEventKind, TalkKind[]> = {
  set: ['setThem', 'gotSet'],
  nilBust: ['nilBust'],
  matchEnd: ['win', 'lose'],
};

export const GEN_EMOTIONS = ['smug', 'warm', 'stern', 'amused', 'gracious', 'fired-up', 'rueful', 'calm', 'solemn'] as const;
export type GenEmotion = (typeof GEN_EMOTIONS)[number];
/** presentation cues the prototype director actually implements ('lean' = the seated figure's talk lean) */
export const GEN_ANIMATIONS = ['lean'] as const;
export type GenAnimation = (typeof GEN_ANIMATIONS)[number];

export interface GenResponse { line: string; emotion: GenEmotion; animation: GenAnimation | null }

export interface GenPersonaCard {
  persona: PersonaId;
  tag: string;
  style: string[];
  boundaries: string[];
  /** the persona's OWN recorded lines, verbatim — the voice the model must match */
  voiceExamples: string[];
}

/** The Deacon, described from his shipped corpus (personas.ts pools + sprite). */
export const DEACON_CARD: GenPersonaCard = {
  persona: 'deacon',
  tag: 'The Deacon',
  style: [
    'Measured preacher\'s cadence: short sentences, a pause you can hear, then the point.',
    'Scripture and proverb woven into plain speech — a card result becomes a tiny sermon or a blessing.',
    'Warm even when he\'s winning: calls people "baby" and "children", teases like a church mother, never cruel.',
    'Dry and unhurried. He does not shout, rush, or chase slang; the confidence is quiet.',
    'Southern church register without caricature — no forced dialect spelling, no minstrel phrasing.',
  ],
  boundaries: [
    'Never crude or profane; the joke is always the cards, never the faith itself.',
    'Never claim a card, a hand, a score, or a fact that is not in the supplied facts.',
    'One sentence (two at most). No exclamation stacking, no emojis, no hashtags.',
    'Lose with grace, win with a blessing — he has buried better players than you, politely.',
  ],
  voiceExamples: [
    'pride cometh before the set.',
    'you said nothing, baby, and the deck said something.',
    'we will rise again. next hand.',
    'and the church said GG.',
    'the Lord works in mysterious ways. so does that deck.',
    'the Lord giveth, and I taketh that book.',
  ],
};

/**
 * The payload: the ONLY information a dialogue model may see. Built field
 * by field from PUBLIC game facts — bids once bid, the hand record, the
 * scores, the result. It never reads state.hands, state.trick, the deck,
 * or anything a seated player couldn't see on the score pad.
 */
export interface GenPayload {
  v: 1;
  event: { id: string; kind: GenEventKind; lineKind: TalkKind; handNo: number };
  speaker: { persona: PersonaId; name: string; side: number };
  subject: { name: string; side: number; relation: 'self-side' | 'opponents' };
  facts: {
    mode: 'partnership' | 'cutthroat';
    targetScore: number;
    /** public numeric bids made that hand, in seat order where known */
    bids: number[];
    contract?: { bid: number; books: number; made: boolean; side: number };
    nil?: { bidderName: string; blind: boolean; made: boolean; books: number };
    scores: number[];
    handPoints: number[];
    /** per side: tricks taken in the last hand (the "books" a line may cite) */
    handTricks: number[];
    setsThisMatch: number[];
    match?: { speakerSideWon: boolean; finalScores: number[]; endReason: string };
    /** every numeric value copied into the facts above — the fact-checker's allowlist */
    numbers: number[];
  };
  personaCard: GenPersonaCard;
  /** the last few lines actually said at this table (public chat), for callbacks + dedupe */
  recentLines: string[];
}

export interface GenBuildArgs {
  state: GameState;
  table: TalkTable;
  speakerSeat: number;
  kind: GenEventKind;
  lineKind: TalkKind;
  /** the seat the moment is about (the set side's contract seat / the busted Nil seat) */
  subjectSeat?: number;
  subjectSide: number;
  recentLines?: string[];
}

export function buildGenPayload(a: GenBuildArgs): GenPayload {
  const { state, table } = a;
  const speakerSide = sideOfSeat(table, a.speakerSeat);
  const h = state.history[state.history.length - 1];
  const numbers = new Set<number>();
  const num = (n: number | undefined) => { if (typeof n === 'number' && Number.isFinite(n)) { numbers.add(n); numbers.add(Math.abs(n)); } return n; };
  const scores = state.scores.map((s) => num(s)!);
  const handPoints = h ? h.sides.map((s) => num(s.points)!) : [];
  const handTricks = h ? h.sides.map((s) => num(s.tricks)!) : [];
  const bids = h ? h.bids.filter((b): b is number => typeof b === 'number').map((b) => num(b)!) : [];
  const setsThisMatch: number[] = [];
  for (const rec of state.history) for (const s of rec.sides) if (s.contractMade === false) { setsThisMatch[s.side] = (setsThisMatch[s.side] ?? 0) + 1; }
  setsThisMatch.forEach((n) => num(n));
  num(state.rules.targetScore); num(a.state.handNo); num(13);
  const facts: GenPayload['facts'] = {
    mode: table.partnerships ? 'partnership' : 'cutthroat',
    targetScore: state.rules.targetScore,
    bids, scores, handPoints, handTricks, setsThisMatch,
    numbers: [],
  };
  if (a.kind === 'set' && h) {
    const s = h.sides.find((x) => x.side === a.subjectSide);
    if (s && typeof s.contract === 'number') {
      facts.contract = { bid: num(s.contract)!, books: num(s.tricks)!, made: s.contractMade === true, side: s.side };
    }
  }
  if (a.kind === 'nilBust' && h) {
    for (const s of h.sides) for (const n of s.nils) {
      if (!n.made) {
        facts.nil = { bidderName: table.seats[n.seat]?.name ?? 'the nil bidder', blind: h.bids[n.seat] === 'blindNil', made: false, books: num(h.tricksWon[n.seat] ?? 0)! };
      }
    }
  }
  if (a.kind === 'matchEnd' && state.result) {
    facts.match = {
      speakerSideWon: state.result.winners.includes(speakerSide),
      finalScores: state.result.finalScores.map((s) => num(s)!),
      endReason: state.result.endReason,
    };
  }
  facts.numbers = [...numbers];
  return {
    v: 1,
    event: {
      id: `${state.seed}:h${a.state.handNo}:${a.kind}:${a.subjectSide}${a.kind === 'matchEnd' ? ':match' : ''}`,
      kind: a.kind, lineKind: a.lineKind, handNo: a.state.handNo,
    },
    speaker: { persona: GEN_PROTO_PERSONA, name: table.seats[a.speakerSeat]?.name ?? '', side: speakerSide },
    subject: {
      name: a.subjectSeat !== undefined ? (table.seats[a.subjectSeat]?.name ?? '') : (table.teamNames[a.subjectSide] ?? ''),
      side: a.subjectSide,
      relation: a.subjectSide === speakerSide ? 'self-side' : 'opponents',
    },
    facts,
    personaCard: DEACON_CARD,
    recentLines: (a.recentLines ?? []).slice(-4),
  };
}

/* ------------------------- response validation ------------------------- */

export type GenValidation = { ok: true; res: GenResponse } | { ok: false; reason: string };

/** Validate a model's raw output (JSON text) against the structured contract. */
export function validateGenResponse(raw: string): GenValidation {
  let j: unknown;
  try {
    const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    j = JSON.parse(text);
  } catch { return { ok: false, reason: 'unparseable-json' }; }
  if (!j || typeof j !== 'object') return { ok: false, reason: 'not-an-object' };
  const o = j as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  if (keys.join(',') !== 'animation,emotion,line') return { ok: false, reason: `bad-keys:${keys.join(',')}` };
  if (typeof o.line !== 'string') return { ok: false, reason: 'line-not-string' };
  const line = o.line.trim();
  if (line.length < 2 || line.length > 160) return { ok: false, reason: 'line-length' };
  if (/[\r\n]/.test(line)) return { ok: false, reason: 'line-multiline' };
  if (typeof o.emotion !== 'string' || !(GEN_EMOTIONS as readonly string[]).includes(o.emotion)) return { ok: false, reason: 'emotion-not-allowlisted' };
  if (o.animation !== null && (typeof o.animation !== 'string' || !(GEN_ANIMATIONS as readonly string[]).includes(o.animation))) return { ok: false, reason: 'animation-not-allowlisted' };
  return { ok: true, res: { line, emotion: o.emotion as GenEmotion, animation: o.animation as GenAnimation | null } };
}

/* ----------------------------- fact-check ------------------------------ */

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
};
const CARD_WORDS = /\b(ace|aces|king|kings|queen|queens|jack|jacks|joker|jokers|spade|spades|heart|hearts|diamond|diamonds|club|clubs)\b/i;
const HIDDEN_CLAIMS = /\b(your hand|you (was|were) holding|i saw your|your cards|next card|top of the deck|bottom of the deck)\b/i;
const NIL_MADE_CLAIMS = /\b(made (the |your |his |her |my )?nil|nil (worked|held|landed|paid off|succeeded)|stuck the landing|took no books|zero books|no books at all)\b/i;
const CONTRACT_MADE_CLAIMS = /\b(made (your|the|our|their) (bid|contract|number)|hit (your|the) (bid|number|contract)|made your number)\b/i;
const WE_WON = /\b(we won|i won|we beat you|we beat y'all|our win|we took it|we're the winners)\b/i;
const YOU_WON = /\b(you won|y'all won|you beat us|y'all beat us|your win|your victory|you took it)\b/i;
const WE_LOST = /\b(we lost|we lose|we're the losers)\b/i;
const YOU_LOST = /\b(you lost|y'all lost|your loss)\b/i;

export interface FactCheck { ok: boolean; reasons: string[] }

const CLAIM_NOUN = /^(bid|books?|points?|tricks?|bags?)$/;

/**
 * Numbers a line ASSERTS. Digits always assert ("340" is a claim wherever
 * it stands). A number WORD only asserts in a claim context — directly
 * before a claim noun ("six books", "five bid") — so flavour like "one
 * more hand" or "next hand we answer" is not held to the score pad.
 */
function numbersIn(line: string): number[] {
  const lower = line.toLowerCase();
  const out: number[] = [];
  for (const m of lower.matchAll(/\d+/g)) out.push(parseInt(m[0], 10));
  const words = lower.replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean);
  words.forEach((w, i) => {
    const n = NUMBER_WORDS[w];
    if (n !== undefined && i + 1 < words.length && CLAIM_NOUN.test(words[i + 1]!)) out.push(n);
  });
  return out;
}

/**
 * Verify a generated line's CHECKABLE claims against the payload — the
 * engine's moment-fit law applied to generated wording. Numbers must be
 * payload numbers; card mentions are unverifiable at these moments (the
 * payload names no cards) and reject; Nil / contract / winner outcome
 * claims must match the payload's outcomes. Claim-free flavour passes.
 */
export function factCheckLine(line: string, p: GenPayload): FactCheck {
  const reasons: string[] = [];
  const allowed = new Set(p.facts.numbers);
  for (const n of numbersIn(line)) if (!allowed.has(n)) reasons.push(`number-not-in-facts:${n}`);
  // Role checks: a number standing in front of "books" must be a books
  // fact (a side's tricks, the contract's books, the Nil's books) — the
  // bare allowlist would wave "thirteen books" through on the strength of
  // 13 being the hand size. Same for "bid": it must be a bid that was made.
  const booksFacts = new Set<number>([...p.facts.handTricks, ...(p.facts.contract ? [p.facts.contract.books] : []), ...(p.facts.nil ? [p.facts.nil.books] : [])]);
  const bidFacts = new Set<number>([...p.facts.bids, ...(p.facts.contract ? [p.facts.contract.bid] : [])]);
  const words = line.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean);
  words.forEach((w, i) => {
    const next = words[i + 1];
    if (!next) return;
    const n = /^\d+$/.test(w) ? parseInt(w, 10) : NUMBER_WORDS[w];
    if (n === undefined) return;
    if (/^books?$/.test(next) && !booksFacts.has(n)) reasons.push(`books-claim-false:${n}`);
    if (next === 'bid' && !bidFacts.has(n)) reasons.push(`bid-claim-false:${n}`);
  });
  if (CARD_WORDS.test(line)) reasons.push('card-mention-unverifiable');
  if (HIDDEN_CLAIMS.test(line)) reasons.push('hidden-info-claim');
  // Nil outcome claims: a line may only celebrate a made Nil when the
  // payload says one was made. (A bare "should've bid nil" is advice, not
  // an outcome claim, and is not gated.)
  if (NIL_MADE_CLAIMS.test(line) && !(p.facts.nil && p.facts.nil.made)) reasons.push('nil-made-claim-false');
  // Contract outcome claims
  if (p.facts.contract && !p.facts.contract.made) {
    if (CONTRACT_MADE_CLAIMS.test(line)) reasons.push('contract-made-claim-false');
    // the set belongs to the subject: "you got set" is only true speech
    // when the subject is the opposing side (from the speaker's mouth)
    if (p.subject.relation === 'self-side' && /\byou got set\b/i.test(line)) reasons.push('set-claim-wrong-side');
    if (p.subject.relation === 'opponents' && /\bwe got set\b/i.test(line)) reasons.push('set-claim-wrong-side');
  }
  // Match winner claims
  if (p.facts.match) {
    if (p.facts.match.speakerSideWon) {
      if (YOU_WON.test(line) || WE_LOST.test(line)) reasons.push('winner-claim-false');
    } else {
      if (WE_WON.test(line) || YOU_LOST.test(line)) reasons.push('winner-claim-false');
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/* ------------------------------ the prompt ------------------------------ */

/**
 * TUNING PASS (2026-11-03, after the first real-model run): the card's six
 * recorded lines were handed to the model verbatim and it handed them
 * straight back — 10/10 lines were near-copies and none cited a fact. So:
 * (1) the model now sees ONE recorded line per call, rotated by a hash of
 * the event id, framed as a voice sample it must not reuse; (2) a
 * fact-requirement line states the moment's real numbers and requires the
 * reply to work them in. factCheckLine remains the enforcement — this
 * only makes honest compliance the path of least resistance.
 */
export function voiceExampleFor(p: GenPayload): string | null {
  const xs = p.personaCard.voiceExamples;
  if (!xs.length) return null;
  return xs[hashStr(p.event.id) % xs.length]!;
}

/** the numbers this moment turns on, stated plainly, with the requirement to cite them */
export function genFactRequirement(p: GenPayload): string {
  const f = p.facts;
  if (p.event.kind === 'set' && f.contract) {
    const who = p.subject.relation === 'opponents' ? 'The opposing side' : 'Your own side';
    return `Ground the line in the numbers: ${who} bid ${f.contract.bid} and took only ${f.contract.books} books, so the bid was set. Your line MUST name that bid (${f.contract.bid}) and those books (${f.contract.books}) — work both numbers into the sentence itself, as digits or as words.`;
  }
  if (p.event.kind === 'nilBust' && f.nil) {
    return `Ground the line in the numbers: ${f.nil.bidderName} bid nil — nothing at all — and still took ${f.nil.books} books, so the nil failed. Your line MUST name the nil and the ${f.nil.books} books — work the number into the sentence itself, as digits or as words.`;
  }
  if (p.event.kind === 'matchEnd' && f.match) {
    const ours = f.match.finalScores[p.speaker.side] ?? 0;
    const theirs = Math.max(0, ...f.match.finalScores.filter((_, i) => i !== p.speaker.side));
    return `Ground the line in the numbers: the match is over, final score ${ours} to ${theirs}, your side ${f.match.speakerSideWon ? 'won' : 'lost'}. Your line MUST state that final score (${ours} to ${theirs}) — work both numbers into the sentence itself, as digits or as words.`;
  }
  return 'Ground the line in the numbers in the facts — name at least one of them in the sentence itself, as digits or as words.';
}

export function buildGenPrompt(p: GenPayload): { system: string; user: string } {
  const c = p.personaCard;
  const example = voiceExampleFor(p);
  const system = [
    `You are ${c.tag}, a Spades player at a friendly but competitive table. You speak ONLY as this character.`,
    `Style: ${c.style.join(' ')}`,
    `Boundaries: ${c.boundaries.join(' ')}`,
    ...(example ? [`One of your recorded lines, for VOICE ONLY — match its cadence and warmth, but write a brand-new line in your own words; never reuse its words, its phrases, or its sentiment: "${example}"`] : []),
    genFactRequirement(p),
    'React to the moment described in the JSON facts. Use ONLY those facts — never invent cards, scores, bids, books, or events.',
    'Reply with a single JSON object, no other text: {"line": string, "emotion": one of ' + GEN_EMOTIONS.join('|') + ', "animation": "lean" or null}.',
    'The line is one sentence (two at most), under 160 characters, no emojis.',
  ].join('\n');
  const user = JSON.stringify({
    event: p.event, speaker: p.speaker, subject: p.subject, facts: p.facts,
    recentLines: p.recentLines,
  });
  return { system, user };
}

/* --------------------------- mock model -------------------------------- */
/* Deterministic, fact-derived lines in the persona's register — the full
 * pipeline (seam, fact-check, fallbacks, dedupe) is provable with NO
 * endpoint. Templates interpolate payload facts only, so mock lines pass
 * the fact-check by construction (the tests keep that honest). */

function hashStr(s: string): number {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const MOCK_BANKS: Record<string, { lines: string[]; emotion: GenEmotion }[]> = {
  'set:opponents': [
    { emotion: 'smug', lines: [
      'y\'all promised {bid} and gathered {books}. pride cometh before the set.',
      '{bid} was the promise, {books} was the offering. the math preached itself.',
      'the book said reach for {bid}; the books said {books}. sit with that a minute.',
      'a {bid} bid with {books} books — that\'s not bad luck, baby, that\'s a testimony.',
    ] },
  ],
  'set:self-side': [
    { emotion: 'rueful', lines: [
      'we promised {bid} and brought {books}. a test of faith — noted, and we rise.',
      '{booksLabel} on a {bid} promise. the sermon writes itself; next hand we answer.',
      'set at {bid} with {books} to show for it. humbling — and temporary.',
    ] },
  ],
  'nilBust:opponents': [
    { emotion: 'amused', lines: [
      'you bid nothing, and the deck answered with {nilBooks}. silence was never the plan, baby.',
      'a nil with {nilBooksLabel} on it — the deck has a sense of humor, {nilName}.',
      'nothing was the bid, {nilBooks} was the result. there\'s a sermon in that.',
    ] },
  ],
  'nilBust:self-side': [
    { emotion: 'warm', lines: [
      '{nilName} flew on faith and caught {nilBooks}. we cover our own — next hand.',
      'the nil broke at {nilBooksLabel}. no blame at this table; we carry each other.',
    ] },
  ],
  'matchEnd:won': [
    { emotion: 'gracious', lines: [
      'final word: {ours} to {theirs}. and the church said GG.',
      'it is finished — {ours} to {theirs}, and every book accounted for.',
      '{ours} to {theirs}. bless this table; y\'all made us earn every point.',
    ] },
  ],
  'matchEnd:lost': [
    { emotion: 'gracious', lines: [
      '{theirs} to {ours}. the Lord works in mysterious ways; so does that deck.',
      'we fell {ours} to {theirs}. the battle\'s yours — revival is already scheduled.',
      '{theirs} to {ours} at the final bell. go in peace; we\'ll be back with a word.',
    ] },
  ],
};

const CLAIM_FREE: GenResponse = { line: 'the hand is written. the next one is unwritten — and I intend to preach over it.', emotion: 'calm', animation: null };

export function mockGenerate(p: GenPayload): GenResponse {
  // missing the facts a bank interpolates → a claim-free line, never a broken template
  if (p.event.kind === 'set' && !p.facts.contract) return CLAIM_FREE;
  if (p.event.kind === 'nilBust' && !p.facts.nil) return CLAIM_FREE;
  if (p.event.kind === 'matchEnd' && !p.facts.match) return CLAIM_FREE;
  const key = p.event.kind === 'matchEnd'
    ? `matchEnd:${p.facts.match?.speakerSideWon ? 'won' : 'lost'}`
    : `${p.event.kind}:${p.subject.relation}`;
  const bank = MOCK_BANKS[key]?.[0] ?? MOCK_BANKS['set:opponents']![0]!;
  const ours = p.facts.scores[p.speaker.side] ?? 0;
  const bestOf = (xs: number[]) => (xs.length ? Math.max(...xs) : 0);
  const theirs = bestOf(p.facts.scores.filter((_, i) => i !== p.speaker.side));
  const fill = (tpl: string) => tpl
    .replace(/\{bid\}/g, String(p.facts.contract?.bid ?? ''))
    .replace(/\{booksLabel\}/g, `${p.facts.contract?.books ?? 0} book${p.facts.contract?.books === 1 ? '' : 's'}`)
    .replace(/\{books\}/g, String(p.facts.contract?.books ?? ''))
    .replace(/\{nilBooksLabel\}/g, `${p.facts.nil?.books ?? 0} book${p.facts.nil?.books === 1 ? '' : 's'}`)
    .replace(/\{nilBooks\}/g, String(p.facts.nil?.books ?? ''))
    .replace(/\{nilName\}/g, p.facts.nil?.bidderName ?? p.subject.name)
    .replace(/\{ours\}/g, String(p.facts.match ? (p.facts.match.finalScores[p.speaker.side] ?? ours) : ours))
    .replace(/\{theirs\}/g, String(p.facts.match ? bestOf(p.facts.match.finalScores.filter((_, i) => i !== p.speaker.side)) : theirs));
  const ix = hashStr(`${p.event.id}:${p.speaker.name}`) % bank.lines.length;
  const line = fill(bank.lines[ix]!);
  return { line: PERSONAS[GEN_PROTO_PERSONA].caps ? line.toUpperCase() : line, emotion: bank.emotion, animation: null };
}

/** would this generated line repeat something the table just heard? (the engine's phrase discipline, applied to generated wording) */
export function genRepeatsRecent(line: string, recent: string[]): boolean {
  const n = normPhrase(line);
  return recent.some((r) => normPhrase(r) === n);
}
