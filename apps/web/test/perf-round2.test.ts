/**
 * Perf round 2 (owner device report 2026-11-04: game 3 of a session
 * runs slow again, after round 1's persistent-scene + idle-pulse fix).
 *
 * What the round-2 rig convicted (local build of master, SwiftShader,
 * counts not timings):
 *  - The persistent context survives a rematch (round 1 holds), every
 *    census category is flat WITHIN a game, and the capped systems
 *    (chat 100, voice LRU, figure 160 MB LRU) stay capped.
 *  - But every game mount re-uploads the table's streamed maps: the
 *    decoded IMAGES were shared (loadTableImage), while the three
 *    Texture objects were rebuilt per TableModel mount (~20 MB at 1k)
 *    and never disposed — so each new game paid the upload again AND
 *    left the previous texture set live in the persisting context
 *    (live textures 72 -> 112 across one rematch, +268 texSubImage2D
 *    calls). Round 1 cached the table GEOMETRIES (geosCache) but not
 *    the maps. The maps get the same treatment here.
 *  - The device-side slope itself could not be reproduced in the rig
 *    (SwiftShader settles in minutes; the series path needs two live
 *    clients), so the Scene now publishes a per-game perf census —
 *    the figure/voice probe pattern extended — and leaves a 'perf'
 *    breadcrumb per settled game, so a real session reports its own
 *    growth table.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { perfCrumb, PerfTrail, type PerfCensusInput } from '../src/perfCensus';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

const baseInput: PerfCensusInput = {
  seed: 'CODE:3', textures: 112, geometries: 340, programs: 91,
  heapMB: 30.2, figMB: 68, voiceMB: 12.4, dom: 222, waapi: 2,
};

describe('perf census shape', () => {
  it('renders a compact bounded crumb with every field', () => {
    const c = perfCrumb(baseInput);
    expect(c).toContain('seed=CODE:3');
    expect(c).toContain('tex=112');
    expect(c).toContain('geo=340');
    expect(c).toContain('prog=91');
    expect(c).toContain('heap=30.2');
    expect(c).toContain('fig=68');
    expect(c).toContain('voice=12.4');
    expect(c).toContain('dom=222');
    expect(c).toContain('waapi=2');
    expect(c.length).toBeLessThan(160);
  });

  it('renders missing probes as dashes, never NaN or undefined', () => {
    const c = perfCrumb({ ...baseInput, heapMB: null, figMB: null, voiceMB: null });
    expect(c).toContain('heap=-');
    expect(c).toContain('fig=-');
    expect(c).toContain('voice=-');
    expect(c).not.toContain('NaN');
    expect(c).not.toContain('undefined');
  });

  it('the trail keeps only the last 8 games, in order', () => {
    const t = new PerfTrail();
    for (let i = 1; i <= 11; i++) t.push({ ...baseInput, seed: `G${i}`, at: i });
    const list = t.list();
    expect(list.length).toBe(8);
    expect(list[0]!.seed).toBe('G4');
    expect(list[list.length - 1]!.seed).toBe('G11');
    expect(t.latest()?.seed).toBe('G11');
  });
});

describe('perf round 2 structure', () => {
  it('streamed table maps are cached per URL for the session', () => {
    const scene = src('three/Scene.tsx');
    expect(scene).toContain('streamedTexCache');
    expect(scene).toContain('streamedTexCache.get(');
    expect(scene).toContain('streamedTexCache.set(');
    // the per-mount recreation is gone: textures are made only on a
    // cache miss inside useStreamedMaps
    const hookAt = scene.indexOf('function useStreamedMaps');
    const hook = scene.slice(hookAt, hookAt + 3200);
    expect(hook).toContain('streamedTexCache');
  });

  it('TableModel tracks applied maps per mount, not on the shared texture', () => {
    const scene = src('three/Scene.tsx');
    expect(scene).not.toContain('tex.userData.applied');
    expect(scene).toContain('appliedTexRef');
    expect(scene).toContain('new WeakSet');
  });

  it('the Scene publishes one perf census per settled game', () => {
    const scene = src('three/Scene.tsx');
    expect(scene).toContain('publishPerfCensus');
    expect(scene).toContain("noteCrumb('perf'");
    expect(scene).toContain('censusDoneRef');
    // gated like the transition shed: seed change re-arms, loadSettled fires
    expect(scene).toContain('props.loadSettled');
  });

  it('the census module publishes the window probes', () => {
    const mod = src('perfCensus.ts');
    expect(mod).toContain('__bwmPerfCensus');
    expect(mod).toContain('__bwmPerfTrail');
  });
});
