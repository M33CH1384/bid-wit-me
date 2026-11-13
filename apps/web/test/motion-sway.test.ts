/**
 * @vitest-environment happy-dom
 *
 * MOTION SWAY (owner, 2026-11-08): Motion view's tilt "feels great" but
 * he asked for "some slight side to side motion to make it realistic as
 * well but not as powerful as the tilt." The phone's ROLL (top tipping
 * sideways) now drives a gentle lateral pan of the table view:
 *
 *  - roll is read from the same gravity projection as the lean, in the
 *    SCREEN frame, so portrait and both landscapes read the same;
 *  - full sway (±5° of aim) at ±20° of roll — a third of tilt's 15°;
 *  - sway lives in its OWN live-only store. It never enters
 *    ViewAdjust {tilt, zoom}, never commits, never persists: when
 *    motion stops (suspend / toggle off / unmount) it centres, and
 *    the view is exactly the saved manual tilt/zoom again;
 *  - the readout chip keeps its "Tilt N° · Zoom N%" format — sway is
 *    ambience, not a third axis, and never opens the chip's gesture.
 *
 * THE BUTTON (owner, 2026-11-08, added same hour): while the Motion
 * view option is ON, a small toggle at the table suspends motion in
 * place (tap) and resumes it with a fresh re-baseline (tap again).
 * The Settings switch stays the master — the button never rewrites
 * the saved setting; it only flips the driver's 'quick' suspend.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MOTION_LEAN_RANGE_DEG, MOTION_ROLL_DEADZONE_DEG, MOTION_ROLL_RANGE_DEG, MOTION_SWAY_MAX_DEG,
  MotionViewDriver, applyMotionSwayToSpec, getMotionQuickSuspended, getMotionSwayDeg,
  getMotionViewEnabled, leanDegFromOrientation, noteExternalViewGesture, rollDegFromOrientation,
  seedMotionViewEnabled, setMotionQuickSuspended, setMotionSwayDeg, subscribeMotionQuickSuspend,
  subscribeMotionSway, swayForRollDelta, __resetMotionViewStore, type MotionEventTargetLike,
} from '../src/motionView';
import {
  __resetViewAdjustStore, applyViewAdjustToSpec, getViewAdjustState, onViewAdjustCommit,
  seedViewAdjust, type ViewAdjust,
} from '../src/viewAdjust';
import MotionViewButton from '../src/MotionViewButton';

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

/* -------------------------------------------------------- posture factory */

const rad = (d: number) => (d * Math.PI) / 180;
/**
 * The beta/gamma a real phone reports for a held posture, composed
 * from the MEASURED pair the feature reads: lean λ (the shipped
 * measure, atan2(−g·normal, −g·up)) and roll φ (the in-plane angle,
 * atan2(g·right, −g·up)) at screen orientation angle θ. Both measures
 * share the −g·up denominator, so gravity is
 * g = u·(tanφ·right − up − tanλ·normal) with u = 1/√(1+tan²λ+tan²φ) —
 * an Euler (pitch, roll) composition would NOT round-trip the shipped
 * lean (it reads 21.2° for a 20°/20° Euler posture), which is exactly
 * what the round-trip test below pins down.
 */
function posture(lean: number, roll: number, theta = 0): { beta: number; gamma: number } {
  const t = rad(theta);
  const right = [Math.cos(t), -Math.sin(t), 0];
  const up = [Math.sin(t), Math.cos(t), 0];
  const tanL = Math.tan(rad(lean)), tanR = Math.tan(rad(roll));
  const u = 1 / Math.sqrt(1 + tanL * tanL + tanR * tanR);
  const g = [0, 1, 2].map((i) => u * (tanR * right[i]! - up[i]! - tanL * (i === 2 ? 1 : 0)));
  const beta = (-Math.asin(Math.max(-1, Math.min(1, g[1]!))) * 180) / Math.PI;
  const gamma = (Math.atan2(g[0]!, -g[2]!) * 180) / Math.PI;
  return { beta, gamma };
}

/* ------------------------------------------------------------- constants */

describe('sway constants (named, one-line tunables like the tilt knobs)', () => {
  it('pins the shipped feel values — and sway is clearly weaker than tilt', () => {
    expect(MOTION_ROLL_RANGE_DEG).toBe(20); // same roll span as the lean span
    expect(MOTION_ROLL_RANGE_DEG).toBe(MOTION_LEAN_RANGE_DEG);
    expect(MOTION_ROLL_DEADZONE_DEG).toBe(3);
    expect(MOTION_SWAY_MAX_DEG).toBe(5);
    expect(MOTION_SWAY_MAX_DEG).toBeLessThanOrEqual(15 / 3); // a third of tilt's ±15°
  });
});

