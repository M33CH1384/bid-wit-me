/**
 * Release 9 HTTP routes under /api/social (served same-origin through the Pages proxy, so the session cookie works):
 *   GET /api/social/ticket            → { ticket, uid, name } for signed-in users (5-minute account ticket), else { guest: true }
 *   GET /api/social/profile/:username → public profile (member since, badges, team names, ratings, head-to-head)
 *   GET /api/social/me/stats          → signed-in personal stats, split by 2v2 and Cutthroat
 *   GET /api/social/recent            → players you recently played with (signed in)
 *   GET /api/social/match/:id         → one recorded game in full (participant, or a public result)
 *   GET|POST|DELETE /api/social/favorites[/:id] → favorite partners (signed in)
 *   POST /api/social/crews · GET /api/social/crews · POST /api/social/crews/:id/{invite,respond,leave} · GET /api/social/crews/:id/leaderboard → crews (signed in; BWM Central P3)
 *   POST /api/social/presence         → report your own friend-activity presence (signed in; body { activity })
 *   GET /api/social/reports           → admin only: latest reports
 * The websocket (/api/social/ws) is routed in index.ts to the Social Durable Object.
 */
import { isFriendActivity } from '@spades/protocol';
import { type AuthEnv, currentUser } from '../auth/routes';
import { regionOf } from '../cred/region';
import { leaderboard, myStats, personalStats, serverStats, type PersonalStats } from '../stats/boards';
import { ensurePowerSnapshot, powerRankings } from '../stats/power';
import { recentResults } from '../stats/results';
import { matchDetail } from '../stats/match';
import { recentHighlights } from '../stats/highlights';
import { leagueHonors } from '../stats/honors';
import { usernameKey } from '../auth/username';
import { TICKET_TTL_MS, signTicket } from './ticket';
import { SocialStore } from './store';

export interface SocialEnv extends AuthEnv {
  /** comma-separated usernames (case-insensitive) with chat moderation rights */
  ADMIN_USERNAMES?: string;
  /** comma-separated account ids with chat moderation rights */
  ADMIN_USER_IDS?: string;
}

