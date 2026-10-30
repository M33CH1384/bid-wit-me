/**
 * Collection gate regression (owner, 2026-10-30: "the hand gets collected
 * before the last card rests on the table" — recurring after e41d046).
 *
 * The state gate from 2026-10-19 (!pause) is intact; the recurrence is a
 * CLOCK disagreement. Collection is requested on a wall clock (the finished-
 * trick hold), a play flight advances on a frame clock (Card3D: at most
 * 50 ms of tween time per frame). Under frame starvation, at fast table
 * speed, or with a staggered auto-play, the wall clock expires while the
 * card is still flying / skidding. The gate in three/sweepGate.ts makes
 * Card3D hold the sweep until the flight's own clock says it rested.
 *
 * These tests pin: (1) the gate's truth table for every motion type,
 * (2) a simulated frame-clock trace — sweep never starts before rest at
 * any frame rate, and the trace is proven non-tame (without the gate the
 * same trace starts the sweep mid-flight), (3) the Scene <-> Card3D
 * contract the gate is keyed on.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLAY_FLIGHT_MOTIONS, SEQUENCE_FRAME_SLACK_SEC, lastRestFrameSec, pendingSweepDue, playRestFrameSec, reviewDelaySec, serializedPlayDelaySec, sweepEndFrameSec, sweepMustWait, type PendingSweep } from '../src/three/sweepGate';
import { finishedTrickHoldMs } from '../src/trickTiming';

const src = (p: string) => readFileSync(join(process.cwd(), 'apps/web', p), 'utf8');

/** Every way a played card can be in the air, with its flight duration (s). */
const PLAY_CASES: { name: string; motion: string; duration: number; wait?: number }[] = [
  { name: 'glide (physics landing)', motion: 'glide', duration: 0.5 },
  { name: 'flight — standard', motion: 'flight', duration: 0.5 },
  { name: 'flight — lob', motion: 'flight', duration: 0.5 },
  { name: 'flight — drive', motion: 'flight', duration: 0.5 },
  { name: 'flight — curve', motion: 'flight', duration: 0.5 },
  { name: 'flight — spinner', motion: 'flight', duration: 0.5 },
  { name: 'flick', motion: 'flick', duration: 0.5 },
  { name: 'slam / drag (slowest feel)', motion: 'flight', duration: 0.44 },
  { name: 'overcut', motion: 'flight', duration: 0.34 },
  { name: 'slide (reduced motion)', motion: 'slide', duration: 0.5 },
  { name: 'auto-play, last of a staggered trick', motion: 'flight', duration: 0.5, wait: 0.71 },
];

describe('the gate truth table', () => {
  it('every play-flight motion is protected mid-flight', () => {
    for (const m of PLAY_FLIGHT_MOTIONS) {
      expect(sweepMustWait({ incomingSfxStart: 'sweep', currentKey: 'k', currentT: 0.5, currentMotion: m, currentIsSweep: false }), m).toBe(true);
      // still protected a hair before rest — the skid tail is visible motion
      expect(sweepMustWait({ incomingSfxStart: 'sweep', currentKey: 'k', currentT: 0.99, currentMotion: m, currentIsSweep: false }), m).toBe(true);
    }
  });

  it('a rested card is swept immediately (healthy behaviour unchanged)', () => {
    for (const m of PLAY_FLIGHT_MOTIONS) {
      expect(sweepMustWait({ incomingSfxStart: 'sweep', currentKey: 'k', currentT: 1, currentMotion: m, currentIsSweep: false }), m).toBe(false);
    }
  });

  it('a sweep never waits on another sweep (pile gather -> dealer collection retargets freely)', () => {
    expect(sweepMustWait({ incomingSfxStart: 'sweep', currentKey: 'k', currentT: 0.5, currentMotion: 'gather', currentIsSweep: true })).toBe(false);
    expect(sweepMustWait({ incomingSfxStart: 'sweep', currentKey: 'k', currentT: 0.5, currentMotion: 'glide', currentIsSweep: true })).toBe(false);
  });

  it('non-sweep retargets and non-play motions are never gated', () => {
    expect(sweepMustWait({ incomingSfxStart: undefined, currentKey: 'k', currentT: 0.5, currentMotion: 'flight', currentIsSweep: false })).toBe(false);
    expect(sweepMustWait({ incomingSfxStart: 'deal', currentKey: 'k', currentT: 0.5, currentMotion: 'flight', currentIsSweep: false })).toBe(false);
    expect(sweepMustWait({ incomingSfxStart: 'sweep', currentKey: 'k', currentT: 0.5, currentMotion: 'lift', currentIsSweep: false })).toBe(false);
    expect(sweepMustWait({ incomingSfxStart: 'sweep', currentKey: 'k', currentT: 0.5, currentMotion: 'gather', currentIsSweep: false })).toBe(false);
    // no tween yet (fresh mount): nothing to protect
    expect(sweepMustWait({ incomingSfxStart: 'sweep', currentKey: '', currentT: 0, currentMotion: 'flight', currentIsSweep: false })).toBe(false);
  });

  it('a held sweep falls due exactly at rest', () => {
    const pend = { key: 'p', target: null, wait: 0, motion: 'gather', arc: 0.15, duration: 0.55 } as PendingSweep<null>;
    expect(pendingSweepDue(pend, 0.999)).toBe(false);
    expect(pendingSweepDue(pend, 1)).toBe(true);
    expect(pendingSweepDue(null, 1)).toBe(false);
  });
});

