/**
 * Loads the 3D table early: the Scene chunk (three / r3f / drei) and the table's textures + HDRI are fetched while the
 * player is still on the splash / wizard, so "Deal me in" lands on a ready table. Safe to call many times.
 */
let scene: Promise<typeof import('./Scene')> | null = null;
export function loadScene(): Promise<typeof import('./Scene')> {
  scene ??= import('./Scene');
  return scene;
}
let started: string | null = null;
/** venue: the table's venue when known ('random' / undefined = just the table; a venue's files are ~100–200 KB) */
export function preloadTable(quality: 'high' | 'low', venue?: string): void {
  const v = venue && venue !== 'random' ? venue : 'classic';
  const key = `${quality}:${v}`;
  if (started === key || typeof window === 'undefined') return;
  started = key;
  const go = () => { loadScene().then((m) => m.preloadTableAssets(quality, v as import('../venues').VenueId)).catch(() => { started = null; }); };
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(go, { timeout: 1200 }); else window.setTimeout(go, 300);
}