export function isAdmin(env: SocialEnv, uid: string, username: string | null): boolean {
  const ids = (env.ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const names = (env.ADMIN_USERNAMES ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return ids.includes(uid) || (!!username && names.includes(username.toLowerCase()));
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** coarse region from Cloudflare geo ("US-GA", "GB"): never finer than a state/province */
export function coarseRegion(cf: unknown): string | null {
  const c = (cf ?? {}) as { country?: string; regionCode?: string };
  if (!c.country || !/^[A-Z]{2}$/.test(c.country)) return null;
  return c.regionCode && /^[A-Z0-9]{1,3}$/.test(c.regionCode) && ['US', 'CA', 'AU', 'BR', 'MX', 'IN'].includes(c.country) ? `${c.country}-${c.regionCode}` : c.country;
}

export interface ProfileOut {
  /** raw account id (no 'u:' prefix) — the client needs it to resolve the cred profile/avatar */
  id: string;
  username: string;
  memberSince: number;
  tagline: string | null;
  /** self-declared region (league P-B) — plain display text, null when unset */
  region: string | null;
  /** uploaded profile picture (data URL) or null — the Social profile header renders it directly */
  avatar: string | null;
  badges: { id: string; earnedAt: number }[];
  teamNames: string[];
  /** one record per teamNames entry (same order): that team's real recorded games */
  teams: TeamStatOut[];
  ratings: { team?: number; cutthroat?: number };
  totals: { games: number; wins: number };
  h2h: { id: string; name: string; games: number; wins: number; losses: number }[];
  vsYou?: { games: number; wins: number; losses: number };
  champion: number;
  stats: PersonalStats;
  awards: { label: string; ref: string; at: number }[];
}

/* ------------------------------------------------------------ team records */

/** The partner a team name was played with (owner, 2026-11-04: tapping a
 *  team name shows that team's stats). A signed-in partner carries their
 *  social id ('u:<account id>') and avatar so the client can tap through
 *  to their profile; a bot or guest partner is a display name only — they
 *  have no profile and left no recorded rows. */
export interface TeamPartnerOut {
  id?: string;
  name: string;
  avatar?: string | null;
  bot?: boolean;
  guest?: boolean;
  games: number;
}

export interface TeamStatOut {
  name: string;
  games: number; wins: number; losses: number; winPct: number | null;
  streak: number; bestStreak: number;
  accuracy: number | null; booksPerHand: number | null; nil: string; wheels: number;
  /** 'side' when the partner also left recorded rows in these games (so the
   *  performance lines are the pair's), 'self' when only the profile
   *  player's rows exist (bot/guest partner) and the lines are theirs. */
  recorded: 'side' | 'self';
  partner: TeamPartnerOut | null;
  /** further partners the same name was played with, most games first */
  others: { name: string; games: number }[];
}

interface TeamRow {
  user_id: string; game_id: string; won: number; stats: string; side: number;
  partner_id: string | null; ended_at: number; seats: string;
  end_reason: string; leaver_id: string | null; rated: number; family: string;
}

const TEAM_PERF_KEYS = ['bids', 'made', 'books', 'hands', 'nilBids', 'nilMade', 'wheels'] as const;

/**
 * One team's record for one player: their recorded games played under
 * `name` (game_players.team_name), aggregated with personalStats' exact
 * semantics — deals deduped by family (finished row wins), an abandoned
 * deal counting only as the rated leaver's loss, streaks chronological.
 * W–L and streaks are the side's (the player was in every one of these
 * games); the performance lines aggregate every recorded row of that side
 * in those games — the partner's too when they are signed in. A name with
 * no recorded games returns an honest zero entry.
 */
export async function teamRecordFor(db: D1Database, uid: string, name: string): Promise<TeamStatOut> {
  const zero: TeamStatOut = {
    name, games: 0, wins: 0, losses: 0, winPct: null, streak: 0, bestStreak: 0,
    accuracy: null, booksPerHand: null, nil: '0/0', wheels: 0, recorded: 'self', partner: null, others: [],
  };
  const rows = (await db.prepare(`SELECT gp.user_id AS user_id, gp.game_id AS game_id, gp.won AS won, gp.stats AS stats, gp.side AS side,
      gp.partner_id AS partner_id, gp.ended_at AS ended_at, g.seats AS seats,
      COALESCE(g.end_reason, 'finished') AS end_reason, g.leaver_id AS leaver_id, g.rated AS rated, COALESCE(g.family, g.id) AS family
    FROM game_players gp JOIN games g ON g.id = gp.game_id
    WHERE gp.team_name = ? AND gp.game_id IN (SELECT game_id FROM game_players WHERE user_id = ? AND team_name = ?)
    ORDER BY gp.ended_at ASC, gp.game_id ASC`).bind(name, uid, name).all<TeamRow>()).results;
  if (!rows.length) return zero;
  const order: string[] = [];
  const groups = new Map<string, TeamRow[]>();
  for (const r of rows) {
    const list = groups.get(r.family);
    if (list) list.push(r);
    else { groups.set(r.family, [r]); order.push(r.family); }
  }
  const perf = { bids: 0, made: 0, books: 0, hands: 0, nilBids: 0, nilMade: 0, wheels: 0 };
  let games = 0; let wins = 0; let run = 0; let best = 0; let sideRecorded = false;
  interface Tally { key: string; rawId: string | null; seatName: string; bot: boolean; guest: boolean; games: number; last: number }
  const tallies = new Map<string, Tally>();
  const tally = (t: Tally) => {
    const cur = tallies.get(t.key);
    if (cur) { cur.games++; cur.last = Math.max(cur.last, t.last); } else tallies.set(t.key, t);
  };
  for (const family of order) {
    const list = groups.get(family)!;
    const mine = list.filter((r) => r.user_id === uid);
    if (!mine.length) continue;
    const use = mine.find((r) => r.end_reason !== 'abandoned') ?? mine.find((r) => r.end_reason === 'abandoned');
    if (!use) continue;
    if (use.end_reason === 'abandoned') {
      if (!(use.rated && use.leaver_id === uid)) continue; // not a counted game; streak untouched
      games++; run = 0;
    } else {
      games++;
      if (use.won) { wins++; run++; best = Math.max(best, run); } else run = 0;
      for (const r of list) {
        if (r.game_id !== use.game_id) continue;
        if (r.user_id !== uid) sideRecorded = true;
        let st: Record<string, number> = {};
        try { st = JSON.parse(r.stats); } catch { /* skip */ }
        for (const k of TEAM_PERF_KEYS) perf[k] += Number(st[k]) || 0;
      }
    }
    if (use.partner_id) {
      tally({ key: `u:${use.partner_id}`, rawId: use.partner_id, seatName: '', bot: false, guest: false, games: 1, last: use.ended_at });
    } else {
      let seats: { name: string; side: number; kind: string; uid?: string }[] = [];
      try { seats = JSON.parse(use.seats); } catch { /* skip */ }
      const mate = seats.find((s) => s.side === use.side && !(s.kind === 'user' && s.uid === uid));
      if (mate) {
        if (mate.kind === 'user' && mate.uid) tally({ key: `u:${mate.uid}`, rawId: mate.uid, seatName: mate.name, bot: false, guest: false, games: 1, last: use.ended_at });
        else tally({ key: `n:${mate.name}`, rawId: null, seatName: mate.name, bot: mate.kind === 'bot', guest: mate.kind === 'guest', games: 1, last: use.ended_at });
      }
    }
  }
  const ranked = [...tallies.values()].sort((a, b) => b.games - a.games || b.last - a.last);
  const userInfo = new Map<string, { username: string; avatar: string | null }>();
  const rawIds = ranked.filter((t) => t.rawId).map((t) => t.rawId!);
  if (rawIds.length) {
    const us = (await db.prepare(`SELECT id, username, avatar FROM users WHERE id IN (${rawIds.map(() => '?').join(',')})`).bind(...rawIds).all<{ id: string; username: string | null; avatar: string | null }>()).results;
    for (const u of us) userInfo.set(u.id, { username: u.username ?? 'Player', avatar: u.avatar });
  }
  const toPartner = (t: Tally): TeamPartnerOut => (t.rawId
    ? { id: `u:${t.rawId}`, name: userInfo.get(t.rawId)?.username ?? (t.seatName || 'Player'), avatar: userInfo.get(t.rawId)?.avatar ?? null, games: t.games }
    : { name: t.seatName, ...(t.bot ? { bot: true } : {}), ...(t.guest ? { guest: true } : {}), games: t.games });
  const [main, ...rest] = ranked;
  return {
    name, games, wins, losses: games - wins,
    winPct: games ? Math.round((1000 * wins) / games) / 10 : null,
    streak: run, bestStreak: best,
    accuracy: perf.bids ? Math.round((1000 * perf.made) / perf.bids) / 10 : null,
    booksPerHand: perf.hands ? Math.round((100 * perf.books) / perf.hands) / 100 : null,
    nil: `${perf.nilMade}/${perf.nilBids}`, wheels: perf.wheels,
    recorded: sideRecorded ? 'side' : 'self',
    partner: main ? toPartner(main) : null,
    others: rest.map((t) => ({ name: toPartner(t).name, games: t.games })),
  };
}

export async function profileFor(db: D1Database, username: string, viewer: string | null): Promise<ProfileOut | null> {
  const u = await db.prepare('SELECT id, username, created_at, tagline, region, avatar FROM users WHERE username_key = ?').bind(usernameKey(username)).first<{ id: string; username: string; created_at: number; tagline: string | null; region: string | null; avatar: string | null }>();
  if (!u) return null;
  const prog = await db.prepare('SELECT data FROM progress WHERE user_id = ?').bind(u.id).first<{ data: string }>();
  let badges: { id: string; earnedAt: number }[] = [];
  let teamFromProgress: string | null = null;
  try { const p = prog ? JSON.parse(prog.data) : null; badges = (p?.badges ?? []).map((b: { id: string; earnedAt: number }) => ({ id: b.id, earnedAt: b.earnedAt })); teamFromProgress = p?.teamName ?? null; } catch { /* ignore */ }
  const champ = await db.prepare("SELECT COUNT(*) AS n FROM awards WHERE user_id = ? AND kind = 'champion'").bind(u.id).first<{ n: number }>();
  const teams = (await db.prepare('SELECT team_name, COUNT(*) AS n FROM game_players WHERE user_id = ? AND team_name IS NOT NULL GROUP BY team_name ORDER BY n DESC LIMIT 6').bind(u.id).all<{ team_name: string }>()).results.map((r) => r.team_name);
  if (teamFromProgress && !teams.includes(teamFromProgress)) teams.unshift(teamFromProgress);
  const stats = await personalStats(db, u.id);
  const h2h = (await db.prepare(`SELECT o.user_id AS id, ou.username AS name, COUNT(*) AS games, SUM(me.won) AS wins, SUM(o.won) AS losses
    FROM game_players me JOIN game_players o ON o.game_id = me.game_id AND o.side != me.side JOIN users ou ON ou.id = o.user_id
    JOIN games g ON g.id = me.game_id AND COALESCE(g.end_reason, 'finished') != 'abandoned'
    WHERE me.user_id = ? GROUP BY o.user_id ORDER BY games DESC LIMIT 8`).bind(u.id).all<{ id: string; name: string | null; games: number; wins: number; losses: number }>()).results;
  const store = new SocialStore(db);
  const teamNamesOut = teams.slice(0, 6);
  const teamStats = await Promise.all(teamNamesOut.map((t) => teamRecordFor(db, u.id, t)));
  const out: ProfileOut = {
    id: u.id, avatar: u.avatar,
    username: u.username, memberSince: u.created_at, tagline: u.tagline, region: u.region, badges, teamNames: teamNamesOut, teams: teamStats, ratings: await store.ratings(u.id),
    totals: { games: stats.games, wins: stats.wins },
    h2h: h2h.map((r) => ({ id: `u:${r.id}`, name: r.name ?? 'Player', games: r.games, wins: r.wins, losses: r.losses })),
    champion: champ?.n ?? 0,
    stats,
    awards: (await db.prepare("SELECT label, ref, at FROM awards WHERE user_id = ? AND kind = 'champion' ORDER BY at DESC LIMIT 10").bind(u.id).all<{ label: string; ref: string; at: number }>()).results,
  };
  if (viewer && viewer !== u.id) {
    const v = h2h.find((r) => r.id === viewer) ?? await db.prepare(`SELECT COUNT(*) AS games, COALESCE(SUM(me.won), 0) AS wins, COALESCE(SUM(o.won), 0) AS losses FROM game_players me JOIN game_players o ON o.game_id = me.game_id AND o.side != me.side JOIN games g ON g.id = me.game_id AND COALESCE(g.end_reason, 'finished') != 'abandoned' WHERE me.user_id = ? AND o.user_id = ?`).bind(u.id, viewer).first<{ games: number; wins: number; losses: number }>();
    // from the viewer's side: their wins are the profile owner's losses
    if (v && v.games) out.vsYou = { games: v.games, wins: v.losses, losses: v.wins };
  }
  return out;
}

/* ------------------------------------------------------------ favorites */

/** Favorite partners (migration 0036, BWM Central P1): a signed-in player's
 *  own list. The INNER JOIN on users is the "drop rows whose user vanished"
 *  rule — favorite_partners carries no FK, so a deleted account's row can
 *  outlive it and must never surface. */
export async function listFavorites(db: D1Database, uid: string): Promise<{ userId: string; name: string }[]> {
  const rows = (await db.prepare(`SELECT f.partner_id AS id, u.username AS name FROM favorite_partners f
    JOIN users u ON u.id = f.partner_id WHERE f.user_id = ? ORDER BY f.created_at ASC, u.username ASC`)
    .bind(uid).all<{ id: string; name: string | null }>()).results;
  return rows.map((r) => ({ userId: r.id, name: r.name ?? 'Player' }));
}

/** The caller's friends-board id set: accepted `friends` rows + the caller,
 *  derived entirely server-side (the notify.ts pattern) — never client ids. */
export async function friendIdSet(db: D1Database, uid: string): Promise<string[]> {
  const rows = (await db.prepare(`SELECT CASE WHEN a = ? THEN b ELSE a END AS fid FROM friends
    WHERE (a = ? OR b = ?) AND status = 'friends'`).bind(uid, uid, uid).all<{ fid: string }>()).results;
  return [uid, ...rows.map((r) => r.fid)];
}

/* --------------------------------------------------------------- crews */

export interface CrewMemberOut { userId: string; name: string; role: string; status: string }
export interface CrewOut { id: string; name: string; ownerId: string; members: CrewMemberOut[] }

/** One crew in the wire shape (BWM Central P3; tables from migration 0036,
 *  status from 0037). The INNER JOIN on users is the "drop rows whose user
 *  vanished" rule (crew_members carries no FK): a deleted account's
 *  membership row can outlive it and must never surface. */
export async function crewOut(db: D1Database, crewId: string): Promise<CrewOut | null> {
  const crew = await db.prepare('SELECT id, name, owner_id AS ownerId FROM crews WHERE id = ?').bind(crewId).first<{ id: string; name: string; ownerId: string }>();
  if (!crew) return null;
  const rows = (await db.prepare(`SELECT m.user_id AS userId, u.username AS name, m.role AS role, m.status AS status
    FROM crew_members m JOIN users u ON u.id = m.user_id WHERE m.crew_id = ? ORDER BY m.joined_at ASC, u.username ASC`)
    .bind(crewId).all<{ userId: string; name: string | null; role: string; status: string }>()).results;
  return { id: crew.id, name: crew.name, ownerId: crew.ownerId, members: rows.map((r) => ({ userId: r.userId, name: r.name ?? 'Player', role: r.role, status: r.status })) };
}

async function crewMembership(db: D1Database, crewId: string, uid: string): Promise<{ role: string; status: string } | null> {
  return db.prepare('SELECT role, status FROM crew_members WHERE crew_id = ? AND user_id = ?').bind(crewId, uid).first<{ role: string; status: string }>();
}

/** The crew standings id set: ACTIVE members only — an invitation confers no standing. */
async function crewActiveIds(db: D1Database, crewId: string): Promise<string[]> {
  const rows = (await db.prepare("SELECT user_id AS id FROM crew_members WHERE crew_id = ? AND status = 'active'").bind(crewId).all<{ id: string }>()).results;
  return rows.map((r) => r.id);
}

export async function recentPlayers(db: D1Database, uid: string): Promise<{ id: string; name: string; games: number; last: number; partner: boolean }[]> {
  const rows = (await db.prepare(`SELECT o.user_id AS id, u.username AS name, COUNT(*) AS games, MAX(o.ended_at) AS last, MAX(CASE WHEN o.side = me.side THEN 1 ELSE 0 END) AS partner
    FROM game_players me JOIN game_players o ON o.game_id = me.game_id AND o.user_id != me.user_id JOIN users u ON u.id = o.user_id
    JOIN games g ON g.id = me.game_id AND COALESCE(g.end_reason, 'finished') != 'abandoned'
    WHERE me.user_id = ? AND me.ended_at > ? GROUP BY o.user_id ORDER BY last DESC LIMIT 20`).bind(uid, 0).all<{ id: string; name: string | null; games: number; last: number; partner: number }>()).results;
  return rows.map((r) => ({ id: `u:${r.id}`, name: r.name ?? 'Player', games: r.games, last: r.last, partner: !!r.partner }));
}

export async function handleSocialHttp(req: Request & { cf?: unknown }, env: SocialEnv, url: URL, parts: string[], now: number): Promise<Response> {
  if (!env.DB) return json({ error: 'accounts are not configured' }, 503);
  const db = env.DB;
  const me = await currentUser(req, env, url, now);
  const a = parts[2];
  if (a === 'ticket' && req.method === 'GET') {
    if (!me || !me.username) return json({ guest: true });
    const store = new SocialStore(db);
    await store.saveRegion(me.id, coarseRegion(req.cf), now).catch(() => undefined);
    return json({ ticket: await signTicket(db, { uid: me.id, name: me.username, exp: now + TICKET_TTL_MS }), uid: `u:${me.id}`, name: me.username, admin: isAdmin(env, me.id, me.username) });
  }
  if (a === 'profile' && parts[3] && req.method === 'GET') {
    const p = await profileFor(db, decodeURIComponent(parts[3]).slice(0, 40), me?.id ?? null);
    return p ? json(p) : json({ error: 'not found' }, 404);
  }
  if (a === 'honors' && req.method === 'GET') {
    return json(await leagueHonors(db, now));
  }
  if (a === 'power' && req.method === 'GET') {
    const kind = url.searchParams.get('kind') === 'cutthroat' ? 'cutthroat' : 'team';
    return json(await powerRankings(db, kind, now));
  }
  if (a === 'results' && req.method === 'GET') {
    // Recent-results feed (league data wave): public display names only,
    // same as the boards — no sign-in needed to read the ticker's fuel.
    const limit = Math.min(25, Math.max(1, Number(url.searchParams.get('limit')) || 10));
    return json({ results: await recentResults(db, limit) });
  }
  if (a === 'highlights' && req.method === 'GET') {
    // Live highlights (item 6b): moments from games in progress, stored by
    // the table DOs as they resolve; stale ones (>15 min) never leave.
    return json({ highlights: await recentHighlights(db, now) });
  }
  if (a === 'leaderboard' && req.method === 'GET') {
    // League P-E: the first leaderboard read of an ISO week captures the
    // Power Rankings snapshot (best-effort — never block the board on it).
    await ensurePowerSnapshot(db, now).catch(() => undefined);
    const q = url.searchParams;
    const board = (['rating', 'wins', 'accuracy', 'duos', 'winpct', 'books', 'nils', 'streak', 'pace', 'tkos'] as const).find((b) => b === q.get('board')) ?? 'rating';
    const kind = q.get('kind') === 'cutthroat' ? 'cutthroat' : 'team';
    const period = (['all', 'month', 'week'] as const).find((p) => p === q.get('period')) ?? 'all';
    let region: string | null = null;
    if (q.get('scope') === 'local') {
      const mine = me ? await db.prepare('SELECT region FROM social_settings WHERE user_id = ?').bind(me.id).first<{ region: string | null }>() : null;
      region = mine?.region ?? coarseRegion(req.cf);
      if (!region) return json({ rows: [], region: null, note: 'Your region is unknown, so there is no local board.' });
    }
    if (q.get('scope') === 'regions') {
      // League P-B: the regional board = players who declared the SAME
      // region as the viewer. Unset viewers get an honest empty board.
      const declared = me ? await regionOf(db, me.id) : null;
      if (!declared) return json({ rows: [], region: null, note: 'Set your region on your profile to see your regional board.' });
      return json({ rows: await leaderboard(db, { board, kind, period, region: null, declaredRegion: declared, now }), region: declared });
    }
    if (q.get('scope') === 'friends') {
      // BWM Central P1: the friends board = the caller + their accepted
      // friends, resolved server-side from the friends table. Signed-in
      // only, following the regions scope above: a signed-out viewer gets
      // an honest empty board with a note, never someone else's set.
      if (!me) return json({ rows: [], region: null, note: 'Sign in to see your friends board.' });
      return json({ rows: await leaderboard(db, { board, kind, period, region: null, friendIds: await friendIdSet(db, me.id), now }), region: null });
    }
    return json({ rows: await leaderboard(db, { board, kind, period, region, now }), region });
  }
  if (a === 'match' && parts[3] && req.method === 'GET') {
    // Match detail (BWM Central P1): participants always; everyone else
    // only when the game is a public result (see stats/match.ts). A game
    // the caller may not see is a 404, same as one that does not exist.
    const d = await matchDetail(db, decodeURIComponent(parts[3]).slice(0, 80), me?.id ?? null);
    return d ? json(d) : json({ error: 'not found' }, 404);
  }
  if (a === 'favorites' && req.method === 'GET' && !parts[3]) {
    if (!me) return json({ error: 'Sign in to see your favorites.' }, 401);
    return json({ favorites: await listFavorites(db, me.id) });
  }
  if (a === 'favorites' && parts[3] && (req.method === 'POST' || req.method === 'DELETE')) {
    if (!me) return json({ error: 'Sign in to manage your favorites.' }, 401);
    const target = decodeURIComponent(parts[3]).replace(/^u:/, '').slice(0, 80);
    if (req.method === 'DELETE') {
      await db.prepare('DELETE FROM favorite_partners WHERE user_id = ? AND partner_id = ?').bind(me.id, target).run();
      return json({ ok: true });
    }
    if (target === me.id) return json({ error: "You can't favorite yourself." }, 400);
    if (!(await db.prepare('SELECT 1 AS ok FROM users WHERE id = ?').bind(target).first())) return json({ error: 'not found' }, 404);
    await db.prepare('INSERT OR IGNORE INTO favorite_partners (user_id, partner_id, created_at) VALUES (?, ?, ?)').bind(me.id, target, now).run();
    return json({ ok: true });
  }
  if (a === 'crews' && !parts[3] && req.method === 'POST') {
    // Create a crew (BWM Central P3): the creator is its owner and first
    // active member. The name is display text — trimmed, 1–40 chars.
    if (!me) return json({ error: 'Sign in to create a crew.' }, 401);
    const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (name.length < 1 || name.length > 40) return json({ error: 'Crew names are 1–40 characters.' }, 400);
    const id = crypto.randomUUID();
    await db.batch([
      db.prepare('INSERT INTO crews (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)').bind(id, name, me.id, now),
      db.prepare("INSERT INTO crew_members (crew_id, user_id, role, joined_at, status) VALUES (?, ?, 'owner', ?, 'active')").bind(id, me.id, now),
    ]);
    return json({ crew: await crewOut(db, id) });
  }
  if (a === 'crews' && !parts[3] && req.method === 'GET') {
    // Your crews (you are ACTIVE) split from your pending invitations
    // (you are INVITED) — an invite never auto-joins anyone.
    if (!me) return json({ error: 'Sign in to see your crews.' }, 401);
    const mine = (await db.prepare('SELECT crew_id AS id, status FROM crew_members WHERE user_id = ? ORDER BY joined_at ASC').bind(me.id).all<{ id: string; status: string }>()).results;
    const crews: CrewOut[] = [];
    const invites: CrewOut[] = [];
    for (const m of mine) {
      const c = await crewOut(db, m.id);
      if (c) (m.status === 'active' ? crews : invites).push(c);
    }
    return json({ crews, invites });
  }
  if (a === 'crews' && parts[3] && parts[4] === 'invite' && req.method === 'POST') {
    if (!me) return json({ error: 'Sign in to invite to a crew.' }, 401);
    const crewId = decodeURIComponent(parts[3]).slice(0, 80);
    const mine = await crewMembership(db, crewId, me.id);
    if (!mine || mine.status !== 'active') return json({ error: 'Only active crew members can invite.' }, 403);
    const body = (await req.json().catch(() => null)) as { userId?: unknown } | null;
    const target = typeof body?.userId === 'string' ? body.userId.replace(/^u:/, '').slice(0, 80) : '';
    const existing = target ? await crewMembership(db, crewId, target) : null;
    if (existing?.status === 'active') return json({ ok: true }); // already a member: inviting them is a no-op
    // Anti-spam: crew invites go to the caller's ACCEPTED friends only —
    // never to strangers, pending friends, or accounts that don't exist.
    if (!target || !(await new SocialStore(db).areFriends(me.id, target))) return json({ error: 'You can only invite your friends to a crew.' }, 400);
    await db.prepare("INSERT OR IGNORE INTO crew_members (crew_id, user_id, role, joined_at, status) VALUES (?, ?, 'member', ?, 'invited')").bind(crewId, target, now).run();
    await db.prepare("UPDATE crew_members SET status = 'invited' WHERE crew_id = ? AND user_id = ? AND status != 'active'").bind(crewId, target).run();
    return json({ ok: true });
  }
  if (a === 'crews' && parts[3] && parts[4] === 'respond' && req.method === 'POST') {
    if (!me) return json({ error: 'Sign in to answer a crew invite.' }, 401);
    const crewId = decodeURIComponent(parts[3]).slice(0, 80);
    const mine = await crewMembership(db, crewId, me.id);
    if (!mine || mine.status !== 'invited') return json({ error: 'You have no crew invitation to answer.' }, 403);
    const body = (await req.json().catch(() => null)) as { accept?: unknown } | null;
    if (body?.accept) await db.prepare("UPDATE crew_members SET status = 'active' WHERE crew_id = ? AND user_id = ?").bind(crewId, me.id).run();
    else await db.prepare('DELETE FROM crew_members WHERE crew_id = ? AND user_id = ?').bind(crewId, me.id).run(); // decline removes the row, so a re-invite starts clean
    return json({ ok: true });
  }
  if (a === 'crews' && parts[3] && parts[4] === 'leave' && req.method === 'POST') {
    if (!me) return json({ error: 'Sign in to leave a crew.' }, 401);
    const crewId = decodeURIComponent(parts[3]).slice(0, 80);
    const mine = await crewMembership(db, crewId, me.id);
    if (!mine) return json({ error: 'not found' }, 404);
    if (mine.status !== 'active') return json({ error: 'Decline the invitation instead of leaving.' }, 403);
    const crew = await db.prepare('SELECT owner_id AS ownerId FROM crews WHERE id = ?').bind(crewId).first<{ ownerId: string }>();
    if (crew?.ownerId === me.id) {
      // The owner leaving DISSOLVES the crew: the crew row and every
      // membership row go, so nobody is left in a crew with no owner.
      await db.batch([
        db.prepare('DELETE FROM crew_members WHERE crew_id = ?').bind(crewId),
        db.prepare('DELETE FROM crews WHERE id = ?').bind(crewId),
      ]);
    } else {
      await db.prepare('DELETE FROM crew_members WHERE crew_id = ? AND user_id = ?').bind(crewId, me.id).run();
    }
    return json({ ok: true });
  }
  if (a === 'crews' && parts[3] && parts[4] === 'leaderboard' && req.method === 'GET') {
    // Crew standings (BWM Central P3): the board id-set is the crew's
    // ACTIVE members, resolved server-side — same response shape as
    // /api/social/leaderboard.
    if (!me) return json({ error: 'Sign in to see crew standings.' }, 401);
    const crewId = decodeURIComponent(parts[3]).slice(0, 80);
    const mine = await crewMembership(db, crewId, me.id);
    if (!mine || mine.status !== 'active') return json({ error: 'Crew standings are for active members.' }, 403);
    const q = url.searchParams;
    const board = (['rating', 'wins', 'accuracy', 'duos', 'winpct', 'books', 'nils', 'streak', 'pace'] as const).find((b) => b === q.get('board')) ?? 'rating';
    const kind = q.get('kind') === 'cutthroat' ? 'cutthroat' : 'team';
    const period = (['all', 'month', 'week'] as const).find((p) => p === q.get('period')) ?? 'all';
    return json({ rows: await leaderboard(db, { board, kind, period, region: null, idSet: await crewActiveIds(db, crewId), now }), region: null });
  }
  if (a === 'me' && parts[3] === 'stats' && req.method === 'GET') {
    if (!me) return json({ error: 'Sign in to see your stats.' }, 401);
    return json(await myStats(db, me.id));
  }
  if (a === 'stats' && req.method === 'GET') return json(await serverStats(db, now));
  if (a === 'recent' && req.method === 'GET') {
    if (!me) return json({ players: [] });
    return json({ players: await recentPlayers(db, me.id) });
  }
  if (a === 'presence' && req.method === 'POST') {
    // Friend-activity presence (migration 0028): a signed-in user reports
    // their OWN current activity — the session names the row, so there is
    // no target to spoof (any id in the body is ignored). The hub stamps
    // the same row from the socket's live status; this endpoint is the
    // client's direct report (activity change + ~30 s heartbeat).
    if (!me) return json({ error: 'Sign in to report presence.' }, 401);
    const body = (await req.json().catch(() => null)) as { activity?: unknown } | null;
    if (!isFriendActivity(body?.activity)) return json({ error: 'Unknown activity.' }, 400);
    const store = new SocialStore(db);
    // Appear-offline is a promise: a hidden user's activity never lands in
    // the friends-visible store (the hub stamps under the same rule). The
    // report still succeeds — appearing offline must look like nothing.
    const settings = await store.settings(me.id);
    if (!settings.appearOffline) await store.stampPresence(me.id, body.activity, now);
    return json({ ok: true });
  }
  if (a === 'reports' && req.method === 'GET') {
    if (!me || !isAdmin(env, me.id, me.username)) return json({ error: 'not found' }, 404);
    const rows = (await db.prepare(`SELECT r.id, r.kind, r.msg_id, r.text, r.reason, r.at, ru.username AS reporter, tu.username AS target, r.target_user
      FROM reports r LEFT JOIN users ru ON ru.id = r.reporter LEFT JOIN users tu ON tu.id = r.target_user ORDER BY r.id DESC LIMIT 100`).all()).results;
    return json({ reports: rows });
  }
  return json({ error: 'not found' }, 404);
}
