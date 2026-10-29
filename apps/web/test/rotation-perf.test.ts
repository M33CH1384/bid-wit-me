/**
 * Rotation perf pins (owner device report, 2026-10-29: "lags extremely bad
 * when switching between portrait and landscape").
 *
 * Measured root cause (production-build rig, storm rotation): NOT a remount
 * and NOT asset reloads — the canvas element, the seated figures and the
 * asset gate all survived every flip with zero refetches. The cost was the
 * per-event repetition: a flip fires window resize + orientationchange + a
 * visualViewport stream, and three independent paths each did full work per
 * event — useViewport committed a fresh record (whole-table re-render),
 * react-use-measure committed nearly every intermediate size (each commit
 * reallocates the WebGL MSAA drawing buffer: 17 reallocs per flip), and the
 * FX layer repainted + re-rendered per event. These pins hold the collapse:
 * one meaningful commit per flip on every path.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isShortLandscape } from '../src/viewport';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('rotation perf — viewport hook commits once per meaningful change', () => {
  const src = read('../src/viewport.ts');
  it('coalesces the event burst through one rAF', () => {
    expect(src).toContain('requestAnimationFrame(commit)');
  });
  it('does not commit pixel-only size wiggles (short/safe guard)', () => {
    expect(src).toContain('next.short === committed.short');
    expect(src).toContain('next.safe.l === committed.safe.l');
    // the old per-event commit is gone
    expect(src).not.toContain('const on = () => setVp(read(probe))');
  });
  it('short-landscape classification is unchanged', () => {
    expect(isShortLandscape(844, 390)).toBe(true);
    expect(isShortLandscape(932, 430)).toBe(true);
    expect(isShortLandscape(390, 844)).toBe(false);
    expect(isShortLandscape(1024, 768)).toBe(false); // h > 540: not a short phone landscape
    expect(isShortLandscape(700, 560)).toBe(false); // ratio under 1.25
  });
});

describe('rotation perf — WebGL size commits collapse to the settled size', () => {
  const src = read('../src/three/Scene.tsx');
  it('Canvas measure debounce is 200ms (trailing), not 50', () => {
    expect(src).toContain('resize={{ debounce: 200 }}');
    expect(src).not.toContain('resize={{ debounce: 50 }}');
  });
});

describe('rotation convergence — the new orientation commits on the leading edge', () => {
  // Owner follow-up (2026-10-29, after the lag fix shipped): the flip now
  // converged but LATE — the table sat squeezed at portrait width in
  // landscape, "after a while it expands". The collapse above made every
  // commit wait on the event stream's tail (rAF + trailing debounce), and
  // on a real phone the stream runs hundreds of ms with the geometry held
  // stale through the first half of it. These pins hold the leading edge:
  // an aspect flip commits synchronously, timed settle ticks catch a
  // browser that delivers the new geometry with no event at the landing
  // moment, and the canvas size leader caps repeats instead of trailing
  // the stream.
  const vp = read('../src/viewport.ts');
  it('viewport commits synchronously when the live aspect class has flipped', () => {
    expect(vp).toContain('isShortLandscape(window.innerWidth, window.innerHeight) !== committed.short');
  });
  it('orientationchange arms a timed settle chain of gated commits', () => {
    expect(vp).toContain("window.addEventListener('orientationchange', onFlip)");
    expect(vp).toContain('[90, 200, 350, 550, 800]');
    expect(vp).toContain('const armChain = () => {');
  });
  it('a trailing net re-checks after the burst (late safe-area drift)', () => {
    expect(vp).toContain('const armNet = () => {');
    expect(vp).toContain('netHops < 3');
  });
  const scene = read('../src/three/Scene.tsx');
  it('canvas size leader observes the measured box and commits leading-edge', () => {
    expect(scene).toContain('<SizeLeader />');
    expect(scene).toContain('function SizeLeader()');
    expect(scene).toContain('new ResizeObserver(() => check())');
    expect(scene).toContain("window.addEventListener('orientationchange', onFlip)");
  });
  it('size leader repeats are max-wait capped at 150ms, not stream-trailing', () => {
    expect(scene).toContain('now - lastAt >= 150');
    expect(scene).toContain('lastAt + 150 - now');
  });
});

describe('rotation perf — per-event layer work is frame-coalesced', () => {
  const fx = read('../src/animfx/AnimFxLayer.tsx');
  it('shade repaint and layer tick ride rAF, not raw resize events', () => {
    expect(fx).not.toContain("const onResize = () => paintShade();");
    expect(fx).not.toContain('const onResize = () => setTick((x) => x + 1);');
    expect(fx).toContain('requestAnimationFrame(() => { raf = 0; paintShade(); })');
    expect(fx).toContain('requestAnimationFrame(() => { raf = 0; setTick((x) => x + 1); })');
  });
  const table = read('../src/Table.tsx');
  it('bid-panel fit coalesces event-driven fits per frame, interval intact', () => {
    expect(table).toContain('const iv = window.setInterval(() => fitRef.current(), 250);');
    expect(table).toContain('requestAnimationFrame(() => { raf = 0; fitRef.current(); })');
  });
});
