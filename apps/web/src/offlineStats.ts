/** Release 9b: offline (vs bots) personal stats, kept on this device only and shown on your own profile. */
export interface OfflineStats { games: number; wins: number; streak: number; bestStreak: number; byMode: Record<string, { games: number; wins: number }> }
const KEY = 'bwm.offlineStats';
export function offlineStats(): OfflineStats {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (v && typeof v.games === 'number') return v; } catch { /* fresh */ }
  return { games: 0, wins: 0, streak: 0, bestStreak: 0, byMode: {} };
}
export function recordOfflineGame(mode: string, won: boolean): OfflineStats {
  const s = offlineStats();
  s.games++;
  if (won) { s.wins++; s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak); } else s.streak = 0;
  const m = (s.byMode[mode] ??= { games: 0, wins: 0 });
  m.games++; if (won) m.wins++;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* full */ }
  return s;
}
