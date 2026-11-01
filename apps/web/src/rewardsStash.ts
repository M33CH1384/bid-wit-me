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
