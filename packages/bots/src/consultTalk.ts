/**
 * Pre-bid partner consultation (CONSULT_SPEC.md): before bidding, the human's
 * bot partner says how many books they think they have — out loud, in their
 * own recorded voice where a take exists, never robotically identical.
 *
 * DATA HONESTY is the whole design: the spoken claim, the bid coach's
 * "thinks N", and the partner's placed bid are all views of ONE number —
 * `partnerBidIntent()` on the partner's own view, with its default seeded
 * rng (the same stream the bot's real bid is drawn from). This module never
 * invents a number: it decomposes that claim C onto the Sure/Possible grid
 * (§3.1/§3.2) purely to choose HOW the number is said.
 *
 * HARD RULE (§7): no line here states or implies what cards anyone holds —
 * no ranks, no suits, no card names, no distribution talk, never the word
 * "trump". Speech carries the count, the possibles, the confidence, and the
 * score context only. The forbidden-pattern linter in
 * packages/bots/test/consult-linter.test.ts enforces it over every line,
 * fully instantiated.
 *
 * Clip keys (the consultation bake, fb581d61): grid takes key as
 * `${raw}#${S}.${P}` with S bucketed 0–5 then "6+", settle takes as
 * `${raw}#T${bucket}` with T bucketed 3–12 then "13+", number-free lines
 * key by their raw text. A lookup that misses renders TEXT ONLY under the
 * standing fence rules — never a substitute voice.
 */
import type { PlayerView } from '@spades/rules';
import { analyzeHand, partnerBidIntent, skillOf, wantsBlindNil, type BotLevel } from './bidding';
import type { PersonaId } from './personas';

/* ------------------------------------------------------------------ */
/* Banks (verbatim from CONSULT_SPEC §9, as recorded in the bake)      */
/* ------------------------------------------------------------------ */

export interface GridTemplate {
  raw: string;
  /** possible-renderings by P bucket: [P0, P1, P2] — index 0 is always '' */
  p: readonly [string, string, string];
}
const grid = (raw: string, p1: string, p2: string): GridTemplate => ({ raw, p: ['', p1, p2] });

/** COMMON estimate grid (§9.2) — every non-silent persona sprite. */
export const CONSULT_GRID_COMMON: readonly GridTemplate[] = [
  grid('I got {S}{P}.', ' and a possible', ' and a couple of maybes'),
  grid('Put me down for {S}{P}.', ' and a possible', ', maybe a couple more'),
];

/** The Silent Assassin's bare-number grid (§8.4): the count IS the sentence. */
export const CONSULT_GRID_SILENT: readonly GridTemplate[] = [
  grid('{S}{P}.', ', and one', ', and a couple'),
];

/** Dee's grid (§9.1) — her cast sprite (lilcuz-f); P-renderings are hers. */
export const CONSULT_GRID_DEE: readonly GridTemplate[] = [
  grid('I got {S}{P}.', ' and a possible', ", and a couple of 'em could go either way"),
  grid('Count me for {S}{P}.', ' and maybe one', ', maybe more knocking around'),
  grid("I'm good for {S}{P}.", ', plus a possible', ' and some maybes'),
];

/**
 * Dee's hedged grid line (§9.1/§4): fires when her read wobbled (novice /
 * regular stops). Written in the spec's bank; the bake did not record it,
 * so it renders text-only until a future bake — fence-consistent.
 */
export const DEE_HEDGED: GridTemplate = grid('I *think* I got {S}{P}. Don\'t hold me to it.', ' and a possible', ", and a couple of 'em could go either way");

/**
 * Persona-own estimate lines (§9.2): two per persona, recorded ONLY at
 * cells (S=3, P=0) and (S=3, P=1) — the bake's reading of the §8.4 budget
 * (4 clips per sprite). The picker therefore admits them only at those
 * cells, where a take exists; at every other cell the COMMON grid carries
 * the voice. P2 renderings below are display/linter completeness only.
 */
