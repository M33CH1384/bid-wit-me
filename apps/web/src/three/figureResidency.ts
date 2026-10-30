/**
 * FIGURE TEXTURE RESIDENCY — the seated-figure GLBs get a lifecycle.
 *
 * The crash-telemetry audit (2026-10-30) found the figure systems had
 * shipped with the exact pattern that killed the process in the
 * 2026-10-23 voice crash: decoded resources that accumulate forever.
 * Every figure GLB carries ONE 2048×2048 body texture — ~23.8 MB of
 * VRAM once decoded with mips — and the loaders' session cache kept
 * every character ever seated decoded for the whole session: all 15
 * shipped figures ≈ 350 MB across an evening of table-hopping, on top
 * of the scene baseline, until the pressure cost the WebGL context
 * (or the process) and the route boundary landed the player in the
 * menu. The voice system got its residency discipline in 05fdd967
 * (an LRU budget with eviction); its closing note named 3D texture
 * residency as the next suspect. This module is that discipline for
 * figures.
 *
 * The contract:
 *  - A figure component ACQUIRES its GLB URL on mount and RELEASES it
 *    on unmount (see useFigureResidency — one line in the component,
 *    next to its useLoader call). Any current or future figure seam
 *    (Porch/story layer, persona layer, whatever comes next) plugs
 *    into the same registry and the same budget by using the hook.
 *  - The registry tracks decoded bytes per URL (measured from the
 *    loaded GLTF's own textures, not file sizes — a 3 MB GLB is
 *    ~24 MB decoded).
 *  - While total residency exceeds the budget, the least recently
 *    used UNMOUNTED entries are evicted: their geometries / materials
 *    / textures are disposed and the loader cache entry is cleared,
 *    so a later re-seat re-fetches and re-decodes behind the seat's
 *    existing portrait fallback instead of resurrecting dead handles.
 *  - A mounted figure (refs > 0) is NEVER evicted — eviction can
 *    never pop a seated figure — and a just-released entry gets a
 *    short grace so back-to-back table changes don't thrash: hopping
 *    away and straight back re-seats from cache.
 *
 * Budget: a full table seats 3 figures ≈ 71 MB. 160 MB keeps the
 * current table AND the previous table's whole cast resident (the
 * realistic hop pattern — story stop to story stop shares Dee and
 * re-seats neighbours; regular tables rotate personas) while capping
 * the session's figure footprint at under half the unbounded worst
 * case the audit measured.
 *
 * The probe mirrors the codebase's __bwm* discipline:
 * window.__bwmFigureResidency publishes { budget, totalBytes,
 * entries } after every mutation, so a rig (or a support session)
 * can watch residency plateau instead of guessing.
 */
import { useEffect } from 'react';
import { useLoader } from '@react-three/fiber';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BufferGeometry, Material, Object3D, Texture } from 'three';

export const FIGURE_RESIDENCY_BUDGET_BYTES = 160 * 1024 * 1024;

/** Fallback decoded size for a figure whose textures can't be
 *  measured (the audit's measured typical: one 2048² texture with
 *  mips ≈ 22.4 MB, plus the occasional 512² ≈ 1.4 MB). The budget
 *  still binds if measurement ever comes back empty. */
export const FIGURE_FALLBACK_BYTES = 24 * 1024 * 1024;

/** A just-released entry is eviction-proof for this long, so leaving
 *  a table and coming straight back is a cache hit, not a re-decode. */
export const FIGURE_EVICTION_GRACE_MS = 2_000;

/* ------------------------------------------------------------ measuring */

/**
 * Decoded VRAM bytes of every texture reachable from a loaded GLTF
 * scene: width × height × 4 (RGBA8) × 4/3 when mipmaps generate.
 * Textures are deduped by identity — cloned materials share them.
 */
export function estimateGltfTextureBytes(scene: Object3D): number {
  const textures = new Set<Texture>();
  scene.traverse((o) => {
    const mesh = o as { material?: Material | Material[] };
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const mat of mats) {
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) {
        const t = v as Texture | null;
        if (t && (t as { isTexture?: boolean }).isTexture) textures.add(t);
      }
    }
  });
  let bytes = 0;
  for (const t of textures) {
    const img = t.image as { width?: number; height?: number } | null | undefined;
    const w = img?.width ?? 0;
    const h = img?.height ?? 0;
    if (!w || !h) continue;
    bytes += Math.ceil(w * h * 4 * (t.generateMipmaps ? 4 / 3 : 1));
  }
  return bytes;
}

/** Dispose every GPU resource a cached GLTF owns (deduped). Textures
 *  are the residency; geometries and materials ride along so nothing
 *  of the entry survives. ImageBitmaps are closed back to the pool. */
export function disposeFigureGltf(gltf: GLTF): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  gltf.scene.traverse((o) => {
    const mesh = o as { geometry?: BufferGeometry; material?: Material | Material[] };
    if (mesh.geometry) geometries.add(mesh.geometry);
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const mat of mats) {
      materials.add(mat);
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) {
        const t = v as Texture | null;
        if (t && (t as { isTexture?: boolean }).isTexture) textures.add(t);
      }
    }
  });
  for (const t of textures) {
    t.dispose();
    const img = t.image as { close?: () => void } | null | undefined;
    if (img && typeof img.close === 'function') { try { img.close(); } catch { /* already closed */ } }
  }
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
}

