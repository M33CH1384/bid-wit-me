import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  CT, CW, CH, FELT, RAIL, edgePoint, pileEdgePoint, pileRise, pileSpot, seatDir, trickSpot,
  PILE_STEP, PILE_STEP_LATE, PILE_STEP_KNEE, RAIL_TOP_Y, type SeatPos, type Xform,
} from '../src/three/layout';

const SEATS4: SeatPos[] = ['bottom', 'left', 'top', 'right'];
const SEATS3: SeatPos[] = ['bottom', 'left', 'right'];

/** Card rect in the XZ plane (centre, two axes, half extents) from a flat pile/trick pose. */
function rect(x: Xform) {
  const q = new Quaternion(...x.q);
  const ax = new Vector3(1, 0, 0).applyQuaternion(q); ax.y = 0; ax.normalize();
  const ay = new Vector3(0, 1, 0).applyQuaternion(q); ay.y = 0; ay.normalize();
  return { c: new Vector3(x.p[0], 0, x.p[2]), axes: [ax, ay], half: [(CW * x.s) / 2, (CH * x.s) / 2] as const };
}
function overlaps(a: ReturnType<typeof rect>, b: ReturnType<typeof rect>): boolean {
  const axes = [...a.axes, ...b.axes];
  for (const axis of axes) {
    const pa = Math.abs(a.axes[0].dot(axis)) * a.half[0] + Math.abs(a.axes[1].dot(axis)) * a.half[1];
    const pb = Math.abs(b.axes[0].dot(axis)) * b.half[0] + Math.abs(b.axes[1].dot(axis)) * b.half[1];
    if (Math.abs(b.c.clone().sub(a.c).dot(axis)) > pa + pb) return false;
  }
  return true;
}

describe('book piles live on the table rim, one flattened stack per player', () => {
  it('pile centre is on the rail band (just beyond the felt edge, inside the outer rail), from real geometry', () => {
    for (const [n, seats] of [[4, SEATS4], [3, SEATS3]] as const) {
      for (const pos of seats) {
        const d = seatDir(pos, n);
        const feltEdge = edgePoint(d, 0);
        const p = pileEdgePoint(pos, n);
        const radial = (v: Vector3) => v.x * d.x + v.z * d.z;
        // straddling the rim line: centre a hair inside the felt edge (portrait fit),
        // outer edge of the card over the rail, never beyond the outer rail edge
        expect(radial(p)).toBeGreaterThan(radial(feltEdge) - 0.07);
        expect(radial(p)).toBeLessThanOrEqual(radial(feltEdge) + 1e-9);
        // the whole card stays on the table (within the outer rounded rect, slack for corners)
        const r = rect(pileSpot(pos, n, 0, 0, 0));
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
          const corner = r.c.clone().add(r.axes[0].clone().multiplyScalar(sx * r.half[0])).add(r.axes[1].clone().multiplyScalar(sy * r.half[1]));
          expect(Math.abs(corner.x)).toBeLessThanOrEqual(FELT.hx + RAIL + 0.05);
          expect(Math.abs(corner.z)).toBeLessThanOrEqual(FELT.hz + RAIL + 0.05);
        }
      }
    }
  });

  it('one stack per player: every book lands on the same rim spot (no row spreading over the felt)', () => {
    for (const pos of SEATS4) {
      const a = pileSpot(pos, 4, 0, 0, 0);
      for (let k = 1; k < 13; k++) {
        const b = pileSpot(pos, 4, k, 0, 0);
        expect(b.p[0]).toBeCloseTo(a.p[0], 9);
        expect(b.p[2]).toBeCloseTo(a.p[2], 9);
      }
    }
  });

  it('rim stacks never overlap any seat’s trick landing spot', () => {
    for (const winner of SEATS4) {
      const pile = rect(pileSpot(winner, 4, 0, 0, 0));
      for (const source of SEATS4) for (const order of [0, 1, 2, 3]) {
        expect(overlaps(pile, rect(trickSpot(source, 4, order, 0))), `${winner} pile vs ${source} trick`).toBe(false);
      }
    }
  });

  it('the pile is a flat slab, not steps: compressed rise with a soft cap; card thickness elsewhere untouched', () => {
    expect(CT).toBe(0.004); // shared card stock thickness (hand + felt play) unchanged
    expect(pileRise(0)).toBe(0);
    expect(pileRise(PILE_STEP_KNEE)).toBeCloseTo(PILE_STEP_KNEE * PILE_STEP, 12);
    expect(PILE_STEP_LATE).toBeLessThan(PILE_STEP);
    // a whole hand of books for one player (13 tricks x 4 cards) rises ~2cm, not ~23cm
    const total = pileSpot('bottom', 4, 12, 3, 0).p[1] - pileSpot('bottom', 4, 0, 0, 0).p[1];
    expect(total).toBeCloseTo(pileRise(51), 9);
    expect(total).toBeLessThan(0.025);
    expect(total).toBeGreaterThan(0.01); // still a visible stack, and monotonic
    for (let i = 1; i <= 51; i++) expect(pileRise(i)).toBeGreaterThan(pileRise(i - 1));
    expect(pileSpot('bottom', 4, 0, 0, 0).p[1]).toBeCloseTo(RAIL_TOP_Y + 0.006, 9); // sits on the rail top
  });
});
