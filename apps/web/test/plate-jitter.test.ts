import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { badgeSpot, cameraFor, trickSpot, CH, CW } from '../src/three/layout';
import { applyViewAdjustToSpec } from '../src/viewAdjust';
import { plateCy0, solvePlates, type PlateRect, type PlateSolveInput, type SidePlateGeom, type TopPlateGeom } from '../src/three/plateLayout';

/**
 * Partner-plate oscillation (owner 2026-10-30: "Depending on my tilt my
 * partner's plate jumps up and down repeatedly" — Pj's, portrait, Neon).
 *
 * Diagnosis: the three upper plates used to be placed by independent
 * per-plate callbacks reading each other's LIVE DOM rects and a
 * dataset.moved flag. The partner plate's clamped rest position sits
 * exactly on the side plates' hit threshold, so sub-pixel measurement
 * noise flipped the hit every layout pass in a tilt band: side hits ->
 * moved -> partner snaps up under the scorebug -> side clears -> partner
 * drops back -> hits again (period-2, up to ~114px at tilt -14.5).
 *
 * The fix is the joint solve in three/plateLayout.ts: one pure solve from
 * position-independent inputs (projections, sizes, relative offsets,
 * static bar/slots/HUD), obstacles at NATURAL positions, partner clamped
 * against SOLVED side positions. This test drives that solve through the
 * same gather -> apply -> re-measure loop Scene.tsx runs (measured rects
 * carry a constant per-element offset, as a real device produces) across
 * the full tilt/zoom sweep, and asserts the published partner anchor is
 * IDENTICAL from the settle pass onward at every point — a return of the
 * feedback (or of any position-dependent input) makes it alternate and
 * fails here. The old-feedback model at the bottom proves the sweep
 * geometry is inside the real band: on these same inputs the old loop
 * oscillates by tens of pixels.
 */

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

type Rect = PlateRect;
const rect = (left: number, top: number, right: number, bottom: number): Rect => ({ left, right, top, bottom });

function slotRects(cam: PerspectiveCamera, w: number, h: number): Rect[] {
  return (['bottom', 'left', 'top', 'right'] as const).map((pos) => {
    const t = trickSpot(pos, 4, 0, 0);
    const m = new Matrix4().compose(new Vector3(...t.p), new Quaternion(...t.q), new Vector3(t.s, t.s, t.s));
    let l = Infinity, r = -Infinity, tp = Infinity, b = -Infinity;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const v = new Vector3((cx * CW) / 2, (cy * CH) / 2, 0).applyMatrix4(m).project(cam);
      const x = ((v.x + 1) * w) / 2, y = ((1 - v.y) * h) / 2;
      l = Math.min(l, x); r = Math.max(r, x); tp = Math.min(tp, y); b = Math.max(b, y);
    }
    return rect(l - 4, tp - 4, r + 4, b + 4);
  });
}

const project = (cam: PerspectiveCamera, w: number, h: number, v: [number, number, number]) => {
  const p = new Vector3(...v).project(cam);
  return { x: ((p.x + 1) * w) / 2, y: ((1 - p.y) * h) / 2 };
};

function camAt(w: number, h: number, view: 'sitting' | 'standing', tilt: number, zoom: number): PerspectiveCamera {
  const spec = applyViewAdjustToSpec(cameraFor(w / h, false, view), { tilt, zoom });
  const cam = new PerspectiveCamera(spec.fov, w / h, 0.05, 60);
  cam.position.set(...(spec.pos as [number, number, number]));
  cam.lookAt(new Vector3(...(spec.look as [number, number, number])));
  cam.updateMatrixWorld(true);
  return cam;
}

interface SizeSet {
  top: { pw: number; ph: number; up: number; bubble: boolean };
  side: { wideW: number; narrowW: number; phWide: number; phNarrow: number; up: number };
}
const SIZES_A: SizeSet = { top: { pw: 176, ph: 48, up: 28, bubble: false }, side: { wideW: 190, narrowW: 148, phWide: 48, phNarrow: 72, up: 28 } };
const SIZES_B: SizeSet = { top: { pw: 220, ph: 56, up: 36, bubble: true }, side: { wideW: 210, narrowW: 160, phWide: 56, phNarrow: 84, up: 36 } };

