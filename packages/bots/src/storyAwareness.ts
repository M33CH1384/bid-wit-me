/**
 * THE AWARENESS LAYER (co-op spec §7 — owner, 2026-10-22): a new pair
 * starts at the Porch mechanically, but nobody at these tables has
 * amnesia. Opponents know a player's PERSONAL history (their record at
 * the stop across solo + every pair track) and say so; Dee prices the
 * pair's untestedness in her awareness rundown; and once early in the
 * match she acknowledges the room's memory out loud (storyGuide's
 * guideAware pool), then it's spent.
 *
 * The facts are the smallest true ones that support the performance —
 * exactly the sanitized block the pair-context endpoint returns (§7.3):
 * per player, a handle + two booleans about THIS stop + a cleared-stop
 * count; plus the pair's own attempts/clears/doublePending at the stop.
 * No track keys, no other partners, no XP/coins ever reach this layer.
 *
 * Every line in this file is TEXT ONLY until the Phase 4 mini-bake —
 * the voice fence is absolute: no cast recording exists for them, so
 * no surface may voice them, and the Ringer's line is a stage
 * direction that is NEVER recorded (AWARENESS_NEVER_RECORD).
 */
import { STORY_STOPS, storyStopById } from './story';
import type { StoryBeat } from './storyScripts';

/** One player's sanitized awareness facts at a stop (pair-context shape). */
export interface PairContextPlayer {
  handle: string;
  /** personal attempts > 0 at this stop on ANY track */
  knowsStop: boolean;
  /** personal clears > 0 at this stop on ANY track */
  clearedStop: boolean;
  /** distinct stops personally cleared anywhere (flavor depth only) */
  clearedStops: number;
}

/** The pair-context block (spec §7.3) — what the server returns and
 *  what every awareness consumer reads. Nothing else crosses the wire. */
export interface PairContextFacts {
  players: [PairContextPlayer, PairContextPlayer];
  pair: { attempts: number; clears: number; doublePending: boolean };
}

/**
 * The trigger-matrix cases (spec §7.2), in precedence order:
 *  'finale' — the pair holds the King's double mark; the proposal owns
 *             the sit-down (Phase 4) and awareness variants are moot.
 *  'e'      — pair return: the pair itself has played this stop before.
 *  'b'      — known faces: pair is new here, at least one player knows
 *             the stop personally.
 *  'd'      — veteran + rookie: exactly one player cleared the stop
 *             while the other has never played it. (b)'s sharpened
 *             sub-case — same banks, named in the facts.
 *  'a'      — true first meet: neither player knows the stop.
 */
export type AwarenessCase = 'a' | 'b' | 'd' | 'e' | 'finale';

/** The facts the scene/tape selectors consume (merged into StoryBeatFacts). */
export interface AwarenessFacts {
  case: 'b' | 'd';
  /** the player the room knows (handle — Dee names names; the seated
   *  pair address them by role in scene context) */
  vetHandle: string;
  /** the player the room has never seen (case 'd' only) */
  rookieHandle?: string;
}

/** Select the awareness case for a sit-down at `stopId` from the
 *  pair-context facts. Pure — the server (room guide state), the
 *  story room client (tape + scene), and tests all read the same truth. */
export function awarenessCaseFor(stopId: string, ctx: PairContextFacts): AwarenessCase {
  const stop = storyStopById(stopId);
  if (stop?.doubleOrNothing && ctx.pair.doublePending) return 'finale';
  if (ctx.pair.attempts > 0) return 'e';
  const [p0, p1] = ctx.players;
  if (!p0.knowsStop && !p1.knowsStop) return 'a';
  const cleared = ctx.players.filter((p) => p.clearedStop);
  const neverPlayed = ctx.players.filter((p) => !p.knowsStop);
  if (cleared.length === 1 && neverPlayed.length === 1) return 'd';
  return 'b';
}

/** The AwarenessFacts for the scene/tape selectors, or null when the
 *  awareness variant does not fire (cases a / e / finale). */
export function awarenessFactsFor(stopId: string, ctx: PairContextFacts): AwarenessFacts | null {
  const c = awarenessCaseFor(stopId, ctx);
  if (c !== 'b' && c !== 'd') return null;
  const vet = ctx.players.find((p) => p.clearedStop) ?? ctx.players.find((p) => p.knowsStop)!;
  const rookie = c === 'd' ? ctx.players.find((p) => !p.knowsStop) : undefined;
  return { case: c, vetHandle: vet.handle, ...(rookie ? { rookieHandle: rookie.handle } : {}) };
}

/* =====================================================================
 * SEATED AWARENESS MEET LINES (spec §7.6, VERBATIM — two per stop, in
 * [pair0, pair1] order). They REPLACE the pair-first intro's meet opener
 * when case (b)/(d) fires (storyScripts.beatsFor). Church lines are
 * profanity-free; Corner/Pj's carry their stops' grit. The Ringer's is
 * a stage direction — text-only by design, FOREVER (never recorded).
 * ===================================================================== */

