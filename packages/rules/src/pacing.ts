/**
 * Bot turn pacing (owner, 2026-10-30: "the bots all seem to throw out cards
 * at the exact same time which isn't realistic").
 *
 * Until now every bot turn, on every layer, waited the layer's CONSTANT:
 * solo/story waited BOT_PLAY_MS (1200) on every play, online waited
 * timing.botMs (750) on every turn. State gaps inside a trick were exact
 * multiples of one number, the view layer adds no delay of its own to a
 * live bot play (Play.auto is a legacy flag the engine no longer sets), so
 * cards left bot hands on a metronome — and once the collection fixes
 * (2026-10-30) cleaned up the trick boundary, the first two plays of a
 * trick could be compressed together by the sweep floor, the following
 * bots' state clocks being independent of it.
 *
 * The fix keeps each layer's constant as the MEAN and draws the actual
 * wait per turn from a seeded band, so the pacing is varied but identical
 * on every client and in every replay: the draw key is the game's own
 * identity for the turn (game seed × hand × trick × kind × seat), the
 * same grain playSeed (three/landing.ts) uses for a play's toss. Each
 * scheduling layer passes its own base (solo play 1200, solo bid 650,
 * solo exchange 500, online timing.botMs), and the view layer re-asserts
 * the same draw as a minimum spacing between flight starts, so a hold or
 * sweep floor that shifts one flight shifts the next bot's flight by the
 * full intended gap instead of compressing it.
 *
 * The shapes are deliberately simple:
 *  - a play draws base × [0.62, 1.38] (uniform, mean exactly base);
 *  - the trick's leader thinks a touch longer (×1.10) and the last seat
 *    a touch less (×0.90) — across a full trick the two cancel, so the
 *    mean pace of a trick is unchanged at any player count;
 *  - a Joker already down in the trick stretches the next play (×1.25) —
 *    the whole table pauses when a Joker lands;
 *  - bids and exchanges draw a narrower band, base × [0.78, 1.22]:
 *    quicker, smaller decisions (their talk beats — consultation holds,
 *    pre-play lines — are added by the callers, unchanged).
 */

import { createRng } from './rng';

export type BotTurnKind = 'bid' | 'exchange' | 'play';

export interface BotPaceInput {
  /** The game's seed (GameState.seed) — the same seed the deals and tosses derive from. */
  seed: string;
  /** Hand number within the game (GameState.handNo). */
  handNo: number;
  /** Completed tricks before the current one (GameState.tricks.length; 0 while bidding). */
  trickNo: number;
  /** The seat whose turn it is. */
  seat: number;
  /** Plays already down in the current trick (0 = this seat leads it). Plays only. */
  position: number;
  /** Seats at the table; position playerCount − 1 is the last to act in the trick. */
  playerCount: number;
  kind: BotTurnKind;
  /** The scheduling layer's historical constant for this kind of turn, in ms. The draw's mean. */
  baseMs: number;
  /** A Joker is already down in the current trick (plays only): everyone takes a beat. */
  jokerDown?: boolean;
}

/** The seeded unit draw for one bot turn, in [0, 1). Pure; same inputs, same draw, everywhere. */
export function botPaceDraw(o: Pick<BotPaceInput, 'seed' | 'handNo' | 'trickNo' | 'seat' | 'kind'>): number {
  return createRng(`pace|${o.seed}|${o.handNo}|${o.trickNo}|${o.kind}|${o.seat}`).float();
}

/**
 * How long a bot waits before its turn lands, in ms — the caller's baseMs
 * on average, varied per turn by the seeded draw and the turn's shape.
 * Never negative; a non-positive base means the layer wants no wait at all
 * (test timings) and gets none.
 */
export function botPaceDelayMs(o: BotPaceInput): number {
  if (!(o.baseMs > 0)) return 0;
  const u = botPaceDraw(o);
  if (o.kind !== 'play') return Math.round(o.baseMs * (0.78 + 0.44 * u));
  let f = 0.62 + 0.76 * u;
  if (o.position <= 0) f *= 1.1;
  else if (o.position >= o.playerCount - 1) f *= 0.9;
  if (o.jokerDown) f *= 1.25;
  return Math.round(o.baseMs * f);
}
