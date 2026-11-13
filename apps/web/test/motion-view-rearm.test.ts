/**
 * Owner, 2026-11-13: "The motion view setting only ever works if I toggle it off then on."
 *
 * iOS grants motion access per page session and only from inside a tap. The Settings switch asked
 * when it was turned on, but a saved ON came back at the next launch with nobody having asked, so
 * the sensor stayed silent. While the option is on, the first tap of a session now asks.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOTION_TAP_EVENTS, armMotionSensorsOnTap, enableMotionSensors, motionNeedsTap, __resetMotionViewStore, type MotionEventTargetLike } from '../src/motionView';

class FakeTarget implements MotionEventTargetLike {
  fns = new Map<string, Set<(e: never) => void>>();
  addEventListener(type: string, fn: (e: never) => void) { (this.fns.get(type) ?? this.fns.set(type, new Set()).get(type)!).add(fn); }
  removeEventListener(type: string, fn: (e: never) => void) { this.fns.get(type)?.delete(fn); }
  fire(type: string, e: unknown = {}) { for (const fn of [...(this.fns.get(type) ?? [])]) fn(e as never); }
  count(type: string) { return this.fns.get(type)?.size ?? 0; }
}
const iosCtor = (answer: string) => { const c = { calls: 0, requestPermission() { c.calls++; return Promise.resolve(answer); } }; return c; };
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { __resetMotionViewStore(); });
afterEach(() => { __resetMotionViewStore(); });

describe('motion view asks again after a relaunch', () => {
  it('a platform with a permission step needs a tap until this session has asked', () => {
    expect(motionNeedsTap(iosCtor('granted'))).toBe(true);
    expect(motionNeedsTap({})).toBe(false); // Android / desktop: nothing to ask
    expect(motionNeedsTap(null)).toBe(false);
  });

  it('the first tap asks, synchronously inside the tap, exactly once', async () => {
    const t = new FakeTarget(); const ctor = iosCtor('granted');
    armMotionSensorsOnTap(t, { orientationCtor: ctor, target: t });
    for (const type of MOTION_TAP_EVENTS) expect(t.count(type)).toBe(1);
    expect(ctor.calls).toBe(0); // nothing before a tap: iOS would refuse it
    t.fire('touchend');
    expect(ctor.calls).toBe(1); // asked before the handler returned
    for (const type of MOTION_TAP_EVENTS) expect(t.count(type)).toBe(0);
    t.fire('click');
    await tick();
    expect(ctor.calls).toBe(1);
    expect(motionNeedsTap(ctor)).toBe(false);
  });

  it('a refusal is not asked again this session', async () => {
    const t = new FakeTarget(); const ctor = iosCtor('denied');
    armMotionSensorsOnTap(t, { orientationCtor: ctor, target: t });
    t.fire('click');
    await tick();
    armMotionSensorsOnTap(t, { orientationCtor: ctor, target: t });
    t.fire('click');
    expect(ctor.calls).toBe(1);
  });

  it('no permission step, no listener', () => {
    const t = new FakeTarget();
    armMotionSensorsOnTap(t, { orientationCtor: {}, target: t });
    for (const type of MOTION_TAP_EVENTS) expect(t.count(type)).toBe(0);
  });

  it('disarming (option turned off, table left) removes the listeners', () => {
    const t = new FakeTarget(); const ctor = iosCtor('granted');
    const off = armMotionSensorsOnTap(t, { orientationCtor: ctor, target: t });
    off();
    t.fire('touchend');
    expect(ctor.calls).toBe(0);
  });

  it('turning it on in Settings counts as this session’s ask', async () => {
    const t = new FakeTarget(); const ctor = iosCtor('granted');
    const p = enableMotionSensors({ orientationCtor: ctor, target: t }, 20);
    await tick();
    t.fire('deviceorientation', { beta: 40, gamma: 0 });
    await expect(p).resolves.toBe('granted');
    expect(motionNeedsTap(ctor)).toBe(false);
  });

  it('the table arms it whenever the saved option is on', () => {
    const src = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(src).toContain('useEffect(() => (settings.motionView === true ? armMotionSensorsOnTap() : undefined), [settings.motionView]);');
  });
});
