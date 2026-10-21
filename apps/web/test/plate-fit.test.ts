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

  it('the last-trick chip clears the controls rail (its box ends left of the rail footprint)', () => {
    const base = css.indexOf('right: calc(8px + env(safe-area-inset-right))');
    const fix = css.indexOf('right: calc(58px + env(safe-area-inset-right))');
    expect(base).toBeGreaterThan(-1);
    expect(fix).toBeGreaterThan(base); // the override lands after the base rule and wins
  });
});
