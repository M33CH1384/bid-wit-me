import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
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

  it('reloads once when the Nuke chunk is still missing, and not again for that build', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = memory();
    const load = vi.fn(async () => { throw fail(NUKE); });
    const importUrl = vi.fn(async (url: string) => { throw fail(url); });
    const reload = vi.fn();
    const hooks = { importUrl, reload, storage, buildId: 'build-a' };
    await expect(importChunk(load, hooks)).rejects.toThrow(/Nuke3D-OLD/);
    expect(importUrl).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBe('build-a');

    await expect(importChunk(load, hooks)).rejects.toThrow(/Nuke3D-OLD/);
    expect(reload).toHaveBeenCalledTimes(1);

    await importChunk(async () => ({ Tornado3D: true }), hooks);
    await expect(importChunk(load, hooks)).rejects.toThrow(/Nuke3D-OLD/);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBe('build-a');
    warn.mockRestore();
  });

  it('a later deploy heals again on the same tab (owner recurrence, 2026-10-23)', async () => {
    // The first heal implementation stored a bare '1' for the whole tab
    // session: a player who never closes the tab spent their one heal on
    // Monday's deploy and had none left for Tuesday's — every chunk the
    // new deploy deleted then threw into the route boundary instead of
    // healing. The flag now records WHICH build spent the heal.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = memory();
    const load = vi.fn(async () => { throw fail(NUKE); });
    const importUrl = vi.fn(async (url: string) => { throw fail(url); });
    const reload = vi.fn();
    // Monday: build-a spends its heal.
    await expect(importChunk(load, { importUrl, reload, storage, buildId: 'build-a' })).rejects.toThrow(/Nuke3D-OLD/);
    expect(reload).toHaveBeenCalledTimes(1);
    // Tuesday: build-b is running, a newer deploy deletes ITS chunks —
    // build-b has its own heal, even though the tab never closed.
    await expect(importChunk(load, { importUrl, reload, storage, buildId: 'build-b' })).rejects.toThrow(/Nuke3D-OLD/);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBe('build-b');
    // But build-b still gets exactly one: a second failure throws.
    await expect(importChunk(load, { importUrl, reload, storage, buildId: 'build-b' })).rejects.toThrow(/Nuke3D-OLD/);
    expect(reload).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("a legacy '1' flag (pre-sha builds) does not strand the tab: it heals once and records the sha", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = memory();
    storage.setItem(CHUNK_RELOAD_KEY, '1'); // written by a build from before the sha scoping
    const load = vi.fn(async () => { throw fail(NUKE); });
    const importUrl = vi.fn(async (url: string) => { throw fail(url); });
    const reload = vi.fn();
    await expect(importChunk(load, { importUrl, reload, storage, buildId: 'build-b' })).rejects.toThrow(/Nuke3D-OLD/);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBe('build-b');
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
    // Superseded in part (crash hardening, 2026-11-06): these effect
    // imports now also pass `{ optional: … }` (see the optional describe
    // below). The guarded-retry requirement this test was written for
    // (2026-10-22) is unchanged; the pinned strings name the new shape.
    const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
    const warm = readFileSync(new URL('../src/effects/warm.ts', import.meta.url), 'utf8');
    expect(scene).toContain("importChunk(() => import('./Nuke3D'), { optional:");
    expect(scene).toContain("importChunk(() => import('./Tornado3D'), { optional:");
    expect(warm).toContain("importChunk(() => import('../three/Tornado3D'), { optional:");
    expect(scene).not.toMatch(/void import\('\.\/(?:Nuke3D|Tornado3D)'\)/);
  });

  it('sends the Scene chunk and the sheet sim through that retry too (owner, 2026-10-22: repeated crashing)', () => {
    // The Scene chunk is the biggest in the app and Table's lazy() reads it
    // from loadScene — which loaded it with a plain import() and MEMOIZED
    // the promise, rejection included: a deploy-stranded client re-threw
    // the same dead chunk into the route boundary at every table mount.
    // The sheet sim rode plain imports at its three load sites as well.
    const preload = readFileSync(new URL('../src/three/preload.ts', import.meta.url), 'utf8');
    const warm = readFileSync(new URL('../src/effects/warm.ts', import.meta.url), 'utf8');
    const cloth = readFileSync(new URL('../src/SheetCloth.tsx', import.meta.url), 'utf8');
    expect(preload).toContain("importChunk(() => import('./Scene'))");
    expect(preload).not.toContain("scene ??= import('./Scene')");
    // The sheet sim's sites now pass `{ optional: … }` (crash hardening,
    // 2026-11-06) — the importChunk routing pinned here is unchanged.
    // preload's Scene line deliberately keeps NO optional flag: the
    // table chunk is navigation and keeps the essential heal.
    expect(warm).toContain("importChunk(() => import('../sheetClothSim'), { optional:");
    expect(warm).not.toMatch(/await import\('\.\.\/sheetClothSim'\)/);
    expect(cloth).toContain("importChunk(() => import('./sheetClothSim'), { optional:");
    expect(cloth).not.toMatch(/void import\('\.\/sheetClothSim'\)/);
  });

  it('does not reload for an error that is not a missing chunk', async () => {
    const storage = memory();
    const reload = vi.fn();
    const load = async () => { throw new Error('shader compile failed'); };
    await expect(importChunk(load, { reload, storage })).rejects.toThrow(/shader compile failed/);
    expect(reload).not.toHaveBeenCalled();
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
  });

  it('the full sweep: every runtime import of an app chunk is importChunk-guarded', () => {
    // The 2026-10-22 fix guarded the sites that had bitten; this walks
    // ALL of src so the NEXT unguarded dynamic import fails CI instead
    // of failing on the owner's phone after a deploy. A runtime import
    // is driven by await/void/return/assignment (`await import(`,
    // `void import(`, ...); type-position `import('./x').Type` follows a
    // `:`/`as`/`<` and never matches those drivers. Vendor chunks
    // ('@simplewebauthn/browser', 'html-to-image') are not app chunks
    // and are not story-reachable; chunkLoad's own @vite-ignore loader
    // takes a variable, not a quoted specifier.
    const srcRoot = new URL('../src/', import.meta.url).pathname;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e)) files.push(p);
      }
    };
    walk(srcRoot);
    const DRIVER = /(?:await|void|return|=)\s*import\(/;
    const offenders: string[] = [];
    for (const f of files) {
      const rel = relative(srcRoot, f);
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (!DRIVER.test(line)) return;
        const spec = line.match(/import\(\s*['"]([^'"]+)['"]/)?.[1];
        if (!spec) return; // a variable specifier: chunkLoad's own loader
        if (!spec.startsWith('.')) return; // a vendor chunk, not an app chunk
        if (line.includes('importChunk(')) return; // guarded at the call site
        // Dev-only preview entry (?preview=turn-ring), never reachable from story play.
        if (rel === 'main.tsx' && spec === './turnRingPreview') return;
        offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('optional chunk loads (crash hardening, 2026-11-06)', () => {
  // An OPTIONAL load is an effect, not navigation: if its chunk is gone
  // after a deploy, the effect is skipped and the game continues. The
  // pre-hardening loader reloaded the whole document for these too —
  // a stale Nuke3D chunk could bounce a player out of a live match.
  it('an optional failure retries, then rejects — and never reloads', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = memory();
    const load = async () => { throw fail(NUKE); };
    const importUrl = vi.fn(async () => { throw fail(NUKE); });
    const reload = vi.fn();
    await expect(importChunk(load, { importUrl, reload, storage, buildId: 'build-a', optional: 'nuke3d' })).rejects.toThrow(/Nuke3D-OLD/);
    expect(importUrl).toHaveBeenCalledTimes(2); // cache-bust retries still happen
    expect(reload).not.toHaveBeenCalled();
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBeNull(); // the heal budget is untouched
    warn.mockRestore();
  });

  it('an optional failure does not spend the build heal: a later essential failure still reloads once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = memory();
    const load = async () => { throw fail(NUKE); };
    const importUrl = vi.fn(async () => { throw fail(NUKE); });
    const reload = vi.fn();
    await expect(importChunk(load, { importUrl, reload, storage, buildId: 'build-a', optional: 'nuke3d' })).rejects.toThrow(/Nuke3D-OLD/);
    expect(reload).not.toHaveBeenCalled();
    await expect(importChunk(load, { importUrl, reload, storage, buildId: 'build-a' })).rejects.toThrow(/Nuke3D-OLD/);
    expect(reload).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('an optional load that succeeds on a cache-bust retry resolves the module', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = memory();
    const mod = { ok: true };
    const load = async () => { throw fail(TORNADO); };
    const importUrl = vi.fn(async () => mod);
    const reload = vi.fn();
    await expect(importChunk(load, { importUrl, reload, storage, optional: 'tornado3d' })).resolves.toBe(mod);
    expect(reload).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a non-chunk error in an optional load rejects without reloading', async () => {
    const storage = memory();
    const load = async () => { throw new Error('shader compile failed'); };
    const reload = vi.fn();
    await expect(importChunk(load, { reload, storage, optional: 'sheet' })).rejects.toThrow(/shader compile failed/);
    expect(reload).not.toHaveBeenCalled();
  });

  it('effect-class call sites load as optional; navigation keeps the essential heal', () => {
    // Supersession note (2026-11-06): the 2026-10-22 pins below demanded
    // the bare `importChunk(() => import(...))` shape at these sites.
    // The guarded retry is unchanged; the call now also declares itself
    // optional, which is the part that keeps a dead effect chunk from
    // reloading a live match. preload's Scene chunk is NOT here: the
    // table itself is navigation, and its heal stays essential.
    const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
    const warm = readFileSync(new URL('../src/effects/warm.ts', import.meta.url), 'utf8');
    const cloth = readFileSync(new URL('../src/SheetCloth.tsx', import.meta.url), 'utf8');
    const wheels = readFileSync(new URL('../src/WheelsResults.tsx', import.meta.url), 'utf8');
    const host = readFileSync(new URL('../src/photoreal/host.ts', import.meta.url), 'utf8');
    expect(scene).toContain("importChunk(() => import('./Nuke3D'), { optional:");
    expect(scene).toContain("importChunk(() => import('./Tornado3D'), { optional:");
    expect(scene).toContain("importChunk(() => import('./WheelsCar3D'), { optional:");
    expect(scene).toContain("importChunk(() => import('../photoreal/host'), { optional:");
    expect(warm).toContain("importChunk(() => import('../sheetClothSim'), { optional:");
    expect(warm).toContain("importChunk(() => import('../three/Tornado3D'), { optional:");
    expect(warm).toContain("importChunk(() => import('../three/Nuke3D'), { optional:");
    expect(cloth).toContain("importChunk(() => import('./sheetClothSim'), { optional:");
    expect(wheels).toContain("importChunk(() => import('./three/WheelsStage3D'), { optional:");
    expect(host).toContain("{ optional:");
  });
});
