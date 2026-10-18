import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GATHER_CLEARANCE, gatherPose, minCardCornerY } from '../src/three/gather';
import { CH, CT, CW, opponentFan, pileSpot, trickSpot, xf, type SeatPos, type Xform } from '../src/three/layout';

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

function sampleMin(from: Xform, to: Xform, steps = 200): number {
  let min = Infinity;
  for (let i = 0; i <= steps; i++) min = Math.min(min, lowestCorner(gatherPose(from, to, i / steps)));
  return min;
}

/** The pre-fix path (eased lerp + 0.15 hop + raw slerp, no clearance lift), for the repro assertion. */
function naiveMin(from: Xform, to: Xform): number {
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  let min = Infinity;
  for (let i = 0; i <= 200; i++) {
    const t = i / 200, e = ease(t);
    const p = new Vector3(...from.p).lerp(new Vector3(...to.p), e);
    p.y += Math.sin(Math.PI * t) * 0.15;
    const q = new Quaternion().slerpQuaternions(new Quaternion(...from.q), new Quaternion(...to.q), e);
    const s = from.s + (to.s - from.s) * e;
    min = Math.min(min, minCardCornerY(p.y, q, s));
  }
  return min;
}

const SEATS: SeatPos[] = ['bottom', 'left', 'top', 'right'];

describe('trick gather: no card corner ever dips into the felt', () => {
  it('reproduces the bug on the old path: the face-down flip sinks below y=0 mid-gather', () => {
    const from = trickSpot('bottom', 4, 0, 0.7);
    const to = pileSpot('bottom', 4, 0, 0, 0.7);
    expect(naiveMin(from, to)).toBeLessThan(-0.1);
  });

  it('keeps every corner >= felt for all winner seats, source seats, orders and spins (4p)', () => {
    for (const winner of SEATS) for (const source of SEATS) for (const order of [0, 1, 2, 3]) {
      // Tips ON fixed spot and Tips OFF physics landing at the worst spin cap both gather.
      const starts = [
        trickSpot(source, 4, order, 0.7),
        trickSpot(source, 4, order, -0.7, undefined, { dx: 0.2, dz: -0.15, spin: 0.61 }),
        trickSpot(source, 4, order, -0.7, undefined, { dx: -0.2, dz: 0.15, spin: -0.61 }),
      ];
      for (const from of starts) {
        const to = pileSpot(winner, 4, 2, order, 0.7);
        expect(sampleMin(from, to), `${source}->${winner} order ${order}`).toBeGreaterThanOrEqual(GATHER_CLEARANCE - 1e-9);
      }
    }
  });

  it('keeps every corner >= felt in 3-player piles and at the short-landscape trick scale', () => {
    for (const winner of SEATS) for (const source of SEATS) {
      const from = trickSpot(source, 3, 1, 0.4, 1.81, { dx: 0.1, dz: 0.1, spin: -0.61 });
      const to = pileSpot(winner, 3, 1, 1, -0.4);
      expect(sampleMin(from, to), `3p ${source}->${winner}`).toBeGreaterThanOrEqual(GATHER_CLEARANCE - 1e-9);
    }
  });

  it('keeps every corner >= felt from the worst prior state: swept while still mid-flight/tilted', () => {
    // Gather retargets a card that has not landed yet: it still holds a near-upright
    // fan/flight quaternion, at felt height, at full trick scale.
    const fan = opponentFan('left', 4, 2, 8);
    const midFlight: Xform = { p: [0.2, 0.006, 0.1], q: fan.q, s: 2.25 };
    const nearVertical: Xform = xf([0, 0.006, 0], [-0.12, 0.4, 0.25], 2.25);
    for (const winner of SEATS) for (const from of [midFlight, nearVertical]) {
      expect(sampleMin(from, pileSpot(winner, 4, 0, 0, 0)), `worst-prior ->${winner}`).toBeGreaterThanOrEqual(GATHER_CLEARANCE - 1e-9);
    }
  });

  it('does not change the endpoints: starts at the trick rest, lands exactly on the pile spot', () => {
    const from = trickSpot('top', 4, 3, 0.7, undefined, { dx: 0.05, dz: 0.02, spin: 0.3 });
    const to = pileSpot('right', 4, 4, 3, -0.7);
    const a = gatherPose(from, to, 0);
    const b = gatherPose(from, to, 1);
    expect(a.p[0]).toBeCloseTo(from.p[0], 9); expect(a.p[2]).toBeCloseTo(from.p[2], 9);
    expect(a.s).toBeCloseTo(from.s, 9);
    expect(b.p[0]).toBeCloseTo(to.p[0], 9); expect(b.p[1]).toBeCloseTo(to.p[1], 9); expect(b.p[2]).toBeCloseTo(to.p[2], 9); expect(b.s).toBeCloseTo(to.s, 9);
    expect(new Quaternion(...b.q).angleTo(new Quaternion(...to.q))).toBeLessThan(1e-6);
    // and the mid-gather is genuinely lifted, not slid flat through the table
    expect(gatherPose(from, to, 0.5).p[1]).toBeGreaterThan(0.2);
  });
});
