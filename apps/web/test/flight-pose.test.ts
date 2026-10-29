import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GATHER_CLEARANCE } from '../src/three/gather';
import { playFlightPose, type PlayFlightMotion } from '../src/three/flightPose';
import { CH, CT, CW, handFan, jitterOf, opponentFan, trickSpot, type SeatPos, type Xform } from '../src/three/layout';
import { faceUpPlayFrom } from '../src/three/trickFacing';

/** Lowest of the card's 8 real corners at a pose (independent of gather.ts helpers). */
function lowestCorner(pose: Xform): number {
  const q = new Quaternion(...pose.q);
  let min = Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const c = new Vector3((sx * CW) / 2, (sy * CH) / 2, (sz * CT) / 2).multiplyScalar(pose.s).applyQuaternion(q);
    min = Math.min(min, pose.p[1] + c.y);
  }
  return min;
}

function sampleMin(from: Xform, to: Xform, motion: PlayFlightMotion, arc: number, steps = 400): number {
  let min = Infinity;
  for (let i = 0; i <= steps; i++) min = Math.min(min, lowestCorner(playFlightPose(from, to, i / steps, { motion, arc })));
  return min;
}

/**
 * The pre-fix glide path, replicated from the old Card3D frame code: one shared glide
 * ease for centre + rotation, hop only until t = 0.35, no corner clearance. This is
 * the path that stabbed the corner through the felt on its "slide".
 */
function naiveGlideMin(from: Xform, to: Xform, arc: number): number {
  const glide = (t: number) => 1 - Math.pow(1 - Math.pow(t, 1.4), 3);
  const sp = new Vector3(...from.p), tp = new Vector3(...to.p);
  const dist = sp.distanceTo(tp);
  let min = Infinity;
  for (let i = 0; i <= 400; i++) {
    const t = i / 400, e = glide(t);
    const p = sp.clone().lerp(tp, e);
    p.y += (t < 0.35 ? Math.sin((Math.PI * t) / 0.35) : 0) * arc * Math.min(1, dist);
    const pose: Xform = {
      p: [p.x, p.y, p.z],
      q: (() => { const q = new Quaternion().slerpQuaternions(new Quaternion(...from.q), new Quaternion(...to.q), e); return [q.x, q.y, q.z, q.w]; })(),
      s: from.s + (to.s - from.s) * e,
    };
    min = Math.min(min, lowestCorner(pose));
  }
  return min;
}

const SEATS: SeatPos[] = ['bottom', 'left', 'top', 'right'];
const ASPECT = 844 / 390;

/** Where a played card launches from, per seat (the human's own fan slot; a bot's face-up fan pose). */
function launchFrom(seat: SeatPos, i = 6): Xform {
  return seat === 'bottom' ? handFan(ASPECT, 13, i, 0) : faceUpPlayFrom(opponentFan(seat, 4, 3, 7));
}

