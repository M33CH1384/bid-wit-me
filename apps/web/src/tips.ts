/** "Learn as you play" preferences: { on, asked } in localStorage. Off by default for returning players. */
const KEY = 'bwm.tips';
export interface TipsPref { on: boolean; asked: boolean }

export function loadTips(): TipsPref {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const p = JSON.parse(raw); return { on: !!p.on, asked: !!p.asked }; }
  } catch { /* ignore */ }
  return { on: false, asked: false };
}
export function saveTips(p: TipsPref): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}
/** First visit = never asked, and no sign of earlier play (settings, a save, an online name). */
export function isFirstVisit(): boolean {
  try {
    if (localStorage.getItem(KEY)) return false;
    return !localStorage.getItem('spades.settings.v2') && !localStorage.getItem('bwm.game') && !localStorage.getItem('bwm.online.name');
  } catch { return false; }
}
