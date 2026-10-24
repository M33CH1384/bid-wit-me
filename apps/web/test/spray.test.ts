/**
 * @vitest-environment happy-dom
 *
 * Spray-paint screen transitions (owner, 2026-10-23): "a quick animation of
 * black spray paint covering the screen" on main screen changes.
 *
 * Pins the contract:
 *  - eligibility: menu-space <-> menu-space route changes only; entering or
 *    leaving a live table (/t/CODE) and same-path no-ops never spray;
 *  - the swap waits for full cover, then the paint dissolves (cover joins,
 *    re-cover from a dissolve, cancel flushing the pending swap);
 *  - a hard failsafe exists and the layer self-clears on schedule;
 *  - input is locked only during the cover (pointer-events per phase);
 *  - Reduce effects (fx.reduced) and OS reduce-motion both cut to instant;
 *  - no registered renderer (tests, non-Root surfaces) = today's
 *    synchronous behavior, untouched;
 *  - the wiring lives at the choke points (Root's popstate handler, the
 *    Setup wizard's home boundary, StoryHome's goScreen, the Social store's
 *    open/close) and the table surfaces never import the spray at all;
 *  - the rendering is compositor-driven (v4): the layer is DOM + SVG
 *    animated by Web Animations tweens of transform / opacity /
 *    clip-path / stroke-dashoffset over static pre-rendered textures.
 *    No per-frame canvas painting exists anywhere in the layer — three
 *    canvas generations dropped frames on the owner's iPhone.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fxStub = vi.hoisted(() => ({ reduced: false, osReducedMotion: false }));
vi.mock('../src/fx', () => ({ fx: fxStub }));

import {
  SPRAY_COVER_MS,
  SPRAY_FAILSAFE_MS,
  SPRAY_FILL_MS,
  SPRAY_HOLD_MS,
  SPRAY_OUTLINE_MS,
  SPRAY_REVEAL_MS,
  SPRAY_SPADE_MS,
  cancelSpray,
  coverThen,
  getSpraySnapshot,
  registerSprayRenderer,
  sprayRouteEligible,
} from '../src/spray';
import SprayLayer, { SPADE_OUTLINE, spadeGeometry } from '../src/SprayLayer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const src = join(dirname(fileURLToPath(import.meta.url)), '../src');
const read = (p: string) => readFileSync(join(src, p), 'utf8');

beforeEach(() => {
  vi.useFakeTimers();
  fxStub.reduced = false;
  fxStub.osReducedMotion = false;
  registerSprayRenderer(false);
  cancelSpray();
});

afterEach(() => {
  cancelSpray();
  registerSprayRenderer(false);
  vi.useRealTimers();
});

describe('route eligibility', () => {
  it('sprays menu-space screen changes', () => {
    expect(sprayRouteEligible('/', '/story')).toBe(true);
    expect(sprayRouteEligible('/story', '/')).toBe(true);
    expect(sprayRouteEligible('/', '/profile')).toBe(true);
    expect(sprayRouteEligible('/profile', '/')).toBe(true);
    expect(sprayRouteEligible('/', '/online')).toBe(true);
    expect(sprayRouteEligible('/online', '/story')).toBe(true);
    expect(sprayRouteEligible('/rewards', '/')).toBe(true);
  });

  it('never sprays table entries, table exits, or no-ops', () => {
    expect(sprayRouteEligible('/', '/t/ABCD')).toBe(false);
    expect(sprayRouteEligible('/online', '/t/ABCD')).toBe(false);
    expect(sprayRouteEligible('/t/ABCD', '/')).toBe(false);
    expect(sprayRouteEligible('/t/ABCD', '/online')).toBe(false);
    expect(sprayRouteEligible('/t/ABCD', '/t/WXYZ')).toBe(false);
    expect(sprayRouteEligible('/story', '/story')).toBe(false);
    expect(sprayRouteEligible('/', '/')).toBe(false);
  });
});

describe('coverThen controller', () => {
  it('applies immediately with no renderer mounted (synchronous surfaces stay synchronous)', () => {
    const m = vi.fn();
    coverThen(m);
    expect(m).toHaveBeenCalledTimes(1);
    expect(getSpraySnapshot().phase).toBe('idle');
  });

  it('applies immediately under Reduce effects and under OS reduce-motion', () => {
    registerSprayRenderer(true);
    fxStub.reduced = true;
    const a = vi.fn();
    coverThen(a);
    expect(a).toHaveBeenCalledTimes(1);
    expect(getSpraySnapshot().phase).toBe('idle');
    fxStub.reduced = false;
    fxStub.osReducedMotion = true;
    const b = vi.fn();
    coverThen(b);
    expect(b).toHaveBeenCalledTimes(1);
    expect(getSpraySnapshot().phase).toBe('idle');
  });

  it('holds the swap until full cover, holds the black a beat, then reveals and clears', () => {
    registerSprayRenderer(true);
    const m = vi.fn();
    coverThen(m);
    expect(getSpraySnapshot().phase).toBe('cover');
    expect(m).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SPRAY_COVER_MS - 1);
    expect(m).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(m).toHaveBeenCalledTimes(1);
    expect(getSpraySnapshot().phase).toBe('reveal');
    // The hold: the paint sits at full black for SPRAY_HOLD_MS after
    // the swap before the dissolve's clock even starts.
    vi.advanceTimersByTime(SPRAY_HOLD_MS - 1);
    expect(getSpraySnapshot().phase).toBe('reveal');
    vi.advanceTimersByTime(1 + SPRAY_REVEAL_MS);
    expect(getSpraySnapshot().phase).toBe('idle');
  });

  it('a second navigation during the cover joins the same flush, in order', () => {
    registerSprayRenderer(true);
    const order: string[] = [];
    coverThen(() => order.push('a'));
    vi.advanceTimersByTime(100);
    coverThen(() => order.push('b'));
    expect(getSpraySnapshot().phase).toBe('cover');
    vi.advanceTimersByTime(SPRAY_COVER_MS - 100);
    expect(order).toEqual(['a', 'b']);
    vi.advanceTimersByTime(SPRAY_HOLD_MS + SPRAY_REVEAL_MS);
    expect(getSpraySnapshot().phase).toBe('idle');
  });

  it('a navigation during the dissolve snaps back to cover from the remaining coverage', () => {
    registerSprayRenderer(true);
    const a = vi.fn();
    const b = vi.fn();
    coverThen(a);
    vi.advanceTimersByTime(SPRAY_COVER_MS);
    expect(getSpraySnapshot().phase).toBe('reveal');
    vi.advanceTimersByTime(SPRAY_HOLD_MS + 130); // past the hold, ~1/3 dissolved
    coverThen(b);
    const snap = getSpraySnapshot();
    expect(snap.phase).toBe('cover');
    expect(snap.fromCoverage).toBeGreaterThan(0.4);
    expect(snap.fromCoverage).toBeLessThan(0.85);
    expect(b).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SPRAY_COVER_MS);
    expect(b).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SPRAY_HOLD_MS + SPRAY_REVEAL_MS);
    expect(getSpraySnapshot().phase).toBe('idle');
  });

  it('a navigation during the hold re-covers from FULL coverage (nothing has dissolved yet)', () => {
    registerSprayRenderer(true);
    const a = vi.fn();
    const b = vi.fn();
    coverThen(a);
    vi.advanceTimersByTime(SPRAY_COVER_MS + SPRAY_HOLD_MS - 10); // inside the hold
    coverThen(b);
    const snap = getSpraySnapshot();
    expect(snap.phase).toBe('cover');
    expect(snap.fromCoverage).toBe(1);
    vi.advanceTimersByTime(SPRAY_COVER_MS);
    expect(b).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SPRAY_HOLD_MS + SPRAY_REVEAL_MS);
    expect(getSpraySnapshot().phase).toBe('idle');
  });

  it('cancelSpray flushes the pending swap immediately and clears the paint', () => {
    registerSprayRenderer(true);
    const m = vi.fn();
    coverThen(m);
    vi.advanceTimersByTime(120);
    cancelSpray();
    expect(m).toHaveBeenCalledTimes(1);
    expect(getSpraySnapshot().phase).toBe('idle');
    vi.advanceTimersByTime(SPRAY_FAILSAFE_MS + 1000);
    expect(m).toHaveBeenCalledTimes(1);
    expect(getSpraySnapshot().phase).toBe('idle');
  });

  it('a throwing mutation cannot wedge the layer', () => {
    registerSprayRenderer(true);
    coverThen(() => {
      throw new Error('boom');
    });
    vi.advanceTimersByTime(SPRAY_COVER_MS + SPRAY_HOLD_MS + SPRAY_REVEAL_MS);
    expect(getSpraySnapshot().phase).toBe('idle');
  });

  it('the failsafe is armed inside the controller and outlives a full cycle', () => {
    // The invariant is the margin over the whole cycle (cover + hold
    // + reveal), not any absolute number — it has scaled with every
    // slow-down (1500 -> 1900 -> 2300) and must keep doing so.
    expect(SPRAY_FAILSAFE_MS - (SPRAY_COVER_MS + SPRAY_HOLD_MS + SPRAY_REVEAL_MS)).toBeGreaterThanOrEqual(500);
    expect(read('spray.ts')).toContain('failsafeTimer = setTimeout(cancelSpray, SPRAY_FAILSAFE_MS)');
  });
});

describe('SprayLayer', () => {
  let root: Root | null = null;
  let el: HTMLDivElement | null = null;

  beforeEach(() => {
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
  });

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = null;
    el?.remove();
    el = null;
  });

  it('renders nothing while idle; locks input only during the cover', async () => {
    await act(async () => {
      root!.render(createElement(SprayLayer));
    });
    expect(el!.querySelector('[data-testid="spray-layer"]')).toBeNull();

    const m = vi.fn();
    await act(async () => {
      coverThen(m);
    });
    const layer = el!.querySelector('[data-testid="spray-layer"]') as HTMLElement | null;
    expect(layer).not.toBeNull();
    expect(layer!.dataset.phase).toBe('cover');
    expect(layer!.style.pointerEvents).toBe('auto');
    expect(m).not.toHaveBeenCalled();
    // The cover is DOM + SVG now — the spade's pieces exist as elements
    // for the compositor to animate, and there is no canvas anywhere.
    expect(layer!.querySelector('canvas')).toBeNull();
    expect(layer!.querySelector('svg')).not.toBeNull();
    expect(layer!.querySelector('[data-anim="core"]')).not.toBeNull();
    expect(layer!.querySelector('[data-anim="fill"]')).not.toBeNull();
    expect(layer!.querySelector('[data-anim="bloom"]')).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(SPRAY_COVER_MS);
    });
    expect(m).toHaveBeenCalledTimes(1);
    const revealing = el!.querySelector('[data-testid="spray-layer"]') as HTMLElement | null;
    expect(revealing).not.toBeNull();
    expect(revealing!.dataset.phase).toBe('reveal');
    expect(revealing!.style.pointerEvents).toBe('none');
    expect(revealing!.querySelector('[data-anim="rv-grain-a"]')).not.toBeNull();
    expect(revealing!.querySelector('canvas')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(SPRAY_HOLD_MS + SPRAY_REVEAL_MS);
    });
    expect(el!.querySelector('[data-testid="spray-layer"]')).toBeNull();
  });
});

describe('cover choreography — outline, then interior, then bloom (owner, 2026-10-23)', () => {
  it('three strict beats, a hold, and the dissolve inside the slowed timing budget', () => {
    // Owner rounds 3-4 on v4: "slower, cleaner, bigger" — then the
    // deeper spec: slower still, aimed at the slow end (the outline
    // emphasis has grown every round). The program stretched again
    // (cycle 1280 -> 1790 ms): the OUTLINE is the signature and is
    // protected (if frame rate ever forces a cut, the fill shortens
    // first — the tuning rule lives in spray.ts), the interior gets
    // room to breathe, and a HOLD at full black now sits between
    // the swap and the dissolve.
    expect(SPRAY_OUTLINE_MS).toBeGreaterThanOrEqual(550);
    expect(SPRAY_OUTLINE_MS).toBeLessThanOrEqual(600);
    expect(SPRAY_FILL_MS).toBeGreaterThanOrEqual(400);
    expect(SPRAY_FILL_MS).toBeLessThanOrEqual(500);
    expect(SPRAY_SPADE_MS).toBe(SPRAY_OUTLINE_MS + SPRAY_FILL_MS);
    const bloomMs = SPRAY_COVER_MS - SPRAY_SPADE_MS;
    expect(bloomMs).toBeGreaterThanOrEqual(240);
    expect(bloomMs).toBeLessThanOrEqual(260);
    expect(SPRAY_COVER_MS).toBeGreaterThanOrEqual(1240);
    expect(SPRAY_COVER_MS).toBeLessThanOrEqual(1360);
    expect(SPRAY_HOLD_MS).toBeGreaterThanOrEqual(80);
    expect(SPRAY_HOLD_MS).toBeLessThanOrEqual(100);
    expect(SPRAY_REVEAL_MS).toBeGreaterThanOrEqual(360);
    expect(SPRAY_REVEAL_MS).toBeLessThanOrEqual(400);
    // The black phase (cover + hold — what the player sits inside
    // before the new screen appears) lands in the spec's 1400-1600
    // envelope; the full cycle adds the stretched reveal on top.
    expect(SPRAY_COVER_MS + SPRAY_HOLD_MS).toBeGreaterThanOrEqual(1400);
    expect(SPRAY_COVER_MS + SPRAY_HOLD_MS).toBeLessThanOrEqual(1600);
    expect(SPRAY_COVER_MS + SPRAY_HOLD_MS + SPRAY_REVEAL_MS).toBeGreaterThanOrEqual(1700);
    expect(SPRAY_COVER_MS + SPRAY_HOLD_MS + SPRAY_REVEAL_MS).toBeLessThanOrEqual(1900);
    // The failsafe's invariant is the MARGIN over the full cycle,
    // not a raw number: it scaled with the program (1500 -> 1900 ->
    // 2300) and must still clear the longer cycle with room to
    // spare — a stuck black screen stays structurally impossible.
    expect(
      SPRAY_FAILSAFE_MS - (SPRAY_COVER_MS + SPRAY_HOLD_MS + SPRAY_REVEAL_MS),
    ).toBeGreaterThanOrEqual(500);
  });

  it('the spade outline is the game mark: favicon geometry, tip first, closed', () => {
    // Geometry source: public/favicon.svg (viewBox 64, spade x 12..52, y 8..56).
    const { pts, length } = SPADE_OUTLINE;
    expect(pts.length).toBeGreaterThan(100);
    expect(pts[0]!.x).toBeCloseTo(32, 6);
    expect(pts[0]!.y).toBeCloseTo(8, 6);
    const last = pts[pts.length - 1]!;
    expect(last.x).toBeCloseTo(32, 6);
    expect(last.y).toBeCloseTo(8, 6);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(12 - 1e-6);
      expect(p.x).toBeLessThanOrEqual(52 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(8 - 1e-6);
      expect(p.y).toBeLessThanOrEqual(56 + 1e-6);
    }
    // Arc-length parameterisation: cum climbs monotonically from 0 to 1.
    expect(pts[0]!.cum).toBe(0);
    expect(last.cum).toBe(1);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i]!.cum).toBeGreaterThanOrEqual(pts[i - 1]!.cum);
    }
    expect(length).toBeGreaterThan(150);
    expect(length).toBeLessThan(200);
  });

  it('the painted spade is the favicon path itself, and the beats are scheduled in strict order', () => {
    const layer = read('SprayLayer.tsx');
    // Provenance: the SVG paints the favicon's own path data verbatim.
    expect(layer).toContain('favicon.svg');
    expect(layer).toContain('M32 8C26 18 12 26 12 37');
    expect(layer).toContain('32 8z');
    // The three beats exist as separate animated pieces: outline
    // strokes, then the fill element, then the bloom — in DOM order.
    const coreAt = layer.indexOf('data-anim="core"');
    const fillAt = layer.indexOf('data-anim="fill"');
    const bloomAt = layer.indexOf('data-anim="bloom"');
    expect(coreAt).toBeGreaterThan(0);
    expect(fillAt).toBeGreaterThan(coreAt);
    expect(bloomAt).toBeGreaterThan(fillAt);
    // And in schedule order: the fill's animations start at beat 1's
    // end, the bloom's at the spade sequence's end — delays in the
    // source, all shifted by the same snap-back resume offset.
    expect(layer).toContain('const resumeMs = fromCoverage * SPRAY_COVER_MS');
    expect(layer).toContain('delay: -resumeMs');
    expect(layer).toContain('delay: SPRAY_OUTLINE_MS - resumeMs');
    expect(layer).toContain('delay: SPRAY_SPADE_MS - resumeMs');
    // Negative delays + fill mode 'both' are the resume mechanism:
    // a snapped-back cover starts partway through its beats and holds
    // end states until the controller flushes.
    expect(layer).toContain("fill: 'both'");
    // Beat isolation: the fill is its own element whose clip starts
    // fully closed — nothing of the interior can show during beat 1,
    // and the outline strokes are never inside the clipped element.
    expect(layer).toContain("clipPath: 'inset(0 0 100% 0)'");
    const fillSvgAt = layer.indexOf('data-anim="fill"');
    const fillSvgBody = layer.slice(fillSvgAt, layer.indexOf('</svg>', fillSvgAt));
    expect(fillSvgBody).not.toContain('data-anim="core"');
    expect(fillSvgBody).not.toContain('strokeDashoffset');
  });

  it('the reveal is a compositor dissolve: grain-masked paint layers on staggered opacity fades', () => {
    const layer = read('SprayLayer.tsx');
    expect(layer).toContain('spray-reveal');
    expect(layer).toContain('data-anim="rv-base"');
    expect(layer).toContain('data-anim="rv-grain-a"');
    expect(layer).toContain('data-anim="rv-grain-b"');
    // Static grain masks (both spellings — iOS wants -webkit-), and
    // staggered fades whose landmarks are PROPORTIONS of the reveal
    // (base clears ~46%, grain A holds to ~89%, grain B lands exactly
    // at the end) so the curves re-proportion when the reveal
    // stretches — no absolute ms is baked into the layer.
    expect(layer).toContain('maskImage');
    expect(layer).toContain('WebkitMaskImage');
    expect(layer).toContain('SPRAY_REVEAL_MS * 0.46');
    expect(layer).toContain('SPRAY_REVEAL_MS * 0.73');
    expect(layer).toContain('SPRAY_REVEAL_MS * 0.84');
    expect(layer).toContain('SPRAY_REVEAL_MS * 0.16');
    // And every fade waits out the HOLD first: the base starts at
    // the hold's end, the grain layers at hold + their stagger.
    expect(layer).toContain('delay: SPRAY_HOLD_MS,');
    expect(layer).toContain('SPRAY_HOLD_MS + SPRAY_REVEAL_MS * 0.16');
    // The reveal carries no part of the spade program.
    const revealBody = layer.slice(layer.indexOf('spray-reveal'));
    expect(revealBody).not.toContain('SPADE_D');
    expect(revealBody).not.toContain('strokeDashoffset');
  });
});

describe('spade size — fills most of the screen (owner, 2026-10-23)', () => {
  it('the size is a min() of the height and width budgets', () => {
    expect(read('SprayLayer.tsx')).toContain(
      'Math.min(vh * 0.84, (vw * 0.86 * SPADE_H_UNITS) / SPADE_W_UNITS)',
    );
  });

  it('portrait phone: width-bound — the height budget alone would overflow the sides', () => {
    const g = spadeGeometry(390, 844);
    expect(g.w).toBeCloseTo(390 * 0.86, 6);
    expect(g.h).toBeLessThan(844 * 0.84);
    // Still centered on both axes at the bigger size.
    expect(g.cx).toBe(195);
    expect(g.cy).toBe(422);
    expect(g.left).toBeCloseTo((390 - g.w) / 2, 6);
    expect(g.top).toBeCloseTo((844 - g.h) / 2, 6);
  });

  it('desktop: height-bound at ~84% of the viewport height', () => {
    const g = spadeGeometry(1440, 900);
    expect(g.h).toBeCloseTo(900 * 0.84, 6);
    expect(g.w).toBeCloseTo(((900 * 0.84) / 48) * 40, 6);
    expect(g.w).toBeLessThan(1440 * 0.86);
  });

  it('neither budget is ever broken, and the mark keeps its aspect', () => {
    const viewports = [
      [320, 568],
      [375, 667],
      [390, 844],
      [430, 932],
      [768, 1024],
      [1024, 768],
      [1440, 900],
      [1920, 1080],
    ] as const;
    for (const [vw, vh] of viewports) {
      const g = spadeGeometry(vw, vh);
      expect(g.h).toBeLessThanOrEqual(vh * 0.84 + 1e-9);
      expect(g.w).toBeLessThanOrEqual(vw * 0.86 + 1e-9);
      expect(g.w / g.h).toBeCloseTo(40 / 48, 6);
      // The dab track and bloom math ride the same geometry: the
      // outline's px length scales with the box, and the bloom
      // reaches past the farthest corner from the spade's center.
      expect(g.outlineLen).toBeCloseTo(SPADE_OUTLINE.length * (g.h / 48), 6);
      expect(g.maxR).toBeGreaterThanOrEqual(Math.hypot(vw / 2, vh / 2));
    }
  });
});

describe('clean pass — crisp first, spray-textured second (owner, 2026-10-23)', () => {
  it('the halo hugs the line, and the contour speckle is sparser and fainter', () => {
    const layer = read('SprayLayer.tsx');
    // Halo pulled in close (scale 1.07 -> 1.035) and thinned
    // (peak opacity 0.92 -> 0.55); the wet under-stroke thinned too.
    expect(layer).toContain('scale(1.035) translate(-32 -32)');
    expect(layer).toContain("opacity: '0.55'");
    expect(layer).toContain('opacity={0.11}');
    // Speckle dots along the contour: wider gaps, fainter gather,
    // thinner stroke (carried in the speckleW ratio, 1.05 -> 0.8).
    // Round 4 thinned the OUTLINE beat's grain furthest of all (gap
    // 4.6 -> 5.6, gather 0.35 -> 0.3) — the signature line reads
    // crispest.
    expect(layer).toContain('strokeDasharray="0.01 5.6"');
    expect(layer).toContain("opacity: '0.3'");
    expect(layer).toContain('geo.brush * 0.8');
    // The bloom's speckle ring hugs the solid disc's edge (1.18 -> 1.1).
    expect(layer).toContain('const RING_OVER = 1.1');
    // The nozzle's overspray puff pulled in and thinned in CSS.
    const css = read('spray.css');
    expect(css).toContain('scale(1.6)');
    expect(css).toContain('opacity: 0.22');
  });

  it('the fill grain is finer and lower-contrast', () => {
    const layer = read('SprayLayer.tsx');
    expect(layer).toContain('width="5"');
    expect(layer).toContain('opacity="0.28"');
    expect(layer).not.toContain('opacity="0.5"');
  });

  it('the texture recipes stay under the clean ceilings', () => {
    const tex = read('sprayTextures.ts');
    expect(tex).toContain('i < 260'); // brush speckle (was 420)
    expect(tex).toContain('i < 950'); // interior front dots (was 1500)
    expect(tex).toContain('i < 700'); // bloom ring dots (was 1100)
    // The ring's annulus is thin now: 0.86R..1.04R (was 0.78R..1.08R).
    expect(tex).toContain('0.86 + Math.pow(rnd(), 1.6) * 0.18');
    // The reveal grain is finer, denser-alpha-banded, less clumped:
    // fewer dots per tile, smaller radii, tighter alpha range.
    expect(tex).toContain('(S * S) / 150');
    expect(tex).toContain('0.7 + rnd() * 2');
    expect(tex).toContain('0.25 + rnd() * 0.65');
    // The grain masks display smaller, so the tiles read finer.
    const layer = read('SprayLayer.tsx');
    expect(layer).toContain("'200px 200px'");
    expect(layer).toContain("'280px 280px'");
  });
});

describe('compositor architecture — no per-frame painting (v4)', () => {
  it('the layer contains no canvas, no frame loop, and none of the retired paint machinery', () => {
    const layer = read('SprayLayer.tsx');
    // v1/v2/v3 all painted per frame; each is pinned gone for good.
    expect(layer).not.toContain('requestAnimationFrame');
    expect(layer).not.toContain('<canvas');
    expect(layer).not.toContain('getContext');
    expect(layer).not.toContain('drawImage');
    expect(layer).not.toContain("'source-in'");
    expect(layer).not.toContain('destination-out');
    expect(layer).not.toContain('createLinearGradient');
    // v3's sprite + scratch-mask machinery.
    expect(layer).not.toContain('getSpadeSprites');
    expect(layer).not.toContain('scratch');
    expect(layer).not.toContain('getGrain(');
    // v2's quantized stamp walk and v1's swept front.
    expect(layer).not.toContain('drawSpadeTag');
    expect(layer).not.toContain('FILL_START');
    expect(layer).not.toContain('lastX');
    expect(layer).not.toContain('getFrontSprite');
    expect(layer).not.toContain('frontSprite');
  });

  it('every moving part is a composited property animated through Web Animations', () => {
    const layer = read('SprayLayer.tsx');
    expect(layer).toContain('.animate(');
    // Beat 1: the outline draws via stroke-dashoffset, dash math
    // normalized by pathLength to the outline's own length.
    expect(layer).toContain('strokeDashoffset');
    expect(layer).toContain('pathLength={LEN}');
    // Beat 2: the interior opens via clip-path; the front rides it via
    // transform; beat 3: the bloom expands via transform scale.
    expect(layer).toContain("clipPath: 'inset(0 0 0% 0)'");
    expect(layer).toContain('translateY(');
    expect(layer).toContain('scale(${geo.bloomS0})');
    // The nozzle dab rides a transform track sampled from the
    // outline's arc length (frontierAt), so its motion is continuous
    // by construction and interpolated by the compositor.
    expect(layer).toContain('function frontierAt');
    expect(layer).toContain('frontierAt(geo.pts, (i / STOPS) * geo.outlineLen)');
    expect(layer).toContain('const STOPS = 40');
    // The outline's stroke width is CONSTANT: widths are set once as
    // presentation attributes and never appear as an animated
    // keyframe property (a WAAPI keyframe would spell it
    // 'strokeWidth:' — the JSX attribute form is 'strokeWidth={').
    expect(layer).not.toContain('strokeWidth:');
    // The frontier and the draw both ride the ease-in-out curve.
    expect(layer).toContain("const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)'");
  });

  it('textures are static, pre-rendered once, and live outside the layer', () => {
    const layer = read('SprayLayer.tsx');
    expect(layer).toContain("from './sprayTextures'");
    const tex = read('sprayTextures.ts');
    expect(tex).toContain('export function getSprayTextures');
    expect(tex).toContain('toDataURL');
    // The texture module builds stills — it runs no loop and no
    // animation of its own.
    expect(tex).not.toContain('requestAnimationFrame');
    expect(tex).not.toContain('.animate(');
  });
});

describe('wiring pins', () => {
  it('Root owns route swaps: eligible popstates defer under cover, others cancel + apply', () => {
    const main = read('main.tsx');
    expect(main).toContain("import SprayLayer from './SprayLayer'");
    expect(main).toContain('<SprayLayer />');
    expect(main).toContain('sprayRouteEligible(cur, next)');
    expect(main).toContain('coverThen(() => {');
    expect(main).toContain('cancelSpray();');
  });

  it('the router itself is untouched — navigate() knows nothing of the spray', () => {
    expect(read('online/nav.ts')).not.toContain('spray');
  });

  it('the Setup wizard covers only its home boundary', () => {
    const setup = read('Setup.tsx');
    expect(setup).toContain("from './spray'");
    expect(setup).toContain('crossesHome');
    expect(setup).toContain('swapWiz(apply, next)');
    expect(setup).toContain("swapWiz(apply, 'home')");
  });

  it('StoryHome routes every screen change through goScreen, which never covers the table', () => {
    const story = read('story/StoryHome.tsx');
    expect(story).toContain("from '../spray'");
    expect(story).toContain('const goScreen');
    expect(story).toContain("next.k !== 'game' && screen.k !== 'game'");
    expect(story).not.toContain('setScreen({');
  });

  it('the Social panel open/close rides the paint', () => {
    const store = read('social/store.ts');
    expect(store).toContain("from '../spray'");
    expect(store).toContain('coverThen(apply)');
  });

  it('table surfaces never import the spray (the bid clock stays paint-free)', () => {
    expect(read('Table.tsx')).not.toContain("from './spray'");
    expect(read('online/OnlineApp.tsx')).not.toContain("from '../spray'");
    expect(read('online/OnlineTable.tsx')).not.toContain('SprayLayer');
  });

  it('the layer paints black, above every surface, as DOM (no canvas)', () => {
    const layer = read('SprayLayer.tsx');
    expect(layer).toContain("const PAINT = '#070708'");
    expect(layer).toContain('registerSprayRenderer(true)');
    expect(layer).not.toContain('<canvas');
    const css = read('spray.css');
    expect(css).toContain('position: fixed');
    expect(css).toContain('z-index: 2000');
    expect(css).not.toContain('canvas');
  });
});
