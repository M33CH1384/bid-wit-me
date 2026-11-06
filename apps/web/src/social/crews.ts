/**
 * BWM Central Phase 3 — the Crews contract (Phase 3 server lane), kept
 * pure so the UI (Crews.tsx) renders whatever shape lands and degrades
 * honestly when the endpoints are not there yet:
 *   GET  /api/social/crews                 → { crews, invites }
 *   POST /api/social/crews                 → create { name }
 *   POST /api/social/crews/:id/invite      → { userId }
 *   POST /api/social/crews/:id/respond     → { accept }
 *   POST /api/social/crews/:id/leave
 *   GET  /api/social/crews/:id/leaderboard?board&kind&period → { rows }
 * Crew standings are opt-in by construction: only crew members see a
 * crew's board (the server serves members only; the UI says so).
 */
export interface CrewMember { userId: string; name: string | null; role: string | null }
export interface Crew {
  id: string;
  name: string;
  ownerId: string | null;
  members: CrewMember[];
  /** null when the payload doesn't carry a count — never guessed */
  memberCount: number | null;
  /** the caller's role in this crew, when the payload carries it */
  role: string | null;
}
export interface CrewInvite { id: string | null; crewId: string; crewName: string; fromName: string | null }

export interface CrewsPayload { crews: Crew[]; invites: CrewInvite[] }

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export function normalizeCrewsPayload(raw: unknown): CrewsPayload {
  const root = obj(raw);
  const crewsRaw = Array.isArray(root.crews) ? root.crews : [];
  const crews: Crew[] = [];
  for (const c of crewsRaw) {
    const o = obj(c);
    const id = str(o.id);
    const name = str(o.name);
    if (!id || !name) continue;
    const membersRaw = Array.isArray(o.members) ? o.members : [];
    const members: CrewMember[] = membersRaw.flatMap((m) => {
      const mo = obj(m);
      const userId = str(mo.userId) ?? str(mo.id);
      return userId ? [{ userId, name: str(mo.name), role: str(mo.role) }] : [];
    });
    crews.push({
      id,
      name,
      ownerId: str(o.ownerId) ?? str(o.owner_id),
      members,
      memberCount: typeof o.memberCount === 'number' ? o.memberCount : members.length ? members.length : null,
      role: str(o.role) ?? str(o.myRole),
    });
  }
  const invitesRaw = Array.isArray(root.invites) ? root.invites : [];
  const invites: CrewInvite[] = [];
  for (const iv of invitesRaw) {
    const o = obj(iv);
    const crew = obj(o.crew);
    const crewId = str(o.crewId) ?? str(o.crew_id) ?? str(crew.id);
    const crewName = str(o.crewName) ?? str(crew.name);
    if (!crewId || !crewName) continue;
    invites.push({ id: str(o.id), crewId, crewName, fromName: str(o.fromName) ?? str(o.inviterName) });
  }
  return { crews, invites };
}

export interface CrewBoardQuery { board: string; kind: string; period: string }

export function crewLeaderboardUrl(crewId: string, q: CrewBoardQuery): string {
  return `/api/social/crews/${encodeURIComponent(crewId)}/leaderboard?board=${q.board}&kind=${q.kind}&period=${q.period}`;
}
