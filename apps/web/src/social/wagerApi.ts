/**
 * Big Bank Take Lil Bank (Phase 2): client for /api/wager-challenges (Phase 1 server core)
 * plus the viewer's own cred summary (unlocks / dev / coins) from /api/profile/me.
 * All same-origin through the Pages proxy, credentials included — the pattern the rest
 * of the app uses (a cross-origin workers.dev fetch would lose the session on iOS).
 */

export interface WagerPlayer {
  uid: string; name: string; role: 'challenger' | 'opponent' | 'partner';
  side: number | null; seat: number | null;
  status: string; escrowed: boolean; checkedIn: boolean;
  /** net coin outcome once the challenge resolves (+won / 0 refunded / −lost); null until then */
  net: number | null;
}

export interface WagerRules {
  mode: string; deck: string; targetScore: number;
  turnTimerSec: { bid: number; play: number };
  playerCount: number; partnerships: boolean;
}

export interface WagerYou {
  role: string; status: string; escrowed: boolean; checkedIn: boolean;
  canAccept: boolean; canCheckin: boolean; canCancel: boolean;
}

/** The full view (GET /:id and every action response). */
export interface WagerView {
  id: string; format: 'partnership' | 'cutthroat'; mode: string; rules: WagerRules;
  wager: number; pot: number; startAt: number; checkinOpensAt: number; createdAt: number;
  status: string; endReason: string | null; tableCode: string | null; gameId: string | null; settledAt: number | null;
  /** partnership: each side's team name for the match, [side 0, side 1] (set by
   *  each side's captain at challenge setup; seeds the match table). */
  teamNames?: [string | null, string | null];
  players: WagerPlayer[]; you: WagerYou | null; now: number;
}

/** The list projection (GET /): no rules, no per-viewer block — derive "you" from players + your uid. */
export interface WagerRow {
  id: string; format: 'partnership' | 'cutthroat'; mode: string;
  wager: number; pot: number; startAt: number; checkinOpensAt: number; createdAt: number;
  status: string; endReason: string | null; tableCode: string | null;
  players: WagerPlayer[];
}

export interface WagerList { challenges: WagerRow[]; now: number; enabled?: boolean }

const get = (u: string) => fetch(u, { credentials: 'same-origin' }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`); return j; });
const post = (u: string, b: unknown = {}) => fetch(u, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`); return j; });

export const fetchWagerList = (): Promise<WagerList> => get('/api/wager-challenges');
export const fetchWager = (id: string): Promise<WagerView> => get(`/api/wager-challenges/${id}`);
export const createWager = (body: Record<string, unknown>): Promise<WagerView> => post('/api/wager-challenges', body);
export const wagerAct = (id: string, action: 'accept' | 'decline' | 'cancel' | 'checkin', body: Record<string, unknown> = {}): Promise<WagerView> =>
  post(`/api/wager-challenges/${id}/${action}`, body);

/** The feature-flag signal on its own, cached briefly: profile surfaces consult it to
 *  decide whether the Challenge button exists at all (flag off → no button). */
let enabledCache: { at: number; v: Promise<boolean> } | null = null;
export function fetchWagerEnabled(): Promise<boolean> {
  if (enabledCache && Date.now() - enabledCache.at < 60_000) return enabledCache.v;
  const v = fetchWagerList().then((j) => j.enabled ?? true).catch(() => false);
  enabledCache = { at: Date.now(), v };
  return v;
}

/* ------------------------------------------------------- your cred summary */

export interface MyCred {
  id: string; name: string;
  unlocks: string[];
  unlockDetails: { itemId: string; unlockedAt: number }[];
  dev: boolean; coins: number; level: number;
}

let credCache: { at: number; p: Promise<MyCred | null> } | null = null;
/** /api/profile/me mapped to what the wager UI needs. Cached ~30 s (pass maxAgeMs 0 to force). */
export function fetchMyCred(maxAgeMs = 30_000): Promise<MyCred | null> {
  if (credCache && Date.now() - credCache.at < maxAgeMs) return credCache.p;
  const p = fetch('/api/profile/me', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j): MyCred | null => (j ? {
      id: j.user.id as string,
      name: j.user.name as string,
      unlocks: ((j.unlocks ?? []) as { itemId: string }[]).map((u) => u.itemId),
      unlockDetails: ((j.unlocks ?? []) as { itemId: string; unlockedAt: number }[]).map((u) => ({ itemId: u.itemId, unlockedAt: u.unlockedAt })),
      dev: !!j.dev,
      coins: (j.coins?.balance ?? 0) as number,
      level: (j.level?.level ?? 1) as number,
    } : null))
    .catch(() => null);
  credCache = { at: Date.now(), p };
  return p;
}