export const CONSULT_OWN: Partial<Record<PersonaId, readonly GridTemplate[]>> = {
  professor: [grid('By my count: {S}{P}.', ' and a possible', ' and a couple of maybes'), grid('The arithmetic says {S}{P}. I trust the arithmetic.', ' and a possible', ' and a couple of maybes')],
  mama: [grid("Mama's good for {S}{P}.", ' and a possible', ' and a couple of maybes'), grid('Baby, I got {S}{P}. Now what YOU got?', ' and a possible', ' and a couple of maybes')],
  hype: [grid('I GOT {S}{P}! COUNT IT!', ' and a possible', ' and a couple of maybes'), grid("MY NUMBER? {S}{P}! LET'S GO!", ' and a possible', ' and a couple of maybes')],
  petty: [grid('I got {S}{P}. Write it down, since folks forget.', ' and a possible', ' and a couple of maybes'), grid('{S}{P}. And I said it first.', ' and a possible', ' and a couple of maybes')],
  og: [grid('{S}{P}. That\'s my count. It don\'t change.', ' and a possible', ' and a couple of maybes'), grid('I got {S}{P}. Like always.', ' and a possible', ' and a couple of maybes')],
  hustler: [grid("My count's my count: {S}{P}.", ' and a possible', ' and a couple of maybes'), grid('I can do {S}{P}. Trust the process.', ' and a possible', ' and a couple of maybes')],
  deacon: [grid('The count is {S}{P}. We proceed.', ' and a possible', ' and a couple of maybes'), grid('I stand on {S}{P}.', ' and a possible', ' and a couple of maybes')],
  conspiracy: [grid("They don't want you to know I got {S}{P}. But I got {S}{P}.", ' and a possible', ' and a couple of maybes'), grid('My count? {S}{P}. Look it up.', ' and a possible', ' and a couple of maybes')],
  barber: [grid('Fresh count: {S}{P}. Clean.', ' and a possible', ' and a couple of maybes'), grid('Off the top: {S}{P}.', ' and a possible', ' and a couple of maybes')],
  gambler: [grid("I'd bet on {S}{P}. And I bet on everything.", ' and a possible', ' and a couple of maybes'), grid("My number's {S}{P}. Feels lucky.", ' and a possible', ' and a couple of maybes')],
  hothead: [grid('I got {S}{P}! What?!', ' and a possible', ' and a couple of maybes'), grid("{S}{P}! That's what I SAID!", ' and a possible', ' and a couple of maybes')],
  comedian: [grid("I got {S}{P} and a joke — but the joke's a possible too.", ' and a possible', ' and a couple of maybes'), grid("{S}{P}. The count's free, the show costs extra.", ' and a possible', ' and a couple of maybes')],
  lilcuz: [grid('Cuz, I got {S}{P}.', ' and a possible', ' and a couple of maybes'), grid('Put me down for {S}{P}, family.', ' and a possible', ' and a couple of maybes')],
  coach: [grid('The count: {S}{P}. Run the play.', ' and a possible', ' and a couple of maybes'), grid('Film says {S}{P}. Execute.', ' and a possible', ' and a couple of maybes')],
  smooth: [grid('I got {S}{P}. Smooth as it sounds.', ' and a possible', ' and a couple of maybes'), grid('{S}{P}, easy. Next question.', ' and a possible', ' and a couple of maybes')],
  storyteller: [grid('Story starts at {S}{P}…', ' and a possible', ' and a couple of maybes'), grid('Chapter one: I got {S}{P}.', ' and a possible', ' and a couple of maybes')],
  influencer: [grid('Chat, I got {S}{P}. Clip it.', ' and a possible', ' and a couple of maybes'), grid('My count is {S}{P}. Going in the recap.', ' and a possible', ' and a couple of maybes')],
  sorelose: [grid('I got {S}{P}. And no, I\'m not happy about it.', ' and a possible', ' and a couple of maybes'), grid("{S}{P}. Lose with this and I'm blaming the count.", ' and a possible', ' and a couple of maybes')],
};

/** COMMON settle grid (§9.2). Band variants are text-only at regular tables
 * (the bake recorded the plain grid only) — see buildSettle. */
export const CONSULT_SETTLE_COMMON: readonly string[] = ["That's {T} between us.", 'Count it: {T} total.'];
export const CONSULT_SETTLE_LOW = 'Thin. Careful now.';
export const CONSULT_SETTLE_HIGH = 'Big number. Back it up.';
export const CONSULT_SETTLE_TRIM = 'Crowded table — I came down. We at {T}.';
/** Silent settle: the bare total. Recorded T3–T12; 13+ is text-only. */
export const CONSULT_SETTLE_SILENT = '{T}.';

/** Dee's settle grid (§9.1) — plain ×3, plus her recorded band variants. */
export const DEE_SETTLE: readonly string[] = ["That's {T} between us. Lock it in.", '{T} total. We good.', "Count it: {T}. Now let's go get it."];
export const DEE_SETTLE_LOW = '{T} between us… thin. Play it careful, cuz.';
export const DEE_SETTLE_HIGH = '{T}! Big number. Back it up.';
/** Recorded only at T ∈ {5, 7, 9} in the bake; other totals render text-only. */
export const DEE_SETTLE_TRIM = 'Table got crowded — I had to come down some. We at {T}.';