/**
 * Simulate one card exactly the way Card3D flies it: per frame the tween
 * wait and progress advance by min(frameMs, 50 ms). The sweep is requested
 * on the wall clock at `holdMs` (the finished-trick hold expiring). Returns
 * the wall time the card rests and the wall time the sweep starts, with and
 * without the gate.
 */
function traceFlight(o: { fps: number; duration: number; wait?: number; holdMs: number; motion: string }) {
  const frameMs = 1000 / o.fps;
  let wall = 0;
  let wait = o.wait ?? 0;
  let t = 0;
  let restWall: number | null = null;
  let sweepWall: number | null = null;
  let pending: PendingSweep<null> | null = null;
  let sweepRequested = false;
  for (let frame = 0; frame < 100000 && sweepWall === null; frame++) {
    wall += frameMs;
    const dt = Math.min(frameMs, 50) / 1000;
    if (!sweepRequested && wall >= o.holdMs) {
      sweepRequested = true;
      // the retarget arrives: without the gate it is adopted this instant
      if (!sweepMustWait({ incomingSfxStart: 'sweep', currentKey: 'play', currentT: t, currentMotion: o.motion, currentIsSweep: false })) {
        sweepWall = wall;
        break;
      }
      pending = { key: 'pile', target: null, wait: 0, motion: 'gather', arc: 0.15, duration: 0.55 };
    }
    if (wait > 0) { wait -= dt; continue; }
    if (t < 1) {
      t = Math.min(1, t + dt / o.duration);
      if (t >= 1) restWall = wall;
    }
    if (pendingSweepDue(pending, t)) sweepWall = wall;
  }
  return { restWall, sweepWall };
}

