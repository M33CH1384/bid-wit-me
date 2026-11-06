/**
 * BWM Central — the pure hub model (Phase 1): the five destinations laid
 * over the existing Social tab model, the responsive nav mode, and the
 * small honest helpers the Headlines / Matchups components render from.
 * No fetching, no store writes in here — components own those.
 */
import type { SocialTab } from './store';
import type { RecentResult } from './LeagueTicker';
import { analyzeScoreTimeline, type ScorePoint } from '../turningPoint';

export type CentralDest = 'headlines' | 'rankings' | 'matchups' | 'crew' | 'career';

export const CENTRAL_DESTS: { id: CentralDest; label: string; icon: string }[] = [
  { id: 'headlines', label: 'Headlines', icon: '📰' },
  { id: 'rankings', label: 'Rankings', icon: '🏆' },
  { id: 'matchups', label: 'Matchups', icon: '⚔️' },
  { id: 'crew', label: 'Crew', icon: '👥' },
  { id: 'career', label: 'My Career', icon: '🎖️' },
];

export const CENTRAL_DEST_IDS: CentralDest[] = CENTRAL_DESTS.map((d) => d.id);

/** Which destination a tab belongs to. Chat / messages / settings are
 *  header UTILITIES, not destinations — they map to null and the nav
 *  keeps the last destination highlighted underneath them. */
export function destOfTab(tab: SocialTab): CentralDest | null {
  switch (tab) {
    case 'headlines': return 'headlines';
    case 'leaders': return 'rankings';
    case 'matchups': case 'match': case 'tournaments': case 'challenges': return 'matchups';
    case 'players': case 'friends': return 'crew';
    case 'career': return 'career';
    default: return null;
  }
}

/** The tab a destination opens on. */
export function tabForDest(d: CentralDest): SocialTab {
  switch (d) {
    case 'headlines': return 'headlines';
    case 'rankings': return 'leaders';
    case 'matchups': return 'matchups';
    case 'crew': return 'players';
    case 'career': return 'career';
  }
}

/**
 * Nav form by viewport: phone portrait gets the labeled bottom bar,
 * phone landscape / short heights get the same labels slimmer, and
 * tablet/desktop widths get top tabs. Labels are rendered in EVERY
 * mode — only the chrome changes.
 */
export function hubNavMode(w: number, h: number): 'bar' | 'compact' | 'tabs' {
  if (h <= 500) return 'compact';
  if (w >= 900) return 'tabs';
  return 'bar';
}

/* ------------------------------------------------------------- headlines */

/**
 * The caller's own latest match from the results wire. The payload
 * carries display names only (no user ids), so "yours" honestly means
 * a side whose names include your username; guests (null name) get no
 * card rather than a guess.
 */
export function myLatestResult(results: RecentResult[], myName: string | null): RecentResult | null {
  if (!myName) return null;
  return results.find((r) => r.sides.some((s) => s.names.includes(myName))) ?? null;
}

export interface PowerRowLike { rank: number; id: string; name: string; power: number; rating: number; movement: number | 'new' }

/** Top movers for the Headlines card: numeric movement first (biggest
 *  absolute move wins), then NEW entries; flat rows are not movers. */
export function powerMovers(rows: PowerRowLike[], n = 3): PowerRowLike[] {
  const moved = rows.filter((r) => typeof r.movement === 'number' && r.movement !== 0)
    .sort((a, b) => Math.abs(b.movement as number) - Math.abs(a.movement as number));
  const fresh = rows.filter((r) => r.movement === 'new');
  return [...moved, ...fresh].slice(0, n);
}

/* ------------------------------------------------------------ match view */

/** GET /api/social/match/:id — the server contract (Phase 1 server lane). */
export interface MatchPlayer {
  userId: string; seat: number; side: number; won: boolean;
  partnerId?: string | null; teamName?: string | null;
  stats?: Record<string, unknown> | null;
  eloBefore?: number | null; eloAfter?: number | null;
}
export interface MatchPayload {
  game: {
    id: string; mode: string; kind: string; endedAt: number; hands: number;
    rated: boolean; winners: number[];
    final: number[] | Record<string, number>;
    seats?: { name: string; side: number }[];
  };
  players: MatchPlayer[];
  timeline: { hand: number; side: number; scoreAfter: number; books: number }[];
}

/** One stat cell: the real value when the payload carries a number
 *  (a real 0 renders "0"), otherwise an em dash — never a fabricated 0. */
export function statCell(stats: Record<string, unknown> | null | undefined, key: string): string {
  const v = stats?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : '—';
}

/** Final scores as a per-side array, whichever shape the contract uses. */
export function finalScores(final: MatchPayload['game']['final']): number[] {
  if (Array.isArray(final)) return final;
  return Object.keys(final).sort((a, b) => Number(a) - Number(b)).map((k) => final[k] ?? 0);
}

/** Timeline rows → per-hand score points (sides in index order). */
export function matchTimelinePoints(rows: MatchPayload['timeline']): ScorePoint[] {
  const byHand = new Map<number, Map<number, number>>();
  let maxSide = -1;
  for (const r of rows) {
    if (!byHand.has(r.hand)) byHand.set(r.hand, new Map());
    byHand.get(r.hand)!.set(r.side, r.scoreAfter);
    if (r.side > maxSide) maxSide = r.side;
  }
  const out: ScorePoint[] = [];
  const prev: number[] = Array.from({ length: maxSide + 1 }, () => 0);
  for (const [hand, sides] of [...byHand.entries()].sort((a, b) => a[0] - b[0])) {
    // a side with no row for this hand kept its previous score
    for (let s = 0; s <= maxSide; s++) if (sides.has(s)) prev[s] = sides.get(s)!;
    out.push({ hand, scores: [...prev] });
  }
  return out;
}

export function matchTurning(rows: MatchPayload['timeline']) {
  return analyzeScoreTimeline(matchTimelinePoints(rows));
}
