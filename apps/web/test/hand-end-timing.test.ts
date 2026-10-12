import { describe, expect, it } from 'vitest';
import {
  CARD_LAND_MS, HAND_END_AFTER_LAND_MS, HAND_END_BEAT_MS, HAND_END_HOLD_MS, HAND_END_REVEAL_MS,
  HYPE_SETTLE_MAX_MS, NUKE_ALLOWANCE_MS, RUN_FX_MS, TRICK_HOLD_MS, handEndLeadMs,
} from '@spades/protocol';
import { RUN_SHOW_MS, RUN_TORNADO_AFTER_MS, RUN_TORNADO_MS, RUN_ZOOM_MS } from '../src/runIt';
import { SCORE_TOAST_MS, TRICK_SWEEP_MS, finishedTrickHoldMs } from '../src/trickTiming';

/**
 * Old delay, normal speed, from the completing play (the card starts its 500 ms flight at the same moment):
 *   trick hold 1150
 * + scoring-toast gate 3200
 * + whenIdle beat 1200
 * = 5550 ms from the play, ~5050 ms after the card lands.
 * A Wheels / SHOT / streak popup could push the fx queue toward the 8000 ms cap before that beat.
 * The server padded the Table Talk countdown by HYPE_SETTLE_MAX_MS + 1200 = 9200 ms to match.
 * trickPauseMs (1300) never applied: the last trick is already handOver in that same state.
 * The 550 ms pile sweep starts when the hold ends; it does not add to the score delay.
 */
const OLD_CLIENT_MS = 1150 + 3200 + 1200;
const OLD_SERVER_HOLD_MS = 8000 + 1200;

describe('score screen after the last trick', () => {
  it('at normal speed opens 600–900 ms after the last card lands, with no toast or beat stacked on', () => {
    const hold = finishedTrickHoldMs({ speed: 1, handEnding: true, run: false, nuke: null });
    expect(hold).toBe(HAND_END_REVEAL_MS);
    expect(hold).toBe(CARD_LAND_MS + HAND_END_AFTER_LAND_MS);
    const afterLand = hold - CARD_LAND_MS;
    expect(afterLand).toBeGreaterThanOrEqual(600);
    expect(afterLand).toBeLessThanOrEqual(900);
    expect(hold).toBeLessThan(SCORE_TOAST_MS);
    expect(HAND_END_BEAT_MS).toBe(0);
    expect(hold + TRICK_SWEEP_MS).toBeLessThan(OLD_CLIENT_MS);
  });

  it('keeps the mid-hand trick hold, and still scales the hand-end beat with table speed', () => {
    expect(finishedTrickHoldMs({ speed: 1, handEnding: false, run: false, nuke: null })).toBe(TRICK_HOLD_MS);
    expect(finishedTrickHoldMs({ speed: 0.5, handEnding: false, run: false, nuke: null })).toBe(Math.round(TRICK_HOLD_MS * 0.5));
    // turbo (automated tests) stays short; the 600–900 window is the normal-speed beat
    expect(finishedTrickHoldMs({ speed: 0.03, handEnding: true, run: false, nuke: null })).toBe(Math.round(HAND_END_REVEAL_MS * 0.03));
    expect(finishedTrickHoldMs({ speed: 2.2, handEnding: true, run: false, nuke: null })).toBe(Math.round(HAND_END_REVEAL_MS * 2.2));
  });

  it('a final-trick nuke holds through the blast, then the score — the old toast beat is not added', () => {
    expect(finishedTrickHoldMs({ speed: 1, handEnding: true, run: false, nuke: 'full' })).toBe(TRICK_HOLD_MS + NUKE_ALLOWANCE_MS.full);
    expect(finishedTrickHoldMs({ speed: 1, handEnding: true, run: false, nuke: 'classic' })).toBe(TRICK_HOLD_MS + NUKE_ALLOWANCE_MS.classic);
    expect(finishedTrickHoldMs({ speed: 1, handEnding: true, run: false, nuke: 'off' })).toBe(TRICK_HOLD_MS + NUKE_ALLOWANCE_MS.off);
    expect(NUKE_ALLOWANCE_MS.full).toBeGreaterThanOrEqual(3600);
    // a run is the show even if the plays would also read as a nuke
    expect(finishedTrickHoldMs({ speed: 1, handEnding: true, run: true, nuke: 'full' })).toBe(RUN_SHOW_MS);
  });

  it('Run it! holds for the tornado show only, not the trick beat stacked on RUN_FX_MS', () => {
    expect(RUN_SHOW_MS).toBe(RUN_ZOOM_MS + RUN_TORNADO_AFTER_MS + RUN_TORNADO_MS);
    expect(finishedTrickHoldMs({ speed: 2.2, handEnding: true, run: true, nuke: null })).toBe(RUN_SHOW_MS);
    expect(RUN_SHOW_MS).toBeLessThan(RUN_FX_MS);
    expect(RUN_SHOW_MS).toBeLessThan(TRICK_HOLD_MS + RUN_FX_MS);
  });

  it('the server lead-in matches the screen and no longer pads 9.2 s of hype', () => {
    expect(HAND_END_HOLD_MS).toBe(HAND_END_REVEAL_MS);
    expect(HAND_END_HOLD_MS).toBeLessThan(OLD_SERVER_HOLD_MS);
    expect(HYPE_SETTLE_MAX_MS).toBe(8000); // still the cap on a single fx.hold, not the score delay
    expect(handEndLeadMs({ holdMs: HAND_END_HOLD_MS, run: false, nuke: null })).toBe(1200);
    expect(handEndLeadMs({ holdMs: HAND_END_HOLD_MS, run: true, nuke: 'full' })).toBe(RUN_FX_MS);
    expect(handEndLeadMs({ holdMs: HAND_END_HOLD_MS, run: false, nuke: 'full' })).toBe(HAND_END_HOLD_MS + NUKE_ALLOWANCE_MS.full);
    // tests that zero the hold stay fast, except a run still plays its show
    expect(handEndLeadMs({ holdMs: 0, run: false, nuke: 'full' })).toBe(0);
    expect(handEndLeadMs({ holdMs: 0, run: true, nuke: null })).toBe(RUN_FX_MS);
  });
});
