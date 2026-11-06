/**
 * BWM Central Phase 3 (server): migration 0037 (crew_members.status) and the
 * crews endpoints — create / list / invite / respond / leave / crew
 * leaderboard — plus the leaderboard() id-set generalization (friendIds was
 * Phase 1's special case; the friends scope must stay unchanged).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { sha256b64 } from '../src/auth/providers';
import { leaderboard } from '../src/stats/boards';
import { handleSocialHttp } from '../src/social/routes';

let db: D1Database;
const NOW = 1_800_000_000_000;
const ORIGIN = 'https://bid-wit-me.pages.dev';

async function user(id: string, name = id.toUpperCase()) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind(id, name, id.toLowerCase()).run();
}
async function session(uid: string, tok: string) {
  await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256b64(tok), uid, 1, NOW + 10_000_000).run();
  return { cookie: `__Host-bwm_sid=${tok}` };
}
const call = (path: string, parts: string[], headers?: Record<string, string>, method = 'GET', body?: unknown) => {
  const url = new URL(path, ORIGIN);
  const init: RequestInit = { method, headers: body !== undefined ? { ...headers, 'content-type': 'application/json' } : headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return handleSocialHttp(new Request(url, init), { DB: db, PUBLIC_ORIGIN: ORIGIN }, url, parts, NOW);
};

/** accepted friendship (friends table stores the pair ordered a < b) */
async function befriend(x: string, y: string) {
  const [a, b] = x < y ? [x, y] : [y, x];
  await db.prepare("INSERT INTO friends (a, b, status, requested_by, created_at) VALUES (?, ?, 'friends', ?, 1)").bind(a, b, x).run();
}
async function pendingFriend(x: string, y: string) {
  const [a, b] = x < y ? [x, y] : [y, x];
  await db.prepare("INSERT INTO friends (a, b, status, requested_by, created_at) VALUES (?, ?, 'pending', ?, 1)").bind(a, b, x).run();
}

interface CrewMember { userId: string; name: string; role: string; status: string }
interface Crew { id: string; name: string; ownerId: string; members: CrewMember[] }

async function createCrew(headers: Record<string, string>, name = 'Kings'): Promise<Crew> {
  const res = await call('/api/social/crews', ['api', 'social', 'crews'], headers, 'POST', { name });
  expect(res.status).toBe(200);
  return ((await res.json()) as { crew: Crew }).crew;
}
const invite = (id: string, headers: Record<string, string>, userId: string) =>
  call(`/api/social/crews/${id}/invite`, ['api', 'social', 'crews', id, 'invite'], headers, 'POST', { userId });
const respond = (id: string, headers: Record<string, string>, accept: boolean) =>
  call(`/api/social/crews/${id}/respond`, ['api', 'social', 'crews', id, 'respond'], headers, 'POST', { accept });
const leave = (id: string, headers: Record<string, string>) =>
  call(`/api/social/crews/${id}/leave`, ['api', 'social', 'crews', id, 'leave'], headers, 'POST', {});
const listCrews = async (headers?: Record<string, string>) => {
  const res = await call('/api/social/crews', ['api', 'social', 'crews'], headers);
  return { status: res.status, body: (await res.json()) as { crews: Crew[]; invites: Crew[] } };
};

let ha: Record<string, string>;
let hb: Record<string, string>;
let hc: Record<string, string>;
let hd: Record<string, string>;

beforeEach(async () => {
  db = await makeD1();
  for (const u of ['a', 'b', 'c', 'd']) await user(u);
  ha = await session('a', 'tok-a');
  hb = await session('b', 'tok-b');
  hc = await session('c', 'tok-c');
  hd = await session('d', 'tok-d');
});

/* ---------------------------------------------------------- migration */

