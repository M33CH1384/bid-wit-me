import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { badgeSpot, makeCamera, trickSpot, CH, CW, cardScreenQuad, handFan, phoneHandFan, MIN_STRIP_PX, PHONE_HAND_STRIP_PX } from '../src/three/layout';

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
  // The placement solve moved out of Scene.tsx's Badges into the pure joint
  // solver (three/plateLayout.ts) in the 2026-10-30 plate-jitter fix — the
  // pins below follow the logic to its new home, assertions unchanged.
  const layout = src('three/plateLayout.ts');
  const css = src('styles.css');

  it('Badges treats the partner plate as an obstacle for the side plates, not just trick slots', () => {
    expect(layout).toContain('topHit');
    // other plates weigh like trick slots in the placement cost (400), the plain HUD stays at 40
    expect(layout).toMatch(/plateRects\.reduce\(\(a, r\) => a \+ area\(real, r\) \* 400/);
    expect(layout).toMatch(/hud\.reduce\(\(a, r\) => a \+ area\(real, r\) \* 40/);
    // the stagger candidate (right under the partner plate) is offered whenever the plate exists
    expect(layout).toContain('cands.push([ax, tp.bottom + 6 + ph / 2])');
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
    expect(layout).toMatch(/const cy0 = Math\.max\(y, barFloor \+ 8 \+ up\)/);
    // the unmeasured first frame is floored too (half the 56px fallback plate height)
    expect(scene).toContain('barFloor + 8 + 28');
    // the natural (unstaggered) placement returns the floored centre
    expect(layout).toMatch(/return \{ x: ax, cy: cy0, moved: false/);
  });

  it('the last-trick chip clears the controls rail (its box ends left of the rail footprint)', () => {
    // Anchor on the .last-trick rules themselves: other rules (e.g. the King's
    // rail, .king-rail-side.right) legitimately reuse the same right: calc(...)
    // values earlier in the file, so a bare value search finds the wrong rule.
    const base = css.indexOf('.last-trick, .last-trick.glass.slant { position: absolute; right: calc(8px + env(safe-area-inset-right))');
    const fix = css.indexOf('.last-trick, .last-trick.glass.slant { right: calc(58px + env(safe-area-inset-right))');
    expect(fix).toBeGreaterThan(-1);
    expect(base).toBeGreaterThan(-1);
    expect(fix).toBeGreaterThan(base); // the override lands after the base rule and wins
  });
});

/**
 * Last-trick pill: the phone corner (owner 2026-10-21). The chip used to hover at
 * bottom: 23vh + 64px, ON the fanned hand (it covered the K♦ in his Barbershop
 * shot) with the winner's name hard-sliced to 8 chars ("Mr. Cole"). On phones it
 * now anchors to the lower-right corner below the hand; Table renders the full
 * name and the chip sizes to it under caps that respect the corner's other
 * tenant (the me-plate, fixed bottom-left, max-width 62vw) and, in landscape,
 * the fan solver's side reserve. Desktop keeps the old spot.
 * The geometry below uses the game's own fan math (handFan + cardScreenQuad,
 * the same transforms Scene.tsx hit-tests with) — happy-dom paints nothing, so
 * these are layout pins, not pixel proof; the owner's iPhone is the pixel proof.
 * Modelled pill boxes are deliberately pessimistic: chip 26px tall (real ~24),
 * open 124px tall in portrait (label row + the ~30%-larger browser cards +
 * the 44px nav row, open padding trimmed to 5px), 108px in landscape, widths
 * at their CSS caps.
 *
 * The open browser's portrait placement (owner 2026-10-23, "needs not to
 * cover or go under my plate ... a bit larger for quick glance"): the cards
 * grew ~30% and the open box re-anchors — bottom edge 112px over the safe
 * inset (the me-plate's own 8px offset + its tallest 82px body + the 14px
 * turn badge + 8px of air) and right edge 66px in (the controls rail's 50px
 * footprint + 8px gap + 8px), clear of BOTH lower-corner tenants in either
 * view. The fan cost is real and pinned below, not hidden: the lifted box
 * crosses the lower strip corners of the middle fan cards while open, and
 * in Standing view — whose fan rides ~46px lower, with no bottom lift —
 * its band covers the index (D) corners of 2–4 cards. In Sitting view (the
 * owner's) every index stays visible on current phones. The browser is a
 * tap-open overlay; the plate guarantee is the hard one and holds at every
 * modelled size.
 */
describe('last trick pill: the phone corner (owner 2026-10-21)', () => {
  const css = src('styles.css');
  const table = src('Table.tsx');
  const corner = css.indexOf('Last trick on phones');
  const tail = css.slice(corner);

  it('the corner block lands after the rules it overrides; the desktop spot survives', () => {
    expect(corner).toBeGreaterThan(-1);
    expect(corner).toBeGreaterThan(css.indexOf('right: calc(58px + env(safe-area-inset-right))')); // the 2026-10-21 rail fix
    expect(corner).toBeGreaterThan(css.indexOf('bottom: calc(23vh + 64px + env(safe-area-inset-bottom)) !important'));
    expect(css).toContain('.last-trick { bottom: calc(23vh + 64px + env(safe-area-inset-bottom)) !important; }'); // desktop unchanged
  });

  it('portrait phones: the pill is pinned to the lower-right corner inside the <=480px block', () => {
    const media = tail.indexOf('@media (max-width: 480px)');
    const rule = '.table-screen:not(.short) .last-trick, .table-screen:not(.short) .last-trick.glass.slant { right: calc(10px + env(safe-area-inset-right)); bottom: calc(10px + env(safe-area-inset-bottom)) !important; }';
    const at = tail.indexOf(rule);
    expect(media).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(media);
    expect(at).toBeLessThan(tail.indexOf('\n}\n', media)); // the rule lives inside the media block
  });

  it('phone landscape: the same corner, 8px up from the bottom edge', () => {
    expect(tail).toContain('.table-screen.short .last-trick, .table-screen.short .last-trick.glass.slant { right: calc(10px + env(safe-area-inset-right)); bottom: calc(8px + env(safe-area-inset-bottom)) !important; }');
  });

  it('the chip sizes to the winner name under caps that respect the plate and the fan reserve', () => {
    expect(tail).toContain('max-width: min(60vw, calc(100vw - 212px))'); // portrait: left edge stays right of a 194px plate
    expect(tail).toContain('max-width: min(74vw, 320px)'); // portrait open
    expect(tail).toContain('.table-screen.short .last-trick.chip, .table-screen.short .last-trick.chip.glass.slant { max-width: 170px; }');
    expect(tail).toContain('.table-screen.short .last-trick.open, .table-screen.short .last-trick.open.glass.slant { max-width: 190px; }');
    // the label ellipsizes only past a cap, in both phone blocks
    expect(tail.match(/white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('portrait open browser (owner 2026-10-23): anchored clear of the plate and the rail; the chip keeps the corner', () => {
    const rule = '.table-screen:not(.short) .last-trick.open:not(.run-open), .table-screen:not(.short) .last-trick.open.glass.slant:not(.run-open) { right: calc(66px + env(safe-area-inset-right)); bottom: calc(112px + env(safe-area-inset-bottom)) !important; padding: 5px 14px; }';
    const media = tail.indexOf('@media (max-width: 480px)');
    const at = tail.indexOf(rule);
    expect(at).toBeGreaterThan(media); // inside the phone block, after the corner rules it refines
    expect(at).toBeLessThan(tail.indexOf('\n}\n', media));
    // the chip's own corner rule is byte-identical to the shipped one
    expect(tail).toContain('.table-screen:not(.short) .last-trick, .table-screen:not(.short) .last-trick.glass.slant { right: calc(10px + env(safe-area-inset-right)); bottom: calc(10px + env(safe-area-inset-bottom)) !important; }');
  });

  it('the browser cards grew ~30% (owner 2026-10-23); the Run It review keeps its own rendering', () => {
    expect(css).toContain('.lt-card { display: flex; flex-direction: column; align-items: center; line-height: 1; min-width: 34px; padding: 4px 5px; border-radius: 5px; background: #f6f1e6; color: #16121c; font-weight: 800; font-size: 19px; }');
    expect(css).toContain('.lt-card small { font-size: 12px; font-weight: 700; color: #6b6378; letter-spacing: .02em; margin-bottom: 2px; }');
    expect(css).toContain('.lt-card.win { box-shadow: 0 0 0 2px var(--gold), 0 0 12px rgba(var(--gold-rgb),.7); }');
    expect(css).toContain('.table-screen.short .lt-card { min-width: 31px; font-size: 17px; padding: 3px 4px; }');
    expect(css).toContain('.table-screen.short .lt-card small { font-size: 10px; }');
    // Run It review: centred modal + its 52px image cards, untouched
    expect(css).toContain('right: auto !important; top: 50% !important; bottom: auto !important;');
    expect(css).toContain('.run-hand-cards img { width: 52px; height: auto; aspect-ratio: 240 / 336; border-radius: 4px; box-shadow: 0 2px 6px rgba(0,0,0,.45); }');
  });

  it('Table renders the winner name in full — no 8-char slice', () => {
    expect(table).not.toContain('face(t.winner).slice(0, 8)');
    expect(table).toContain('· {face(t.winner)}');
  });

  type Pt = { x: number; y: number };
  const rectPoly = (l: number, t: number, r: number, b: number): Pt[] => [{ x: l, y: t }, { x: r, y: t }, { x: r, y: b }, { x: l, y: b }];
  /** SAT for convex polygons; "touching" = no axis separates them by more than 0.5px. */
  const touching = (p: Pt[], q: Pt[]) => {
    const axes: [number, number][] = [];
    for (const poly of [p, q]) for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      axes.push([-(b.y - a.y), b.x - a.x]);
    }
    for (const [ax, ay] of axes) {
      let mn1 = Infinity, mx1 = -Infinity, mn2 = Infinity, mx2 = -Infinity;
      for (const pt of p) { const d = pt.x * ax + pt.y * ay; mn1 = Math.min(mn1, d); mx1 = Math.max(mx1, d); }
      for (const pt of q) { const d = pt.x * ax + pt.y * ay; mn2 = Math.min(mn2, d); mx2 = Math.max(mx2, d); }
      if (Math.max(mn2 - mx1, mn1 - mx2) > 0.5) return false;
    }
    return true;
  };
  const pointInConvex = (pt: Pt, poly: Pt[]) => {
    let sign = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, c = poly[(i + 1) % poly.length]!;
      const cross = (c.x - a.x) * (pt.y - a.y) - (c.y - a.y) * (pt.x - a.x);
      if (cross !== 0) { if (sign === 0) sign = Math.sign(cross); else if (Math.sign(cross) !== sign) return false; }
    }
    return true;
  };
  /** area (px², 3px grid) of the given polygons inside a rect */
  const fanAreaIn = (rect: Pt[], quads: Pt[][]) => {
    const l = Math.min(...rect.map((p) => p.x)), r = Math.max(...rect.map((p) => p.x));
    const t = Math.min(...rect.map((p) => p.y)), b = Math.max(...rect.map((p) => p.y));
    let n = 0;
    for (let x = l + 1.5; x < r; x += 3) for (let y = t + 1.5; y < b; y += 3) {
      if (quads.some((q) => pointInConvex({ x, y }, q))) n++;
    }
    return n * 9;
  };
  /** the card's readable zone: its local top 35% (index end + the tappable strip line at 20%) */
  const stripPoly = (q: Pt[]): Pt[] => {
    const [A, B, C, D] = q as [Pt, Pt, Pt, Pt];
    const lerp = (p: Pt, t: Pt, f: number): Pt => ({ x: p.x + (t.x - p.x) * f, y: p.y + (t.y - p.y) * f });
    return [D, C, lerp(C, B, 0.35), lerp(D, A, 0.35)];
  };
  /** fan quads exactly as Scene.tsx lays them out (portrait phone opts / short opts) */
  const portraitQuads = (w: number, h: number, safeB: number, view: 'standing' | 'sitting', count: number): Pt[][] => {
    const aspect = w / h;
    const sittingBottom = view === 'sitting' ? (safeB + 12) / h : 0;
    const opts = { ...phoneHandFan(), view, bottomFrac: (phoneHandFan().bottomFrac ?? 0) + sittingBottom, minStripPx: count > 13 ? MIN_STRIP_PX : PHONE_HAND_STRIP_PX, pxW: w };
    return Array.from({ length: count }, (_, i) => cardScreenQuad(aspect, handFan(aspect, count, i, 0, 0, opts, 0, h), w, h, 0, false, view));
  };
  const shortQuads = (w: number, h: number, safeSide: number, view: 'standing' | 'sitting', count: number): Pt[][] => {
    const aspect = w / h;
    const sittingBottom = view === 'sitting' ? 12 / h : 0; // landscape models carry no bottom inset
    const opts = { short: true, view, reserveFrac: (safeSide + 186) / w, bottomFrac: sittingBottom, heightFrac: 0.32, minStripPx: MIN_STRIP_PX, pxW: w };
    return Array.from({ length: count }, (_, i) => cardScreenQuad(aspect, handFan(aspect, count, i, 0, safeSide / w, opts, 0, h), w, h, 0, true, view));
  };

  const CHIP_H = 26, OPEN_H = 124, OPEN_H_SHORT = 108;
  const portraitChip = (w: number, h: number, safeB: number) => { const wd = Math.min(0.6 * w, w - 212); const r = w - 10; const b = h - (10 + safeB); return rectPoly(r - wd, b - CHIP_H, r, b); };
  // the open browser's 2026-10-23 anchor: bottom edge 112px over the inset, right edge 66px in
  const portraitOpen = (w: number, h: number, safeB: number) => { const wd = Math.min(0.74 * w, 320); const r = w - 66; const b = h - (112 + safeB); return rectPoly(r - wd, b - OPEN_H, r, b); };
  const shortChip = (w: number, h: number, safeR: number) => { const r = w - (10 + safeR); const b = h - 8; return rectPoly(r - 170, b - CHIP_H, r, b); };
  const shortOpen = (w: number, h: number, safeR: number) => { const r = w - (10 + safeR); const b = h - 8; return rectPoly(r - 190, b - OPEN_H_SHORT, r, b); };
  /** the me-plate at its worst: 82px body (toggles wrapped) + the 14px turn badge above it */
  const mePlate = (w: number, h: number, safeB: number) => { const b = h - (8 + safeB); return rectPoly(8, b - 96, 8 + Math.min(0.62 * w, 250), b); };
  /** the controls rail: 50px footprint at right: 8px, ~220px stack over bottom: 23vh + 8px */
  const ctlRail = (w: number, h: number, safeB: number) => { const b = h - (0.23 * h + 8 + safeB); return rectPoly(w - 58, b - 220, w - 8, b); };
  /** axis-aligned overlap area (every modelled box here is a rect) */
  const overlapArea = (a: Pt[], c: Pt[]) => {
    const ax = [Math.min(...a.map((p) => p.x)), Math.max(...a.map((p) => p.x))], ay = [Math.min(...a.map((p) => p.y)), Math.max(...a.map((p) => p.y))];
    const cx = [Math.min(...c.map((p) => p.x)), Math.max(...c.map((p) => p.x))], cy = [Math.min(...c.map((p) => p.y)), Math.max(...c.map((p) => p.y))];
    return Math.max(0, Math.min(ax[1]!, cx[1]!) - Math.max(ax[0]!, cx[0]!)) * Math.max(0, Math.min(ay[1]!, cy[1]!) - Math.max(ay[0]!, cy[0]!));
  };

  const PORTRAITS: [number, number, number][] = [[390, 844, 34], [393, 852, 34], [414, 896, 34], [430, 932, 34], [375, 667, 0], [360, 740, 20], [320, 568, 0]];
  const VIEWS = ['standing', 'sitting'] as const;

  it('sitting portrait (the owner\'s view): the chip clears every fan card with room to spare', () => {
    for (const [w, h, safeB] of PORTRAITS) for (const count of [13, 17]) {
      const quads = portraitQuads(w, h, safeB, 'sitting', count);
      const chip = portraitChip(w, h, safeB);
      for (const q of quads) expect(touching(chip, q)).toBe(false);
      const fanBottom = Math.max(...quads.flatMap((q) => q.map((p) => p.y)));
      const chipTop = h - (10 + safeB) - CHIP_H;
      expect(chipTop - fanBottom).toBeGreaterThanOrEqual(8); // a real air gap, not a graze
    }
  });

  it('standing portrait: the chip never touches a strip zone; only the outermost card\'s bottom corner can reach it (<=16px of quad)', () => {
    // The standing fan's end cards dip to ~6.5% of height; with a notched phone's
    // 34px inset the strip under them is ~21px — a few px short of the chip — so
    // the last card's rounded bottom corner can kiss the chip's top edge. The
    // quad ignores the card's corner radius, so the pinned bound is the quad's.
    for (const [w, h, safeB] of PORTRAITS) for (const count of [13, 17]) {
      const quads = portraitQuads(w, h, safeB, 'standing', count);
      const chip = portraitChip(w, h, safeB);
      const chipTop = h - (10 + safeB) - CHIP_H;
      quads.forEach((q, i) => {
        expect(touching(chip, stripPoly(q))).toBe(false); // never the readable zone, any card
        if (i < count - 1) expect(touching(chip, q)).toBe(false);
        else if (touching(chip, q)) expect(Math.max(...q.map((p) => p.y)) - chipTop).toBeLessThanOrEqual(16);
      });
    }
  });

  it('portrait open browser: never touches the me-plate or the controls rail, in either view (owner 2026-10-23)', () => {
    for (const [w, h, safeB] of PORTRAITS) for (const view of VIEWS) for (const count of [13, 17]) {
      const open = portraitOpen(w, h, safeB);
      expect(overlapArea(open, mePlate(w, h, safeB))).toBe(0); // not over the plate...
      expect(overlapArea(open, ctlRail(w, h, safeB))).toBe(0); // ...and not under the rail
      // the margin is structural, not a graze: exactly 8px of air over the
      // plate's badge, and the box's right edge stops 8px short of the rail
      expect((h - (112 + safeB)) - (h - (8 + safeB) - 96)).toBe(-8);
      expect((w - 66) - (w - 58)).toBe(-8);
    }
  });

  it('portrait open state: sitting keeps every index visible on current phones; the fan cost is bounded and documented', () => {
    // Measured with the game's own fan math at the 124px model: sitting strip
    // contact peaks ~7,100px² (the box crosses the lower strip corners of the
    // middle cards while open — the price of sitting above the plate, paid
    // only while browsing); standing peaks ~13,000px² with 2–4 index corners
    // under the band (its fan rides ~46px lower). Bounds carry headroom for
    // model noise; the plate/rail zero above carries none.
    for (const [w, h, safeB] of PORTRAITS) for (const view of VIEWS) for (const count of [13, 17]) {
      const quads = portraitQuads(w, h, safeB, view, count);
      const open = portraitOpen(w, h, safeB);
      const [ol, ot, orr, ob] = [Math.min(...open.map((p) => p.x)), Math.min(...open.map((p) => p.y)), Math.max(...open.map((p) => p.x)), Math.max(...open.map((p) => p.y))];
      const dIn = quads.filter((q) => { const D = q[3]!; return D.x >= ol && D.x <= orr && D.y >= ot && D.y <= ob; }).length;
      const stripArea = fanAreaIn(open, quads.map(stripPoly));
      if (view === 'sitting') {
        if ([390, 393, 414].includes(w)) expect(dIn).toBe(0); // current phones: every index readable while browsing
        else expect(dIn).toBeLessThanOrEqual(2); // 430px/17-card and the small-screen classes: a corner or two
        expect(stripArea).toBeLessThanOrEqual(7500);
      } else {
        expect(dIn).toBeLessThanOrEqual(4); // standing trade-off, documented in the header
        expect(stripArea).toBeLessThanOrEqual(13500);
      }
    }
  });

  it('phone landscape: the chip clears every fan card; the open box reaches <=26px into the outermost card\'s end', () => {
    const SHORTS: [number, number, number][] = [[844, 390, 44], [932, 430, 44], [740, 360, 44], [667, 375, 0]];
    for (const [w, h, safe] of SHORTS) for (const view of VIEWS) for (const count of [13, 17]) {
      const quads = shortQuads(w, h, safe, view, count);
      const chip = shortChip(w, h, safe);
      for (const q of quads) expect(touching(chip, q)).toBe(false);
      const open = shortOpen(w, h, safe);
      // the me-plate in landscape: bottom-left, bottom: 10px, modelled at a
      // generous 62vw-equivalent width — the open box clears it by width alone
      const plateL = rectPoly(8, h - 10 - 88, 8 + Math.min(0.62 * w, 413), h - 10);
      expect(overlapArea(open, plateL)).toBe(0);
      const openL = Math.min(...open.map((p) => p.x));
      const fanRight = Math.max(...quads.flatMap((q) => q.map((p) => p.x)));
      expect(fanRight - openL).toBeLessThanOrEqual(26); // the reach bound set by the solver's 186px reserve
      quads.forEach((q, i) => {
        if (i < count - 1) expect(Math.max(...q.map((p) => p.x)) - openL).toBeLessThanOrEqual(2); // at most a quad-corner sliver
      });
    }
  });
});

/**
 * Short landscape: the right seat plate vs the controls rail (owner 2026-10-22,
 * iPhone landscape screenshot): Pat's plate read "PAT ON N…" / "BID 4 T…" — its
 * tail hid under the vertical controls rail. In the short layout Scene.tsx pins
 * the side plates to fixed edge anchors (no obstacle pass like portrait has),
 * and the right plate's right edge IS its anchor (styles.css:
 * .seat-anchor.side-right > .plate { transform: translate(-100%, -50%) }). The
 * old anchor — width - 8 - safeR — is also the rail's right edge (the rail sits
 * at right: calc(8px + safe-area) with 44px buttons: a 50px footprint, see the
 * .ctl-rail note in styles.css), so the plate's last 42px lay under the rail
 * wherever the vertical bands met — and at the 0.43H (0.36H for 3P) anchor
 * height they always meet. The anchor now stops 58px in: the rail's footprint
 * plus the same 8px gap the last-trick chip already uses, so plate and rail
 * sit side by side in the right edge strip, both fully visible/tappable.
 * happy-dom paints nothing: these are layout pins from the CSS/anchor numbers,
 * not pixel proof; the owner's iPhone is the pixel proof.
 */
describe('short landscape: the right plate clears the controls rail (owner 2026-10-22)', () => {
  const scene = src('three/Scene.tsx');
  const css = src('styles.css');

  // iPhone landscape CSS sizes + side safe-area inset (notch), down to the
  // smallest landscape phones. safeB is 0 in landscape (the home bar rides the
  // long edge), which also puts the rail at its lowest — the worst case.
  const SHORT_LAND: [number, number, number][] = [[932, 430, 44], [844, 390, 44], [780, 360, 44], [740, 360, 44], [667, 375, 0]];
  const PLATE = { pw: 190, ph: 44 }; // pessimistic short plate: long name + DEALER + ON NOTICE
  const RAIL_H = 220; // the rail stack (styles.css, on the last-trick fix: "a ~220px stack")

  const railRect = (w: number, h: number, safeR: number): Rect => {
    const b = h - (0.23 * h + 8); // bottom: calc(23vh + 8px + safeB), safeB = 0 here
    return { l: w - 50 - safeR, r: w - 8 - safeR, t: b - RAIL_H, b };
  };
  const plateRect = (w: number, h: number, safeR: number, anchorInset: number, n: 3 | 4): Rect => {
    const r = w - anchorInset - safeR; // the anchor is the plate's right edge (translate(-100%))
    const cy = h * (n === 3 ? 0.36 : 0.43);
    return { l: r - PLATE.pw, r, t: cy - PLATE.ph / 2, b: cy + PLATE.ph / 2 };
  };

  it("documents the bug: the old anchor (width - 8) parks the plate's tail under the rail", () => {
    for (const [w, h, s] of SHORT_LAND) for (const n of [3, 4] as const) {
      const rail = railRect(w, h, s);
      const plate = plateRect(w, h, s, 8, n);
      // the bands genuinely meet (otherwise the overlap claim would be vacuous)…
      expect(plate.b).toBeGreaterThan(rail.t);
      expect(plate.t).toBeLessThan(rail.b);
      // …and the plate's right 42px — the rail's full button width — is under it
      expect(overlapArea(plate, rail)).toBeGreaterThan(0);
      expect(plate.r - rail.l).toBe(42);
    }
  });

  it('the fixed anchor (width - 58) leaves the whole plate visible and the rail fully exposed', () => {
    for (const [w, h, s] of SHORT_LAND) for (const n of [3, 4] as const) {
      const rail = railRect(w, h, s);
      const plate = plateRect(w, h, s, 58, n);
      expect(overlapArea(plate, rail)).toBe(0);
      expect(rail.l - plate.r).toBe(8); // exactly the last-trick chip's gap convention
      expect(plate.l).toBeGreaterThanOrEqual(0); // still fully on screen at the smallest size
      expect(plate.r).toBeLessThanOrEqual(w);
    }
  });

  it("Scene.tsx carries the 58px anchor; the rail keeps its 44px button in its 50px footprint", () => {
    expect(scene).toContain('size.width - 58 - safe.r');
    expect(scene).not.toContain('size.width - 8 - safe.r');
    const railRule = css.slice(css.indexOf('.ctl-rail,'), css.indexOf('.ctl-rail .av-bar'));
    expect(railRule).toContain('right: calc(8px + env(safe-area-inset-right))');
    const toggle = css.slice(css.indexOf('.ctl-rail .chat-toggle'), css.indexOf('.ctl-rail .chat-toggle') + 60);
    // Design audit D4 (2026-10-24): the chat-toggle grew 42 → 44px for the
    // tap-target floor. The protected invariant is unchanged — railRect
    // above models the rail by its 50px FOOTPRINT (right: 8px + 50px),
    // which the wider button still sits inside (44 ≤ 50, centered), so
    // every clearance assertion in this describe stands as written.
    expect(toggle).toContain('width: 44px');
  });
});
