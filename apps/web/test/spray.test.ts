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
  SPRAY_OUTLINE_MS,
  SPRAY_REVEAL_MS,
  SPRAY_SPADE_MS,
  cancelSpray,
  coverThen,
  getSpraySnapshot,
  registerSprayRenderer,
  sprayRouteEligible,
} from '../src/spray';
import SprayLayer, { SPADE_OUTLINE } from '../src/SprayLayer';

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

  it('holds the swap until full cover, then reveals and clears on schedule', () => {
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
    vi.advanceTimersByTime(SPRAY_REVEAL_MS);
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
    vi.advanceTimersByTime(SPRAY_REVEAL_MS);
    expect(getSpraySnapshot().phase).toBe('idle');
  });

  it('a navigation during the dissolve snaps back to cover from the remaining coverage', () => {
    registerSprayRenderer(true);
    const a = vi.fn();
    const b = vi.fn();
    coverThen(a);
    vi.advanceTimersByTime(SPRAY_COVER_MS);
    expect(getSpraySnapshot().phase).toBe('reveal');
    vi.advanceTimersByTime(100); // ~1/3 dissolved
    coverThen(b);
    const snap = getSpraySnapshot();
    expect(snap.phase).toBe('cover');
    expect(snap.fromCoverage).toBeGreaterThan(0.4);
    expect(snap.fromCoverage).toBeLessThan(0.85);
    expect(b).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SPRAY_COVER_MS);
    expect(b).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SPRAY_REVEAL_MS);
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
    vi.advanceTimersByTime(SPRAY_COVER_MS + SPRAY_REVEAL_MS);
    expect(getSpraySnapshot().phase).toBe('idle');
  });

  it('the failsafe is armed inside the controller and outlives a full cycle', () => {
    expect(SPRAY_FAILSAFE_MS).toBeGreaterThan(SPRAY_COVER_MS + SPRAY_REVEAL_MS);
    expect(SPRAY_FAILSAFE_MS).toBeLessThanOrEqual(2000);
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
      vi.advanceTimersByTime(SPRAY_REVEAL_MS);
    });
    expect(el!.querySelector('[data-testid="spray-layer"]')).toBeNull();
  });
});

describe('cover choreography — outline, then interior, then bloom (owner, 2026-10-23)', () => {
  it('three strict beats inside the extended timing budget', () => {
    // Owner round 2 on v2: "extend it a bit and make it more smooth" —
    // the outline beat takes the bulk of the added time so the can's
    // travel is perceivable; the whole transition stays quick.
    expect(SPRAY_OUTLINE_MS).toBeGreaterThanOrEqual(320);
    expect(SPRAY_OUTLINE_MS).toBeLessThanOrEqual(360);
    expect(SPRAY_FILL_MS).toBeGreaterThanOrEqual(100);
    expect(SPRAY_FILL_MS).toBeLessThanOrEqual(120);
    expect(SPRAY_SPADE_MS).toBe(SPRAY_OUTLINE_MS + SPRAY_FILL_MS);
    const bloomMs = SPRAY_COVER_MS - SPRAY_SPADE_MS;
    expect(bloomMs).toBeGreaterThanOrEqual(120);
    expect(bloomMs).toBeLessThanOrEqual(140);
    expect(SPRAY_COVER_MS).toBeGreaterThanOrEqual(540);
    expect(SPRAY_COVER_MS).toBeLessThanOrEqual(600);
    expect(SPRAY_COVER_MS + SPRAY_REVEAL_MS).toBeGreaterThanOrEqual(780);
    expect(SPRAY_COVER_MS + SPRAY_REVEAL_MS).toBeLessThanOrEqual(860);
    // The failsafe still clears a full (now longer) cycle with room to
    // spare — a stuck black screen stays structurally impossible.
    expect(SPRAY_FAILSAFE_MS - (SPRAY_COVER_MS + SPRAY_REVEAL_MS)).toBeGreaterThanOrEqual(500);
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
    // staggered fades that end inside the shipped 280 ms reveal.
    expect(layer).toContain('maskImage');
    expect(layer).toContain('WebkitMaskImage');
    expect(layer).toContain('SPRAY_REVEAL_MS - 75');
    expect(layer).toContain('SPRAY_REVEAL_MS - 45');
    // The reveal carries no part of the spade program.
    const revealBody = layer.slice(layer.indexOf('spray-reveal'));
    expect(revealBody).not.toContain('SPADE_D');
    expect(revealBody).not.toContain('strokeDashoffset');
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
