/**
 * RAILBIRDS (owner, 2026-10-21): the neighborhood is one world — characters
 * from earlier stops stand on the rail at later ones, chiming in from time
 * to time. Spades is a communal game; the rail is that community.
 *
 * Rules (hard):
 *  - A railbird is always someone the player has already MET: their home
 *    stop is at or before this stop (the route unlocks sequentially, so
 *    reaching a stop guarantees the meetings). Reunions, never strangers.
 *  - Never a seated player at this stop (not the pair, not Dee).
 *  - Chime-ins are SPARSE and event-keyed (the same substrate as the
 *    scene channel): a handful per match at most (RAIL_CAPS), never on
 *    top of a scripted beat. The grit stops run thin; the King runs
 *    nearly silent — presence itself is the statement.
 *  - Variants key off stored facts only (attempts at the railbird's own
 *    stop, stops cleared) — never invented history.
 *  - Railbirds never affect gameplay. They are witnesses.
 *
 * CAMEO VARIETY (owner, 2026-10-21): the rail is NOT the same room every
 * retry. When an attempt starts, its rail cast is DRAWN from the eligible
 * pool (railCastForAttempt — seeded by stop + attempt number, so the draw
 * is deterministic for a given attempt, different from the attempt before
 * it by construction, and persisted in the story session so a resumed
 * match restores the exact same faces). Caps are ceilings, not quotas:
 * some attempts run a thin rail, some none at all. The King is the one
 * exception — his rail is FULL every attempt; that crowd is the payoff.
 *
 * EXCHANGES (owner, 2026-10-21): a rail moment can become a short
 * back-and-forth with the table (railMomentFor): the railbird speaks, a
 * seated player answers, the railbird may get one comeback — 2–3 lines,
 * then it dies. Three seeded outcomes per eligible moment: solo chime-in,
 * an exchange (rarer, stricter caps), or the moment passes in silence.
 *
 * Rail lines are story lines: they join the voice-bake corpus under each
 * character's STORY_VOICE_CAST casting.
 */
import { STORY_CHARACTERS, STORY_STOPS, storyStopById } from './story';
import type { StoryBeat } from './storyScripts';

/** In-match event kinds the rail reacts to (the web scene channel's
 *  detector vocabulary) + the finalHand witness moment. */
export type RailEvent = 'jokerDropped' | 'cutMade' | 'nilMade' | 'nilBusted' | 'bigSwing' | 'finalHand';

/** Who stands on the rail at each stop (character ids). */
export const STORY_RAIL: Record<string, string[]> = {
  'porch': [], // stop 1: nobody's been met yet — the rail fills as the route does
  'barbershop': ['uncleRay'], // Ray gets his cut here; Thursdays are his
  'rec-center': ['pat'], // Miss Pat brings sandwiches and supervises everybody's business
  'cookout': ['lilMan', 'trey'], // circling the grill since noon — here for plates, staying for cards
  'corner': ['june'], // June goes where June pleases. Even here. Especially here.
  'church-basement': ['uncleRay'], // Ray don't miss a Sunday in the basement
  'rooftop': ['smoke'], // drifts past when the air is right; a voice in the dark
  'high-rise': [], // nobody from the block belongs in that lobby — the absence is the point
  'the-pjs': ['redd', 'june'], // the Pj's draws a crowd: Redd up the block, June by the fence
  'legends': ['captainBlock', 'brick'], // the last gate's holders come to watch the legends
  // The finale: EVERYONE the route let you meet (the seated King + Ringer excluded).
  'king': ['uncleRay', 'pat', 'mrColeman', 'june', 'lilMan', 'trey', 'keisha', 'teisha', 'smoke', 'redd', 'deaconFord', 'sisterMae', 'poet', 'seven', 'velvet', 'accountant', 'captainBlock', 'brick', 'queenie', 'ace'],
};

/** Max rail chime-ins per match, per stop. Seasoning, never a meal.
 * (Density pass loosening: loud/steady caps ×1.5 rounded up, tense caps +1;
 * slow caps and the King's 3 are unchanged — his rail quiets late by canon.) */
export const RAIL_CAPS: Record<string, number> = {
  'barbershop': 6, 'rec-center': 6, 'cookout': 8, 'corner': 3, 'church-basement': 4,
  'rooftop': 3, 'the-pjs': 4, 'legends': 6, 'king': 3,
};

export const railCapFor = (stopId: string): number => RAIL_CAPS[stopId] ?? 0;
export const railFor = (stopId: string): string[] => STORY_RAIL[stopId] ?? [];

