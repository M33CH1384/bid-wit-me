import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CHUNK_RELOAD_KEY, cacheBust, chunkUrlFromError, importChunk, isChunkLoadError } from '../src/chunkLoad';

const TORNADO = 'https://bid-wit-me.pages.dev/assets/Tornado3D-OLD.js';
const NUKE = 'https://bid-wit-me.pages.dev/assets/Nuke3D-OLD.js';

function memory() {
  const box = new Map<string, string>();
  return {
    getItem: (k: string) => box.get(k) ?? null,
    setItem: (k: string, v: string) => { box.set(k, v); },
    removeItem: (k: string) => { box.delete(k); },
  };
}

function fail(url: string): TypeError {
  return new TypeError(`Failed to fetch dynamically imported module: ${url}`);
}

describe('chunk load after a deploy', () => {
  it('reads the missing chunk url out of the browser error', () => {
    expect(chunkUrlFromError(fail(TORNADO))).toBe(TORNADO);
    expect(chunkUrlFromError(fail(NUKE))).toBe(NUKE);
    expect(chunkUrlFromError(new TypeError('error loading dynamically imported module: /assets/Nuke3D-OLD.js'))).toBe('/assets/Nuke3D-OLD.js');
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Expected a JavaScript module script but the server responded with a MIME type of "text/html".'))).toBe(true);
    expect(isChunkLoadError(new Error('render blew up'))).toBe(false);
    expect(cacheBust(TORNADO, 1)).toBe(`${TORNADO}?bwm-retry=1`);
    expect(cacheBust('/assets/Tornado3D-OLD.js', 2)).toBe('/assets/Tornado3D-OLD.js?bwm-retry=2');
  });

  it('retries a failed Tornado import twice with a cache-busting query', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = memory();
    const load = vi.fn(async () => { throw fail(TORNADO); });
    const importUrl = vi.fn(async (url: string) => {
      if (url.endsWith('bwm-retry=1')) throw fail(url);
      return { Tornado3D: true };
    });
    const reload = vi.fn();
    const mod = await importChunk(load, { importUrl, reload, storage });
    expect(mod).toEqual({ Tornado3D: true });
    expect(load).toHaveBeenCalledTimes(1);
    expect(importUrl.mock.calls.map((c) => c[0])).toEqual([
      `${TORNADO}?bwm-retry=1`,
      `${TORNADO}?bwm-retry=2`,
    ]);
    expect(reload).not.toHaveBeenCalled();
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reloads once when the Nuke chunk is still missing, and not again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = memory();
    const load = vi.fn(async () => { throw fail(NUKE); });
    const importUrl = vi.fn(async (url: string) => { throw fail(url); });
    const reload = vi.fn();
    await expect(importChunk(load, { importUrl, reload, storage })).rejects.toThrow(/Nuke3D-OLD/);
    expect(importUrl).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBe('1');

    await expect(importChunk(load, { importUrl, reload, storage })).rejects.toThrow(/Nuke3D-OLD/);
    expect(reload).toHaveBeenCalledTimes(1);

    await importChunk(async () => ({ Tornado3D: true }), { reload, storage });
    await expect(importChunk(load, { importUrl, reload, storage })).rejects.toThrow(/Nuke3D-OLD/);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBe('1');
    warn.mockRestore();
  });

  it('reloads once when the browser hides the chunk url', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = memory();
    const importUrl = vi.fn();
    const reload = vi.fn();
    const load = async () => { throw new TypeError('Importing a module script failed.'); };
    await expect(importChunk(load, { importUrl, reload, storage })).rejects.toThrow(/module script failed/);
    expect(importUrl).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('sends the nuke and tornado imports through that retry', () => {
    const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
    const warm = readFileSync(new URL('../src/effects/warm.ts', import.meta.url), 'utf8');
    expect(scene).toContain("importChunk(() => import('./Nuke3D'))");
    expect(scene).toContain("importChunk(() => import('./Tornado3D'))");
    expect(warm).toContain("importChunk(() => import('../three/Tornado3D'))");
    expect(scene).not.toMatch(/void import\('\.\/(?:Nuke3D|Tornado3D)'\)/);
  });

  it('does not reload for an error that is not a missing chunk', async () => {
    const storage = memory();
    const reload = vi.fn();
    const load = async () => { throw new Error('shader compile failed'); };
    await expect(importChunk(load, { reload, storage })).rejects.toThrow(/shader compile failed/);
    expect(reload).not.toHaveBeenCalled();
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
  });
});