describe('migration 0037', () => {
  it("crew_members gains a status column defaulting to 'active'", async () => {
    const cols = (await db.prepare('PRAGMA table_info(crew_members)').all<{ name: string }>()).results.map((r) => r.name);
    expect(cols).toContain('status');
    // a 0036-shaped insert (no status) lands as an active member
    await db.prepare("INSERT INTO crews (id, name, owner_id, created_at) VALUES ('k1', 'Kings', 'a', 1)").run();
    await db.prepare("INSERT INTO crew_members (crew_id, user_id, role, joined_at) VALUES ('k1', 'a', 'owner', 1)").run();
    expect(await db.prepare("SELECT status FROM crew_members WHERE crew_id = 'k1' AND user_id = 'a'").first()).toEqual({ status: 'active' });
    await db.prepare("INSERT INTO crew_members (crew_id, user_id, role, joined_at, status) VALUES ('k1', 'b', 'member', 2, 'invited')").run();
    expect(await db.prepare("SELECT status FROM crew_members WHERE crew_id = 'k1' AND user_id = 'b'").first()).toEqual({ status: 'invited' });
  });
});

/* ------------------------------------------------- leaderboard id-set */

describe('leaderboard id-set generalization', () => {
  beforeEach(async () => {
    await db.prepare("INSERT INTO ratings (user_id, kind, elo, games, peak, updated_at) VALUES ('a','team',1260,3,1260,1),('b','team',1230,3,1240,1),('c','team',1180,3,1200,1),('d','team',1150,3,1200,1)").run();
  });

  it('idSet keeps only the set; friendIds alias behaves identically; no set is the unchanged global board', async () => {
    const viaSet = await leaderboard(db, { board: 'rating', kind: 'team', period: 'all', region: null, idSet: ['b', 'd'], now: NOW });
    expect(viaSet.map((r) => r.name)).toEqual(['B', 'D']);
    const viaAlias = await leaderboard(db, { board: 'rating', kind: 'team', period: 'all', region: null, friendIds: ['b', 'd'], now: NOW });
    expect(viaAlias).toEqual(viaSet);
    const global = await leaderboard(db, { board: 'rating', kind: 'team', period: 'all', region: null, now: NOW });
    expect(global.map((r) => r.name)).toEqual(['A', 'B', 'C', 'D']);
    const empty = await leaderboard(db, { board: 'rating', kind: 'team', period: 'all', region: null, idSet: [], now: NOW });
    expect(empty).toEqual([]);
  });
});

/* ------------------------------------------------------------- create */

describe('POST /api/social/crews', () => {
  it('requires sign-in', async () => {
    const res = await call('/api/social/crews', ['api', 'social', 'crews'], undefined, 'POST', { name: 'Kings' });
    expect(res.status).toBe(401);
  });

  it('creates a crew: name trimmed, creator is owner + active member', async () => {
    const crew = await createCrew(ha, '  Kings of the Block  ');
    expect(crew.name).toBe('Kings of the Block');
    expect(crew.ownerId).toBe('a');
    expect(crew.id).toBeTruthy();
    expect(crew.members).toEqual([{ userId: 'a', name: 'A', role: 'owner', status: 'active' }]);
  });

  it('rejects empty, whitespace-only and over-long names; 40 chars is fine', async () => {
    for (const name of ['', '   ', 'x'.repeat(41)]) {
      const res = await call('/api/social/crews', ['api', 'social', 'crews'], ha, 'POST', { name });
      expect(res.status).toBe(400);
    }
    const ok = await call('/api/social/crews', ['api', 'social', 'crews'], ha, 'POST', { name: 'x'.repeat(40) });
    expect(ok.status).toBe(200);
  });
});

/* --------------------------------------------------------------- list */

describe('GET /api/social/crews', () => {
  it('requires sign-in', async () => {
    expect((await listCrews()).status).toBe(401);
  });

  it('splits active crews from invites; a stranger sees neither; vanished members are omitted', async () => {
    await befriend('a', 'b');
    const crew = await createCrew(ha);
    expect((await invite(crew.id, ha, 'b')).status).toBe(200);
    // a member row whose account vanished must not surface in members
    await db.prepare("INSERT INTO crew_members (crew_id, user_id, role, joined_at, status) VALUES (?, 'gone', 'member', 3, 'active')").bind(crew.id).run();

    const mine = await listCrews(ha);
    expect(mine.status).toBe(200);
    expect(mine.body.invites).toEqual([]);
    expect(mine.body.crews).toHaveLength(1);
    expect(mine.body.crews[0]!.members.map((m) => m.userId)).toEqual(['a', 'b']); // 'gone' omitted

    const theirs = await listCrews(hb);
    expect(theirs.body.crews).toEqual([]);
    expect(theirs.body.invites).toHaveLength(1);
    expect(theirs.body.invites[0]!.id).toBe(crew.id);
    const bRow = theirs.body.invites[0]!.members.find((m) => m.userId === 'b');
    expect(bRow).toMatchObject({ role: 'member', status: 'invited' });

    const stranger = await listCrews(hd);
    expect(stranger.body).toEqual({ crews: [], invites: [] });
  });
});

