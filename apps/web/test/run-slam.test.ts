import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { impactFraction } from '../src/landTiming';
import { RUN_MEGA_DETONATE_MS, RUN_MEGA_TORNADO_AFTER_MS, RUN_TORNADO_AFTER_MS } from '../src/runIt';
import { playSeed, runScatter } from '../src/three/landing';
import { CH, CT, CW, flatRest, handFan, opponentFan, type Xform } from '../src/three/layout';
import {
  RUN_SLAM_DROP_T, RUN_SLAM_FLIGHT_SEC, RUN_SLAM_IMPACT_T, RUN_SLAM_MAX_STAGGER_SEC, RUN_SLAM_RAISE_END,
  runSlamPose, runSlamSchedule,
} from '../src/three/runSlamPose';
import {
  DISTURBANCE_HOP, DISTURBANCE_MS, DISTURBANCE_RADIUS, DISTURBANCE_SLIDE, disturbanceFor, disturbanceOffsetAt,
  lastSlamDisturbanceId, pushSlamDisturbance, resetSlamDisturbances, slamDisturbancesAfter,
} from '../src/three/slamDisturbance';

const ASPECT = 932 / 430;

/** Representative slam flights: the claimer's fan slot → its scatter rest. */
function slamPairs() {
  const drops = runScatter(playSeed('proof', 3, 99, 'runit:0'), 4);
  const to = drops.map((d, i) => flatRest(d.dx, d.dz, d.spin, 4 + i, 0.62));
  return {
    drops,
    pairs: [
      { from: handFan(ASPECT, 9, 4, 0), to: to[0]! }, // the human, mid-fan
      { from: opponentFan('left', 4, 2, 6), to: to[1]! }, // a side seat
      { from: opponentFan('top', 4, 1, 5), to: to[2]! }, // the partner across
      { from: opponentFan('right', 4, 0, 3), to: to[3]! },
    ],
  };
}

function lowestCorner(pose: Xform): number {
  const q = new Quaternion(...pose.q);
  let min = Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const c = new Vector3((sx * CW) / 2, (sy * CH) / 2, (sz * CT) / 2).multiplyScalar(pose.s).applyQuaternion(q);
    min = Math.min(min, pose.p[1] + c.y);
  }
  return min;
}

const close = (a: number, b: number, dp = 6) => expect(a).toBeCloseTo(b, dp);

