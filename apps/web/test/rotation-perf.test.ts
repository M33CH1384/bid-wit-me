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
    expect(scene).toContain('new ResizeObserver(check)');
    expect(scene).toContain("window.addEventListener('orientationchange', onFlip)");
  });
  it('size leader leads ONLY on an orientation crossing, never on a cadence', () => {
    // a leading commit is earned by the aspect class flipping vs the
    // store's size — a cadence/max-wait leader re-committed at intermediate
    // sizes during continuous resize streams (9–11 reallocs on the storm
    // rig), undoing the collapse the 200ms trailing measure exists for
    expect(scene).toContain('(r.width > r.height) === (cur.width > cur.height)');
    expect(scene).toContain('same aspect class: the trailing net owns it');
    // one commit ~50ms after the crossing, reading the then-current rect
    expect(scene).toContain('window.setTimeout(commit, 50)');
  });
});

describe('rotation round 3 — a flip never presents the cleared (black) buffer', () => {
  // Owner device report, 2026-10-29 (after rounds 1-2 shipped): "the first
  // time I flipped to landscape the screen went black outside of the
  // scoreboard and plates" and warm flips were "much faster but not
  // perfect". Mechanism: a flip-class setSize resets the drawing buffer;
  // until the new size's first frame presents, the compositor shows the
  // cleared buffer. The flip hold covers that window with the last live
  // frame, the rehearsal pre-treads the alternate size, and the viewport
  // commits a known class's insets atomically with the flip so nothing
  // shifts after landing.
  const scene = read('../src/three/Scene.tsx');
  const hold = read('../src/three/flipHold.ts');
  const leader = scene.slice(scene.indexOf('function SizeLeader()'), scene.indexOf('/** Feeds presented frames'));
  it('the size leader captures the live frame BEFORE the flip-class setSize', () => {
    expect(leader.indexOf('captureFlipFrame(')).toBeGreaterThan(-1);
    expect(leader.indexOf('captureFlipFrame(')).toBeLessThan(leader.indexOf('setSize(r.width, r.height)'));
    expect(leader).toContain('noteFlipSizeCommit(r.width, r.height)');
  });
  it('orientationchange arms the hold while the old buffer is still intact', () => {
    expect(leader).toContain("window.addEventListener('orientationchange', onFlip)");
    expect(leader).toContain('captureFlipFrame(st.gl, st.scene, st.camera)');
  });
  it('capture renders synchronously before copying (never reads a cleared buffer)', () => {
    const cap = hold.slice(hold.indexOf('export function captureFlipFrame'));
    expect(cap.indexOf('gl.render(')).toBeGreaterThan(-1);
    expect(cap.indexOf('gl.render(')).toBeLessThan(cap.indexOf('ctx.drawImage('));
  });
  it('the hold always has a hard release failsafe', () => {
    expect(hold).toContain('releaseFlipHold(); }, 1200)');
  });
  it('presented frames release the hold only at the target size', () => {
    expect(hold).toContain('state.targetW > 0');
    expect(scene).toContain('<PresentedProbe />');
    expect(scene).toContain('notePresentedFrame(width, height)');
  });
  it('the overlay mounts in the wrap, under the badge layer', () => {
    expect(scene).toContain('<FlipCoverOverlay />');
    expect(scene).toContain('registerCover(ref.current)');
  });
  it('the orientation rehearsal pre-treads the swapped size under the hold', () => {
    expect(scene).toContain('<OrientationRehearsal ready={textured} />');
    expect(scene).toContain('noteRehearsalSize(h, w)');
    expect(scene).toContain('setFlipHoldLock(true)');
    expect(scene).toContain('markRehearsed()');
  });
  const vp = read('../src/viewport.ts');
  it('a flip to a measured class commits that class\'s insets with the flip', () => {
    expect(vp).toContain('const safeByClass = new Map');
    expect(vp).toContain('const mem = safeByClass.get(next.short)');
    expect(vp).toContain('if (mem) next = { ...next, safe: mem }');
    expect(vp).toContain('safeByClass.set(next.short, next.safe)');
  });
  it('the fan safe-frac predicts from session memory at orientationchange', () => {
    expect(scene).toContain('const safeFracByClass = new Map');
    expect(scene).toContain('safeFracByClass.get(land)');
  });
  const css = read('../src/styles.css');
  it('the cover stretches over the wrap and never takes pointer events', () => {
    expect(css).toContain('.flip-cover { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 1; pointer-events: none; }');
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
