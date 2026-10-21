import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { badgeSpot, makeCamera, trickSpot, CH, CW } from '../src/three/layout';

/**
 * Portrait plate collisions (owner 2026-10-20, iPhone screenshot): in portrait — Sitting
 * view especially — the three upper plates (partner top-center, opponents at the edges)
 * share one band under the scorebug. At their old sizes (~170px wide, ~57px tall) they
 * summed wider than the screen AND stacked in the same vertical band, so the partner
 * plate landed on both opponents. Two changes fix it:
 *  1. CSS: badge plates get a compact portrait composition (styles.css, <= 480px), so a
 *     side plate tops out around 148px wide / 48px tall and the partner around 176px.
 *  2. Scene.tsx Badges: the partner plate is a hard obstacle for the side plates (not
 *     just the trick slots) — a side plate whose natural spot would touch it steps down
 *     under it, and other plates weigh like trick slots in the placement cost.
 * These tests pin the geometry that makes the stagger work: with the compact sizes, the
 * stepped-down side plate clears the partner plate everywhere, and on the owner's
 * iPhone-class screens it also clears every trick slot.
 */
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

type Rect = { l: number; r: number; t: number; b: number };
const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));

const project = (cam: PerspectiveCamera, w: number, h: number, v: [number, number, number]) => {
  const p = new Vector3(...v).project(cam);
  return { x: ((p.x + 1) * w) / 2, y: ((1 - p.y) * h) / 2 };
};

/** a seat's trick-slot rect in CSS px, the way Scene.tsx trickRects computes it (4px slack) */
function slotRect(cam: PerspectiveCamera, w: number, h: number, pos: 'bottom' | 'left' | 'top' | 'right'): Rect {
  const t = trickSpot(pos, 4, 0, 0);
  const m = new Matrix4().compose(new Vector3(...t.p), new Quaternion(...t.q), new Vector3(t.s, t.s, t.s));
  let l = Infinity, r = -Infinity, tp = Infinity, b = -Infinity;
  for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const v = new Vector3((cx * CW) / 2, (cy * CH) / 2, 0).applyMatrix4(m).project(cam);
    const x = ((v.x + 1) * w) / 2, y = ((1 - v.y) * h) / 2;
    l = Math.min(l, x); r = Math.max(r, x); tp = Math.min(tp, y); b = Math.max(b, y);
  }
  return { l: l - 4, r: r + 4, t: tp - 4, b: b + 4 };
}

const BAR = 124; // scorebug bottom on phones (the trump strip folds into the bug)
const GAP = 6;

/** Place the three upper plates the way the engine does: partner pinned under the bar,
 *  side plates at their edge anchor, stepped down under the partner plate on contact. */
function place(w: number, h: number, view: 'sitting' | 'standing', side: { pw: number; ph: number }, top: { pw: number; ph: number }) {
  const cam = makeCamera(w / h, false, view);
  const pad = 6;
  const aT = project(cam, w, h, badgeSpot('top', 4));
  const topCx = Math.min(Math.max(aT.x, pad + top.pw / 2), w - pad - top.pw / 2);
  const topCy = Math.max(aT.y, BAR + 8 + top.ph / 2);
  const topRect: Rect = { l: topCx - top.pw / 2, r: topCx + top.pw / 2, t: topCy - top.ph / 2, b: topCy + top.ph / 2 };
  const slots = (['bottom', 'left', 'top', 'right'] as const).map((p) => slotRect(cam, w, h, p));
  const sides = (['left', 'right'] as const).map((s) => {
    const a = project(cam, w, h, badgeSpot(s, 4));
    const ax = s === 'left' ? Math.max(pad, a.x - 72) : Math.min(w - pad, a.x + 72);
    const l = s === 'left' ? ax : ax - side.pw;
    const natural: Rect = { l, r: l + side.pw, t: a.y - side.ph / 2, b: a.y + side.ph / 2 };
    const touchesTop = natural.r + GAP > topRect.l && natural.l - GAP < topRect.r && natural.b + GAP > topRect.t && natural.t - GAP < topRect.b;
    const placed: Rect = touchesTop
      ? { l, r: l + side.pw, t: topRect.b + GAP, b: topRect.b + GAP + side.ph }
      : natural;
    return { side: s, natural, placed };
  });
  return { topRect, sides, slots };
}

const COMPACT_SIDE = { pw: 148, ph: 48 };
const COMPACT_TOP = { pw: 176, ph: 48 };
const PORTRAIT: [number, number][] = [[390, 844], [393, 852], [430, 932], [375, 667], [360, 740]];
const MAINSTREAM: [number, number][] = [[390, 844], [393, 852], [430, 932]];