describe("'Run it!' slam flight (runSlamPose)", () => {
  it('starts exactly at the fan slot and ends exactly on the scatter rest', () => {
    for (const { from, to } of slamPairs().pairs) {
      const p0 = runSlamPose(from, to, 0, { arc: 0.55 });
      const p1 = runSlamPose(from, to, 1, { arc: 0.55 });
      p0.p.forEach((v, i) => close(v, from.p[i]!));
      p1.p.forEach((v, i) => close(v, to.p[i]!));
      p0.q.forEach((v, i) => close(v, from.q[i]!, 5));
      p1.q.forEach((v, i) => close(v, to.q[i]!, 5));
      close(p1.s, to.s);
    }
  });

  it('beat 1 is a slow RAISE: the card climbs out of the hand, barely travelling', () => {
    // the retune split (owner 2026-11-01): the raise takes ~2/3 of the flight —
    // at least 0.6 s of the 0.9 s — so the lift reads deliberate
    expect(RUN_SLAM_RAISE_END).toBeGreaterThanOrEqual(0.65);
    expect(RUN_SLAM_RAISE_END).toBeLessThanOrEqual(0.70);
    expect(RUN_SLAM_RAISE_END * RUN_SLAM_FLIGHT_SEC).toBeGreaterThanOrEqual(0.6);
    for (const { from, to } of slamPairs().pairs) {
      const y = (t: number) => runSlamPose(from, to, t, { arc: 0.55 }).p[1];
      // monotone climb through the raise beat, ending well above both ends
      expect(y(0.15)).toBeGreaterThan(y(0));
      expect(y(0.3)).toBeGreaterThan(y(0.15));
      expect(y(RUN_SLAM_RAISE_END)).toBeGreaterThan(y(0.3));
      expect(y(RUN_SLAM_RAISE_END)).toBeGreaterThan(Math.max(from.p[1], to.p[1]) + 0.4);
      // horizontal drift during the raise stays a small share of the trip
      const mid = runSlamPose(from, to, RUN_SLAM_RAISE_END, { arc: 0.55 });
      const drift = Math.hypot(mid.p[0] - from.p[0], mid.p[2] - from.p[2]);
      const trip = Math.hypot(to.p[0] - from.p[0], to.p[2] - from.p[2]);
      expect(drift).toBeLessThanOrEqual(0.15 * trip + 1e-9);
      // and it levels as it rises: by the top of the raise it is most of the way to flat
      const qFrom = new Quaternion(...from.q);
      const qTop = new Quaternion(...mid.q);
      const qTo = new Quaternion(...to.q);
      expect(qTop.angleTo(qTo)).toBeLessThan(qFrom.angleTo(qTo) * 0.45);
    }
  });

  it('beat 2 falls ACCELERATING, strikes flat at the impact fraction, then rests', () => {
    for (const { from, to } of slamPairs().pairs) {
      const y = (t: number) => runSlamPose(from, to, t, { arc: 0.55 }).p[1];
      // descent per step grows as the strike approaches (gravity, not a glide) —
      // sampled inside the compressed fall (raise end → strike) by fall share w
      const tAt = (w: number) => RUN_SLAM_RAISE_END + w * (RUN_SLAM_IMPACT_T - RUN_SLAM_RAISE_END);
      const d1 = y(tAt(0.4)) - y(tAt(0.65));
      const d2 = y(tAt(0.65)) - y(tAt(0.9));
      expect(d2).toBeGreaterThan(d1);
      // the strike: exactly on the rest height at the impact fraction
      close(y(RUN_SLAM_IMPACT_T), to.p[1]);
      // settled: still exactly on the spot after the strike (the rebound is Card3D's, not the pose's)
      const after = runSlamPose(from, to, 0.97, { arc: 0.55 });
      after.p.forEach((v, i) => close(v, to.p[i]!));
      // dipped in the fall, flat AT the strike (the slap)
      const qTo = new Quaternion(...to.q);
      const falling = new Quaternion(...runSlamPose(from, to, 0.82, { arc: 0.55 }).q);
      const struck = new Quaternion(...runSlamPose(from, to, RUN_SLAM_IMPACT_T, { arc: 0.55 }).q);
      expect(falling.angleTo(qTo)).toBeGreaterThan(0.1);
      expect(struck.angleTo(qTo)).toBeLessThan(0.02);
    }
  });

  it('aggression shape: a hang at the crest, then a compressed, harder drop (owner 2026-11-02)', () => {
    // Owner verdict on the 0.85-arc build: "the run it slam isn't aggressive
    // enough." The arc did not move (0.85, pinned in the wiring block below);
    // beat 2 is now a HANG at the crest, then the whole fall inside ~0.11 s
    // on a steeper curve (drop exponent 3.4 → 4.8 in runSlamPose).
    // beat 2 (raise end → strike) is still at most a quarter of the flight…
    expect(RUN_SLAM_IMPACT_T - RUN_SLAM_RAISE_END).toBeLessThanOrEqual(0.25);
    // …but the drop proper is only its tail — the card hangs at the top first
    expect(RUN_SLAM_DROP_T).toBeGreaterThan(RUN_SLAM_RAISE_END);
    expect((RUN_SLAM_DROP_T - RUN_SLAM_RAISE_END) * RUN_SLAM_FLIGHT_SEC).toBeGreaterThanOrEqual(0.08); // ≥0.08 s hanging at the crest
    expect(RUN_SLAM_IMPACT_T - RUN_SLAM_DROP_T).toBeLessThanOrEqual(0.125);
    expect((RUN_SLAM_IMPACT_T - RUN_SLAM_DROP_T) * RUN_SLAM_FLIGHT_SEC).toBeLessThanOrEqual(0.12); // the fall proper: ≤0.12 s
    for (const { from, to } of slamPairs().pairs) {
      const y = (t: number) => runSlamPose(from, to, t, { arc: 0.55 }).p[1];
      const tAt = (w: number) => RUN_SLAM_RAISE_END + w * (RUN_SLAM_IMPACT_T - RUN_SLAM_RAISE_END);
      // measured across beat 2 (the 2026-11-01 pin's measure), the fall's
      // last fifth now carries ~90% of the height (was ~53%, pinned ≥45%)
      const total = y(RUN_SLAM_RAISE_END) - y(RUN_SLAM_IMPACT_T);
      const late = y(tAt(0.8)) - y(RUN_SLAM_IMPACT_T);
      expect(late).toBeGreaterThan(0.8 * total);
      // and the drop's OWN last fifth carries ~66% of the height (1 − 0.8^4.8)
      const tAtD = (w: number) => RUN_SLAM_DROP_T + w * (RUN_SLAM_IMPACT_T - RUN_SLAM_DROP_T);
      const totalD = y(RUN_SLAM_DROP_T) - y(RUN_SLAM_IMPACT_T);
      const lateD = y(tAtD(0.8)) - y(RUN_SLAM_IMPACT_T);
      expect(lateD).toBeGreaterThan(0.6 * totalD);
      // peak descent dwarfs the fall's mean — a plummet, not a glide.
      // Sampled on the real pose at this fixture height: peaks 42–134 u/s,
      // 8.8–16× the beat-2 mean (the 2026-11-01 pins were >2.5× and >6 u/s).
      let peak = 0;
      const N = 200;
      for (let i = 1; i <= N; i++) {
        const t0 = RUN_SLAM_RAISE_END + ((i - 1) / N) * (RUN_SLAM_IMPACT_T - RUN_SLAM_RAISE_END);
        const t1 = RUN_SLAM_RAISE_END + (i / N) * (RUN_SLAM_IMPACT_T - RUN_SLAM_RAISE_END);
        peak = Math.max(peak, (y(t0) - y(t1)) / ((t1 - t0) * RUN_SLAM_FLIGHT_SEC));
      }
      const mean = total / ((RUN_SLAM_IMPACT_T - RUN_SLAM_RAISE_END) * RUN_SLAM_FLIGHT_SEC);
      expect(peak).toBeGreaterThan(5 * mean);
      expect(peak).toBeGreaterThan(20); // world units/s at show scale
    }
  });

  it('no corner ever crosses the felt (or the scatter pile it lands on)', () => {
    for (const { from, to } of slamPairs().pairs) {
      let min = Infinity;
      for (let i = 0; i <= 300; i++) min = Math.min(min, lowestCorner(runSlamPose(from, to, i / 300, { arc: 0.55 })));
      expect(min).toBeGreaterThan(-0.001);
    }
  });

  it('the impact fraction landTiming fires on IS the pose strike', () => {
    expect(impactFraction('runslam')).toBe(RUN_SLAM_IMPACT_T);
    expect(RUN_SLAM_IMPACT_T).toBe(0.9);
  });

  it('the pose default (no explicit arc) raises to the retuned show height', () => {
    // Arc retune (owner 2026-11-02: "the arc for the run it animation is too
    // low"): 0.55 -> 0.85. Scene passes the same 0.85 explicitly (source pin
    // in the wiring block below); the default is what any arc-less caller
    // inherits, so the two are pinned to the same height here.
    for (const { from, to } of slamPairs().pairs) {
      const dist = new Vector3(...from.p).distanceTo(new Vector3(...to.p));
      const top = runSlamPose(from, to, RUN_SLAM_RAISE_END);
      close(top.p[1], Math.max(from.p[1], to.p[1]) + 0.85 * Math.min(1, dist), 4);
    }
  });
});