export const SEATED_AWARENESS_LINES: Record<string, [StoryBeat, StoryBeat]> = {
  'porch': [
    { speaker: 'uncleRay', line: 'Well now. Somebody done cleared my porch and came back with COMPANY.' },
    { speaker: 'pat', line: 'I remember your face, baby. Who’s your friend — they know how you play?' },
  ],
  'barbershop': [
    { speaker: 'mrColeman', line: 'I’ve cut your hair in that chair and cut your bids on this table. Brought a witness this time?' },
    { speaker: 'june', line: 'Mmhm. The returning act. And a new face for me to learn your tells from.' },
  ],
  'rec-center': [
    { speaker: 'lilMan', line: 'You BEAT us here before and brought backup?? That’s disrespectful. I love it.' },
    { speaker: 'trey', line: 'New teammate, same old you. We got the scouting report already!' },
  ],
  'cookout': [
    { speaker: 'keisha', line: 'Last time you was here you had Dee. Now you got a whole person? Growth.' },
    { speaker: 'teisha', line: 'We remember you, boo. Your partner’s new though — we gon’ learn them fast.' },
  ],
  'corner': [
    { speaker: 'smoke', line: 'You know this corner. Your people don’t. One of those facts matters tonight.' },
    { speaker: 'redd', line: 'Back again, AND you brought a friend to watch? Bold.' },
  ],
  'church-basement': [
    { speaker: 'deaconFord', line: 'You have sat at this table before, child. Your companion has not yet heard our lessons.' },
    { speaker: 'sisterMae', line: 'Welcome back. And welcome, new friend — we keep track of both kinds here.' },
  ],
  'rooftop': [
    { speaker: 'poet', line: 'The returning bird brings a new wing. The sky already has notes on you.' },
    { speaker: 'seven', line: '…I remember you.' },
  ],
  'high-rise': [
    { speaker: 'velvet', line: 'Your file here is… established. Your associate’s is blank. We will be correcting that.' },
    { speaker: 'accountant', line: 'Returning client. New co-signer. The risk profile just changed.' },
  ],
  'the-pjs': [
    { speaker: 'captainBlock', line: 'You ran this block before. Your partner’s about to learn what that cost.' },
    { speaker: 'brick', line: 'I don’t forget faces. That one’s new.' },
  ],
  'legends': [
    { speaker: 'queenie', line: 'You’ve eaten at this table, baby. Brought somebody hungry, I see.' },
    { speaker: 'ace', line: 'A veteran and a fresh wallet. My favorite seating chart.' },
  ],
  'king': [
    { speaker: 'king', line: 'You have stood in this room before. Your partner has not. One of you knows what that means.' },
    { speaker: 'ringer', line: '(The Ringer says nothing. He is looking at the new one.)' },
  ],
};

/** Lines that must NEVER enter a recording corpus: stage directions,
 *  not speech. The Ringer's awareness "line" is the standing example —
 *  his canon is silence, in the bake as much as at the table. */
export const AWARENESS_NEVER_RECORD: ReadonlySet<string> = new Set([
  '(The Ringer says nothing. He is looking at the new one.)',
]);

/** The two awareness meet beats for a stop (empty when none written). */
export function awarenessMeetBeats(stopId: string): StoryBeat[] {
  return SEATED_AWARENESS_LINES[stopId] ? [...SEATED_AWARENESS_LINES[stopId]!] : [];
}

/**
 * How many beats of the pair-first intro the awareness lines replace:
 * the meet opener = the leading run of beats spoken by the seated pair
 * before anyone else (Dee) speaks. Deterministic from the script —
 * porch 2, barbershop 2, rec 2, cookout 3, corner 3, church 3,
 * rooftop 1, high-rise 2, pj's 1, legends 1, king 1.
 */
export function awarenessOpenerLength(stopId: string, intro: readonly StoryBeat[]): number {
  const stop = storyStopById(stopId);
  if (!stop) return 0;
  let n = 0;
  while (n < intro.length && (stop.pair as readonly string[]).includes(intro[n]!.speaker)) n++;
  return n;
}

/** Static honesty checks for the awareness banks (tests + dev sanity):
 *  every stop has its two lines, spoken by the stop's pair in order,
 *  and the never-record set names only lines that exist. */
export function awarenessIssues(): string[] {
  const out: string[] = [];
  for (const stop of STORY_STOPS) {
    const lines = SEATED_AWARENESS_LINES[stop.id];
    if (!lines) { out.push(`${stop.id}: no awareness meet lines`); continue; }
    lines.forEach((beat, i) => {
      if (beat.speaker !== stop.pair[i]) out.push(`${stop.id}: awareness line ${i} is ${beat.speaker}, seated pair has ${stop.pair[i]}`);
    });
  }
  for (const line of AWARENESS_NEVER_RECORD) {
    const known = Object.values(SEATED_AWARENESS_LINES).some(([a, b]) => a.line === line || b.line === line);
    if (!known) out.push(`never-record line matches no awareness beat: ${line.slice(0, 40)}`);
  }
  return out;
}