/** COMMON number-free estimate/confidence (§9.3/§9.4), region-gated. */
export const CONSULT_FREE = {
  strong: ["I'm heavy over here. Real heavy.", "Oh, I'm working this hand."],
  solid: ["I'm solid. Nothing fancy, just solid."],
  light: ["I'm real light — lean on yours.", 'Crumbs over here. Yours matters more.'],
  possibleHeavy: ["Mine's got maybes in it. Don't marry the number."],
  ask: ['What you working with? Give me a count.'],
  nil: ["I'm looking at a nil over here."],
  cover: ['You go dark. I got the rest of us.'],
  blind: ["Score says gamble. I'm going blind — cover me."],
} as const;

/** Dee's number-free set (§9.1) — includes the board families personas lack. */
export const DEE_FREE = {
  strong: ['Oh, we eating this hand.', 'I came to work today, cuz.'],
  solid: ["I'm solid over here. Nothing fancy, just solid."],
  light: ["I'm real light, cuz. Lean on yours.", "Don't look at me this hand — I got crumbs."],
  possibleHeavy: ["Mine's got some maybes in it. Don't marry my number."],
  shaky: ['I got a little something. A *little* something.'],
  ask: ["Count with me — what's yours look like?", 'You first. What you working with, a number.'],
  nil: ["I'm looking at a nil over here. For real.", "Don't feed me nothing — I'm tryna take zero this hand."],
  cover: ['You go dark, I got the rest of us.'],
  blind: ['We down bad… I might have to go blind and pray. Cover me.'],
  boardProtect: ["We up — I'm not reaching. Mine's honest."],
  boardChase: ["We need theirs broke. I'll stretch mine if you stretch yours."],
  bagPressure: ["Watch the bags, cuz. Mine's coming in low on purpose."],
  kingLeg2: ['One more after this. Same count, same us.'],
} as const;

/** Dee's post-hand acknowledgments (§4) — ≤ 1 per match, never at shark. */
export const DEE_ACK_MISCOUNT: readonly string[] = ["I counted that hand wrong. That's on me, cuz.", "My read was off. Won't happen twice."];
export const DEE_ACK_UNDERREAD: readonly string[] = ['I shorted us. I had more than I said — my bad.'];

/** Introductions (§9.5) — once per partner identity, ever; never Dee. */
export const INTRO_COMMON: readonly string[] = [
  "Pleasure. Count fair with me and we'll get along fine.",
  "New partner, same rules: you tell me your count, I'll tell you mine.",
  "I play honest and I count honest. You'll see.",
  "That's the whole introduction. Now count 'em.",
];
export const INTRO_OWN: Partial<Record<PersonaId, readonly string[]>> = {
  professor: ['Credentials on request. The count is the credential.', 'Attendance taken. Now we count.'],
  mama: ["I'm everybody's mama at this table. Count fair, baby.", 'Sit down, baby. Mama counts first, then we eat.'],
  hype: ["I'M THE ENERGY. YOU'RE THE BRAINS. NOW COUNT!", 'NEW HAND ENERGY! COUNT WITH ME!'],
  petty: ['Names later. Numbers first.', "I'm keeping score of the scorekeeping. Count."],
  og: ['Been at this table longer than the table. Count with me.', "You count yours. I'll count mine. They'll match."],
  hustler: ['First we count. Then we eat. Count.', "I don't shake twice. Count once, count right."],
  deacon: ["Grace and fair dealing. That's the whole introduction.", 'We count together, we stand together.'],
  conspiracy: ["My count's mine till I say it. Then it's ours.", "They're listening, so count quiet. But count."],
  barber: ['Shop rules: fair count, fair game.', "Take a seat. The count's the first cut."],
  gambler: ['I shake hands once. Then I count.', 'No bet till I hear both counts. Talk.'],
  hothead: ['Count! Out loud! So nobody cheats!', "I'm calm! This is my calm voice! Count!"],
  comedian: ["I'm the entertainment. The counting's just a bonus.", "The count's the warm-up act. I'm the show."],
  lilcuz: ['Cuz to cuz: we tell each other the truth here.', "Family counts together. That's the rule."],
  coach: ['Huddle up. Counts on three.', "I'm the whistle and the playbook. Count with me."],
  smooth: ['Easy introductions. Easier counting.', "You'll like how I count. Everybody does."],
  storyteller: ['Chapter one starts with your count. Go.', 'Every story starts with a count. Ours too.'],
  influencer: ['Chat, new partner era starts now. We count first.', 'First collab rule: we always tell the chat the count.'],
  sorelose: ["If the count's bad, don't look at me. Count anyway.", "New partner. Great. Let's count and get it over with."],
};
/** The Silent Assassin's whole introduction: chat carries the name, the take is "…Hey." */
export const INTRO_SILENT = "…Name's {name}. I talk in counts.";

