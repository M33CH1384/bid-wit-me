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
 *    open/close) and the table surfaces never import the spray at all.
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

    await act(async () => {
      vi.advanceTimersByTime(SPRAY_COVER_MS);
    });
    expect(m).toHaveBeenCalledTimes(1);
    const revealing = el!.querySelector('[data-testid="spray-layer"]') as HTMLElement | null;
    expect(revealing).not.toBeNull();
    expect(revealing!.dataset.phase).toBe('reveal');
    expect(revealing!.style.pointerEvents).toBe('none');

    await act(async () => {
      vi.advanceTimersByTime(SPRAY_REVEAL_MS);
    });
    expect(el!.querySelector('[data-testid="spray-layer"]')).toBeNull();
  });
});

describe('cover choreography — tag the spade, then fill out (owner, 2026-10-23)', () => {
  it('the cover spends its first beat on the spade, inside the standing timing budget', () => {
    // The whole transition stays "quick": cover 280–350 ms, total 560–650 ms.
    expect(SPRAY_COVER_MS).toBeGreaterThanOrEqual(280);
    expect(SPRAY_COVER_MS).toBeLessThanOrEqual(350);
    expect(SPRAY_COVER_MS + SPRAY_REVEAL_MS).toBeGreaterThanOrEqual(560);
    expect(SPRAY_COVER_MS + SPRAY_REVEAL_MS).toBeLessThanOrEqual(650);
    // The spade beat is the cover's opening act, not a garnish at the end.
    expect(SPRAY_SPADE_MS).toBeGreaterThanOrEqual(120);
    expect(SPRAY_SPADE_MS).toBeLessThan(SPRAY_COVER_MS);
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

  it('the cover program runs the spade beat before the fill, never the old linear sweep', () => {
    const layer = read('SprayLayer.tsx');
    // Provenance + the two beats, in program order inside drawCover.
    expect(layer).toContain('favicon.svg');
    expect(layer).toContain('drawSpadeTag');
    expect(layer).toContain('drawFillBloom');
    const coverAt = layer.indexOf('function drawCover');
    const tagAt = layer.indexOf('drawSpadeTag(g, geo', coverAt);
    const bloomAt = layer.indexOf('drawFillBloom(g, vw, vh, geo', coverAt);
    expect(tagAt).toBeGreaterThan(coverAt);
    expect(bloomAt).toBeGreaterThan(tagAt);
    // The tag is painted by stamping the brush along the outline's arc
    // length, and the completed spade is drawn before the bloom covers it.
    expect(layer).toContain('outlineP * geo.outlineLen');
    // The 2026-10-23 first cut swept a spray front left-to-right; that
    // program is gone for good.
    expect(layer).not.toContain('getFrontSprite');
    expect(layer).not.toContain('frontSprite');
  });

  it('the reveal is the shipped grain dissolve, untouched by the cover rework', () => {
    const layer = read('SprayLayer.tsx');
    const revealAt = layer.indexOf('function drawReveal');
    expect(revealAt).toBeGreaterThan(0);
    const revealBody = layer.slice(revealAt, layer.indexOf('export default function'));
    expect(revealBody).toContain("g.globalCompositeOperation = 'destination-out'");
    expect(revealBody).toContain('getGrain(vw, vh)');
    expect(revealBody).not.toContain('spade');
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

  it('the layer paints black, above every surface, dissolving via grain', () => {
    const layer = read('SprayLayer.tsx');
    expect(layer).toContain("const PAINT = '#070708'");
    expect(layer).toContain('destination-out');
    expect(layer).toContain('registerSprayRenderer(true)');
    const css = read('spray.css');
    expect(css).toContain('position: fixed');
    expect(css).toContain('z-index: 2000');
  });
});
