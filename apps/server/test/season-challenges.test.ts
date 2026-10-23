/** Seasonal challenges (owner, 2026-10-23): the season set dealt from
 *  cred/seasonSets (deterministic per season id, rotating), progress
 *  accruing through the SAME bump path game completion feeds, per-
 *  challenge claiming on the existing route, and the Big Joker wiring
 *  behind cred/bigJokerSeason: completion stamps the upkeep record,
 *  a lapsed holder steps back to Little Joker, a later completion
 *  reactivates — reactivation, not re-earning. */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { sha256b64 } from '../src/auth/providers';
import { handleCredHttp } from '../src/cred/routes';
import { bumpProgress, progressFor } from '../src/cred/challenges';
import { currentSeasonId, seasonChallengesFor, seasonIndexFor, seasonSetComplete, seasonSetExists, SEASON_POOL } from '../src/cred/seasonSets';
import { bigJokerSeasonActive, seasonUpkeepView } from '../src/cred/bigJokerSeason';
import { cardFor } from '../src/cred/card';

let db: D1Database;
const ORIGIN = 'https://example.com';

// Season 1 (2026-10) and Season 2 (2026-11), mid-month UTC.
const OCT = Date.UTC(2026, 9, 15, 12);
const NOV = Date.UTC(2026, 10, 15, 12);

async function user(id: string) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind(id, id.toUpperCase(), id, 1_700_000_000_000).run();
}
async function session(uid: string, tok = `${uid}-tok`) {
  await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256b64(tok), uid, 1, NOV + 10_000_000).run();
  return tok;
}
const call = (tok: string | null, path: string, now: number, init?: RequestInit) =>
  handleCredHttp(
    new Request(new URL(path, ORIGIN), { headers: { ...(tok ? { cookie: `__Host-bwm_sid=${tok}` } : {}), 'content-type': 'application/json' }, ...init }),
    { DB: db, PUBLIC_ORIGIN: ORIGIN } as never, new URL(path, ORIGIN), path.split('/').filter(Boolean), now);

/** Drive a player's season set to completion through the real bump path:
 *  generous amounts of every metric the pool uses, in both kinds. */
async function completeSeasonSet(uid: string, now: number) {
  await bumpProgress(db, uid, 'games', 80, 'team', now);
  await bumpProgress(db, uid, 'wins', 20, 'team', now);
  await bumpProgress(db, uid, 'wins', 8, 'cutthroat', now);
  await bumpProgress(db, uid, 'books', 320, 'team', now);
  await bumpProgress(db, uid, 'nils_made', 5, 'team', now);
  await bumpProgress(db, uid, 'shots_given', 14, 'team', now);
}

beforeEach(async () => {
  db = await makeD1();
  await user('a'); await user('b');
});

describe('the season set: derivation, determinism, rotation', () => {
  it('deals 6 of the 8 pool defs, the same set for the same season id, every time', () => {
    const oct = seasonChallengesFor('2026-10');
    expect(oct).toHaveLength(6);
    expect(seasonChallengesFor('2026-10').map((c) => c.id)).toEqual(oct.map((c) => c.id));
    expect(new Set(oct.map((c) => c.id)).size).toBe(6);
    expect(oct.every((c) => c.cadence === 'season')).toBe(true);
    expect(oct.every((c) => SEASON_POOL.some((p) => p.id === c.id))).toBe(true);
  });

  it('rotates as seasons turn: consecutive seasons share four of six (6-of-8 always overlaps), and the pool cycles', () => {
    const oct = new Set(seasonChallengesFor('2026-10').map((c) => c.id));
    const nov = new Set(seasonChallengesFor('2026-11').map((c) => c.id));
    expect([...oct].filter((id) => nov.has(id))).toHaveLength(4);
    expect([...nov].some((id) => !oct.has(id))).toBe(true);
    // over any 8 consecutive seasons every pool def is dealt
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const y = 2026 + Math.floor((9 + i) / 12), m = ((9 + i) % 12) + 1;
      for (const c of seasonChallengesFor(`${y}-${String(m).padStart(2, '0')}`)) seen.add(c.id);
    }
    expect(seen.size).toBe(SEASON_POOL.length);
  });

  it('seasons before the epoch carry no set; the epoch season onward always do', () => {
    expect(seasonSetExists('2026-09')).toBe(false);
    expect(seasonChallengesFor('2026-09')).toEqual([]);
    expect(seasonSetExists('2026-10')).toBe(true);
    expect(seasonSetExists('2027-03')).toBe(true);
    expect(seasonIndexFor('2026-10')).toBe(0);
    expect(seasonIndexFor('2027-01')).toBe(3);
  });

  it('the season flips at the UTC month boundary — last second vs first', () => {
    const lastMs = Date.UTC(2026, 9, 31, 23, 59, 59, 999);
    const firstMs = Date.UTC(2026, 10, 1, 0, 0, 0, 0);
    expect(currentSeasonId(lastMs)).toBe('2026-10');
    expect(currentSeasonId(firstMs)).toBe('2026-11');
  });

  it('the pool is seeded into challenge_defs by migration (cadence season)', async () => {
    const rows = (await db.prepare("SELECT id FROM challenge_defs WHERE cadence = 'season' ORDER BY id").all<{ id: string }>()).results;
    expect(rows.map((r) => r.id)).toEqual(SEASON_POOL.map((c) => c.id).sort());
  });
});

