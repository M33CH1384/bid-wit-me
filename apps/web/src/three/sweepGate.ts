/**
 * The collection gate (owner, 2026-10-30: "the hand gets collected before the
 * last card rests on the table" — still happening after the 2026-10-19/20
 * `!pause` state gate, e41d046).
 *
 * Why a state gate was not enough: the two clocks disagree. Collection is
 * requested on a WALL clock — the finished-trick hold (TRICK_HOLD_MS /
 * HAND_END_REVEAL_MS via finishedTrickHoldMs) starts when the completing
 * state is applied. A played card's flight runs on a FRAME clock — Card3D
 * advances its tween by min(rawDt, 50 ms) per frame — so on a starved canvas
 * (heavy room, figures, effects at hand end; anything under ~20 fps) the
 * flight takes proportionally longer in wall time than its nominal duration,
 * and at fast table speed the nominal margin is only ~75 ms to begin with.
 * A staggered auto-play (delay 0.35 + 0.12 × order, then a 500 ms flight =
 * up to 1210 ms) overruns both holds with no starvation at all. The sweep
 * then retargets the card mid-flight: it is gathered off the felt while
 * still visibly travelling / skidding into its spot. dealFlight.ts's
 * dealHoldStale notes document the same wall-vs-frame disagreement.
 *
 * The fix is per-card and clock-free: a collection retarget never interrupts
 * a play flight. Card3D holds the sweep as pending and adopts it on the very
 * frame the play tween completes — the same frame clock that flew the card
 * decides when it has rested, so the two can never disagree, on any device,
 * at any frame rate, at any table speed. On a healthy device the play has
 * been resting for hundreds of ms before any sweep is requested, the gate
 * never engages, and behaviour is exactly as before. No hold, duration or
 * beat is retimed; the sweep of THAT card simply starts at its rest.
 *
 * A "collection" retarget is any Scene item with sfxStart 'sweep': the
 * mid-hand pile gather, the post-hand book collection to the next dealer,
 * the misdeal redeal gather and the deal backs returning to the deck.
 */

import type { FlightVariant } from './flightPose';

/** Motions a played card flies to the trick with (playFlightPose's family). */
export const PLAY_FLIGHT_MOTIONS: ReadonlySet<string> = new Set(['flight', 'glide', 'flick', 'slide']);

/** The sfxStart every collection item carries (Scene builds all four with it). */
export const SWEEP_SFX_START = 'sweep';

export interface SweepGateState {
  /** sfxStart of the incoming item ('sweep' marks a collection move). */
  incomingSfxStart?: string | null;
  /** Pose key of the tween currently running ('' before the first tween). */
  currentKey: string;
  /** Progress of the current tween, 0..1 (1 = fully rested at its target). */
  currentT: number;
  /** Motion the current tween was adopted with (its own snapshot, not the live prop). */
  currentMotion: string;
  /** The current tween is itself a collection move. */
  currentIsSweep: boolean;
}

/**
 * Must the incoming collection wait for the current flight to rest?
 * True only when a sweep arrives while this card is still flying a PLAY
 * flight. A resting card (t >= 1), a card whose current move is itself a
 * sweep (pile gather → dealer collection retargets freely, as before), a
 * hand-internal 'lift', and any non-sweep retarget all pass through.
 */
export function sweepMustWait(o: SweepGateState): boolean {
  if (o.incomingSfxStart !== SWEEP_SFX_START) return false;
  if (!o.currentKey || o.currentT >= 1) return false;
  if (o.currentIsSweep) return false;
  return PLAY_FLIGHT_MOTIONS.has(o.currentMotion);
}

/** A held collection move, adopted by Card3D on the frame its play flight rests. */
export interface PendingSweep<T> {
  /** Pose key of the held item (a newer sweep replaces an older held one). */
  key: string;
  target: T;
  /** Wait (seconds of tween time) the sweep keeps once adopted — its own delay. */
  wait: number;
  land?: string;
  motion: string;
  arc: number;
  variant?: FlightVariant;
  duration: number;
}

/** The frame a held sweep is adopted: the play tween has reached rest. */
export function pendingSweepDue(pending: PendingSweep<unknown> | null, currentT: number): boolean {
  return pending !== null && currentT >= 1;
}

