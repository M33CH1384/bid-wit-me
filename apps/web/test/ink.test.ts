/** Neon Royale P2: the ink layer — mode decision matrix, splat math, governor,
 *  and the source pins that keep the ink observed-only and unmount-at-table. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inkGradientAnimated, inkLowQuality, inkMode, type InkGateState } from '../src/ink/mode';
import {
  AMBIENT_MAX_RADIUS,
  AMBIENT_MIN_RADIUS,
  AMBIENT_STRENGTH,
  DRAG_MAX_RADIUS,
  DRAG_MIN_RADIUS,
  DYE_DECAY_RATE,
  PRESS_RADIUS,
  PRESS_STRENGTH,
  SPLAT_MAX_SPEED,
  SPLAT_PULL,
  VEL_DECAY_RATE,
  decayFactor,
  dragSplat,
  inkColor,
  pressSplat,
  segmentSplats,
  type InkSplat,
} from '../src/ink/splat';
import { SIM_WIDTHS, createGovernor, governorFrame, simSizeFor } from '../src/ink/governor';

const GOOD: InkGateState = {
  theme: 'neon',
  inGame: false,
  reducedMotion: false,
  reduceEffects: false,
  lowQuality: false,
  webgl: true,
};

describe('ink mode decision', () => {
  it('all gates green → webgl', () => {
    expect(inkMode(GOOD)).toBe('webgl');
  });

  it('Classic → none, whatever else is true', () => {
    expect(inkMode({ ...GOOD, theme: 'classic' })).toBe('none');
    expect(
      inkMode({ theme: 'classic', inGame: true, reducedMotion: true, reduceEffects: true, lowQuality: true, webgl: false }),
    ).toBe('none');
  });

  it('a live table → none (the canvas unmounts; the 3D scene owns WebGL)', () => {
    expect(inkMode({ ...GOOD, inGame: true })).toBe('none');
  });

  it('reduced motion → gradient, and the gradient does not drift', () => {
    const s = { ...GOOD, reducedMotion: true };
    expect(inkMode(s)).toBe('gradient');
    expect(inkGradientAnimated(s)).toBe(false);
  });

  it('Reduce effects → gradient, static', () => {
    const s = { ...GOOD, reduceEffects: true };
    expect(inkMode(s)).toBe('gradient');
    expect(inkGradientAnimated(s)).toBe(false);
  });

  it('low-quality device → gradient, still allowed to drift', () => {
    const s = { ...GOOD, lowQuality: true };
    expect(inkMode(s)).toBe('gradient');
    expect(inkGradientAnimated(s)).toBe(true);
  });

  it('no WebGL → gradient', () => {
    expect(inkMode({ ...GOOD, webgl: false })).toBe('gradient');
  });
});

describe('ink device classification (escalation: the iPhone misclassification fix)', () => {
  it('an iPhone in Safari is NOT low-end: no deviceMemory, core count clamped to 2 by WebKit', () => {
    // The exact signal pair every iPhone presents. The settings heuristic
    // (deviceMemory ≤ 3 || cores ≤ 3) reads this as 'low', which used to
    // send every iPhone to the gradient fallback — the engine never ran.
    expect(inkLowQuality({ deviceMemory: undefined, hardwareConcurrency: 2, userSetLow: false })).toBe(false);
  });

  it('absent signals are unknown, never weak', () => {
    expect(inkLowQuality({ userSetLow: false })).toBe(false);
    expect(inkLowQuality({ deviceMemory: undefined, hardwareConcurrency: undefined, userSetLow: false })).toBe(false);
  });

  it('core counts never classify a device low on their own (clamped where it matters)', () => {
    expect(inkLowQuality({ hardwareConcurrency: 1, userSetLow: false })).toBe(false);
    expect(inkLowQuality({ hardwareConcurrency: 2, userSetLow: false })).toBe(false);
    expect(inkLowQuality({ deviceMemory: 8, hardwareConcurrency: 2, userSetLow: false })).toBe(false);
  });

  it('a memory figure the browser actually reports at ≤2 GB is positive low-end evidence', () => {
    expect(inkLowQuality({ deviceMemory: 2, hardwareConcurrency: 8, userSetLow: false })).toBe(true);
    expect(inkLowQuality({ deviceMemory: 1, userSetLow: false })).toBe(true);
    expect(inkLowQuality({ deviceMemory: 4, hardwareConcurrency: 8, userSetLow: false })).toBe(false);
    expect(inkLowQuality({ deviceMemory: 8, hardwareConcurrency: 16, userSetLow: false })).toBe(false);
  });

  it('an explicit user pick of Low graphics is always honored', () => {
    expect(inkLowQuality({ deviceMemory: 8, hardwareConcurrency: 16, userSetLow: true })).toBe(true);
    expect(inkLowQuality({ userSetLow: true })).toBe(true);
  });

  it('InkLayer derives userSetLow by comparing the stored quality to a fresh heuristic read', () => {
    const layer = readFileSync(new URL('../src/ink/InkLayer.tsx', import.meta.url), 'utf8');
    expect(layer).toContain('inkLowQuality({');
    expect(layer).toContain("loadSettings().quality === 'low' && defaultQuality() === 'high'");
    expect(layer).not.toContain("return loadSettings().quality === 'low';");
  });
});

describe('splat math', () => {
  it('the color ramp runs violet → electric blue → cyan and clamps outside', () => {
    expect(inkColor(0)).toEqual([128 / 255, 84 / 255, 1]);
    expect(inkColor(0.55)).toEqual([38 / 255, 156 / 255, 1]);
    expect(inkColor(1)).toEqual([91 / 255, 223 / 255, 1]);
    expect(inkColor(-3)).toEqual(inkColor(0));
    expect(inkColor(7)).toEqual(inkColor(1));
    // the green channel rises the whole way (violet .33 → blue .61 → cyan .87)
    expect(inkColor(0.25)[1]).toBeGreaterThan(inkColor(0)[1]);
    expect(inkColor(0.8)[1]).toBeGreaterThan(inkColor(0.55)[1]);
  });

  it('a press is a bloom: wide, still, violet-leaning', () => {
    const s = pressSplat(0.4, 0.6);
    expect(s.x).toBe(0.4);
    expect(s.y).toBe(0.6);
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
    expect(s.radius).toBe(PRESS_RADIUS);
    expect(s.strength).toBe(PRESS_STRENGTH);
    expect([s.r, s.g, s.b]).toEqual(inkColor(0.15));
  });

  it('a drag imparts velocity along its direction, scaled by speed', () => {
    // 0.12 field-units in 0.1 s → speed 1.2 (t = 0.5)
    const s = dragSplat(0, 0, 0.12, 0, 0.1)!;
    expect(s).not.toBeNull();
    expect(s.strength).toBeCloseTo(0.45 + 0.55 * 0.5);
    expect(s.vx).toBeCloseTo(1.2 * SPLAT_PULL);
    expect(s.vy).toBeCloseTo(0);
    expect(s.x).toBe(0.12);
    // diagonal drags keep the direction, not the raw deltas
    const d = dragSplat(0, 0, 0.06, 0.08, 0.1)!; // dist 0.1, speed 1
    expect(Math.hypot(d.vx, d.vy)).toBeCloseTo(1 * SPLAT_PULL);
    expect(d.vx / d.vy).toBeCloseTo(0.06 / 0.08);
  });

  it('faster drags are stronger, wider, more cyan — and everything caps', () => {
    const slow = dragSplat(0, 0, 0.02, 0, 0.1)!;
    const fast = dragSplat(0, 0, 0.2, 0, 0.1)!;
    const wild = dragSplat(0, 0, 40, 0, 0.1)!;
    expect(fast.strength).toBeGreaterThan(slow.strength);
    expect(fast.radius).toBeGreaterThan(slow.radius);
    expect(fast.g).toBeGreaterThan(slow.g);
    expect(wild.strength).toBe(1);
    expect(wild.radius).toBe(DRAG_MAX_RADIUS);
    expect(Math.hypot(wild.vx, wild.vy)).toBeCloseTo(SPLAT_MAX_SPEED * SPLAT_PULL);
    expect([wild.r, wild.g, wild.b]).toEqual(inkColor(1));
    expect(slow.radius).toBeGreaterThanOrEqual(DRAG_MIN_RADIUS);
  });

  it('a stationary drag deposits the minimum and imparts no velocity', () => {
    const s = dragSplat(0.3, 0.3, 0.3, 0.3, 0.016)!;
    expect(s.strength).toBeCloseTo(0.45);
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
    expect(s.radius).toBe(DRAG_MIN_RADIUS);
  });

  it('unusable timing deposits nothing', () => {
    expect(dragSplat(0, 0, 0.1, 0, 0)).toBeNull();
    expect(dragSplat(0, 0, 0.1, 0, 0.5)).toBeNull();
    expect(dragSplat(0, 0, 0.1, 0, Number.NaN)).toBeNull();
  });

  it('decay is exponential: dye lingers, velocity settles first', () => {
    const dye = decayFactor(DYE_DECAY_RATE, 1 / 60);
    expect(dye).toBeGreaterThan(0.99);
    expect(dye).toBeLessThan(0.998);
    expect(dye).toBeCloseTo(Math.exp(-DYE_DECAY_RATE / 60));
    expect(decayFactor(VEL_DECAY_RATE, 1 / 60)).toBeLessThan(dye);
    expect(decayFactor(DYE_DECAY_RATE, 0)).toBe(1);
    expect(decayFactor(0, 1)).toBe(1);
    expect(decayFactor(DYE_DECAY_RATE, 2)).toBeLessThan(decayFactor(DYE_DECAY_RATE, 1));
  });

  it('escalation levels: the engine is turned UP, not whispering (owner-directed values)', () => {
    // P2 shipped a whisper (press .6/.085, ambient .13, dye decay .5/s,
    // pull .38) and the owner read it as "a nice gradient". These floors
    // pin the escalation so a future "perf tidy-up" can't quietly revert
    // the feel; changing them is a design decision, not a refactor.
    expect(PRESS_STRENGTH).toBeGreaterThanOrEqual(0.85);
    expect(PRESS_RADIUS).toBeGreaterThanOrEqual(0.13);
    expect(SPLAT_PULL).toBeGreaterThanOrEqual(0.55);
    expect(AMBIENT_STRENGTH).toBeGreaterThanOrEqual(0.3);
    expect(AMBIENT_MIN_RADIUS).toBeGreaterThanOrEqual(0.22);
    expect(AMBIENT_MAX_RADIUS).toBeGreaterThanOrEqual(0.45);
    expect(DYE_DECAY_RATE).toBeLessThanOrEqual(0.22);
    expect(VEL_DECAY_RATE).toBeLessThanOrEqual(0.9);
    const engine = readFileSync(new URL('../src/ink/engine.ts', import.meta.url), 'utf8');
    expect(engine).toContain('const FLOW_AMP = 0.11');
    expect(engine).toContain('col += dye * 1.3;');
    expect(engine).toContain('(e * e) * 0.7');
    // ambient cadence ~1.0–1.9 s (was 2.6–4.5 s): the field never sits still
    expect(engine).toContain('this.nextAmbient = now + 1000 + Math.random() * 900;');
  });

  it('segment stamping lays a continuous, capped trail that ends on the pointer', () => {
    const out: InkSplat[] = [];
    const n = segmentSplats(0, 0, 0.3, 0, 0.05, out);
    expect(n).toBeGreaterThan(1);
    expect(n).toBeLessThanOrEqual(12);
    expect(out[n - 1]!.x).toBeCloseTo(0.3);
    for (let i = 1; i < n; i++) expect(out[i]!.x).toBeGreaterThan(out[i - 1]!.x);
    // a zero-length step still stamps once, on the spot
    const m = segmentSplats(0.5, 0.5, 0.5, 0.5, 0.016, out);
    expect(m).toBe(1);
    expect(out[0]!.x).toBe(0.5);
    // bad timing → no stamps
    expect(segmentSplats(0, 0, 0.3, 0, 0, out)).toBe(0);
  });
});

describe('quality governor', () => {
  it('healthy frames never step down', () => {
    const g = createGovernor();
    for (let i = 0; i < 300; i++) expect(governorFrame(g, 16.7)).toBe('keep');
    expect(g.level).toBe(0);
    expect(g.dead).toBe(false);
  });

  it('sustained slow frames step down rung by rung, then give up to the fallback', () => {
    const g = createGovernor();
    const actions: string[] = [];
    for (let i = 0; i < 4000 && !g.dead; i++) actions.push(governorFrame(g, 40));
    expect(g.dead).toBe(true);
    expect(actions.filter((a) => a === 'step')).toHaveLength(SIM_WIDTHS.length - 1);
    expect(actions[actions.length - 1]).toBe('fallback');
    // sticky: a dead governor stays dead
    expect(governorFrame(g, 40)).toBe('fallback');
    expect(governorFrame(g, 16.7)).toBe('fallback');
  });

  it('a single stall frame is ignored, not averaged in', () => {
    const g = createGovernor();
    for (let i = 0; i < 60; i++) governorFrame(g, 16.7);
    expect(governorFrame(g, 900)).toBe('keep');
    expect(g.emaMs).toBeLessThan(20);
    expect(g.level).toBe(0);
  });

  it('sim sizes preserve aspect with the level budget on the long edge', () => {
    expect(simSizeFor(0, 16 / 9)).toEqual({ w: 256, h: 144 });
    expect(simSizeFor(0, 0.5)).toEqual({ w: 128, h: 256 });
    expect(simSizeFor(0, 1)).toEqual({ w: 256, h: 256 });
    expect(simSizeFor(3, 16 / 9)).toEqual({ w: 128, h: 72 });
    expect(simSizeFor(99, 1)).toEqual({ w: 128, h: 128 }); // level clamps
    expect(simSizeFor(0, Number.NaN)).toEqual({ w: 256, h: 256 });
  });
});

describe('ink source pins', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const inkFiles = ['mode.ts', 'splat.ts', 'governor.ts', 'engine.ts', 'InkLayer.tsx'].map((f) =>
    read(`../src/ink/${f}`),
  );

  it('main.tsx mounts the layer once, at the root', () => {
    const main = read('../src/main.tsx');
    expect(main).toContain("import InkLayer from './ink/InkLayer'");
    expect(main).toContain('<InkLayer />');
  });

  it('the layer is behind everything and can never be touched', () => {
    const css = read('../src/styles.css');
    const m = /\.ink-canvas, \.ink-fallback \{([^}]*)\}/.exec(css);
    expect(m).not.toBeNull();
    expect(m![1]).toContain('position: fixed');
    expect(m![1]).toContain('z-index: -1');
    expect(m![1]).toContain('pointer-events: none');
    expect(css).toContain('@keyframes ink-drift');
    expect(css).toContain('html[data-theme="neon"] body { background: transparent; }');
  });

  it('pointer observation is passive-only, coalesced, and never prevents default', () => {
    const layer = inkFiles[4]!;
    expect(layer.match(/\{ passive: true \}/g)?.length).toBeGreaterThanOrEqual(4);
    expect(layer).toContain('getCoalescedEvents');
    for (const src of inkFiles) expect(src).not.toContain('preventDefault');
  });

  it('the unmount keys off the existing in-game signal, and Classic renders nothing', () => {
    const layer = inkFiles[4]!;
    expect(layer).toContain("'bwm-in-game'");
    expect(layer).toContain('MutationObserver');
    expect(layer).toContain('inkMode(gates)');
    expect(layer).toContain("if (mode === 'none') return null;");
  });

  it('the engine is honestly labeled and releases its context on teardown', () => {
    const engine = inkFiles[3]!;
    expect(engine).toContain('dye advection');
    expect(engine).toContain('NOT a Navier');
    expect(engine).toContain('loseContext');
    expect(engine).toContain('visibilitychange');
    expect(engine).toContain('WEBGL_lose_context');
  });
});
