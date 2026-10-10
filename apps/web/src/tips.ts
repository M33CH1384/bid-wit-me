/**
 * "Learn as you play" preferences in localStorage: { on, asked, counts }.
 * Off by default for returning players. Tips stay on across hands and games until the player turns them off
 * ("I've got it" or the toggle). `counts` = how many times each tip type has popped up on its own: after
 * TIP_MAX_SHOWS a tip only appears on request (the "?" button).
 */
const KEY = 'bwm.tips';
export const TIP_MAX_SHOWS = 3;
export interface TipsPref { on: boolean; asked: boolean; counts?: Record<string, number> }

export function loadTips(): TipsPref {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      const counts: Record<string, number> = {};
      if (p.counts && typeof p.counts === 'object') for (const [k, v] of Object.entries(p.counts)) if (typeof v === 'number') counts[k] = v;
      return { on: !!p.on, asked: !!p.asked, counts };
    }
  } catch { /* ignore */ }
  return { on: false, asked: false, counts: {} };
}
export function saveTips(p: TipsPref): void {
  // turning tips back on starts the counts over, so a player who asks for help again gets the full set
  const prev = loadTips();
  const counts = p.counts ?? (p.on && !prev.on ? {} : prev.counts);
  try { localStorage.setItem(KEY, JSON.stringify({ on: p.on, asked: p.asked, counts })); } catch { /* ignore */ }
}
/** How many times a tip has shown on its own. */
export function tipCount(id: string): number {
  return loadTips().counts?.[id] ?? 0;
}
/** Record that a tip popped up on its own. */
export function bumpTip(id: string): void {
  const p = loadTips();
  const counts = { ...(p.counts ?? {}), [id]: (p.counts?.[id] ?? 0) + 1 };
  try { localStorage.setItem(KEY, JSON.stringify({ ...p, counts })); } catch { /* ignore */ }
}
/** First visit = never asked, and no sign of earlier play (settings, a save, an online name). */
export function isFirstVisit(): boolean {
  try {
    if (localStorage.getItem(KEY)) return false;
    return !localStorage.getItem('spades.settings.v2') && !localStorage.getItem('bwm.game') && !localStorage.getItem('bwm.online.name');
  } catch { return false; }
}

/**
 * Auto-dismiss: a tip closes by itself (counts as "OK") after a reading time that scales with its length.
 * Paused while hovered / touched or while a glossary definition is open. Tune here.
 */
export const TIP_AUTO = {
  /** floor, before reading time is added */
  minMs: 15_000,
  /** reading time per word of tip text */
  msPerWord: 250,
  /** never longer than this */
  maxMs: 45_000,
} as const;
export function tipDurationMs(text: string): number {
  const words = text.replace(/\{([^}|]+)(?:\|[^}]+)?\}/g, '$1').split(/\s+/).filter(Boolean).length;
  return Math.min(TIP_AUTO.maxMs, TIP_AUTO.minMs + words * TIP_AUTO.msPerWord);
}
