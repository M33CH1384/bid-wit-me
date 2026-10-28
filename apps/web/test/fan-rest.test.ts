import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FAN_REST_MS, fanRestAnim, fanRestSeconds, fanRestTarget, setFanRestTarget, stepFanRest,
  type FanRestPose,
} from '../src/three/fanRest';
import {
  type FanOpts, cardScreenQuad, handCardPlane, handFan, opponentFan, phoneHandFan,
} from '../src/three/layout';

/**
 * Fan rest (owner 2026-10-28): a seat's fan lowers while that seat is
 * off-turn, and opens for the seat to act. The pose is TWO channels:
 * DROP lowers, PINCH tightens. Sitting rests at any aspect but pinches
 * only in landscape — sitting portrait lowers at its open width ("let's
 * not pinch the fan while sitting, just lower it"). Standing rests
 * (both channels) in landscape only; portrait + Standing never rests.
 * The human seat is NOT exempt.
 */

const LAND = 844 / 390; // the capture viewport: phone landscape
const PORTRAIT = 390 / 844;
const OPEN: FanRestPose = { drop: 0, pinch: 0 };
const FULL: FanRestPose = { drop: 1, pinch: 1 };
const DROP_ONLY: FanRestPose = { drop: 1, pinch: 0 };
/** The human fan's opts in phone landscape, as Scene builds them (`short` branch). */
const landOpts = (rest = 0, pinch = rest): FanOpts => ({
  short: true, view: 'standing', reserveFrac: 0.28, bottomFrac: 0, heightFrac: 0.32,
  minStripPx: 28, pxW: 844, rest, pinch,
});
const N = 13;