/** Confer (§9.6): the bidder's asks + responses. Claims reuse the grid. */
export const CONFER_ASK: readonly string[] = ['Talk to me.', 'Give me a number.', 'What you got for me?'];
export const CONFER_RESP: readonly string[] = ['Heard.', 'Say less.', 'Copy.'];

/** Every raw bank string (templates unfilled) — the linter's enumeration base. */
export function allConsultBankStrings(): string[] {
  const out = new Set<string>();
  const addT = (t: GridTemplate) => out.add(t.raw);
  CONSULT_GRID_COMMON.forEach(addT);
  CONSULT_GRID_SILENT.forEach(addT);
  CONSULT_GRID_DEE.forEach(addT);
  addT(DEE_HEDGED);
  Object.values(CONSULT_OWN).forEach((ts) => ts?.forEach(addT));
  [...CONSULT_SETTLE_COMMON, CONSULT_SETTLE_LOW, CONSULT_SETTLE_HIGH, CONSULT_SETTLE_TRIM, CONSULT_SETTLE_SILENT,
    ...DEE_SETTLE, DEE_SETTLE_LOW, DEE_SETTLE_HIGH, DEE_SETTLE_TRIM].forEach((s) => out.add(s));
  Object.values(CONSULT_FREE).forEach((ls) => ls.forEach((s) => out.add(s)));
  Object.values(DEE_FREE).forEach((ls) => ls.forEach((s) => out.add(s)));
  [...DEE_ACK_MISCOUNT, ...DEE_ACK_UNDERREAD, ...INTRO_COMMON, ...CONFER_ASK, ...CONFER_RESP].forEach((s) => out.add(s));
  Object.values(INTRO_OWN).forEach((ls) => ls?.forEach((s) => out.add(s)));
  out.add(INTRO_SILENT);
  return [...out];
}

/* ------------------------------------------------------------------ */
/* Rendering + clip keys                                               */
/* ------------------------------------------------------------------ */

/** The recorded S bucket for a sure count: 0–5 literal, 6 and up share "6+". */
export const sBucket = (s: number): string => (s >= 6 ? '6+' : String(Math.max(0, s)));
/** The recorded T bucket for a team total: 3–12 literal, 13 and up share "13+". */
export const tBucket = (t: number): string => (t >= 13 ? '13+' : String(t));

/** Fill a grid template for display: {S} shows the bucket, {P} the bucket's rendering. */
export function renderGrid(t: GridTemplate, s: number, p: 0 | 1 | 2): string {
  return t.raw.replace(/\{S\}/g, sBucket(s)).replace(/\{P\}/g, t.p[p]);
}
/** The sprite clip key for a grid line (`${raw}#${S}.${P}`). */
export const gridClipKey = (t: GridTemplate, s: number, p: 0 | 1 | 2): string => `${t.raw}#${sBucket(s)}.${p}`;
/** Fill a settle template for display. */
export function renderSettle(raw: string, total: number): string {
  return raw.replace(/\{T\}/g, tBucket(total));
}
export const settleClipKey = (raw: string, total: number): string => `${raw}#T${tBucket(total)}`;

/* ------------------------------------------------------------------ */
/* The Sure / Possible decomposition (§3.1)                            */
/* ------------------------------------------------------------------ */

export interface Decomposition { sure: number; possible: number; read: number }

/**
 * §3.1 from analyzeHand's own items: Sure = full-value trumps + aces and
 * backed kings (1.0 / 0.85) + full length books; Possible = maybe trumps
 * (0.4), unbacked kings (0.55), protected queens (0.35 / 0.2), fractional
 * length ≥ 0.6, and cutting (one possible at ≥ 0.5; two at ≥ 1.4 — where
 * cutting.value ≥ 1.4 the §3.1 side conditions, two distinct short suits
 * and ≥ 2 spare trumps, already hold by construction of the value).
 * Possible is capped at 3 for speech.
 */
