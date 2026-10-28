import { describe, expect, it } from 'vitest';
import { FELT, RAIL, makeCamera } from '../src/three/layout';
import {
  ARMED_GLOW_RADIUS, CAP_COVER_MARGIN, CAP_FULL_S, CAP_PLANE_Y, CAP_SETTLE_SINK, CAP_SETTLE_WIDEN,
  CAP_START_S, DEBRIS_RAIN_Y, MEGA_CAP_FULL_S, MEGA_CAP_OVERSHOOT, MEGA_RING1_END, MEGA_RING2_END,
  MEGA_STAGE2_S, NUKE_MEGA_STAGE2_S, NUKE_PARTICLE_BASE, NUKE_RING_END, TABLE_EXTENT,
  armedEmberPulse, capCoverRadius, cloudCardCount, cloudCardPose, megaFrameBurst, nukeChoreography,
  nukeClockStalled, nukeProfile, particleBudget, pointOccludedByCap, whiteoutOpacity,
} from '../src/three/nukeVisual';
import { MEGA_LEN, NUKE_LEN } from '../src/three/Nuke3D';

/**
 * Wave A (rows 57–58): the nuke's mushroom cloud ENGULFS THE ENTIRE TABLE and
 * the mega bursts past the frame (§E.2 (a)). These tests pin the coverage
 * against the game's real cameras, both choreography timelines, the mega
 * burst envelope, the particle budgets, the silhouettes and the armed pulse.
 * The old cap was a lone torus — outer radius (0.42 + 0.25) × 2.6 ≈ 1.74 —
 * hollow in the middle, over a table whose half-diagonal is ≈ 2.61.
 */

const OLD_CAP_REACH = (0.42 + 0.25) * 2.6;

/** The ten framings: portrait / 9:16 / tablet / square / desktop × standing / sitting. */
const FRAMINGS: { aspect: number; view: 'standing' | 'sitting' }[] = [
  { aspect: 0.46, view: 'standing' }, { aspect: 0.46, view: 'sitting' },
  { aspect: 9 / 16, view: 'standing' }, { aspect: 9 / 16, view: 'sitting' },
  { aspect: 0.75, view: 'standing' }, { aspect: 0.75, view: 'sitting' },
  { aspect: 1, view: 'standing' }, { aspect: 1, view: 'sitting' },
  { aspect: 16 / 9, view: 'standing' }, { aspect: 16 / 9, view: 'sitting' },
];
const camPos = (aspect: number, view: 'standing' | 'sitting', short = false) => {
  const cam = makeCamera(aspect, short, view);
  return { x: cam.position.x, y: cam.position.y, z: cam.position.z };
};

/** A 13×13 grid over the whole felt + rail rectangle. */
function feltGrid() {
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      pts.push({ x: -TABLE_EXTENT.hx + (2 * TABLE_EXTENT.hx * i) / 12, z: -TABLE_EXTENT.hz + (2 * TABLE_EXTENT.hz * j) / 12 });
    }
  }
  return pts;
}

