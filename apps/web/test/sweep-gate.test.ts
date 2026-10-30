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
import { PLAY_FLIGHT_MOTIONS, pendingSweepDue, sweepMustWait, type PendingSweep } from '../src/three/sweepGate';
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
});