/* -------------------------------------------------------------- roll math */

describe('roll math (gravity in the screen frame, like the lean)', () => {
  it('postures round-trip: lean and roll read back independently in every orientation', () => {
    const cases: Array<[number, number, number]> = [
      [0, 0, 0], [20, 0, 0], [-20, 0, 0], [0, 20, 0], [0, -20, 0],
      [20, 20, 0], [-15, -25, 0], [35, 10, 0],
      [0, 0, 90], [0, 20, 90], [0, -20, 90], [10, 15, 90], [20, 0, 90],
      [0, 0, 270], [0, 20, 270], [0, -20, 270], [-10, -15, 270],
    ];
    for (const [lean, roll, theta] of cases) {
      const p = posture(lean, roll, theta);
      expect(leanDegFromOrientation(p.beta, p.gamma, theta), `lean ${lean}/${roll}/${theta}`).toBeCloseTo(lean, 4);
      expect(rollDegFromOrientation(p.beta, p.gamma, theta), `roll ${lean}/${roll}/${theta}`).toBeCloseTo(roll, 4);
    }
  });

  it('the known postures: portrait roll lives at (beta 70, gamma 90); upright is 0 everywhere', () => {
    expect(rollDegFromOrientation(90, 0, 0)).toBeCloseTo(0, 6); // portrait upright
    expect(rollDegFromOrientation(70, 90, 0)).toBeCloseTo(20, 6); // top tipped 20° to the player's right
    expect(rollDegFromOrientation(110, 90, 0)).toBeCloseTo(-20, 6); // top tipped left
    expect(rollDegFromOrientation(0, -90, 90)).toBeCloseTo(0, 6); // landscape-primary upright
    expect(rollDegFromOrientation(0, 90, 270)).toBeCloseTo(0, 6); // landscape-secondary upright
    expect(rollDegFromOrientation(null, 0, 0)).toBeNull();
    expect(rollDegFromOrientation(90, null, 0)).toBeNull();
  });

  it('sway mapping: deadzone, then the remaining roll sweeps to the 5° cap', () => {
    expect(swayForRollDelta(0)).toBe(0);
    expect(swayForRollDelta(MOTION_ROLL_DEADZONE_DEG)).toBe(0);
    expect(swayForRollDelta(-MOTION_ROLL_DEADZONE_DEG)).toBe(0);
    expect(swayForRollDelta(11.5)).toBeCloseTo(2.5, 6); // (11.5-3) * 5/17
    expect(swayForRollDelta(-11.5)).toBeCloseTo(-2.5, 6);
    expect(swayForRollDelta(MOTION_ROLL_RANGE_DEG)).toBe(MOTION_SWAY_MAX_DEG);
    expect(swayForRollDelta(45)).toBe(MOTION_SWAY_MAX_DEG); // clamped
    expect(swayForRollDelta(-45)).toBe(-MOTION_SWAY_MAX_DEG);
    expect(swayForRollDelta(Number.NaN)).toBe(0);
  });

  it('applyMotionSwayToSpec: positive sway pans the aim toward the camera’s own right; pos never moves', () => {
    const south = { pos: [0, 3, 6], look: [0, 1, 0], fov: 50 }; // the home seat: camera south, aiming north
    const still = applyMotionSwayToSpec(south, 0);
    expect(still.pos).toEqual([0, 3, 6]);
    expect(still.look).toEqual([0, 1, 0]);
    const right = applyMotionSwayToSpec(south, 5);
    expect(right.pos).toEqual([0, 3, 6]); // a pan of the aim, never a dolly
    expect(right.look[0]).toBeCloseTo(6 * Math.sin(rad(5)), 6); // aim swung toward +x (this camera's right)
    expect(right.look[1]).toBe(1); // height of the aim untouched
    expect(right.look[2]).toBeCloseTo(6 - 6 * Math.cos(rad(5)), 6);
    const left = applyMotionSwayToSpec(south, -5);
    expect(left.look[0]).toBeCloseTo(-6 * Math.sin(rad(5)), 6);
    // rotation: the pos→look distance is preserved at any sway
    const d = (s: typeof south) => Math.hypot(s.look[0]! - s.pos[0]!, s.look[1]! - s.pos[1]!, s.look[2]! - s.pos[2]!);
    expect(d(right)).toBeCloseTo(d(south), 6);
    // composes on top of tilt: pitch the aim first (viewAdjust), then sway — the aim's height survives
    const tilted = applyViewAdjustToSpec(south, { tilt: 15, zoom: 1 });
    const both = applyMotionSwayToSpec(tilted, 5);
    expect(both.look[1]).toBeCloseTo(tilted.look[1], 6);
    expect(both.pos).toEqual(tilted.pos);
  });
});