describe('collection never starts before the last card rests (frame-clock trace)', () => {
  const MID_HAND = finishedTrickHoldMs({ speed: 1, handEnding: false, run: false, nuke: null });
  const HAND_END = finishedTrickHoldMs({ speed: 1, handEnding: true, run: false, nuke: null });
  const FAST_MID = finishedTrickHoldMs({ speed: 0.5, handEnding: false, run: false, nuke: null });

  it('the holds alone cannot cover every flight — the gate is the guarantee, not the hold', () => {
    // staggered auto-play: 0.71 s wait + 0.5 s flight = 1.21 s > both holds at speed 1
    expect(0.71 + 0.5).toBeGreaterThan(HAND_END / 1000);
    expect(0.71 + 0.5).toBeGreaterThan(MID_HAND / 1000);
  });

  for (const fps of [60, 30, 20, 10, 7, 5]) {
    for (const c of PLAY_CASES) {
      for (const [label, holdMs] of [['mid-hand', MID_HAND], ['hand-end', HAND_END], ['fast mid-hand', FAST_MID]] as const) {
        it(`${c.name} @ ${fps}fps, ${label}: sweep starts at or after rest`, () => {
          const { restWall, sweepWall } = traceFlight({ fps, duration: c.duration, wait: c.wait, holdMs, motion: c.motion });
          expect(restWall, 'card rests').not.toBeNull();
          expect(sweepWall, 'sweep starts').not.toBeNull();
          expect(sweepWall!).toBeGreaterThanOrEqual(restWall!);
        });
      }
    }
  }

  it('the trace is not tame: without the gate these cases sweep mid-flight', () => {
    // 7 fps starved canvas, ordinary 500 ms flight, mid-hand hold: the wall
    // clock expires ~2.86 frame-stretched seconds before the card rests.
    const frameMs = 1000 / 7;
    const stretchedRest = (0.5 / (Math.min(frameMs, 50) / 1000)) * frameMs;
    expect(stretchedRest).toBeGreaterThan(MID_HAND);
    // fast speed leaves only ~75 ms of nominal margin for the same flight
    expect(FAST_MID - 500).toBeLessThan(100);
  });

  it('on a healthy device the gate never engages: sweep starts on the hold, as before', () => {
    const { restWall, sweepWall } = traceFlight({ fps: 60, duration: 0.5, holdMs: MID_HAND, motion: 'flight' });
    expect(restWall!).toBeLessThanOrEqual(500 + 2 * (1000 / 60)); // nominal 500 ms + float-accumulation slack of a frame
    expect(sweepWall!).toBeGreaterThanOrEqual(MID_HAND);
    expect(sweepWall!).toBeLessThan(MID_HAND + 1000 / 60 + 1);
  });
});

describe('review anchoring: the hold runs from rest, not from state apply', () => {
  it('a play rests at build + delay + duration on the frame clock', () => {
    expect(playRestFrameSec(2, 0, 0.5)).toBe(2.5);
    expect(playRestFrameSec(2, 0.71, 0.5)).toBeCloseTo(3.21);
    expect(playRestFrameSec(0, 0.35, 0.34)).toBeCloseTo(0.69);
  });

  it('the last rest of a trick is the max of its plays; unknown plays are ignored, all-unknown is null', () => {
    expect(lastRestFrameSec([1.2, 1.65, 1.4, 1.5])).toBe(1.65);
    expect(lastRestFrameSec([undefined, 1.5, undefined])).toBe(1.5);
    expect(lastRestFrameSec([undefined, undefined])).toBeNull();
    expect(lastRestFrameSec([])).toBeNull();
  });

  it('the gather delay lands the sweep exactly at last rest + hold', () => {
    // healthy: card rested at 0.5, the wall hold expired at 1.15 — the flight
    // ate 500 ms of the old hold, so the anchored delay hands it back
    expect(reviewDelaySec({ lastRestFrameSec: 0.5, holdSec: 1.15, nowFrameSec: 1.15 })).toBeCloseTo(0.5);
    // fast speed: hold 0.575 — the old margin after rest was ~75 ms
    expect(reviewDelaySec({ lastRestFrameSec: 0.5, holdSec: 0.575, nowFrameSec: 0.575 })).toBeCloseTo(0.5);
    // hand end
    expect(reviewDelaySec({ lastRestFrameSec: 0.5, holdSec: 1.2, nowFrameSec: 1.2 })).toBeCloseTo(0.5);
    // staggered auto-play still flying at the flip (rest 1.21 > now 1.15):
    // the delay spans the remaining flight AND the full hold
    expect(reviewDelaySec({ lastRestFrameSec: 1.21, holdSec: 1.15, nowFrameSec: 1.15 })).toBeCloseTo(1.21);
  });

  it('no anchor without a known rest, and never a negative delay', () => {
    expect(reviewDelaySec({ lastRestFrameSec: null, holdSec: 1.15, nowFrameSec: 0.4 })).toBe(0);
    // a trick that rested long before the flip (e.g. its sweep was held by a
    // show) owes no extra wait once rest + hold is already past
    expect(reviewDelaySec({ lastRestFrameSec: 0.5, holdSec: 1.15, nowFrameSec: 3 })).toBe(0);
  });
});