interface World { w: number; h: number; view: 'sitting' | 'standing'; bar: number; sizes: SizeSet; label: string }

/** One gather -> solve -> apply pass, mirroring Scene.tsx's solveAll: measured
 *  rects are built from the APPLIED positions plus a constant per-element
 *  offset (device measurement noise); every solver input is then derived
 *  translation-invariantly (sizes, relative offsets, projections). */
function runLoop(world: World, tilt: number, zoom: number, passes: number) {
  const { w, h, bar, sizes } = world;
  const cam = camAt(w, h, world.view, tilt, zoom);
  const slots = slotRects(cam, w, h);
  const aTop = project(cam, w, h, badgeSpot('top', 4));
  const aL = project(cam, w, h, badgeSpot('left', 4));
  const aR = project(cam, w, h, badgeSpot('right', 4));
  const pad = 6;
  const hud: Rect[] = [rect(w - 58 + 0.31, h * 0.42, w - 8 + 0.31, h * 0.62)]; // controls rail, constant
  // constant per-element measurement offsets (sub-pixel, fixed per element)
  const eT = { x: 0.42, y: -0.27 }, eL = { x: -0.35, y: 0.44 }, eR = { x: 0.18, y: -0.41 };
  // applied state
  let topCx = aTop.x, topCy = Math.max(aTop.y, bar + 8 + sizes.top.up);
  const sideState = {
    left: { x: Math.max(pad, aL.x - 72), cy: plateCy0(aL.y, bar, sizes.side.up), narrow: false },
    right: { x: Math.min(w - pad, aR.x + 72), cy: plateCy0(aR.y, bar, sizes.side.up), narrow: false },
  };
  const wideCache: Record<string, number> = {};
  const narrowCache: Record<string, number> = {};
  const topSeries: number[] = [];
  const sideSeries: Record<string, number[]> = { left: [], right: [] };

  for (let pass = 0; pass < passes; pass++) {
    // --- measured rects from applied positions ---
    const tPw = sizes.top.pw, tPh = sizes.top.ph;
    const prT = rect(topCx - tPw / 2 + eT.x, topCy - tPh / 2 + eT.y, topCx + tPw / 2 + eT.x, topCy + tPh / 2 + eT.y);
    const brT = sizes.top.bubble ? rect(prT.left - 10, prT.bottom - 6, prT.left + 54, prT.bottom + 46) : null;
    const tagT = sizes.top.up > tPh / 2 ? rect(prT.left + 30, (prT.top + prT.bottom) / 2 - sizes.top.up, prT.left + 110, (prT.top + prT.bottom) / 2 - sizes.top.up + 12) : null;
    // --- gather: top (mirrors Scene.tsx) ---
    const pwU = Math.max(prT.right, brT?.right ?? 0) - Math.min(prT.left, brT?.left ?? Infinity);
    const phU = Math.max(tPh, brT ? brT.bottom - brT.top : 0);
    const leftBias = brT ? Math.max(0, prT.left - brT.left) : 0;
    const upT = Math.max(phU / 2, (prT.top + prT.bottom) / 2 - Math.min(prT.top, brT && brT.bottom > brT.top ? brT.top : Infinity, tagT ? tagT.top : Infinity));
    const minY = bar + 8 + upT;
    const cxN = Math.max(pad + pwU / 2 + leftBias / 2, Math.min(aTop.x, w - pad - pwU / 2 + leftBias / 2));
    const cyN = Math.max(aTop.y, minY);
    const bodyT: Rect = rect(cxN - tPw / 2, cyN - tPh / 2, cxN + tPw / 2, cyN + tPh / 2);
    const bubT: Rect | null = brT ? rect(brT.left + (cxN - (prT.left + prT.right) / 2), brT.top + (cyN - (prT.top + prT.bottom) / 2), brT.right + (cxN - (prT.left + prT.right) / 2), brT.bottom + (cyN - (prT.top + prT.bottom) / 2)) : null;
    const unionT: Rect = bubT ? rect(Math.min(bodyT.left, bubT.left), bodyT.top, Math.max(bodyT.right, bubT.right), Math.max(bodyT.bottom, bubT.bottom)) : bodyT;
    const top: TopPlateGeom = { cx: cxN, cy: cyN, minY, ph: phU, body: bodyT, union: unionT, bubble: bubT };
    // --- gather: sides ---
    const sides: SidePlateGeom[] = [];
    for (const side of ['left', 'right'] as const) {
      const st = sideState[side];
      const a = side === 'left' ? aL : aR;
      const e = side === 'left' ? eL : eR;
      const curPw = st.narrow ? sizes.side.narrowW : sizes.side.wideW;
      const curPh = st.narrow ? sizes.side.phNarrow : sizes.side.phWide;
      const pr = side === 'left'
        ? rect(st.x + e.x, st.cy - curPh / 2 + e.y, st.x + curPw + e.x, st.cy + curPh / 2 + e.y)
        : rect(st.x - curPw + e.x, st.cy - curPh / 2 + e.y, st.x + e.x, st.cy + curPh / 2 + e.y);
      const tag = sizes.side.up > curPh / 2 ? rect(pr.left + 24, (pr.top + pr.bottom) / 2 - sizes.side.up, pr.left + 96, (pr.top + pr.bottom) / 2 - sizes.side.up + 12) : null;
      const up = Math.max(curPh / 2, tag ? (pr.top + pr.bottom) / 2 - tag.top : 0);
      if (!st.narrow) wideCache[side] = curPw;
      if (st.narrow) narrowCache[side] = curPw;
      const cy0 = plateCy0(a.y, bar, up);
      const ccx = side === 'left' ? st.x + curPw / 2 : st.x - curPw / 2;
      void ccx;
      const ax = side === 'left' ? Math.max(pad, a.x - 72) : Math.min(w - pad, a.x + 72);
      const body: Rect = side === 'left' ? rect(ax, cy0 - curPh / 2, ax + curPw, cy0 + curPh / 2) : rect(ax - curPw, cy0 - curPh / 2, ax, cy0 + curPh / 2);
      sides.push({ side, ax, y: a.y, pw: curPw, ph: curPh, up, wideW: wideCache[side] ?? curPw, narrowW: narrowCache[side] ?? null, body, bubble: null });
    }
    const input: PlateSolveInput = { width: w, height: h, barFloor: bar, slots, hud, top, sides };
    const solve = solvePlates(input);
    // --- apply ---
    topCx = solve.top!.cx; topCy = solve.top!.cy;
    topSeries.push(topCy);
    for (const side of ['left', 'right'] as const) {
      const out = solve.sides[side]!;
      sideState[side] = { x: out.x, cy: out.cy, narrow: out.wantNarrow };
      sideSeries[side].push(out.cy);
    }
  }
  return { topSeries, sideSeries };
}

