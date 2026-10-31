import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GATHER_CLEARANCE } from '../src/three/gather';
import {
  FLICK_MIN_SPEED, FLIGHT_VARIANT_IDS, flickFlightFor, pickFlightVariant, playFlightPose,
  type FlightVariant, type FlightVariantId, type PlayFlightMotion,
} from '../src/three/flightPose';
import { impactFraction } from '../src/landTiming';
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

function sampleMin(from: Xform, to: Xform, motion: PlayFlightMotion, arc: number, variant?: FlightVariant, steps = 200): number {
  let min = Infinity;
  for (let i = 0; i <= steps; i++) min = Math.min(min, lowestCorner(playFlightPose(from, to, i / steps, { motion, arc, variant })));
  return min;
}

const SEATS: SeatPos[] = ['bottom', 'left', 'top', 'right'];
const ASPECT = 844 / 390;

function launchFrom(seat: SeatPos, i = 6): Xform {
  return seat === 'bottom' ? handFan(ASPECT, 13, i, 0) : faceUpPlayFrom(opponentFan(seat, 4, 3, 7));
}

/** Every variant the picker can hand out, both signs, gathered over many seeds. */
function allPickedVariants(): Map<FlightVariantId, FlightVariant[]> {
  const byId = new Map<FlightVariantId, FlightVariant[]>();
  for (let seed = 0; seed < 2000; seed++) {
    const { id, variant } = pickFlightVariant(seed);
    const arr = byId.get(id) ?? [];
    if (arr.length < 4) arr.push(variant);
    byId.set(id, arr);
  }
  return byId;
}

