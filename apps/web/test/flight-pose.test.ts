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
 * Leading-edge pitch in degrees at a pose: how far the edge facing the
 * direction of travel sits BELOW the trailing edge. Positive = the card is
 * tipping into its landing (corner-first); ~0 = descending flat/parallel.
 */
function dipDeg(pose: Xform, from: Xform, to: Xform): number {
  const dx = to.p[0] - from.p[0], dz = to.p[2] - from.p[2];
  const hl = Math.hypot(dx, dz) || 1;
  const ux = dx / hl, uz = dz / hl;
  const q = new Quaternion(...pose.q);
  let leadY = 0, trailY = 0, leadN = 0, trailN = 0, leadA = 0, trailA = 0;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const c = new Vector3((sx * CW) / 2, (sy * CH) / 2, (sz * CT) / 2).multiplyScalar(pose.s).applyQuaternion(q);
    const along = c.x * ux + c.z * uz;
    if (along > 0.01) { leadY += pose.p[1] + c.y; leadA += along; leadN++; }
    else if (along < -0.01) { trailY += pose.p[1] + c.y; trailA += along; trailN++; }
  }
  if (!leadN || !trailN) return 0;
  return Math.atan2(trailY / trailN - leadY / leadN, leadA / leadN - trailA / trailN) * 180 / Math.PI;
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

  it('glide: corner-first touchdown, a flop, then a flat settle skid — no skate, no dead stop (owner 2026-11-01)', () => {
    for (const seat of SEATS) {
      const from = launchFrom(seat);
      const to = trickSpot(seat, 4, 0, 0.3, undefined, { dx: 0.18, dz: 0.1, spin: 0.5 });
      const tq = new Quaternion(...to.q);
      // At touchdown the leading edge is pitched DOWN — the corner meets the
      // pile first. (The 2026-10-29 design landed flat from t=0.35 and skated;
      // the 2026-10-31 toss fixed the skate but stopped dead at the flop's
      // end; the 2026-11-01 verdict: the fall is right, the dead stop is not —
      // a real card skids a few centimetres flat before it rests.)
      const at35 = playFlightPose(from, to, 0.35, { motion: 'glide', arc: 0.3 });
      expect(dipDeg(at35, from, to), `${seat} dip at touchdown`).toBeGreaterThan(8);
      // A bite of the trip is left at touchdown — most of it is covered (not
      // the old 46%), and materially more than the dead-stop design's ~10%:
      // the flop and the skid need room to bleed the momentum.
      const total = Math.hypot(to.p[0] - from.p[0], to.p[2] - from.p[2]);
      const rest = Math.hypot(to.p[0] - at35.p[0], to.p[2] - at35.p[2]);
      expect(rest / total, `${seat} bite share`).toBeGreaterThan(0.12);
      expect(rest / total, `${seat} bite share`).toBeLessThan(0.32);
      // The bite is mostly spent halfway through the flop.
      const at50 = playFlightPose(from, to, 0.5, { motion: 'glide', arc: 0.3 });
      expect(Math.hypot(to.p[0] - at50.p[0], to.p[2] - at50.p[2]) / total, `${seat} bite left @0.5`).toBeLessThan(0.16);
      // From the flop's end the card is FLAT and at rest height — but NOT yet
      // at rest in position: what remains is the settle skid, a few
      // centimetres travelled flat along the throw direction.
      for (let i = 58; i <= 100; i++) {
        const pose = playFlightPose(from, to, i / 100, { motion: 'glide', arc: 0.3 });
        expect(new Quaternion(...pose.q).angleTo(tq), `${seat} tilt @${i}`).toBeLessThan(0.01);
        expect(pose.p[1], `${seat} height @${i}`).toBeCloseTo(to.p[1], 6);
      }
      const at58 = playFlightPose(from, to, 0.58, { motion: 'glide', arc: 0.3 });
      const skidLen = Math.hypot(to.p[0] - at58.p[0], to.p[2] - at58.p[2]);
      expect(skidLen, `${seat} skid length`).toBeGreaterThan(0.03);
      expect(skidLen, `${seat} skid length`).toBeLessThan(0.06);
      // It really moves right after the flop (the dead stop is gone)…
      const at66 = playFlightPose(from, to, 0.66, { motion: 'glide', arc: 0.3 });
      expect(Math.hypot(at66.p[0] - at58.p[0], at66.p[2] - at58.p[2]), `${seat} early skid travel`).toBeGreaterThan(0.004);
      // …along the throw direction, not sideways…
      const ux = (to.p[0] - from.p[0]) / total, uz = (to.p[2] - from.p[2]) / total;
      const at90 = playFlightPose(from, to, 0.9, { motion: 'glide', arc: 0.3 });
      const cross = Math.abs((at90.p[0] - at58.p[0]) * uz - (at90.p[2] - at58.p[2]) * ux);
      expect(cross, `${seat} skid cross-track`).toBeLessThan(0.004);
      // …and it is fully at rest before the tween ends.
      const at95 = playFlightPose(from, to, 0.95, { motion: 'glide', arc: 0.3 });
      expect(Math.hypot(to.p[0] - at95.p[0], to.p[2] - at95.p[2]), `${seat} rest by 0.95`).toBeLessThan(1e-9);
    }
  });

  it('flight: tips in, slaps flat inside the tween, then a short settle skid (owner 2026-11-01)', () => {
    for (const seat of SEATS) {
      const from = launchFrom(seat);
      const to = trickSpot(seat, 4, 2, -0.4);
      const tq = new Quaternion(...to.q);
      // Not a parallel descent: the dip peaks late (t=0.82) and the card is
      // NOT flat yet at t=0.85 — the slap is still unwinding.
      const at82 = playFlightPose(from, to, 0.82, { motion: 'flight', arc: 0.35 });
      expect(dipDeg(at82, from, to), `${seat} dip @0.82`).toBeGreaterThan(10);
      const at85 = playFlightPose(from, to, 0.85, { motion: 'flight', arc: 0.35 });
      expect(new Quaternion(...at85.q).angleTo(tq), `${seat} tilt @0.85`).toBeGreaterThan(0.05);
      // Almost all the trip is done by then — the slap, not a skate, brings it in.
      const total = Math.hypot(to.p[0] - from.p[0], to.p[2] - from.p[2]);
      const tail = Math.hypot(to.p[0] - at85.p[0], to.p[2] - at85.p[2]);
      expect(tail / total, `${seat} tail travel share`).toBeLessThan(0.08);
      // The slap completes inside the tween (flat from t=0.94)…
      for (let i = 94; i <= 100; i++) {
        const pose = playFlightPose(from, to, i / 100, { motion: 'flight', arc: 0.35 });
        expect(new Quaternion(...pose.q).angleTo(tq), `${seat} tilt @${i}`).toBeLessThan(0.01);
      }
      // …and what travel remains after it is the settle skid: it is still
      // moving just after the slap, covers a few centimetres flat, and is
      // fully at rest before the tween ends (the 2026-10-31 design slapped
      // flat exactly AT t=1 and stopped dead — the owner called the dead
      // stop unrealistic on 2026-11-01).
      const at90 = playFlightPose(from, to, 0.9, { motion: 'flight', arc: 0.35 });
      const at96 = playFlightPose(from, to, 0.96, { motion: 'flight', arc: 0.35 });
      expect(Math.hypot(at96.p[0] - at90.p[0], at96.p[2] - at90.p[2]), `${seat} skid travel after slap`).toBeGreaterThan(0.003);
      const at94 = playFlightPose(from, to, 0.94, { motion: 'flight', arc: 0.35 });
      const flatLeft = Math.hypot(to.p[0] - at94.p[0], to.p[2] - at94.p[2]);
      expect(flatLeft, `${seat} flat-phase travel`).toBeGreaterThan(0.003);
      expect(flatLeft, `${seat} flat-phase travel`).toBeLessThan(0.025);
      const at98 = playFlightPose(from, to, 0.98, { motion: 'flight', arc: 0.35 });
      expect(Math.hypot(to.p[0] - at98.p[0], to.p[2] - at98.p[2]), `${seat} rest by 0.98`).toBeLessThan(1e-9);
      // Flat exactly at t=1 (the endpoints suite pins the position exactly).
      const at1 = playFlightPose(from, to, 1, { motion: 'flight', arc: 0.35 });
      expect(new Quaternion(...at1.q).angleTo(tq), `${seat} tilt @1`).toBeLessThan(1e-6);
    }
  });

  it('the hop is ballistic: it rises faster than it falls (no sine levitation)', () => {
    // A descending synthetic flight (a high hand down to a real spot) with the
    // centre's descent curve factored back out isolates the hop itself. (A
    // level synthetic would skim its own clearance floor and pollute the
    // measurement with the corner lift.)
    const spot = trickSpot('bottom', 4, 1, 0.2);
    const to: Xform = { p: [...spot.p], q: spot.q, s: spot.s };
    const from: Xform = { p: [spot.p[0], 0.55, spot.p[2] + 0.9], q: spot.q, s: spot.s };
    const hop = (t: number) =>
      playFlightPose(from, to, t, { motion: 'flight', arc: 0.35 }).p[1]
      - (from.p[1] + (to.p[1] - from.p[1]) * (1 - (1 - t) * (1 - t)));
    // Quarter in, the hop is already higher than it is three quarters in —
    // a sine hop would be exactly symmetric and fail this.
    expect(hop(0.25)).toBeGreaterThan(hop(0.75) + 0.02);
    expect(hop(0.45)).toBeGreaterThan(hop(0.25)); // peak sits at ~45% of the flight
    expect(hop(0)).toBeCloseTo(0, 9);
    expect(hop(1)).toBeCloseTo(0, 9);
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