describe("'Run it!' slam schedule (runSlamSchedule)", () => {
  it('one shared flight; releases compressed so the strikes land as one blow', () => {
    for (let seed = 1; seed < 120; seed++) for (const k of [2, 3, 4, 6, 9]) {
      const drops = runScatter(seed, k);
      const plan = runSlamSchedule(drops);
      expect(plan).toHaveLength(k);
      plan.forEach((p, i) => {
        expect(p.duration).toBe(RUN_SLAM_FLIGHT_SEC);
        if (i) expect(p.delay).toBeGreaterThanOrEqual(plan[i - 1]!.delay); // scatter order preserved
      });
      expect(Math.max(...plan.map((p) => p.delay))).toBeLessThanOrEqual(RUN_SLAM_MAX_STAGGER_SEC + 1e-9);
      // the last strike (plus Scene's 0.02 s base) — one tight cluster
      const lastStrike = 0.02 + Math.max(...plan.map((p) => p.delay)) + RUN_SLAM_FLIGHT_SEC * RUN_SLAM_IMPACT_T;
      expect(lastStrike).toBeLessThanOrEqual(0.02 + RUN_SLAM_MAX_STAGGER_SEC + RUN_SLAM_FLIGHT_SEC * RUN_SLAM_IMPACT_T + 1e-9);
      expect(lastStrike).toBeLessThan(1.0);
    }
  });

  it('phase order: the disturbance fully settles before the tornado starts (both run kinds)', () => {
    const lastStrike = 0.02 + RUN_SLAM_MAX_STAGGER_SEC + RUN_SLAM_FLIGHT_SEC * RUN_SLAM_IMPACT_T;
    expect(lastStrike + DISTURBANCE_MS / 1000).toBeLessThan(RUN_TORNADO_AFTER_MS / 1000);
    expect(lastStrike + DISTURBANCE_MS / 1000).toBeLessThan(RUN_MEGA_TORNADO_AFTER_MS / 1000);
    // the flight itself also completes inside the pre-tornado window
    expect(0.02 + RUN_SLAM_MAX_STAGGER_SEC + RUN_SLAM_FLIGHT_SEC).toBeLessThan(RUN_TORNADO_AFTER_MS / 1000);
    // the strike did not move in the retune, so the mega detonation
    // (RUN_MEGA_DETONATE_MS, unmoved) still opens on the cluster's leading
    // edge: the first strike lands just after it, the cluster ends by 0.95 s
    const firstStrike = 0.02 + RUN_SLAM_FLIGHT_SEC * RUN_SLAM_IMPACT_T;
    expect(firstStrike).toBeGreaterThanOrEqual(RUN_MEGA_DETONATE_MS / 1000);
    expect(lastStrike).toBeLessThanOrEqual(0.95 + 1e-9);
  });
});

