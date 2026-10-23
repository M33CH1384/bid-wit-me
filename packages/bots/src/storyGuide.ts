/**
 * DEE THE GUIDE (co-op spec §5.3–5.4): in co-op Dee plays no seat — she
 * rides along as a standing participant with her own beat layer,
 * evaluated by the online story table (the Room) on the same public
 * inputs the table already sees: hand-end score snapshots, hand records,
 * and moments. She comments on the BOARD — scores, bids, books, sets,
 * public events — and never references either human's hand (the
 * no-disclosure rule that governs consultation governs her too).
 *
 * She is NOT a railbird: not drawn, not capped like a cameo, never
 * rotated out. She IS inside the stop's density budget (spec §5.4):
 * max 1 guide line per hand, class-spaced, her generic state read
 * chance-gated by the stop's density class — at the slow stops
 * (Church, Rooftop) she can sit silent for whole hands; presence
 * without flooding is the design. Her STATE lines (match point, set)
 * rank with scripted beats; her generic chatter is the lowest
 * priority at the table — the evaluator's trigger order encodes it.
 *
 * VOICE FENCE: every line here is TEXT ONLY until the Phase 4
 * mini-bake records it in Dee's own cast voice. The chat lines this
 * layer produces carry no bot/persona payload, so no client ever
 * voices them from a substitute sprite, catalog, or speech synth.
 * The finale pool (guideFinale) ships as data now; its TRIGGERS are
 * Phase 4 (the cutthroat) and are deliberately not wired here.
 */
import { STOP_DENSITY_CLASS, storyStopById } from './story';
import type { DensityClass } from './talk';
import type { AwarenessCase } from './storyAwareness';

/* =====================================================================
 * THE BANKS (spec §8.1–8.7 + §7.6, VERBATIM). Display text is the
 * recording key seed, as with every story line.
 * ===================================================================== */

/** Talking crap — the pair is ahead (spec §8.1). */
export const GUIDE_WINNING: readonly string[] = [
  'Y’all seeing this? My people came to WORK today.',
  'Go ahead and smile for the table. This score ain’t close.',
  'They gon’ need a map to find their way back in this one.',
  'I tried to tell y’all how this was gon’ go.',
  'That’s not luck, that’s a pattern. Look at the board.',
  'Somebody check on them. Quiet over there all of a sudden.',
  'We not even playing our best and it’s still like this.',
  'Keep stacking. I like the view from up here.',
  'Y’all had a plan? What was it — lose pretty?',
  'This the part where they start doing math out loud. Sad.',
];

/** Bagging on the team — the pair is down (spec §8.2). */
export const GUIDE_LOSING: readonly string[] = [
  'Okay. Y’all playing like you met in the parking lot.',
  'I give the rundown, y’all give away books. Teamwork.',
  'We down and y’all still cute about it. Focus.',
  'I know two players. They just not here yet.',
  'I’m up here guiding, y’all down there wandering. Pick a direction.',
  'Down bad ain’t a strategy. I’ve checked.',
  'Y’all owe the table an apology and me a comeback.',
  'If we lose to this pair, I will be telling this story forever. Motivated yet?',
  'Books. We need BOOKS. I know y’all know what those are.',
  'This is fixable, but not at this speed. Wake up.',
];

/** Score-state pools, 2 each (spec §8.3). */
export const GUIDE_BIG_LEAD: readonly string[] = [
  'Big lead. Don’t get cute — cute is how leads die.',
  'Up like this, the only enemy is boredom. Stay mean.',
];
export const GUIDE_DOWN_BAD: readonly string[] = [
  'Down bad, not buried. There’s a difference and it’s this hand.',
  'A comeback needs one hand to turn. Make it this one.',
];
export const GUIDE_MATCH_POINT_US: readonly string[] = [
  'Match point. Finish it like you mean it.',
  'One hand between us and the story I get to tell. Close it.',
];
export const GUIDE_MATCH_POINT_THEM: readonly string[] = [
  'They’re at match point. Everything they do now, charge them for it.',
  'A season’s worth of pride on this hand. Play it like it.',
];
/** WE set THEM (their contract failed). */
export const GUIDE_SET_US: readonly string[] = [
  'SET. That’s the sound of a plan dying.',
  'They bid it, we buried it. Next.',
];
/** WE got set (our contract failed). */
export const GUIDE_SET_THEM: readonly string[] = [
  'A set ain’t the end. It’s information. Use it.',
  'That one cost us. Don’t let it charge rent.',
];
export const GUIDE_COMEBACK: readonly string[] = [
  'THERE it is. That’s the team I signed up to guide.',
  'From the dirt to the lead. Remember this feeling.',
];

