/**
 * @vitest-environment happy-dom
 *
 * MOTION VIEW (owner, 2026-11-07 — "Let's try both"): an optional Settings
 * toggle, OFF by default. Lean-to-tilt drives the SAME viewAdjust store the
 * drag/pinch gestures drive. (Push/pull nudge-zoom shipped alongside the
 * lean and was REMOVED the same day on the owner's verdict — see the
 * "zoom half is GONE" describe below.)
 *
 * Pins below are the contract:
 *  - lean sign: leaning the top of the phone AWAY from the player pitches
 *    the view TOWARD the table (+tilt — the same direction a finger-UP
 *    drag takes today, tiltForDragY(0, -70) === 10 in view-adjust.test.ts).
 *    Every feel constant is named in motionView.ts so a one-line flip
 *    retunes it.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MOTION_LEAN_DEADZONE_DEG, MOTION_LEAN_RANGE_DEG,
  MOTION_PERSIST_INTERVAL_MS, MOTION_SETTLE_MS, MOTION_SMOOTHING_TAU_MS,
  LeanSmoother, MotionViewDriver, enableMotionSensors, getMotionViewEnabled,
  gravityFromOrientation, leanDegFromOrientation, noteExternalViewGesture, seedMotionViewEnabled,
  subscribeMotionViewEnabled, tiltForLeanDelta, __resetMotionViewStore, type MotionEventTargetLike,
} from '../src/motionView';
import * as motionViewModule from '../src/motionView';
import {
  __resetViewAdjustStore, getViewAdjustState, onViewAdjustCommit, seedViewAdjust,
  type ViewAdjust,
} from '../src/viewAdjust';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { fx } from '../src/fx';
import MotionViewRow from '../src/MotionViewRow';
import MoreOptions from '../src/MoreOptions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 20000 });

/* ------------------------------------------------------------ fake target */

class FakeTarget implements MotionEventTargetLike {
  private map = new Map<string, Set<(e: never) => void>>();
  addEventListener(type: string, fn: (e: never) => void): void {
    let s = this.map.get(type);
    if (!s) { s = new Set(); this.map.set(type, s); }
    s.add(fn);
  }
  removeEventListener(type: string, fn: (e: never) => void): void {
    this.map.get(type)?.delete(fn);
  }
  dispatch(type: string, e: unknown): void {
    for (const fn of [...(this.map.get(type) ?? [])]) (fn as (x: unknown) => void)(e);
  }
  count(type: string): number { return this.map.get(type)?.size ?? 0; }
}

/* ------------------------------------------------------------- constants */

describe('motion view constants (the feel knobs — one named module)', () => {
  it('pins the shipped feel values', () => {
    expect(MOTION_LEAN_RANGE_DEG).toBe(20);
    expect(MOTION_LEAN_DEADZONE_DEG).toBe(2);
    expect(MOTION_SMOOTHING_TAU_MS).toBe(150);
    expect(MOTION_PERSIST_INTERVAL_MS).toBe(500);
    expect(MOTION_SETTLE_MS).toBe(600);
  });
});

/* -------------------------------------------------------------- lean math */

