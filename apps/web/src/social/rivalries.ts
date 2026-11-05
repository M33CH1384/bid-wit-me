/**
 * BWM Central Phase 2 — rivalry derivation (pure). A rivalry is the
 * caller's head-to-head record against one opponent from the social
 * profile payload (h2h: the SUBJECT's wins/losses — for the caller's own
 * profile, "wins" are the caller's). The last meeting is only ever read
 * off the recent results feed, and only when the pair sat on OPPOSITE
 * sides of that feed row: a game they played as partners is not a
 * meeting of rivals, and a rivalry whose latest meeting is not in the
 * feed has no anchor — callers must not invent one (no last meeting, no
 * Run It Back).
 */
import type { RecentResult } from './LeagueTicker';

export interface H2hRow { id: string; name: string; games: number; wins: number; losses: number }

export interface RivalryCard {
  /** the opponent's social pid ('u:<account id>') from the h2h payload */
  id: string;
  name: string;
  games: number;
  /** the caller's wins / losses against this opponent */
  wins: number;
  losses: number;
  /** one decimal, from the real record; null when there are no games */
  winPct: number | null;
  tied: boolean;
  /** who leads the series: the leader's name, or null when ALL SQUARE */
  leaderName: string | null;
  /** the pair's latest meeting AS FOUND IN THE FEED, else null */
  lastMeeting: RecentResult | null;
  /** the feed row's mode — the only honest basis for a Run It Back.
   *  Null when there is no anchored meeting: no re-run is offered. */
  runItBackMode: string | null;
  /** the names on the opponent's side of that feed row (the re-run's
   *  opposing side, exactly as the record names them) */
  lastMeetingOpponents: string[];
}

/** The pair's latest meeting in the feed: newest row (feed order) where
 *  the two names sit on different sides. */
export function lastMeetingInFeed(results: RecentResult[], myName: string, oppName: string): RecentResult | null {
  for (const r of results) {
    const mine = r.sides.findIndex((s) => s.names.includes(myName));
    if (mine < 0) continue;
    const theirs = r.sides.findIndex((s, i) => i !== mine && s.names.includes(oppName));
    if (theirs >= 0) return r;
  }
  return null;
}

export function buildRivalries(h2h: H2hRow[], results: RecentResult[], myName: string | null): RivalryCard[] {
  const rows = [...h2h].sort((a, b) =>
    b.games - a.games
    || Math.abs(a.wins - a.losses) - Math.abs(b.wins - b.losses)
    || a.name.localeCompare(b.name));
  return rows.map((r) => {
    const meeting = myName ? lastMeetingInFeed(results, myName, r.name) : null;
    const oppSide = meeting?.sides.find((s) => s.names.includes(r.name));
    const tied = r.games > 0 && r.wins === r.losses;
    return {
      id: r.id,
      name: r.name,
      games: r.games,
      wins: r.wins,
      losses: r.losses,
      winPct: r.games ? Math.round((1000 * r.wins) / r.games) / 10 : null,
      tied,
      leaderName: tied ? null : r.wins > r.losses ? myName : r.name,
      lastMeeting: meeting,
      runItBackMode: meeting?.mode ?? null,
      lastMeetingOpponents: oppSide ? [...oppSide.names] : [],
    };
  });
}
