/**
 * @vitest-environment happy-dom
 *
 * GPU warmup lifecycle (crash hardening, 2026-11-06). The pre-hardening
 * warmTableEffects cached ONE session-wide promise: leave a table (the
 * scene shell unmounts, the renderer is force-disposed) and return, and
 * the "warm" the new table waited on had compiled its shaders against
 * the DEAD renderer — the new context paid every compile mid-effect
 * anyway, and nothing ever re-warmed after a context restore either.
 * The warm is now keyed to the renderer + quality it actually warmed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spies = vi.hoisted(() => ({
  warmTornado: vi.fn(async () => {}),
  warmNuke: vi.fn(async () => {}),
}));

vi.mock('../src/three/Tornado3D', () => ({ warmTornado: spies.warmTornado }));
vi.mock('../src/three/Nuke3D', () => ({ warmNuke: spies.warmNuke }));
vi.mock('../src/sheetClothSim', () => ({ loadRipImage: async () => {}, warmSheet: async () => {} }));
vi.mock('../src/audio', () => ({ sound: { warmEffects: async () => {} } }));

// happy-dom never fires load/error for <img>, which would hang the DOM
// image warm forever; a fake that "loads" immediately keeps the pass
// honest (the image path still runs, it just settles). It must extend
// the real element class: the warm appends the image to a stash div,
// and a non-Node fake throws inside the warm's completion callback.
class FakeImage extends window.Image {
  constructor() {
    super();
    Object.defineProperty(this, 'src', {
      configurable: true,
      set: (_v: string) => { queueMicrotask(() => { this.onload?.(new Event('load')); }); },
    });
  }
  async decode(): Promise<void> {}
}
vi.stubGlobal('Image', FakeImage);

function fakeGl(lost = false) {
  return {
    getContext: () => ({ isContextLost: () => lost, flush: () => {} }),
    setRenderTarget: () => {},
    getRenderTarget: () => null,
    compileAsync: async () => {},
    render: () => {},
  };
}
const fakeCamera = {} as never;

async function freshWarm() {
  vi.resetModules();
  return import('../src/effects/warm');
}

beforeEach(() => {
  spies.warmTornado.mockClear();
  spies.warmNuke.mockClear();
});

describe('warmTableEffects is keyed to the renderer it warmed', () => {
  it('same renderer + quality: the completed warm is reused, compiles run once', async () => {
    const warm = await freshWarm();
    const gl = fakeGl();
    warm.offerTableRenderer(gl as never, fakeCamera, 'high');
    const a = warm.warmTableEffects();
    const b = warm.warmTableEffects();
    expect(b).toBe(a);
    await a;
    const c = warm.warmTableEffects();
    expect(c).toBe(a);
    expect(spies.warmTornado).toHaveBeenCalledTimes(1);
    expect(spies.warmNuke).toHaveBeenCalledTimes(1);
    expect(spies.warmTornado).toHaveBeenCalledWith(gl, fakeCamera, 'high');
  });

  it('a new renderer (leave and return) re-runs the warm against it', async () => {
    const warm = await freshWarm();
    const glA = fakeGl();
    const glB = fakeGl();
    warm.offerTableRenderer(glA as never, fakeCamera, 'high');
    await warm.warmTableEffects();
    expect(spies.warmTornado).toHaveBeenCalledTimes(1);
    warm.offerTableRenderer(glB as never, fakeCamera, 'high');
    await warm.warmTableEffects();
    expect(spies.warmTornado).toHaveBeenCalledTimes(2);
    expect(spies.warmTornado).toHaveBeenLastCalledWith(glB, fakeCamera, 'high');
  });

  it('a quality change on the same renderer re-runs the warm', async () => {
    const warm = await freshWarm();
    const gl = fakeGl();
    warm.offerTableRenderer(gl as never, fakeCamera, 'high');
    await warm.warmTableEffects();
    warm.offerTableRenderer(gl as never, fakeCamera, 'low');
    await warm.warmTableEffects();
    expect(spies.warmTornado).toHaveBeenCalledTimes(2);
    expect(spies.warmTornado).toHaveBeenLastCalledWith(gl, fakeCamera, 'low');
  });

  it('releaseTableRenderer drops the stale renderer: the next warm waits for, then uses, the new one', async () => {
    const warm = await freshWarm();
    const glA = fakeGl();
    const glB = fakeGl();
    warm.offerTableRenderer(glA as never, fakeCamera, 'high');
    await warm.warmTableEffects();
    warm.releaseTableRenderer(glA as never);
    // No renderer is offered now: a warm call must not resolve against thin air.
    let settled = false;
    const pending = warm.warmTableEffects().then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);
    warm.offerTableRenderer(glB as never, fakeCamera, 'high');
    await pending;
    expect(settled).toBe(true);
    expect(spies.warmTornado).toHaveBeenLastCalledWith(glB, fakeCamera, 'high');
  });

  it('releasing a renderer that is not the current one changes nothing', async () => {
    const warm = await freshWarm();
    const glA = fakeGl();
    const glB = fakeGl();
    warm.offerTableRenderer(glA as never, fakeCamera, 'high');
    const done = await warm.warmTableEffects();
    warm.releaseTableRenderer(glB as never); // some other scene's renderer
    expect(warm.warmTableEffects()).resolves.toBe(done);
    expect(spies.warmTornado).toHaveBeenCalledTimes(1);
  });

  it('invalidateTableWarm forces a fresh pass for the same renderer (context restore)', async () => {
    const warm = await freshWarm();
    const gl = fakeGl();
    warm.offerTableRenderer(gl as never, fakeCamera, 'high');
    await warm.warmTableEffects();
    warm.invalidateTableWarm();
    await warm.warmTableEffects();
    expect(spies.warmTornado).toHaveBeenCalledTimes(2);
  });

  it('a lost context is never compiled against: the pass reports timed-out instead of warming', async () => {
    const warm = await freshWarm();
    const gl = fakeGl(true);
    warm.offerTableRenderer(gl as never, fakeCamera, 'high');
    const times = await warm.warmTableEffects();
    expect(spies.warmTornado).not.toHaveBeenCalled();
    expect(spies.warmNuke).not.toHaveBeenCalled();
    expect(times.timedOut).toBe(true);
  });
});