/* ------------------------------------------------------------- invite */

describe('POST /api/social/crews/:id/invite', () => {
  it('only an ACTIVE member may invite (403 for non-members and invited-only callers)', async () => {
    await befriend('a', 'b');
    await befriend('a', 'c');
    await befriend('b', 'c');
    const crew = await createCrew(ha);
    expect((await invite(crew.id, hd, 'c')).status).toBe(403); // d is not in the crew at all
    expect((await invite(crew.id, ha, 'b')).status).toBe(200);
    expect((await invite(crew.id, hb, 'c')).status).toBe(403); // b is merely invited
    expect((await invite('no-such-crew', ha, 'c')).status).toBe(403);
  });

  it('the target must be an ACCEPTED friend of the caller (400 for strangers and pending friends)', async () => {
    await pendingFriend('a', 'c');
    const crew = await createCrew(ha);
    expect((await invite(crew.id, ha, 'd')).status).toBe(400); // no friends row at all
    expect((await invite(crew.id, ha, 'c')).status).toBe(400); // pending is not accepted
    expect((await invite(crew.id, ha, 'ghost')).status).toBe(400); // not a friend (and not a user)
    expect(await db.prepare('SELECT COUNT(*) AS n FROM crew_members WHERE crew_id = ?').bind(crew.id).first()).toEqual({ n: 1 });
  });

  it('creates an invited row, is idempotent, and inviting an active member is a no-op', async () => {
    await befriend('a', 'b');
    const crew = await createCrew(ha);
    expect((await invite(crew.id, ha, 'b')).status).toBe(200);
    expect((await invite(crew.id, ha, 'b')).status).toBe(200); // repeat invite
    expect(await db.prepare('SELECT role, status FROM crew_members WHERE crew_id = ? AND user_id = ?').bind(crew.id, 'b').first()).toEqual({ role: 'member', status: 'invited' });
    // the owner is already active: inviting them changes nothing
    expect((await invite(crew.id, ha, 'a')).status).toBe(200);
    expect(await db.prepare('SELECT role, status FROM crew_members WHERE crew_id = ? AND user_id = ?').bind(crew.id, 'a').first()).toEqual({ role: 'owner', status: 'active' });
  });
});

/* ------------------------------------------------------------ respond */

describe('POST /api/social/crews/:id/respond', () => {
  async function invitedCrew() {
    await befriend('a', 'b');
    const crew = await createCrew(ha);
    await invite(crew.id, ha, 'b');
    return crew;
  }

  it('only an INVITED caller may respond (403 for strangers and active members)', async () => {
    const crew = await invitedCrew();
    expect((await respond(crew.id, hd, true)).status).toBe(403);
    expect((await respond(crew.id, ha, true)).status).toBe(403); // owner is active, not invited
  });

  it('accept activates the member and moves the crew from invites to crews', async () => {
    const crew = await invitedCrew();
    expect((await respond(crew.id, hb, true)).status).toBe(200);
    expect(await db.prepare('SELECT status FROM crew_members WHERE crew_id = ? AND user_id = ?').bind(crew.id, 'b').first()).toEqual({ status: 'active' });
    const list = await listCrews(hb);
    expect(list.body.invites).toEqual([]);
    expect(list.body.crews.map((c) => c.id)).toEqual([crew.id]);
  });

  it('decline deletes the row, and a later re-invite works', async () => {
    const crew = await invitedCrew();
    expect((await respond(crew.id, hb, false)).status).toBe(200);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM crew_members WHERE crew_id = ? AND user_id = ?').bind(crew.id, 'b').first()).toEqual({ n: 0 });
    expect((await listCrews(hb)).body).toEqual({ crews: [], invites: [] });
    expect((await invite(crew.id, ha, 'b')).status).toBe(200);
    expect((await listCrews(hb)).body.invites.map((c) => c.id)).toEqual([crew.id]);
  });
});