describe('portrait three-across plate geometry', () => {
  it('documents the bug: at the old sizes the natural spots collide on a 390px iPhone (sitting)', () => {
    const { topRect, sides } = place(390, 844, 'sitting', { pw: 172, ph: 57 }, { pw: 190, ph: 57 });
    for (const s of sides) expect(overlapArea(s.natural, topRect)).toBeGreaterThan(0);
  });

  for (const [w, h] of PORTRAIT) {
    for (const view of ['sitting', 'standing'] as const) {
      it(`${w}x${h} ${view}: compact side plates never overlap the partner plate`, () => {
        const { topRect, sides } = place(w, h, view, COMPACT_SIDE, COMPACT_TOP);
        for (const s of sides) {
          expect(overlapArea(s.placed, topRect)).toBe(0);
          expect(s.placed.l).toBeGreaterThanOrEqual(0);
          expect(s.placed.r).toBeLessThanOrEqual(w);
        }
      });
    }
  }

  for (const [w, h] of MAINSTREAM) {
    for (const view of ['sitting', 'standing'] as const) {
      it(`${w}x${h} ${view}: the staggered side plates also clear every trick slot`, () => {
        const { sides, slots } = place(w, h, view, COMPACT_SIDE, COMPACT_TOP);
        for (const s of sides) for (const slot of slots) expect(overlapArea(s.placed, slot)).toBe(0);
      });
    }
  }
});

/**
 * Wide screens (owner 2026-10-21, Mac Safari): in Sitting view the side anchors project
 * INTO the scorebug band (y~66 at 1440x900 — the bug occupies the top ~73-106px), and the
 * badge layer paints UNDER the scorebug (z 2 vs z 8), so both opponent plates rendered
 * hidden behind it; only avatar arcs peeked out. Standing projects the same anchors to
 * y~251, clear of the bar — which is why only sitting + wide broke. The partner plate's
 * branch always floored itself under the bar; the fix gives the side plates the same
 * floor (barFloor in Scene.tsx Badges): their working centre starts at bar + 8 + up.
 * This model mirrors that placement and pins the outcome across the wide matrix.
 */
const WIDE: [number, number][] = [[1440, 900], [1280, 800], [1180, 820], [1024, 768]];
const DESKTOP_SIDE = { pw: 190, ph: 47 };
const DESKTOP_TOP = { pw: 220, ph: 47 };

function placeWide(w: number, h: number, view: 'sitting' | 'standing', bar: number) {
  const cam = makeCamera(w / h, false, view);
  const pad = 6;
  const aT = project(cam, w, h, badgeSpot('top', 4));
  const topCx = Math.min(Math.max(aT.x, pad + DESKTOP_TOP.pw / 2), w - pad - DESKTOP_TOP.pw / 2);
  const topCy = Math.max(aT.y, bar + 8 + DESKTOP_TOP.ph / 2);
  const topRect: Rect = { l: topCx - DESKTOP_TOP.pw / 2, r: topCx + DESKTOP_TOP.pw / 2, t: topCy - DESKTOP_TOP.ph / 2, b: topCy + DESKTOP_TOP.ph / 2 };
  const slots = (['bottom', 'left', 'top', 'right'] as const).map((p) => slotRect(cam, w, h, p));
  const sides = (['left', 'right'] as const).map((s) => {
    const a = project(cam, w, h, badgeSpot(s, 4));
    const ax = s === 'left' ? Math.max(pad, a.x - 72) : Math.min(w - pad, a.x + 72);
    const l = s === 'left' ? ax : ax - DESKTOP_SIDE.pw;
    const cy0 = Math.max(a.y, bar + 8 + DESKTOP_SIDE.ph / 2); // the barFloor clamp
    const natural: Rect = { l, r: l + DESKTOP_SIDE.pw, t: a.y - DESKTOP_SIDE.ph / 2, b: a.y + DESKTOP_SIDE.ph / 2 };
    const floored: Rect = { l, r: l + DESKTOP_SIDE.pw, t: cy0 - DESKTOP_SIDE.ph / 2, b: cy0 + DESKTOP_SIDE.ph / 2 };
    const touches = (r: Rect) => r.r + GAP > floored.l && r.l - GAP < floored.r && r.b + GAP > floored.t && r.t - GAP < floored.b;
    const placed: Rect = touches(topRect) || slots.some(touches)
      ? { l, r: l + DESKTOP_SIDE.pw, t: topRect.b + GAP, b: topRect.b + GAP + DESKTOP_SIDE.ph }
      : floored;
    return { side: s, anchor: a, natural, placed };
  });
  return { topRect, sides, slots };
}

