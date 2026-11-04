import type { RewardsData } from './GameOverRewards';

/**
 * The finished-match rewards stash (sessionStorage). It began as the hand-off
 * to the dedicated /rewards screen (Demetrius 2026-10-19); since the victory
 * consolidation (2026-11-01) the report renders AT THE TABLE on the merged
 * victory screen, and the stash's job is persistence: Table writes it when the
 * merged screen presents, so a reload that strands the screen mid-show (a
 * refresh, an OAuth sign-in round-trip) can re-present it — the level-up card
 * takeover (dismissal-only retirement) and a held guest claim both ride it.
 * See VictoryRecovery.tsx for the re-presentation rules.
 */
export interface RewardsPayload {
  data: RewardsData;
  /** the finished match was an online table game */
  online: boolean;
  /** where the recovery surface's Home button lands ('/' normally,
   *  '/online' after Change mode online) */
  homePath: string;
  /** the finished match was a Story Mode stop game: its stop id. A rematch
   *  returns to THAT stop (story-scoped) — never to a generic autostart game
   *  built from the player's saved settings. Absent for non-story matches. */
  storyStopId?: string;
  /** the finished offline match's client game id (localGameId) — ties an
   *  unsigned breakdown to its pending rewards claim. Absent online. */
  gameId?: string;
  /** the finished offline match's seat names, in seat order ('You' first).
   *  A recovery-surface Rematch deals this exact table back (see
   *  stashRematchSeats below). Absent for online matches, story matches
   *  and stashes written by older builds. */
  seatNames?: string[];
}

/**
 * Where the standalone recovery surface's Rematch button goes. A story match
 * rematches its own stop: the story route consumes ?rematch=<stopId> and
 * starts that stop again from the story snapshot (venue, twist, house deck,
 * names, attempt context). Every other match keeps the long-standing targets:
 * online back to the lobby, offline to a generic autostart game.
 */
export function rematchPathFor(p: RewardsPayload): string {
  if (p.storyStopId) return `/story?rematch=${encodeURIComponent(p.storyStopId)}`;
  return p.online ? '/online' : '/?autostart=1';
}

const REMATCH_SEATS_KEY = 'bwm.rematchSeats.v1';

/**
 * The recovery surface's Rematch hand-off (owner, 2026-11-04: a rematch
 * must deal the same table back). VictoryRecovery's Rematch writes the
 * finished offline game's seats here in the same click that navigates to
 * the autostart; App's autostart branch consumes them (read + remove) and
 * only then treats the start as a rematch — same table, series tally
 * kept. Nothing else writes or reads this key, so a plain autostart (a
 * test start, a bookmark) can never inherit another game's seats.
 */
export function stashRematchSeats(names: readonly string[]): void {
  try { sessionStorage.setItem(REMATCH_SEATS_KEY, JSON.stringify([...names])); } catch { /* private mode: the rematch still starts, just at a fresh table */ }
}

export function consumeRematchSeats(): string[] | null {
  try {
    const raw = sessionStorage.getItem(REMATCH_SEATS_KEY);
    sessionStorage.removeItem(REMATCH_SEATS_KEY); // consumed either way: a stale or bad value must not ride twice
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) && v.length >= 3 && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
  } catch { return null; }
}

const KEY = 'bwm.rewards.v1';

export function stashRewards(p: RewardsPayload): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode: the in-table screen still shows the report */ }
}

export function loadRewards(): RewardsPayload | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as RewardsPayload;
    return p && p.data ? p : null;
  } catch { return null; }
}

/** The player left through the recovery surface's own actions and no
 *  undismissed takeover grant is riding the stash: the match is done being
 *  presented. (VictoryRecovery keeps the stash when a grant is still
 *  pending — dismissal-only retirement means the next boot owes the player
 *  that celebration; only TAP TO CONTINUE retires it.) */
export function clearRewards(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
