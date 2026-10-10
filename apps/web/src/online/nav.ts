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