describe('toss variation (owner 2026-10-30): every variant keeps the corner off the felt', () => {
  it('the picker covers the whole family and never repeats back-to-back', () => {
    const seen = new Set<FlightVariantId>();
    for (let seed = 0; seed < 500; seed++) seen.add(pickFlightVariant(seed).id);
    expect([...seen].sort()).toEqual([...FLIGHT_VARIANT_IDS].sort());
    for (const prev of FLIGHT_VARIANT_IDS) {
      for (let seed = 0; seed < 500; seed++) {
        expect(pickFlightVariant(seed, prev).id, `seed ${seed} after ${prev}`).not.toBe(prev);
      }
    }
    // same seed + same prev = same pick, every time (all clients agree)
    for (let seed = 0; seed < 100; seed++) {
      expect(pickFlightVariant(seed, 'curve')).toEqual(pickFlightVariant(seed, 'curve'));
    }
  });

  it('keeps every corner >= felt for all seats, orders, variants and the flick', { timeout: 120_000 }, () => {
    const byId = allPickedVariants();
    const flick = flickFlightFor([2.2, -1.2])!;
    const flickSoft = flickFlightFor([1.05, 0.2])!;
    for (const seat of SEATS) {
      const from = launchFrom(seat);
      for (const order of [0, 1, 2, 3]) {
        const fixed = trickSpot(seat, 4, order, jitterOf(`var-${seat}-${order}`));
        const phys = trickSpot(seat, 4, order, -0.7, undefined, { dx: 0.2, dz: -0.15, spin: 0.61 });
        for (const [id, variants] of byId) {
          for (const variant of variants) {
            expect(sampleMin(from, fixed, 'flight', 0.35 * 1.05, variant), `${seat} flight ${id} ord${order}`).toBeGreaterThanOrEqual(GATHER_CLEARANCE - 1e-9);
            expect(sampleMin(from, fixed, 'flight', 0.7, variant), `${seat} flight-arc.7 ${id} ord${order}`).toBeGreaterThanOrEqual(GATHER_CLEARANCE - 1e-9);
            // glide takes only the family's bend and spin (Scene strips the rest)
            const glideVariant = { curve: variant.curve, spin: variant.spin };
            expect(sampleMin(from, phys, 'glide', 0.3, glideVariant), `${seat} glide ${id} ord${order}`).toBeGreaterThanOrEqual(GATHER_CLEARANCE - 1e-9);
          }
        }
        for (const fv of [flick, flickSoft]) {
          expect(sampleMin(from, fixed, 'flick', 0.35, fv), `${seat} flick ord${order}`).toBeGreaterThanOrEqual(GATHER_CLEARANCE - 1e-9);
        }
      }
      // edge fan slots too
      for (const i of [0, 12]) {
        const edgeFrom = handFan(ASPECT, 13, i, 0);
        const to = trickSpot('bottom', 4, 1, 0.2);
        for (const [, variants] of byId) for (const variant of variants) {
          expect(sampleMin(edgeFrom, to, 'flight', 0.35, variant), `human slot ${i}`).toBeGreaterThanOrEqual(GATHER_CLEARANCE - 1e-9);
        }
        expect(sampleMin(edgeFrom, to, 'flick', 0.35, flick), `human slot ${i} flick`).toBeGreaterThanOrEqual(GATHER_CLEARANCE - 1e-9);
      }
    }
  });

  it('variants keep endpoints exact and the reduced-motion slide ignores them entirely', () => {
    const byId = allPickedVariants();
    const flick = flickFlightFor([-2.4, 0.4])!;
    for (const seat of SEATS) {
      const from = launchFrom(seat);
      const to = trickSpot(seat, 4, 3, 0.7, undefined, { dx: 0.05, dz: 0.02, spin: 0.3 });
      const cases: { motion: PlayFlightMotion; variant?: FlightVariant }[] = [
        ...[...byId.values()].flat().map((variant) => ({ motion: 'flight' as const, variant })),
        { motion: 'flick', variant: flick },
        { motion: 'glide', variant: { curve: -0.13, spin: 0.4 } },
      ];
      for (const c of cases) {
        const a = playFlightPose(from, to, 0, { ...c, arc: 0.3 });
        const b = playFlightPose(from, to, 1, { ...c, arc: 0.3 });
        expect(a.p[0]).toBeCloseTo(from.p[0], 9); expect(a.p[1]).toBeCloseTo(from.p[1], 9); expect(a.p[2]).toBeCloseTo(from.p[2], 9);
        expect(new Quaternion(...a.q).angleTo(new Quaternion(...from.q))).toBeLessThan(1e-6);
        expect(b.p[0]).toBeCloseTo(to.p[0], 9); expect(b.p[1]).toBeCloseTo(to.p[1], 9); expect(b.p[2]).toBeCloseTo(to.p[2], 9);
        expect(new Quaternion(...b.q).angleTo(new Quaternion(...to.q))).toBeLessThan(1e-6);
      }
      const plain = playFlightPose(from, to, 0.5, { motion: 'slide', arc: 0 });
      const varied = playFlightPose(from, to, 0.5, { motion: 'slide', arc: 0, variant: { arcScale: 2, curve: 0.2, spin: 1 } });
      expect(varied.p).toEqual(plain.p);
      expect(varied.q).toEqual(plain.q);
    }
  });

  it('the variants actually differ from each other mid-flight (no cosmetic no-ops)', () => {
    const from = launchFrom('bottom');
    const to = trickSpot('bottom', 4, 1, 0.2);
    const mid = (v?: FlightVariant) => playFlightPose(from, to, 0.5, { motion: 'flight', arc: 0.35, variant: v });
    const std = mid(undefined);
    const byId = allPickedVariants();
    let maxDev = 0;
    for (const [, variants] of byId) for (const variant of variants) {
      const p = mid(variant);
      const dev = Math.hypot(p.p[0] - std.p[0], p.p[1] - std.p[1], p.p[2] - std.p[2])
        + new Quaternion(...p.q).angleTo(new Quaternion(...std.q));
      maxDev = Math.max(maxDev, dev);
    }
    expect(maxDev).toBeGreaterThan(0.05);
  });
});

/** Leading-edge pitch in degrees at a pose (corner-first evidence). */
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