describe('table coverage — the engulf', () => {
  it('table extent derives from layout FELT + RAIL, and the old cap never covered it', () => {
    expect(TABLE_EXTENT.hx).toBe(FELT.hx + RAIL);
    expect(TABLE_EXTENT.hz).toBe(FELT.hz + RAIL);
    expect(TABLE_EXTENT.halfDiagonal).toBeCloseTo(2.61, 2);
    expect(OLD_CAP_REACH).toBeLessThan(TABLE_EXTENT.halfDiagonal);
  });

  it('capCoverRadius beats the true need by the margin in every framing', () => {
    for (const f of [...FRAMINGS, { aspect: 2.2, view: 'standing' as const }, { aspect: 2.2, view: 'sitting' as const }]) {
      const cam = f.aspect === 2.2 ? camPos(f.aspect, f.view, true) : camPos(f.aspect, f.view);
      const r = capCoverRadius(cam);
      // past the table's own half-diagonal on every camera, never absurd
      expect(r).toBeGreaterThan(TABLE_EXTENT.halfDiagonal);
      expect(r).toBeLessThan(3.2);
      // and it is exactly need × margin: at need (r / margin) a corner is just barely NOT covered
      const corner = { x: TABLE_EXTENT.hx, z: TABLE_EXTENT.hz };
      expect(pointOccludedByCap(cam, corner, r)).toBe(true);
      expect(CAP_COVER_MARGIN).toBe(1.07);
    }
  });

  it('every point of a 13×13 felt+rail grid is occluded at the shipped radius, in every framing', () => {
    for (const f of FRAMINGS) {
      const cam = camPos(f.aspect, f.view);
      const r = capCoverRadius(cam);
      for (const p of feltGrid()) {
        expect(pointOccludedByCap(cam, p, r)).toBe(true);
      }
    }
    // short-landscape framings too
    for (const view of ['standing', 'sitting'] as const) {
      const cam = camPos(2.2, view, true);
      const r = capCoverRadius(cam);
      for (const p of feltGrid()) expect(pointOccludedByCap(cam, p, r)).toBe(true);
    }
  });

  it('coverage fails at the old cap radius — the gap cannot silently return', () => {
    const cam = camPos(9 / 16, 'standing');
    const uncovered = feltGrid().filter((p) => !pointOccludedByCap(cam, p, OLD_CAP_REACH));
    expect(uncovered.length).toBeGreaterThan(0);
  });
});

describe('nuke choreography (3.6 s)', () => {
  const cover = 2.9;

  it('cap spreads from CAP_START and reaches FULL table coverage at CAP_FULL_S, then holds', () => {
    expect(nukeChoreography(CAP_START_S - 0.01, { coverRadius: cover }).capRadius).toBe(0);
    const mid = nukeChoreography(1.5, { coverRadius: cover });
    expect(mid.capRadius).toBeGreaterThan(0);
    expect(mid.capRadius).toBeLessThan(cover);
    expect(nukeChoreography(CAP_FULL_S, { coverRadius: cover }).capRadius).toBeCloseTo(cover, 6);
    // hold at full coverage until the settle begins (2.55 = len − 1.05)
    expect(nukeChoreography(2.3, { coverRadius: cover }).capRadius).toBeCloseTo(cover, 6);
    expect(nukeChoreography(2.55, { coverRadius: cover }).capRadius).toBeCloseTo(cover, 6);
    // coverage is an occlusion fact at full spread, from a real camera
    const cam = camPos(9 / 16, 'sitting');
    const live = nukeChoreography(CAP_FULL_S, { coverRadius: capCoverRadius(cam) });
    for (const p of feltGrid()) expect(pointOccludedByCap(cam, p, live.capRadius)).toBe(true);
  });

  it('settle: the cloud sinks 0.22, widens ×1.05, and cap alpha is exactly 0 at the end', () => {
    const full = nukeChoreography(CAP_FULL_S, { coverRadius: cover });
    const end = nukeChoreography(NUKE_LEN, { coverRadius: cover });
    expect(end.capAlpha).toBe(0);
    expect(full.capY).toBeCloseTo(CAP_PLANE_Y, 6);
    expect(end.capY).toBeCloseTo(CAP_PLANE_Y - CAP_SETTLE_SINK, 6);
    expect(end.capRadius).toBeCloseTo(cover * CAP_SETTLE_WIDEN, 6);
    expect(end.fade).toBe(0);
    // lengths are pinned: NUKE_LEN 3.6, MEGA_LEN 4.4
    expect(NUKE_LEN).toBe(3.6);
    expect(MEGA_LEN).toBe(4.4);
  });
});