export function decomposeClaim(hand: Parameters<typeof analyzeHand>[0], v: Pick<PlayerView, 'rules'>): Decomposition {
  const a = analyzeHand(hand, v);
  const lenFull = Math.floor(a.length?.value ?? 0);
  const sure = a.sureTrumps.filter((i) => i.value === 1).length
    + a.sideWinners.filter((i) => i.value === 1 || i.value === 0.85).length
    + lenFull;
  let possible = a.sureTrumps.filter((i) => i.value === 0.4).length
    + a.sideWinners.filter((i) => i.value === 0.55).length
    + a.sideWinners.filter((i) => i.value === 0.35 || i.value === 0.2).length;
  if ((a.length?.value ?? 0) - lenFull >= 0.6) possible += 1;
  const cut = a.cutting?.value ?? 0;
  possible += cut >= 1.4 ? 2 : cut >= 0.5 ? 1 : 0;
  return { sure, possible: Math.min(3, possible), read: a.total };
}

/* ------------------------------------------------------------------ */
/* Line picking (shuffle-bag, talk.ts conventions)                     */
/* ------------------------------------------------------------------ */

export interface ConsultTalkState {
  /** shuffle-bag memory: pool key → raw templates already said this match */
  used: Record<string, string[]>;
  /** the last raw line said (never back-to-back) */
  last?: string;
}
export const newConsultTalkState = (): ConsultTalkState => ({ used: {} });

/**
 * Shuffle-bag pick over raw lines: own-pool weighting is the caller's (it
 * passes weighted entries). Consultation bags do NOT reset inside a match —
 * when one runs dry the pick returns null and the caller falls back, which
 * is what keeps a 12-hand match free of repeated consultation phrasing.
 * Small all-match pools (settle templates, confer one-liners) pass
 * `recycle`: when their bag runs dry it refills (last line still excluded),
 * because "That's 7 between us." at a new total is a new line, and a
 * one-word "Heard." is table talk, not a set piece.
 */
export function pickConsult(st: ConsultTalkState, key: string, pool: readonly string[], rnd: () => number, weights?: readonly number[], recycle = false): string | null {
  if (!pool.length) return null;
  const used = (st.used[key] ??= []);
  let fresh = pool.filter((l) => !used.includes(l) && l !== st.last);
  if (!fresh.length && recycle) {
    st.used[key] = [];
    fresh = pool.filter((l) => l !== st.last);
    if (!fresh.length) fresh = [...pool]; // a one-line pool (the silent settle) just speaks again
  }
  if (!fresh.length) return null;
  let pick = fresh[0]!;
  if (fresh.length > 1) {
    const w = fresh.map((l) => weights?.[pool.indexOf(l)] ?? 1);
    let x = rnd() * w.reduce((a, b) => a + b, 0);
    pick = fresh[fresh.length - 1]!;
    for (let i = 0; i < fresh.length; i++) { x -= w[i]!; if (x < 0) { pick = fresh[i]!; break; } }
  }
  st.used[key] = [...(st.used[key] ?? []), pick];
  st.last = pick;
  return pick;
}

/* ------------------------------------------------------------------ */
/* The consultation builder (§3 / §5.2)                                */
/* ------------------------------------------------------------------ */

export interface ConsultBoard {
  /** both sides' scores at deal time (index = side) */
  scores: readonly number[];
  /** both sides' bag counts */
  bags: readonly number[];
  /** the speaking partner's side */
  mySide: number;
  /** story: the King leg-2 window (Dee-only board variant) */
  kingLeg2?: boolean;
}

export interface ConsultLine {
  kind: 'grid' | 'numberFree' | 'nil' | 'cover' | 'blind' | 'ask' | 'board' | 'settle';
  /** display text (what the chat shows; spoken text == displayed text) */
  text: string;
  /** raw template the clip is keyed by (== text for number-free lines) */
  raw: string;
  /** clip key suffix after '#', e.g. '3.1' — undefined when the raw itself is the key */
  clipSuffix?: string;
  /** the anchored claim: C from partnerBidIntent */
  claim: number | 'nil';
  /** bucketed Sure/Possible the line speaks from */
  sure: number;
  possible: number;
  /** the read wobbled (§4): hedged register was selected */
  hedged: boolean;
  /** number-free line: the renderer appends the "· thinks N" rider (§3.3) */
  rider: boolean;
}