describe('progress + claiming', () => {
  it('progressFor carries daily + weekly + the season block, scoped to the current season', async () => {
    const p = await progressFor(db, 'a', OCT);
    expect(p.daily).toHaveLength(3);
    expect(p.weekly).toHaveLength(2);
    expect(p.season.id).toBe('2026-10');
    expect(p.season.challenges.map((c) => c.id)).toEqual(seasonChallengesFor('2026-10').map((c) => c.id));
    expect(p.season.setComplete).toBe(false);
    // the first instant of November is a NEW season with untouched progress
    await bumpProgress(db, 'a', 'games', 10, 'team', OCT);
    const nov = await progressFor(db, 'a', Date.UTC(2026, 10, 1));
    expect(nov.season.id).toBe('2026-11');
    expect(nov.season.challenges.every((c) => c.progress === 0)).toBe(true);
  });

  it('progress accrues through the bump path from recorded-game metrics', async () => {
    await bumpProgress(db, 'a', 'games', 40, 'team', OCT);
    await bumpProgress(db, 'a', 'wins', 12, 'team', OCT);
    const p = await progressFor(db, 'a', OCT);
    const byId = new Map(p.season.challenges.map((c) => [c.id, c]));
    expect(byId.get('szn-games-40')).toMatchObject({ progress: 40, done: true });
    expect(byId.get('szn-team-12')).toMatchObject({ progress: 12, done: true });
    // kind filters hold: team wins do not feed the cutthroat def (not in October's set, but wins-any counts them)
    expect(byId.get('szn-win-20')).toMatchObject({ progress: 12, done: false });
    expect(p.season.setComplete).toBe(false);
    expect(await seasonSetComplete(db, 'a', '2026-10')).toBe(false);
  });

  it('completing the set stamps the upkeep record at the crossing moment — once', async () => {
    await completeSeasonSet('a', OCT);
    const p = await progressFor(db, 'a', OCT);
    expect(p.season.setComplete).toBe(true);
    const row = await db.prepare('SELECT completed_at AS at FROM big_joker_season_upkeep WHERE user_id = ? AND season_id = ?').bind('a', '2026-10').first<{ at: number | null }>();
    expect(row?.at).toBe(OCT);
    // a later bump never moves the stamp
    await bumpProgress(db, 'a', 'games', 1, 'team', OCT + 60_000);
    const again = await db.prepare('SELECT completed_at AS at FROM big_joker_season_upkeep WHERE user_id = ? AND season_id = ?').bind('a', '2026-10').first<{ at: number | null }>();
    expect(again?.at).toBe(OCT);
  });

  it('season challenges claim through the existing route — and only once', async () => {
    const tok = await session('a');
    await bumpProgress(db, 'a', 'games', 40, 'team', OCT);
    const ok = await call(tok, '/api/challenges/szn-games-40/claim', OCT, { method: 'POST' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, xp: 500, coins: 400 });
    const xp = await db.prepare('SELECT xp FROM xp_state WHERE user_id = ?').bind('a').first<{ xp: number }>();
    expect(xp?.xp).toBe(500);
    // idempotent: a second claim pays nothing and errors honestly
    const again = await call(tok, '/api/challenges/szn-games-40/claim', OCT, { method: 'POST' });
    expect(again.status).toBe(400);
    const xp2 = await db.prepare('SELECT xp FROM xp_state WHERE user_id = ?').bind('a').first<{ xp: number }>();
    expect(xp2?.xp).toBe(500);
    // an incomplete season challenge cannot be claimed
    const early = await call(tok, '/api/challenges/szn-nil-4/claim', OCT, { method: 'POST' });
    expect(early.status).toBe(400);
    // a def rotated OUT of November's set is not claimable in November
    const stale = await call(tok, '/api/challenges/szn-win-20/claim', NOV, { method: 'POST' });
    expect(stale.status).toBe(400);
  });

  it('GET /api/challenges carries the enriched season block (name, endsAt, upkeep)', async () => {
    const tok = await session('a');
    const res = await call(tok, '/api/challenges', OCT);
    expect(res.status).toBe(200);
    const body = await res.json() as { season: { id: string; name: string; endsAt: number; setComplete: boolean; bigJoker: unknown; challenges: unknown[] } };
    expect(body.season.id).toBe('2026-10');
    expect(body.season.name).toBe('Season 1');
    expect(body.season.endsAt).toBe(Date.UTC(2026, 10, 1));
    expect(body.season.challenges).toHaveLength(6);
    // a non-holder gets pure content: no Big Joker framing at all
    expect(body.season.bigJoker).toBeNull();
  });
});

