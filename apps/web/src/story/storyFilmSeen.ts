/**
 * Story film seen-state (Chapter 1): which film scenes this track has
 * been OFFERED, and which posted games the outcome scenes were offered
 * for. MANIFEST-CH1.json specifies the semantics per scene; this module
 * is only the store.
 *
 * Modeled on the story save slot (storySave.ts) and the rundown heard
 * store (DeeRundown.tsx): its OWN versioned localStorage key —
 * 'bwm.storyFilm.v1' — never the story save's key, never the normal
 * game's. Two record shapes:
 *   - seen:    seenKey ('film.ch1.teaser' …) → when it was offered.
 *              Written ON OFFER, not on watch-to-end: a skipped or
 *              failed scene still counts as offered (the manifest's
 *              rule), so a scene can never nag twice.
 *   - offered: sceneId → the posted gameId it was last offered for.
 *              The advance-once key for the outcome scenes: re-entering
 *              an outro for the same game never re-offers its scene.
 *
 * Account binding (the storySaveValidFor discipline): the record
 * carries the id of the account whose progress it was written against,
 * and a load for a different account reads as EMPTY — a second player
 * on the same device never inherits the first player's seen flags.
 * Selection (storyFilm.ts) additionally reads server progress facts,
 * so a stale record is disarmed twice over. Corrupt or foreign
 * payloads read as empty and are overwritten on the next write; the
 * store never throws.
 */

export const FILM_SEEN_KEY = 'bwm.storyFilm.v1';

export interface FilmSeenState {
  v: 1;
  userId: string | null;
  /** seenKey -> offered-at timestamp (ms) */
  seen: Record<string, number>;
  /** sceneId -> posted gameId last offered */
  offered: Record<string, string>;
}

export function emptyFilmSeen(userId: string | null): FilmSeenState {
  return { v: 1, userId, seen: {}, offered: {} };
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** Parse + validate a raw payload for THIS account. Anything off —
 *  wrong version, another account's record, mistyped fields — reads
 *  as the empty state for the asking account. */
export function parseFilmSeen(raw: string | null, userId: string | null): FilmSeenState {
  if (!raw) return emptyFilmSeen(userId);
  try {
    const d = JSON.parse(raw) as Partial<FilmSeenState>;
    if (!isRecord(d) || d.v !== 1 || d.userId !== userId) return emptyFilmSeen(userId);
    const seen: Record<string, number> = {};
    if (isRecord(d.seen)) {
      for (const [k, v] of Object.entries(d.seen)) if (typeof v === 'number') seen[k] = v;
    }
    const offered: Record<string, string> = {};
    if (isRecord(d.offered)) {
      for (const [k, v] of Object.entries(d.offered)) if (typeof v === 'string') offered[k] = v;
    }
    return { v: 1, userId, seen, offered };
  } catch {
    return emptyFilmSeen(userId);
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function loadFilmSeen(userId: string | null, storage: StorageLike | null = defaultStorage()): FilmSeenState {
  if (!storage) return emptyFilmSeen(userId);
  try { return parseFilmSeen(storage.getItem(FILM_SEEN_KEY), userId); }
  catch { return emptyFilmSeen(userId); }
}

export function storeFilmSeen(state: FilmSeenState, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try { storage.setItem(FILM_SEEN_KEY, JSON.stringify(state)); } catch { /* quota / private mode: scenes just re-offer next visit */ }
}

export function isFilmKeySeen(state: FilmSeenState, seenKey: string): boolean {
  return typeof state.seen[seenKey] === 'number';
}

/** Record a once-per-track scene as offered (mutates + returns the state). */
export function markFilmKeySeen(state: FilmSeenState, seenKey: string, at: number = Date.now()): FilmSeenState {
  if (!isFilmKeySeen(state, seenKey)) state.seen[seenKey] = at;
  return state;
}

export function offeredGameId(state: FilmSeenState, sceneId: string): string | null {
  return state.offered[sceneId] ?? null;
}

/** Record an outcome scene as offered for a posted game (mutates + returns). */
export function markFilmOffered(state: FilmSeenState, sceneId: string, gameId: string): FilmSeenState {
  state.offered[sceneId] = gameId;
  return state;
}