describe('lean math', () => {
  it('gravity direction from beta/gamma matches the physical postures', () => {
    const g1 = gravityFromOrientation(0, 0)!; // flat on the table, screen up
    expect(g1.x).toBeCloseTo(0, 6); expect(g1.y).toBeCloseTo(0, 6); expect(g1.z).toBeCloseTo(-1, 6);
    const g2 = gravityFromOrientation(90, 0)!; // upright portrait
    expect(g2.x).toBeCloseTo(0, 6); expect(g2.y).toBeCloseTo(-1, 6); expect(g2.z).toBeCloseTo(0, 6);
    const g3 = gravityFromOrientation(0, 90)!;
    expect(g3.x).toBeCloseTo(1, 6); expect(g3.y).toBeCloseTo(0, 6); expect(g3.z).toBeCloseTo(0, 6);
    expect(gravityFromOrientation(null, 0)).toBeNull();
    expect(gravityFromOrientation(90, null)).toBeNull();
  });

  it('lean: upright is 0 in every orientation; top AWAY is positive', () => {
    expect(leanDegFromOrientation(90, 0, 0)).toBeCloseTo(0, 6); // portrait upright
    expect(leanDegFromOrientation(70, 0, 0)).toBeCloseTo(20, 6); // top away 20°
    expect(leanDegFromOrientation(110, 0, 0)).toBeCloseTo(-20, 6); // top toward the player
    expect(leanDegFromOrientation(50, 0, 0)).toBeCloseTo(40, 6);
    expect(leanDegFromOrientation(0, 0, 0)).toBeCloseTo(90, 6); // laid flat, screen up
    expect(leanDegFromOrientation(180, 0, 0)).toBeCloseTo(-90, 6); // face down
    // landscape-primary (top edge left): upright reads (beta 0, gamma -90)
    expect(leanDegFromOrientation(0, -90, 90)).toBeCloseTo(0, 6);
    expect(leanDegFromOrientation(0, -70, 90)).toBeCloseTo(20, 6); // leaned away in landscape
    // landscape-secondary (top edge right): upright reads (beta 0, gamma 90)
    expect(leanDegFromOrientation(0, 90, 270)).toBeCloseTo(0, 6);
    expect(leanDegFromOrientation(0, 70, 270)).toBeCloseTo(20, 6);
    expect(leanDegFromOrientation(null, 0, 0)).toBeNull();
  });

  it('tilt mapping: deadzone, then the remaining lean sweeps the full ±15°', () => {
    expect(tiltForLeanDelta(0)).toBe(0);
    expect(tiltForLeanDelta(MOTION_LEAN_DEADZONE_DEG)).toBe(0);
    expect(tiltForLeanDelta(-MOTION_LEAN_DEADZONE_DEG)).toBe(0);
    expect(tiltForLeanDelta(11)).toBeCloseTo(7.5, 6); // (11-2) * 15/18
    expect(tiltForLeanDelta(-11)).toBeCloseTo(-7.5, 6);
    expect(tiltForLeanDelta(MOTION_LEAN_RANGE_DEG)).toBe(15);
    expect(tiltForLeanDelta(45)).toBe(15); // clamped at the view bound
    expect(tiltForLeanDelta(-45)).toBe(-15);
  });

  it('smoother: first sample snaps; then it converges exponentially (tau 150ms)', () => {
    const s = new LeanSmoother();
    expect(s.push(7, 16)).toBe(7); // no history: snap, never a sweep from 0
    s.reset();
    expect(s.current).toBeNull();
    s.push(0, 16);
    expect(s.push(10, 150)).toBeCloseTo(10 * (1 - Math.exp(-1)), 4);
    let v = 0;
    for (let i = 0; i < 30; i++) v = s.push(10, 50); // 1.5 s more
    expect(Math.abs(v - 10)).toBeLessThan(0.05);
    s.reset(3);
    expect(s.current).toBe(3);
  });
});

/* -------------------------------------- the zoom half is GONE (owner) */

// Owner verdict, 2026-11-07 (hours after the feature shipped): "I like
// the motion control as far as tilt. The zoom isn't working but that's
// fine — remove that part". The push/pull nudge-zoom is REMOVED, not
// fixed: the whole nudge-detector describe that used to live here is
// replaced by absence pins so the machinery cannot creep back.
describe('the zoom half is GONE (owner verdict, 2026-11-07)', () => {
  it('the module exports no nudge machinery anymore', () => {
    const mod = motionViewModule as Record<string, unknown>;
    for (const k of [
      'MOTION_NUDGE_Z_THRESHOLD', 'MOTION_NUDGE_CONFIRM_SAMPLES',
      'MOTION_NUDGE_REFRACTORY_MS', 'MOTION_NUDGE_PUSH_AZ_SIGN',
      'MOTION_ZOOM_STEP', 'NudgeDetector',
    ]) {
      expect(mod[k], k).toBeUndefined();
    }
  });

  it('the source never registers for motion events — no listener can exist', () => {
    const srcText = readFileSync('apps/web/src/motionView.ts', 'utf8');
    expect(srcText).not.toContain("'devicemotion'");
    expect(srcText).not.toContain('DeviceMotionEvent');
  });
});

