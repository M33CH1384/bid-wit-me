/**
 * Offline games for a signed-in player: queue in localStorage and POST /api/stats/local.
 * The server rebuilds the record. A failed post stays queued and retries when the browser is online again.
 */
import type { GameState } from '@spades/rules';
import { account } from './account/api';

const KEY = 'bwm.offlineQueue';
const MAX = 20;

export interface LocalGamePost {
  clientGameId: string;
  startedAt: number;
  endedAt: number;
  names: string[];
  teamNames: (string | null)[] | null;
  game: GameState;
}

/** The client game id for an offline match seed — one derivation shared by the game report, the rewards stash, and the pending-claim slot. */
export function localGameId(seed: string): string {
  return `local-${seed}`.padEnd(8, '0').slice(0, 80);
}

interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function shouldQueue(ready: boolean, userId: string | null | undefined): boolean {
  return !ready || !!userId;
}

export function enqueueLocal(queue: LocalGamePost[], item: LocalGamePost): LocalGamePost[] {
  return [...queue.filter((x) => x.clientGameId !== item.clientGameId), item].slice(-MAX);
}

/** 2xx and 400 are done (saved, duplicate, or rejected). Anything else stays queued. */
export function keepQueued(status: number): boolean {
  if (status >= 200 && status < 300) return false;
  if (status === 400 || status === 413) return false;
  return true;
}

function read(storage: Store): LocalGamePost[] {
  try {
    const v = JSON.parse(storage.getItem(KEY) ?? 'null');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.clientGameId === 'string' && x.game) : [];
  } catch { return []; }
}
function write(storage: Store, q: LocalGamePost[]): void {
  try { storage.setItem(KEY, JSON.stringify(q)); } catch { /* full */ }
}

export function noteLocalGame(item: LocalGamePost, storage: Store = localStorage): void {
  const a = account.get();
  if (!shouldQueue(a.ready, a.user?.id)) return;
  write(storage, enqueueLocal(read(storage), item));
  watchLocalGames();
  void flushLocalGames(storage);
}

export async function flushLocalGames(storage: Store = localStorage, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const a = account.get();
  if (!a.user?.id) return;
  const keep: LocalGamePost[] = [];
  for (const item of read(storage)) {
    try {
      const r = await fetchImpl('/api/stats/local', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item),
      });
      if (keepQueued(r.status)) keep.push(item);
    } catch { keep.push(item); }
  }
  write(storage, keep);
}

let listening = false;
export function watchLocalGames(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  const kick = () => { void flushLocalGames(); };
  window.addEventListener('online', kick);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
  // a game can end before /api/auth/me returns; flush again once the account is known
  account.subscribe(kick);
}