describe('wide screens: side plates clear the top bar (Mac sitting bug)', () => {
  it('documents the bug: sitting side anchors project into the scorebug band on wide screens', () => {
    for (const [w, h] of WIDE) {
      const { sides } = placeWide(w, h, 'sitting', 106);
      for (const s of sides) {
        // the plate centre itself sits above the bar's fallback bottom, and the plate
        // top reaches well into the band the scorebug paints over (z 8 over badge z 2)
        expect(s.anchor.y).toBeLessThan(106);
        expect(s.natural.t).toBeLessThan(73); // even the SHORTEST real bug (73px) covers the plate top
      }
    }
  });

  it('standing projects the same anchors clear of the bar (why only sitting broke)', () => {
    for (const [w, h] of WIDE) {
      const { sides } = placeWide(w, h, 'standing', 106);
      for (const s of sides) expect(s.natural.t).toBeGreaterThan(106);
    }
  });

  // bar = 73: the measured desktop scorebug bottom. bar = 106: the engine's own
  // fallback for >=900px widths when it cannot measure — the lowest the floor can sit.
  for (const bar of [73, 106]) {
    for (const [w, h] of WIDE) {
      for (const view of ['sitting', 'standing'] as const) {
        it(`${w}x${h} ${view} (bar ${bar}): floored side plates are visible and clear of partner + slots`, () => {
          const { topRect, sides, slots } = placeWide(w, h, view, bar);
          for (const s of sides) {
            expect(s.placed.t).toBeGreaterThanOrEqual(bar + 8 - 1);
            expect(overlapArea(s.placed, topRect)).toBe(0);
            for (const slot of slots) expect(overlapArea(s.placed, slot)).toBe(0);
            expect(s.placed.l).toBeGreaterThanOrEqual(0);
            expect(s.placed.r).toBeLessThanOrEqual(w);
            expect(s.placed.b).toBeLessThanOrEqual(h);
          }
        });
      }
    }
  }
});

describe('the engine and CSS carry the fix', () => {
  const scene = src('three/Scene.tsx');
  const css = src('styles.css');

  it('Badges treats the partner plate as an obstacle for the side plates, not just trick slots', () => {
    expect(scene).toContain('topHit');
    // other plates weigh like trick slots in the placement cost (400), the plain HUD stays at 40
    expect(scene).toMatch(/plateRects\.reduce\(\(a, r\) => a \+ area\(real, r\) \* 400/);
    expect(scene).toMatch(/hud\.reduce\(\(a, r\) => a \+ area\(real, r\) \* 40/);
    // the stagger candidate (right under the partner plate) is offered whenever the plate exists
    expect(scene).toContain('cands.push([ax, tp.bottom + 6 + ph / 2])');
  });

  it('badge plates get the compact portrait composition; your own plate is untouched', () => {
    const block = css.slice(css.indexOf('@media (min-width: 341px) and (max-width: 480px)'));
    const compact = block.slice(0, block.indexOf('\n}\n') + 3);
    expect(compact).toContain('.badge-layer .plate-avatar { width: 30px; height: 30px');
    expect(compact).toContain('--ring-d: 30px');
    expect(compact).toContain('.badge-layer .plate-name { font-size: 13.5px');
    expect(compact).toContain('padding-left: 28px'); // countdown-ring name clearance survives
    expect(compact).not.toContain('me-plate');
    // scoped to portrait badge plates only: landscape keeps its own rules
    expect(compact).toContain('.table-screen:not(.short) .badge-layer');
  });

  it('Badges floors the SIDE plates under the top bar too, not just the partner plate', () => {
    // measured from the live scorebug / trump strip, with the same >=900px fallback family
    expect(scene).toContain('barFloor');
    expect(scene).toMatch(/stripR && stripR\.height > 0 \? stripR\.bottom : bugR \? bugR\.bottom : size\.width >= 900 \? 106 : 122/);
    // the working centre for every side-plate decision starts at or below bar + 8
    expect(scene).toMatch(/const cy0 = Math\.max\(y, barFloor \+ 8 \+ up\)/);
    // the unmeasured first frame is floored too (half the 56px fallback plate height)
    expect(scene).toContain('barFloor + 8 + 28');
    // the natural (unstaggered) placement returns the floored centre
    expect(scene).toMatch(/return \[ax, cy0\]/);
  });

  it('the last-trick chip clears the controls rail (its box ends left of the rail footprint)', () => {
    const base = css.indexOf('right: calc(8px + env(safe-area-inset-right))');
    const fix = css.indexOf('right: calc(58px + env(safe-area-inset-right))');
    expect(base).toBeGreaterThan(-1);
    expect(fix).toBeGreaterThan(base); // the override lands after the base rule and wins
  });
});
