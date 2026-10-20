/**
 * Theme preference: **Classic** (the original electric-purple + gold look — the default)
 * or **Neon Royale** (midnight navy, violet + electric-blue ink, gold kept for primary
 * actions and branding). Device-local like sound and FX (`bwm.theme.v1`); nothing is
 * synced to the profile.
 *
 * Theming is token-driven: CSS custom properties on `:root` carry Classic values, and an
 * `html[data-theme="neon"]` block in styles.css overrides the same tokens. This store
 * only flips the attribute (plus the browser chrome color). The inline pre-paint script
 * in index.html reads the same key and sets the attribute before first paint, so a Neon
 * user never sees a Classic flash; `initTheme()` reconciles the attribute on boot.
 */
import { useSyncExternalStore } from 'react';

export type ThemeName = 'classic' | 'neon';

const KEY = 'bwm.theme.v1';

/** Browser chrome color per theme (matches each theme's --bg). */
export const THEME_COLORS: Record<ThemeName, string> = { classic: '#0c0712', neon: '#070914' };

/** Stored value → theme. Anything absent, malformed, or unknown falls back to Classic. */
export function parseTheme(raw: string | null): ThemeName {
  try {
    if (raw) {
      const j = JSON.parse(raw) as { theme?: unknown } | null;
      if (j && (j.theme === 'neon' || j.theme === 'classic')) return j.theme;
    }
  } catch { /* corrupt → classic */ }
  return 'classic';
}

function loadTheme(): ThemeName {
  try { return parseTheme(localStorage.getItem(KEY)); } catch { return 'classic'; }
}

let current: ThemeName = loadTheme();
const listeners = new Set<() => void>();

/** Applies the theme to the document: `data-theme` attribute + theme-color meta. */
export function applyTheme(t: ThemeName): void {
  if (typeof document === 'undefined') return;
  if (t === 'neon') document.documentElement.dataset.theme = 'neon';
  else delete document.documentElement.dataset.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[t]);
}

export const themeStore = {
  get: (): ThemeName => current,
  set(t: ThemeName): void {
    current = t;
    try { localStorage.setItem(KEY, JSON.stringify({ theme: t })); } catch { /* ignore */ }
    applyTheme(t);
    listeners.forEach((f) => f());
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};

/** Boot hook (main.tsx): reconcile the attribute/meta with the stored value. */
export function initTheme(): void { applyTheme(current); }

export function useTheme(): ThemeName {
  return useSyncExternalStore(themeStore.subscribe, themeStore.get, themeStore.get);
}