/* =====================================================================
 * SEEDED RANDOMNESS — one deterministic stream family for the whole rail.
 * No Date, no Math.random: every roll is a pure function of
 * (stop, attempt number, cursor), so a session counter fully determines
 * what already happened — which is what makes resume exact.
 * ===================================================================== */

/** FNV-1a string hash → uint32. */
function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** The k-th value (0..1) of the seeded stream named by `seed`. */
function streamValue(seed: string, k: number): number {
  let a = (hashSeed(seed) + Math.imul(k + 1, 0x9e3779b9)) >>> 0;
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

/* =====================================================================
 * THE PER-ATTEMPT DRAW — random but familiar (owner, 2026-10-21).
 * The seed is the stop + the attempt number (attempts recorded before
 * this match + 1 — server-side per-player truth, so the draw is the
 * player's own even though no name is in the seed). Each eligible face
 * shows up a little better than half the time; the result is a subset of
 * the pool in pool order, possibly empty. And by CONSTRUCTION an attempt
 * never fields the exact cast of the attempt before it (when the pool
 * offers any alternative): if the raw draw repeats the previous
 * attempt's final cast, it is perturbed — grown by one face, or thinned
 * by one when it drew the whole pool.
 * ===================================================================== */

const RAIL_DRAW_P = 0.62;

const sameCast = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

function rawRailDraw(stopId: string, attemptNo: number): string[] {
  const pool = railFor(stopId);
  return pool.filter((_, i) => streamValue(`railcast|${stopId}|${attemptNo}`, i) < RAIL_DRAW_P);
}

function perturbRailDraw(stopId: string, attemptNo: number, cast: string[], pool: string[]): string[] {
  if (cast.length < pool.length) {
    // grow: add the face this attempt's seeded order puts first among the missing
    const order = [...pool].sort((x, y) =>
      streamValue(`railord|${stopId}|${attemptNo}`, pool.indexOf(x)) - streamValue(`railord|${stopId}|${attemptNo}`, pool.indexOf(y)));
    const add = order.find((id) => !cast.includes(id))!;
    return pool.filter((id) => id === add || cast.includes(id));
  }
  // the whole pool twice running: thin it by one seeded face
  const drop = pool[Math.floor(streamValue(`raildrop|${stopId}|${attemptNo}`, 0) * pool.length)]!;
  return cast.filter((id) => id !== drop);
}

/**
 * This attempt's rail cast at a stop. Deterministic in (stopId, attemptNo);
 * consecutive attempt numbers never produce the same cast (pool permitting).
 * Exceptions held: the Porch and the High-Rise are empty at every seed
 * (empty pools), and the King is FULL at every seed — the whole
 * neighborhood watching is the finale's payoff, not a retry rotation.
 */
export function railCastForAttempt(stopId: string, attemptNo: number): string[] {
  const pool = railFor(stopId);
  if (!pool.length) return [];
  if (stopId === 'king') return [...pool];
  const n = Math.max(1, Math.floor(attemptNo) || 1);
  // Walk 1..n so the anti-repeat compares against the cast the player
  // actually saw last attempt (which was itself adjusted the same way).
  let prev: string[] | null = null;
  let cast: string[] = [];
  for (let a = 1; a <= n; a++) {
    cast = rawRailDraw(stopId, a);
    if (prev && sameCast(cast, prev)) cast = perturbRailDraw(stopId, a, cast, pool);
    prev = cast;
  }
  return cast;
}

interface RailLine { speaker: string; line: string }
/** Event-keyed chime-ins per stop. Keep them short — they're said over shoulders. */
export const STORY_RAIL_LINES: Record<string, Partial<Record<RailEvent, RailLine[]>>> = {
  'barbershop': {
    jokerDropped: [{ speaker: 'uncleRay', line: 'Mm. Coleman felt that one in his molars.' }],
    bigSwing: [{ speaker: 'uncleRay', line: 'That’s a chair-leaner. June, you saw that?' }],
    nilBusted: [{ speaker: 'uncleRay', line: 'A busted nil in a barbershop. The mirrors seen worse. Barely.' }],
  },
  'rec-center': {
    jokerDropped: [{ speaker: 'pat', line: 'Lord. In front of the CHILDREN.' }],
    cutMade: [{ speaker: 'pat', line: 'Cut him! I taught half this room that move. Not him, though. Him I’d deny.' }],
    bigSwing: [{ speaker: 'pat', line: 'Somebody write that down. The babies need to know this happened.' }],
  },
  'cookout': {
    jokerDropped: [
      { speaker: 'lilMan', line: 'OHHH. Aunty, rewind it. Rewind real life.' },
      { speaker: 'trey', line: 'That joker just got GRILLED. Extra char.' },
    ],
    cutMade: [{ speaker: 'trey', line: 'Cut! Like the line at the rib tray — no mercy, no order.' }],
    nilMade: [{ speaker: 'lilMan', line: 'Nil at the COOKOUT? In this economy of smoke? Respect.' }],
    bigSwing: [{ speaker: 'trey', line: 'Scoreboard doing cardio now. Somebody get it some water.' }],
  },
  'corner': {
    bigSwing: [{ speaker: 'june', line: '…I’ve seen quieter funerals than this table. Play on.' }],
    nilBusted: [{ speaker: 'june', line: 'Hm. The corner collects its lessons in full.' }],
  },
  'church-basement': {
    jokerDropped: [{ speaker: 'uncleRay', line: 'In the basement, Lord. Forgive them — they planned that.' }],
    nilMade: [{ speaker: 'uncleRay', line: 'A made nil under a church. Mae’s been praying over cards again.' }],
    bigSwing: [{ speaker: 'uncleRay', line: 'That swing echoed off the fellowship-hall walls.' }],
  },
  'rooftop': {
    jokerDropped: [{ speaker: 'smoke', line: '…Heard that from the stairwell.' }],
    bigSwing: [{ speaker: 'smoke', line: 'City’s loud tonight. That hand was louder.' }],
  },
  'the-pjs': {
    jokerDropped: [{ speaker: 'redd', line: 'Mm. Streetlight flickered on that one. It knows.' }],
    bigSwing: [{ speaker: 'june', line: 'The whole block felt that swing. Windows rattled on my street.' }],
    nilBusted: [{ speaker: 'redd', line: 'Busted. The Pj’s keeps what it catches.' }],
  },
  'legends': {
    jokerDropped: [{ speaker: 'captainBlock', line: 'Queenie felt that in ’87 too. She just smiled the same.' }],
    nilMade: [{ speaker: 'brick', line: '…Clean.' }],
    bigSwing: [{ speaker: 'captainBlock', line: 'That’s how runs END, right there. I’ve stood where you’re standing.' }],
  },
  'king': {
    // Early, low, respectful — then they witness. (The channel enforces:
    // king rail fires only in the first three hands, plus the finalHand line.)
    jokerDropped: [{ speaker: 'uncleRay', line: '…We see you, baby. We all see you.' }],
    bigSwing: [{ speaker: 'pat', line: 'Lord have mercy. The whole block is holding its breath.' }],
    finalHand: [{ speaker: 'mrColeman', line: 'Whatever happens now — it gets told right. We’re all here to tell it.' }],
  },
};

/** The intro-scene acknowledgment beat(s): the rail is SEEN before it speaks. */
export const STORY_RAIL_INTRO: Record<string, StoryBeat[]> = {
  'barbershop': [
    { speaker: 'mrColeman', line: 'Ray’s in the tall chair — Thursday regular. Don’t mind him. He grades every bid like report cards came home.' },
    { speaker: 'uncleRay', line: 'I’m just here for the cut, Coleman. …And to watch my girls work.' },
  ],
  'rec-center': [
    { speaker: 'pat', line: 'I brought sandwiches and supervision. Somebody’s child is going home hungry-HEARTED today. Not hungry.' },
  ],
  'cookout': [
    { speaker: 'keisha', line: 'And don’t mind Lil’ Man and Trey by the grill. They been circling since noon. They ain’t here for cards — they’re here for PLATES. They’ll stay for both.' },
  ],
  'corner': [
    { speaker: 'smoke', line: '…June.' },
    { speaker: 'june', line: 'I go where I please, Smoke. Even here. Especially here. Deal your cards.' },
  ],
  'church-basement': [
    { speaker: 'sisterMae', line: 'Raymond don’t miss a Sunday down here. Says the basement hears better than the sanctuary does.' },
    { speaker: 'uncleRay', line: 'It does, Mae. It does. …Play your game, girls. I’m just the amen corner tonight.' },
  ],
  'rooftop': [
    { speaker: 'poet', line: 'Smoke passes through when the air’s right. Don’t look for him. He’ll be a voice in the dark — same as the rest of us, eventually.' },
  ],
  'the-pjs': [
    { speaker: 'captainBlock', line: 'Redd came up the block. June’s by the fence. Word travels, baby — tonight’s table is the whole neighborhood’s business.' },
  ],
  'legends': [
    { speaker: 'queenie', line: 'The Captain’s by the door. Brick beside him. The Pj’s sent their best to watch. That’s not pressure, child. That’s family — with standards.' },
  ],
  'king': [
    { speaker: 'king', line: 'Look at your rail, children. EVERYBODY came. The whole route, standing in my yard. They didn’t come to see ME. …Win or lose — what happens here tonight gets told on every porch on this block. For years.' },
  ],
};

/**
 * Which railbirds each stop's intro acknowledgment is ABOUT (the beats
 * are spoken by a mix of seated players and the railbirds themselves).
 * The scene only acknowledges faces this attempt actually drew: if any
 * subject is absent from the attempt's cast, the acknowledgment beats
 * are skipped — nobody introduces an empty chair. (King: no filter —
 * the King names the whole rail, and his cast is full by rule.)
 */
export const RAIL_INTRO_SUBJECTS: Record<string, string[]> = {
  'barbershop': ['uncleRay'],
  'rec-center': ['pat'],
  'cookout': ['lilMan', 'trey'],
  'corner': ['june'],
  'church-basement': ['uncleRay'],
  'rooftop': ['smoke'],
  'the-pjs': ['redd', 'june'],
  'legends': ['captainBlock', 'brick'],
  'king': [],
};

/** The King's outro rail: the neighborhood answers the ending. */
export const STORY_KING_RAIL_OUTRO: { win: StoryBeat[]; lose: StoryBeat[] } = {
  win: [
    { speaker: 'uncleRay', line: 'I watched her daddy play on my porch. I watched her learn on it. …And I watched THIS. Tell it right, y’all. Tell it exactly right.' },
    { speaker: 'pat', line: 'She made it OUT, Ray. Our baby made it out.' },
  ],
  lose: [
    { speaker: 'uncleRay', line: '…Nobody’s leaving. You hear me? Nobody on this rail is leaving. We’ll be standing right here when you come back. That’s a promise with twenty witnesses.' },
  ],
};

/* =====================================================================
 * EXCHANGES — call and response (owner, 2026-10-21). A rail opener that
 * invites an answer; a seated player (Dee always can; the stop's pair
 * where the pairing makes sense) answers in their own voice; the
 * railbird may get ONE comeback. Written as table talk — nobody comments
 * on cards they couldn't see; they're talking to the room, not playing.
 * Short stops (the grit stops + the Rooftop) never take a comeback:
 * one reply and the moment closes — the shape is the register.
 * ===================================================================== */

export interface RailExchangeThread {
  opener: RailLine;
  /** answer variants — speakers seated at this stop (Dee, or the pair) */
  replies: RailLine[];
  /** the railbird's last word (structurally absent at the short stops) */
  comeback?: string;
  /** the loud, live moments this thread can spark from */
  events: RailEvent[];
}

const LOUD: RailEvent[] = ['jokerDropped', 'cutMade', 'bigSwing'];

export const STORY_RAIL_EXCHANGES: Record<string, RailExchangeThread[]> = {
  'barbershop': [
    {
      opener: { speaker: 'uncleRay', line: 'Somebody tell me why this room goes quiet every time Dee gets the spades in her hand.' },
      replies: [
        { speaker: 'dee', line: 'Because they know, Uncle Ray. Watch.' },
        { speaker: 'mrColeman', line: 'Because she’s about to teach, Raymond. Hush now — class is in session.' },
      ],
      comeback: 'Taught by this room. No charge. Family rates.',
      events: LOUD,
    },
    {
      opener: { speaker: 'uncleRay', line: 'I grade every bid at this table like report cards came home. That last one? Circled. In red.' },
      replies: [
        { speaker: 'june', line: 'Grade quieter, Raymond. Some of us are playing cards, not school.' },
        { speaker: 'dee', line: 'Circle this next one too, Uncle Ray. In gold.' },
      ],
      comeback: 'Gold. Lord. The student’s getting expensive.',
      events: ['bigSwing', 'cutMade'],
    },
  ],
  'rec-center': [
    {
      opener: { speaker: 'pat', line: 'I made sandwiches for winners today. Losers get crusts — and a lesson they didn’t ask for.' },
      replies: [
        { speaker: 'dee', line: 'Put mine on a plate, Miss Pat. I’m collecting.' },
        { speaker: 'lilMan', line: 'Crusts raised me, Miss Pat. Look how I turned out.' },
      ],
      comeback: 'Turned out LOUD, baby. Eat something anyway.',
      events: LOUD,
    },
    {
      opener: { speaker: 'pat', line: 'The children are watching this table. Somebody give them a hand worth remembering right.' },
      replies: [
        { speaker: 'trey', line: 'Say less, Miss Pat. Footwork coming up.' },
        { speaker: 'dee', line: 'We’ll make it a clean one for them.' },
      ],
      events: ['jokerDropped', 'bigSwing'],
    },
  ],
  'cookout': [
    {
      opener: { speaker: 'lilMan', line: 'When Dee runs this table, I’m telling the whole grill I taught her. Whole grill.' },
      replies: [
        { speaker: 'dee', line: 'You taught me how to burn ribs, Lil’ Man. That’s the entire résumé.' },
        { speaker: 'keisha', line: 'He teaches everybody — after it already happened. It’s his one gift.' },
      ],
      comeback: 'Burned ribs built character. You’re welcome, Dee.',
      events: LOUD,
    },
    {
      opener: { speaker: 'trey', line: 'Is this the hand? The one the cookout tells stories about till the coals go cold?' },
      replies: [
        { speaker: 'teisha', line: 'Every hand’s a story when you’re the one narrating, Trey.' },
        { speaker: 'dee', line: 'Then narrate this one loud. It’s coming.' },
      ],
      comeback: 'LOUD is my natural volume. Continue.',
      events: ['bigSwing', 'jokerDropped'],
    },
  ],
  'corner': [
    {
      opener: { speaker: 'june', line: 'Quiet table. On this corner, that’s how you know it’s real.' },
      replies: [
        { speaker: 'smoke', line: '…June.' },
        { speaker: 'dee', line: 'You came all this way just to watch us, Miss June?' },
      ],
      events: ['bigSwing'],
    },
  ],
  'church-basement': [
    {
      opener: { speaker: 'uncleRay', line: 'Mae. Your partner there is bidding like the collection plate itself is watching.' },
      replies: [
        { speaker: 'sisterMae', line: 'It is, Raymond. Everything in this basement is witnessed.' },
        { speaker: 'dee', line: 'Then let it witness this hand too, Uncle Ray.' },
      ],
      comeback: 'Amen. And amen again.',
      events: LOUD,
    },
    {
      opener: { speaker: 'uncleRay', line: 'Forty years I’ve said it: this basement hears better than the sanctuary does. It heard THAT bid.' },
      replies: [
        { speaker: 'deaconFord', line: 'Then it will hear the making of it too, Brother Ray.' },
      ],
      events: ['bigSwing', 'cutMade'],
    },
  ],
  'rooftop': [
    {
      opener: { speaker: 'smoke', line: '…City’s watching this one.' },
      replies: [
        { speaker: 'dee', line: 'You always drift in for the big ones, Smoke.' },
        { speaker: 'poet', line: 'He does. Like weather with opinions.' },
      ],
      events: ['bigSwing', 'jokerDropped'],
    },
  ],
  'the-pjs': [
    {
      opener: { speaker: 'redd', line: 'Streetlight’s holding its breath out there. It only does that when it’s real.' },
      replies: [
        { speaker: 'dee', line: 'Then it better hold on a while longer, Redd.' },
        { speaker: 'brick', line: '…Let it watch.' },
      ],
      events: ['bigSwing', 'jokerDropped'],
    },
    {
      opener: { speaker: 'june', line: 'This table is the whole block’s business tonight. Play like every window’s open.' },
      replies: [
        { speaker: 'captainBlock', line: 'They hear you, June. Eyes up, everybody — lesson’s running.' },
      ],
      events: ['bigSwing', 'cutMade'],
    },
  ],
  'legends': [
    {
      opener: { speaker: 'captainBlock', line: 'I stood where you’re standing, young blood. That door don’t open for everybody who knocks.' },
      replies: [
        { speaker: 'dee', line: 'It’s open now, Captain. I’m just walking through it.' },
        { speaker: 'queenie', line: 'Let her walk, Captain. We held that door long enough.' },
      ],
      comeback: 'Walking, then. Walk well — we’ll be watching the whole way.',
      events: LOUD,
    },
    {
      opener: { speaker: 'brick', line: '…Watching.' },
      replies: [
        { speaker: 'ace', line: 'Brick spoke! Somebody mark the date — that’s a whole speech out of her.' },
        { speaker: 'dee', line: 'She doesn’t waste words, Ace. Neither should we.' },
      ],
      comeback: '…Still watching.',
      events: ['bigSwing', 'jokerDropped'],
    },
  ],
  'king': [
    {
      opener: { speaker: 'uncleRay', line: 'Twenty years I waited to watch somebody come at him the right way. Twenty.' },
      replies: [
        { speaker: 'dee', line: 'Then don’t blink, Uncle Ray. We’re not done yet.' },
      ],
      comeback: 'Not looking away, baby. Not this time.',
      events: ['bigSwing', 'jokerDropped'],
    },
    {
      opener: { speaker: 'pat', line: 'I brought enough food for a wake or a wedding. This block eats either way tonight.' },
      replies: [
        { speaker: 'king', line: 'Then feed them well, Pat. Whatever’s left of us.' },
        { speaker: 'dee', line: 'Make it a wedding, Miss Pat.' },
      ],
      events: ['bigSwing'],
    },
  ],
};

/** Ray's Porch needle is an opener too: when it draws an exchange, Dee answers it. */
export const RAIL_NEEDLE_REPLY = 'And I got up, Uncle Ray. Every single time. Watch me get up again.';

/** Max exchanges per match — a bigger beat than a heckle, so a stricter cap. */
export const RAIL_EXCHANGE_CAPS: Record<string, number> = {
  'corner': 1, 'rooftop': 1, 'the-pjs': 1,
};
export const railExchangeCapFor = (stopId: string): number => RAIL_EXCHANGE_CAPS[stopId] ?? 2;

/** Stops whose exchanges stay SHORT: one reply, no comeback, ever. */
export const RAIL_SHORT_STOPS: ReadonlySet<string> = new Set(['corner', 'rooftop', 'the-pjs']);

/** Probability an eligible moment is picked up at all (else it passes in silence).
 * (Density pass: loud +0.15, steady +0.10, tense Corner/Pj's +0.10, slow +0.05;
 * the King is unchanged — his crowd goes still while the table leans in.) */
const RAIL_SPEAK_P: Record<string, number> = {
  'corner': 0.5, 'the-pjs': 0.6, 'rooftop': 0.55, 'king': 0.6,
  'barbershop': 0.8, 'legends': 0.8, 'rec-center': 0.85, 'cookout': 0.85, 'church-basement': 0.75,
};
const railSpeakP = (stopId: string): number => RAIL_SPEAK_P[stopId] ?? 0.7;

/** Probability a picked-up moment becomes an exchange (vs a solo chime-in).
 * (Density pass: +0.05 at the loud and steady stops; tense/cold/slow/King unchanged.) */
const RAIL_EXCHANGE_P: Record<string, number> = {
  'corner': 0.18, 'the-pjs': 0.18, 'rooftop': 0.2, 'church-basement': 0.3, 'king': 0.3,
  'barbershop': 0.4, 'legends': 0.4, 'rec-center': 0.4, 'cookout': 0.4,
};
const railExchangeP = (stopId: string): number => RAIL_EXCHANGE_P[stopId] ?? 0.35;

/** Probability an exchange earns its comeback (never at the short stops). */
const RAIL_COMEBACK_P = 0.6;

/** The loud moments an exchange can spark from (a busted nil stays a solo beat). */
const RAIL_EXCHANGE_EVENTS: readonly RailEvent[] = ['jokerDropped', 'cutMade', 'bigSwing'];

/** Ray's fact-keyed rail lines (also referenced by the exchange picker). */
export const RAY_NEEDLE_LINE = 'Took you a few tries to get off my porch, baby. I counted. …I also watched you get up every time. That part I counted twice.';
export const RAY_GROWTH_LINE = 'Look at Dee now. Stops behind her and she stands different. …I knew her daddy. He’d have needed a minute, seeing this.';

export interface RailFacts {
  /** attempts recorded at the railbird's OWN home stop (stored fact) */
  attemptsAtOwnStop?: number;
  /** stops the player has cleared so far (stored fact) */
  stopsCleared: number;
  /** how many rail MOMENTS have already fired this match (caps + rotation) */
  fired: number;
  /** current hand number (the King goes quiet after the early hands) */
  handNo: number;
  /** this attempt's drawn rail cast — only these faces can speak.
   *  Absent = the stop's full pool (legacy callers). */
  cast?: readonly string[];
  /** the attempt number this match is (attempts before it + 1) — seeds
   *  the rotation so a retry doesn't lead with the same line */
  attemptNo?: number;
  /** line texts already spoken from the rail this match — never repeated */
  said?: readonly string[];
}

const attemptOf = (facts: RailFacts): number => Math.max(1, Math.floor(facts.attemptNo ?? 1) || 1);
const castOf = (stopId: string, facts: RailFacts): readonly string[] => facts.cast ?? railFor(stopId);

/**
 * Pick the railbird line for an in-match event — a SOLO chime-in from
 * this attempt's drawn cast. Returns null when the cast is empty, the
 * cap is spent, every candidate was already said this match, or the
 * moment should stay quiet (the King after hand 3, except the finalHand
 * witness line).
 *
 * Rotation is seeded by the attempt: a per-attempt starting offset into
 * the event's pool, advanced by how many moments already fired — so
 * lines cycle without repeating, and a retry doesn't open with the same
 * line the last attempt did.
 *
 * Fact variants: Ray on the rail remembers the Porch — if it took the
 * player 2+ attempts there, his first line needles it; if Dee has
 * cleared 5+ stops since, his line acknowledges her growth. Both ride
 * REAL stored numbers passed in by the caller, and both require Ray to
 * actually be on this attempt's rail.
 */
export function railLineFor(stopId: string, event: RailEvent, facts: RailFacts): RailLine | null {
  const cast = castOf(stopId, facts);
  if (!cast.length) return null;
  if (facts.fired >= railCapFor(stopId)) return null;
  if (stopId === 'king' && event !== 'finalHand' && facts.handNo > 3) return null;
  const said = new Set(facts.said ?? []);
  // Ray's memory, keyed to his own stop (the Porch, stop 1).
  if (facts.fired === 0 && cast.includes('uncleRay') && event !== 'finalHand') {
    if ((facts.attemptsAtOwnStop ?? 0) >= 2 && !said.has(RAY_NEEDLE_LINE)) return { speaker: 'uncleRay', line: RAY_NEEDLE_LINE };
    if (facts.stopsCleared >= 5 && !said.has(RAY_GROWTH_LINE)) return { speaker: 'uncleRay', line: RAY_GROWTH_LINE };
  }
  const pool = (STORY_RAIL_LINES[stopId]?.[event] ?? [])
    .filter((l) => cast.includes(l.speaker) && !said.has(l.line));
  if (!pool.length) return null;
  const base = Math.floor(streamValue(`railpick|${stopId}|${attemptOf(facts)}|${event}`, 0) * pool.length);
  return pool[(base + facts.fired) % pool.length]!;
}

/* =====================================================================
 * THE MOMENT PICKER — what the table actually calls. One eligible event
 * (an event the scripted scene did NOT take, in a fresh hand) goes in;
 * one of three seeded outcomes comes out:
 *   null      — the moment passes; nobody on the rail picks it up.
 *   solo      — one chime-in line, as the rail has always spoken.
 *   exchange  — opener + seated reply (+ optional rail comeback).
 * The rolls ride a per-attempt outcome stream indexed by `checks` (how
 * many eligible moments were already evaluated this match) — the caller
 * persists that counter, so a resumed match continues the exact same
 * stream instead of re-rolling its past.
 * ===================================================================== */

export type RailMoment =
  | { kind: 'solo'; line: RailLine }
  | { kind: 'exchange'; lines: RailLine[] };

export interface RailMomentFacts extends RailFacts {
  /** eligible rail moments already EVALUATED this match (the roll cursor) */
  checks: number;
  /** exchanges already delivered this match (the exchange cap) */
  exchangesFired: number;
}

function pickExchange(stopId: string, event: RailEvent, facts: RailMomentFacts): RailMoment | null {
  const cast = castOf(stopId, facts);
  const said = new Set(facts.said ?? []);
  const attemptNo = attemptOf(facts);
  // Ray's needle, when it is live and Ray was drawn, IS an exchange
  // opener: the needle was always aimed at Dee, and now she answers it.
  if (facts.fired === 0 && cast.includes('uncleRay') && (facts.attemptsAtOwnStop ?? 0) >= 2 && !said.has(RAY_NEEDLE_LINE)) {
    return { kind: 'exchange', lines: [{ speaker: 'uncleRay', line: RAY_NEEDLE_LINE }, { speaker: 'dee', line: RAIL_NEEDLE_REPLY }] };
  }
  const stop = storyStopById(stopId);
  const seated: readonly string[] = stop ? [...stop.pair, 'dee'] : ['dee'];
  const threads = (STORY_RAIL_EXCHANGES[stopId] ?? []).filter((t) =>
    cast.includes(t.opener.speaker) && !said.has(t.opener.line) && t.events.includes(event));
  if (!threads.length) return null;
  const tBase = Math.floor(streamValue(`railx|${stopId}|${attemptNo}`, 0) * threads.length);
  const thread = threads[(tBase + facts.exchangesFired) % threads.length]!;
  const replies = thread.replies.filter((r) => seated.includes(r.speaker) && !said.has(r.line));
  if (!replies.length) return null; // an opener nobody seated can answer stays unspoken here
  const rBase = Math.floor(streamValue(`railxr|${stopId}|${attemptNo}`, 0) * replies.length);
  const reply = replies[(rBase + facts.exchangesFired) % replies.length]!;
  const lines: RailLine[] = [thread.opener, reply];
  // The comeback: never at the short stops (grit + Rooftop) — one reply
  // closes the moment there. Elsewhere it lands a little better than
  // half the time, rolled on this check's third outcome draw.
  if (!RAIL_SHORT_STOPS.has(stopId) && thread.comeback && !said.has(thread.comeback)
    && streamValue(`railout|${stopId}|${attemptNo}`, facts.checks * 3 + 2) < RAIL_COMEBACK_P) {
    lines.push({ speaker: thread.opener.speaker, line: thread.comeback });
  }
  return { kind: 'exchange', lines };
}

/**
 * Decide a rail moment for an eligible in-match event. Same gates as
 * railLineFor (cast, caps, King's quiet endgame) plus the seeded outcome
 * rolls. The King's finalHand witness line is a story beat wearing rail
 * clothes — it bypasses the outcome rolls and lands whenever it is
 * available, exactly as it did before the rolls existed.
 */
export function railMomentFor(stopId: string, event: RailEvent, facts: RailMomentFacts): RailMoment | null {
  const cast = castOf(stopId, facts);
  if (!cast.length) return null;
  if (facts.fired >= railCapFor(stopId)) return null;
  if (stopId === 'king' && event !== 'finalHand' && facts.handNo > 3) return null;
  if (event === 'finalHand') {
    const line = railLineFor(stopId, event, facts);
    return line ? { kind: 'solo', line } : null;
  }
  const attemptNo = attemptOf(facts);
  const out = (k: number) => streamValue(`railout|${stopId}|${attemptNo}`, facts.checks * 3 + k);
  if (out(0) >= railSpeakP(stopId)) return null; // nobody picks it up
  if (out(1) < railExchangeP(stopId) && facts.exchangesFired < railExchangeCapFor(stopId) && RAIL_EXCHANGE_EVENTS.includes(event)) {
    const ex = pickExchange(stopId, event, facts);
    if (ex) return ex;
    // no thread fits this cast/event/match — fall through to a solo line
  }
  const line = railLineFor(stopId, event, facts);
  return line ? { kind: 'solo', line } : null;
}

/** Static honesty checks for the rail map (used by tests + dev sanity). */
export function railIssues(): string[] {
  const out: string[] = [];
  for (const stop of STORY_STOPS) {
    for (const id of railFor(stop.id)) {
      const ch = STORY_CHARACTERS[id];
      if (!ch) { out.push(`${stop.id}: unknown railbird ${id}`); continue; }
      if (stop.pair.includes(id)) out.push(`${stop.id}: ${id} is seated here`);
      if (id === 'dee') out.push(`${stop.id}: Dee is never rail`);
      const home = STORY_STOPS.find((s) => s.pair.includes(id));
      if (home && home.n > stop.n) out.push(`${stop.id}: ${id} not met yet (home stop ${home.n})`);
    }
    for (const id of RAIL_INTRO_SUBJECTS[stop.id] ?? []) {
      if (!railFor(stop.id).includes(id)) out.push(`${stop.id}: intro acknowledges ${id}, who is not on this rail`);
    }
    for (const t of STORY_RAIL_EXCHANGES[stop.id] ?? []) {
      if (!railFor(stop.id).includes(t.opener.speaker)) out.push(`${stop.id}: exchange opener ${t.opener.speaker} is not on this rail`);
      if (!t.events.length) out.push(`${stop.id}: exchange thread for ${t.opener.speaker} has no events`);
      for (const r of t.replies) {
        if (r.speaker !== 'dee' && !stop.pair.includes(r.speaker)) out.push(`${stop.id}: exchange reply ${r.speaker} is not seated here`);
      }
      if (RAIL_SHORT_STOPS.has(stop.id) && t.comeback) out.push(`${stop.id}: short stop carries a comeback (${t.opener.speaker})`);
    }
  }
  return out;
}

export { storyStopById };
