import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FAN_REST_MS, fanRestAnim, fanRestSeconds, fanRestTarget, setFanRestTarget, stepFanRest,
} from '../src/three/fanRest';
import {
  type FanOpts, cardScreenQuad, handCardPlane, handFan, opponentFan, phoneHandFan,
} from '../src/three/layout';

/**
 * Fan rest (owner 2026-10-28): a seat's fan lowers and tightens while that
 * seat is off-turn, and opens for the seat to act. Scope: Sitting rests at
 * any aspect (portrait included — the phone's home camera), Standing rests
 * in landscape only; portrait + Standing is the one cell that never rests.
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
  it('sitting rests in landscape off-turn; the acting seat is open', () => {
    expect(fanRestTarget({ aspect: LAND, view: 'sitting', seatIsActive: false })).toBe(1);
    expect(fanRestTarget({ aspect: 16 / 9, view: 'sitting', seatIsActive: false })).toBe(1);
    expect(fanRestTarget({ aspect: LAND, view: 'sitting', seatIsActive: true })).toBe(0);
  });
  it('sitting rests in portrait too — the phone\u2019s home camera', () => {
    expect(fanRestTarget({ aspect: PORTRAIT, view: 'sitting', seatIsActive: false })).toBe(1);
    expect(fanRestTarget({ aspect: 0.5, view: 'sitting', seatIsActive: false })).toBe(1);
    expect(fanRestTarget({ aspect: PORTRAIT, view: 'sitting', seatIsActive: true })).toBe(0);
  });
  it('the full camera matrix: portrait + standing is the only cell that never rests', () => {
    for (const aspect of [PORTRAIT, LAND]) {
      for (const view of ['standing', 'sitting'] as const) {
        const off = fanRestTarget({ aspect, view, seatIsActive: false });
        const on = fanRestTarget({ aspect, view, seatIsActive: true });
        expect(on).toBe(0); // the acting seat is open in every cell
        if (view === 'standing' && aspect < 1) expect(off).toBe(0);
        else expect(off).toBe(1);
      }
    }
  });
  it('sitting rests at square and tablet aspects too — aspect size is not the sitting gate', () => {
    expect(fanRestTarget({ aspect: 1, view: 'sitting', seatIsActive: false })).toBe(1);
    expect(fanRestTarget({ aspect: 1180 / 820, view: 'sitting', seatIsActive: false })).toBe(1);
  });
  it('when the turn passes in sitting, the targets flip: old seat rests, new seat opens', () => {
    const before = [0, 1, 2, 3].map((seat) => fanRestTarget({ aspect: PORTRAIT, view: 'sitting', seatIsActive: seat === 1 }));
    expect(before).toEqual([1, 0, 1, 1]);
    const after = [0, 1, 2, 3].map((seat) => fanRestTarget({ aspect: PORTRAIT, view: 'sitting', seatIsActive: seat === 2 }));
    expect(after).toEqual([1, 1, 0, 1]);
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
  it('no seat is exempt in sitting either: the gate never asks which seat it is', () => {
    for (let seat = 0; seat < 4; seat++) {
      void seat;
      expect(fanRestTarget({ aspect: PORTRAIT, view: 'sitting', seatIsActive: true })).toBe(0);
      expect(fanRestTarget({ aspect: PORTRAIT, view: 'sitting', seatIsActive: false })).toBe(1);
    }
  });
  it('a dead aspect never rests in sitting either', () => {
    expect(fanRestTarget({ aspect: 0, view: 'sitting', seatIsActive: false })).toBe(0);
    expect(fanRestTarget({ aspect: Number.NaN, view: 'sitting', seatIsActive: false })).toBe(0);
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

describe('human fan rest pose in portrait SITTING (phoneHandFan transforms)', () => {
  // The human fan's opts in phone portrait sitting, as Scene builds them
  // (portraitPhone branch): phoneHandFan() keyed to the live sitting camera.
  const sitOpts = (rest = 0): FanOpts => ({ ...phoneHandFan(), view: 'sitting', rest });
  const open = (i: number) => handCardPlane(PORTRAIT, N, i, 0, 0, sitOpts(0), 0, 844);
  const rest = (i: number) => handCardPlane(PORTRAIT, N, i, 0, 0, sitOpts(1), 0, 844);

  it('rest is the open pose exactly when the amount is 0', () => {
    for (let i = 0; i < N; i++) expect(handCardPlane(PORTRAIT, N, i, 0, 0, sitOpts(0), 0, 844)).toEqual(open(i));
  });
  it('every card sits LOWER at rest than open (centre and ends alike)', () => {
    for (let i = 0; i < N; i++) expect(rest(i).y).toBeLessThan(open(i).y - 0.02);
  });
  it('the fan is TIGHTER at rest: adjacent gap and total span both shrink, roll closes', () => {
    for (let i = 0; i < N - 1; i++) {
      expect(Math.abs(rest(i + 1).x - rest(i).x)).toBeLessThanOrEqual(Math.abs(open(i + 1).x - open(i).x) + 1e-9);
    }
    expect(Math.abs(rest(N - 1).x - rest(0).x)).toBeLessThan(Math.abs(open(N - 1).x - open(0).x));
    expect(Math.abs(rest(0).roll)).toBeLessThan(Math.abs(open(0).roll));
  });
  it('card scale never changes with rest (no resize pop on a turn change)', () => {
    for (let i = 0; i < N; i++) expect(rest(i).s).toBe(open(i).s);
  });
  it('on screen (390x844, sitting camera): the rested fan projects lower and narrower, and stays on screen', () => {
    const quad = (r: number, i: number) => cardScreenQuad(PORTRAIT, handFan(PORTRAIT, N, i, 0, 0, sitOpts(r), 0, 844), 390, 844, 0, false, 'sitting');
    const centreY = (r: number, i: number) => quad(r, i).reduce((a, p) => a + p.y, 0) / 4;
    for (let i = 0; i < N; i++) expect(centreY(1, i)).toBeGreaterThan(centreY(0, i) + 5); // screen y grows downward
    const xs = Array.from({ length: N }, (_, i) => quad(1, i)).flatMap((q) => q.map((p) => p.x));
    const xsOpen = Array.from({ length: N }, (_, i) => quad(0, i)).flatMap((q) => q.map((p) => p.x));
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(Math.max(...xsOpen) - Math.min(...xsOpen));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(390);
  });
  it('a part-way amount lies strictly between open and rest (bounded, no overshoot)', () => {
    const mid = (i: number) => handCardPlane(PORTRAIT, N, i, 0, 0, sitOpts(0.5), 0, 844);
    for (let i = 0; i < N; i++) {
      expect(mid(i).y).toBeLessThan(open(i).y);
      expect(mid(i).y).toBeGreaterThan(rest(i).y);
    }
  });
  it('a lifted card still rises clear of its rested fan (lift adds on top of rest)', () => {
    const lifted = handCardPlane(PORTRAIT, N, 6, 1, 0, sitOpts(1), 0, 844);
    expect(lifted.y).toBeGreaterThan(rest(6).y + 0.1);
  });
  it('rest applies the same fractions in both cameras (one tighten ratio, one drop, no per-camera numbers)', () => {
    // The cameras frame the fan differently (that is FanOpts.view's job),
    // but the REST applied on top is the same fraction in each: x and roll
    // close by exactly (1 - FAN_REST_TIGHTEN), and every card drops.
    for (const view of ['standing', 'sitting'] as const) {
      const o = (r: number): FanOpts => ({ ...landOpts(r), view });
      for (const i of [0, 3, 9, 12]) {
        const open = handCardPlane(LAND, N, i, 0, 0, o(0), 0, 390);
        const rest = handCardPlane(LAND, N, i, 0, 0, o(1), 0, 390);
        expect(rest.x).toBeCloseTo(open.x * 0.64, 9);
        expect(rest.roll).toBeCloseTo(open.roll * 0.64, 9);
        expect(rest.y).toBeLessThan(open.y);
        expect(rest.s).toBe(open.s);
      }
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
  it('a part-way rest amount lies strictly between open and rest (bounded)', () => {
    for (const pos of positions) {
      for (let i = 0; i < 9; i++) {
        const yOpen = opponentFan(pos, 4, i, 9, 0).p[1];
        const yMid = opponentFan(pos, 4, i, 9, 0.5).p[1];
        const yRest = opponentFan(pos, 4, i, 9, 1).p[1];
        expect(yMid).toBeLessThan(yOpen);
        expect(yMid).toBeGreaterThan(yRest);
      }
    }
  });
  it('rested fans pull away from the table centre (the out offset grows with rest)', () => {
    for (const pos of positions) {
      const mid = Math.floor(9 / 2);
      const open = opponentFan(pos, 4, mid, 9, 0);
      const rest = opponentFan(pos, 4, mid, 9, 1);
      const dist = (t: typeof open) => Math.hypot(t.p[0], t.p[2]);
      expect(dist(rest)).toBeGreaterThan(dist(open) + 0.01);
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
  it('the sitting settle rides the same clock: a full down-up cycle lands exactly on both targets', () => {
    // Sitting changes only the gate's target, never the anim: the same
    // FAN_REST_MS ease carries a sitting fan down and back up.
    let a = setFanRestTarget(fanRestAnim(0), fanRestTarget({ aspect: PORTRAIT, view: 'sitting', seatIsActive: false }));
    let guard = 0;
    while (a.t < 1 && guard++ < 200) a = stepFanRest(a, 16);
    expect(a.value).toBe(1);
    a = setFanRestTarget(a, fanRestTarget({ aspect: PORTRAIT, view: 'sitting', seatIsActive: true }));
    guard = 0;
    while (a.t < 1 && guard++ < 200) a = stepFanRest(a, 16);
    expect(a.value).toBe(0);
    expect(fanRestSeconds(false)).toBe(FAN_REST_MS / 1000);
  });
});

describe('fan rest wiring: Scene feeds the gate the live camera view', () => {
  it('fanRest.ts rests sitting outright (the gate change itself)', () => {
    const src = readFileSync(new URL('../src/three/fanRest.ts', import.meta.url), 'utf8');
    expect(src).toContain("if (g.view === 'sitting') return 1;");
  });
  it('Scene computes every seat\u2019s rest from fanRestTarget({ aspect, view, ... }) — no standing carve-out', () => {
    const src = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
    expect(src).toContain('fanRestTarget({ aspect, view, seatIsActive');
    expect(src).toContain('const view = props.view');
  });
});
