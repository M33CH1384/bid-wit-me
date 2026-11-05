/**
 * Perf round 3 (owner device report 2026-11-05: cold first open of the
 * day, Low Power Mode on — froze at the HAND 3 RECAP; LPM off, still
 * slow. Production telemetry convicted the moment: the WebGL context was
 * LOST at phase handOver 44 s after scene-mount (Mansion, High), restored
 * 10 s later, and the web-content process died within the minute.)
 *
 * Two fixes, both pinned here:
 *  1. Scene rest: while a full-screen post-hand overlay (hand recap /
 *     results) covers the table, the persistent scene renders NOTHING —
 *     frameloop 'never', idle-life pulses gated — and resumes cleanly on
 *     Continue. Before this lane the demand loop kept rendering the full
 *     High scene at the settled pulse (one full render / 250 ms) under an
 *     opaque sheet, each frame composited through the modal-open CSS
 *     blur — invisible work, worst exactly when the phone has the least
 *     headroom.
 *  2. The adaptive effects governor: sustained measured frame overruns
 *     step decorative load down (pixel ratio → shadows → idle life) and
 *     back up with hysteresis. It cannot read the Low Power Mode switch
 *     (no web API exists) — it reacts to the slowness LPM causes, which
 *     also covers heat throttling and weaker phones. The manual quality
 *     setting is the ceiling: caps combine via Math.min, never above.
 *     A healthy 60 Hz (16.7 ms frames — including a ProMotion phone
 *     capped 120→60) never engages it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PerfGovernor, applyCaps, capsFor, MAX_LEVEL, OVERRUN_MS,
} from '../src/three/perfGovernor';
import {
  pulseDue, noteSceneActivity, setSceneCovered, setLifeHeld, resetFramePulseForTest,
} from '../src/three/framePulse';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

/** Feed `n` frames of `delta` ms, advancing the governor's clock by the
 *  same deltas (a monotonic performance.now stand-in). */
function feed(g: PerfGovernor, n: number, delta: number, startNow: number): number {
  let now = startNow;
  for (let i = 0; i < n; i++) { now += delta; g.sample(delta, now); }
  return now;
}

describe('perf governor — engagement', () => {
  it('never engages on a healthy 60 Hz stream', () => {
    const g = new PerfGovernor();
    feed(g, 900, 16.7, 0);
    expect(g.level).toBe(0);
  });

  it('never engages on a 120 Hz stream (ProMotion headroom)', () => {
    const g = new PerfGovernor();
    feed(g, 900, 8.3, 0);
    expect(g.level).toBe(0);
  });

  it('ignores a short bad burst (a hitch is not sustained slowness)', () => {
    const g = new PerfGovernor();
    let now = feed(g, 120, 16.7, 0);
    now = feed(g, 45, 33, now);
    now = feed(g, 300, 16.7, now);
    expect(g.level).toBe(0);
  });

  it('steps down one level at a time under sustained overruns, dwell respected', () => {
    const g = new PerfGovernor();
    let now = feed(g, 100, 33, 0);
    expect(g.level).toBe(0); // window/accumulation still filling
    now = feed(g, 120, 33, now);
    expect(g.level).toBe(1); // ~3 s of sustained bad frames
    now = feed(g, 130, 33, now);
    expect(g.level).toBe(2); // dwell (5 s) gates the next step
    now = feed(g, 200, 33, now);
    expect(g.level).toBe(MAX_LEVEL);
    now = feed(g, 400, 33, now);
    expect(g.level).toBe(MAX_LEVEL); // never past the deepest trim
  });

  it('steps back up one level at a time when headroom returns and stays', () => {
    const g = new PerfGovernor();
    let now = feed(g, 600, 33, 0);
    expect(g.level).toBe(MAX_LEVEL);
    now = feed(g, 200, 16.7, now);
    expect(g.level).toBe(MAX_LEVEL); // good time must SUSTAIN (6 s) first
    now = feed(g, 500, 16.7, now);
    expect(g.level).toBe(MAX_LEVEL - 1);
    now = feed(g, 900, 16.7, now);
    expect(g.level).toBeLessThan(MAX_LEVEL - 1);
    now = feed(g, 2000, 16.7, now);
    expect(g.level).toBe(0); // fully recovered, and never below 0
  });

  it('does not flap: alternating good/bad stretches hold the level', () => {
    const g = new PerfGovernor();
    let now = feed(g, 220, 33, 0);
    expect(g.level).toBe(1);
    // 2 s good, 2 s bad, repeated — neither sustains long enough to move.
    for (let k = 0; k < 4; k++) {
      now = feed(g, 120, 16.7, now);
      now = feed(g, 60, 33, now);
    }
    expect(g.level).toBe(1);
  });

  it('notifies on level change', () => {
    const g = new PerfGovernor();
    const seen: number[] = [];
    g.onLevelChange = (l) => seen.push(l);
    feed(g, 400, 33, 0);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toBe(1);
  });
});

