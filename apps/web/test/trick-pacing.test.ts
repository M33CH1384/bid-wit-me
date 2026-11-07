/**
 * Trick pacing (owner, 2026-11-06 21:30 EST: the wait after winning a book
 * felt "a tad bit too long").
 *
 * The measured win→throw wait for an ordinary mid-hand trick is the review
 * hold (finishedTrickHoldMs, plain path) + the collection sweep
 * (TRICK_SWEEP_MS 550 + one frame of sequence slack 50) — the next lead's
 * flight is floored at the sweep's end (sweepGate). The trim takes
 * TRICK_PACING_TRIM_MS off the hold only: flight and collection times are
 * untouched, and the nuke / hand-end / Run It branches keep their designed
 * values byte-for-byte (the nuke branch is the c108c50f clearance gate's
 * minimum hold — owner-ruled, not pacing).
 */
import { describe, expect, it } from 'vitest';
import { HAND_END_REVEAL_MS, NUKE_ALLOWANCE_MS, TRICK_HOLD_MS } from '@spades/protocol';
import { finishedTrickHoldMs, RUN_SHOW_MS, TRICK_PACING_TRIM_MS, TRICK_SWEEP_MS } from '../src/trickTiming';
import { SEQUENCE_FRAME_SLACK_SEC } from '../src/three/sweepGate';

const SWEEP_MS = TRICK_SWEEP_MS + SEQUENCE_FRAME_SLACK_SEC * 1000;
/** The full win→throw wait: review hold + collection, from the last card's rest. */
const winToThrowMs = (speed: number) =>
  finishedTrickHoldMs({ speed, handEnding: false, run: false, nuke: null }) + SWEEP_MS;

describe('trick pacing trim (owner 2026-11-06)', () => {
  it('plain review hold sheds the trim, scaled by table speed', () => {
    expect(TRICK_PACING_TRIM_MS).toBe(350);
    expect(finishedTrickHoldMs({ speed: 1, handEnding: false, run: false, nuke: null }))
      .toBe(TRICK_HOLD_MS - TRICK_PACING_TRIM_MS);
    expect(finishedTrickHoldMs({ speed: 1, handEnding: false, run: false, nuke: null })).toBe(800);
    expect(finishedTrickHoldMs({ speed: 0.5, handEnding: false, run: false, nuke: null })).toBe(400);
  });

  it('win→throw totals land ~15–20% under the pre-trim 1750 / 1175', () => {
    expect(winToThrowMs(1)).toBe(1400); // −350 = −20.0% of 1750
    expect(winToThrowMs(0.5)).toBe(1000); // −175 = −14.9% of 1175 (fixed 600 ms collection dilutes the fast trim)
  });

  it('collection time is untouched', () => {
    expect(TRICK_SWEEP_MS).toBe(550);
    expect(SWEEP_MS).toBe(600);
  });

  it('nuke branch keeps the designed hold exactly (clearance gate minimum)', () => {
    expect(finishedTrickHoldMs({ speed: 1, handEnding: false, run: false, nuke: 'full' }))
      .toBe(TRICK_HOLD_MS + NUKE_ALLOWANCE_MS.full);
    expect(finishedTrickHoldMs({ speed: 1, handEnding: false, run: false, nuke: 'full' })).toBe(5150);
    expect(finishedTrickHoldMs({ speed: 1, handEnding: false, run: false, nuke: 'classic' }))
      .toBe(TRICK_HOLD_MS + NUKE_ALLOWANCE_MS.classic);
    expect(finishedTrickHoldMs({ speed: 1, handEnding: false, run: false, nuke: 'off' }))
      .toBe(TRICK_HOLD_MS + NUKE_ALLOWANCE_MS.off);
    expect(finishedTrickHoldMs({ speed: 0.5, handEnding: false, run: false, nuke: 'full' }))
      .toBe(Math.round(TRICK_HOLD_MS * 0.5) + NUKE_ALLOWANCE_MS.full);
    // hand-ending nukes take the same branch (score waits for the blast)
    expect(finishedTrickHoldMs({ speed: 1, handEnding: true, run: false, nuke: 'full' }))
      .toBe(TRICK_HOLD_MS + NUKE_ALLOWANCE_MS.full);
  });

  it('hand-end reveal and Run It holds are untouched', () => {
    expect(finishedTrickHoldMs({ speed: 1, handEnding: true, run: false, nuke: null })).toBe(HAND_END_REVEAL_MS);
    expect(finishedTrickHoldMs({ speed: 0.5, handEnding: true, run: false, nuke: null }))
      .toBe(Math.round(HAND_END_REVEAL_MS * 0.5));
    expect(finishedTrickHoldMs({ speed: 1, handEnding: false, run: true, nuke: null })).toBe(RUN_SHOW_MS);
  });
});
