import { describe, expect, it } from 'vitest';
import {
  FAN_REST_MS, fanRestAnim, fanRestSeconds, fanRestTarget, setFanRestTarget, stepFanRest,
} from '../src/three/fanRest';
import {
  type FanOpts, cardScreenQuad, handCardPlane, handFan, opponentFan,
} from '../src/three/layout';

/**
 * Fan rest (owner 2026-10-28): landscape + Standing only, a seat's fan lowers
 * and tightens while that seat is off-turn, and opens for the seat to act.
 * The human seat is NOT exempt.
 */

const LAND = 844 / 390; // the capture viewport: phone landscape
const PORTRAIT = 390 / 844;
/** The human fan's opts in phone landscape, as Scene builds them (`short` branch). */
const landOpts = (rest = 0): FanOpts => ({
  short: true, view: 'standing', reserveFrac: 0.28, bottomFrac: 0, heightFrac: 0.32,
  minStripPx: 28, pxW: 844, rest,
});
const N = 13;

describe('fanRestTarget: scope + turn gate', () => {
  it('landscape + standing + off-turn rests; the acting seat is open', () => {
    expect(fanRestTarget({ aspect: LAND, view: 'standing', seatIsActive: false })).toBe(1);
    expect(fanRestTarget({ aspect: LAND, view: 'standing', seatIsActive: true })).toBe(0);
  });
  it('portrait is always open, whichever seat is acting', () => {
    expect(fanRestTarget({ aspect: PORTRAIT, view: 'standing', seatIsActive: false })).toBe(0);
    expect(fanRestTarget({ aspect: 0.5, view: 'standing', seatIsActive: false })).toBe(0);
    expect(fanRestTarget({ aspect: 1, view: 'standing', seatIsActive: false })).toBe(0); // square is not landscape
  });
  it('sitting is always open, even in landscape off-turn', () => {
    expect(fanRestTarget({ aspect: LAND, view: 'sitting', seatIsActive: false })).toBe(0);
    expect(fanRestTarget({ aspect: 16 / 9, view: 'sitting', seatIsActive: false })).toBe(0);
  });
  it('wide landscape (tablet / desktop) also rests — aspect is the gate, not the short flag', () => {
    expect(fanRestTarget({ aspect: 1180 / 820, view: 'standing', seatIsActive: false })).toBe(1);
    expect(fanRestTarget({ aspect: 16 / 9, view: 'standing', seatIsActive: false })).toBe(1);
  });
  it('no seat is exempt: the gate never asks which seat it is (the human rests off-turn too)', () => {
    // fanRestTarget takes no seat index at all — for every seat, active opens and inactive rests.
    for (let seat = 0; seat < 4; seat++) {
      void seat;
      expect(fanRestTarget({ aspect: LAND, view: 'standing', seatIsActive: true })).toBe(0);
      expect(fanRestTarget({ aspect: LAND, view: 'standing', seatIsActive: false })).toBe(1);
    }
  });
  it('a dead aspect (0 / NaN canvas) never rests', () => {
    expect(fanRestTarget({ aspect: 0, view: 'standing', seatIsActive: false })).toBe(0);
    expect(fanRestTarget({ aspect: Number.NaN, view: 'standing', seatIsActive: false })).toBe(0);
  });
});