describe('mega frame burst (§E.2 (a))', () => {
  const cover = 2.9;

  it('stage 2 lands at flash + 1.15 s (T 1.45); envelopes peak there and decay', () => {
    expect(NUKE_MEGA_STAGE2_S).toBe(1.15);
    expect(MEGA_STAGE2_S).toBeCloseTo(1.45, 9);
    expect(megaFrameBurst(MEGA_STAGE2_S - 0.01).active).toBe(false);
    const at = megaFrameBurst(MEGA_STAGE2_S + 0.001);
    expect(at.active).toBe(true);
    expect(at.env).toBeGreaterThan(0.99);
    expect(megaFrameBurst(MEGA_STAGE2_S + 1).env).toBeLessThan(at.env);
    expect(megaFrameBurst(MEGA_STAGE2_S + 1).env).toBeGreaterThan(0);
  });

  it('cap grows ×1.36 PAST the cover radius by 2.35 and stays there until the settle', () => {
    expect(nukeChoreography(MEGA_CAP_FULL_S, { mega: true, coverRadius: cover }).capRadius)
      .toBeCloseTo(cover * MEGA_CAP_OVERSHOOT, 6);
    expect(MEGA_CAP_OVERSHOOT).toBe(1.36);
    expect(nukeChoreography(3.0, { mega: true, coverRadius: cover }).capRadius)
      .toBeCloseTo(cover * MEGA_CAP_OVERSHOOT, 6);
    // a plain nuke never overshoots: at the same T it sits at the cover radius (× its own settle widen)
    expect(nukeChoreography(2.4, { coverRadius: cover }).capRadius).toBeCloseTo(cover, 6);
    const megaAt24 = nukeChoreography(2.4, { mega: true, coverRadius: cover }).capRadius;
    const nukeAt24 = nukeChoreography(2.4, { coverRadius: cover }).capRadius;
    expect(megaAt24 / nukeAt24).toBeCloseTo(MEGA_CAP_OVERSHOOT, 6);
  });

  it('rings: nuke 3.4, mega first ring 7.5, mega second ring 9.5 by T 2.65', () => {
    expect(NUKE_RING_END).toBe(3.4);
    expect(MEGA_RING1_END).toBe(7.5);
    expect(MEGA_RING2_END).toBe(9.5);
    // sample each ring's peak over its run
    const peak = (mega: boolean, which: 1 | 2) => {
      let m = 0;
      for (let T = 0; T <= 4.4; T += 0.01) {
        const c = nukeChoreography(T, { mega, coverRadius: cover });
        m = Math.max(m, which === 1 ? c.ringRadius : c.burst.ring2Radius);
      }
      return m;
    };
    expect(peak(false, 1)).toBeCloseTo(NUKE_RING_END, 1);
    expect(peak(true, 1)).toBeCloseTo(MEGA_RING1_END, 1);
    expect(peak(true, 2)).toBeCloseTo(MEGA_RING2_END, 1);
    expect(peak(false, 2)).toBe(0); // the nuke has no second ring
    expect(nukeChoreography(2.65, { mega: true, coverRadius: cover }).burst.ring2Radius).toBe(0); // done by 2.65
    expect(nukeChoreography(2.6, { mega: true, coverRadius: cover }).burst.ring2Radius).toBeGreaterThan(9);
  });

  it('white-out: the plain nuke carries 0.5 × the flash envelope; the mega spikes to 0.95 at stage 2', () => {
    expect(whiteoutOpacity(0.3, false)).toBeCloseTo(0.5, 6);
    expect(whiteoutOpacity(0.3, true)).toBeCloseTo(0.5, 6);
    expect(whiteoutOpacity(MEGA_STAGE2_S + 0.001, true)).toBeGreaterThan(0.9);
    expect(whiteoutOpacity(MEGA_STAGE2_S + 0.001, true)).toBeLessThanOrEqual(0.95);
    expect(whiteoutOpacity(MEGA_STAGE2_S + 0.001, false)).toBeLessThan(0.1);
    expect(whiteoutOpacity(0.1, true)).toBe(0); // nothing before the flash
  });

  it('FOV: mega punches 0.22 vs the nuke’s 0.10, plus a −0.10 kick at stage 2', () => {
    const punchPeak = 0.3 + 0.12; // punch envelope tops out 0.12 s after the flash
    expect(nukeChoreography(punchPeak, { coverRadius: cover }).fovPunch).toBeCloseTo(0.1, 6);
    expect(nukeChoreography(punchPeak, { mega: true, coverRadius: cover }).fovPunch).toBeCloseTo(0.22, 6);
    const kicked = nukeChoreography(MEGA_STAGE2_S + 0.05, { mega: true, coverRadius: cover });
    const unkicked = nukeChoreography(MEGA_STAGE2_S + 0.05, { coverRadius: cover });
    expect(kicked.fovPunch).toBeGreaterThan(unkicked.fovPunch + 0.05);
    expect(megaFrameBurst(MEGA_STAGE2_S + 0.001).fovKick).toBeCloseTo(-0.1, 2);
  });

  it('debris: 105 base chunks rain from y 1.7–3.1, only after stage 2', () => {
    expect(NUKE_PARTICLE_BASE.debris).toBe(105);
    expect(DEBRIS_RAIN_Y).toEqual({ min: 1.7, max: 3.1 });
    expect(megaFrameBurst(MEGA_STAGE2_S - 0.01).debris).toBe(0);
    expect(megaFrameBurst(MEGA_STAGE2_S + 0.3).debris).toBeGreaterThan(0.9);
  });
});

