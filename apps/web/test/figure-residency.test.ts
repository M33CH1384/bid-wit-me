/**
 * Figure texture residency (crash hardening, 2026-10-30): the policy
 * half of three/figureResidency.ts, exercised with fake effects —
 * budget enforcement, LRU order, mounted protection, the re-entry
 * grace, and decoded-byte measurement from a real three.js scene.
 * The audit this answers: figure GLBs accumulated decoded forever
 * (~23.8 MB each, ~350 MB for the shipped cast) until the WebGL
 * context died and the player landed in the menu.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Group, Mesh, MeshStandardMaterial, PlaneGeometry, Texture } from 'three';
import {
  FIGURE_FALLBACK_BYTES,
  FIGURE_RESIDENCY_BUDGET_BYTES,
  FigureResidency,
  estimateGltfTextureBytes,
} from '../src/three/figureResidency';

const MB = 1024 * 1024;

function harness(budget = 100 * MB, graceMs = 2_000) {
  let now = 1_000_000;
  const disposed: string[] = [];
  const reg = new FigureResidency(budget, {
    now: () => now,
    dispose: (e) => { disposed.push(e.url); },
  }, graceMs);
  return { reg, disposed, advance: (ms: number) => { now += ms; } };
}

const fakeGltf = null as never; // bookkeeping tests pass bytes directly

describe('figure residency policy', () => {
  it('accounts decoded bytes per mounted figure', () => {
    const { reg } = harness();
    reg.acquire('/f/dee.glb', fakeGltf, 24 * MB);
    reg.acquire('/f/pat.glb', fakeGltf, 24 * MB);
    expect(reg.totalBytes()).toBe(48 * MB);
    const snap = reg.snapshot();
    expect(snap.entries.find((e) => e.url === '/f/dee.glb')?.refs).toBe(1);
  });

  it('falls back to the audit-typical size when a load cannot be measured', () => {
    const { reg } = harness();
    reg.acquire('/f/mystery.glb', {} as never, 0);
    expect(reg.totalBytes()).toBe(FIGURE_FALLBACK_BYTES);
  });

  it('never evicts a mounted figure, even over budget', () => {
    const { reg, disposed, advance } = harness(50 * MB);
    reg.acquire('/f/a.glb', fakeGltf, 24 * MB);
    reg.acquire('/f/b.glb', fakeGltf, 24 * MB);
    reg.acquire('/f/c.glb', fakeGltf, 24 * MB); // 72 > 50, all mounted
    advance(60_000);
    reg.release('/f/c.glb'); // c unmounts; a+b still mounted (48 <= 50 ok)
    expect(disposed).toEqual([]);
    expect(reg.totalBytes()).toBe(72 * MB);
  });

  it('evicts least-recently-used unmounted entries until the budget fits', () => {
    const { reg, disposed, advance } = harness(100 * MB);
    // Table 1: three figures mount and unmount.
    for (const u of ['/f/a.glb', '/f/b.glb', '/f/c.glb']) { reg.acquire(u, fakeGltf, 24 * MB); reg.release(u); advance(10); }
    // Table 2: three more — total would reach 144 MB without eviction.
    for (const u of ['/f/d.glb', '/f/e.glb', '/f/f.glb']) { reg.acquire(u, fakeGltf, 24 * MB); reg.release(u); advance(10); }
    advance(60_000); // leave the grace window
    reg.acquire('/f/g.glb', fakeGltf, 24 * MB); // triggers the pass: 168 -> evict LRU down to <= 100
    expect(reg.totalBytes()).toBeLessThanOrEqual(100 * MB);
    // Oldest entries went first.
    expect(disposed.slice(0, 3)).toEqual(['/f/a.glb', '/f/b.glb', '/f/c.glb']);
    expect(reg.snapshot().entries.map((e) => e.url)).not.toContain('/f/a.glb');
  });

  it('protects a just-released entry inside its grace (no thrash on instant re-entry)', () => {
    const { reg, disposed } = harness(30 * MB);
    reg.acquire('/f/a.glb', fakeGltf, 24 * MB);
    reg.release('/f/a.glb');
    reg.acquire('/f/b.glb', fakeGltf, 24 * MB); // 48 > 30, but a is in grace and b is mounted
    expect(disposed).toEqual([]);
    expect(reg.snapshot().entries.map((e) => e.url).sort()).toEqual(['/f/a.glb', '/f/b.glb']);
  });

  it('a re-acquired entry keeps its measured bytes and refreshes LRU order', () => {
    const { reg, disposed, advance } = harness(50 * MB);
    reg.acquire('/f/a.glb', fakeGltf, 24 * MB); reg.release('/f/a.glb'); advance(10);
    reg.acquire('/f/b.glb', fakeGltf, 24 * MB); reg.release('/f/b.glb'); advance(10);
    reg.acquire('/f/a.glb', fakeGltf, 24 * MB); reg.release('/f/a.glb'); // a is now freshest
    advance(60_000);
    reg.acquire('/f/c.glb', fakeGltf, 24 * MB); // 72 > 50: evict LRU = b, keep a
    expect(disposed).toEqual(['/f/b.glb']);
  });

  it('the shipped budget holds two full tables of audit-measured figures', () => {
    // 3 figures/table ≈ 71 MB; current + previous table must coexist.
    expect(FIGURE_RESIDENCY_BUDGET_BYTES).toBeGreaterThanOrEqual(2 * 3 * 23 * MB);
    // ...and must be a real cap vs the ~350 MB unbounded cast total.
    expect(FIGURE_RESIDENCY_BUDGET_BYTES).toBeLessThan(15 * 23 * MB);
  });
});

describe('residency + recovery wiring (source pins)', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), 'apps/web', p), 'utf8');

  it('both figure systems plug into the shared residency hook', () => {
    expect(src('src/three/PorchFigures.tsx')).toContain('useFigureResidency(url, gltf)');
    expect(src('src/three/PersonaFigures.tsx')).toContain('useFigureResidency(url, gltf)');
  });

  it('eviction disposes the GLTF and clears the loader cache (a re-seat re-decodes fresh)', () => {
    const mod = src('src/three/figureResidency.ts');
    expect(mod).toContain('disposeFigureGltf(entry.gltf)');
    expect(mod).toContain('useLoader.clear(GLTFLoader, entry.url)');
    expect(mod).toContain('__bwmFigureResidency');
  });

  it('Scene recovers a lost context in place: preventDefault + epoch remount, telemetry untouched', () => {
    const scene = src('src/three/Scene.tsx');
    // The telemetry lane's reporting listeners stay exactly as shipped.
    expect(scene).toContain("reportCrash('webgl-lost', new Error('WebGL context lost')");
    expect(scene).toContain("reportCrash('webgl-restored', new Error('WebGL context restored')");
    // The recovery pair: restorable loss + a keyed remount of the
    // resource subtree, with NO route change / reload anywhere near it.
    expect(scene).toContain("addEventListener('webglcontextlost', (e) => { e.preventDefault(); })");
    expect(scene).toContain('setGlEpoch((n) => n + 1)');
    expect(scene).toContain('<Fragment key={glEpoch}>');
  });
});

describe('estimateGltfTextureBytes', () => {
  it('measures width × height × 4 × mips, deduped across cloned materials', () => {
    const tex = new Texture();
    tex.image = { width: 2048, height: 2048 } as never;
    const m1 = new MeshStandardMaterial({ map: tex });
    const m2 = new MeshStandardMaterial({ map: tex });
    const root = new Group();
    root.add(new Mesh(new PlaneGeometry(1, 1), m1));
    root.add(new Mesh(new PlaneGeometry(1, 1), m2));
    // One shared 2048² texture, counted once: 2048*2048*4*4/3.
    expect(estimateGltfTextureBytes(root)).toBe(Math.ceil(2048 * 2048 * 4 * (4 / 3)));
  });

  it('returns 0 when nothing is measurable (the caller falls back)', () => {
    expect(estimateGltfTextureBytes(new Group())).toBe(0);
  });
});