describe('fanRestTarget: scope + turn gate (two channels)', () => {
  it('landscape + standing + off-turn rests drop + pinch; the acting seat is open', () => {
    expect(fanRestTarget({ aspect: LAND, view: 'standing', seatIsActive: false })).toEqual(FULL);
    expect(fanRestTarget({ aspect: LAND, view: 'standing', seatIsActive: true })).toEqual(OPEN);
  });
  it('portrait + standing is always open, whichever seat is acting', () => {
    expect(fanRestTarget({ aspect: PORTRAIT, view: 'standing', seatIsActive: false })).toEqual(OPEN);
    expect(fanRestTarget({ aspect: 0.5, view: 'standing', seatIsActive: false })).toEqual(OPEN);
    expect(fanRestTarget({ aspect: 1, view: 'standing', seatIsActive: false })).toEqual(OPEN); // square is not landscape
  });
  it('sitting rests drop + pinch in landscape off-turn; the acting seat is open', () => {
    expect(fanRestTarget({ aspect: LAND, view: 'sitting', seatIsActive: false })).toEqual(FULL);
    expect(fanRestTarget({ aspect: 16 / 9, view: 'sitting', seatIsActive: false })).toEqual(FULL);
    expect(fanRestTarget({ aspect: LAND, view: 'sitting', seatIsActive: true })).toEqual(OPEN);
  });
  it('sitting rests in portrait too — DROP ONLY, no pinch (the owner\u2019s sitting call)', () => {
    expect(fanRestTarget({ aspect: PORTRAIT, view: 'sitting', seatIsActive: false })).toEqual(DROP_ONLY);
    expect(fanRestTarget({ aspect: 0.5, view: 'sitting', seatIsActive: false })).toEqual(DROP_ONLY);
    expect(fanRestTarget({ aspect: PORTRAIT, view: 'sitting', seatIsActive: true })).toEqual(OPEN);
  });
  it('the full camera matrix: pinch only ever joins in landscape; portrait + standing never rests', () => {
    for (const aspect of [PORTRAIT, LAND]) {
      for (const view of ['standing', 'sitting'] as const) {
        const off = fanRestTarget({ aspect, view, seatIsActive: false });
        const on = fanRestTarget({ aspect, view, seatIsActive: true });
        expect(on).toEqual(OPEN); // the acting seat is open in every cell
        if (view === 'standing' && aspect < 1) expect(off).toEqual(OPEN);
        else if (view === 'sitting' && aspect < 1) expect(off).toEqual(DROP_ONLY);
        else expect(off).toEqual(FULL);
      }
    }
  });
  it('sitting at square aspect lowers without pinch; tablet landscape pinches — aspect size is not the sitting gate', () => {
    expect(fanRestTarget({ aspect: 1, view: 'sitting', seatIsActive: false })).toEqual(DROP_ONLY);
    expect(fanRestTarget({ aspect: 1180 / 820, view: 'sitting', seatIsActive: false })).toEqual(FULL);
  });
  it('when the turn passes in sitting portrait, the poses flip: old seat drops, new seat opens', () => {
    const before = [0, 1, 2, 3].map((seat) => fanRestTarget({ aspect: PORTRAIT, view: 'sitting', seatIsActive: seat === 1 }));
    expect(before).toEqual([DROP_ONLY, OPEN, DROP_ONLY, DROP_ONLY]);
    const after = [0, 1, 2, 3].map((seat) => fanRestTarget({ aspect: PORTRAIT, view: 'sitting', seatIsActive: seat === 2 }));
    expect(after).toEqual([DROP_ONLY, DROP_ONLY, OPEN, DROP_ONLY]);
  });
  it('wide landscape (tablet / desktop) also rests both channels — aspect is the gate, not the short flag', () => {
    expect(fanRestTarget({ aspect: 1180 / 820, view: 'standing', seatIsActive: false })).toEqual(FULL);
    expect(fanRestTarget({ aspect: 16 / 9, view: 'standing', seatIsActive: false })).toEqual(FULL);
  });
  it('no seat is exempt: the gate never asks which seat it is (the human rests off-turn too)', () => {
    // fanRestTarget takes no seat index at all — for every seat, active opens and inactive rests.
    for (let seat = 0; seat < 4; seat++) {
      void seat;
      expect(fanRestTarget({ aspect: LAND, view: 'standing', seatIsActive: true })).toEqual(OPEN);
      expect(fanRestTarget({ aspect: LAND, view: 'standing', seatIsActive: false })).toEqual(FULL);
    }
  });
  it('a dead aspect (0 / NaN canvas) never rests', () => {
    expect(fanRestTarget({ aspect: 0, view: 'standing', seatIsActive: false })).toEqual(OPEN);
    expect(fanRestTarget({ aspect: Number.NaN, view: 'standing', seatIsActive: false })).toEqual(OPEN);
  });
  it('no seat is exempt in sitting either: the gate never asks which seat it is', () => {
    for (let seat = 0; seat < 4; seat++) {
      void seat;
      expect(fanRestTarget({ aspect: PORTRAIT, view: 'sitting', seatIsActive: true })).toEqual(OPEN);
      expect(fanRestTarget({ aspect: PORTRAIT, view: 'sitting', seatIsActive: false })).toEqual(DROP_ONLY);
    }
  });
  it('a dead aspect never rests in sitting either', () => {
    expect(fanRestTarget({ aspect: 0, view: 'sitting', seatIsActive: false })).toEqual(OPEN);
    expect(fanRestTarget({ aspect: Number.NaN, view: 'sitting', seatIsActive: false })).toEqual(OPEN);
  });
  it('pinch = 1 only ever occurs in landscape, and pinch never appears without drop (channel sweep)', () => {
    for (const aspect of [0.4, PORTRAIT, 0.9, 1, 1.2, LAND, 16 / 9]) {
      for (const view of ['standing', 'sitting'] as const) {
        const p = fanRestTarget({ aspect, view, seatIsActive: false });
        if (p.pinch === 1) expect(aspect).toBeGreaterThan(1);
        if (p.drop === 1 && view === 'sitting') expect(p.pinch).toBe(aspect > 1 ? 1 : 0);
        expect(p.drop === 1 || p.pinch === 0).toBe(true); // pinch never appears without drop
      }
    }
  });
});