describe('slam disturbance model (slamDisturbance)', () => {
  it('reaches nothing beyond its radius; deterministic per seed', () => {
    expect(disturbanceFor(DISTURBANCE_RADIUS, 0, 7)).toBeNull();
    expect(disturbanceFor(DISTURBANCE_RADIUS + 0.5, 0, 7)).toBeNull();
    expect(disturbanceFor(0.4, 0.2, 7)).not.toBeNull();
    expect(disturbanceFor(0.4, 0.2, 7)).toEqual(disturbanceFor(0.4, 0.2, 7));
  });

  it('magnitude decays with distance from the strike', () => {
    for (const seed of [1, 7, 42, 99]) {
      const near = disturbanceFor(0.25, 0, seed)!;
      const mid = disturbanceFor(0.9, 0, seed)!;
      // the far sample sits at the rails (~1.85). The aggression retune
      // (2026-11-02) grew the radius 1.7 → 2.0, so the old 1.55 sample is
      // mid-field now and takes a real jolt by design; the property this
      // pin protects — the rails only shiver — is re-anchored at the
      // rail's true distance, not loosened (measured far mag ≤ 0.006).
      const far = disturbanceFor(1.85, 0, seed)!;
      expect(near.mag + near.hop).toBeGreaterThan(mid.mag + mid.hop);
      expect(mid.mag + mid.hop).toBeGreaterThan(far.mag + far.hop);
      expect(far.mag).toBeLessThan(0.02); // the rails only shiver
    }
  });

  it('aggression retune: the disturbance constants carry the harder jolt (owner 2026-11-02)', () => {
    expect(DISTURBANCE_RADIUS).toBe(2.0);
    expect(DISTURBANCE_SLIDE).toBe(0.14);
    expect(DISTURBANCE_HOP).toBe(0.1);
    // dead-on, the peaks stay well under a card length — a jolt, not a scatter
    for (const seed of [1, 7, 42, 99]) {
      const p = disturbanceFor(0, 0, seed)!;
      expect(p.mag).toBeLessThan(0.2);
      expect(p.hop).toBeLessThan(0.13);
    }
  });

  it('points away from the strike (radial, jitter aside)', () => {
    for (const seed of [3, 17]) {
      const p = disturbanceFor(0.5, 0, seed)!; // card due +x of the strike
      expect(p.dirX).toBeGreaterThan(0.8);
      const q = disturbanceFor(0, -0.5, seed)!; // card due −z
      expect(q.dirZ).toBeLessThan(-0.8);
    }
  });

  it('every envelope starts and ends at exactly zero — disturbed cards come home', () => {
    for (const seed of [5, 11, 23]) {
      const p = disturbanceFor(0.5, 0.3, seed)!;
      const start = disturbanceOffsetAt(p, 0)!;
      expect(Math.abs(start.x) + Math.abs(start.y) + Math.abs(start.z) + Math.abs(start.tilt)).toBe(0);
      expect(disturbanceOffsetAt(p, DISTURBANCE_MS)).toBeNull();
      expect(disturbanceOffsetAt(p, DISTURBANCE_MS + 50)).toBeNull();
      // a slide runs out then creeps home: late reach is a small share of peak
      const mid = disturbanceOffsetAt(p, DISTURBANCE_MS * 0.5)!;
      const late = disturbanceOffsetAt(p, DISTURBANCE_MS * 0.97)!;
      expect(Math.hypot(late.x, late.z)).toBeLessThan(Math.hypot(mid.x, mid.z) + 1e-9);
      if (p.mode === 'bounce') {
        const hop = disturbanceOffsetAt(p, DISTURBANCE_MS * 0.5)!;
        expect(hop.y).toBeGreaterThan(0.01); // it really leaves the felt
      }
    }
  });

  it('the bus watermarks like the deuce impact bus', () => {
    resetSlamDisturbances();
    expect(lastSlamDisturbanceId()).toBe(0);
    pushSlamDisturbance({ at: 100, x: 0.1, z: 0.2, source: 'AS', seed: 5 });
    pushSlamDisturbance({ at: 200, x: -0.2, z: 0.1, source: 'BJ', seed: 6 });
    expect(lastSlamDisturbanceId()).toBe(2);
    expect(slamDisturbancesAfter(0).map((e) => e.seed)).toEqual([5, 6]);
    expect(slamDisturbancesAfter(1).map((e) => e.seed)).toEqual([6]);
    expect(slamDisturbancesAfter(2)).toEqual([]);
    resetSlamDisturbances();
  });
});