const WORLDS: World[] = [
  { w: 390, h: 844, view: 'sitting', bar: 122, sizes: SIZES_A, label: '390x844 sitting A' },
  { w: 390, h: 844, view: 'standing', bar: 122, sizes: SIZES_A, label: '390x844 standing A' },
  { w: 393, h: 852, view: 'sitting', bar: 118, sizes: SIZES_B, label: '393x852 sitting B (bubble)' },
  { w: 430, h: 932, view: 'sitting', bar: 124, sizes: SIZES_A, label: '430x932 sitting A' },
  { w: 1440, h: 900, view: 'sitting', bar: 106, sizes: SIZES_B, label: '1440x900 sitting B (bubble)' },
  { w: 1440, h: 900, view: 'standing', bar: 106, sizes: SIZES_A, label: '1440x900 standing A' },
];
const ZOOMS = [0.85, 1, 1.15, 1.3];

describe('joint plate solve: the published partner anchor converges across the tilt sweep', () => {
  for (const world of WORLDS) {
    for (const zoom of ZOOMS) {
      it(`${world.label} zoom ${zoom}: stable at every tilt -15..15`, () => {
        for (let tilt = -15; tilt <= 15; tilt += 1) {
          const { topSeries, sideSeries } = runLoop(world, tilt, zoom, 16);
          // one settle pass is allowed (the narrow-class toggle re-measures
          // once); from pass 2 on the published anchors must be IDENTICAL —
          // any alternation is the limit cycle coming back
          expect(new Set(topSeries.slice(2)).size, `top tilt=${tilt} series=${JSON.stringify(topSeries)}`).toBe(1);
          expect(new Set(sideSeries.left!.slice(2)).size, `left tilt=${tilt}`).toBe(1);
          expect(new Set(sideSeries.right!.slice(2)).size, `right tilt=${tilt}`).toBe(1);
        }
      });
    }
  }

  it('the diagnosed band at fine grain: 390x844 sitting, zoom 1, tilt -15..-2 in 0.25 steps', () => {
    const world = WORLDS[0]!;
    for (let tilt = -15; tilt <= -2.001; tilt += 0.25) {
      const { topSeries } = runLoop(world, Math.round(tilt * 100) / 100, 1, 16);
      expect(new Set(topSeries.slice(2)).size, `tilt=${tilt} series=${JSON.stringify(topSeries)}`).toBe(1);
    }
  });

  it('regression point: tilt -10, zoom 1 (the owner screenshot geometry) — one value, no snap alternation', () => {
    const { topSeries } = runLoop(WORLDS[0]!, -10, 1, 40);
    expect(new Set(topSeries.slice(2)).size).toBe(1);
    // and the partner plate still TRACKS tilt: on the wide standing table
    // (no side contact, so the anchor follows the projection) a different
    // tilt publishes a different single stable anchor — no freezing
    const wide = WORLDS[5]!;
    const down = runLoop(wide, -10, 1, 8).topSeries;
    const up = runLoop(wide, 5, 1, 8).topSeries;
    expect(down[down.length - 1]).not.toBe(up[up.length - 1]);
  });
});

