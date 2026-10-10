/**
 * Tip jar ("Support Bid Wit Me"): a voluntary donation to support development, never a game prize.
 * Empty TIP_URL hides every tip UI.
 */
export const TIP_URL = 'https://cash.app/$m33ch84';
export const TIP_LABEL = 'Tip the devs (Cash App)';
export const TIP_NOTE = 'Tips are a donation to support development. They never buy anything in the game and are never a prize.';

/** The Victory-screen nudge shows at most once every TIP_EVERY finished games (from the 2nd), with "Don't show again". */
export const TIP_EVERY = 4;
const KEY = 'bwm.tipjar';
export interface TipJarState { games: number; shownAt: number; never: boolean }
export function loadTipJar(): TipJarState {
  try { const j = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (j && typeof j.games === 'number') return { games: j.games, shownAt: j.shownAt ?? -99, never: !!j.never }; } catch { /* */ }
  return { games: 0, shownAt: -99, never: false };
}
export function saveTipJar(s: TipJarState) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* */ } }
/** Pure: should this game's victory screen show the line? (`games` counts finished games including this one) */
export function tipNudgeDue(s: TipJarState, url: string = TIP_URL): boolean {
  return !!url && !s.never && s.games >= 2 && s.games - s.shownAt >= TIP_EVERY;
}
export function openTip() { if (TIP_URL) window.open(TIP_URL, '_blank', 'noopener,noreferrer'); }