describe('perf governor — caps respect the ceiling', () => {
  it('level 0 imposes no trim at all', () => {
    expect(applyCaps(1.75, 2048, 0)).toEqual({ dpr: 1.75, shadow: 2048, holdLife: false });
  });

  it('trims pixel ratio first, then shadows, then idle life', () => {
    expect(applyCaps(1.75, 2048, 1)).toEqual({ dpr: 1.5, shadow: 2048, holdLife: false });
    expect(applyCaps(1.75, 2048, 2)).toEqual({ dpr: 1.25, shadow: 1024, holdLife: false });
    expect(applyCaps(1.75, 2048, 3)).toEqual({ dpr: 1.0, shadow: 512, holdLife: true });
  });

  it('never raises above the manual ceiling (Low quality: dpr 1, shadows off)', () => {
    for (let level = 0; level <= MAX_LEVEL; level++) {
      const out = applyCaps(1, 0, level);
      expect(out.dpr).toBeLessThanOrEqual(1);
      expect(out.shadow).toBe(0);
    }
  });

  it('caps clamp out-of-range levels', () => {
    expect(capsFor(99)).toBe(capsFor(MAX_LEVEL));
    expect(capsFor(-1)).toBe(capsFor(0));
  });

  it('the overrun line sits well above a 60 Hz frame', () => {
    expect(OVERRUN_MS).toBeGreaterThan(16.7 * 1.4);
  });
});

describe('scene rest — pulse gate', () => {
  it('covered: no idle-life pulse passes, even inside the activity window', () => {
    resetFramePulseForTest();
    const t0 = 1_000_000;
    noteSceneActivity(t0);
    expect(pulseDue(t0 + 10)).toBe(true); // active table: pulses pass
    setSceneCovered(true);
    expect(pulseDue(t0 + 20)).toBe(false); // covered: the scene rests
    expect(pulseDue(t0 + 5000)).toBe(false); // still covered, still resting
    setSceneCovered(false);
    noteSceneActivity(t0 + 6000);
    expect(pulseDue(t0 + 6010)).toBe(true); // uncovered: life resumes
  });

  it('governor life-hold: pulses stop at the deepest trim, resume on release', () => {
    resetFramePulseForTest();
    const t0 = 2_000_000;
    noteSceneActivity(t0);
    setLifeHeld(true);
    expect(pulseDue(t0 + 10)).toBe(false);
    setLifeHeld(false);
    expect(pulseDue(t0 + 20)).toBe(true);
  });
});

describe('scene rest + governor — wiring pins', () => {
  it('Table publishes the covered flag from the two post-hand surfaces', () => {
    const table = src('Table.tsx');
    expect(table).toMatch(/covered:\s*showRecap \|\| showResults/);
  });

  it('Scene rests only once the load has settled (a cold resume into a recap still loads its table)', () => {
    const scene = src('three/Scene.tsx');
    expect(scene).toMatch(/const resting = !!props\.covered && !!props\.loadSettled/);
    expect(scene).toMatch(/frameloop=\{resting \? 'never' : 'demand'\}/);
  });

  it('Scene applies governor caps through Math.min against the ramp state', () => {
    const scene = src('three/Scene.tsx');
    expect(scene).toMatch(/applyCaps\(dprCap, shadowSize, govLevel\)/);
  });

  it('the census repairs its delivery: latest census rides every later report context', () => {
    const scene = src('three/Scene.tsx');
    expect(scene).toMatch(/setCrashContext\(\{ perf: perfCrumb\(census\) \}\)/);
  });

  it('the census publishes for the FIRST game of a scene mount, not only after a seed change', () => {
    // Round 2's gate initialised done=true with the seed ref pre-set to
    // the mount seed, so a session's first game never published at all —
    // the silent half of why no census ever reached the server.
    const scene = src('three/Scene.tsx');
    expect(scene).toMatch(/const censusDoneRef = useRef\(false\)/);
  });
});
