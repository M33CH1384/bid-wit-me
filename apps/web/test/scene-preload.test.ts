/**
 * loadScene's memo discipline (owner, 2026-10-22: "the game is
 * repeatedly crashing" on a client stranded by the evening's deploys).
 *
 * loadScene feeds Table's lazy(Scene): it used to memoize a plain
 * import('./Scene') — rejection included — so a deploy-deleted Scene
 * chunk failed once and then re-threw the SAME rejection at every
 * table mount until a manual reload. Now the import runs through
 * importChunk (the loop-guarded one-time heal reload), and a failure
 * clears the memo so the next call asks again. importChunk itself is
 * stubbed here; its retry/reload behavior is pinned in
 * chunk-load.test.ts. The Scene module is never really loaded.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stub = vi.hoisted(() => ({ calls: 0, fail: true }));

vi.mock('../src/chunkLoad', () => ({
  importChunk: async (load: () => Promise<unknown>) => {
    stub.calls += 1;
    if (stub.fail) throw new TypeError('Failed to fetch dynamically imported module: https://bid-wit-me.pages.dev/assets/Scene-OLD.js');
    return load();
  },
}));

vi.mock('../src/three/Scene', () => ({ preloadTableAssets: () => {}, isSceneMock: true }));

beforeEach(() => {
  vi.resetModules();
  stub.calls = 0;
  stub.fail = true;
});

describe('loadScene', () => {
  it('a failed Scene import is NOT memoized — the next mount asks again', async () => {
    const { loadScene } = await import('../src/three/preload');
    await expect(loadScene()).rejects.toThrow(/Scene-OLD/);
    expect(stub.calls).toBe(1);
    // The old code returned the same rejected promise forever here.
    await expect(loadScene()).rejects.toThrow(/Scene-OLD/);
    expect(stub.calls).toBe(2);
    // And once the chunk resolves (the healed build), it lands.
    stub.fail = false;
    const mod = await loadScene();
    expect((mod as { isSceneMock?: boolean }).isSceneMock).toBe(true);
    expect(stub.calls).toBe(3);
  });

  it('a successful Scene import IS memoized — one fetch per page session', async () => {
    stub.fail = false;
    const { loadScene } = await import('../src/three/preload');
    const first = await loadScene();
    const second = await loadScene();
    expect(first).toBe(second);
    expect(stub.calls).toBe(1);
  });
});
