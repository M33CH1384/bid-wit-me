import { describe, expect, it } from 'vitest';
import { cleanRel } from '@spades/rules';
import { parseClientMsg } from '@spades/protocol';
import { CH, CW, FELT, TRICK_SCALE, trickSpot, type SeatPos } from '../src/three/layout';
import { MAX_SLIDE, MAX_SPIN, NO_LANDING, clampLanding, cornerIndex, covers, landTrick, landingMode, playSeed, restingOffset } from '../src/three/landing';

const size = { hw: (CW * TRICK_SCALE) / 2, hh: (CH * TRICK_SCALE) / 2 };
const felt = { minX: -FELT.hx, maxX: FELT.hx, minZ: -FELT.hz, maxZ: FELT.hz };
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
    for (const l of [slow, fast, up]) { expect(Math.hypot(l.dx, l.dz)).toBeLessThanOrEqual(MAX_SLIDE + 0.03); expect(Math.abs(l.spin)).toBeLessThanOrEqual(MAX_SPIN); }
  });
  it('a whole trick lands identically twice', () => {
    const plays = ['AS', 'KS', 'QS', 'JS'].map((card, i) => ({ card, rel: i % 2 ? ([3, -2] as [number, number]) : undefined }));
    const run = () => landTrick(plays, spots, size, (c) => playSeed('g', 2, 5, c), felt);
    expect(run()).toEqual(run());
  });
});

describe('landing is clamped', () => {
  it('stays on the felt and never covers a corner index of a card already down', () => {
    for (let k = 0; k < 300; k++) {
      const plays = ['AS', 'KS', 'QS', 'JS'].map((card, i) => ({ card, rel: k % 3 ? ([((k * 7 + i * 13) % 40) / 4 - 5, ((k * 11 + i * 5) % 40) / 4 - 5] as [number, number]) : undefined }));
      const lands = landTrick(plays, spots, size, (c) => playSeed(`s${k}`, 1, 0, c), felt);
      const placed = lands.map((l, i) => ({ x: spots[i]!.x + l.dx, z: spots[i]!.z + l.dz, hw: size.hw, hh: size.hh, spin: l.spin }));
      placed.forEach((c, i) => {
        const r = Math.hypot(c.hw, c.hh) * 0.6;
        expect(c.x - r).toBeGreaterThanOrEqual(felt.minX - 1e-9);
        expect(c.x + r).toBeLessThanOrEqual(felt.maxX + 1e-9);
        for (let j = 0; j < i; j++) if (lands[i] !== NO_LANDING && (lands[i]!.dx || lands[i]!.dz || lands[i]!.spin)) expect(covers(c, cornerIndex(placed[j]!))).toBe(false);
      });
    }
  });
  it('falls back toward the fixed spot when a throw would hide an index', () => {
    const under = [{ x: 0, z: 0, hw: size.hw, hh: size.hh, spin: 0 }];
    const l = clampLanding({ x: size.hw * 2.2, z: 0 }, size, { dx: -size.hw * 2, dz: 0, spin: 0 }, under, felt);
    expect(Math.abs(l.dx)).toBeLessThan(size.hw * 2);
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