describe('the Big Joker wiring: lapse, reactivation, grandfathering', () => {
  /** An earned holder: the latch set mid-October, level 50 on record. */
  async function seedHolder(earnedAt: number) {
    await db.prepare('INSERT INTO xp_state (user_id, xp, level, updated_at) VALUES (?, ?, ?, ?)').bind('b', 40_000, 50, 1).run();
    await db.prepare('UPDATE users SET big_joker_at = ? WHERE id = ?').bind(earnedAt, 'b').run();
  }

  it('grandfathered: earned this season, the crown is lit with zero set progress', async () => {
    await seedHolder(OCT);
    expect(await bigJokerSeasonActive(db, 'b', OCT, '2026-10', undefined, OCT)).toBe(true);
    const card = await cardFor(db, 'b', null, OCT);
    expect(card?.bigJoker).toEqual({ earned: true, active: true });
    expect(card?.rank.step).toBe(51);
  });

  it('lapsed: earned last season, no November completion — the card steps back to Little Joker', async () => {
    await seedHolder(OCT);
    expect(await bigJokerSeasonActive(db, 'b', OCT, '2026-11', undefined, NOV)).toBe(false);
    const view = await seasonUpkeepView(db, 'b', '2026-11', NOV);
    expect(view.bigJoker).toEqual({ earned: true, active: false });
    expect(view.setComplete).toBe(false);
    const card = await cardFor(db, 'b', null, NOV);
    expect(card?.bigJoker).toEqual({ earned: true, active: false });
    expect(card?.rank).toMatchObject({ step: 50, rankName: 'Little Joker' });
  });

  it('reactivation: completing a LATER season set relights the crown from the completion moment', async () => {
    await seedHolder(OCT);
    const before = await cardFor(db, 'b', null, NOV);
    expect(before?.rank.step).toBe(50);
    await completeSeasonSet('b', NOV);
    // the feat is untouched — this is the same latch, reactivated
    const latch = await db.prepare('SELECT big_joker_at AS at FROM users WHERE id = ?').bind('b').first<{ at: number | null }>();
    expect(latch?.at).toBe(OCT);
    const view = await seasonUpkeepView(db, 'b', '2026-11', NOV);
    expect(view.bigJoker).toEqual({ earned: true, active: true });
    const card = await cardFor(db, 'b', null, NOV);
    expect(card?.bigJoker).toEqual({ earned: true, active: true });
    expect(card?.rank.step).toBe(51);
  });

  it('a non-holder completing the set gains no crown — the stamp is bookkeeping, not the feat', async () => {
    await completeSeasonSet('a', OCT);
    const view = await seasonUpkeepView(db, 'a', '2026-10', OCT);
    expect(view.setComplete).toBe(true);
    expect(view.bigJoker).toBeNull();
    expect(await bigJokerSeasonActive(db, 'a', null, '2026-10', undefined, OCT)).toBe(false);
  });

  it('the /me profile payload carries the season section, upkeep included for a holder', async () => {
    await seedHolder(OCT);
    const tok = await session('b');
    const res = await call(tok, '/api/profile/me', NOV);
    expect(res.status).toBe(200);
    const body = await res.json() as { challenges: { season: { id: string; name: string; bigJoker: { earned: boolean; active: boolean } | null } } };
    expect(body.challenges.season.id).toBe('2026-11');
    expect(body.challenges.season.name).toBe('Season 2');
    expect(body.challenges.season.bigJoker).toEqual({ earned: true, active: false });
  });
});
