/**
 * Story Mode 3D characters: the stable names and the asset index (no three.js here; a native port can reuse it).
 * Assets are NOT in git: they live on their own Pages project (hashed, immutable filenames, CORS *).
 * Index: `${CHARACTER_ASSETS_BASE}/characters.json` → id → { glb, portrait, circle54, manifest, expressions, bytes, sha256 }.
 */

/** Asset origin. Override with VITE_CHARACTERS_ORIGIN at build time (the CSP must list the same origin). */
export const CHARACTER_ASSETS_BASE: string =
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_CHARACTERS_ORIGIN ?? 'https://bwm-characters.pages.dev').replace(/\/$/, '');

/** Morph targets on face / brows / lashes / teeth / tongue (identical on all 23). One at a time; neutral = 1 at rest. */
export const CHARACTER_MORPHS = ['neutral', 'smile', 'laugh', 'smug', 'shocked', 'angry'] as const;
export type CharacterExpression = (typeof CHARACTER_MORPHS)[number];
/** Animation clips (bones only, ~37 of 163; no morph tracks). */
export const CHARACTER_CLIPS = ['idle', 'hold_fan', 'pick_card', 'drag', 'flick_discard'] as const;
export type CharacterClip = (typeof CHARACTER_CLIPS)[number];
/** Shared rig facts (all 23): checked by the loader in dev, relied on by the skeleton binding. */
export const CHARACTER_RIG = { bones: 163, hairAlphaTest: 0.12 } as const;

export interface CharacterEntry {
  glb: string; portrait: string; circle54: string; manifest: string;
  expressions: Partial<Record<CharacterExpression, string>>;
  bytes: number; sha256: string;
}
export interface CharacterIndex { version: number; count: number; characters: Record<string, CharacterEntry> }

/** Absolute URL of an index path ("/dee/dee.8f80fed4.glb"). */
export const characterUrl = (path: string): string => (/^https?:/.test(path) ? path : `${CHARACTER_ASSETS_BASE}${path.startsWith('/') ? '' : '/'}${path}`);

let indexP: Promise<CharacterIndex> | null = null;
/** The asset index, fetched once per page (failures are not cached, so a later stop can retry). */
export function fetchCharacterIndex(fetchFn: typeof fetch = fetch): Promise<CharacterIndex> {
  indexP ??= fetchFn(`${CHARACTER_ASSETS_BASE}/characters.json`, { mode: 'cors', credentials: 'omit' })
    .then((r) => { if (!r.ok) throw new Error(`characters.json ${r.status}`); return r.json() as Promise<CharacterIndex>; })
    .catch((e) => { indexP = null; throw e; });
  return indexP;
}
/** tests */
export function __resetCharacterIndex(): void { indexP = null; }

/** Who gets a 3D figure at a stop: the stage pair (seat 1 = stage left, seat 3 = stage right) plus Dee. Rail stays 2D. */
export function stage3DCast(stagePair: readonly string[]): { left: string; right: string; dee: 'dee' } | null {
  if (stagePair.length !== 2) return null;
  return { left: stagePair[0]!, right: stagePair[1]!, dee: 'dee' };
}

export interface DeviceSignals {
  deviceMemory?: number; reducedMotion?: boolean; reduceEffects?: boolean; webgl?: boolean;
}
/** 3D only when the device can take it; otherwise the 2D portrait is the permanent answer. Pure (tests). */
export function want3DCharacters(d: DeviceSignals): { ok: boolean; reason?: string } {
  if (d.reduceEffects) return { ok: false, reason: 'reduce-effects' };
  if (d.reducedMotion) return { ok: false, reason: 'reduced-motion' };
  if (d.deviceMemory !== undefined && d.deviceMemory <= 2) return { ok: false, reason: 'low-memory' };
  if (d.webgl === false) return { ok: false, reason: 'no-webgl' };
  return { ok: true };
}

/** Prefetch the next stop's pair only on a fast, non-saver connection (unknown connection = no prefetch). */
export function shouldPrefetch(conn: { saveData?: boolean; effectiveType?: string } | undefined | null): boolean {
  if (!conn) return false;
  if (conn.saveData) return false;
  return conn.effectiveType === '4g' || conn.effectiveType === '5g';
}

/** Load timeout for one figure before the stage settles on 2D (ms). */
export const CHARACTER_LOAD_TIMEOUT_MS = 15_000;
/** In-view triangle budget for the stage (pair + Dee at LOD0). */
export const STAGE_TRIANGLE_BUDGET = 200_000;
