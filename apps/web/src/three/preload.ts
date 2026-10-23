/**
 * Loads the 3D table early: the Scene chunk (three / r3f / drei) and the table's textures + HDRI are fetched while the
 * player is still on the splash / wizard, so "Deal me in" lands on a ready table. Safe to call many times.
 *
 * The import goes through importChunk (chunkLoad.ts), like the route chunks and the
 * Nuke/Tornado effects: this is the biggest chunk in the app, and it used to load through
 * a plain import() memoized in `scene` — after a deploy deleted the previous build's
 * chunks, a still-open client asked for the old Scene by name, the import rejected, and
 * the REJECTED promise was the memoized one: every table mount re-threw it into the
 * route boundary and the game "crashed" on every attempt until a manual reload
 * (owner, 2026-10-22: the Play bounce at 22:29, then "repeatedly crashing" after the
 * evening's later deploys stranded his open client the same way). importChunk retries
 * cache-busted and spends the one guarded reload onto the new build; the memo is
 * cleared on failure so a later call can always ask again.
 */
import { importChunk } from '../chunkLoad';

let scene: Promise<typeof import('./Scene')> | null = null;
export function loadScene(): Promise<typeof import('./Scene')> {
  if (!scene) {
    scene = importChunk(() => import('./Scene'));
    scene.catch(() => { scene = null; });
  }
  return scene;
}
let started: string | null = null;
/**
 * venue: the table's venue when known ('random' / undefined = just the table; a venue's files are ~100–200 KB).
 * immediate: a resumed game is already the screen, so the scene chunk starts on the next task. The splash
 * still waits for an idle callback so the first paint is not competing with three.
 */
export function preloadTable(quality: 'high' | 'low', venue?: string, opts?: { immediate?: boolean }): void {
  const v = venue && venue !== 'random' ? venue : 'classic';
  const key = `${quality}:${v}`;
  if (started === key || typeof window === 'undefined') return;
  started = key;
  const go = () => { loadScene().then((m) => m.preloadTableAssets(quality, v as import('../venues').VenueId)).catch(() => { started = null; }); };
  if (opts?.immediate) { go(); return; }
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(go, { timeout: 1200 }); else window.setTimeout(go, 300);
}
