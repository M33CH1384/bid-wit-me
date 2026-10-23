/**
 * A deploy deletes the previous build's hashed chunks. A page that is still running that
 * build then asks for Tornado3D-OLD.js or Nuke3D-OLD.js, the fetch fails, and the effect
 * never starts. Retry the failed URL with a cache-busting query. If it is still gone,
 * reload once so the new index can name the new files. sessionStorage stops a second
 * reload FOR THE SAME BUILD: the flag stores the sha of the build that spent the heal
 * (owner recurrence, 2026-10-23). The first version stored a bare '1' for the whole tab
 * session, so a long-lived tab that had healed once had NO heal left for the next deploy
 * — and the one after that: each new deploy re-deleted the chunks the tab was running,
 * the import threw into the route boundary, and the game "kept crashing" on a player
 * who never closed the tab. A heal belongs to a build, not to a tab.
 */
import { VERSION } from './version';

export const CHUNK_RELOAD_KEY = 'bwm.chunk-reload';

const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|MIME type of ["']text\/html["']/i;

export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return CHUNK_ERROR.test(msg);
}

/** Chromium and Firefox put the module URL in the message. Safari does not. */
export function chunkUrlFromError(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err);
  const abs = msg.match(/https?:\/\/[^\s)'"]+\.js(?:\?[^\s)'"]*)?/);
  if (abs) return abs[0];
  const rel = msg.match(/(?:^|[\s('"])(\/assets\/[^\s)'"]+\.js(?:\?[^\s)'"]*)?)/);
  return rel?.[1] ?? null;
}

/** A new query the browser has not cached for this missing chunk. */
export function cacheBust(url: string, attempt: number): string {
  const relative = !/^https?:\/\//i.test(url);
  const u = new URL(url, relative ? 'https://bwm.local' : undefined);
  u.searchParams.set('bwm-retry', String(attempt));
  if (relative) return `${u.pathname}${u.search}`;
  return u.toString();
}

export interface ChunkLoadHooks<T> {
  importUrl?: (url: string) => Promise<T>;
  reload?: () => void;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Cache-busting attempts after the first failure. */
  retries?: number;
  /** Identity of the running build; the one-heal budget is scoped to it. Defaults to the build sha. */
  buildId?: string;
}

function browserStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  return sessionStorage;
}

function defaultImportUrl(url: string): Promise<unknown> {
  return import(/* @vite-ignore */ url);
}

function defaultReload(): void {
  location.reload();
}

/**
 * Load a split chunk. `load` is the static `import()` Vite turns into the hashed URL.
 * A chunk-load failure is retried against that same URL with `?bwm-retry=`, then the
 * document reloads at most once per BUILD. The flag stores the build's sha and a later
 * success of another effect must not clear it, or the two chunks would reload in turns.
 * A legacy flag ('1', written by builds before the sha scoping) differs from every
 * sha, so a stranded tab heals once onto the current build and records its sha.
 */
export async function importChunk<T>(load: () => Promise<T>, hooks: ChunkLoadHooks<T> = {}): Promise<T> {
  const retries = hooks.retries ?? 2;
  const storage = hooks.storage ?? browserStorage();
  const importUrl = hooks.importUrl ?? (defaultImportUrl as (url: string) => Promise<T>);
  const reload = hooks.reload ?? defaultReload;
  const buildId = hooks.buildId ?? VERSION.sha;

  try {
    return await load();
  } catch (err) {
    if (!isChunkLoadError(err)) throw err;
    console.warn('[bwm] chunk import failed', err);
    const url = chunkUrlFromError(err);
    let last: unknown = err;
    if (url) {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          return await importUrl(cacheBust(url, attempt));
        } catch (again) {
          last = again;
        }
      }
    }
    try {
      if (storage.getItem(CHUNK_RELOAD_KEY) !== buildId) {
        storage.setItem(CHUNK_RELOAD_KEY, buildId);
        reload();
      }
    } catch { /* private mode: leave the effect off rather than reload in a loop */ }
    throw last;
  }
}