/* ---------------------------------------------------------------- driver */

describe('motion view driver (fake sensor target + fake clock)', () => {
  let target: FakeTarget;
  let driver: MotionViewDriver;
  let commits: ViewAdjust[];

  const orient = (beta: number, gamma = 0) => target.dispatch('deviceorientation', { beta, gamma, alpha: 0 });
  const motion = (z: number) => target.dispatch('devicemotion', {
    acceleration: { x: 0, y: 0, z }, accelerationIncludingGravity: { x: 0, y: 0, z },
  });
  /** Advance the fake clock, then deliver one orientation sample. */
  const feed = (beta: number, times = 1, stepMs = 50) => {
    for (let i = 0; i < times; i++) { vi.advanceTimersByTime(stepMs); orient(beta); }
  };
  const adj = () => getViewAdjustState().adj;

  beforeEach(() => {
    vi.useFakeTimers();
    __resetViewAdjustStore();
    __resetMotionViewStore();
    seedViewAdjust({ tilt: 0, zoom: 1 });
    target = new FakeTarget();
    commits = [];
    onViewAdjustCommit((a) => commits.push(a));
    driver = new MotionViewDriver({ target, screenAngle: () => 0 });
  });
  afterEach(() => {
    driver.dispose();
    vi.useRealTimers();
    __resetViewAdjustStore();
    __resetMotionViewStore();
  });

  it('listeners exist only while enabled; toggle-off and dispose remove them all', () => {
    expect(target.count('deviceorientation')).toBe(0);
    expect(target.count('devicemotion')).toBe(0);
    driver.setEnabled(true);
    expect(target.count('deviceorientation')).toBe(1);
    // NO motion listener, ever (owner 2026-11-07: the nudge-zoom is removed).
    expect(target.count('devicemotion')).toBe(0);
    expect(driver.isListening()).toBe(true);
    driver.setEnabled(false);
    expect(target.count('deviceorientation')).toBe(0);
    expect(target.count('devicemotion')).toBe(0);
    driver.setEnabled(true);
    driver.dispose();
    expect(target.count('deviceorientation')).toBe(0);
    expect(target.count('devicemotion')).toBe(0);
  });

  it('the holding angle at enable is neutral: the first samples anchor, the view does not jump', () => {
    driver.setEnabled(true);
    feed(70, 4); // already leaning when switched on — that lean is "level"
    expect(adj().tilt).toBe(0);
    expect(commits).toEqual([]);
  });

  it('leaning away 20° sweeps the view to +15° (toward the table); settle commits and the chip lingers out', () => {
    driver.setEnabled(true);
    feed(90, 3); // anchor upright
    feed(70, 14); // lean away over ~700ms (smoothing converges)
    expect(Math.abs(adj().tilt - 15)).toBeLessThan(0.75);
    expect(getViewAdjustState().adjusting).toBe(true); // chip is up while it moves
    vi.advanceTimersByTime(700); // settle window passes
    expect(commits.length).toBeGreaterThanOrEqual(1);
    expect(Math.abs(commits[commits.length - 1]!.tilt - 15)).toBeLessThan(0.75);
    vi.advanceTimersByTime(2200); // readout linger expires
    expect(getViewAdjustState().adjusting).toBe(false);
  });

  it('inside the deadzone nothing moves and nothing saves', () => {
    driver.setEnabled(true);
    feed(90, 3);
    feed(88, 10); // 2° of lean
    feed(92, 10); // 2° the other way
    expect(adj().tilt).toBe(0);
    expect(commits).toEqual([]);
  });

  it('touch wins: while a felt gesture is active the lean is ignored; on release it re-baselines without a jump', () => {
    driver.setEnabled(true);
    feed(90, 3);
    feed(80, 14); // lean 10° -> tilt ≈ 6.67
    const held = adj().tilt;
    expect(Math.abs(held - 6.67)).toBeLessThan(0.6);
    noteExternalViewGesture(true);
    feed(90, 6); // the player straightens the phone mid-drag — view must NOT follow
    expect(adj().tilt).toBe(held);
    noteExternalViewGesture(false);
    feed(90, 3); // resume at the new holding angle: re-baselined, still no jump
    expect(adj().tilt).toBe(held);
    feed(85, 14); // lean 5° from the NEW neutral adds its tilt on top of the held value
    expect(Math.abs(adj().tilt - (held + 2.5))).toBeLessThan(0.6);
  });

  it('a covering sheet suspends; closing it re-baselines (no jump on return)', () => {
    driver.setEnabled(true);
    feed(90, 3);
    driver.setSuspended('covered', true);
    feed(70, 6);
    expect(adj().tilt).toBe(0);
    driver.setSuspended('covered', false);
    feed(70, 3); // the leaned posture is the new neutral
    expect(adj().tilt).toBe(0);
    feed(60, 14); // 10° further from there
    expect(Math.abs(adj().tilt - 6.67)).toBeLessThan(0.6);
  });

  it('suspended from the start (e.g. Reduce effects): samples do nothing until it clears', () => {
    driver.setSuspended('reduced', true);
    driver.setEnabled(true);
    feed(90, 3);
    feed(70, 10);
    expect(adj().tilt).toBe(0);
    driver.setSuspended('reduced', false);
    feed(90, 3);
    feed(70, 14);
    expect(Math.abs(adj().tilt - 15)).toBeLessThan(0.75);
  });

  it('motion events are inert: the push/pull traces that used to step the zoom change nothing now', () => {
    // Supersedes 'push steps zoom in by the fixed step…' (removed with
    // the nudge-zoom, owner 2026-11-07). The driver registers no motion
    // listener, so even sustained hard traces are dead air: zoom, tilt
    // and saves all stay exactly where the lean left them.
    driver.setEnabled(true);
    feed(90, 3);
    for (let i = 0; i < 10; i++) { vi.advanceTimersByTime(30); motion(-6); } // a hard push
    for (let i = 0; i < 10; i++) { vi.advanceTimersByTime(30); motion(6); } // a hard pull
    vi.advanceTimersByTime(1500);
    expect(adj().zoom).toBe(1);
    expect(adj().tilt).toBe(0);
    expect(commits).toEqual([]);
  });

  it('persistence throttle: a 3s continuous wiggle commits a handful of times, never per tick', () => {
    driver.setEnabled(true);
    feed(90, 3);
    for (let i = 0; i < 30; i++) { vi.advanceTimersByTime(100); orient(i % 2 === 0 ? 80 : 100); }
    expect(commits.length).toBeGreaterThanOrEqual(2);
    expect(commits.length).toBeLessThanOrEqual(8); // ~2/s ceiling + settle headroom
    vi.advanceTimersByTime(700); // settle
    const last = commits[commits.length - 1]!;
    expect(last).toEqual(adj()); // what was saved is exactly where the view rests
  });

  it('toggle-off mid-lean closes the gesture and commits where the view rests', () => {
    driver.setEnabled(true);
    feed(90, 3);
    feed(80, 14);
    const held = adj().tilt;
    expect(Math.abs(held - 6.67)).toBeLessThan(0.6);
    driver.setEnabled(false);
    expect(driver.isListening()).toBe(false);
    expect(commits.length).toBeGreaterThanOrEqual(1);
    expect(commits[commits.length - 1]!.tilt).toBe(held);
    feed(70, 5); // no listeners: nothing happens
    expect(adj().tilt).toBe(held);
  });
});

