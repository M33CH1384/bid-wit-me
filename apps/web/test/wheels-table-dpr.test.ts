import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The Wheels car IN THE TABLE SCENE read soft on the owner's DPR-3
// phone for the same reason the results stage did (round 3,
// e5bf6bdd): the table Canvas backs at the load ramp's 1.75 ceiling —
// govCaps = applyCaps(1.75, governor level), and the governor only
// trims below — so on a DPR-3 display every table frame, the car
// included, is upscaled ~1.71x by the compositor (worse under a
// governor trim: x2 / x2.4 / x3 at levels 1-3). The owner picked
// "Chase the in-table car too" (2026-11-08). The fix is a
// MOMENT-SCOPED lift: while the 3D car's show is presenting, the
// canvas DPR ceiling rises to native (cap 3, R3F clamps to the
// device) and the governor's DPR caps do not bind; the instant the
// show ends, the ramp + governor path owns the DPR again, byte-for-
// byte the pre-change behaviour. The lift keys off the car rig's own
// show state (engage on show start, release in the effect cleanup —
// which also fires on skip and on unmount/teardown), never a timer,
// so it cannot strand the renderer at DPR 3. Lane record:
// ~/workspace/_wheels-table-dpr-work/NOTES.md.

describe('wheels table DPR lift — cap composition (pure)', () => {
  it('the lift cap reaches a DPR-3 phone', async () => {
    const m = await import('../src/three/wheelsDprLift');
    expect(m.WHEELS_DPR_LIFT_CAP).toBe(3);
  });

  it('outside the moment, the ramp/governor cap passes through untouched', async () => {
    const { effectiveCanvasDprCap } = await import('../src/three/wheelsDprLift');
    // ramp ceiling, healthy governor
    expect(effectiveCanvasDprCap(1.75, false)).toBe(1.75);
    // governor trims (levels 1-3)
    expect(effectiveCanvasDprCap(1.5, false)).toBe(1.5);
    expect(effectiveCanvasDprCap(1.25, false)).toBe(1.25);
    expect(effectiveCanvasDprCap(1.0, false)).toBe(1.0);
    // ramp not yet stepped (load)
    expect(effectiveCanvasDprCap(1, false)).toBe(1);
  });

  it('during the moment, the lift wins over every governor trim', async () => {
    const { effectiveCanvasDprCap } = await import('../src/three/wheelsDprLift');
    for (const gov of [1.75, 1.5, 1.25, 1.0]) {
      expect(effectiveCanvasDprCap(gov, true)).toBe(3);
    }
  });

  it('the lift module carries no timer that could strand it high', async () => {
    const src = readFileSync(new URL('../src/three/wheelsDprLift.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('setTimeout');
    expect(src).not.toContain('setInterval');
  });
});

describe('wheels table DPR lift — Scene wiring', () => {
  const scene = () => readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');

  it('the table Canvas composes its dpr ceiling through the lift helper', () => {
    const src = scene();
    expect(src).toContain("from './wheelsDprLift'");
    expect(src).toContain('dpr={hi ? [1, effectiveCanvasDprCap(govCaps.dpr, wheelsShow)] : 1}');
    expect(src).not.toContain('dpr={hi ? [1, govCaps.dpr] : 1}');
  });

  it('the ramp + governor path itself is untouched (governor still owns shadows and the base caps)', () => {
    const src = scene();
    expect(src).toContain('const govCaps = applyCaps(dprCap, shadowSize, govLevel);');
    expect(src).toContain("shadows={govCaps.shadow > 0 ? 'soft' : false}");
  });

  it('Scene feeds AfterTable the show callback and AfterTable hands it to the car', () => {
    const src = scene();
    expect(src).toContain('onWheelsShow={onWheelsShow}');
    expect(src).toContain('<wheels.default quality={quality} onShowChange={onWheelsShow} />');
  });
});

describe('wheels table DPR lift — the rig engages and releases it', () => {
  const rig = () => readFileSync(new URL('../src/three/WheelsCar3D.tsx', import.meta.url), 'utf8');

  it('the show state drives the callback: engage on show, release in the effect cleanup', () => {
    const src = rig();
    expect(src).toContain('onShowChange?.(true)');
    // the cleanup is the release: it fires on show end, on skip
    // (setShow(null)) and on unmount (quality flip, remount, teardown)
    expect(src).toContain('return () => { onShowChange?.(false); };');
    expect(src).toContain('}, [show, onShowChange]);');
  });

  it('the default export threads the callback into the rig', () => {
    const src = rig();
    expect(src).toContain('<WheelsCarRig onShowChange={onShowChange} />');
  });
});