export interface ConsultOptions {
  /** the partner's own view of their own hand (revealed) */
  view: PlayerView;
  /** the partner's skill level for this seat */
  level: BotLevel;
  persona: PersonaId;
  /** story mode: the speaker is Dee (her bank, her cast sprite) */
  dee?: boolean;
  state: ConsultTalkState;
  rnd: () => number;
  board: ConsultBoard;
  /** the human's already-placed bid, when they bid before the beat fired */
  humanBid?: number | 'nil' | 'blindNil' | null;
  /** the human announced Nil via a partner-talk preset (§3.2.4 cover) */
  humanNilAnnounced?: boolean;
  /** confer claims (§5.4): grid family only — a short, plain claim */
  gridOnly?: boolean;
}

/**
 * Build the partner's consultation line for this hand, or null when no
 * honest line exists (partner hasn't looked at their cards and isn't
 * going blind — the coach stays silent then too, so nothing diverges).
 */
export function buildConsultation(o: ConsultOptions): ConsultLine | null {
  const { view: v, persona, state: st, rnd } = o;
  const skill = skillOf(o.level);
  const dee = !!o.dee;
  const free = dee ? DEE_FREE : CONSULT_FREE;
  // The Silent Assassin speaks ONLY the bare takes the bake recorded for
  // the persona (§8.4): the count grid, "Nil.", the bare settle — never a
  // sentence. Every sentence family below is skipped for them.
  const silent = persona === 'silent' && !dee;

  // Blind-nil lean (§3.2.5): the partner hasn't seen the hand, and the
  // board says gamble. The claim is explicitly a gamble — no fake count,
  // no rider; partnerBidIntent is never consulted for a number here.
  if (!v.hand) {
    if (wantsBlindNil(v, o.level)) {
      const raw = pickConsult(st, `${persona}:blind`, free.blind, rnd);
      if (raw) return { kind: 'blind', text: raw, raw, claim: 'nil', sure: 0, possible: 0, hedged: false, rider: false };
    }
    return null;
  }

  // THE number (§3.2): one call, the default seeded rng — identical to the
  // bid coach's "thinks N" and to the stream the placed bid is drawn from.
  const C = partnerBidIntent(v, o.level);
  if (C === null) return null;

  const dec = decomposeClaim(v.hand, v);
  let { sure: S, possible: P } = dec;

  // Cover framing (§3.2.4): the player is going dark; the partner's whole
  // consultation is the cover promise — count-free, confidence only.
  // (A silent partner has no cover sentence recorded; they fall through
  // to the bare count, which is the same information in character.)
  if (!silent && C !== 'nil' && (o.humanBid === 'nil' || o.humanNilAnnounced)) {
    const raw = pickConsult(st, `${persona}:cover`, free.cover, rnd);
    if (raw) return { kind: 'cover', text: raw, raw, claim: C, sure: S, possible: P, hedged: false, rider: false };
  }

  // Nil lean (§3.2.4): the claim IS nil — the nil family, no grid.
  if (C === 'nil') {
    if (persona === 'silent' && !dee) return { kind: 'nil', text: 'Nil.', raw: 'Nil.', claim: 'nil', sure: 0, possible: 0, hedged: false, rider: false };
    const raw = pickConsult(st, `${persona}:nil`, free.nil, rnd);
    if (raw) return { kind: 'nil', text: raw, raw, claim: 'nil', sure: 0, possible: 0, hedged: false, rider: false };
    return null;
  }

  // Reconcile the decomposition onto the claim (§3.2.2): the line may
  // never promise more or less than the bid that will actually land.
  let hedged = false;
  if (C < S) { S = C; P = 0; hedged = skill === 'novice' || skill === 'regular'; }
  else if (C > S + P) {
    const diff = C - (S + P);
    P = Math.min(3, P + diff);
    if (C > S + P) S += C - (S + P);
  }
  // §4's register rule: a read that wobbled by a full book hedges the
  // phrasing at the learning bands (pro/shark noise is 0 — cannot occur).
  if ((skill === 'novice' || skill === 'regular') && Math.abs(C - dec.read) >= 1) hedged = true;

  const pBucket = (Math.min(2, P) as 0 | 1 | 2);
  const finish = (kind: ConsultLine['kind'], raw: string, text: string, clipSuffix: string | undefined, rider: boolean): ConsultLine =>
    ({ kind, text, raw, ...(clipSuffix !== undefined ? { clipSuffix } : {}), claim: C, sure: S, possible: P, hedged, rider });

  if (!o.gridOnly && !silent) {
    // Hedged Dee speaks her hedged grid line (§9.1) — recorded nowhere, so
    // text-only by design until a future bake.
    if (hedged && dee) {
      // No take exists for this line: no clip key, so the driver renders
      // text only instead of playing the grid take under different words.
      return finish('grid', DEE_HEDGED.raw, renderGrid(DEE_HEDGED, S, pBucket), undefined, false);
    }
    // Ask variant (~12%, §5.2): the partner asks for the player's count —
    // their own number still reaches the player via the rider (§3.3).
    if (rnd() < 0.12) {
      const raw = pickConsult(st, `${persona}:ask`, free.ask, rnd);
      if (raw) return finish('ask', raw, raw, undefined, true);
    }
    // Board-framed families (§3.4, Dee's bank only): framing changes how
    // the number is said, never the number. Number-free → rider carries C.
    if (dee) {
      const mine = o.board.scores[o.board.mySide] ?? 0;
      const theirs = o.board.scores[1 - o.board.mySide] ?? 0;
      const family = o.board.kingLeg2 ? DEE_FREE.kingLeg2
        : (o.board.bags[o.board.mySide] ?? 0) >= 7 ? DEE_FREE.bagPressure
        : mine - theirs >= 100 ? DEE_FREE.boardProtect
        : theirs - mine >= 100 ? DEE_FREE.boardChase
        : null;
      if (family && rnd() < 0.5) {
        const raw = pickConsult(st, 'dee:board', family, rnd);
        if (raw) return finish('board', raw, raw, undefined, true);
      }
    }
    // Number-free confidence (~20%, §5.2), region-gated by S/P.
    if (rnd() < 0.2) {
      const region = S >= 4 ? free.strong
        : S === 3 ? free.solid
        : S <= 1 && P <= 1 ? free.light
        : P >= 2 ? free.possibleHeavy
        : dee && S === 2 && P >= 1 ? DEE_FREE.shaky
        : P >= 1 ? free.possibleHeavy
        : free.solid;
      const raw = pickConsult(st, `${persona}:free`, region, rnd);
      if (raw) return finish('numberFree', raw, raw, undefined, true);
    }
  }

  // The grid itself. Silent partners speak the bare count; Dee speaks her
  // templates; personas speak COMMON + (at the recorded cells) their own.
  const templates: GridTemplate[] = persona === 'silent' && !dee ? [...CONSULT_GRID_SILENT]
    : dee ? [...CONSULT_GRID_DEE]
    : [...CONSULT_GRID_COMMON];
  const weights: number[] = templates.map(() => 1);
  if (!dee && persona !== 'silent' && S === 3 && (pBucket === 0 || pBucket === 1)) {
    for (const t of CONSULT_OWN[persona] ?? []) { templates.push(t); weights.push(2); }
  }
  const key = `${persona}:consult:${sBucket(S)}.${pBucket}`;
  const raw = pickConsult(st, key, templates.map((t) => t.raw), rnd, weights);
  if (!raw) {
    // The cell's bag is spent for this match: fall back to a number-free
    // line rather than repeating phrasing (the rider keeps it honest).
    // A silent partner has no fallback sentence — they simply say less.
    if (silent) return null;
    const rawFree = pickConsult(st, `${persona}:free`, S >= 3 ? free.solid : free.light, rnd);
    return rawFree ? finish('numberFree', rawFree, rawFree, undefined, true) : null;
  }
  const tmpl = templates.find((t) => t.raw === raw)!;
  return finish('grid', raw, renderGrid(tmpl, S, pBucket), `${sBucket(S)}.${pBucket}`, false);
}