describe('the flick toss (owner 2026-10-30): quick, flat, snapping down', () => {
  it('only a real flick release qualifies, and the gesture shapes it', () => {
    expect(flickFlightFor(undefined)).toBeNull();
    expect(flickFlightFor([0.3, 0.2])).toBeNull();
    expect(flickFlightFor([FLICK_MIN_SPEED - 0.01, 0])).toBeNull();
    const soft = flickFlightFor([FLICK_MIN_SPEED, 0])!;
    const hard = flickFlightFor([2.5, 0])!;
    expect(soft).not.toBeNull();
    expect(hard.arcScale!).toBeLessThan(soft.arcScale!); // faster release = flatter skim
    expect(hard.dip!).toBeGreaterThan(soft.dip!); // ...and a harder snap-down
    expect(soft.dip!).toBeGreaterThan(0.3);
    expect(hard.dip!).toBeLessThan(0.45);
    expect(flickFlightFor([2.0, 0])!.curve!).toBeGreaterThan(0); // thrown right, bends right
    expect(flickFlightFor([-2.0, 0])!.curve!).toBeLessThan(0);
    expect(flickFlightFor([-2.0, 0])!.spin!).toBeLessThan(0);
    const capped = flickFlightFor([20, 0])!; // wild flick caps like a full slam
    expect(capped.arcScale).toBe(hard.arcScale);
    expect(capped.dip).toBe(hard.dip);
    expect(Math.abs(capped.curve!)).toBeLessThanOrEqual(Math.abs(flickFlightFor([2.5, 0])!.curve!) + 1e-9);
  });

  it('is corner-first at touchdown, snaps down, and is at rest from t=0.78 — no skating (owner 2026-10-31)', () => {
    expect(impactFraction('flick')).toBe(0.55);
    const flick = flickFlightFor([1.8, -0.6])!;
    for (const seat of SEATS) {
      const from = launchFrom(seat);
      const to = trickSpot(seat, 4, 0, 0.3);
      const tq = new Quaternion(...to.q);
      // Corner-first: at touchdown the leading edge is pitched well down.
      // (The 2026-10-30 flick landed flat at t=0.55 and skated 8-45% of the
      // trip; the 2026-10-31 verdict called that slide fake.)
      const at55 = playFlightPose(from, to, 0.55, { motion: 'flick', arc: 0.35, variant: flick });
      expect(dipDeg(at55, from, to), `${seat} dip at touchdown`).toBeGreaterThan(10);
      // Only a small bite of the trip remains at touchdown.
      const total = Math.hypot(to.p[0] - from.p[0], to.p[2] - from.p[2]);
      const rest = Math.hypot(to.p[0] - at55.p[0], to.p[2] - at55.p[2]);
      expect(rest / total, `${seat} bite share`).toBeLessThan(0.18);
      // From the snap-down's end the card is exactly at rest: flat, at rest
      // height, and no residual travel (the curve bend closes there too).
      for (let i = 78; i <= 100; i++) {
        const pose = playFlightPose(from, to, i / 100, { motion: 'flick', arc: 0.35, variant: flick });
        expect(new Quaternion(...pose.q).angleTo(tq), `${seat} tilt @${i}`).toBeLessThan(0.01);
        expect(pose.p[1], `${seat} height @${i}`).toBeCloseTo(to.p[1], 6);
        expect(Math.hypot(to.p[0] - pose.p[0], to.p[2] - pose.p[2]) / total, `${seat} travel left @${i}`).toBeLessThan(0.005);
      }
      // covers ground fast: by touchdown most of the trip is done (a tap toss is nowhere near)
      const tapAt55 = playFlightPose(from, to, 0.55, { motion: 'flight', arc: 0.35 });
      const flickDone = 1 - rest / total;
      const tapDone = 1 - Math.hypot(to.p[0] - tapAt55.p[0], to.p[2] - tapAt55.p[2]) / total;
      expect(flickDone).toBeGreaterThan(tapDone + 0.05);
      // and it stays low: peak height never approaches the tap toss's hop.
      // (At the bottom seat the hand sits high and both flights only descend,
      // so there the pin is that the flick never balloons above its launch.)
      let flickPeak = 0, tapPeak = 0;
      for (let i = 0; i <= 100; i++) {
        flickPeak = Math.max(flickPeak, playFlightPose(from, to, i / 100, { motion: 'flick', arc: 0.35, variant: flick }).p[1]);
        tapPeak = Math.max(tapPeak, playFlightPose(from, to, i / 100, { motion: 'flight', arc: 0.35 }).p[1]);
      }
      if (seat === 'bottom') expect(flickPeak).toBeLessThanOrEqual(from.p[1] + 0.01);
      else expect(flickPeak).toBeLessThan(tapPeak - 0.05);
    }
  });
});