describe('next-trick serialization: no play flight starts before the sweep ends', () => {
  it('the sweep end is start + its duration', () => {
    expect(sweepEndFrameSec(1.65, 0.55)).toBeCloseTo(2.2);
  });

  it('a play built while the sweep runs is floored at the sweep end', () => {
    // bot lead lands 0.3 s after the flip; the sweep ends at 2.2
    expect(serializedPlayDelaySec({ itemDelaySec: 0, sweepEndFrameSec: 2.2, nowFrameSec: 1.9 })).toBeCloseTo(0.3);
    // a play already in hand when the trick flipped waits the whole sweep out
    expect(serializedPlayDelaySec({ itemDelaySec: 0, sweepEndFrameSec: 2.2, nowFrameSec: 1.15 })).toBeCloseTo(1.05);
  });

  it('a later auto-play stagger wins over the floor, and after the sweep there is no floor', () => {
    expect(serializedPlayDelaySec({ itemDelaySec: 0.71, sweepEndFrameSec: 2.2, nowFrameSec: 2.1 })).toBeCloseTo(0.71);
    expect(serializedPlayDelaySec({ itemDelaySec: 0, sweepEndFrameSec: 2.2, nowFrameSec: 2.5 })).toBe(0);
    expect(serializedPlayDelaySec({ itemDelaySec: undefined, sweepEndFrameSec: 0, nowFrameSec: 1 })).toBe(0);
  });
});

/**
 * Simulate two tricks on the shared frame clock exactly the way Scene +
 * Card3D now run them (and, with `anchored: false`, the way they ran before
 * this fix — the non-tame control):
 *
 *  - the completing play is built at frame 0 with its stagger wait + flight;
 *    its rest is stamped build + wait + duration (Scene's prediction, the
 *    same capped-dt arithmetic Card3D flies on, so prediction == flight);
 *  - the hooks' wall-clock hold expires at `holdSec` of WALL time and the
 *    trick flips into the piles: Scene delays the gather to
 *    lastRest + holdSec (anchored) or not at all (before);
 *  - Card3D adopts the gather at the flip if the card has rested (its wait
 *    then elapses), else holds it pending — the wait elapsing on the same
 *    frame clock — and adopts it on the rest frame with the remainder;
 *  - the gather runs TRICK_SWEEP_MS of frame time;
 *  - the next trick's first play is built `nextPlayAfterFlipSec` of wall
 *    time after the flip (0 = the state already had it, online-style;
 *    0.6 x speed = a solo bot lead), its delay floored at the sweep end
 *    (anchored) or left alone (before).
 */
function traceTwoTricks(o: {
  fps: number;
  holdSec: number;
  playWaitSec: number;
  playDurationSec: number;
  nextPlayAfterFlipSec: number;
  anchored: boolean;
}) {
  const frameMs = 1000 / o.fps;
  const dt = Math.min(frameMs, 50) / 1000;
  const SWEEP_SEC = 0.55;
  const stampRest = playRestFrameSec(0, o.playWaitSec, o.playDurationSec);
  let wall = 0;
  let frame = 0;
  let wait = o.playWaitSec;
  let t = 0;
  let restFrame: number | null = null;
  let flipped = false;
  let pendWait: number | null = null; // held gather wait (adopted at rest)
  let gatherWait: number | null = null; // adopted gather wait (card rested)
  let sweepStart: number | null = null;
  let sweepEnd: number | null = null;
  let plannedSweepEnd: number | null = null; // known at the flip (Scene's pileSeq)
  let nextBuilt: number | null = null;
  let nextStart: number | null = null;
  for (let i = 0; i < 100000 && (sweepEnd === null || nextStart === null); i++) {
    wall += frameMs / 1000;
    frame += dt;
    // the completing play flies (wait first, then the tween)
    if (wait > 0) wait -= dt;
    else if (t < 1) {
      t = Math.min(1, t + dt / o.playDurationSec);
      if (t >= 1 && restFrame === null) restFrame = frame;
    }
    // the wall hold expires: the trick flips into the piles
    if (!flipped && wall >= o.holdSec) {
      flipped = true;
      const delay = o.anchored
        ? reviewDelaySec({ lastRestFrameSec: stampRest, holdSec: o.holdSec, nowFrameSec: frame })
        : 0;
      if (t >= 1) gatherWait = delay;
      else pendWait = delay;
      // Scene records the sweep's end frame in the same render that builds
      // the gather: anchored, the start is last rest + hold; before the
      // fix, the flip (or the rest, when the gate held it) + the sweep.
      plannedSweepEnd = o.anchored
        ? sweepEndFrameSec(stampRest + o.holdSec, SWEEP_SEC) + SEQUENCE_FRAME_SLACK_SEC
        : sweepEndFrameSec(t >= 1 ? frame : stampRest, SWEEP_SEC);
    }
    // a held gather's wait elapses on the frame clock while the flight finishes
    if (pendWait !== null && t < 1) pendWait = Math.max(0, pendWait - dt);
    if (pendWait !== null && t >= 1) { gatherWait = pendWait; pendWait = null; }
    // the adopted gather counts down, then the sweep runs
    if (gatherWait !== null) {
      if (gatherWait > 0) gatherWait -= dt;
      else if (sweepStart === null) {
        sweepStart = frame;
        sweepEnd = sweepEndFrameSec(frame, SWEEP_SEC);
      }
    }
    // the next trick's first play is built after the flip
    if (flipped && nextBuilt === null && wall >= o.holdSec + o.nextPlayAfterFlipSec) {
      nextBuilt = frame;
      const delay = o.anchored
        ? serializedPlayDelaySec({ itemDelaySec: 0, sweepEndFrameSec: plannedSweepEnd ?? frame, nowFrameSec: frame })
        : 0;
      nextStart = frame + delay;
    }
  }
  return { restFrame, stampRest, sweepStart, sweepEnd, nextBuilt, nextStart };
}

