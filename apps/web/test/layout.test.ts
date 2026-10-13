import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { type SeatPos, type Xform, fanLayout, fanRowCounts, fanScreenW, handCardPlane, handFan, makeCamera, ndcExtentX, opponentFan, pileSpot, trickSpot } from '../src/three/layout';

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
      // each row is mirror-symmetric. A phone hand is two rows, so card i does not mirror card n-1-i.
      const centre = (sh: number[][]) => [sh.reduce((a, c) => a + c[0]!, 0) / 4, sh.reduce((a, c) => a + c[1]!, 0) / 4];
      const centres = shapes.map(centre);
      const rows: number[][] = [];
      for (let i = 0; i < n; i++) {
        const y = centres[i]![1]!;
        const row = rows.find((r) => Math.abs(centres[r[0]!]![1]! - y) < 8);
        if (row) row.push(i);
        else rows.push([i]);
      }
      for (const row of rows) {
        const ordered = [...row].sort((a, b) => centres[a]![0]! - centres[b]![0]!);
        for (let k = 0; k < ordered.length; k++) {
          const a = centres[ordered[k]!]!;
          const b = centres[ordered[ordered.length - 1 - k]!]!;
          expect(Math.abs(a[0]! + b[0]! - w)).toBeLessThan(1.5);
          expect(Math.abs(a[1]! - b[1]!)).toBeLessThan(1.5);
        }
      }
    });
  }
});

describe('hand fan z-order', () => {
  it('raised (playable / selected) cards sit in front of every resting card, keeping fan order among themselves', () => {
    for (const aspect of [16 / 9, 390 / 844, 844 / 390]) {
      const cam = makeCamera(aspect); cam.updateMatrixWorld();
      // view-space depth (what the depth buffer and the raycast order go by)
      const dist = (t: { p: number[] }) => -new Vector3(t.p[0], t.p[1], t.p[2]).applyMatrix4(cam.matrixWorldInverse).z;
      const n = 13, lifted = new Set([7, 8]);
      const fan = Array.from({ length: n }, (_, i) => handFan(aspect, n, i, lifted.has(i) ? 0.09 : 0));
      const farthestRaised = Math.max(...[...lifted].map((i) => dist(fan[i]!)));
      const nearestResting = Math.min(...fan.filter((_, i) => !lifted.has(i)).map(dist));
      expect(farthestRaised).toBeLessThan(nearestResting);
      expect(dist(fan[8]!)).toBeLessThan(dist(fan[7]!)); // fan order kept among raised cards
      expect(dist(handFan(aspect, n, 0, 0.24))).toBeLessThan(dist(fan[8]!)); // the selected card tops them all
    }
  });

  it('neighbouring cards are far enough apart in depth for a 16-bit depth buffer (iPhone Safari: no edges bleeding through)', () => {
    for (const aspect of [390 / 844, 16 / 9]) {
      const cam = makeCamera(aspect); cam.updateMatrixWorld();
      const dist = (t: { p: number[] }) => -new Vector3(t.p[0], t.p[1], t.p[2]).applyMatrix4(cam.matrixWorldInverse).z;
      for (const n of [5, 13, 18]) {
        const fan = Array.from({ length: n }, (_, i) => handFan(aspect, n, i, 0));
        for (let i = 1; i < n; i++) expect(dist(fan[i - 1]!) - dist(fan[i]!)).toBeGreaterThan(0.005);
        expect(dist(handFan(aspect, n, n - 1, 0.24))).toBeLessThan(Math.min(...fan.map(dist)));
      }
    }
  });
});

describe('hand fan shape', () => {
  it('each card is rolled to match the arc it sits on (no kinked end cards)', () => {
    for (const [w, h] of [[390, 844], [1280, 800]] as const) for (const n of [3, 5, 11, 13]) {
      const aspect = w / h;
      const plan = fanRowCounts(n, fanScreenW(aspect, h));
      let start = 0;
      for (const rowN of plan) {
        if (rowN < 2) { start += rowN; continue; }
        const cards = Array.from({ length: rowN }, (_, k) => handCardPlane(aspect, n, start + k, 0, 0, {}, 0, h));
        const left = cards[0]!;
        const right = cards[rowN - 1]!;
        const xo = (right.x - left.x) / 2;
        const curveK = Math.tan(left.roll) / (2 * xo);
        for (const card of cards) {
          expect(Math.abs(Math.atan(2 * curveK * card.x) + card.roll)).toBeLessThan(0.03);
        }
        start += rowN;
      }
    }
  });
});
