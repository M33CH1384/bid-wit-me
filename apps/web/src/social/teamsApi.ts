/**
 * Team rosters (owner, 2026-11-05) — client for the roster endpoints
 * (GET /api/social/teams, DELETE /api/social/teams/:owner/:name/members/:id;
 * server: social/routes.ts + stats/rosters.ts). A team name is an owned
 * team: the owner plus up to 3 human partners. Bot partners never take a
 * spot and never pass through here. Ids are RAW account ids on this API;
 * social surfaces that carry 'u:'-prefixed pids normalize via favorites.ts.
 */
import { normalizeUserId } from './favorites';

export interface TeamRosterMember { id: string; name: string }
export interface TeamRoster { name: string; members: TeamRosterMember[]; full: boolean }

/** My rosters on my team list (signed in; throws when signed out / offline). */
export async function fetchMyTeams(): Promise<TeamRoster[]> {
  const r = await fetch('/api/social/teams', { credentials: 'same-origin' });
  const j = (await r.json().catch(() => ({}))) as { teams?: TeamRoster[] };
  if (!r.ok) throw new Error('team rosters unavailable');
  return j.teams ?? [];
}

/** Eject one member from my roster for `teamName`; returns the roster as
 *  the server now sees it, so the caller can swap it in place. */
export async function ejectTeamMember(ownerId: string, teamName: string, memberId: string): Promise<TeamRoster> {
  const url = `/api/social/teams/${encodeURIComponent(normalizeUserId(ownerId))}/${encodeURIComponent(teamName)}/members/${encodeURIComponent(normalizeUserId(memberId))}`;
  const r = await fetch(url, { method: 'DELETE', credentials: 'same-origin' });
  const j = (await r.json().catch(() => ({}))) as TeamRoster & { error?: string };
  if (!r.ok) throw new Error(j.error ?? 'eject failed');
  return j;
}

/**
 * The table-setup block (owner, 2026-11-05): naming your side with a name
 * whose roster is FULL, while your seated partner is a signed-in human who
 * is not on that roster, would field a team that cannot take them — refuse
 * in plain words and say the way out. Everyone else passes: members, open
 * spots, bot partners, guests (no account — they hold no spot), an empty
 * partner seat, and a roster we don't know yet (new name / still loading —
 * the server join at record time is the backstop).
 */
export function rosterBlock(
  roster: TeamRoster | undefined,
  partner: { uid?: string | null; name?: string | null } | null | undefined,
): string | null {
  if (!roster || !partner?.uid) return null;
  const pid = normalizeUserId(partner.uid);
  if (roster.members.some((m) => normalizeUserId(m.id) === pid)) return null;
  if (!roster.full) return null;
  const who = partner.name?.trim() ? partner.name : 'Your partner';
  return `“${roster.name}” is full — you plus 3 partners hold its spots, and ${who} isn’t one of them. Eject someone from the roster in My Career, or use a different name.`;
}
