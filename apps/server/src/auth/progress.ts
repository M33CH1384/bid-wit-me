/**
 * "Save my progress": what moves from the device into the account, once. Badges (same `{id, earnedAt, context}` shape
 * as bwm.badges.v1), the current rematch series, the (retired, migration-source) global team name, and the
 * per-pairing team names (owner, 2026-10-20: names belong to pairings — 'offline', 'user:<username>').
 * Sanitized and size-capped.
 */
import { cleanTeamName } from '@spades/protocol';

export interface ProgressBadge { id: string; earnedAt: number; context?: Record<string, unknown> }
export interface Progress { v: 1; badges: ProgressBadge[]; series: unknown | null; teamName: string | null; teamNames: Record<string, string> }

const MAX_BADGES = 200;
const MAX_SERIES_CHARS = 60_000;
const MAX_CONTEXT_CHARS = 600;
const MAX_PAIR_NAMES = 64;
const PAIR_KEY = /^[a-z0-9][a-z0-9:._-]{0,63}$/;

/** Clean a per-pairing team-name map: sane keys only, every value through cleanTeamName, capped. */
export function sanitizeTeamNames(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_PAIR_NAMES) break;
    const key = k.trim().toLowerCase();
    if (!PAIR_KEY.test(key) || typeof v !== 'string') continue;
    const name = cleanTeamName(v);
    if (name) out[key] = name;
  }
  return out;
}

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
  return { v: 1, badges, series, teamName: team || null, teamNames: sanitizeTeamNames(r.teamNames) };
}

/** Union of badges (earliest earn wins); the device's series / team name fill in what the account doesn't have.
 *  Pairing names merge per key the same way: the account's name for a pairing wins, the device fills gaps. */
export function mergeProgress(account: Progress | null, device: Progress): Progress {
  if (!account) return device;
  const byId = new Map(account.badges.map((b) => [b.id, b]));
  for (const b of device.badges) {
    const a = byId.get(b.id);
    if (!a || (b.earnedAt && b.earnedAt < a.earnedAt)) byId.set(b.id, b);
  }
  return { v: 1, badges: [...byId.values()].slice(0, MAX_BADGES), series: account.series ?? device.series, teamName: account.teamName ?? device.teamName, teamNames: { ...device.teamNames, ...account.teamNames } };
}
