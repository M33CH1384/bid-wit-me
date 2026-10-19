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

describe('book piles live on the table rim, in a side-by-side row per player', () => {
  it('pile centre is on the rail band (just beyond the felt edge, inside the outer rail), from real geometry', () => {
    for (const [n, seats] of [[4, SEATS4], [3, SEATS3]] as const) {
      for (const pos of seats) {
        const d = seatDir(pos, n);
        const feltEdge = edgePoint(d, 0);
        const p = pileEdgePoint(pos, n);
        const radial = (v: Vector3) => v.x * d.x + v.z * d.z;
        // straddling the rim line: centre a hair inside the felt edge (portrait fit),
        // outer edge of the card over the rail, never beyond the outer rail edge
        expect(radial(p)).toBeGreaterThan(radial(feltEdge) - 0.15); // row centre inset for portrait fit (vertical books reach the rim line)
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

  it('one row per player: books side by side along the rim, woven overlap, slots stable as books arrive', () => {
    for (const pos of SEATS4) {
      const spots = Array.from({ length: 13 }, (_, k) => pileSpot(pos, 4, k, 0, 0));
      // every slot distinct, in a line along the seat's tangent, none moving
      for (let k = 1; k < 13; k++) expect(Math.hypot(spots[k].p[0] - spots[k-1].p[0], spots[k].p[2] - spots[k-1].p[2])).toBeGreaterThan(0.05);
      // adjacent books overlap slightly (centre step under a card width) but do not coincide
      const step = Math.hypot(spots[1].p[0] - spots[0].p[0], spots[1].p[2] - spots[0].p[2]);
      expect(step).toBeLessThan(CW * 0.92);
      expect(step).toBeGreaterThan(0.05);
      // full 13-book row stays on the table
      for (const s of spots) { expect(Math.abs(s.p[0])).toBeLessThanOrEqual(FELT.hx + RAIL); expect(Math.abs(s.p[2])).toBeLessThanOrEqual(FELT.hz + RAIL); }
    }
  });

  it('odd books vertical (long edge front-to-back), even books horizontal (rotated 90°)', () => {
    for (const pos of SEATS4) {
      const d = seatDir(pos, 4);
      const longAxis = (k: number) => rect(pileSpot(pos, 4, k, 0, 0)).axes[1];
      for (const k of [0, 2, 4]) expect(Math.abs(longAxis(k).dot(d))).toBeGreaterThan(0.99); // portrait: long axis radial
      for (const k of [1, 3, 5]) expect(Math.abs(longAxis(k).dot(d))).toBeLessThan(0.01); // landscape: long axis along rim
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
    // each book in the row is its own flat mini-stack: one book (4 cards)
    // rises ~0.005 and every book has the same profile, never the ~23cm tower
    const oneBook = pileSpot('bottom', 4, 12, 3, 0).p[1] - pileSpot('bottom', 4, 12, 0, 0).p[1];
    expect(oneBook).toBeCloseTo(pileRise(3), 9);
    expect(oneBook).toBeLessThan(0.006);
    expect(pileSpot('bottom', 4, 12, 0, 0).p[1]).toBeCloseTo(pileSpot('bottom', 4, 0, 0, 0).p[1], 9); // no steps across the row
    for (let i = 1; i <= 12; i++) expect(pileRise(i)).toBeGreaterThan(pileRise(i - 1));
    expect(pileSpot('bottom', 4, 0, 0, 0).p[1]).toBeCloseTo(RAIL_TOP_Y + 0.02, 9); // sits on the rail top (FELT_REST_Y raised to 0.02, Demetrius 2026-10-19)
  });
});