/* -------------------------------------------------------------- sway store */

describe('sway store (live-only: no commit channel exists for it)', () => {
  beforeEach(() => { __resetMotionViewStore(); __resetViewAdjustStore(); });
  afterEach(() => { __resetMotionViewStore(); __resetViewAdjustStore(); });

  it('defaults centred, notifies on change only, and the module reset centres it', () => {
    expect(getMotionSwayDeg()).toBe(0);
    let seen = 0;
    const unsub = subscribeMotionSway(() => { seen++; });
    setMotionSwayDeg(3.5);
    expect(getMotionSwayDeg()).toBe(3.5);
    expect(seen).toBe(1);
    setMotionSwayDeg(3.5); // same value: no churn
    expect(seen).toBe(1);
    unsub();
    __resetMotionViewStore();
    expect(getMotionSwayDeg()).toBe(0);
  });
});

/* ---------------------------------------------------------------- driver */

describe('motion sway driver (fake sensor target + fake clock)', () => {
  let target: FakeTarget;
  let driver: MotionViewDriver;
  let commits: ViewAdjust[];
  let angle = 0;

  const feed = (lean: number, roll: number, times = 1, stepMs = 50) => {
    for (let i = 0; i < times; i++) {
      vi.advanceTimersByTime(stepMs);
      const p = posture(lean, roll, angle);
      target.dispatch('deviceorientation', { beta: p.beta, gamma: p.gamma, alpha: 0 });
    }
  };
  const adj = () => getViewAdjustState().adj;
  const sway = () => getMotionSwayDeg();

  beforeEach(() => {
    vi.useFakeTimers();
    __resetViewAdjustStore();
    __resetMotionViewStore();
    seedViewAdjust({ tilt: 0, zoom: 1 });
    target = new FakeTarget();
    commits = [];
    onViewAdjustCommit((a) => commits.push(a));
    angle = 0;
    driver = new MotionViewDriver({ target, screenAngle: () => angle });
  });
  afterEach(() => {
    driver.dispose();
    vi.useRealTimers();
    __resetViewAdjustStore();
    __resetMotionViewStore();
  });

  it('the holding roll at enable is neutral: anchoring rolled does not sway', () => {
    driver.setEnabled(true);
    feed(0, 20, 4); // switched on while already rolled — that roll is "level"
    expect(sway()).toBe(0);
    expect(adj()).toEqual({ tilt: 0, zoom: 1 });
    expect(commits).toEqual([]);
  });

  it('rolling 20° from neutral sways to the 5° cap; tilt never moves and NOTHING is ever saved', () => {
    driver.setEnabled(true);
    feed(0, 0, 3); // anchor upright
    feed(0, 20, 14); // roll right, smoothing converges
    expect(Math.abs(sway() - MOTION_SWAY_MAX_DEG)).toBeLessThan(0.4);
    expect(adj().tilt).toBe(0); // roll alone never touches the tilt channel
    expect(getViewAdjustState().adjusting).toBe(false); // sway never opens the chip's gesture
    vi.advanceTimersByTime(3000); // settle + linger windows pass
    expect(commits).toEqual([]); // sway has no save channel — the persisted view is untouched
    expect(adj()).toEqual({ tilt: 0, zoom: 1 });
    feed(0, -20, 14); // roll left: sway follows through centre to the other cap
    expect(Math.abs(sway() + MOTION_SWAY_MAX_DEG)).toBeLessThan(0.4);
    expect(commits).toEqual([]);
  });

  it('inside the roll deadzone the view stays centred', () => {
    driver.setEnabled(true);
    feed(0, 0, 3);
    feed(0, 2, 10);
    feed(0, -2, 10);
    expect(sway()).toBe(0);
  });

  it('lean and roll compose: tilt sweeps to 15 while sway sits at its own cap', () => {
    driver.setEnabled(true);
    feed(0, 0, 3);
    feed(20, 20, 16);
    expect(Math.abs(adj().tilt - 15)).toBeLessThan(0.75);
    expect(Math.abs(sway() - MOTION_SWAY_MAX_DEG)).toBeLessThan(0.4);
  });

  it('landscape: the same physical roll reads the same at screen angle 90 and 270', () => {
    angle = 90;
    driver.setEnabled(true);
    feed(0, 0, 3);
    feed(0, 20, 14);
    expect(Math.abs(sway() - MOTION_SWAY_MAX_DEG)).toBeLessThan(0.4);
    driver.setEnabled(false);
    expect(sway()).toBe(0);
    angle = 270;
    driver.setEnabled(true);
    feed(0, 0, 3);
    feed(0, 20, 14);
    expect(Math.abs(sway() - MOTION_SWAY_MAX_DEG)).toBeLessThan(0.4);
  });

  it('a suspend centres the sway at once; samples are ignored; resume re-baselines without a jump', () => {
    driver.setEnabled(true);
    feed(0, 0, 3);
    feed(0, 20, 14);
    expect(Math.abs(sway() - MOTION_SWAY_MAX_DEG)).toBeLessThan(0.4);
    driver.setSuspended('covered', true);
    expect(sway()).toBe(0); // motion stopped: the view is the saved manual view again
    feed(0, -20, 6); // ignored while suspended
    expect(sway()).toBe(0);
    driver.setSuspended('covered', false);
    feed(0, -20, 3); // the rolled posture is the new neutral — no jump
    expect(sway()).toBe(0);
    feed(0, 0, 14); // upright is a +20° roll change from the −20° anchor
    expect(Math.abs(sway() - MOTION_SWAY_MAX_DEG)).toBeLessThan(0.4);
  });

  it('toggle-off and dispose centre the sway', () => {
    driver.setEnabled(true);
    feed(0, 0, 3);
    feed(0, 20, 14);
    expect(sway()).toBeGreaterThan(4);
    driver.setEnabled(false);
    expect(sway()).toBe(0);
    driver.setEnabled(true);
    feed(0, 0, 3);
    feed(0, 20, 14);
    expect(sway()).toBeGreaterThan(4);
    driver.dispose();
    expect(sway()).toBe(0);
  });

  it('touch wins for sway too: a felt gesture freezes it and the release re-baselines', () => {
    driver.setEnabled(true);
    feed(0, 0, 3);
    feed(0, 10, 14); // sway ≈ (10-3)*5/17 ≈ 2.06
    const held = sway();
    expect(Math.abs(held - 2.06)).toBeLessThan(0.35);
    noteExternalViewGesture(true);
    expect(sway()).toBe(0); // the finger owns the view: motion's offset is released
    feed(0, 0, 4); // ignored mid-gesture
    noteExternalViewGesture(false);
    feed(0, 0, 3); // re-baseline at the current posture
    expect(sway()).toBe(0);
    feed(0, 10, 14); // and roll drives it again from there
    expect(Math.abs(sway() - 2.06)).toBeLessThan(0.35);
  });
});

