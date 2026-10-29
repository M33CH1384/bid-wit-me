/** Minimal client-side routing for the online screens (/online, /t/CODE). */
export function navigate(to: string, replace = false, state: unknown = null): void {
  if (replace) history.replaceState(state, '', to);
  else history.pushState(state, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function isOnlinePath(path: string): boolean {
  return path === '/online' || path.startsWith('/online/') || /^\/t\/[^/]+\/?$/.test(path);
}

export function codeFromPath(path: string): string | null {
  const m = /^\/t\/([^/]+)\/?$/.exec(path);
  return m ? m[1]!.toUpperCase() : null;
}

/**
 * Streaming watch routes: /watch/<CODE> lands straight in the room's watch view
 * (guests included — watching never walls), and /watch/<CODE>/broadcast is the
 * OBS browser-source frame. Returns null for anything that isn't a watch route.
 */
export function watchRoute(path: string): { code: string; broadcast: boolean } | null {
  const m = /^\/watch\/([^/]+?)(\/broadcast)?\/?$/.exec(path);
  if (!m) return null;
  const code = m[1]!.toUpperCase();
  return /^[A-Z0-9]{4,8}$/.test(code) ? { code, broadcast: !!m[2] } : null;
}

export function isWatchPath(path: string): boolean {
  return watchRoute(path) !== null;
}