/* ------------------------------------------------------------------ */
/* Settle (§5.3)                                                       */
/* ------------------------------------------------------------------ */

export interface SettleOptions {
  persona: PersonaId;
  dee?: boolean;
  state: ConsultTalkState;
  rnd: () => number;
  /** T: the sum of the two PLACED numeric bids — always the placed bids */
  total: number;
  /** the partner's placed bid came in under their spoken claim (§3.2.3) */
  trimmed?: boolean;
}

/** Build the settle line for a placed team total. Null when the pool for
 * the variant is spent (the bag does not reset inside a match). */
export function buildSettle(o: SettleOptions): ConsultLine | null {
  const { persona, state: st, rnd, total: T } = o;
  const variant = o.trimmed ? 'trim' : T <= 5 ? 'low' : T >= 10 ? 'high' : 'plain';
  const mk = (raw: string, gridded: boolean): ConsultLine => ({
    kind: 'settle', text: gridded ? renderSettle(raw, T) : raw, raw,
    ...(gridded ? { clipSuffix: `T${tBucket(T)}` } : {}),
    claim: T, sure: 0, possible: 0, hedged: false, rider: false,
  });
  if (persona === 'silent' && !o.dee) {
    const raw = pickConsult(st, 'silent:settle', [CONSULT_SETTLE_SILENT], rnd, undefined, true);
    return raw ? mk(raw, true) : null;
  }
  if (o.dee) {
    if (variant === 'trim') { const raw = pickConsult(st, 'dee:settleTrim', [DEE_SETTLE_TRIM], rnd, undefined, true); if (raw) return mk(raw, true); }
    if (variant === 'low') { const raw = pickConsult(st, 'dee:settleLow', [DEE_SETTLE_LOW], rnd, undefined, true); if (raw) return mk(raw, true); }
    if (variant === 'high') { const raw = pickConsult(st, 'dee:settleHigh', [DEE_SETTLE_HIGH], rnd, undefined, true); if (raw) return mk(raw, true); }
    const raw = pickConsult(st, 'dee:settle', DEE_SETTLE, rnd, undefined, true);
    return raw ? mk(raw, true) : null;
  }
  if (variant === 'trim') { const raw = pickConsult(st, `${persona}:settleTrim`, [CONSULT_SETTLE_TRIM], rnd, undefined, true); if (raw) return mk(raw, true); }
  if (variant === 'low') { const raw = pickConsult(st, `${persona}:settleLow`, [CONSULT_SETTLE_LOW], rnd, undefined, true); if (raw) return mk(raw, false); }
  if (variant === 'high') { const raw = pickConsult(st, `${persona}:settleHigh`, [CONSULT_SETTLE_HIGH], rnd, undefined, true); if (raw) return mk(raw, false); }
  const raw = pickConsult(st, `${persona}:settle`, CONSULT_SETTLE_COMMON, rnd, undefined, true);
  return raw ? mk(raw, true) : null;
}

