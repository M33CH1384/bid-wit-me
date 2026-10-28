/**
 * @vitest-environment happy-dom
 *
 * WAVE D — the transitions family rebuilt (Animation Replacement
 * Program §A6 rows 62–67). Pins:
 *  - TIMINGS HELD: every program's spec is byte-identical to the
 *    shipped (pre-Wave-D) numbers — total duration change is 0%,
 *    well inside the ±10% contract;
 *  - the compositor-only invariant across every owned layer: no
 *    canvas, no frame loop, no per-frame painting, no Math.random /
 *    Date.now in output paths;
 *  - Spray: the higher-fidelity texture passes exist alongside the
 *    pinned clean-pass ceilings;
 *  - Ink Bloom: tendrils are deterministic curl-walk paths grown
 *    from the spade outline, plus the wet-edge sheen — and the ink
 *    spec still EQUALS the spray spec;
 *  - Card Fan: 3D faces tilt by a pure function of the fan tilt, the
 *    light sweep is scheduled inside the cover window, and the
 *    pinned cover geometry (fanLayout / fanCardContains) is unmoved;
 *  - The Deal: flight arcs are a pure model, the gather home starts
 *    at the slot (no corner teleport), and no three.js import enters
 *    the entry-reachable transition layers;
 *  - The Book Sweep: the stack is a panel sibling that gathers to
 *    the Deal's dealer corner on explicit px geometry;
 *  - The Doorway: destination kinds resolve per stop, the episode
 *    carries its stop through cover and snap-back, StoryHome names
 *    the stop, and the layer stays silent under every kind.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fxStub = vi.hoisted(() => ({ reduced: false, osReducedMotion: false }));
vi.mock('../src/fx', () => ({ fx: fxStub }));

import {
  PROGRAM_SPECS,
  cancelTransitions,
  coverThen,
  doorwayKindForStop,
  getTransitionSnapshot,
  registerTransitionRenderer,
  type TransitionProgramId,
} from '../src/transitions';
import { themeStore } from '../src/theme';

const src = join(dirname(fileURLToPath(import.meta.url)), '../src');
const read = (p: string) => readFileSync(join(src, p), 'utf8');

beforeEach(() => {
  vi.useFakeTimers();
  fxStub.reduced = false;
  fxStub.osReducedMotion = false;
  themeStore.set('classic');
  registerTransitionRenderer(false);
  cancelTransitions();
});

afterEach(() => {
  cancelTransitions();
  registerTransitionRenderer(false);
  themeStore.set('classic');
  vi.useRealTimers();
});

describe('Wave D — timings held (0% drift from the shipped specs)', () => {
  it('every program spec equals its pre-Wave-D numbers exactly', () => {
    const shipped: Record<TransitionProgramId, { coverMs: number; holdMs: number; revealMs: number; failsafeMs: number }> = {
      spray: { coverMs: 1310, holdMs: 90, revealMs: 390, failsafeMs: 2300 },
      ink: { coverMs: 1310, holdMs: 90, revealMs: 390, failsafeMs: 2300 },
      fan: { coverMs: 420, holdMs: 40, revealMs: 390, failsafeMs: 1400 },
      deal: { coverMs: 700, holdMs: 0, revealMs: 450, failsafeMs: 5000 },
      sweep: { coverMs: 460, holdMs: 40, revealMs: 450, failsafeMs: 1500 },
      doorway: { coverMs: 620, holdMs: 100, revealMs: 480, failsafeMs: 1750 },
    };
    for (const [id, spec] of Object.entries(shipped)) {
      expect(PROGRAM_SPECS[id as TransitionProgramId], id).toEqual(spec);
    }
  });
});

describe('Wave D — compositor-only invariant across the owned layers', () => {
  const layers = [
    'SprayLayer.tsx',
    'FanLayer.tsx',
    'TableTransitionLayer.tsx',
    'DoorwayLayer.tsx',
    'transitions.ts',
    'sprayTextures.ts',
  ];
  it('no canvas, no frame loop, no nondeterminism in output paths', () => {
    for (const f of layers) {
      const body = read(f);
      expect(body, f).not.toContain('<canvas');
      expect(body, f).not.toContain('requestAnimationFrame');
      expect(body, f).not.toContain('Math.random(');
      expect(body, f).not.toContain("from 'three'");
      expect(body, f).not.toContain('three/');
    }
    // The layers proper (everything except the shared controller,
    // whose shipped clock fallback is pinned separately below) also
    // never read the wall clock.
    for (const f of layers.filter((x) => x !== 'transitions.ts')) {
      expect(read(f), f).not.toContain('Date.now(');
    }
  });

  it('performance.now in the controller is phase bookkeeping only (never an output value)', () => {
    // transitions.ts reads the clock solely to stamp phase starts
    // and measure dissolved coverage on a snap-back — the shipped
    // controller behavior; no animation value derives from it.
    expect(read('transitions.ts')).toContain("typeof performance !== 'undefined' ? performance.now() : Date.now()");
  });
});

describe('Wave D — Spray re-texture (row 62)', () => {
  it('higher-fidelity passes ride alongside the pinned clean ceilings', () => {
    const tex = read('sprayTextures.ts');
    // The brush tile grew and gained its two seeded passes.
    expect(tex).toContain('makeCanvas(192, 192)');
    expect(tex).toContain('i < 150'); // micro-speckle at the wet rim
    expect(tex).toContain('i < 70'); // overspray halo
    // The front gained a wet core band; the ring a far scatter; the
    // grains their dry flakes.
    expect(tex).toContain('i < 320');
    expect(tex).toContain('i < 90');
    expect(tex).toContain('i < 22');
    // The clean-pass ceilings the spray test pins are untouched.
    expect(tex).toContain('i < 260');
    expect(tex).toContain('i < 950');
    expect(tex).toContain('i < 700');
    expect(tex).toContain('0.86 + Math.pow(rnd(), 1.6) * 0.18');
  });
});

describe('Wave D — Ink Bloom tendrils + sheen (row 63)', () => {
  it('tendrils are deterministic: same build, byte-identical paths', async () => {
    const { buildInkTendrils, SPADE_OUTLINE } = await import('../src/SprayLayer');
    const a = buildInkTendrils();
    const b = buildInkTendrils();
    expect(a).toEqual(b);
    expect(a.length).toBe(6);
    for (const t of a) {
      expect(t.d.startsWith('M')).toBe(true);
      expect(t.d).toContain('C');
      expect(t.length).toBeGreaterThan(10);
      expect(t.width).toBeGreaterThan(0.5);
      expect(t.width).toBeLessThan(1.4);
    }
    // Anchors sit ON the spade outline: each path's start point is a
    // sampled outline point.
    const starts = new Set(SPADE_OUTLINE.pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`));
    for (const t of a) {
      const start = t.d.slice(1).split('C')[0]!.trim();
      expect(starts.has(start), `tendril starts on the outline: ${start}`).toBe(true);
    }
  });

  it('the layer schedules the tendrils and the wet-edge sheen on the shared beats', () => {
    const layer = read('SprayLayer.tsx');
    expect(layer).toContain('data-anim="ink-tendril"');
    expect(layer).toContain('data-anim="ink-sheen"');
    expect(layer).toContain("qa('ink-tendril')");
    // Tendrils unfurl across fill + bloom, from the outline's end.
    expect(layer).toContain('duration: SPRAY_FILL_MS + SPRAY_BLOOM_MS');
    expect(layer).toContain('delay: SPRAY_OUTLINE_MS - resumeMs + i * 30');
    // Theme parity holds: the ink spec still IS the spray spec.
    expect(PROGRAM_SPECS.ink).toEqual(PROGRAM_SPECS.spray);
    // The tendril treatment needed no new ink textures.
    expect(read('inkTextures.ts')).not.toContain('tendril');
  });
});

describe('Wave D — the Card Fan in 3D (row 64)', () => {
  it('face tilt is a pure, clamped function of the fan tilt', async () => {
    const { fanFaceTilt } = await import('../src/FanLayer');
    expect(fanFaceTilt(0)).toEqual({ rotateY: 0, rotateX: 4 });
    expect(fanFaceTilt(60).rotateY).toBe(-18);
    expect(fanFaceTilt(-60).rotateY).toBe(18);
    expect(fanFaceTilt(20).rotateY).toBeCloseTo(-6, 6);
    expect(fanFaceTilt(20)).toEqual(fanFaceTilt(20)); // deterministic
  });

  it('the sweep is scheduled to finish inside the cover window', () => {
    const fan = read('FanLayer.tsx');
    expect(fan).toContain('data-anim="fan-sheen"');
    expect(fan).toContain("qa('fan-sheen')");
    // start 150 + last stagger 8*12 + duration 150 = 396 <= 420 cover.
    expect(fan).toContain('const FAN_SHEEN_START_MS = 150');
    expect(fan).toContain('const FAN_SHEEN_STAGGER_MS = 12');
    expect(fan).toContain('const FAN_SHEEN_MS = 150');
    expect(150 + 8 * 12 + 150).toBeLessThanOrEqual(PROGRAM_SPECS.fan.coverMs);
  });

  it('the 3D stage lives in CSS; the cover geometry helpers are unmoved', () => {
    const css = read('transitions.css');
    expect(css).toContain('perspective: 1100px');
    expect(css).toContain('.tfan-face');
    expect(css).toContain('.tfan-sheen');
    expect(css).toContain('preserve-3d');
    const fan = read('FanLayer.tsx');
    expect(fan).toContain('export function fanLayout');
    expect(fan).toContain('export function fanCardContains');
  });

  it('renders nine cards, each with a face and a sheen blade', async () => {
    const { createElement } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { default: FanLayer } = await import('../src/FanLayer');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(FanLayer)));
    act(() => registerTransitionRenderer(true));
    const m = vi.fn();
    act(() => coverThen(m, 'profile-social'));
    expect(host.querySelectorAll('[data-anim="fan-card"]')).toHaveLength(9);
    expect(host.querySelectorAll('.tfan-face')).toHaveLength(9);
    expect(host.querySelectorAll('[data-anim="fan-sheen"]')).toHaveLength(9);
    act(() => vi.advanceTimersByTime(PROGRAM_SPECS.fan.coverMs + PROGRAM_SPECS.fan.holdMs + PROGRAM_SPECS.fan.revealMs));
    expect(host.querySelector('[data-testid="fan-layer"]')).toBeNull();
    act(() => root.unmount());
    host.remove();
  });
});

describe('Wave D — the Deal flight arcs (row 65)', () => {
  it('arc height is a pure clamped proportion of the flight distance', async () => {
    const { dealArcHeight } = await import('../src/TableTransitionLayer');
    expect(dealArcHeight(0, 0)).toBe(24); // floor: even a short hop breathes
    expect(dealArcHeight(300, 400)).toBe(80); // 500 * 0.16
    expect(dealArcHeight(3000, 4000)).toBe(120); // ceiling
    expect(dealArcHeight(300, 400)).toBe(dealArcHeight(300, 400));
  });

  it('renders eight dealt cards, each with a landing shadow', async () => {
    const { createElement } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { default: TableTransitionLayer } = await import('../src/TableTransitionLayer');
    const { coverTableEntry, signalTableReady } = await import('../src/transitions');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(TableTransitionLayer)));
    act(() => registerTransitionRenderer(true));
    act(() => coverTableEntry());
    expect(host.querySelectorAll('[data-anim="deal-card"]')).toHaveLength(8);
    expect(host.querySelectorAll('[data-anim="deal-shadow"]')).toHaveLength(8);
    act(() => signalTableReady());
    act(() => vi.advanceTimersByTime(PROGRAM_SPECS.deal.coverMs + PROGRAM_SPECS.deal.revealMs));
    expect(host.querySelector('[data-testid="table-transition-layer"]')).toBeNull();
    act(() => root.unmount());
    host.remove();
  });

  it('flights ride a 3-keyframe arc; the gather home starts at the slot', () => {
    const layer = read('TableTransitionLayer.tsx');
    expect(layer).toContain('rotateX(16deg)');
    expect(layer).toContain('offset: 0.55');
    // The gather's first keyframe is the slot position itself —
    // the shipped corner-first teleport is gone.
    expect(layer).toContain('translate(${dx}px, ${dy}px) rotate(${slot[2]}deg) rotateX(0deg) scale(1)');
    // The last card still lands inside the dwell (320 + 7*50 = 670).
    expect(320 + 7 * 50).toBeLessThanOrEqual(PROGRAM_SPECS.deal.coverMs);
  });
});

describe('Wave D — the Book Sweep gather (row 66)', () => {
  it('the stack is a panel sibling on explicit px geometry, gathering to the dealer corner', () => {
    const layer = read('TableTransitionLayer.tsx');
    expect(layer).toContain('data-anim="sweep-stack"');
    expect(layer).toContain('data-anim="sweep-card"');
    expect(layer).toContain("qa('sweep-card')");
    // The gather target is the Deal's own corner fractions.
    expect(layer).toContain('const cornerX = g.vw * 0.04');
    expect(layer).toContain('g.vh - g.h - g.vh * 0.04');
    // The felt fades through (opacity) instead of shrinking away.
    expect(layer).toContain('SWEEP.revealMs * 0.72');
    // Last gather card lands inside the reveal (30 + 3*30 + 0.7*450).
    expect(30 + 3 * 30 + PROGRAM_SPECS.sweep.revealMs * 0.7).toBeLessThanOrEqual(PROGRAM_SPECS.sweep.revealMs + 30);
  });

  it('renders the sweep with its stack of four books', async () => {
    const { createElement } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { default: TableTransitionLayer } = await import('../src/TableTransitionLayer');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(TableTransitionLayer)));
    act(() => registerTransitionRenderer(true));
    const m = vi.fn();
    act(() => coverThen(m, 'table-exit'));
    expect(host.querySelectorAll('[data-anim="sweep-card"]')).toHaveLength(4);
    expect(host.querySelector('[data-anim="sweep-stack"]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(PROGRAM_SPECS.sweep.coverMs));
    expect(m).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(PROGRAM_SPECS.sweep.holdMs + PROGRAM_SPECS.sweep.revealMs));
    expect(host.querySelector('[data-testid="table-transition-layer"]')).toBeNull();
    act(() => root.unmount());
    host.remove();
  });
});

describe('Wave D — the Doorway, destination-dressed (row 67)', () => {
  it('kinds resolve per stop; unknown / no stop is the hall door', () => {
    expect(doorwayKindForStop('porch')).toBe('screen');
    expect(doorwayKindForStop('barbershop')).toBe('shop');
    expect(doorwayKindForStop('corner')).toBe('shop');
    expect(doorwayKindForStop('cookout')).toBe('gate');
    expect(doorwayKindForStop('the-pjs')).toBe('gate');
    expect(doorwayKindForStop('rec-center')).toBe('double');
    expect(doorwayKindForStop('church-basement')).toBe('double');
    expect(doorwayKindForStop('legends')).toBe('double');
    expect(doorwayKindForStop('king')).toBe('double');
    expect(doorwayKindForStop('high-rise')).toBe('elevator');
    expect(doorwayKindForStop('rooftop')).toBe('hall');
    expect(doorwayKindForStop('nope')).toBe('hall');
    expect(doorwayKindForStop('')).toBe('hall');
    expect(doorwayKindForStop(undefined)).toBe('hall');
    expect(doorwayKindForStop(null)).toBe('hall');
  });

  it('the episode carries its stop through cover, reveal, and snap-back', () => {
    registerTransitionRenderer(true);
    const m = vi.fn();
    coverThen(m, 'story-entry', { doorwayStopId: 'high-rise' });
    expect(getTransitionSnapshot()).toMatchObject({ program: 'doorway', doorwayStop: 'high-rise' });
    vi.advanceTimersByTime(PROGRAM_SPECS.doorway.coverMs);
    expect(m).toHaveBeenCalledTimes(1);
    expect(getTransitionSnapshot().doorwayStop).toBe('high-rise');
    // A snap-back navigation keeps the episode's dress.
    vi.advanceTimersByTime(PROGRAM_SPECS.doorway.holdMs + 60);
    const m2 = vi.fn();
    coverThen(m2, 'menu-nav');
    expect(getTransitionSnapshot()).toMatchObject({ program: 'doorway', doorwayStop: 'high-rise' });
    // A non-doorway episode never carries a stop.
    cancelTransitions();
    const m3 = vi.fn();
    coverThen(m3, 'menu-nav', { doorwayStopId: 'porch' });
    expect(getTransitionSnapshot().doorwayStop).toBe('');
  });

  it('StoryHome names the destination stop on doorway moves only', () => {
    const story = read('story/StoryHome.tsx');
    expect(story).toContain('doorwayStopId');
    expect(story).toContain("throughDoor ? 'story-entry' : 'screen'");
  });

  it('renders the hall door by default and the elevator for the High-Rise — silent, always', async () => {
    const { createElement } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { default: DoorwayLayer } = await import('../src/DoorwayLayer');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(DoorwayLayer)));
    act(() => registerTransitionRenderer(true));

    const m = vi.fn();
    act(() => coverThen(m, 'story-entry'));
    let el = host.querySelector<HTMLElement>('[data-testid="doorway-layer"]');
    expect(el!.dataset.doorKind).toBe('hall');
    expect(host.querySelectorAll('[data-anim^="door-"]')).toHaveLength(4);
    act(() => vi.advanceTimersByTime(PROGRAM_SPECS.doorway.coverMs + PROGRAM_SPECS.doorway.holdMs + PROGRAM_SPECS.doorway.revealMs));
    expect(host.querySelector('[data-testid="doorway-layer"]')).toBeNull();

    const m2 = vi.fn();
    act(() => coverThen(m2, 'story-entry', { doorwayStopId: 'high-rise' }));
    el = host.querySelector<HTMLElement>('[data-testid="doorway-layer"]');
    expect(el!.dataset.doorKind).toBe('elevator');
    expect(host.querySelector('[data-decor="door-leaf-l"]')).not.toBeNull();
    expect(host.querySelector('[data-decor="door-leaf-r"]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(PROGRAM_SPECS.doorway.coverMs + PROGRAM_SPECS.doorway.holdMs + PROGRAM_SPECS.doorway.revealMs));
    expect(host.querySelector('[data-testid="doorway-layer"]')).toBeNull();

    const m3 = vi.fn();
    act(() => coverThen(m3, 'story-entry', { doorwayStopId: 'porch' }));
    el = host.querySelector<HTMLElement>('[data-testid="doorway-layer"]');
    expect(el!.dataset.doorKind).toBe('screen');
    expect(host.querySelector('[data-decor="door-mesh"]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(PROGRAM_SPECS.doorway.coverMs + PROGRAM_SPECS.doorway.holdMs + PROGRAM_SPECS.doorway.revealMs));
    act(() => root.unmount());
    host.remove();

    // Silent by design under every kind: the layer imports no audio.
    const layer = read('DoorwayLayer.tsx');
    expect(layer).not.toContain("from './audio'");
    expect(layer).not.toContain('transitionSound');
    expect(layer).not.toContain('spraySound');
  });
});