/* ------------------------------------------------------- quick-suspend store */

describe('quick-suspend store (the in-table button’s state — in-memory only)', () => {
  beforeEach(() => { __resetMotionViewStore(); });
  afterEach(() => { __resetMotionViewStore(); });

  it('defaults to driving, flips with notification, and the module reset restores driving', () => {
    expect(getMotionQuickSuspended()).toBe(false);
    let seen = 0;
    const unsub = subscribeMotionQuickSuspend(() => { seen++; });
    setMotionQuickSuspended(true);
    expect(getMotionQuickSuspended()).toBe(true);
    expect(seen).toBe(1);
    setMotionQuickSuspended(true); // same value: no churn
    expect(seen).toBe(1);
    setMotionQuickSuspended(false);
    expect(seen).toBe(2);
    unsub();
    setMotionQuickSuspended(true);
    __resetMotionViewStore();
    expect(getMotionQuickSuspended()).toBe(false);
  });

  // 2026-11-13: a pause no longer freezes the lean in place — the lean is live-only, so pausing
  // rests the view back on the saved tilt (what the button's own description always said).
  it('the driver honours the quick suspend exactly like a sheet pause (rested on the saved tilt, then re-baselined)', () => {
    vi.useFakeTimers();
    __resetViewAdjustStore();
    seedViewAdjust({ tilt: 0, zoom: 1 });
    const target = new FakeTarget();
    const driver = new MotionViewDriver({ target, screenAngle: () => 0 });
    const feed = (lean: number, roll: number, times = 1) => {
      for (let i = 0; i < times; i++) {
        vi.advanceTimersByTime(50);
        const p = posture(lean, roll, 0);
        target.dispatch('deviceorientation', { beta: p.beta, gamma: p.gamma, alpha: 0 });
      }
    };
    driver.setEnabled(true);
    feed(0, 0, 3);
    feed(10, 20, 14); // tilt ≈ 6.67, sway ≈ 5
    const heldTilt = getViewAdjustState().adj.tilt;
    expect(Math.abs(heldTilt - 6.67)).toBeLessThan(0.6);
    expect(getMotionSwayDeg()).toBeGreaterThan(4);
    driver.setSuspended('quick', true);
    expect(getMotionSwayDeg()).toBe(0); // sway released
    feed(0, 0, 6); // sensors ignored while suspended
    expect(getViewAdjustState().adj.tilt).toBe(0); // the lean is taken back: the saved tilt
    driver.setSuspended('quick', false);
    feed(0, 0, 3); // resume re-baselines at the current posture: no jump
    expect(getViewAdjustState().adj.tilt).toBe(0);
    expect(getMotionSwayDeg()).toBe(0);
    driver.dispose();
    vi.useRealTimers();
    __resetViewAdjustStore();
  });
});

