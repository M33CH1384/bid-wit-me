import { describe, expect, it } from 'vitest';
import { cleanRel } from '@spades/rules';
import { parseClientMsg } from '@spades/protocol';
import { CH, CW, FELT, TRICK_SCALE, trickSpot, type SeatPos } from '../src/three/layout';
import { MAX_SLIDE, MAX_SPIN, THROW_SPREAD, VISIBLE_FELT, clampLanding, cornerIndex, landTrick, landingMode, playSeed, restingOffset } from '../src/three/landing';

const size = { hw: (CW * TRICK_SCALE) / 2, hh: (CH * TRICK_SCALE) / 2 };
const felt = VISIBLE_FELT;
void FELT;
const seats: SeatPos[] = ['bottom', 'left', 'top', 'right'];
const spots = seats.map((s, i) => { const t = trickSpot(s, 4, i, 0); return { x: t.p[0], z: t.p[2] }; });

describe('landing is deterministic from the seed', () => {
  it('same seed + release → identical rest on every client', () => {
    const s = playSeed('abc', 3, 2, 'AS');
    expect(restingOffset(s, [1.2, -0.4])).toEqual(restingOffset(s, [1.2, -0.4]));
    expect(restingOffset(s)).toEqual(restingOffset(s));
    expect(playSeed('abc', 3, 2, 'AS')).toBe(s);
  });
  it('different plays vary (tap tosses are not all the same)', () => {
    const rests = ['AS', 'KH', '2C', 'BJ', '9D'].map((c) => JSON.stringify(restingOffset(playSeed('abc', 1, 0, c))));
    expect(new Set(rests).size).toBe(5);
  });
  it('throw direction moves the card that way, faster goes farther (capped)', () => {
    const s = playSeed('x', 1, 0, 'QS');
    const slow = restingOffset(s, [0.8, 0]), fast = restingOffset(s, [6, 0]), up = restingOffset(s, [0, -6]);
    expect(fast.dx).toBeGreaterThan(slow.dx);
    expect(up.dz).toBeLessThan(0);
    for (const l of [slow, fast, up]) { expect(Math.hypot(l.dx, l.dz)).toBeLessThanOrEqual(MAX_SLIDE + THROW_SPREAD * 1.5); expect(Math.abs(l.spin)).toBeLessThanOrEqual(MAX_SPIN); }
  });
  it('a whole trick lands identically twice', () => {
    const plays = ['AS', 'KS', 'QS', 'JS'].map((card, i) => ({ card, rel: i % 2 ? ([3, -2] as [number, number]) : undefined }));
    const run = () => landTrick(plays, spots, size, (c) => playSeed('g', 2, 5, c), felt);
    expect(run()).toEqual(run());
  });
});

describe('landing is clamped', () => {
  it('the top card stays on the visible felt with its corner index showing, and never sits squarely on another', () => {
    const inside = (p: { x: number; z: number }) => p.x >= felt.minX - 1e-9 && p.x <= felt.maxX + 1e-9 && p.z >= felt.minZ - 1e-9 && p.z <= felt.maxZ + 1e-9;
    for (let k = 0; k < 300; k++) {
      const plays = ['AS', 'KS', 'QS', 'JS'].map((card, i) => ({ card, rel: k % 3 ? ([((k * 7 + i * 13) % 40) / 4 - 5, ((k * 11 + i * 5) % 40) / 4 - 5] as [number, number]) : undefined }));
      const lands = landTrick(plays, spots, size, (c) => playSeed(`s${k}`, 1, 0, c), felt);
      const placed = lands.map((l, i) => ({ x: spots[i]!.x + l.dx, z: spots[i]!.z + l.dz, hw: size.hw, hh: size.hh, spin: l.spin }));
      placed.forEach((c, i) => {
        if (lands[i]!.dx === 0 && lands[i]!.dz === 0) return; // the seat's own fixed spot
        expect(inside(c)).toBe(true);
        expect(inside(cornerIndex(c))).toBe(true);
        for (let j = 0; j < i; j++) expect(Math.hypot(placed[j]!.x - c.x, placed[j]!.z - c.z)).toBeGreaterThanOrEqual(size.hw * 0.7 - 1e-9);
      });
    }
  });
  it('a throw off the table is pulled back toward the fixed spot', () => {
    const l = clampLanding({ x: 0, z: 0 }, size, { dx: 3, dz: 0, spin: 0.2 }, [], felt);
    expect(l.dx).toBeLessThan(1.2);
  });
});

describe('Tips-off landings look varied', () => {
  it('wide spread and rotation up to about ±35°, for throws and taps', () => {
    const taps = Array.from({ length: 200 }, (_, i) => restingOffset(playSeed('v', 1, 0, `c${i}`)));
    const throws = Array.from({ length: 200 }, (_, i) => restingOffset(playSeed('v', 2, 0, `c${i}`), [2, -3]));
    for (const set of [taps, throws]) {
      const spins = set.map((l) => l.spin);
      expect(Math.max(...spins)).toBeGreaterThan(0.45);
      expect(Math.min(...spins)).toBeLessThan(-0.35);
      expect(Math.max(...spins.map(Math.abs))).toBeLessThanOrEqual(MAX_SPIN + 1e-9);
    }
    const xs = taps.map((l) => l.dx);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.4);
  });
  it('swipe speed sets the slide distance', () => {
    const s = playSeed('d', 1, 0, 'AS');
    const d = (v: number) => { const l = restingOffset(s, [0, -v]); return -l.dz; };
    expect(d(4)).toBeGreaterThan(d(1.5));
  });
});

describe('Tips decide the landing, per viewer', () => {
  it('Tips ON: fixed per-seat spots (no offset)', () => {
    expect(landingMode(true)).toBe('fixed');
    expect(trickSpot('left', 4, 1, 0)).toEqual(trickSpot('left', 4, 1, 0, TRICK_SCALE));
  });
  it('Tips OFF: physics landing moves the spot', () => {
    expect(landingMode(false)).toBe('physics');
    const a = trickSpot('left', 4, 1, 0, TRICK_SCALE, { dx: 0.05, dz: -0.03, spin: 0.1 });
    const b = trickSpot('left', 4, 1, 0, TRICK_SCALE);
    expect(a.p[0]).toBeCloseTo(b.p[0] + 0.05, 6);
    expect(a.q).not.toEqual(b.q);
  });
});

describe('release vector on the wire', () => {
  it('is optional, finite and capped', () => {
    expect(cleanRel([1, 2])).toEqual([1, 2]);
    expect(cleanRel([NaN, 1])).toBeNull();
    expect(cleanRel([99, -99])).toEqual([20, -20]);
    const m = parseClientMsg({ t: 'act', action: { type: 'play', card: 'AS', rel: [1.5, -2] } }) as { action: { rel?: number[] } };
    expect(m.action.rel).toEqual([1.5, -2]);
    expect((parseClientMsg({ t: 'act', action: { type: 'play', card: 'AS' } }) as { action: { rel?: number[] } }).action.rel).toBeUndefined();
  });
});
