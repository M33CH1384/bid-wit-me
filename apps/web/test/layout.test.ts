import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { type SeatPos, type Xform, CH, CW, FELT, HAND_EXPOSED_PX, KING_GUN_FOOTPRINT, TRICK_SCALE, deckSpot, fanCssPx, fanLayout, handFan, kingGunSpot, makeCamera, ndcCorners, ndcExtentX, opponentFan, phoneHandFan, pileSpot, trickSpot } from '../src/three/layout';

// CSS-pixel viewports: iPhone SE, 12/13/14, 14 Pro Max, small Android, desktop, and iPhone landscape
const VIEWPORTS: [number, number][] = [[320, 568], [375, 667], [390, 844], [393, 852], [430, 932], [360, 740], [1280, 800], [1920, 1080], [844, 390]];
const SEATS: Record<number, SeatPos[]> = { 4: ['bottom', 'left', 'top', 'right'], 3: ['bottom', 'left', 'right'] };

const inside = (aspect: number, xs: Xform[], margin: number) => {
  const [lo, hi] = ndcExtentX(aspect, xs);
  expect(lo).toBeGreaterThanOrEqual(-1 + margin);
  expect(hi).toBeLessThanOrEqual(1 - margin);
  return [lo, hi];
};

describe('3D hand fan fits the viewport', () => {
  for (const [w, h] of VIEWPORTS) {
    const aspect = w / h;
    for (const count of [1, 5, 13, 17, 18]) {
      it(`${w}x${h} — ${count} cards, any card lifted`, () => {
        // NDC margin of 0.06 ≈ 3% of the width on each side
        const base = Array.from({ length: count }, (_, i) => handFan(aspect, count, i, 0.07));
        const [lo, hi] = inside(aspect, base, 0.1); // ≥5% of the width clear on each side
        expect(Math.abs(lo + hi)).toBeLessThan(0.05); // centered (later cards sit a hair nearer the camera so they overlap correctly)
        for (const lifted of [0, count - 1]) inside(aspect, [handFan(aspect, count, lifted, 0.24)], 0.1);
      });
    }
    it(`${w}x${h} — safe-area inset pushes the fan inward`, () => {
      const plain = ndcExtentX(aspect, Array.from({ length: 13 }, (_, i) => handFan(aspect, 13, i, 0)));
      const safe = ndcExtentX(aspect, Array.from({ length: 13 }, (_, i) => handFan(aspect, 13, i, 0, 0.06)));
      expect(safe[1]).toBeLessThanOrEqual(1 - 2 * 0.06);
      expect(safe[1]).toBeLessThanOrEqual(plain[1] + 1e-9);
    });
    for (const n of [3, 4]) {
      it(`${w}x${h} — ${n}p opponent fans, trick cards and piles stay on screen`, () => {
        for (const pos of SEATS[n]!) {
          if (pos === 'bottom') continue;
          inside(aspect, Array.from({ length: 18 }, (_, i) => opponentFan(pos, n, i, 18)), 0.02);
        }
        for (const pos of SEATS[n]!) inside(aspect, [trickSpot(pos, n, 0, 1), trickSpot(pos, n, 0, -1)], 0.1);
        for (const pos of SEATS[n]!) inside(aspect, Array.from({ length: 6 }, (_, k) => pileSpot(pos, n, k, 0, 0)), 0.02);
      });
    }
  }
});

describe('hand fan is undistorted and mirror-symmetric on screen', () => {
  for (const [w, h] of [[390, 844], [430, 932], [375, 667], [1280, 800]] as const) {
    it(`${w}x${h}`, async () => {
      const { ndcCorners } = await import('../src/three/layout');
      const aspect = w / h;
      const n = 13;
      const px = (c: [number, number]) => [((c[0] + 1) / 2) * w, ((1 - c[1]) / 2) * h];
      const shapes = Array.from({ length: n }, (_, i) => ndcCorners(aspect, handFan(aspect, n, i, 0)).map(px));
      const len = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
      const w0 = len(shapes[0]![0]!, shapes[0]![1]!), h0 = len(shapes[0]![1]!, shapes[0]![2]!);
      for (const sh of shapes) {
        // same size for every card (< 0.3 px), opposite edges equal (no keystone/stretch)
        expect(Math.abs(len(sh[0]!, sh[1]!) - w0)).toBeLessThan(0.3);
        expect(Math.abs(len(sh[1]!, sh[2]!) - h0)).toBeLessThan(0.3);
        expect(Math.abs(len(sh[0]!, sh[1]!) - len(sh[3]!, sh[2]!))).toBeLessThan(0.3);
        expect(Math.abs(len(sh[1]!, sh[2]!) - len(sh[0]!, sh[3]!))).toBeLessThan(0.3);
      }
      // card i mirrors card n-1-i around the screen centre
      const centre = (sh: number[][]) => [sh.reduce((a, c) => a + c[0]!, 0) / 4, sh.reduce((a, c) => a + c[1]!, 0) / 4];
      for (let i = 0; i < n; i++) {
        const a = centre(shapes[i]!), b = centre(shapes[n - 1 - i]!);
        expect(Math.abs(a[0]! + b[0]! - w)).toBeLessThan(0.5);
        expect(Math.abs(a[1]! - b[1]!)).toBeLessThan(0.5);
      }
    });
  }
});

