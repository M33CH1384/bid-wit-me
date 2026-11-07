/**
 * Flight order (owner, 2026-11-06: "I won a book and before my card hit
 * the table they hit the run it. That's too fast.").
 *
 * Diagnosis: the only within-trick ordering the table had was the bot
 * pacing floor (spacedPlayDelaySec), which spaces a follow's flight start
 * from the previous flight's START by the seeded pace draw. Online the
 * draw's floor is 750 × 0.62 = 465 ms (last seat ×0.90 → 418.5 ms) and at
 * offline fast speed the scaled draw bottoms at 334.8 ms — both BELOW
 * the 500 ms play flight. Measured over 46,800 composed follows per
 * config (real botPaceDelayMs + spacedPlayDelaySec, as Scene composes
 * them): 9.2% of online follows and 32.0% of offline-fast follows started
 * before the previous card had landed (worst −81 ms online, −165 ms
 * fast); offline standard never did (its smallest draw, 669.6 ms, clears
 * the flight by ~170 ms). Chains compound it — every card leaving at
 * ~90% of the previous flight reads as one rush.
 *
 * The rule these pins enforce: cards land IN ORDER. A bot follow's
 * flight never starts before the previous card's rest + LANDING_BEAT_SEC,
 * whoever led — the human (the owner's case) or another bot. The pacing
 * draw still rules whenever it spaces wider, so the ordinary rhythm is
 * unchanged; the landing term only binds where the race existed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { botPaceDelayMs } from '@spades/rules';
import { LANDING_BEAT_SEC, spacedPlayDelaySec } from '../src/three/sweepGate';

const src = (p: string) => readFileSync(join(process.cwd(), 'apps/web', p), 'utf8');

const FLIGHT_S = 0.5; // standard play flight (Scene: duration 0.5)
const EPS = 1e-9;

/** Scene's bot-play composition, post-fix shape: spacing + landing floor. */
function botDelay(o: { prevStart: number | null; prevRest: number | null; spacingSec: number | null; now: number }): number {
  return spacedPlayDelaySec({
    itemDelaySec: 0,
    sweepEndFrameSec: 0,
    prevStartFrameSec: o.prevStart,
    spacingSec: o.spacingSec,
    prevRestFrameSec: o.prevRest,
    nowFrameSec: o.now,
  });
}

/**
 * One trick on the frame clock, arrivals cumulative over the scheduler's
 * draws (the online room's wall clock / the offline driver's speed-scaled
 * clock — both are turnStartedAt + draw). The leader's flight starts at 0;
 * each follow is built when its state arrives (or at the flush time, when
 * states batch) and stamped exactly as Scene stamps: start = build +
 * delay, rest = start + flight.
 */
function simulateTrick(o: { seed: string; baseMs: number; speedK: number; stateK: number; batchedAt?: number }): number[] {
  const starts: number[] = [0];
  let prevStart = 0;
  let prevRest = FLIGHT_S;
  let arrival = 0;
  for (let position = 1; position < 4; position++) {
    const drawMs = botPaceDelayMs({ seed: o.seed, handNo: 0, trickNo: 0, seat: position, position, playerCount: 4, kind: 'play', baseMs: o.baseMs });
    arrival += (drawMs * o.stateK) / 1000;
    const now = o.batchedAt ?? arrival;
    const delay = botDelay({ prevStart, prevRest, spacingSec: (drawMs * o.speedK) / 1000, now });
    const start = now + delay;
    starts.push(start);
    prevStart = start;
    prevRest = start + FLIGHT_S;
  }
  return starts;
}

function expectLandedInOrder(starts: number[]) {
  for (let i = 1; i < starts.length; i++) {
    const prevRest = starts[i - 1]! + FLIGHT_S;
    expect(starts[i]!, `play ${i} starts before play ${i - 1} has landed + the beat`).toBeGreaterThanOrEqual(prevRest + LANDING_BEAT_SEC - EPS);
  }
}

describe('flight order — a follow waits for the previous card to land', () => {
  it('pins the beat: LANDING_BEAT_SEC is the per-card rhythm step (0.12 s)', () => {
    expect(LANDING_BEAT_SEC).toBe(0.12);
  });

  it("the owner's online case at the draw's floor: last-seat minimum draw (418.5 ms) still waits out the flight + beat", () => {
    // leader (the human) starts at 0, rests at 0.5; the follow's state
    // arrives exactly at its spacing floor — pre-fix it flew at 0.4185,
    // 81.5 ms before the lead landed.
    const delay = botDelay({ prevStart: 0, prevRest: FLIGHT_S, spacingSec: 0.4185, now: 0.4185 });
    expect(0.4185 + delay).toBeCloseTo(FLIGHT_S + LANDING_BEAT_SEC, 9);
  });

  it('batched arrival (online states flush together): the whole trick still lands in order', () => {
    // all three follows are built in the pass that lands at 0.3 s — the
    // leader is still in the air. In-loop stamps chain the floors.
    const starts = simulateTrick({ seed: 'batch-seed', baseMs: 750, speedK: 1, stateK: 1, batchedAt: 0.3 });
    expectLandedInOrder(starts);
  });

  it('seed sweep, online (base 750): no follow ever jumps the landing', () => {
    for (let s = 0; s < 200; s++) {
      expectLandedInOrder(simulateTrick({ seed: `owner-online-${s}`, baseMs: 750, speedK: 1, stateK: 1 }));
    }
  });

  it('seed sweep, offline fast (base 1200, k=0.5): no follow ever jumps the landing', () => {
    for (let s = 0; s < 200; s++) {
      expectLandedInOrder(simulateTrick({ seed: `owner-fast-${s}`, baseMs: 1200, speedK: 0.5, stateK: 0.5 }));
    }
  });

  it('offline standard rhythm is untouched: where the draw spaces wider than rest + beat, the draw alone rules', () => {
    // smallest standard draw (last seat): 1200 × 0.62 × 0.90 = 669.6 ms >
    // 500 + 120 — the landing term must not add a millisecond.
    const withLanding = botDelay({ prevStart: 0, prevRest: FLIGHT_S, spacingSec: 0.6696, now: 0.3 });
    const spacingOnly = spacedPlayDelaySec({ itemDelaySec: 0, sweepEndFrameSec: 0, prevStartFrameSec: 0, spacingSec: 0.6696, nowFrameSec: 0.3 });
    expect(withLanding).toBe(spacingOnly);
    expect(0.3 + withLanding).toBeCloseTo(0.6696, 9);
  });

  it('no known previous rest (resume / never launched): behaviour is exactly the old spacing composition', () => {
    const withNull = botDelay({ prevStart: 0, prevRest: null, spacingSec: 0.4185, now: 0.4185 });
    const spacingOnly = spacedPlayDelaySec({ itemDelaySec: 0, sweepEndFrameSec: 0, prevStartFrameSec: 0, spacingSec: 0.4185, nowFrameSec: 0.4185 });
    expect(withNull).toBe(spacingOnly);
  });

  it('wiring: Scene passes the previous play\'s stamped rest into the bot-play delay', () => {
    const scene = src('src/three/Scene.tsx');
    expect(scene).toContain('prevRestFrameSec:');
    expect(scene).toContain('playRests.current.rests.get');
  });
});