describe('played-card flight: the corner never stabs the felt (owner 2026-10-29)', () => {
  it('repro: the pre-fix glide drove the side seats\u2019 corners well under the felt', () => {
    for (const seat of ['left', 'right'] as SeatPos[]) {
      const from = launchFrom(seat);
      const to = trickSpot(seat, 4, 0, 0.3, undefined, { dx: 0.18, dz: 0.1, spin: 0.5 });
      expect(naiveGlideMin(from, to, 0.3), `${seat} naive glide`).toBeLessThan(-0.02);
    }
  });

  it('keeps every corner >= felt for all seats, orders and motions', () => {
    for (const seat of SEATS) {
      const from = launchFrom(seat);
      for (const order of [0, 1, 2, 3]) {
        const fixed = trickSpot(seat, 4, order, jitterOf(`pin-${seat}-${order}`));
        const phys = trickSpot(seat, 4, order, -0.7, undefined, { dx: 0.2, dz: -0.15, spin: 0.61 });
        const physNeg = trickSpot(seat, 4, order, 0.7, undefined, { dx: -0.2, dz: 0.15, spin: -0.61 });
        // tips-on tosses (arc 0.35 * toss 0.8..1.3) and the overcut screamer (arc 0.7)
        for (const arc of [0.35 * 0.8, 0.35 * 1.05, 0.35 * 1.3, 0.7]) {
          expect(sampleMin(from, fixed, 'flight', arc), `${seat} flight ord${order} arc${arc}`).toBeGreaterThanOrEqual(GATHER_CLEARANCE - 1e-9);
        }
        // tips-off physics landings ride the glide
        for (const to of [phys, physNeg]) {
          expect(sampleMin(from, to, 'glide', 0.3), `${seat} glide ord${order}`).toBeGreaterThanOrEqual(GATHER_CLEARANCE - 1e-9);
          expect(sampleMin(from, to, 'glide', 0.15), `${seat} glide-low ord${order}`).toBeGreaterThanOrEqual(GATHER_CLEARANCE - 1e-9);
        }
        // reduced motion
        expect(sampleMin(from, fixed, 'slide', 0), `${seat} slide ord${order}`).toBeGreaterThanOrEqual(GATHER_CLEARANCE - 1e-9);
      }
    }
  });

  it('keeps every corner >= felt for the edge fan slots and 3-player tables', () => {
    for (const i of [0, 12]) {
      const from = handFan(ASPECT, 13, i, 0);
      const to = trickSpot('bottom', 4, 1, 0.2);
      expect(sampleMin(from, to, 'flight', 0.35), `human slot ${i}`).toBeGreaterThanOrEqual(GATHER_CLEARANCE - 1e-9);
    }
    for (const seat of SEATS) {
      const from = seat === 'bottom' ? handFan(ASPECT, 9, 4, 0) : faceUpPlayFrom(opponentFan(seat, 3, 2, 5));
      const to = trickSpot(seat, 3, 1, 0.4, 1.81, { dx: 0.1, dz: 0.1, spin: -0.61 });
      expect(sampleMin(from, to, 'glide', 0.3), `3p ${seat}`).toBeGreaterThanOrEqual(GATHER_CLEARANCE - 1e-9);
      expect(sampleMin(from, trickSpot(seat, 3, 1, 0.4, 1.81), 'flight', 0.4), `3p flight ${seat}`).toBeGreaterThanOrEqual(GATHER_CLEARANCE - 1e-9);
    }
  });

  it('glide: the card is FLAT and at rest height from touchdown (t=0.35) on, and still slides', () => {
    for (const seat of SEATS) {
      const from = launchFrom(seat);
      const to = trickSpot(seat, 4, 0, 0.3, undefined, { dx: 0.18, dz: 0.1, spin: 0.5 });
      const tq = new Quaternion(...to.q);
      for (let i = 35; i <= 100; i++) {
        const pose = playFlightPose(from, to, i / 100, { motion: 'glide', arc: 0.3 });
        expect(new Quaternion(...pose.q).angleTo(tq), `${seat} tilt @${i}`).toBeLessThan(0.01);
        expect(pose.p[1], `${seat} height @${i}`).toBeCloseTo(to.p[1], 6);
      }
      // a real skid remains after touchdown: at least a fifth of the horizontal travel
      const at35 = playFlightPose(from, to, 0.35, { motion: 'glide', arc: 0.3 });
      const total = Math.hypot(to.p[0] - from.p[0], to.p[2] - from.p[2]);
      const rest = Math.hypot(to.p[0] - at35.p[0], to.p[2] - at35.p[2]);
      expect(rest / total, `${seat} slide share`).toBeGreaterThan(0.2);
    }
  });

  it('flight: the card levels by t=0.8 and finishes flat while still travelling', () => {
    for (const seat of SEATS) {
      const from = launchFrom(seat);
      const to = trickSpot(seat, 4, 2, -0.4);
      const tq = new Quaternion(...to.q);
      for (let i = 80; i <= 100; i++) {
        const pose = playFlightPose(from, to, i / 100, { motion: 'flight', arc: 0.35 });
        expect(new Quaternion(...pose.q).angleTo(tq), `${seat} tilt @${i}`).toBeLessThan(0.01);
      }
      const at85 = playFlightPose(from, to, 0.85, { motion: 'flight', arc: 0.35 });
      const total = Math.hypot(to.p[0] - from.p[0], to.p[2] - from.p[2]);
      const tail = Math.hypot(to.p[0] - at85.p[0], to.p[2] - at85.p[2]);
      // the flat tail is short by design (1 - easeInOut(0.85) = 1.35% of travel,
      // ~1-2 cm at table scale) but it is nonzero: the card is still travelling,
      // already flat, as it arrives — the long skid is the glide's (46%).
      expect(tail / total, `${seat} tail travel share`).toBeGreaterThan(0.01);
    }
  });

  it('endpoints are exact: the flight leaves the fan pose and lands on the trick spot', () => {
    for (const seat of SEATS) for (const motion of ['flight', 'glide', 'slide'] as PlayFlightMotion[]) {
      const from = launchFrom(seat);
      const to = trickSpot(seat, 4, 3, 0.7, undefined, { dx: 0.05, dz: 0.02, spin: 0.3 });
      const a = playFlightPose(from, to, 0, { motion, arc: 0.3 });
      const b = playFlightPose(from, to, 1, { motion, arc: 0.3 });
      expect(a.p[0]).toBeCloseTo(from.p[0], 9); expect(a.p[1]).toBeCloseTo(from.p[1], 9); expect(a.p[2]).toBeCloseTo(from.p[2], 9);
      expect(a.s).toBeCloseTo(from.s, 9);
      expect(new Quaternion(...a.q).angleTo(new Quaternion(...from.q))).toBeLessThan(1e-6);
      expect(b.p[0]).toBeCloseTo(to.p[0], 9); expect(b.p[1]).toBeCloseTo(to.p[1], 9); expect(b.p[2]).toBeCloseTo(to.p[2], 9);
      expect(b.s).toBeCloseTo(to.s, 9);
      expect(new Quaternion(...b.q).angleTo(new Quaternion(...to.q))).toBeLessThan(1e-6);
    }
  });
});