describe('the old feedback loop oscillates on these same inputs (the sweep has teeth)', () => {
  /** The pre-fix layout, modelled faithfully: per-plate callbacks reading
   *  each other's APPLIED rects (quantized to the DPR-3 device grid, the
   *  real measurement condition) plus the dataset.moved snap. Kept as the
   *  defect's documentation — if this ever stops oscillating, the sweep
   *  above has drifted out of the band that hurt the owner. */
  function oldLoop(world: World, tilt: number, zoom: number, passes: number): number[] {
    const { w, h, bar, sizes } = world;
    const cam = camAt(w, h, world.view, tilt, zoom);
    const slots = slotRects(cam, w, h);
    const aTop = project(cam, w, h, badgeSpot('top', 4));
    const aL = project(cam, w, h, badgeSpot('left', 4));
    const aR = project(cam, w, h, badgeSpot('right', 4));
    const q = (v: number) => Math.round(v * 3) / 3;
    const minY = bar + 8 + sizes.top.up;
    const topCx = Math.max(6 + sizes.top.pw / 2, Math.min(aTop.x, w - 6 - sizes.top.pw / 2));
    const area = (a: Rect, b: Rect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const sideCalc = (side: 'left' | 'right', tp: Rect, other: Rect) => {
      const a = side === 'left' ? aL : aR;
      const ax = side === 'left' ? Math.max(6, a.x - 72) : Math.min(w - 6, a.x + 72);
      const pw = sizes.side.narrowW, ph = sizes.side.phWide;
      const cy0 = Math.max(a.y, bar + 8 + sizes.side.up);
      const hits = (ww: number, hh: number, cy: number) => {
        const l = side === 'left' ? ax : ax - ww, r = l + ww;
        return slots.filter((t) => r + 6 > t.left && l - 6 < t.right && cy + hh / 2 + 6 > t.top && cy - hh / 2 - 6 < t.bottom);
      };
      let topHit = false;
      { const l = side === 'left' ? ax : ax - pw, r = l + pw;
        topHit = r + 6 > tp.left && l - 6 < tp.right && cy0 + ph / 2 + 6 > tp.top && cy0 - ph / 2 - 6 < tp.bottom; }
      if (!hits(pw, ph, cy0).length && !topHit) return { cy: cy0, moved: false };
      const plateRects = [tp, other];
      const cost = (px: number, cy: number) => {
        const l = side === 'left' ? px : px - pw;
        const box = rect(l - 6, cy - ph / 2 - 6, l + pw + 6, cy + ph / 2 + 6);
        const real = rect(l, cy - ph / 2, l + pw, cy + ph / 2);
        const off = cy - ph / 2 < bar + 4 || cy + ph / 2 > h - 4 ? 1e9 : 0;
        return off + slots.reduce((acc, t) => acc + area(real, t) * 400 + area(box, t) * 10, 0)
          + plateRects.reduce((acc, r) => acc + area(real, r) * 400 + area(box, r) * 10, 0);
      };
      const hit = hits(pw, ph, cy0);
      const cands: [number, number][] = [[ax, cy0]];
      if (hit.length) {
        const up2 = Math.min(...hit.map((t) => t.top)) - 6 - ph / 2;
        let down = Math.max(...hit.map((t) => t.bottom)) + 6 + ph / 2;
        for (let k = 0; k < 4; k++) { const more = hits(pw, ph, down); if (!more.length) break; down = Math.max(...more.map((t) => t.bottom)) + 6 + ph / 2; }
        cands.push([ax, up2], [ax, down]);
      }
      cands.push([ax, tp.bottom + 6 + ph / 2]);
      let best = cands[0]!, bc = Infinity;
      for (const c of cands) { const k = cost(c[0], c[1]); if (k < bc) { bc = k; best = c; } }
      return { cy: best[1], moved: true };
    };
    const topRectAt = (cy: number): Rect => rect(q(topCx - sizes.top.pw / 2), q(cy - sizes.top.ph / 2), q(topCx + sizes.top.pw / 2), q(cy + sizes.top.ph / 2));
    const sideRectAt = (side: 'left' | 'right', cy: number): Rect => {
      const a = side === 'left' ? aL : aR;
      const ax = side === 'left' ? Math.max(6, a.x - 72) : Math.min(w - 6, a.x + 72);
      const l = side === 'left' ? ax : ax - sizes.side.narrowW;
      return rect(q(l), q(cy - sizes.side.phWide / 2), q(l + sizes.side.narrowW), q(cy + sizes.side.phWide / 2));
    };
    let topCy = Math.max(aTop.y, minY);
    let lCy = Math.max(aL.y, bar + 8 + sizes.side.up), rCy = Math.max(aR.y, bar + 8 + sizes.side.up);
    let lMoved = false, rMoved = false;
    const series: number[] = [];
    for (let f = 0; f < passes; f++) {
      const L = sideCalc('left', topRectAt(topCy), sideRectAt('right', rCy));
      lCy = L.cy; lMoved = L.moved;
      let cy = Math.max(aTop.y, minY);
      const sides = [q(lCy - sizes.side.phWide / 2), q(rCy - sizes.side.phWide / 2)].filter((t) => t > 0);
      if (sides.length) cy = Math.max(minY, Math.min(cy, Math.min(...sides) - 6 - sizes.top.ph / 2));
      if (lMoved || rMoved) cy = minY;
      topCy = cy;
      const R = sideCalc('right', topRectAt(topCy), sideRectAt('left', lCy));
      rCy = R.cy; rMoved = R.moved;
      series.push(Math.round(topCy * 10) / 10);
    }
    return series;
  }

  it('tilt -10.25, zoom 1: the old loop alternates the partner plate by tens of px', () => {
    // the quantized band is perforated — at exactly -10.00 the coin flip
    // lands stable, at -10.25 it alternates ~77px (diagnosis sim). That
    // perforation IS the owner's "depending on my tilt".
    const series = oldLoop(WORLDS[0]!, -10.25, 1, 40).slice(10);
    const amp = Math.max(...series) - Math.min(...series);
    expect(amp).toBeGreaterThan(40);
  });

  it('tilt -14.5, zoom 1: the old loop alternates by >100px', () => {
    const series = oldLoop(WORLDS[0]!, -14.5, 1, 40).slice(10);
    const amp = Math.max(...series) - Math.min(...series);
    expect(amp).toBeGreaterThan(100);
  });
});

describe('the fix stays at the source', () => {
  it('Scene.tsx publishes plates from the joint solve and never reads dataset.moved back', () => {
    const scene = src('three/Scene.tsx');
    expect(scene).toContain('solvePlates');
    expect(scene).not.toContain("dataset.moved === '1'");
  });

  it('the solver is pure: no DOM, no three, no applied-position input', () => {
    const layout = src('three/plateLayout.ts');
    expect(layout).not.toContain('document.');
    expect(layout).not.toContain('getBoundingClientRect');
    expect(layout).not.toMatch(/from 'three'/);
  });
});