/* ------------------------------------------------------- enabled seeding */

describe('enabled store (seeded from settings by the table, like viewAdjust)', () => {
  beforeEach(() => { __resetMotionViewStore(); });
  afterEach(() => { __resetMotionViewStore(); });
  it('defaults OFF, follows seeds, and notifies subscribers only on change', () => {
    expect(getMotionViewEnabled()).toBe(false);
    let seen = 0;
    const unsub = subscribeMotionViewEnabled(() => { seen++; });
    seedMotionViewEnabled(true);
    expect(getMotionViewEnabled()).toBe(true);
    expect(seen).toBe(1);
    seedMotionViewEnabled(true); // same value: no churn
    expect(seen).toBe(1);
    seedMotionViewEnabled(false);
    expect(getMotionViewEnabled()).toBe(false);
    expect(seen).toBe(2);
    unsub();
    seedMotionViewEnabled(true);
    expect(seen).toBe(2);
  });
});

/* -------------------------------------------------------------- settings */

describe('settings: motionView field', () => {
  it('defaults OFF, survives a round-trip when on, junk becomes OFF', () => {
    expect(DEFAULT_SETTINGS.motionView).toBe(false);
    expect(normalizeSettings({}).motionView).toBe(false);
    expect(normalizeSettings({ motionView: true }).motionView).toBe(true);
    expect(normalizeSettings({ motionView: 'yes' as never }).motionView).toBe(false);
    expect(normalizeSettings({ motionView: 1 as never }).motionView).toBe(false);
  });
});