describe('human fan rest pose (handCardPlane / handFan transforms)', () => {
  const open = (i: number) => handCardPlane(LAND, N, i, 0, 0, landOpts(0), 0, 390);
  const rest = (i: number) => handCardPlane(LAND, N, i, 0, 0, landOpts(1), 0, 390);

  it('rest is the open pose exactly when the amount is 0 (portrait/sitting callers pass 0)', () => {
    for (let i = 0; i < N; i++) expect(rest0(i)).toEqual(open(i));
    function rest0(i: number) { return handCardPlane(LAND, N, i, 0, 0, landOpts(0), 0, 390); }
  });
  it('every card sits LOWER at rest than open (anchor Y down, centre and ends alike)', () => {
    for (let i = 0; i < N; i++) expect(rest(i).y).toBeLessThan(open(i).y - 0.02);
    const mean = (f: (i: number) => number) => Array.from({ length: N }, (_, i) => f(i)).reduce((a, b) => a + b, 0) / N;
    expect(mean((i) => rest(i).y)).toBeLessThan(mean((i) => open(i).y));
  });
  it('the fan is TIGHTER at rest: adjacent gap and total span both shrink, roll closes', () => {
    for (let i = 0; i < N - 1; i++) {
      expect(rest(i + 1).x - rest(i).x).toBeLessThan(open(i + 1).x - open(i).x);
    }
    expect(rest(N - 1).x - rest(0).x).toBeLessThan((open(N - 1).x - open(0).x) * 0.75);
    for (let i = 0; i < N; i++) expect(Math.abs(rest(i).roll)).toBeLessThanOrEqual(Math.abs(open(i).roll) + 1e-9);
    expect(Math.abs(rest(0).roll)).toBeLessThan(Math.abs(open(0).roll));
  });
  it('card scale never changes with rest (no resize pop on a turn change)', () => {
    for (let i = 0; i < N; i++) expect(rest(i).s).toBe(open(i).s);
  });
  it('on screen: the rested fan projects lower and narrower, and stays on screen horizontally', () => {
    const quad = (r: number, i: number) => cardScreenQuad(LAND, handFan(LAND, N, i, 0, 0, landOpts(r), 0, 390), 844, 390, 0, true, 'standing');
    const centreY = (r: number, i: number) => quad(r, i).reduce((a, p) => a + p.y, 0) / 4;
    for (let i = 0; i < N; i++) expect(centreY(1, i)).toBeGreaterThan(centreY(0, i) + 10); // screen y grows downward
    const span = (r: number) => {
      const xs = Array.from({ length: N }, (_, i) => quad(r, i)).flatMap((q) => q.map((p) => p.x));
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(span(1)).toBeLessThan(span(0));
    const xs = Array.from({ length: N }, (_, i) => quad(1, i)).flatMap((q) => q.map((p) => p.x));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(844);
  });
  it('a part-way amount lies strictly between open and rest (bounded, no overshoot past open)', () => {
    const mid = (i: number) => handCardPlane(LAND, N, i, 0, 0, landOpts(0.5), 0, 390);
    for (let i = 0; i < N; i++) {
      expect(mid(i).y).toBeLessThan(open(i).y);
      expect(mid(i).y).toBeGreaterThan(rest(i).y);
      expect(Math.abs(mid(i).x)).toBeLessThanOrEqual(Math.abs(open(i).x) + 1e-9);
      expect(Math.abs(mid(i).x)).toBeGreaterThanOrEqual(Math.abs(rest(i).x) - 1e-9);
    }
  });
});

describe('opponent fan rest pose (opponentFan transforms)', () => {
  const positions = ['bottom', 'left', 'top', 'right'] as const;
  it('rest 0 reproduces today\'s fan exactly', () => {
    for (const pos of positions) {
      for (let i = 0; i < 9; i++) expect(opponentFan(pos, 4, i, 9, 0)).toEqual(opponentFan(pos, 4, i, 9));
    }
  });
  it('every resting card is lower (world Y down) and the fan is tighter', () => {
    for (const pos of positions) {
      const open = Array.from({ length: 9 }, (_, i) => opponentFan(pos, 4, i, 9, 0));
      const rest = Array.from({ length: 9 }, (_, i) => opponentFan(pos, 4, i, 9, 1));
      for (let i = 0; i < 9; i++) expect(rest[i]!.p[1]).toBeLessThan(open[i]!.p[1] - 0.05);
      const gap = (xs: typeof open) => Math.hypot(xs[5]!.p[0] - xs[4]!.p[0], xs[5]!.p[2] - xs[4]!.p[2]);
      expect(gap(rest)).toBeLessThan(gap(open));
      const span = (xs: typeof open) => Math.hypot(xs[8]!.p[0] - xs[0]!.p[0], xs[8]!.p[2] - xs[0]!.p[2]);
      expect(span(rest)).toBeLessThan(span(open));
    }
  });
});

describe('fan rest easing (FanRestAnim)', () => {
  it('takes FAN_REST_MS: unhurried, not a snap, and lands exactly on target', () => {
    expect(FAN_REST_MS).toBeGreaterThanOrEqual(500);
    expect(FAN_REST_MS).toBeLessThanOrEqual(800);
    expect(fanRestSeconds(false)).toBe(FAN_REST_MS / 1000);
    let a = setFanRestTarget(fanRestAnim(0), 1);
    a = stepFanRest(a, 100);
    expect(a.value).toBeGreaterThan(0);
    expect(a.value).toBeLessThan(0.6); // 100ms in, still travelling
    let guard = 0;
    while (a.t < 1 && guard++ < 200) a = stepFanRest(a, 16);
    expect(a.value).toBe(1);
    expect(a.t).toBe(1);
  });
  it('is monotonic and bounded on the way down and on the way up (no overshoot past either pose)', () => {
    let a = setFanRestTarget(fanRestAnim(0), 1);
    let prev = 0;
    for (let k = 0; k < 60; k++) {
      a = stepFanRest(a, 16);
      expect(a.value).toBeGreaterThanOrEqual(prev);
      expect(a.value).toBeLessThanOrEqual(1);
      prev = a.value;
    }
    a = setFanRestTarget(a, 0);
    prev = 1;
    for (let k = 0; k < 60; k++) {
      a = stepFanRest(a, 16);
      expect(a.value).toBeLessThanOrEqual(prev);
      expect(a.value).toBeGreaterThanOrEqual(0);
      prev = a.value;
    }
    expect(a.value).toBe(0);
  });
  it('a mid-flight retarget continues from the drawn amount (no jump)', () => {
    let a = setFanRestTarget(fanRestAnim(0), 1);
    a = stepFanRest(a, 200);
    const drawn = a.value;
    expect(drawn).toBeGreaterThan(0.2);
    expect(drawn).toBeLessThan(0.95);
    a = setFanRestTarget(a, 0);
    expect(a.value).toBe(drawn);
    const next = stepFanRest(a, 16);
    expect(next.value).toBeLessThanOrEqual(drawn);
    expect(next.value).toBeGreaterThanOrEqual(0);
  });
  it('reduced motion settles instantly', () => {
    expect(fanRestSeconds(true)).toBe(0);
    const a = setFanRestTarget(fanRestAnim(0), 1, true);
    expect(a.value).toBe(1);
    expect(a.t).toBe(1);
    const mid = stepFanRest(setFanRestTarget(fanRestAnim(0), 1), 16, true);
    expect(mid.value).toBe(1);
    const down = setFanRestTarget(fanRestAnim(1), 0, true);
    expect(down.value).toBe(0);
  });
});