describe('hand fan z-order', () => {
  it('puts a raised card in front of the neighbours it overlaps', () => {
    for (const aspect of [16 / 9, 390 / 844, 844 / 390]) {
      const cam = makeCamera(aspect); cam.updateMatrixWorld();
      // view-space depth (what the depth buffer and the raycast order go by)
      const dist = (t: { p: number[] }) => -new Vector3(t.p[0], t.p[1], t.p[2]).applyMatrix4(cam.matrixWorldInverse).z;
      const n = 13;
      const fan = Array.from({ length: n }, (_, i) => handFan(aspect, n, i, i === 7 || i === 8 ? 0.09 : 0));
      for (let i = 1; i < n; i++) expect(dist(fan[i]!)).toBeLessThan(dist(fan[i - 1]!));
      // Index 6 raised. The three cards on either side are the ones that share pixels with it.
      const raised = handFan(aspect, n, 6, 0.24, 0, { layer: 'selected' });
      for (const j of [3, 4, 5, 7, 8, 9]) {
        expect(dist(raised)).toBeLessThan(dist(handFan(aspect, n, j, 0, 0, { layer: 'play' })));
        expect(dist(raised)).toBeLessThan(dist(handFan(aspect, n, j, 0)));
      }
    }
  });

  it('neighbouring cards are far enough apart in depth for a 16-bit depth buffer (iPhone Safari: no edges bleeding through)', () => {
    for (const aspect of [390 / 844, 16 / 9]) {
      const cam = makeCamera(aspect); cam.updateMatrixWorld();
      const dist = (t: { p: number[] }) => -new Vector3(t.p[0], t.p[1], t.p[2]).applyMatrix4(cam.matrixWorldInverse).z;
      for (const n of [5, 13, 18]) {
        const fan = Array.from({ length: n }, (_, i) => handFan(aspect, n, i, 0));
        for (let i = 1; i < n; i++) expect(dist(fan[i - 1]!) - dist(fan[i]!)).toBeGreaterThan(0.005);
        const last = n - 1;
        const raised = dist(handFan(aspect, n, last, 0.24, 0, { layer: 'selected' }));
        // The raised end card sits in front of the neighbour it overlaps, still clear of a 16-bit step.
        expect(dist(fan[last - 1]!) - raised).toBeGreaterThan(0.005);
        expect(raised).toBeLessThan(dist(fan[last]!));
      }
    }
  });
});

describe('phone portrait hand', () => {
  const opts = phoneHandFan();
  for (const [w, h] of [[390, 844], [336, 700]] as const) {
    for (const n of [13, 17]) {
      it(`${w}px holds ${n} cards, larger than the default fan, with no horizontal clip`, () => {
        const aspect = w / h;
        const phone = fanCssPx(fanLayout(aspect, n, 0, opts), w);
        const base = fanCssPx(fanLayout(aspect, n), w);
        expect(phone.height).toBeGreaterThan(base.height + 4);
        expect(phone.width).toBeGreaterThan(base.width);
        expect(phone.exposed).toBeGreaterThan(base.exposed);
        const xs = Array.from({ length: n }, (_, i) => handFan(aspect, n, i, 0, 0, opts));
        const [lo, hi] = ndcExtentX(aspect, xs);
        expect(lo).toBeGreaterThanOrEqual(-0.99);
        expect(hi).toBeLessThanOrEqual(0.99);
        for (const t of xs) {
          for (const [, y] of ndcCorners(aspect, t)) {
            expect(y).toBeGreaterThanOrEqual(-1);
            expect(y).toBeLessThanOrEqual(1);
          }
        }
        const raised = ndcExtentX(aspect, [handFan(aspect, n, Math.floor(n / 2), 0.24, 0, opts)]);
        expect(raised[0]).toBeGreaterThanOrEqual(-1);
        expect(raised[1]).toBeLessThanOrEqual(1);
      });
    }
  }

  it('exposes at least 44px on a short hand at 390px', () => {
    expect(fanCssPx(fanLayout(390 / 844, 6, 0, opts), 390).exposed).toBeGreaterThanOrEqual(HAND_EXPOSED_PX);
    expect(fanCssPx(fanLayout(390 / 844, 5, 0, opts), 390).exposed).toBeGreaterThanOrEqual(HAND_EXPOSED_PX);
  });
});