/** Neutral, early / hand-start (spec §8.4). Also the partner-moment
 *  pool: the bank carries no handle-templated variants, so a standout
 *  play by a human surfaces a focus line (spec §5.3's fallback). */
export const GUIDE_FOCUS: readonly string[] = [
  'New hand. Same mission. Talk to each other.',
  'Books first, highlights later.',
  'Watch their first plays — they always tell on themselves early.',
  'Set the tone this hand. Don’t wait for permission.',
];

/** Nil resolved (spec §8.5), keyed by the public outcome. */
export const GUIDE_NIL: { oursMade: string; theirsBusted: string; oursBusted: string } = {
  oursMade: 'Nil CLEAN. That’s how you disappear on a table.',
  theirsBusted: 'Nil BUSTED. Somebody over there is doing paperwork.',
  oursBusted: 'The nil died. Shake it off — it happens to hunters too.',
};

/** Story depth, 2 per stop (spec §8.6) — the route's memory, spoken
 *  once or twice a match at seeded hands, never as filler. */
export const GUIDE_DEPTH: Record<string, [string, string]> = {
  'porch': ['Ray taught half this block on this porch. Beating him here means something.', 'Pat keeps lemonade cold and grudges warm. Mind both.'],
  'barbershop': ['Coleman’s shop, Coleman’s rules — a hundred years of scores settled in that chair.', 'June’s been running this table since before y’all were a rumor.'],
  'rec-center': ['This gym has seen a thousand runs. The walls remember who folded.', 'Lil’ Man feeds off this crowd. Starve him quiet.'],
  'cookout': ['The twins share everything — including whatever they’re plotting right now.', 'Keisha’s grill, Teisha’s mouth. Both stay hot.'],
  'corner': ['Smoke don’t waste words or books. Every one he keeps is a statement.', 'My daddy’s name still lives on this corner. Play like you know that.'],
  'church-basement': ['Down here the cards are quiet and the lessons aren’t.', 'Sister Mae prays for everybody. Then she plays like she didn’t.'],
  'rooftop': ['Poet sees four moves ahead and three conspiracies deeper.', 'Seven says nothing because the cards say it for him.'],
  'high-rise': ['Velvet smiles like a landlord. Everything here is priced, including you.', 'The Accountant has already counted this game. Prove his math wrong.'],
  'the-pjs': ['The Captain runs this block like a shift. Brick enforces the schedule.', 'Under these lights, reputations get made and collected.'],
  'legends': ['Queenie and Ace have buried better teams than yours. Respectfully: become harder to bury.', 'Every legend at this table earned the chair. Earn yours.'],
  'king': ['Everything on this route was a rehearsal for this room.', 'The King don’t defend a crown. He collects rent on it.'],
};

/** Awareness callbacks (spec §7.6, VERBATIM) — Dee acknowledges the
 *  room's memory once, early, when case (b)/(d) facts exist; then the
 *  room does not nag. */
export const GUIDE_AWARE: readonly string[] = [
  'They remember you. That’s respect and a warning in the same outfit.',
  'New partner, same reputation walking in ahead of you. Carry it right.',
  'They’re not sizing up the new one. They’re sizing up what YOU became.',
  'See how they watch your partner? That’s your old scouting report, expiring.',
  'You know this room. Your partner’s learning it. Be the tour guide AND the muscle.',
  'History’s a headline. This hand is the story. Write it.',
];

/**
 * The cutthroat finale pool (spec §8.7). Phase 4 wires its triggers
 * (§6.4) through the finale evaluator below — the partnership game may
 * still never draw from it; only the co-op King's cutthroat does.
 */