describe('two-trick frame-clock trace: review after rest, next flight behind the sweep', () => {
  const MID = finishedTrickHoldMs({ speed: 1, handEnding: false, run: false, nuke: null }) / 1000;
  const FAST = finishedTrickHoldMs({ speed: 0.5, handEnding: false, run: false, nuke: null }) / 1000;
  const HAND_END = finishedTrickHoldMs({ speed: 1, handEnding: true, run: false, nuke: null }) / 1000;
  const PLAYS = [
    { name: 'standard toss', wait: 0, dur: 0.5 },
    { name: 'flick', wait: 0, dur: 0.5 },
    { name: 'slam (slowest feel)', wait: 0, dur: 0.44 },
    { name: 'auto-play, last of a staggered trick', wait: 0.71, dur: 0.5 },
  ] as const;
  const NEXT = [
    { name: 'state already holds the next play (online)', after: 0 },
    { name: 'solo bot lead', after: 0.6 },
  ] as const;

  for (const fps of [60, 20, 7, 5]) {
    for (const [holdLabel, holdSec] of [['mid-hand', MID], ['fast mid-hand', FAST], ['hand-end', HAND_END]] as const) {
      for (const p of PLAYS) {
        for (const nx of NEXT) {
          it(`${p.name} @ ${fps}fps, ${holdLabel}, ${nx.name}: full review after rest, next flight serialized`, () => {
            const after = nx.after * (holdSec === FAST ? 0.5 : 1);
            const r = traceTwoTricks({ fps, holdSec, playWaitSec: p.wait, playDurationSec: p.dur, nextPlayAfterFlipSec: after, anchored: true });
            const frameSec = Math.min(1000 / fps, 50) / 1000;
            expect(r.restFrame, 'card rests').not.toBeNull();
            expect(r.sweepStart, 'sweep starts').not.toBeNull();
            expect(r.sweepEnd, 'sweep ends').not.toBeNull();
            expect(r.nextStart, 'next flight starts').not.toBeNull();
            // the review: sweep starts at last rest + the full hold. The
            // anchor is exact on the planned clock (upper bound); the
            // rendered start can sit up to two capped frames earlier
            // measured from the ACTUAL rest frame, because the flight
            // itself quantizes up in whole frames (stagger-wait ceil +
            // tween ceil) past the continuous prediction the anchor uses —
            // the same frame tolerance the whole timing system runs on,
            // against a pre-fix shortfall of 500-1075 ms.
            expect(r.sweepStart!).toBeGreaterThanOrEqual(r.restFrame! + holdSec - 2 * frameSec - 1e-9);
            expect(r.sweepStart!).toBeLessThanOrEqual(r.stampRest + holdSec + frameSec + 1e-9);
            // the gate's older guarantee still holds inside the new timing
            expect(r.sweepStart!).toBeGreaterThanOrEqual(r.restFrame!);
            // serialization: the next flight never begins before the sweep ends
            expect(r.nextStart!).toBeGreaterThanOrEqual(r.sweepEnd! - 1e-9);
          });
        }
      }
    }
  }

  it('the trace is not tame: before the fix the review collapses and the next card lands mid-sweep', () => {
    // fast table, ordinary toss: the old review after rest was ~75 ms
    const fast = traceTwoTricks({ fps: 60, holdSec: FAST, playWaitSec: 0, playDurationSec: 0.5, nextPlayAfterFlipSec: 0.3, anchored: false });
    expect(fast.sweepStart! - fast.restFrame!).toBeLessThan(0.1);
    // ...and the next bot lead, built 0.3 s after the flip, started its
    // flight while the previous trick was still being gathered
    expect(fast.nextStart!).toBeLessThan(fast.sweepEnd!);
    // staggered auto-play: the old sweep started the frame the card rested
    const stag = traceTwoTricks({ fps: 60, holdSec: MID, playWaitSec: 0.71, playDurationSec: 0.5, nextPlayAfterFlipSec: 0, anchored: false });
    expect(stag.sweepStart! - stag.restFrame!).toBeLessThan(0.05);
    // the anchored run of the same cases gives the full hold back
    const fixed = traceTwoTricks({ fps: 60, holdSec: FAST, playWaitSec: 0, playDurationSec: 0.5, nextPlayAfterFlipSec: 0.3, anchored: true });
    expect(fixed.sweepStart! - fixed.restFrame!).toBeCloseTo(FAST, 1);
    expect(fixed.nextStart!).toBeGreaterThanOrEqual(fixed.sweepEnd! - 1e-9);
  });
});

