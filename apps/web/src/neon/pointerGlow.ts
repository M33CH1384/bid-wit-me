/** Neon Royale P3 — reactive borders: the pure gate + geometry behind
 *  ReactiveGlow. One delegated pointer listener (in ReactiveGlow.tsx) finds
 *  the glow surface under the pointer and writes --mx/--my/--glow-a onto it;
 *  the ring itself is pure CSS (a masked ::after border in styles.css /
 *  social.css), so this module never touches layout — it only decides
 *  WHETHER the effect may run and WHERE the pointer sits inside a panel.
 *  Mirrors ink/mode.ts: Neon only, off under reduced motion and under the
 *  Reduce-effects setting, and the table is never a glow surface (P4 owns
 *  the playfield chrome). */
import type { ThemeName } from '../theme';

/** The surfaces that carry the reactive ring. Kept in lockstep with the
 *  ::after ring rules in styles.css / social.css — bare `.glass` is NOT one:
 *  it is shared with table chrome whose ::after slots are taken (the Run-It
 *  tip tail, the coach arrow), so the ring lives on the named panels. */
export const GLOW_SELECTOR = '.panel, .modal, .sheet, .decision-card, .mode, .nh-tile, .soc-panel, .ranks-you, .acct-dropdown, .profile-modal-card';

export interface GlowGateState {
  theme: ThemeName;
  /** OS-level prefers-reduced-motion. */
  reducedMotion: boolean;
  /** Settings → Effects → Reduce effects. */
  reduceEffects: boolean;
}

/** The effect runs only for Neon with every motion gate green. */
export function glowEnabled(s: GlowGateState): boolean {
  return s.theme === 'neon' && !s.reducedMotion && !s.reduceEffects;
}

/** Pointer position in element-local CSS pixels — what --mx/--my hold, so the
 *  CSS radial-gradient ring lights the border nearest the pointer. Clamped to
 *  the box so a fast pointer never parks the light outside the panel. */
export function glowPoint(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): { x: number; y: number } {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), Math.max(max, 0));
  return { x: clamp(clientX - rect.left, rect.width), y: clamp(clientY - rect.top, rect.height) };
}

/** Resolve the glow surface for an event target: the nearest ancestor (or the
 *  target itself) matching GLOW_SELECTOR — unless it lives inside the table
 *  screen, which stays unlit. Structural typing keeps this unit-testable
 *  without a DOM. */
export function glowSurfaceFor(target: { closest?: (sel: string) => unknown } | null | undefined): unknown {
  if (!target || typeof target.closest !== 'function') return null;
  const hit = target.closest(GLOW_SELECTOR) as { closest?: (sel: string) => unknown } | null;
  if (!hit) return null;
  if (typeof hit.closest === 'function' && hit.closest('.table-screen')) return null;
  return hit;
}