export const GUIDE_FINALE: readonly string[] = [
  'Cutthroat. So now I get to watch my own people get greedy.',
  'He’s not testing your cards. He’s testing your friendship’s price.',
  'One of you can take the double. The other one’s pride is the ante.',
  'If you cut your own partner, make it count. Halfway betrayal is just losing twice.',
  'Partners an hour ago. Act like you remember — or don’t. That’s the game he wanted.',
  'Y’all letting HIM take this? In OUR finale?',
  'The King is smiling. He wins something even when he loses. Remember that.',
  'Three sets and you’re watching from the rail with me. Hurts, don’t it.',
  'One throne-adjacent chair, emptied by MY people. Continue.',
  'Two left. Somebody’s leaving this table a story the other one tells forever.',
  'THERE. The double is ours — and yes, I’m saying ours.',
  'One of mine took the crown and the other took the lesson. The double’s ours. The story’s… gonna need its own night.',
];

/** The outro's closing line (spec §5.5 / §8.7), keyed by result. */
export const GUIDE_OUTRO: { win: readonly string[]; loss: readonly string[]; kingClear: string; kingDoubleLost: string } = {
  win: ['That’s how a pair becomes a problem on this block.', 'Told them who you were. Then you showed them. Both count.'],
  loss: ['We lost a match, not the plot. Run it back when you’re ready.', 'They earned tonight. We earned the notes. Spend them.'],
  kingClear: 'The route is DONE — together. Put both names on it.',
  kingDoubleLost: 'The crown stays his tonight. The wanting stays yours. That’s not nothing.',
};

/** Every guide line that exists (the recording corpus + test pins). */
export function allGuideLines(): { pool: string; line: string }[] {
  const out: { pool: string; line: string }[] = [];
  const add = (pool: string, lines: readonly string[]) => { for (const line of lines) out.push({ pool, line }); };
  add('guideWinning', GUIDE_WINNING);
  add('guideLosing', GUIDE_LOSING);
  add('guideBigLead', GUIDE_BIG_LEAD);
  add('guideDownBad', GUIDE_DOWN_BAD);
  add('guideMatchPointUs', GUIDE_MATCH_POINT_US);
  add('guideMatchPointThem', GUIDE_MATCH_POINT_THEM);
  add('guideSetUs', GUIDE_SET_US);
  add('guideSetThem', GUIDE_SET_THEM);
  add('guideComeback', GUIDE_COMEBACK);
  add('guideFocus', GUIDE_FOCUS);
  add('guideNil', [GUIDE_NIL.oursMade, GUIDE_NIL.theirsBusted, GUIDE_NIL.oursBusted]);
  for (const [stopId, lines] of Object.entries(GUIDE_DEPTH)) add(`guideDepth:${stopId}`, lines);
  add('guideAware', GUIDE_AWARE);
  add('guideFinale', GUIDE_FINALE);
  add('guideOutro', [...GUIDE_OUTRO.win, ...GUIDE_OUTRO.loss, GUIDE_OUTRO.kingClear, GUIDE_OUTRO.kingDoubleLost]);
  return out;
}

/* =====================================================================
 * THE EVALUATOR — pure and seeded where it must be, stateful only in
 * the caller's persisted GuideState (the Room owns it; a resumed room
 * continues the exact match). Rolls ride the injected rng (the room
 * passes Math.random; tests pass a seeded stream).
 * ===================================================================== */

/** Hand-end state-read probability by density class (spec §5.4).
 *  The King runs climax/climaxLate — specced silent there; steady's
 *  0.7 is the honest read of his gear (his rail quiets, Dee doesn't). */
export const GUIDE_SPEAK_P: Record<DensityClass, number> = {
  loud: 0.85, lively: 0.85, steady: 0.7, tense: 0.55, cold: 0.55, slow: 0.45,
  climax: 0.7, climaxLate: 0.7, standard: 0.7,
};

/** Min hands between guide lines: 2 on slow/tense/cold, 1 elsewhere
 *  (spec §5.4) — also what enforces max 1 line per hand. */
export const guideSpacingFor = (cls: DensityClass): number =>
  (cls === 'slow' || cls === 'tense' || cls === 'cold' ? 2 : 1);

