/**
 * Story Mode API client (same-origin /api/story/* via the Pages proxy, cookie
 * session — the same pattern as the rest of the account APIs).
 */
import type { StoryStopState } from '@spades/bots';
import { fetchVenueUnlocks } from '../venues';

/**
 * STORY_OWNER_ONLY — the client half of the story-mode lock (owner,
 * 2026-10-21): while true, story mode is open only to dev (owner)
 * accounts — the server enforces the same gate with its own
 * STORY_OWNER_ONLY in apps/server/src/story/routes.ts (403 for
 * non-admins). TO OPEN STORY MODE TO EVERYONE: set both flags false.
 */
export const STORY_OWNER_ONLY = true;

/** Locked = the owner-only switch is on and this player is not a dev account.
 *  Unknown dev state (signed out / fetch failed) counts as locked — the same
 *  safe default as the locked-venue picker. */
export function storyLockedFor(dev: boolean | null | undefined): boolean {
  return STORY_OWNER_ONLY && dev !== true;
}

/** The caller's dev flag from /api/profile/me (cached, shared with the venue picker). */
export async function fetchStoryDev(): Promise<boolean | null> {
  const s = await fetchVenueUnlocks();
  return s ? s.dev : null;
}

export interface StoryStopProgress {
  stopId: string;
  n: number;
  state: StoryStopState;
  attempts: number;
  clears: number;
  firstClearedAt: number | null;
  /** the King's double or nothing is live at this stop: beaten once, nothing banked (server truth) */
  doublePending?: boolean;
}

export interface StoryProgress {
  track: string;
  stops: StoryStopProgress[];
  currentStop: number | null;
  completed: boolean;
  completedAt: number | null;
  completionMark: string | null;
  /** found Easter egg ids + earned feat itemIds on this track */
  finds: { eggs: string[]; feats: string[] };
}

export interface StoryNewFind { kind: 'egg' | 'feat'; id: string; name: string }

export interface StoryResult extends StoryProgress {
  ok: boolean;
  replayed: boolean;
  stopId: string;
  won: boolean;
  firstClear: boolean;
  rewards: { xp: number; coins: number };
  /** secrets granted by this result (feats / match-event eggs) */
  newFinds: StoryNewFind[];
  completed: boolean;
  /** the King's double, when this post moved it: 'started' | 'cleared' | 'lost' */
  doubleOutcome?: 'started' | 'cleared' | 'lost' | null;
  /** the King's double is live after this post (leg 1 banked, leg 2 owed) */
  doublePending?: boolean;
}

export type ProgressFetch =
  | { status: 'ok'; progress: StoryProgress }
  | { status: 'signedOut' }
  | { status: 'locked' }
  | { status: 'error' };

export async function fetchStoryProgress(track = 'solo'): Promise<ProgressFetch> {
  try {
    const r = await fetch(`/api/story/progress?track=${encodeURIComponent(track)}`, { headers: { accept: 'application/json' } });
    if (r.status === 401) return { status: 'signedOut' };
    if (r.status === 403) return { status: 'locked' };
    if (!r.ok) return { status: 'error' };
    return { status: 'ok', progress: (await r.json()) as StoryProgress };
  } catch {
    return { status: 'error' };
  }
}

/** Record a finished stop game. Returns null when the write failed (offline, signed out, server error). */
export async function postStoryResult(stopId: string, won: boolean, gameId: string, facts?: import('@spades/bots').StoryGameFacts): Promise<StoryResult | null> {
  try {
    const r = await fetch('/api/story/result', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ track: 'solo', stopId, won, gameId, facts }),
    });
    if (!r.ok) return null;
    return (await r.json()) as StoryResult;
  } catch {
    return null;
  }
}

/**
 * Story session pings (call-backs): the story save is device-local, so the
 * server can only know a story match is open if the client says so. The
 * story save slot reports 'open' when a match is saved (throttled — the
 * save fires on every state change) and 'closed' when the slot clears.
 * The server stamps its own receive time for the nudge schedule; savedAt
 * rides along for debugging only. Fire-and-forget: a failed ping costs a
 * call-back, never a game.
 */
const SESSION_PING_MIN_MS = 10 * 60_000;
let lastOpenPing: { key: string; at: number } | null = null;

export function reportStorySession(state: 'open' | 'closed', stopId: string, track = 'solo'): void {
  try {
    if (typeof fetch !== 'function') return;
    const key = `${track}:${stopId}`;
    const now = Date.now();
    if (state === 'open') {
      if (lastOpenPing && lastOpenPing.key === key && now - lastOpenPing.at < SESSION_PING_MIN_MS) return;
      lastOpenPing = { key, at: now };
    } else if (lastOpenPing?.key === key) {
      lastOpenPing = null; // a new sitting at this stop gets its first ping immediately
    }
    void fetch('/api/story/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ state, stopId, track, savedAt: now }),
      keepalive: true,
    }).catch(() => undefined);
  } catch { /* offline / private mode: no ping, no problem */ }
}

/** Test seam: forget the open-ping throttle (module state is per page load). */
export function resetStorySessionPings(): void {
  lastOpenPing = null;
}

/** Owner-only dev tool: reset ONE stop on the caller's solo track (the
 *  server wipes its progress/claims/finds/session rows; XP and coins
 *  already earned are NOT clawed back) so its next win presents as a
 *  first clear again. The server answers 403 to non-admins; the control
 *  that calls this renders only for dev accounts. Returns the fresh
 *  progress, or null when the reset failed. */
export async function postStoryResetStop(stopId: string): Promise<StoryProgress | null> {
  try {
    const r = await fetch('/api/story/reset-stop', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ track: 'solo', stopId }),
    });
    if (!r.ok) return null;
    return (await r.json()) as StoryProgress;
  } catch {
    return null;
  }
}

/** Report a scene-side Easter egg find (sceneTap / deeTap / chain). The
 *  server validates the trigger type and any chain fact; match-event eggs
 *  are only ever granted from result facts. Returns the fresh progress. */
export async function postStoryFound(eggId: string): Promise<StoryProgress | null> {
  try {
    const r = await fetch('/api/story/found', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ track: 'solo', eggId }),
    });
    if (!r.ok) return null;
    return (await r.json()) as StoryProgress;
  } catch {
    return null;
  }
}

