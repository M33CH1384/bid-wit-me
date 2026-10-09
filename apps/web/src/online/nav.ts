/** Minimal client-side routing for the online screens (/online, /t/CODE). */
export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function isOnlinePath(path: string): boolean {
  return path === '/online' || path.startsWith('/online/') || /^\/t\/[^/]+\/?$/.test(path);
}

export function codeFromPath(path: string): string | null {
  const m = /^\/t\/([^/]+)\/?$/.exec(path);
  return m ? m[1]!.toUpperCase() : null;
}
