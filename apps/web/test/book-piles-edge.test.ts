import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  CT, CW, CH, FELT, RAIL, handFan, opponentFan, pileEdgePoint, pileRise, pileSpot, trickSpot,
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
/** Signed distance to a rounded rect centred on the origin (negative inside). */
function rrSdf(x: number, z: number, hx: number, hz: number, r: number): number {
  const qx = Math.abs(x) - (hx - r), qz = Math.abs(z) - (hz - r);
  const ax = Math.max(qx, 0), az = Math.max(qz, 0);
  return Math.hypot(ax, az) + Math.min(Math.max(qx, qz), 0) - r;
}

// --- 3D SAT volumes for the hands check (round-3 machinery) ---
interface OBB { c: Vector3; axes: [Vector3, Vector3, Vector3]; h: [number, number, number] }
function obbFromXf(p: [number, number, number], q: [number, number, number, number], hx: number, hy: number, hz: number): OBB {
  const Q = new Quaternion(...q);
  return { c: new Vector3(...p), axes: [new Vector3(1, 0, 0).applyQuaternion(Q), new Vector3(0, 1, 0).applyQuaternion(Q), new Vector3(0, 0, 1).applyQuaternion(Q)], h: [hx, hy, hz] };
}
function satIntersect(a: OBB, b: OBB): boolean {
  const axes: Vector3[] = [...a.axes, ...b.axes];
  for (const u of a.axes) for (const v of b.axes) {
    const c = new Vector3().crossVectors(u, v);
    if (c.lengthSq() > 1e-8) axes.push(c.normalize());
  }
  const d = b.c.clone().sub(a.c);
  for (const L of axes) {
    const ra = a.h[0] * Math.abs(L.dot(a.axes[0])) + a.h[1] * Math.abs(L.dot(a.axes[1])) + a.h[2] * Math.abs(L.dot(a.axes[2]));
    const rb = b.h[0] * Math.abs(L.dot(b.axes[0])) + b.h[1] * Math.abs(L.dot(b.axes[1])) + b.h[2] * Math.abs(L.dot(b.axes[2]));
    if (Math.abs(L.dot(d)) > ra + rb) return false;
  }
  return true;
}
function fanVolumes(owner: SeatPos, n: number, count: number): OBB[] {
  const out: OBB[] = [];
  for (const rest of [0, 1]) {
    for (let i = 0; i < count; i++) {
      const xf = opponentFan(owner, n, i, count, rest, rest);
      out.push(obbFromXf(xf.p, xf.q, CW / 2, CH / 2, 0.004));
    }
    const mid = opponentFan(owner, n, Math.floor(count / 2), count, rest, rest);
    const C = new Vector3(...mid.p); const Q = new Quaternion(...mid.q);
    const right = new Vector3(1, 0, 0).applyQuaternion(Q);
    const up = new Vector3(0, 1, 0).applyQuaternion(Q);
    const normal = new Vector3(0, 0, 1).applyQuaternion(Q);
    const c = C.clone().addScaledVector(up, -0.165).addScaledVector(normal, 0.065);
    out.push({ c, axes: [right, up, normal], h: [0.2, 0.105, 0.11] });
  }
  if (owner === 'bottom') {
    for (const aspect of [390 / 844, 430 / 932, 1280 / 800]) {
      for (let i = 0; i < count; i++) {
        const xf = handFan(aspect, count, i, 0);
        out.push(obbFromXf(xf.p, xf.q, (CW * xf.s) / 2, (CH * xf.s) / 2, 0.004));
      }
      const lifted = handFan(aspect, count, Math.floor(count / 2), 0.24);
      out.push(obbFromXf(lifted.p, lifted.q, (CW * lifted.s) / 2, (CH * lifted.s) / 2, 0.004));
    }
  }
  return out;
}

