/**
 * Story Mode API client (same-origin /api/story/* via the Pages proxy, cookie
 * session — the same pattern as the rest of the account APIs).
 */
import type { StoryStopState } from '@spades/bots';

export interface StoryStopProgress {
  stopId: string;
  n: number;
  state: StoryStopState;
  attempts: number;
  clears: number;
  firstClearedAt: number | null;
}

export interface StoryProgress {
  track: string;
  stops: StoryStopProgress[];
  currentStop: number | null;
  completed: boolean;
  completedAt: number | null;
  completionMark: string | null;
}

export interface StoryResult extends StoryProgress {
  ok: boolean;
  replayed: boolean;
  stopId: string;
  won: boolean;
  firstClear: boolean;
  rewards: { xp: number; coins: number };
  completed: boolean;
}

export type ProgressFetch =
  | { status: 'ok'; progress: StoryProgress }
  | { status: 'signedOut' }
  | { status: 'error' };

export async function fetchStoryProgress(track = 'solo'): Promise<ProgressFetch> {
  try {
    const r = await fetch(`/api/story/progress?track=${encodeURIComponent(track)}`, { headers: { accept: 'application/json' } });
    if (r.status === 401) return { status: 'signedOut' };
    if (!r.ok) return { status: 'error' };
    return { status: 'ok', progress: (await r.json()) as StoryProgress };
  } catch {
    return { status: 'error' };
  }
}

/** Record a finished stop game. Returns null when the write failed (offline, signed out, server error). */
export async function postStoryResult(stopId: string, won: boolean, gameId: string): Promise<StoryResult | null> {
  try {
    const r = await fetch('/api/story/result', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ track: 'solo', stopId, won, gameId }),
    });
    if (!r.ok) return null;
    return (await r.json()) as StoryResult;
  } catch {
    return null;
  }
}
