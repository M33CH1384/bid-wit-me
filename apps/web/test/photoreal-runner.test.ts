/**
 * Photoreal lifecycle runner (crash hardening, 2026-11-06): every exit
 * path of an overlay effect is contained. The brief's named scenarios:
 * createFx throws, render throws, the player leaves while the module
 * loads, the player leaves while it plays, rapid retrigger, overlapping
 * effects, and a delayed skip listener firing after the effect stopped.
 */
import { describe, expect, it, vi } from 'vitest';
import { createFxRunner, prepareFxInstance, type FxRunnerDeps, type FxPlayRequest } from '../src/photoreal/runner';
import type { PhotorealFxInstance } from '../src/photoreal/modules/modules';

interface Harness {
  deps: FxRunnerDeps;
  reports: { stage: string; err: unknown }[];
  mount: { isConnected: boolean; appended: unknown[]; appendChild: (c: unknown) => void };
  canvases: { remove: ReturnType<typeof vi.fn> }[];
  bumpEpoch: () => void;
  stepFrame: (now: number) => void;
  advanceTimers: (ms: number) => void;
  skipListeners: Set<() => void>;
  pendingRafs: () => number;
}

function harness(loadImpl: FxRunnerDeps['load']): Harness {
  const reports: Harness['reports'] = [];
  const canvases: Harness['canvases'] = [];
  const skipListeners = new Set<() => void>();
  let epoch = 0;
  let rafSeq = 0;
  const rafs = new Map<number, (now: number) => void>();
  let timerSeq = 0;
  let clock = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const mount = {
    isConnected: true,
    appended: [] as unknown[],
    appendChild(c: unknown) { mount.appended.push(c); },
  };
  const deps: FxRunnerDeps = {
    load: loadImpl,
    createCanvas: () => {
      const c = { remove: vi.fn(), style: {}, dataset: {}, className: '', width: 0, height: 0 };
      canvases.push(c);
      return c as unknown as HTMLCanvasElement;
    },
    raf: (fn) => { const id = ++rafSeq; rafs.set(id, fn); return id; },
    cancelRaf: (id) => { rafs.delete(id); },
    setTimeout: (fn, ms) => { const id = ++timerSeq; timers.set(id, { at: clock + ms, fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    addSkipListener: (fn) => { skipListeners.add(fn); },
    removeSkipListener: (fn) => { skipListeners.delete(fn); },
    report: (stage, err) => { reports.push({ stage, err }); },
    epoch: () => epoch,
    advance: (t, last, now) => ({ t: last === null ? t : t + (now - last) / 1000, last: now }),
  };
  return {
    deps, reports, mount: mount as unknown as Harness['mount'], canvases, skipListeners,
    bumpEpoch: () => { epoch++; },
    stepFrame: (now) => { const fns = [...rafs.values()]; rafs.clear(); for (const fn of fns) fn(now); },
    advanceTimers: (ms) => {
      clock += ms;
      for (const [id, t] of [...timers]) if (t.at <= clock) { timers.delete(id); t.fn(); }
    },
    pendingRafs: () => rafs.size,
  };
}

function inst(duration = 2, renderImpl?: (t: number) => void): PhotorealFxInstance {
  return { duration, render: renderImpl ?? vi.fn(), play: () => () => {} };
}

function req(h: Harness, over: Partial<FxPlayRequest> = {}): FxPlayRequest {
  return {
    mount: h.mount as unknown as HTMLElement,
    opts: { seed: 1 },
    styleCanvas: () => {},
    ...over,
  };
}

const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('photoreal runner failure containment', () => {
  it('createFx throws: reported, no canvas attached, nothing runs', async () => {
    const h = harness(async () => ({ createFx: () => { throw new Error('boom-create'); } }));
    const r = createFxRunner(h.deps);
    r.play(req(h));
    await tick();
    expect(h.reports.map((x) => x.stage)).toEqual(['create']);
    expect(h.mount.appended).toHaveLength(0);
    expect(r.isRunning()).toBe(false);
    expect(h.pendingRafs()).toBe(0);
  });

  it('module load fails: reported as load, nothing starts', async () => {
    const h = harness(async () => { throw new Error('chunk gone'); });
    const r = createFxRunner(h.deps);
    r.play(req(h));
    await tick();
    expect(h.reports.map((x) => x.stage)).toEqual(['load']);
    expect(h.mount.appended).toHaveLength(0);
    expect(r.isRunning()).toBe(false);
  });

  it('render throws mid-effect: reported once, overlay removed, owner reset, loop dead', async () => {
    let calls = 0;
    const bad = inst(30, () => { calls++; if (calls === 2) throw new Error('boom-render'); });
    const h = harness(async () => ({ createFx: () => bad }));
    const onStop = vi.fn();
    const r = createFxRunner(h.deps);
    r.play(req(h, { onStop }));
    await tick();
    expect(r.isRunning()).toBe(true);
    h.stepFrame(0);
    h.stepFrame(16);
    expect(h.reports.map((x) => x.stage)).toEqual(['render']);
    expect(h.canvases[0].remove).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(r.isRunning()).toBe(false);
    h.stepFrame(32);
    expect(calls).toBe(2); // no further frames after the throw
    r.stop();
    expect(onStop).toHaveBeenCalledTimes(1); // stop stays idempotent
  });

  it('player leaves while the module is loading: the late load starts nothing', async () => {
    let resolveLoad: ((m: { createFx: () => PhotorealFxInstance }) => void) | null = null;
    const createFx = vi.fn(() => inst());
    const h = harness(() => new Promise((res) => { resolveLoad = res; }));
    const r = createFxRunner(h.deps);
    r.play(req(h));
    h.bumpEpoch(); // the owning screen unmounted mid-load
    resolveLoad!({ createFx });
    await tick();
    expect(createFx).not.toHaveBeenCalled();
    expect(h.mount.appended).toHaveLength(0);
    expect(h.reports).toHaveLength(0); // a cancellation is not a failure
    expect(r.isRunning()).toBe(false);
  });

  it('mount disconnected when the load resolves: nothing starts', async () => {
    const h = harness(async () => ({ createFx: () => inst() }));
    const r = createFxRunner(h.deps);
    r.play(req(h));
    (h.mount as { isConnected: boolean }).isConnected = false;
    await tick();
    expect(h.mount.appended).toHaveLength(0);
    expect(r.isRunning()).toBe(false);
  });

  it('player leaves while playing: stop cleans the overlay, timers and listener', async () => {
    const h = harness(async () => ({ createFx: () => inst(30) }));
    const onStop = vi.fn();
    const r = createFxRunner(h.deps);
    r.play(req(h, { onStop, skipDelayMs: 400 }));
    await tick();
    h.advanceTimers(400); // skip listener arms
    expect(h.skipListeners.size).toBe(1);
    r.stop(); // the host's unmount path
    expect(h.canvases[0].remove).toHaveBeenCalledTimes(1);
    expect(h.skipListeners.size).toBe(0);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(h.pendingRafs()).toBe(0);
  });

  it('rapid retrigger: the superseded load never starts; the latest play wins', async () => {
    const resolvers: ((m: { createFx: () => PhotorealFxInstance }) => void)[] = [];
    const h = harness(() => new Promise((res) => { resolvers.push(res); }));
    const createFxA = vi.fn(() => inst(30));
    const createFxB = vi.fn(() => inst(30));
    const r = createFxRunner(h.deps);
    r.play(req(h));
    r.play(req(h));
    resolvers[1]({ createFx: createFxB }); // newest resolves first
    await tick();
    resolvers[0]({ createFx: createFxA }); // stale load resolves late
    await tick();
    expect(createFxB).toHaveBeenCalledTimes(1);
    expect(createFxA).not.toHaveBeenCalled();
    expect(h.mount.appended).toHaveLength(1);
    expect(r.isRunning()).toBe(true);
  });

  it('delayed skip listener firing after the effect stopped is a no-op', async () => {
    const h = harness(async () => ({ createFx: () => inst(0.05) }));
    const onStop = vi.fn();
    const r = createFxRunner(h.deps);
    r.play(req(h, { onStop, skipDelayMs: 10 }));
    await tick();
    h.advanceTimers(10); // listener arms
    const [staleSkip] = [...h.skipListeners];
    h.stepFrame(0);
    h.stepFrame(100); // T passes duration -> natural stop disarms the listener
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(h.skipListeners.size).toBe(0);
    staleSkip(); // a queued dispatch racing the removal must not double-reset
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(h.canvases[0].remove).toHaveBeenCalledTimes(1);
  });

  it('an effect stopped before its skip delay never arms a listener', async () => {
    const h = harness(async () => ({ createFx: () => inst(30) }));
    const r = createFxRunner(h.deps);
    r.play(req(h, { skipDelayMs: 400 }));
    await tick();
    r.stop();
    h.advanceTimers(1000);
    expect(h.skipListeners.size).toBe(0);
  });

  it('backstop stops a stalled effect', async () => {
    const h = harness(async () => ({ createFx: () => inst(2) }));
    const onStop = vi.fn();
    const r = createFxRunner(h.deps);
    r.play(req(h, { onStop }));
    await tick();
    h.advanceTimers(2000 + 6000); // duration + backstop slack, no frames stepped
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(r.isRunning()).toBe(false);
  });

  it('overlapping effects are independent: one render failure does not touch the other', async () => {
    const bad = inst(30, () => { throw new Error('only this one'); });
    const good = inst(30);
    const h1 = harness(async () => ({ createFx: () => bad }));
    const h2 = harness(async () => ({ createFx: () => good }));
    const r1 = createFxRunner(h1.deps);
    const r2 = createFxRunner(h2.deps);
    const stop2 = vi.fn();
    r1.play(req(h1));
    r2.play(req(h2, { onStop: stop2 }));
    await tick();
    h1.stepFrame(0);
    expect(r1.isRunning()).toBe(false);
    expect(r2.isRunning()).toBe(true);
    expect(stop2).not.toHaveBeenCalled();
    h2.stepFrame(0);
    expect(good.render).toHaveBeenCalled();
  });

  it('pinned capture: exactly one frame, no timers, no skip listener', async () => {
    const fx = inst(4);
    const h = harness(async () => ({ createFx: () => fx }));
    const r = createFxRunner(h.deps);
    r.play(req(h, { pinnedAt: 1.5, skipDelayMs: 10 }));
    await tick();
    h.stepFrame(0);
    expect(fx.render).toHaveBeenCalledTimes(1);
    expect(fx.render).toHaveBeenCalledWith(1.5);
    h.advanceTimers(10000);
    expect(h.skipListeners.size).toBe(0);
    expect(r.isRunning()).toBe(true); // stays up until the owner stops it
    r.stop();
    expect(r.isRunning()).toBe(false);
  });
});

describe('prepareFxInstance + adoption', () => {
  it('prepares off-DOM and play adopts it synchronously without loading', async () => {
    const fx = inst(30);
    const load = vi.fn(async () => ({ createFx: () => fx }));
    const h = harness(load);
    const prepared = await prepareFxInstance(h.deps, () => {}, { seed: 7 });
    expect(prepared).not.toBeNull();
    expect(h.mount.appended).toHaveLength(0); // built off-DOM
    load.mockClear();
    const r = createFxRunner(h.deps);
    r.play(req(h, { prepared }));
    expect(load).not.toHaveBeenCalled(); // adoption skipped the load entirely
    expect(h.mount.appended).toHaveLength(1);
    expect(r.isRunning()).toBe(true);
    h.stepFrame(0);
    expect(fx.render).toHaveBeenCalled();
  });

  it('prepare failure reports prepare and yields null', async () => {
    const h = harness(async () => ({ createFx: () => { throw new Error('prep boom'); } }));
    const prepared = await prepareFxInstance(h.deps, () => {}, { seed: 1 });
    expect(prepared).toBeNull();
    expect(h.reports.map((x) => x.stage)).toEqual(['prepare']);
  });

  it('prepare abandoned by navigation builds nothing', async () => {
    let resolveLoad: ((m: { createFx: () => PhotorealFxInstance }) => void) | null = null;
    const createFx = vi.fn(() => inst());
    const h = harness(() => new Promise((res) => { resolveLoad = res; }));
    const p = prepareFxInstance(h.deps, () => {}, { seed: 1 });
    h.bumpEpoch();
    resolveLoad!({ createFx });
    await expect(p).resolves.toBeNull();
    expect(createFx).not.toHaveBeenCalled();
  });
});
