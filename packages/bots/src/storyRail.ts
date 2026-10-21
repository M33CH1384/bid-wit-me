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

/** Max rail chime-ins per match, per stop. Seasoning, never a meal. */
export const RAIL_CAPS: Record<string, number> = {
  'barbershop': 4, 'rec-center': 4, 'cookout': 5, 'corner': 2, 'church-basement': 4,
  'rooftop': 3, 'the-pjs': 3, 'legends': 4, 'king': 3,
};

export const railCapFor = (stopId: string): number => RAIL_CAPS[stopId] ?? 0;
export const railFor = (stopId: string): string[] => STORY_RAIL[stopId] ?? [];

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

export interface RailFacts {
  /** attempts recorded at the railbird's OWN home stop (stored fact) */
  attemptsAtOwnStop?: number;
  /** stops the player has cleared so far (stored fact) */
  stopsCleared: number;
  /** how many rail lines have already fired this match (rotation + caps) */
  fired: number;
  /** current hand number (the King goes quiet after the early hands) */
  handNo: number;
}

/**
 * Pick the railbird line for an in-match event — deterministic rotation
 * through the stop's pool for that event. Returns null when the rail is
 * empty, the cap is spent, or the moment should stay quiet (the King
 * after hand 3, except the finalHand witness line).
 *
 * Fact variants: Ray on the rail remembers the Porch — if it took the
 * player 2+ attempts there, his first Church/Barbershop line needles it;
 * if Dee has cleared 5+ stops since, his line acknowledges her growth.
 * Both ride REAL stored numbers passed in by the caller.
 */
export function railLineFor(stopId: string, event: RailEvent, facts: RailFacts): RailLine | null {
  const rail = railFor(stopId);
  if (!rail.length) return null;
  if (facts.fired >= railCapFor(stopId)) return null;
  if (stopId === 'king' && event !== 'finalHand' && facts.handNo > 3) return null;
  // Ray's memory, keyed to his own stop (the Porch, stop 1).
  if (facts.fired === 0 && rail.includes('uncleRay') && (facts.attemptsAtOwnStop ?? 0) >= 2 && event !== 'finalHand') {
    return { speaker: 'uncleRay', line: 'Took you a few tries to get off my porch, baby. I counted. …I also watched you get up every time. That part I counted twice.' };
  }
  if (facts.fired === 0 && rail.includes('uncleRay') && facts.stopsCleared >= 5 && event !== 'finalHand') {
    return { speaker: 'uncleRay', line: 'Look at Dee now. Stops behind her and she stands different. …I knew her daddy. He’d have needed a minute, seeing this.' };
  }
  const pool = STORY_RAIL_LINES[stopId]?.[event];
  if (!pool?.length) return null;
  return pool[facts.fired % pool.length]!;
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
  }
  return out;
}

export { storyStopById };