describe('particle budgets', () => {
  it('base sum is rebalanced to 640 = the old total; mega is exactly ×1.4 of the nuke at equal detail', () => {
    const baseSum = Object.values(NUKE_PARTICLE_BASE).reduce((a, b) => a + b, 0);
    expect(baseSum).toBe(640);
    expect(particleBudget(1, false).total).toBe(640);
    expect(particleBudget(1, true).total).toBe(896);
    expect(particleBudget(1, true).total).toBe(particleBudget(1, false).total * 1.4);
    // iOS mega (detail 0.45 × 1.4 = 0.63) still spends less than a desktop nuke
    expect(particleBudget(0.45, true).total).toBeLessThan(particleBudget(1, false).total);
    expect(particleBudget(0.45, true).total).toBeCloseTo(0.63 * 640, -1);
  });
});

describe('card silhouettes & armed pulse', () => {
  it('silhouettes: ≤ 9 meshes, detail-scaled; poses stay inside the wall and under the cap, and are pure', () => {
    expect(cloudCardCount(1)).toBe(9);
    expect(cloudCardCount(0.45)).toBeGreaterThan(0);
    expect(cloudCardCount(0.45)).toBeLessThan(9);
    expect(cloudCardCount(0.35)).toBeLessThanOrEqual(cloudCardCount(0.45));
    const cover = 2.9;
    for (let i = 0; i < cloudCardCount(1); i++) {
      const pose = cloudCardPose(i, 2.3, cover);
      expect(pose.orbitFrac).toBeLessThanOrEqual(0.92);
      expect(Math.hypot(pose.x, pose.z - 0.04)).toBeLessThanOrEqual(0.92 * cover + 1e-9);
      expect(pose.y).toBeLessThanOrEqual(CAP_PLANE_Y);
      expect(pose.opacity).toBeGreaterThan(0);
      // pure function of T: same inputs, same pose; later T, different pose
      expect(cloudCardPose(i, 2.3, cover)).toEqual(pose);
      expect(cloudCardPose(i, 2.6, cover)).not.toEqual(pose);
    }
  });

  it('armed ember pulse: 1 Hz cadence + flicker in [0, 1], steady 0.55 under reduced motion, radius 1.3', () => {
    expect(ARMED_GLOW_RADIUS).toBe(1.3);
    expect(armedEmberPulse(0.7, true)).toBe(0.55);
    expect(armedEmberPulse(3.25, true)).toBe(0.55);
    let lo = 1, hi = 0;
    for (let T = 0; T <= 4; T += 0.01) {
      const v = armedEmberPulse(T);
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
    expect(hi - lo).toBeGreaterThan(0.3); // it pulses, it is not a flat light
  });

  it('pinned contracts untouched: iOS profile discipline and the stall watchdog', () => {
    const ios = nukeProfile('high', {
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15',
      platform: 'iPhone', maxTouchPoints: 5,
    });
    expect(ios).toEqual({ post: false, octaves: 0, detail: 0.45, screen: false });
    expect(nukeClockStalled(0.3, 0.3, 800)).toBe(true);
    expect(nukeClockStalled(0.3, 1.1, 800)).toBe(false);
    expect(nukeClockStalled(3.9, 3.9, 800, 4.4)).toBe(true);
  });
});
