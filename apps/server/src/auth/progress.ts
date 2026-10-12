/**
 * "Save my progress": what moves from the device into the account, once. Badges (same `{id, earnedAt, context}` shape
 * as bwm.badges.v1), the current rematch series, and the team name. Sanitized and size-capped.
 */
import { cleanTeamName } from '@spades/protocol';

export interface ProgressBadge { id: string; earnedAt: number; context?: Record<string, unknown> }
export interface Progress { v: 1; badges: ProgressBadge[]; series: unknown | null; teamName: string | null }

const MAX_BADGES = 200;
const MAX_SERIES_CHARS = 60_000;
const MAX_CONTEXT_CHARS = 600;

export function sanitizeProgress(raw: unknown): Progress {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const badges: ProgressBadge[] = [];
  const seen = new Set<string>();
  for (const b of Array.isArray(r.badges) ? r.badges : []) {
    if (!b || typeof b !== 'object') continue;
    const x = b as Record<string, unknown>;
    const id = typeof x.id === 'string' ? x.id.replace(/[^a-z0-9-]/gi, '').slice(0, 40) : '';
    if (!id || seen.has(id)) continue;
    const earnedAt = Number(x.earnedAt);
    const ctx = x.context && typeof x.context === 'object' && JSON.stringify(x.context).length <= MAX_CONTEXT_CHARS ? (x.context as Record<string, unknown>) : undefined;
    seen.add(id);
    badges.push({ id, earnedAt: Number.isFinite(earnedAt) && earnedAt > 0 ? earnedAt : 0, ...(ctx ? { context: ctx } : {}) });
    if (badges.length >= MAX_BADGES) break;
  }
  let series: unknown | null = null;
  if (r.series && typeof r.series === 'object' && (r.series as { v?: unknown }).v === 1) {
    const s = JSON.stringify(r.series);
    if (s.length <= MAX_SERIES_CHARS) series = JSON.parse(s);
  }
  const team = typeof r.teamName === 'string' ? cleanTeamName(r.teamName) : null;
  return { v: 1, badges, series, teamName: team || null };
}

/** Union of badges (earliest earn wins); the device's series / team name fill in what the account doesn't have. */
export function mergeProgress(account: Progress | null, device: Progress): Progress {
  if (!account) return device;
  const byId = new Map(account.badges.map((b) => [b.id, b]));
  for (const b of device.badges) {
    const a = byId.get(b.id);
    if (!a || (b.earnedAt && b.earnedAt < a.earnedAt)) byId.set(b.id, b);
  }
  return { v: 1, badges: [...byId.values()].slice(0, MAX_BADGES), series: account.series ?? device.series, teamName: account.teamName ?? device.teamName };
}