/* -------------------------------------------------------------- the button */

describe('MotionViewButton (the in-table quick toggle)', () => {
  let el: HTMLDivElement;
  let root: Root;

  async function renderButton() {
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => { root.render(createElement(MotionViewButton)); });
    return el;
  }

  beforeEach(() => { __resetMotionViewStore(); });
  afterEach(async () => {
    if (root) await act(async () => { root.unmount(); });
    el?.remove();
    __resetMotionViewStore();
  });

  it('renders NOTHING while the Motion view option is off', async () => {
    seedMotionViewEnabled(false);
    const c = await renderButton();
    expect(c.querySelector('[data-testid="motion-view-toggle"]')).toBeNull();
  });

  it('appears when the option is on, showing the driving state', async () => {
    seedMotionViewEnabled(true);
    const c = await renderButton();
    const btn = c.querySelector('[data-testid="motion-view-toggle"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('aria-label')).toBe('Pause motion view');
    expect(btn.dataset.state).toBe('driving');
  });

  it('tap suspends, tap again resumes — and the saved option is never rewritten', async () => {
    seedMotionViewEnabled(true);
    const c = await renderButton();
    const btn = c.querySelector('[data-testid="motion-view-toggle"]') as HTMLButtonElement;
    await act(async () => { btn.click(); });
    expect(getMotionQuickSuspended()).toBe(true);
    const after = c.querySelector('[data-testid="motion-view-toggle"]') as HTMLButtonElement;
    expect(after.getAttribute('aria-pressed')).toBe('true');
    expect(after.getAttribute('aria-label')).toBe('Resume motion view');
    expect(after.dataset.state).toBe('suspended');
    await act(async () => { after.click(); });
    expect(getMotionQuickSuspended()).toBe(false);
    // the master switch is untouched by the button, both ways
    expect(getMotionViewEnabled()).toBe(true);
  });

  it('turning the option off in Settings removes the button (and clears a stale suspend)', async () => {
    seedMotionViewEnabled(true);
    const c = await renderButton();
    const btn = c.querySelector('[data-testid="motion-view-toggle"]') as HTMLButtonElement;
    await act(async () => { btn.click(); });
    expect(getMotionQuickSuspended()).toBe(true);
    await act(async () => { seedMotionViewEnabled(false); });
    expect(c.querySelector('[data-testid="motion-view-toggle"]')).toBeNull();
    // the master switch resets the quick state: turning the option back
    // on later starts driving, not stuck suspended with the button gone
    expect(getMotionQuickSuspended()).toBe(false);
  });

  it('wiring pins: Scene feeds the quick store to the driver as a suspend; Table renders the button', () => {
    const scene = readFileSync('apps/web/src/three/Scene.tsx', 'utf8');
    expect(scene).toContain("setSuspended('quick'");
    expect(scene).toContain('subscribeMotionQuickSuspend');
    const table = readFileSync('apps/web/src/Table.tsx', 'utf8');
    expect(table).toContain('<MotionViewButton');
  });

  it('the button carries a real tap target in CSS (≥40px both ways)', () => {
    const css = readFileSync('apps/web/src/styles.css', 'utf8');
    const block = css.match(/\.motion-view-btn\s*\{[^}]*\}/)?.[0] ?? '';
    expect(block).not.toBe('');
    const minH = Number(block.match(/min-height:\s*(\d+)px/)?.[1] ?? 0);
    const minW = Number(block.match(/min-width:\s*(\d+)px/)?.[1] ?? 0);
    expect(minH).toBeGreaterThanOrEqual(40);
    expect(minW).toBeGreaterThanOrEqual(40);
  });
});