/* -------------------------------------------------------------- leave */

describe('POST /api/social/crews/:id/leave', () => {
  async function twoMemberCrew() {
    await befriend('a', 'b');
    const crew = await createCrew(ha);
    await invite(crew.id, ha, 'b');
    await respond(crew.id, hb, true);
    return crew;
  }

  it('a plain member leaves and the crew survives without them', async () => {
    const crew = await twoMemberCrew();
    expect((await leave(crew.id, hb)).status).toBe(200);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM crew_members WHERE crew_id = ?').bind(crew.id).first()).toEqual({ n: 1 });
    const list = await listCrews(ha);
    expect(list.body.crews[0]!.members.map((m) => m.userId)).toEqual(['a']);
    expect((await listCrews(hb)).body).toEqual({ crews: [], invites: [] });
  });

  it('when the OWNER leaves, the crew dissolves: crew row and every member row are deleted', async () => {
    const crew = await twoMemberCrew();
    expect((await leave(crew.id, ha)).status).toBe(200);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM crews WHERE id = ?').bind(crew.id).first()).toEqual({ n: 0 });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM crew_members WHERE crew_id = ?').bind(crew.id).first()).toEqual({ n: 0 });
    expect((await listCrews(hb)).body).toEqual({ crews: [], invites: [] });
  });

  it('a non-member learns nothing (404) and an invited member cannot leave (403 — decline instead)', async () => {
    await befriend('a', 'b');
    const crew = await createCrew(ha);
    await invite(crew.id, ha, 'b');
    expect((await leave(crew.id, hd)).status).toBe(404);
    expect((await leave(crew.id, hb)).status).toBe(403);
    expect((await leave('no-such-crew', ha)).status).toBe(404);
  });
});

/* ---------------------------------------------------- crew leaderboard */

describe('GET /api/social/crews/:id/leaderboard', () => {
  beforeEach(async () => {
    await db.prepare("INSERT INTO ratings (user_id, kind, elo, games, peak, updated_at) VALUES ('a','team',1260,3,1260,1),('b','team',1230,3,1240,1),('c','team',1180,3,1200,1),('d','team',1150,3,1200,1)").run();
    await befriend('a', 'b');
    await befriend('a', 'c');
  });

  async function boardCrew() {
    const crew = await createCrew(ha);
    await invite(crew.id, ha, 'b');
    await respond(crew.id, hb, true); // b active
    await invite(crew.id, ha, 'c'); // c stays merely invited
    return crew;
  }
  const board = (id: string, headers?: Record<string, string>, qs = 'board=rating&kind=team&period=all') =>
    call(`/api/social/crews/${id}/leaderboard?${qs}`, ['api', 'social', 'crews', id, 'leaderboard'], headers);

  it('standings contain ONLY the crew’s active members', async () => {
    const crew = await boardCrew();
    const res = await board(crew.id, ha);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { name: string }[]; region: unknown };
    expect(body.rows.map((r) => r.name)).toEqual(['A', 'B']); // not C (invited), not D (stranger)
    expect(body.region).toBeNull();
  });

  it('active members only: invited 403, stranger 403, anon 401, missing crew 403', async () => {
    const crew = await boardCrew();
    expect((await board(crew.id, hc)).status).toBe(403);
    expect((await board(crew.id, hd)).status).toBe(403);
    expect((await board(crew.id)).status).toBe(401);
    expect((await board('no-such-crew', ha)).status).toBe(403);
  });

  it('honours board/kind/period params like the main leaderboard route', async () => {
    const crew = await boardCrew();
    const res = await board(crew.id, hb, 'board=rating&kind=cutthroat&period=all');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[] };
    expect(body.rows).toEqual([]); // nobody has cutthroat ratings — an honest empty board
  });
});