describe('book piles ride the rim: on the edge, clear of hands and played cards', () => {
  it('every slot centre sits on the felt/rail seam, and every book stays fully on the table', () => {
    // Owner 2026-11-01 (second pile report): the collected books belong
    // "on the edge of the table" — centres on the felt boundary itself,
    // bridging the rail at rail height — while never hanging off the
    // table (the #240 portrait-fit rule, kept in SDF form).
    for (const [n, seats] of [[4, SEATS4], [3, SEATS3]] as const) {
      const slots = n === 3 ? 17 : 13;
      for (const pos of seats) {
        const start = pileEdgePoint(pos, n);
        const slot0 = pileSpot(pos, n, 0, 0, 0);
        expect(Math.hypot(start.x - slot0.p[0], start.z - slot0.p[2])).toBeLessThan(1e-9);
        for (let k = 0; k < slots; k++) {
          const xf = pileSpot(pos, n, k, 0, 0);
          expect(Math.abs(rrSdf(xf.p[0], xf.p[2], FELT.hx, FELT.hz, FELT.r)), `${pos} n=${n} slot ${k} on the seam`).toBeLessThanOrEqual(0.01);
          const r = rect(xf);
          for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
            const corner = r.c.clone().add(r.axes[0].clone().multiplyScalar(sx * r.half[0])).add(r.axes[1].clone().multiplyScalar(sy * r.half[1]));
            expect(rrSdf(corner.x, corner.z, FELT.hx + RAIL, FELT.hz + RAIL, FELT.r + RAIL), `${pos} n=${n} slot ${k} corner on table`).toBeLessThanOrEqual(0);
          }
        }
      }
    }
  });

  it('one row per player: books side by side along the rim, woven overlap, slots stable as books arrive', () => {
    for (const pos of SEATS4) {
      const spots = Array.from({ length: 13 }, (_, k) => pileSpot(pos, 4, k, 0, 0));
      for (let k = 1; k < 13; k++) expect(Math.hypot(spots[k].p[0] - spots[k - 1].p[0], spots[k].p[2] - spots[k - 1].p[2])).toBeGreaterThan(0.05);
      const step = Math.hypot(spots[1].p[0] - spots[0].p[0], spots[1].p[2] - spots[0].p[2]);
      expect(step).toBeLessThan(CW * 0.92);
      expect(step).toBeGreaterThan(0.05);
      for (const s of spots) { expect(Math.abs(s.p[0])).toBeLessThanOrEqual(FELT.hx + RAIL); expect(Math.abs(s.p[2])).toBeLessThanOrEqual(FELT.hz + RAIL); }
    }
  });

  it('odd books vertical (long axis across the rim), even books horizontal (along the rim)', () => {
    // The weave follows the rim's local frame, including around corners:
    // judge each book against the row's local direction, not the seat's.
    for (const [n, seats] of [[4, SEATS4], [3, SEATS3]] as const) {
      const slots = n === 3 ? 17 : 13;
      for (const pos of seats) {
        const spots = Array.from({ length: slots }, (_, k) => pileSpot(pos, n, k, 0, 0));
        const longAxis = (k: number) => rect(spots[k]).axes[1];
        for (let k = 0; k < slots; k++) {
          // local rim direction from the nearest neighbours in the same
          // cluster (adjacent slots are <=0.10 apart; a cluster jump is
          // ~1 or more, so far neighbours are not the local rim)
          const near = (j: number) => j >= 0 && j < slots && Math.hypot(spots[j].p[0] - spots[k].p[0], spots[j].p[2] - spots[k].p[2]) <= 0.15;
          const a = near(k - 1) ? spots[k - 1].p : spots[k].p;
          const b = near(k + 1) ? spots[k + 1].p : spots[k].p;
          const dir = new Vector3(b[0] - a[0], 0, b[2] - a[2]).normalize();
          const dot = Math.abs(longAxis(k).dot(dir));
          if (k % 2 === 0) expect(dot, `${pos} n=${n} book ${k} vertical`).toBeLessThan(0.08);
          else expect(dot, `${pos} n=${n} book ${k} horizontal`).toBeGreaterThan(0.985);
        }
      }
    }
  });

  it('rim stacks never overlap any seat’s trick landing spot, with margin to spare', () => {
    // Owner 2026-11-01: books must not be "in the way of the played
    // cards". Every slot, every seat's fixed landing spot, the spot
    // inflated by 0.05 — the old test checked only slot 0, uninflated.
    for (const [n, seats] of [[4, SEATS4], [3, SEATS3]] as const) {
      const slots = n === 3 ? 17 : 13;
      for (const winner of seats) {
        for (let k = 0; k < slots; k++) {
          const pile = rect(pileSpot(winner, n, k, 0, 0));
          for (const source of seats) for (const order of [0, 1, 2, 3]) {
            const spot = rect(trickSpot(source, n, order, 0));
            const fat = { ...spot, half: [spot.half[0] + 0.05, spot.half[1] + 0.05] as const };
            expect(overlaps(pile, fat), `${winner} pile slot ${k} vs ${source} trick (n=${n})`).toBe(false);
          }
        }
      }
    }
  });

  it('books never intersect any fan or grip volume (owner 2026-11-01: piles poking through hands)', () => {
    // Slot k lands after trick k+1, when every fan at the table holds
    // handSize-(k+1) cards — judge each slot against the fans as they
    // actually are at that moment (open and rested, plus the grip, plus
    // the human's own hand fan for the bottom seat), own and cross-seat,
    // at jitter extremes.
    for (const [n, seats] of [[4, SEATS4], [3, SEATS3]] as const) {
      const slots = n === 3 ? 17 : 13;
      const handSize = n === 3 ? 17 : 13;
      for (const pos of seats) {
        for (let k = 0; k < slots; k++) {
          const fanCount = handSize - (k + 1);
          if (fanCount <= 0) continue;
          const vols = seats.flatMap((owner) => fanVolumes(owner, n, fanCount));
          for (const j of [-1, 0, 1]) {
            const xf = pileSpot(pos, n, k, 0, j);
            const book = obbFromXf(xf.p, xf.q, (CW * xf.s) / 2, (CH * xf.s) / 2, 0.03);
            book.c.y = xf.p[1] + 0.004;
            for (const v of vols) {
              expect(satIntersect(book, v), `${pos} n=${n} slot ${k} jitter ${j} vs a fan/grip volume`).toBe(false);
            }
          }
        }
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