describe("'Run it!' slam wiring (source pins)", () => {
  const scene = readFileSync(fileURLToPath(new URL('../src/three/Scene.tsx', import.meta.url)), 'utf8');
  const card3d = readFileSync(fileURLToPath(new URL('../src/three/Card3D.tsx', import.meta.url)), 'utf8');
  const table = readFileSync(fileURLToPath(new URL('../src/Table.tsx', import.meta.url)), 'utf8');

  it("the scatter flies the slam motion; the reduced path stays a plain slide", () => {
    expect(scene).toMatch(/motion: 'runslam'/);
    expect(scene).toMatch(/runSlamSchedule\(drops\)/);
    // the show arc is the retuned 0.85 (owner 2026-11-02: the 0.55 arc read too low)
    expect(scene).toMatch(/arc: 0\.85, motion: 'runslam'/);
    const reducedItem = scene.split('\n').find((l) => l.includes('RUN_SLAM_MS / 1000')) ?? '';
    expect(reducedItem).toMatch(/motion: 'slide'/);
    expect(reducedItem).not.toMatch(/runslam/);
  });

  it('the disturbance fires only from the full-show striking card, on its landing frame', () => {
    expect(card3d).toMatch(/land\.includes\('runSlam'\) && s\.motionSnap === 'runslam'/);
    expect(card3d).toMatch(/pushSlamDisturbance/);
  });

  it('the strike rebound starts AT the strike for the slam — nothing lifts the fall', () => {
    expect(card3d).toMatch(/import \{ RUN_SLAM_IMPACT_T, runSlamPose \}/);
    expect(card3d).toMatch(/s\.t > RUN_SLAM_IMPACT_T/);
  });

  it('the tornado phase is untouched: same trigger offset, same reduced mapping', () => {
    expect(table).toMatch(/RUN_TORNADO_AFTER_MS/);
    expect(table).toMatch(/reduced: fx\.reduced/);
  });
});