describe('the Scene <-> Card3D contract the gate is keyed on', () => {
  it('every collection item Scene builds carries the sweep cue', () => {
    const scene = src('src/three/Scene.tsx');
    // pile gather, post-hand dealer collection, deal backs, redeal gather
    expect(scene.match(/sfxStart: 'sweep'/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('Card3D consults the gate before adopting a retarget and adopts the held sweep at rest', () => {
    const card = src('src/three/Card3D.tsx');
    expect(card).toContain('sweepMustWait');
    expect(card).toContain('pendingSweepDue');
    expect(card).toContain('s.pending');
    // the flight in the air keeps its own adopted parameters, not the sweep's props
    expect(card).toContain('s.motionSnap = motion');
    expect(card).toContain('s.motionSnap = pend.motion');
  });

  it('a held sweep wait elapses on the frame clock while the flight finishes', () => {
    const card = src('src/three/Card3D.tsx');
    expect(card).toContain('s.pending.wait = Math.max(0, s.pending.wait - dt)');
  });
});

describe('the review-anchor contract (Scene + Table)', () => {
  it('Table hands Scene the plain finished-trick hold, computed by the same helper the hooks use', () => {
    const table = src('src/Table.tsx');
    expect(table).toContain('reviewHoldMs={finishedTrickHoldMs({');
  });

  it('Scene anchors the fresh pile gather to the last rest and serializes the next trick behind the sweep', () => {
    const scene = src('src/three/Scene.tsx');
    // rests are stamped at first show, on the frame clock
    expect(scene).toContain('playRestFrameSec(frameNow, playDelay, flight.duration)');
    // the fresh pile's sweep start is anchored via the review delay
    expect(scene).toContain('reviewDelaySec({');
    expect(scene).toContain('anchorStart');
    // the next trick's play delay is floored at the sweep's end frame
    expect(scene).toContain('serializedPlayDelaySec({');
    expect(scene).toContain('sweepEndFrameSec(frameNow, freshPileEnd)');
    // Run It and nuke tricks keep their own clocks: anchoring is plain-path only
    expect(scene).toContain('!isNukeTrick(newestPile.plays)');
  });
});