/* ------------------------------------------------------------- permission */

describe('enableMotionSensors (permission + probe, injected env)', () => {
  const grantedCtor = { requestPermission: async () => 'granted' };
  const deniedCtor = { requestPermission: async () => 'denied' };
  const plainCtor = {}; // platforms with no permission gate

  class ProbeTarget extends FakeTarget {
    constructor(private ev: unknown) { super(); }
    override addEventListener(type: string, fn: (e: never) => void): void {
      super.addEventListener(type, fn);
      if (type === 'deviceorientation' && this.ev !== undefined) {
        setTimeout(() => (fn as (x: unknown) => void)(this.ev), 5);
      }
    }
  }

  it('no sensor constructors at all -> absent', async () => {
    await expect(enableMotionSensors({ orientationCtor: null, motionCtor: null, target: new FakeTarget() }, 50)).resolves.toBe('absent');
  });

  it('iOS-style grant + a live sensor -> granted', async () => {
    const target = new ProbeTarget({ beta: 75, gamma: 0 });
    await expect(enableMotionSensors({ orientationCtor: grantedCtor, motionCtor: grantedCtor, target }, 500)).resolves.toBe('granted');
  });

  it('iOS-style denial -> denied, and the probe never runs', async () => {
    const target = new ProbeTarget({ beta: 75, gamma: 0 });
    await expect(enableMotionSensors({ orientationCtor: deniedCtor, motionCtor: grantedCtor, target }, 500)).resolves.toBe('denied');
  });

  it('motion permission is never consulted anymore (superseded 2026-11-07)', async () => {
    // Was: 'orientation granted but motion denied -> denied'. With the
    // nudge-zoom removed, nothing reads motion events, so the enable
    // flow no longer asks for (or cares about) motion permission at
    // all: an orientation grant + a live sensor is enough.
    const target = new ProbeTarget({ beta: 75, gamma: 0 });
    await expect(enableMotionSensors({ orientationCtor: grantedCtor, motionCtor: deniedCtor, target }, 500)).resolves.toBe('granted');
  });

  it('no permission gate + live sensor -> granted (desktop/Android shape)', async () => {
    const target = new ProbeTarget({ beta: 75, gamma: 0 });
    await expect(enableMotionSensors({ orientationCtor: plainCtor, motionCtor: plainCtor, target }, 500)).resolves.toBe('granted');
  });

  it('permission fine but the sensor is silent -> absent (a desktop with no gyro)', async () => {
    const target = new ProbeTarget(undefined);
    await expect(enableMotionSensors({ orientationCtor: plainCtor, motionCtor: plainCtor, target }, 60)).resolves.toBe('absent');
  });

  it('events with null angles do not count as a sensor', async () => {
    const target = new ProbeTarget({ beta: null, gamma: null });
    await expect(enableMotionSensors({ orientationCtor: plainCtor, motionCtor: plainCtor, target }, 60)).resolves.toBe('absent');
  });

  it('a throwing requestPermission fails closed as denied, never throws', async () => {
    const throwing = { requestPermission: async () => { throw new Error('nope'); } };
    const target = new ProbeTarget({ beta: 75, gamma: 0 });
    await expect(enableMotionSensors({ orientationCtor: throwing, motionCtor: plainCtor, target }, 60)).resolves.toBe('denied');
  });
});