export interface GuideState {
  /** line texts already spoken this match — never repeated */
  said: string[];
  /** hand number of the last guide line (0 = none yet) */
  lastHand: number;
  /** seeded story-depth hands: the first in 2–4, the second (loud /
   *  lively stops only) at 7+ */
  depthHand1: number;
  depthHand2: number | null;
  depthFired: number;
  /** the awareness callback is spent (once per match, case b/d only) */
  awareSpent: boolean;
  /** the pair has trailed by ≥100 at some earlier hand end */
  trailedBig: boolean;
  comebackFired: boolean;
  /** hand ends evaluated (the wiring's heartbeat — tests read it) */
  handsSeen: number;
  /** finale lines spoken this cutthroat (Phase 4; the budget is capped
   *  at GUIDE_FINALE_MAX — see the finale evaluator below) */
  finaleFired: number;
}

/** FNV-1a → mulberry-ish stream, the rail's house style: deterministic
 *  in the seed key so a match's depth hands never depend on wall time. */
function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function streamValue(seed: string, k: number): number {
  let a = (hashSeed(seed) + Math.imul(k + 1, 0x9e3779b9)) >>> 0;
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

/** Fresh per-match guide state. `seedKey` identifies the match (room
 *  code + game number + stop) so depth hands are stable across the
 *  room's hibernation and different on a rematch. */
export function newGuideState(stopId: string, seedKey: string): GuideState {
  const cls = STOP_DENSITY_CLASS[stopId] ?? 'standard';
  const loud = cls === 'loud' || cls === 'lively';
  return {
    said: [],
    lastHand: 0,
    depthHand1: 2 + Math.floor(streamValue(`guideDepth|${seedKey}`, 0) * 3),
    depthHand2: loud ? 7 + Math.floor(streamValue(`guideDepth|${seedKey}`, 1) * 3) : null,
    depthFired: 0,
    awareSpent: false,
    trailedBig: false,
    comebackFired: false,
    handsSeen: 0,
    finaleFired: 0,
  };
}

/** Public facts about the hand that just ended, from the pair's side.
 *  Everything here is board truth — scores, the hand record's points,
 *  contracts and nil results. No hand contents, ever. */
export interface GuideHandFacts {
  handNo: number;
  /** series scores AFTER this hand (the pair's side first) */
  us: number;
  them: number;
  /** series scores BEFORE this hand */
  prevUs: number;
  prevThem: number;
  target: number;
  /** this hand's points per side */
  usPoints: number;
  themPoints: number;
  /** the pair's contract failed — WE got set */
  setOnUs: boolean;
  /** their contract failed — WE set them */
  setOnThem: boolean;
  /** the hand's nil outcome, from the pair's point of view */
  nil: 'oursMade' | 'oursBusted' | 'theirsMade' | 'theirsBusted' | null;
  /** a HUMAN on the pair's side made a standout play this hand:
   *  a nuke, a made blind nil, or a 10+ book hand (board facts) */
  partnerMoment: boolean;
  /** the awareness case for this sit-down (room-precomputed) */
  awareCase: AwarenessCase;
}

export type GuideTrigger =
  | 'matchPoint' | 'set' | 'comeback' | 'bigSwing' | 'partnerMoment'
  | 'nil' | 'aware' | 'depth' | 'state' | 'finale';

export interface GuideLine { text: string; trigger: GuideTrigger; pool: string }

const MATCH_POINT_WITHIN = 50;
const BIG_SWING = 60;
const BAND = 40;
const BIG_BAND = 150;
const TRAIL_BIG = 100;

function pickUnused(pool: readonly string[], state: GuideState, rng: () => number): string | null {
  const said = new Set(state.said);
  const free = pool.filter((l) => !said.has(l));
  if (!free.length) return null;
  return free[Math.floor(rng() * free.length)]!;
}

function fire(state: GuideState, handNo: number, text: string, trigger: GuideTrigger, pool: string): GuideLine {
  state.said.push(text);
  state.lastHand = handNo;
  return { text, trigger, pool };
}

/**
 * Evaluate Dee's guide line for the hand that just ended. Mutates
 * `state` (the match memory: said set, spacing, once-only flags) and
 * returns the line to deliver, or null when she stays quiet — the
 * class roll failed, the spacing isn't met, or every fitting pool is
 * spent. Trigger order is the priority order (spec §5.3): her state
 * lines (match point, set) rank with scripted beats; the generic
 * state read is last and chance-gated.
 */
export function guideHandLine(stopId: string, state: GuideState, facts: GuideHandFacts, rng: () => number): GuideLine | null {
  state.handsSeen += 1;
  if (facts.prevThem - facts.prevUs >= TRAIL_BIG) state.trailedBig = true;
  const cls = STOP_DENSITY_CLASS[stopId] ?? 'standard';
  if (facts.handNo - state.lastHand < guideSpacingFor(cls)) return null;
  const diff = facts.us - facts.them;
  const inBand = (score: number, other: number) => score >= facts.target - MATCH_POINT_WITHIN && score > other;

  // 1 · match point ENTERED this hand (either side)
  const mpUs = inBand(facts.us, facts.them) && !inBand(facts.prevUs, facts.prevThem);
  const mpThem = inBand(facts.them, facts.us) && !inBand(facts.prevThem, facts.prevUs);
  if (mpUs || mpThem) {
    const line = pickUnused(mpUs ? GUIDE_MATCH_POINT_US : GUIDE_MATCH_POINT_THEM, state, rng);
    if (line) return fire(state, facts.handNo, line, 'matchPoint', mpUs ? 'guideMatchPointUs' : 'guideMatchPointThem');
  }
  // 2 · a set landed (we set them reads first — it's the cheer)
  if (facts.setOnThem || facts.setOnUs) {
    const line = pickUnused(facts.setOnThem ? GUIDE_SET_US : GUIDE_SET_THEM, state, rng);
    if (line) return fire(state, facts.handNo, line, 'set', facts.setOnThem ? 'guideSetUs' : 'guideSetThem');
  }
  // 3 · the comeback: the lead, taken back after trailing ≥100
  if (state.trailedBig && !state.comebackFired && diff > 0) {
    const line = pickUnused(GUIDE_COMEBACK, state, rng);
    if (line) { state.comebackFired = true; return fire(state, facts.handNo, line, 'comeback', 'guideComeback'); }
  }
  // 4 · big swing (≥60 of hand points either way)
  if (Math.abs(facts.usPoints - facts.themPoints) >= BIG_SWING) {
    const pool = diff >= BIG_BAND ? GUIDE_BIG_LEAD : diff <= -BIG_BAND ? GUIDE_DOWN_BAD : diff >= 0 ? GUIDE_WINNING : GUIDE_LOSING;
    const name = diff >= BIG_BAND ? 'guideBigLead' : diff <= -BIG_BAND ? 'guideDownBad' : diff >= 0 ? 'guideWinning' : 'guideLosing';
    const line = pickUnused(pool, state, rng);
    if (line) return fire(state, facts.handNo, line, 'bigSwing', name);
  }
  // 5 · a human's standout play (focus pool — see GUIDE_FOCUS note)
  if (facts.partnerMoment) {
    const line = pickUnused(GUIDE_FOCUS, state, rng);
    if (line) return fire(state, facts.handNo, line, 'partnerMoment', 'guideFocus');
  }
  // 6 · a nil resolved (theirs MADE earns no line — the bank has none)
  if (facts.nil && facts.nil !== 'theirsMade') {
    const line = GUIDE_NIL[facts.nil];
    if (!state.said.includes(line)) return fire(state, facts.handNo, line, 'nil', 'guideNil');
  }
  // 7 · the awareness callback — once, early, case (b)/(d) only
  if (!state.awareSpent && (facts.awareCase === 'b' || facts.awareCase === 'd') && rng() < GUIDE_SPEAK_P[cls]) {
    const line = pickUnused(GUIDE_AWARE, state, rng);
    if (line) { state.awareSpent = true; return fire(state, facts.handNo, line, 'aware', 'guideAware'); }
  }
  // 8 · story depth at its seeded hands
  if ((facts.handNo === state.depthHand1 || facts.handNo === state.depthHand2) && state.depthFired < 2) {
    const pool = GUIDE_DEPTH[stopId];
    if (pool) {
      const line = pool[state.depthFired] ?? pool[0]!;
      if (!state.said.includes(line)) { state.depthFired += 1; return fire(state, facts.handNo, line, 'depth', `guideDepth:${stopId}`); }
    }
  }
  // 9 · the hand-end state read — the generic chatter, chance-gated
  if (rng() < GUIDE_SPEAK_P[cls]) {
    const pool = diff >= BIG_BAND ? GUIDE_BIG_LEAD : diff <= -BIG_BAND ? GUIDE_DOWN_BAD
      : diff >= BAND ? GUIDE_WINNING : diff <= -BAND ? GUIDE_LOSING : GUIDE_FOCUS;
    const name = diff >= BIG_BAND ? 'guideBigLead' : diff <= -BIG_BAND ? 'guideDownBad'
      : diff >= BAND ? 'guideWinning' : diff <= -BAND ? 'guideLosing' : 'guideFocus';
    const line = pickUnused(pool, state, rng);
    if (line) return fire(state, facts.handNo, line, 'state', name);
  }
  return null;
}

/**
 * The marked mid-hand reaction (spec §5.3): a pair-side HUMAN's nuke
 * is the one moment Dee may speak mid-trick. Draws from the focus
 * pool (the bank's partner-moment answer), obeys the same spacing —
 * which is also what keeps the hand to one guide line total: a nuke
 * line spends the hand's slot, and the hand-end read then stands down.
 */
export function guideEventLine(stopId: string, state: GuideState, handNo: number, rng: () => number): GuideLine | null {
  const cls = STOP_DENSITY_CLASS[stopId] ?? 'standard';
  if (handNo - state.lastHand < guideSpacingFor(cls)) return null;
  const line = pickUnused(GUIDE_FOCUS, state, rng);
  return line ? fire(state, handNo, line, 'partnerMoment', 'guideFocus') : null;
}

/** Dee's outro closing line (spec §5.5), picked deterministically from
 *  a seed key (the gameId) so both partners read the same words. */
export function guideOutroLine(kind: 'win' | 'loss' | 'kingClear' | 'kingDoubleLost', seedKey: string): string {
  if (kind === 'kingClear') return GUIDE_OUTRO.kingClear;
  if (kind === 'kingDoubleLost') return GUIDE_OUTRO.kingDoubleLost;
  const pool = GUIDE_OUTRO[kind];
  return pool[Math.floor(streamValue(`guideOutro|${seedKey}`, 0) * pool.length)]!;
}

/* =====================================================================
 * THE FINALE EVALUATOR (Phase 4, spec §6.4) — Dee guides the co-op
 * King's cutthroat from the rail; she never plays in it. The pool is
 * GUIDE_FINALE, keyed by index there: [0] the start, [1]/[2] the
 * proposal scene's own beats (the wiring seeds them as said — the
 * scene spoke them, the evaluator never repeats them), [3]/[4]
 * betrayal, [5] the King leading late, [6] the King smiling, [7] a
 * human eliminated, [8] a human eliminates the King or the Ringer,
 * [9] two players left, [10] a human wins, [11] a human wins with the
 * partner finishing last. Budget: at most GUIDE_FINALE_MAX lines per
 * cutthroat — the start and the hand-end reads share all but one
 * slot, which is reserved for the resolution line.
 * ===================================================================== */

export const GUIDE_FINALE_MAX = 4;

/** Per-seat board truth about the hand that just ended in the
 *  cutthroat. Seats are absolute (0..3); the two humans sit 0 and 2.
 *  Everything here is public — scores, tricks, contracts, who fell. */
export interface GuideFinaleFacts {
  handNo: number;
  /** cumulative scores per seat, after this hand */
  scores: readonly number[];
  /** tricks taken per seat this hand */
  tricks: readonly number[];
  /** seats whose contract failed this hand (a set) */
  setSeats: readonly number[];
  /** seats still in the game after this hand */
  alive: readonly number[];
  /** seats eliminated BY this hand (were alive at the previous hand end) */
  newlyEliminated: readonly number[];
  /** the two human seats */
  humans: readonly [number, number];
}

function fireFinale(state: GuideState, handNo: number, idx: number): GuideLine {
  state.finaleFired = (state.finaleFired ?? 0) + 1;
  return fire(state, handNo, GUIDE_FINALE[idx]!, 'finale', 'guideFinale');
}

function finaleIdxUnused(state: GuideState, idx: number): boolean {
  return !(state.said ?? []).includes(GUIDE_FINALE[idx]!);
}

/** The cutthroat's opening read — fires once, at conversion. */
export function guideFinaleStartLine(state: GuideState): GuideLine | null {
  if ((state.finaleFired ?? 0) >= GUIDE_FINALE_MAX - 1) return null;
  if (!finaleIdxUnused(state, 0)) return null;
  return fireFinale(state, 1, 0);
}

/** Dee's hand-end read of the cutthroat (spec §6.4 trigger list, in
 *  priority order: a fall outranks a betrayal outranks the King's
 *  comfort). At most one line per hand; the resolution line's slot is
 *  always kept in reserve. */
export function guideFinaleLine(state: GuideState, facts: GuideFinaleFacts, rng: () => number): GuideLine | null {
  if ((state.finaleFired ?? 0) >= GUIDE_FINALE_MAX - 1) return null;
  const [h1, h2] = facts.humans;
  const isHuman = (s: number) => s === h1 || s === h2;
  const tryIdx = (idx: number): GuideLine | null => (finaleIdxUnused(state, idx) ? fireFinale(state, facts.handNo, idx) : null);
  // A human just fell (third set / shot out) — the hardest beat.
  if (facts.newlyEliminated.some(isHuman)) { const l = tryIdx(7); if (l) return l; }
  // A human just emptied the King or the Ringer's chair.
  if (facts.newlyEliminated.some((s) => !isHuman(s))) { const l = tryIdx(8); if (l) return l; }
  // Betrayal: one human's contract failed while the other feasted.
  const betrayed = facts.setSeats.some((s) => {
    if (!isHuman(s)) return false;
    const other = s === h1 ? h2 : h1;
    return (facts.tricks[other] ?? 0) >= 3 && (facts.tricks[other] ?? 0) > (facts.tricks[s] ?? 0);
  });
  if (betrayed) {
    const free = [3, 4].filter((i) => finaleIdxUnused(state, i));
    if (free.length) return fireFinale(state, facts.handNo, free[Math.floor(rng() * free.length)]!);
  }
  // Two players left standing.
  if (facts.alive.length === 2) { const l = tryIdx(9); if (l) return l; }
  // The King leads the table late in the game.
  const botMax = Math.max(...facts.scores.filter((_, s) => !isHuman(s)));
  const humanMax = Math.max(facts.scores[h1] ?? 0, facts.scores[h2] ?? 0);
  if (facts.handNo >= 3 && botMax > humanMax) { const l = tryIdx(5); if (l) return l; }
  // A bot ran the hand (the King's comfort read).
  const botTricks = Math.max(...facts.tricks.filter((_, s) => !isHuman(s)));
  if (botTricks >= 6) { const l = tryIdx(6); if (l) return l; }
  return null;
}

/** The resolution line — a human took the cutthroat. [11] when the
 *  partner finished last: the double is shared, the story is not. */
export function guideFinaleResolutionLine(state: GuideState, partnerLast: boolean): GuideLine | null {
  if ((state.finaleFired ?? 0) >= GUIDE_FINALE_MAX) return null;
  const idx = partnerLast ? 11 : 10;
  if (!finaleIdxUnused(state, idx)) return null;
  return fireFinale(state, 0, idx);
}

/** Static honesty checks (tests + dev sanity): every stop has depth
 *  lines; no pool repeats a line; no guide line leaks a card fact
 *  (she speaks from the board — a rank+suit pattern would be a tell). */
export function guideIssues(): string[] {
  const out: string[] = [];
  const stopIds = Object.keys(STOP_DENSITY_CLASS);
  for (const id of stopIds) if (!GUIDE_DEPTH[id]) out.push(`${id}: no guide depth lines`);
  if (!storyStopById('porch')) out.push('story stops unavailable');
  const seen = new Map<string, string>();
  for (const { pool, line } of allGuideLines()) {
    if (seen.has(line)) out.push(`line in two pools: ${pool} & ${seen.get(line)} — "${line.slice(0, 40)}"`);
    seen.set(line, pool);
  }
  return out;
}