describe('hand fan shape', () => {
  it('each card is rolled to match the arc it sits on (no kinked end cards)', () => {
    for (const aspect of [390 / 844, 16 / 9]) for (const n of [3, 5, 11, 13]) {
      const L = fanLayout(aspect, n, 0, {});
      const halfN = (n - 1) / 2;
      for (let i = 0; i < n; i++) {
        const x = (i - halfN) * L.step;
        const roll = -((i - halfN) / halfN) * L.maxRoll;
        expect(Math.abs(Math.atan(2 * L.curveK * x) + roll)).toBeLessThan(0.03); // arc slope ≈ card tilt
      }
    }
  });
});

describe("the King's gun spot (double or nothing, leg 2)", () => {
  // Plan-view rects on the felt. Cards lie in their local XY plane; the gun
  // is modelled in plan (local XZ). SAT overlap on both rects' axes.
  interface Rect2 { c: Vector3; ax: [Vector3, Vector3]; half: [number, number] }
  const rectOf = (x: Xform, w: number, h: number, plane: 'xy' | 'xz'): Rect2 => {
    const q = new Quaternion(...x.q);
    const a0 = new Vector3(1, 0, 0).applyQuaternion(q);
    const a1 = (plane === 'xy' ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1)).applyQuaternion(q);
    for (const a of [a0, a1]) { a.y = 0; a.normalize(); }
    return { c: new Vector3(x.p[0], 0, x.p[2]), ax: [a0, a1], half: [w / 2, h / 2] };
  };
  const cornersOf = (r: Rect2): Vector3[] => {
    const out: Vector3[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      out.push(r.c.clone().add(r.ax[0].clone().multiplyScalar(sx * r.half[0])).add(r.ax[1].clone().multiplyScalar(sz * r.half[1])));
    }
    return out;
  };
  const overlaps = (a: Rect2, b: Rect2): boolean => {
    const ca = cornersOf(a);
    const cb = cornersOf(b);
    for (const axis of [...a.ax, ...b.ax]) {
      const pa = ca.map((p) => p.dot(axis));
      const pb = cb.map((p) => p.dot(axis));
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
    return true;
  };
  const gunRect = (pos: SeatPos) => rectOf(kingGunSpot(pos, 4), KING_GUN_FOOTPRINT.len, KING_GUN_FOOTPRINT.wid, 'xz');
  const seats: SeatPos[] = ['bottom', 'left', 'top', 'right'];

  it('lies inside the felt from every seat', () => {
    for (const pos of seats) {
      for (const c of cornersOf(gunRect(pos))) {
        expect(Math.abs(c.x)).toBeLessThanOrEqual(FELT.hx + 1e-9);
        expect(Math.abs(c.z)).toBeLessThanOrEqual(FELT.hz + 1e-9);
      }
    }
  });

  it("clears every trick landing, deck spot and book at the King's seat (left)", () => {
    const gun = gunRect('left');
    for (const seat of seats) {
      for (let order = 0; order < 4; order++) {
        // the resting card: flat, with a generous physics slide + spin
        const landed = trickSpot(seat, 4, order, 0.5, TRICK_SCALE, { dx: 0.04, dz: 0.03, spin: 0.3 });
        expect(overlaps(gun, rectOf(landed, TRICK_SCALE * CW, TRICK_SCALE * CH, 'xy'))).toBe(false);
      }
      expect(overlaps(gun, rectOf(deckSpot(seat, 4), CW, CH, 'xy'))).toBe(false);
    }
    // every book the King could win in a hand (13 tricks, full-size rects)
    for (let book = 0; book < 13; book++) {
      expect(overlaps(gun, rectOf(pileSpot('left', 4, book, 0, 0), CW, CH, 'xy'))).toBe(false);
    }
  });
});