/* ------------------------------------------------------------------ */
/* Introduction (§5.1) + confer (§5.4) + acknowledgment (§4)           */
/* ------------------------------------------------------------------ */

/** The one-time introduction line for a partner persona (never Dee). */
export function buildIntroduction(persona: PersonaId, partnerName: string, st: ConsultTalkState, rnd: () => number): string | null {
  if (persona === 'silent') return INTRO_SILENT.replace(/\{name\}/g, partnerName);
  const own = INTRO_OWN[persona] ?? [];
  const pool = [...INTRO_COMMON, ...own];
  const weights = pool.map((l) => (own.includes(l) ? 2 : 1));
  return pickConsult(st, `${persona}:intro`, pool, rnd, weights);
}

/**
 * The cover line on its own (settle nil-instead, §5.3): the human went
 * dark, so the partner's settle beat is the cover promise — count-free.
 * Same bank and bag as the consultation's cover framing (§3.2.4).
 */
export function buildCoverLine(persona: PersonaId, dee: boolean, st: ConsultTalkState, rnd: () => number): string | null {
  return pickConsult(st, `${persona}:cover`, (dee ? DEE_FREE : CONSULT_FREE).cover, rnd);
}

/** A confer ask (Form B opener) or response line. */
export function buildConferLine(kind: 'ask' | 'resp', persona: PersonaId, st: ConsultTalkState, rnd: () => number): string | null {
  return pickConsult(st, `${persona}:confer${kind}`, kind === 'ask' ? CONFER_ASK : CONFER_RESP, rnd, undefined, true);
}

/**
 * The §4 acknowledgment decision, pure: the partner's claim was off by a
 * full book against the hand's true read AND it mattered (the team got
 * set, or made its number with ≥ 3 books to spare on an under-read).
 * The 0.3 roll, the once-per-match cap, and the shark suppression live
 * with the caller / in ackApplies.
 */
export function ackApplies(claim: number | 'nil', trueRead: number, opts: { teamSet: boolean; teamMadeBy: number | null; skill: BotLevel }): 'miscount' | 'underread' | null {
  if (skillOf(opts.skill) === 'shark') return null;
  if (claim === 'nil') return null;
  const off = claim - Math.round(trueRead);
  if (Math.abs(off) < 1) return null;
  if (opts.teamSet) return 'miscount';
  if (off < 0 && opts.teamMadeBy !== null && opts.teamMadeBy >= 3) return 'underread';
  return null;
}

/** Dee's acknowledgment line for the decided kind (her bank only, §9.1). */
export function buildAck(kind: 'miscount' | 'underread', st: ConsultTalkState, rnd: () => number): string | null {
  return pickConsult(st, `dee:ack:${kind}`, kind === 'miscount' ? DEE_ACK_MISCOUNT : DEE_ACK_UNDERREAD, rnd);
}
