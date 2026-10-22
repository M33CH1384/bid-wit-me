/**
 * Release 9 HTTP routes under /api/social (served same-origin through the Pages proxy, so the session cookie works):
 *   GET /api/social/ticket            → { ticket, uid, name } for signed-in users (5-minute account ticket), else { guest: true }
 *   GET /api/social/profile/:username → public profile (member since, badges, team names, ratings, head-to-head)
 *   GET /api/social/me/stats          → signed-in personal stats, split by 2v2 and Cutthroat
 *   GET /api/social/recent            → players you recently played with (signed in)
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
  ratings: { team?: number; cutthroat?: number };
  totals: { games: number; wins: number };
  h2h: { id: string; name: string; games: number; wins: number; losses: number }[];
  vsYou?: { games: number; wins: number; losses: number };
  champion: number;
  stats: PersonalStats;
  awards: { label: string; ref: string; at: number }[];
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
  const out: ProfileOut = {
    id: u.id, avatar: u.avatar,
    username: u.username, memberSince: u.created_at, tagline: u.tagline, region: u.region, badges, teamNames: teams.slice(0, 6), ratings: await store.ratings(u.id),
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
    const board = (['rating', 'wins', 'accuracy', 'duos', 'winpct', 'books', 'nils'] as const).find((b) => b === q.get('board')) ?? 'rating';
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
    return json({ rows: await leaderboard(db, { board, kind, period, region, now }), region });
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