/* -------------------------------------------------------------- the row */

describe('MotionViewRow (the Settings toggle)', () => {
  let el: HTMLDivElement;
  let root: Root;

  function stubMatchMedia() {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => ({
        matches: false, media: q,
        addEventListener: () => {}, removeEventListener: () => {},
        addListener: () => {}, removeListener: () => {},
      }),
    });
  }

  async function renderRow(props: Record<string, unknown>) {
    stubMatchMedia();
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root.render(createElement(MotionViewRow, {
        value: false,
        onChange: () => {},
        enableFn: async () => 'granted' as const,
        ...props,
      }));
    });
    return el;
  }
  const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

  afterEach(async () => {
    fx.setReduce(false);
    if (root) await act(async () => { root.unmount(); });
    el?.remove();
  });

  it('turning it on runs the permission flow first; a grant flips it on', async () => {
    const onChange = vi.fn();
    const c = await renderRow({ onChange });
    const sw = c.querySelector('[data-testid="motion-view"]') as HTMLButtonElement;
    expect(sw).not.toBeNull();
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await act(async () => { sw.click(); });
    await flush();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('a denial keeps it OFF and says so in plain words', async () => {
    const onChange = vi.fn();
    const c = await renderRow({ onChange, enableFn: async () => 'denied' as const });
    const sw = c.querySelector('[data-testid="motion-view"]') as HTMLButtonElement;
    await act(async () => { sw.click(); });
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(c.textContent).toContain('denied');
  });

  it('no sensor keeps it OFF and says so in plain words', async () => {
    const onChange = vi.fn();
    const c = await renderRow({ onChange, enableFn: async () => 'absent' as const });
    const sw = c.querySelector('[data-testid="motion-view"]') as HTMLButtonElement;
    await act(async () => { sw.click(); });
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(c.textContent).toContain('No motion sensor');
  });

  it('turning it OFF is immediate and never asks permission', async () => {
    const onChange = vi.fn();
    const enableFn = vi.fn(async () => 'granted' as const);
    const c = await renderRow({ value: true, onChange, enableFn });
    const sw = c.querySelector('[data-testid="motion-view"]') as HTMLButtonElement;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await act(async () => { sw.click(); });
    expect(onChange).toHaveBeenCalledWith(false);
    expect(enableFn).not.toHaveBeenCalled();
  });

  it('Reduce effects on: the toggle cannot be switched on, with a plain note', async () => {
    fx.setReduce(true);
    const onChange = vi.fn();
    const c = await renderRow({ onChange });
    const sw = c.querySelector('[data-testid="motion-view"]') as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    expect(c.textContent).toContain('Reduce effects');
    await act(async () => { sw.click(); });
    await flush();
    expect(onChange).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------- the sheet carries the row */

describe('the Settings sheet carries the Motion view row (both themes, one sheet)', () => {
  let el: HTMLDivElement;
  let root: Root;
  afterEach(async () => {
    if (root) await act(async () => { root.unmount(); });
    el?.remove();
  });
  it('the row is present in the Look & effects group', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => ({
        matches: false, media: q,
        addEventListener: () => {}, removeEventListener: () => {},
        addListener: () => {}, removeListener: () => {},
      }),
    });
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root.render(createElement(MoreOptions, {
        settings: DEFAULT_SETTINGS,
        onChange: () => {},
        tips: { on: false, asked: true },
        onTips: () => {},
        onClose: () => {},
      }));
    });
    const look = el.querySelector('.set-group[aria-label="Look & effects"]');
    expect(look).not.toBeNull();
    const sw = look!.querySelector('[data-testid="motion-view"]');
    expect(sw).not.toBeNull();
    expect(look!.textContent).toContain('Motion view');
  });
});
