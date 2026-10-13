/**
 * A deploy deletes the previous build's hashed chunks. A page that is still running that
 * build then asks for Tornado3D-OLD.js or Nuke3D-OLD.js, the fetch fails, and the effect
 * never starts. Retry the failed URL with a cache-busting query. If it is still gone,
 * reload once so the new index can name the new files. sessionStorage stops a second reload.
 */
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
 * document reloads at most once per tab. The flag stays for the tab: a later success
 * of the other effect must not clear it, or the two chunks would reload in turns.
 */
export async function importChunk<T>(load: () => Promise<T>, hooks: ChunkLoadHooks<T> = {}): Promise<T> {
  const retries = hooks.retries ?? 2;
  const storage = hooks.storage ?? browserStorage();
  const importUrl = hooks.importUrl ?? (defaultImportUrl as (url: string) => Promise<T>);
  const reload = hooks.reload ?? defaultReload;

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
      if (storage.getItem(CHUNK_RELOAD_KEY) !== '1') {
        storage.setItem(CHUNK_RELOAD_KEY, '1');
        reload();
      }
    } catch { /* private mode: leave the effect off rather than reload in a loop */ }
    throw last;
  }
}
