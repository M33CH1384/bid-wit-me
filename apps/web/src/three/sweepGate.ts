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
