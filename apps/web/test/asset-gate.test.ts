import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ASSET_GATE_CAP_MS, SEDAN_GLB_URL, createAssetGate, imageSettled, loaderStillUp,
  noteRoomAssets, notedRoomAssets, roomGlbUrls,
} from '../src/assetGate';
import { versusDismissReady } from '../src/VersusIntro';
import { deckArtUrlsFor, whenDeckArtSettled, whenDeckBackSettled } from '../src/decks';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('asset gate registry', () => {
  it('holds while an asset promise is pending and releases when it resolves', async () => {
    const gate = createAssetGate('test:hold', 60_000);
    let release!: (ok: boolean) => void;
    gate.add('room backdrop', new Promise<boolean>((r) => { release = r; }));
    gate.seal();
    let doneResult: unknown = null;
    void gate.done.then((r) => { doneResult = r; });
    await tick();
    expect(doneResult).toBeNull();
    expect(gate.progress()).toEqual({ settled: 0, total: 1, fraction: 0 });
    release(true);
    const r = await gate.done;
    expect(r.total).toBe(1);
    expect(r.settled).toBe(1);
    expect(r.failed).toEqual([]);
    expect(r.cappedOut).toBe(false);
    expect(doneResult).not.toBeNull();
  });

  it('does not resolve before seal, even with everything settled (late ledger fold)', async () => {
    const gate = createAssetGate('test:seal', 60_000);
    gate.add('a', Promise.resolve(true));
    let resolved = false;
    void gate.done.then(() => { resolved = true; });
    await tick();
    expect(resolved).toBe(false);
    gate.add('b', Promise.resolve(true));
    gate.seal();
    await gate.done;
    expect(resolved).toBe(true);
    expect((await gate.done).total).toBe(2);
  });

  it('a failed asset settles the gate and is named, so the fallback path proceeds', async () => {
    const gate = createAssetGate('test:fail', 60_000);
    gate.add('venue backdrop /assets/venues/x/bg.jpg', Promise.resolve(false));
    gate.add('glb sedan', Promise.reject(new Error('network')));
    gate.seal();
    const r = await gate.done;
    expect(r.cappedOut).toBe(false);
    expect(r.settled).toBe(2);
    expect(r.failed).toContain('venue backdrop /assets/venues/x/bg.jpg');
    expect(r.failed).toContain('glb sedan');
    expect(gate.failed()).toEqual(r.failed);
  });

  it('the cap releases the gate with pending assets named (no trapped loader)', async () => {
    vi.useFakeTimers();
    try {
      const gate = createAssetGate('test:cap', 1_000);
      gate.add('never answers', new Promise<boolean>(() => {}));
      gate.add('quick', Promise.resolve(true));
      gate.seal();
      const doneP = gate.done;
      await vi.advanceTimersByTimeAsync(999);
      let resolved = false;
      void doneP.then(() => { resolved = true; });
      await Promise.resolve();
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const r = await doneP;
      expect(r.cappedOut).toBe(true);
      expect(r.pendingAtCap).toEqual(['never answers']);
      expect(r.settled).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports progress as assets settle', async () => {
    const gate = createAssetGate('test:progress', 60_000);
    const seen: number[] = [];
    gate.onProgress(() => seen.push(gate.progress().fraction));
    gate.add('a', Promise.resolve(true));
    gate.add('b', Promise.resolve(true));
    gate.add('c', Promise.resolve(false));
    gate.seal();
    await gate.done;
    expect(gate.progress()).toEqual({ settled: 3, total: 3, fraction: 1 });
    expect(seen).toContain(1 / 3);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it('duplicate labels register once', async () => {
    const gate = createAssetGate('test:dup', 60_000);
    gate.add('/assets/x.jpg', Promise.resolve(true));
    gate.add('/assets/x.jpg', Promise.resolve(true));
    gate.seal();
    const r = await gate.done;
    expect(r.total).toBe(1);
  });

  it('the cap is generous but bounded, under the loader 40s give-up', () => {
    expect(ASSET_GATE_CAP_MS).toBeGreaterThanOrEqual(10_000);
    expect(ASSET_GATE_CAP_MS).toBeLessThan(40_000);
  });
});

describe('loader composition (Table dismissal)', () => {
  it('holds while room assets are pending even with dressed + effects warm', () => {
    expect(loaderStillUp({ dressed: true, effectsWarm: true, assetsSettled: false, giveUp: false })).toBe(true);
  });
  it('holds while card art is pending (assets unsettled covers the deck tasks)', () => {
    expect(loaderStillUp({ dressed: true, effectsWarm: true, assetsSettled: false, giveUp: false })).toBe(true);
    expect(loaderStillUp({ dressed: true, effectsWarm: true, assetsSettled: true, giveUp: false })).toBe(false);
  });
  it('keeps the original conditions and the give-up override', () => {
    expect(loaderStillUp({ dressed: false, effectsWarm: true, assetsSettled: true, giveUp: false })).toBe(true);
    expect(loaderStillUp({ dressed: true, effectsWarm: false, assetsSettled: true, giveUp: false })).toBe(true);
    expect(loaderStillUp({ dressed: false, effectsWarm: false, assetsSettled: false, giveUp: true })).toBe(false);
  });
  it('the versus story floor is unchanged: assets alone never dismiss the intro', () => {
    // versusDismissReady is the untouched second condition: story incomplete
    // holds the loader no matter how ready the table (and its assets) are.
    expect(versusDismissReady({ storyComplete: false, tableReady: true })).toBe(false);
    expect(versusDismissReady({ storyComplete: true, tableReady: false })).toBe(false);
    expect(versusDismissReady({ storyComplete: true, tableReady: true })).toBe(true);
  });
});

describe('room asset enumeration', () => {
  it('the sedan rides only the high-quality street rooms', () => {
    expect(roomGlbUrls('blockAfterDark', 'high', null)).toEqual([{ label: expect.any(String), url: SEDAN_GLB_URL }]);
    expect(roomGlbUrls('blockAfterDark', 'high', 'pjs')).toEqual([{ label: expect.any(String), url: SEDAN_GLB_URL }]);
    expect(roomGlbUrls('speakeasy', 'high', 'corner')).toEqual([{ label: expect.any(String), url: SEDAN_GLB_URL }]);
    expect(roomGlbUrls('speakeasy', 'high', null)).toEqual([]);
    expect(roomGlbUrls('blockAfterDark', 'low', null)).toEqual([]);
    expect(roomGlbUrls('grandma', 'high', 'porch')).toEqual([]); // the Porch deck room is all-code
    expect(roomGlbUrls('classic', 'high', null)).toEqual([]);
  });

  it('the gate sedan URL is the very file PjsStreetRoom loads', () => {
    const src = readFileSync(new URL('../src/three/PjsStreetRoom.tsx', import.meta.url), 'utf8');
    expect(src).toContain(`const SEDAN_URL = '${SEDAN_GLB_URL}'`);
    const corner = readFileSync(new URL('../src/three/CornerStreetRoom.tsx', import.meta.url), 'utf8');
    expect(corner).toContain("SEDAN_URL } from './PjsStreetRoom'");
  });

  it('the ledger collects noted room files per venue, deduped', () => {
    noteRoomAssets('ledger-test-venue', ['/a.jpg', '/b.glb']);
    noteRoomAssets('ledger-test-venue', ['/a.jpg', '/c.jpg']);
    expect(notedRoomAssets('ledger-test-venue')).toEqual(['/a.jpg', '/b.glb', '/c.jpg']);
    expect(notedRoomAssets('never-noted-venue')).toEqual([]);
  });

  it('every three-layer warm pass notes its files into the ledger', () => {
    const venue3d = readFileSync(new URL('../src/three/Venue3D.tsx', import.meta.url), 'utf8');
    expect(venue3d).toContain('noteRoomAssets(id,');
    const cube = readFileSync(new URL('../src/three/cubeVenue.tsx', import.meta.url), 'utf8');
    expect(cube).toContain('noteRoomAssets(cfg.id, files)');
    const barber = readFileSync(new URL('../src/three/BarbershopRoom.tsx', import.meta.url), 'utf8');
    expect(barber).toContain("noteRoomAssets('barbershop', files)");
    const classic = readFileSync(new URL('../src/three/ClassicStudio.tsx', import.meta.url), 'utf8');
    expect(classic).toContain("noteRoomAssets('classic', files)");
  });

  it('Table wires the gate into the loader dismissal', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain('loaderStillUp({ dressed, effectsWarm, assetsSettled, giveUp: loadGiveUp })');
    expect(table).toContain('createAssetGate(');
    expect(table).toContain('whenDeckArtSettled(settings.deck)');
    expect(table).toContain('whenDeckBackSettled(settings.deck)');
    expect(table).toContain('__bwmAssetGate');
  });
});

/* A controllable Image: loads succeed unless the URL carries 'missing'. */
class FakeImage {
  complete = false;
  naturalWidth = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Set<() => void>>();
  private _src = '';
  set src(v: string) {
    this._src = v;
    queueMicrotask(() => {
      if (v.includes('missing')) {
        this.complete = true; this.naturalWidth = 0;
        this.onerror?.(); this.fire('error');
      } else {
        this.complete = true; this.naturalWidth = 12;
        this.onload?.(); this.fire('load');
      }
    });
  }
  get src() { return this._src; }
  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void) { this.listeners.get(type)?.delete(fn); }
  decode() { return Promise.resolve(); }
  private fire(type: string) { this.listeners.get(type)?.forEach((f) => f()); }
}

describe('deck settle helpers', () => {
  const realImage = globalThis.Image;
  afterEach(() => { globalThis.Image = realImage; });

  it('enumerates exactly the fetchable face set for the deck in use', () => {
    const classic = deckArtUrlsFor('classic');
    expect(classic).toHaveLength(14); // 12 courts + BJ + LJ; number cards are painted
    expect(classic).toContain('/assets/decks/classic/KS.jpg');
    expect(classic).toContain('/assets/decks/classic/JOKER-BIG.jpg');
    expect(classic).toContain('/assets/decks/classic/JOKER-LIL.jpg');
    const pjs = deckArtUrlsFor('pjs'); // Pj's Iron ships acesArt + webp
    expect(pjs).toHaveLength(18);
    expect(pjs).toContain('/assets/decks/pjs/AS.webp');
    expect(pjs.every((u) => u.endsWith('.webp'))).toBe(true);
  });

  it('the deck gate settles when the art lands, and warm art settles at once', async () => {
    globalThis.Image = FakeImage as unknown as typeof Image;
    const first = await whenDeckArtSettled('classic');
    expect(first).toEqual({ total: 14, failed: [] });
    const t0 = performance.now();
    const second = await whenDeckArtSettled('classic'); // fully cached: no artificial delay
    expect(performance.now() - t0).toBeLessThan(50);
    expect(second.failed).toEqual([]);
  });

  it('the card back settles, and a missing back resolves false instead of hanging', async () => {
    globalThis.Image = FakeImage as unknown as typeof Image;
    await expect(whenDeckBackSettled('classic')).resolves.toBe(true);
    // a deck id whose back URL misses: BACK_NAMES falls back to 'Base', so use
    // the image-level contract instead — a missing URL settles false.
    await expect(imageSettled('/assets/card-backs/missing-back.png')).resolves.toBe(false);
    await expect(imageSettled('/assets/card-backs/Base-back.png')).resolves.toBe(true);
  });
});