/* ------------------------------------------------------------- registry */

export interface FigureResidencyEntry {
  url: string;
  /** Mounted figure components holding this URL right now. */
  refs: number;
  /** Measured decoded texture bytes (0 until the load is noted). */
  bytes: number;
  /** Last acquire/release time on the registry clock. */
  lastUsed: number;
  /** The cached GLTF, held only so eviction can dispose it. */
  gltf: GLTF | null;
}

export interface FigureResidencyEffects {
  now: () => number;
  /** Dispose an evicted entry's resources + clear its loader cache. */
  dispose: (entry: FigureResidencyEntry) => void;
}

export interface FigureResidencySnapshot {
  budget: number;
  totalBytes: number;
  entries: { url: string; bytes: number; refs: number; lastUsed: number }[];
}

/**
 * The registry's bookkeeping, free of three.js/r3f wiring so the
 * policy (budget, LRU order, mounted protection, grace) is unit
 * testable with fake effects. The app uses the singleton below.
 */
export class FigureResidency {
  private entries = new Map<string, FigureResidencyEntry>();

  constructor(
    private budgetBytes: number,
    private fx: FigureResidencyEffects,
    private graceMs: number = FIGURE_EVICTION_GRACE_MS,
  ) {}

  private entryFor(url: string): FigureResidencyEntry {
    let e = this.entries.get(url);
    if (!e) {
      e = { url, refs: 0, bytes: 0, lastUsed: this.fx.now(), gltf: null };
      this.entries.set(url, e);
    }
    return e;
  }

  /** A figure component mounted with this URL in hand. */
  acquire(url: string, gltf: GLTF | null, measuredBytes: number): void {
    const e = this.entryFor(url);
    e.refs++;
    e.lastUsed = this.fx.now();
    if (gltf && e.gltf !== gltf) e.gltf = gltf;
    if (measuredBytes > 0 && e.bytes === 0) e.bytes = measuredBytes;
    if (e.bytes === 0 && gltf) e.bytes = FIGURE_FALLBACK_BYTES;
    this.evict();
  }

  /** A figure component unmounted: the entry becomes evictable. */
  release(url: string): void {
    const e = this.entries.get(url);
    if (!e) return;
    e.refs = Math.max(0, e.refs - 1);
    e.lastUsed = this.fx.now();
    this.evict();
  }

  totalBytes(): number {
    let total = 0;
    for (const e of this.entries.values()) total += e.bytes;
    return total;
  }

  /** Evict LRU unmounted entries until residency fits the budget.
   *  Mounted entries and entries inside their grace never move; if
   *  nothing is evictable the registry stays over budget rather than
   *  touching a seated figure (the next release re-runs this). */
  evict(): void {
    while (this.totalBytes() > this.budgetBytes) {
      const now = this.fx.now();
      let victim: FigureResidencyEntry | null = null;
      for (const e of this.entries.values()) {
        if (e.refs > 0) continue;
        if (now - e.lastUsed < this.graceMs) continue;
        if (!victim || e.lastUsed < victim.lastUsed) victim = e;
      }
      if (!victim) return;
      this.entries.delete(victim.url);
      this.fx.dispose(victim);
    }
  }

  snapshot(): FigureResidencySnapshot {
    return {
      budget: this.budgetBytes,
      totalBytes: this.totalBytes(),
      entries: [...this.entries.values()].map((e) => ({
        url: e.url, bytes: e.bytes, refs: e.refs, lastUsed: e.lastUsed,
      })),
    };
  }
}

/* ------------------------------------------------------- app singleton */

const registry = new FigureResidency(FIGURE_RESIDENCY_BUDGET_BYTES, {
  now: () => Date.now(),
  dispose: (entry) => {
    if (entry.gltf) disposeFigureGltf(entry.gltf);
    // Drop the loader-cache entry too: a re-seat must re-fetch and
    // re-decode a FRESH GLTF — the disposed one's handles are dead.
    useLoader.clear(GLTFLoader, entry.url);
  },
});

function publishResidencyProbe(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { __bwmFigureResidency?: FigureResidencySnapshot }).__bwmFigureResidency = registry.snapshot();
}

export function acquireFigure(url: string, gltf: GLTF): void {
  registry.acquire(url, gltf, estimateGltfTextureBytes(gltf.scene));
  publishResidencyProbe();
}

export function releaseFigure(url: string): void {
  registry.release(url);
  publishResidencyProbe();
}

export function figureResidencySnapshot(): FigureResidencySnapshot {
  return registry.snapshot();
}

/* ----------------------------------------------------------------- hook */

/**
 * The seam every figure system plugs into: call next to the
 * component's useLoader(GLTFLoader, url) with the loaded GLTF.
 * Acquires on mount, releases on unmount — the registry does the
 * rest (accounting, budget, LRU eviction, disposal, cache clear).
 */
export function useFigureResidency(url: string, gltf: GLTF): void {
  useEffect(() => {
    acquireFigure(url, gltf);
    return () => releaseFigure(url);
  }, [url, gltf]);
}