/**
 * Review-hold anchoring + next-trick serialization (owner, 2026-10-30, the
 * follow-up report on the fix above): the gate stopped the sweep from
 * interrupting a flight, but the REVIEW the hold was bought for still was
 * not happening — and the next trick could start under the sweep.
 *
 * Two facts from the audit:
 *  - The finished-trick hold (finishedTrickHoldMs: TRICK_HOLD_MS /
 *    HAND_END_REVEAL_MS, speed-scaled) runs on the hooks' WALL clock from
 *    the moment the completing state is applied, so the last card's ~500 ms
 *    flight CONSUMES it: the completed trick actually sits reviewable for
 *    ~650 ms at normal speed and ~75 ms at fast speed (k=0.5) — "as soon
 *    as it hits the table, the cards are being collected into a book".
 *  - Nothing serialized the next trick behind the sweep: at pause release
 *    the state has already advanced, so trick N+1's first play flight can
 *    begin — and land — while trick N's cards are still being gathered
 *    (TRICK_SWEEP_MS 550 on the frame clock).
 *
 * Both fixes live on the frame clock Scene and Card3D already share (the
 * dealClock idiom: capped-dt accumulation, identical on every client that
 * renders the same plays):
 *  - Scene stamps each play's predicted rest (item build frame + delay +
 *    duration) and, when the trick flips into the piles, delays the gather
 *    so it starts at LAST rest + the hold — the hold's nominal value is
 *    unchanged; it finally measures what it was always supposed to
 *    measure: the completed trick sitting on the table, reviewable.
 *  - The same computation yields the sweep's end frame; Scene floors the
 *    next trick's play delays at that end, so no play flight of trick N+1
 *    starts before trick N's collection has finished.
 * A held (pending) sweep's wait is a schedule offset on this same clock:
 * Card3D elapses it while the play flight finishes, so when the gate
 * adopts the sweep at rest, only the remainder of the review hold is left
 * to wait — the two paths agree on the same start frame.
 * (Rendered tolerance: a flight quantizes up in whole frames — stagger
 * wait ceil + tween ceil — so measured from the ACTUAL rest frame the
 * review can sit up to ~2 capped frames inside the nominal hold. That
 * is the frame tolerance the whole timing system runs on, against the
 * 500-1075 ms the wall clock used to eat.)
 */

/** Frame-clock second at which a play built at `builtAtFrameSec` comes to rest. */
export function playRestFrameSec(builtAtFrameSec: number, delaySec: number, durationSec: number): number {
  return builtAtFrameSec + delaySec + durationSec;
}

/** The last rest of a completed trick, or null when no play's rest is known (e.g. a resumed table). */
export function lastRestFrameSec(rests: readonly (number | undefined)[]): number | null {
  let last: number | null = null;
  for (const r of rests) if (r !== undefined && (last === null || r > last)) last = r;
  return last;
}

/**
 * Delay (frame-clock seconds, >= 0) Scene puts on a just-completed trick's
 * gather items so the sweep starts exactly at last rest + the review hold.
 * Null last rest (resume) or an already-expired hold means no added delay:
 * today's behaviour, with the gate above still guarding mid-flight cards.
 */
export function reviewDelaySec(o: { lastRestFrameSec: number | null; holdSec: number; nowFrameSec: number }): number {
  if (o.lastRestFrameSec === null) return 0;
  return Math.max(0, o.lastRestFrameSec + o.holdSec - o.nowFrameSec);
}

/** Frame-clock second at which a sweep that starts at `startFrameSec` has fully collected. */
export function sweepEndFrameSec(startFrameSec: number, sweepDurationSec: number): number {
  return startFrameSec + sweepDurationSec;
}

/**
 * One capped frame of schedule slack for the serialization floor. A
 * Card3D wait counts down in whole frames, so a sweep's motion can begin
 * up to one frame after its planned start; flooring the next play at
 * planned-end + this slack keeps "no flight before the sweep completes"
 * true on the rendered frames, not just on the plan. 50 ms is the frame
 * clock's own cap — the same quantum dealClock already tolerates.
 */
export const SEQUENCE_FRAME_SLACK_SEC = 0.05;

/**
 * A play flight's effective delay once the previous trick's sweep is taken
 * into account: the flight never starts before the sweep's end frame.
 * Input prompts, turn timers and game state are untouched — only the
 * flight's start waits, exactly like the auto-play stagger already does.
 */
export function serializedPlayDelaySec(o: { itemDelaySec?: number; sweepEndFrameSec: number; nowFrameSec: number }): number {
  return Math.max(o.itemDelaySec ?? 0, o.sweepEndFrameSec - o.nowFrameSec, 0);
}

/**
 * Bot pacing composition (owner, 2026-10-30: "the bots all seem to throw
 * out cards at the exact same time"). The serialization floor above moves
 * a flight without moving the state clock that schedules the NEXT bot, so
 * a floored first card of a trick could be followed almost immediately by
 * the second bot's card — both in the air together, every trick. The
 * schedulers (useGame solo/story, the server room online) now vary each
 * bot's wait with a seeded draw (rules/pacing.ts); this is the same draw
 * re-asserted on the frame clock as a minimum spacing between the
 * previous play's flight START and this bot play's: when nothing held the
 * previous flight back, the state clock already waited the full draw and
 * the term never binds; when the sweep floor shifted it, the spacing is
 * measured from the shifted start, so the rhythm resets after the hold
 * instead of compressing. Human-seat plays never take this term — their
 * timing is the player's own.
 */
export function spacedPlayDelaySec(o: { itemDelaySec?: number; sweepEndFrameSec: number; prevStartFrameSec?: number | null; spacingSec?: number | null; nowFrameSec: number }): number {
  let d = serializedPlayDelaySec(o);
  if (o.prevStartFrameSec != null && o.spacingSec != null) {
    d = Math.max(d, o.prevStartFrameSec + o.spacingSec - o.nowFrameSec, 0);
  }
  return d;
}