describe('human fan rest pose (handCardPlane / handFan transforms)', () => {
  const open = (i: number) => handCardPlane(LAND, N, i, 0, 0, landOpts(0), 0, 390);
  const rest = (i: number) => handCardPlane(LAND, N, i, 0, 0, landOpts(1), 0, 390);

  it('rest is the open pose exactly when both amounts are 0', () => {
    for (let i = 0; i < N; i++) expect(handCardPlane(LAND, N, i, 0, 0, landOpts(0, 0), 0, 390)).toEqual(open(i));
  });
  it('every card sits LOWER at full rest than open (anchor Y down, centre and ends alike)', () => {
    for (let i = 0; i < N; i++) expect(rest(i).y).toBeLessThan(open(i).y - 0.02);
    const mean = (f: (i: number) => number) => Array.from({ length: N }, (_, i) => f(i)).reduce((a, b) => a + b, 0) / N;
    expect(mean((i) => rest(i).y)).toBeLessThan(mean((i) => open(i).y));
  });
  it('the fan is TIGHTER at full rest: adjacent gap and total span both shrink, roll closes', () => {
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
  it('DROP ONLY (pinch 0): every card drops by the full rest drop, and x / roll are the OPEN pose exactly', () => {
    const dropOnly = (i: number) => handCardPlane(LAND, N, i, 0, 0, landOpts(1, 0), 0, 390);
    for (let i = 0; i < N; i++) {
      expect(dropOnly(i).y).toBe(rest(i).y); // same drop as the full rest
      expect(dropOnly(i).x).toBe(open(i).x); // no narrowing at all
      expect(dropOnly(i).roll).toBe(open(i).roll);
      expect(dropOnly(i).s).toBe(open(i).s);
    }
    expect(dropOnly(N - 1).x - dropOnly(0).x).toBe(open(N - 1).x - open(0).x); // span unchanged
  });
  it('PINCH ONLY (drop 0): heights are the OPEN pose exactly, and x / roll are the full-rest ones', () => {
    const pinchOnly = (i: number) => handCardPlane(LAND, N, i, 0, 0, landOpts(0, 1), 0, 390);
    for (let i = 0; i < N; i++) {
      expect(pinchOnly(i).y).toBe(open(i).y); // no drop at all
      expect(pinchOnly(i).x).toBe(rest(i).x); // same tighten as the full rest
      expect(pinchOnly(i).roll).toBe(rest(i).roll);
    }
  });
  it('an opts with no pinch field pinches with the drop (the pre-split combined pose)', () => {
    const bare = (r: number): FanOpts => ({
      short: true, view: 'standing', reserveFrac: 0.28, bottomFrac: 0, heightFrac: 0.32,
      minStripPx: 28, pxW: 844, rest: r,
    });
    for (let i = 0; i < N; i++) {
      expect(handCardPlane(LAND, N, i, 0, 0, bare(1), 0, 390)).toEqual(rest(i));
      expect(handCardPlane(LAND, N, i, 0, 0, bare(0.5), 0, 390)).toEqual(handCardPlane(LAND, N, i, 0, 0, landOpts(0.5, 0.5), 0, 390));
    }
  });
});

describe('human fan rest pose in portrait SITTING (phoneHandFan transforms)', () => {
  // The human fan's opts in phone portrait sitting, as Scene builds them
  // (portraitPhone branch): phoneHandFan() keyed to the live sitting camera.
  // Sitting portrait is the DROP-ONLY cell: the gate hands Scene drop 1,
  // pinch 0 for an off-turn seat here.
  const sitOpts = (rest = 0, pinch = rest): FanOpts => ({ ...phoneHandFan(), view: 'sitting', rest, pinch });
  const open = (i: number) => handCardPlane(PORTRAIT, N, i, 0, 0, sitOpts(0), 0, 844);
  const dropOnly = (i: number) => handCardPlane(PORTRAIT, N, i, 0, 0, sitOpts(1, 0), 0, 844);
  const full = (i: number) => handCardPlane(PORTRAIT, N, i, 0, 0, sitOpts(1, 1), 0, 844);

  it('rest is the open pose exactly when both amounts are 0', () => {
    for (let i = 0; i < N; i++) expect(handCardPlane(PORTRAIT, N, i, 0, 0, sitOpts(0, 0), 0, 844)).toEqual(open(i));
  });
  it('DROP ONLY (the sitting portrait rest): every card sits LOWER, at the open width exactly', () => {
    for (let i = 0; i < N; i++) {
      expect(dropOnly(i).y).toBeLessThan(open(i).y - 0.02);
      expect(dropOnly(i).x).toBe(open(i).x); // no pinch: x untouched
      expect(dropOnly(i).roll).toBe(open(i).roll); // roll untouched
      expect(dropOnly(i).s).toBe(open(i).s);
    }
    expect(Math.abs(dropOnly(N - 1).x - dropOnly(0).x)).toBe(Math.abs(open(N - 1).x - open(0).x)); // span identical
  });
  it('on screen (390x844, sitting camera): the drop-only fan projects lower, NOT narrower, and stays on screen', () => {
    const quad = (r: number, p: number, i: number) => cardScreenQuad(PORTRAIT, handFan(PORTRAIT, N, i, 0, 0, sitOpts(r, p), 0, 844), 390, 844, 0, false, 'sitting');
    const centreY = (r: number, p: number, i: number) => quad(r, p, i).reduce((a, pt) => a + pt.y, 0) / 4;
    for (let i = 0; i < N; i++) expect(centreY(1, 0, i)).toBeGreaterThan(centreY(0, 0, i) + 5); // screen y grows downward
    const spanOf = (r: number, p: number) => {
      const xs = Array.from({ length: N }, (_, i) => quad(r, p, i)).flatMap((q) => q.map((pt) => pt.x));
      return { span: Math.max(...xs) - Math.min(...xs), min: Math.min(...xs), max: Math.max(...xs) };
    };
    expect(spanOf(1, 0).span).toBeCloseTo(spanOf(0, 0).span, 6); // lowered, same width
    expect(spanOf(1, 0).min).toBeGreaterThanOrEqual(0);
    expect(spanOf(1, 0).max).toBeLessThanOrEqual(390);
  });
  it('the fan is TIGHTER only when pinch joins (drop + pinch): gaps and span shrink, roll closes', () => {
    for (let i = 0; i < N - 1; i++) {
      expect(Math.abs(full(i + 1).x - full(i).x)).toBeLessThanOrEqual(Math.abs(open(i + 1).x - open(i).x) + 1e-9);
    }
    expect(Math.abs(full(N - 1).x - full(0).x)).toBeLessThan(Math.abs(open(N - 1).x - open(0).x));
    expect(Math.abs(full(0).roll)).toBeLessThan(Math.abs(open(0).roll));
  });
  it('card scale never changes with rest (no resize pop on a turn change)', () => {
    for (let i = 0; i < N; i++) {
      expect(dropOnly(i).s).toBe(open(i).s);
      expect(full(i).s).toBe(open(i).s);
    }
  });
  it('on screen (390x844, sitting camera): the drop + pinch fan projects lower and narrower, and stays on screen', () => {
    const quad = (r: number, i: number) => cardScreenQuad(PORTRAIT, handFan(PORTRAIT, N, i, 0, 0, sitOpts(r), 0, 844), 390, 844, 0, false, 'sitting');
    const centreY = (r: number, i: number) => quad(r, i).reduce((a, p) => a + p.y, 0) / 4;
    for (let i = 0; i < N; i++) expect(centreY(1, i)).toBeGreaterThan(centreY(0, i) + 5); // screen y grows downward
    const xs = Array.from({ length: N }, (_, i) => quad(1, i)).flatMap((q) => q.map((p) => p.x));
    const xsOpen = Array.from({ length: N }, (_, i) => quad(0, i)).flatMap((q) => q.map((p) => p.x));
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(Math.max(...xsOpen) - Math.min(...xsOpen));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(390);
  });
  it('a part-way DROP-ONLY amount lowers strictly between open and rest, width untouched', () => {
    const mid = (i: number) => handCardPlane(PORTRAIT, N, i, 0, 0, sitOpts(0.5, 0), 0, 844);
    for (let i = 0; i < N; i++) {
      expect(mid(i).y).toBeLessThan(open(i).y);
      expect(mid(i).y).toBeGreaterThan(dropOnly(i).y);
      expect(mid(i).x).toBe(open(i).x);
      expect(mid(i).roll).toBe(open(i).roll);
    }
  });
  it('a lifted card still rises clear of its drop-only rested fan (lift adds on top of rest)', () => {
    const lifted = handCardPlane(PORTRAIT, N, 6, 1, 0, sitOpts(1, 0), 0, 844);
    expect(lifted.y).toBeGreaterThan(dropOnly(6).y + 0.1);
  });
  it('the channels ride the same fractions in both cameras (pinch closes x/roll by (1 - FAN_REST_TIGHTEN); drop only lowers)', () => {
    for (const view of ['standing', 'sitting'] as const) {
      const o = (r: number, p = r): FanOpts => ({ ...landOpts(r, p), view });
      for (const i of [0, 3, 9, 12]) {
        const openP = handCardPlane(LAND, N, i, 0, 0, o(0), 0, 390);
        const fullP = handCardPlane(LAND, N, i, 0, 0, o(1), 0, 390);
        expect(fullP.x).toBeCloseTo(openP.x * 0.64, 9);
        expect(fullP.roll).toBeCloseTo(openP.roll * 0.64, 9);
        expect(fullP.y).toBeLessThan(openP.y);
        expect(fullP.s).toBe(openP.s);
        const dropP = handCardPlane(LAND, N, i, 0, 0, o(1, 0), 0, 390);
        expect(dropP.x).toBe(openP.x);
        expect(dropP.roll).toBe(openP.roll);
        expect(dropP.y).toBe(fullP.y); // the same drop in both channel mixes
      }
    }
  });
});

describe('opponent fan rest pose (opponentFan transforms)', () => {
  const positions = ['bottom', 'left', 'top', 'right'] as const;
  it('rest 0 reproduces today\u2019s fan exactly (with and without an explicit pinch)', () => {
    for (const pos of positions) {
      for (let i = 0; i < 9; i++) {
        expect(opponentFan(pos, 4, i, 9, 0)).toEqual(opponentFan(pos, 4, i, 9));
        expect(opponentFan(pos, 4, i, 9, 0, 0)).toEqual(opponentFan(pos, 4, i, 9));
        expect(opponentFan(pos, 4, i, 9, 1)).toEqual(opponentFan(pos, 4, i, 9, 1, 1)); // pinch defaults to drop
      }
    }
  });
  it('every fully-resting card is lower (world Y down) and the fan is tighter', () => {
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
  it('DROP ONLY (pinch 0): cards lower by the full drop, and gap / span / roll are the open fan\u2019s', () => {
    for (const pos of positions) {
      const open = Array.from({ length: 9 }, (_, i) => opponentFan(pos, 4, i, 9, 0));
      const full = Array.from({ length: 9 }, (_, i) => opponentFan(pos, 4, i, 9, 1, 1));
      const drop = Array.from({ length: 9 }, (_, i) => opponentFan(pos, 4, i, 9, 1, 0));
      for (let i = 0; i < 9; i++) {
        expect(drop[i]!.p[1]).toBe(full[i]!.p[1]); // same drop as the full rest
        expect(drop[i]!.r).toEqual(open[i]!.r); // roll untouched (pinch closes roll)
      }
      const gap = (xs: typeof open) => Math.hypot(xs[5]!.p[0] - xs[4]!.p[0], xs[5]!.p[2] - xs[4]!.p[2]);
      expect(gap(drop)).toBeCloseTo(gap(open), 9); // spread untouched: the base shift is a pure translation
      const span = (xs: typeof open) => Math.hypot(xs[8]!.p[0] - xs[0]!.p[0], xs[8]!.p[2] - xs[0]!.p[2]);
      expect(span(drop)).toBeCloseTo(span(open), 9);
    }
  });
  it('PINCH ONLY (drop 0): the fan tightens like the full rest, and heights are the open fan\u2019s exactly', () => {
    for (const pos of positions) {
      const open = Array.from({ length: 9 }, (_, i) => opponentFan(pos, 4, i, 9, 0));
      const full = Array.from({ length: 9 }, (_, i) => opponentFan(pos, 4, i, 9, 1, 1));
      const pinch = Array.from({ length: 9 }, (_, i) => opponentFan(pos, 4, i, 9, 0, 1));
      for (let i = 0; i < 9; i++) expect(pinch[i]!.p[1]).toBe(open[i]!.p[1]); // no drop at all
      const gap = (xs: typeof open) => Math.hypot(xs[5]!.p[0] - xs[4]!.p[0], xs[5]!.p[2] - xs[4]!.p[2]);
      expect(gap(pinch)).toBeCloseTo(gap(full), 9);
      const span = (xs: typeof open) => Math.hypot(xs[8]!.p[0] - xs[0]!.p[0], xs[8]!.p[2] - xs[0]!.p[2]);
      expect(span(pinch)).toBeLessThan(span(open));
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
  it('the out offset rides the DROP channel only (pinch alone never pulls the fan outward)', () => {
    for (const pos of positions) {
      const mid = Math.floor(9 / 2);
      const open = opponentFan(pos, 4, mid, 9, 0);
      const drop = opponentFan(pos, 4, mid, 9, 1, 0);
      const pinch = opponentFan(pos, 4, mid, 9, 0, 1);
      const dist = (t: typeof open) => Math.hypot(t.p[0], t.p[2]);
      expect(dist(drop)).toBeGreaterThan(dist(open) + 0.01);
      expect(dist(pinch)).toBe(dist(open)); // centre card, off 0: pinch moves nothing radially
    }
  });
});

describe('fan rest easing (FanRestAnim, per channel)', () => {
  it('takes FAN_REST_MS: unhurried, not a snap, and lands exactly on target (bare amount = both channels)', () => {
    expect(FAN_REST_MS).toBeGreaterThanOrEqual(500);
    expect(FAN_REST_MS).toBeLessThanOrEqual(800);
    expect(fanRestSeconds(false)).toBe(FAN_REST_MS / 1000);
    let a = setFanRestTarget(fanRestAnim(0), 1);
    a = stepFanRest(a, 100);
    expect(a.value.drop).toBeGreaterThan(0);
    expect(a.value.drop).toBeLessThan(0.6); // 100ms in, still travelling
    expect(a.value.pinch).toBe(a.value.drop); // a bare amount drives both channels in lockstep
    let guard = 0;
    while (a.t < 1 && guard++ < 200) a = stepFanRest(a, 16);
    expect(a.value).toEqual(FULL);
    expect(a.t).toBe(1);
  });
  it('is monotonic and bounded per channel on the way down and on the way up (no overshoot past either pose)', () => {
    let a = setFanRestTarget(fanRestAnim(0), FULL);
    let prev = { ...OPEN };
    for (let k = 0; k < 60; k++) {
      a = stepFanRest(a, 16);
      expect(a.value.drop).toBeGreaterThanOrEqual(prev.drop);
      expect(a.value.pinch).toBeGreaterThanOrEqual(prev.pinch);
      expect(a.value.drop).toBeLessThanOrEqual(1);
      expect(a.value.pinch).toBeLessThanOrEqual(1);
      prev = a.value;
    }
    a = setFanRestTarget(a, OPEN);
    prev = { ...FULL };
    for (let k = 0; k < 60; k++) {
      a = stepFanRest(a, 16);
      expect(a.value.drop).toBeLessThanOrEqual(prev.drop);
      expect(a.value.pinch).toBeLessThanOrEqual(prev.pinch);
      expect(a.value.drop).toBeGreaterThanOrEqual(0);
      expect(a.value.pinch).toBeGreaterThanOrEqual(0);
      prev = a.value;
    }
    expect(a.value).toEqual(OPEN);
  });
  it('a mid-flight retarget continues from the drawn pose (no jump)', () => {
    let a = setFanRestTarget(fanRestAnim(0), FULL);
    a = stepFanRest(a, 200);
    const drawn = a.value;
    expect(drawn.drop).toBeGreaterThan(0.2);
    expect(drawn.drop).toBeLessThan(0.95);
    a = setFanRestTarget(a, OPEN);
    expect(a.value).toEqual(drawn);
    const next = stepFanRest(a, 16);
    expect(next.value.drop).toBeLessThanOrEqual(drawn.drop);
    expect(next.value.drop).toBeGreaterThanOrEqual(0);
  });
  it('rotation mid-rest: a settled drop-only fan keeps its drop and only the pinch leg runs', () => {
    // Sitting portrait settled at DROP_ONLY; the phone rotates to
    // landscape, where the gate asks for FULL. Drop is already at
    // target, so it must hold at 1 for the whole leg while pinch rises.
    let a = setFanRestTarget(fanRestAnim(DROP_ONLY), FULL);
    expect(a.value).toEqual(DROP_ONLY); // no jump at the retarget
    let guard = 0;
    while (a.t < 1 && guard++ < 200) {
      a = stepFanRest(a, 16);
      expect(a.value.drop).toBe(1);
    }
    expect(a.value).toEqual(FULL);
    // …and rotating back un-pinches only: drop holds, pinch falls to 0.
    a = setFanRestTarget(a, DROP_ONLY);
    guard = 0;
    while (a.t < 1 && guard++ < 200) {
      a = stepFanRest(a, 16);
      expect(a.value.drop).toBe(1);
    }
    expect(a.value).toEqual(DROP_ONLY);
  });
  it('reduced motion settles instantly, per channel', () => {
    expect(fanRestSeconds(true)).toBe(0);
    const a = setFanRestTarget(fanRestAnim(0), DROP_ONLY, true);
    expect(a.value).toEqual(DROP_ONLY);
    expect(a.t).toBe(1);
    const mid = stepFanRest(setFanRestTarget(fanRestAnim(0), FULL), 16, true);
    expect(mid.value).toEqual(FULL);
    const down = setFanRestTarget(fanRestAnim(FULL), OPEN, true);
    expect(down.value).toEqual(OPEN);
  });
  it('the sitting portrait settle rides the same clock and never pinches: down lands on DROP_ONLY, up on OPEN', () => {
    // Sitting changes only the gate's target pose, never the anim: the
    // same FAN_REST_MS ease carries a sitting fan down and back up,
    // with the pinch channel parked at 0 for the whole ride.
    let a = setFanRestTarget(fanRestAnim(0), fanRestTarget({ aspect: PORTRAIT, view: 'sitting', seatIsActive: false }));
    let guard = 0;
    while (a.t < 1 && guard++ < 200) {
      a = stepFanRest(a, 16);
      expect(a.value.pinch).toBe(0);
    }
    expect(a.value).toEqual(DROP_ONLY);
    a = setFanRestTarget(a, fanRestTarget({ aspect: PORTRAIT, view: 'sitting', seatIsActive: true }));
    guard = 0;
    while (a.t < 1 && guard++ < 200) a = stepFanRest(a, 16);
    expect(a.value).toEqual(OPEN);
    expect(fanRestSeconds(false)).toBe(FAN_REST_MS / 1000);
  });
});

describe('fan rest wiring: Scene feeds the gate the live camera view', () => {
  it('fanRest.ts splits the channels (the gate change itself)', () => {
    const src = readFileSync(new URL('../src/three/fanRest.ts', import.meta.url), 'utf8');
    expect(src).toContain("if (g.view === 'sitting') return landscape ? { drop: 1, pinch: 1 } : { drop: 1, pinch: 0 };");
  });
  it('layout.ts defaults pinch to the drop amount when a caller does not split them', () => {
    const src = readFileSync(new URL('../src/three/layout.ts', import.meta.url), 'utf8');
    expect(src).toContain('clampRest(o.pinch ?? o.rest)');
    expect(src).toContain('pinch = rest');
  });
  it('Scene computes every seat\u2019s rest from fanRestTarget({ aspect, view, ... }) — no standing carve-out', () => {
    const src = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
    expect(src).toContain('fanRestTarget({ aspect, view, seatIsActive');
    expect(src).toContain('const view = props.view');
    expect(src).toContain('pinch: humanRest.pinch');
    expect(src).toContain('opponentFan(positions[seat]!, n, i, c, rest.drop, rest.pinch)');
  });
});
