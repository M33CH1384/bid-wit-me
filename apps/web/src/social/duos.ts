/**
 * BWM Central Phase 3 — duo pair cards for the Rankings "Duos" section.
 * The duos board row (server boards.ts) is the PAIR's own record:
 * `value` = the pair's wins together, `games` = the pair's games,
 * `extra` = the pair's win % as a display string, `name` = "A + B".
 * The card derives W–L from that same row (wins / games − wins) — the
 * pair's record only, NEVER a sum or combination of the two players'
 * individual ratings (there is no rating field on a duo row at all).
 * A team name renders only when a row actually carries one; today's
 * payload does not, so teamName is null and the card omits it.
 */
export interface DuoRow {
  rank: number;
  id: string;
  name: string;
  /** the pair's wins together */
  value: number;
  games: number;
  /** the pair's win %, display string from the payload ('70%') */
  extra?: string;
  /** not carried by today's payload — rendered only if it ever is */
  teamName?: string | null;
}

export interface DuoCard {
  rank: number;
  names: string[];
  teamName: string | null;
  wins: number;
  losses: number;
  winPct: string | null;
  games: number;
}

export function duoCardFromRow(r: DuoRow): DuoCard {
  return {
    rank: r.rank,
    names: r.name.split(' + ').map((n) => n.trim()).filter(Boolean),
    teamName: r.teamName ?? null,
    wins: r.value,
    losses: Math.max(0, r.games - r.value),
    winPct: r.extra ?? null,
    games: r.games,
  };
}
