/**
 * Badges (local for now). Stored as `{ v: 1, badges: [{ id, earnedAt, context }] }` under `bwm.badges.v1`, so a future
 * accounts / badges service can import them as-is. Plus the one-time "Run it!" onboarding counter.
 */
import { useSyncExternalStore } from 'react';

export interface Badge { id: string; earnedAt: number; context?: Record<string, unknown> }
export const BADGES: Record<string, { name: string; icon: string; desc: string }> = {
  'storm-chaser': { name: 'Storm Chaser', icon: '🌪', desc: 'Ran the board with Run it!' },
};

const KEY = 'bwm.badges.v1';
const TIP_KEY = 'bwm.runItTip.v1';
const listeners = new Set<() => void>();
let cache: Badge[] | null = null;

function read(): Badge[] {
  if (cache) return cache;
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    cache = Array.isArray(j?.badges) ? j.badges.filter((b: Badge) => b && typeof b.id === 'string') : [];
  } catch { cache = []; }
  return cache!;
}

export function badges(): Badge[] { return read(); }
export function hasBadge(id: string): boolean { return read().some((b) => b.id === id); }

/** Award once; returns true when it's new. */
export function award(id: string, context?: Record<string, unknown>): boolean {
  if (hasBadge(id)) return false;
  cache = [...read(), { id, earnedAt: Date.now(), ...(context ? { context } : {}) }];
  try { localStorage.setItem(KEY, JSON.stringify({ v: 1, badges: cache })); } catch { /* ignore */ }
  listeners.forEach((f) => f());
  return true;
}

/** Badges earned on another device (from the account): add the ones this device doesn't have. */
export function mergeBadges(list: Badge[]): number {
  const add = list.filter((b) => b && typeof b.id === 'string' && !hasBadge(b.id));
  if (!add.length) return 0;
  cache = [...read(), ...add];
  try { localStorage.setItem(KEY, JSON.stringify({ v: 1, badges: cache })); } catch { /* ignore */ }
  listeners.forEach((f) => f());
  return add.length;
}

export function useBadges(): Badge[] {
  return useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f); }; }, read, read);
}

/* ---- "Run it!" spotlight tip: shown when the button first appears (even with tips off), at most 3 times, never after first use */
interface TipState { shown: number; used: boolean }
export function runItTip(): TipState {
  try { const j = JSON.parse(localStorage.getItem(TIP_KEY) ?? 'null'); if (j) return { shown: Number(j.shown) || 0, used: !!j.used }; } catch { /* ignore */ }
  return { shown: 0, used: false };
}
function saveTip(t: TipState) { try { localStorage.setItem(TIP_KEY, JSON.stringify(t)); } catch { /* ignore */ } }
export const RUN_IT_TIP_MAX = 3;
export function runItTipDue(): boolean { const t = runItTip(); return !t.used && !hasBadge('storm-chaser') && t.shown < RUN_IT_TIP_MAX; }
export function runItTipShown(): void { const t = runItTip(); saveTip({ ...t, shown: t.shown + 1 }); }
export function runItUsed(): void { saveTip({ ...runItTip(), used: true }); }
