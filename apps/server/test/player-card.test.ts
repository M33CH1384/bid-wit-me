/** Player Card (owner-approved 2026-10-23): the rank ladder derivation, the
 *  card payload (self vs public vs viewer), the earned-badge pool + showcase
 *  rules, the save endpoint's validation, and the privacy boundary — the
 *  public card carries ONLY public facts. */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { sha256b64 } from '../src/auth/providers';
import { cardRankForLevel } from '../src/cred/xp';
import { badgeCompletionFor, badgeKey, cardFor, cleanCardShowcase, cleanCardStatus, cleanCardTags, earnedBadgesFor, type BadgeSummary, type PlayerCardData } from '../src/cred/card';
import { bigJokerSeasonActive, seasonIdFor } from '../src/cred/bigJokerSeason';
import { ACHIEVEMENTS } from '../src/cred/achievements';
import { STORY_BADGE_DEFS, STORY_SECRETS } from '@spades/bots';
import { handleCredHttp } from '../src/cred/routes';
import { ensureSeason } from '../src/cred/seasons';

let db: D1Database;
const NOW = 1_800_000_000_000;
const ORIGIN = 'https://example.com';

async function user(id: string, createdAt = 1_700_000_000_000) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind(id, id.toUpperCase(), id, createdAt).run();
}
async function session(uid: string, tok = `${uid}-tok`) {
  await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256b64(tok), uid, 1, NOW + 10_000_000).run();
  return tok;
}
const call = (tok: string | null, path: string, init?: RequestInit) =>
  handleCredHttp(
    new Request(new URL(path, ORIGIN), { headers: { ...(tok ? { cookie: `__Host-bwm_sid=${tok}` } : {}), 'content-type': 'application/json' }, ...init }),
    { DB: db, PUBLIC_ORIGIN: ORIGIN } as never, new URL(path, ORIGIN), path.split('/').filter(Boolean), NOW);

async function game(id: string, kind: 'team' | 'cutthroat', endedAt: number, endReason = 'finished') {
  await db.prepare(`INSERT INTO games (id, room, mode, kind, ended_at, hands, final, winners, names, seats, rated, end_reason)
    VALUES (?, 'r', 'joker', ?, ?, 5, '{}', '[]', '[]', '[]', 1, ?)`).bind(id, kind, endedAt, endReason).run();
}
async function played(gameId: string, uid: string, kind: 'team' | 'cutthroat', side: number, won: number, endedAt: number, partnerId: string | null = null) {
  await db.prepare(`INSERT INTO game_players (game_id, user_id, kind, seat, side, won, partner_id, team_name, ended_at, stats)
    VALUES (?, ?, ?, 0, ?, ?, ?, NULL, ?, '{}')`).bind(gameId, uid, kind, side, won, partnerId, endedAt).run();
}

/** b's world: an achievement pair, a story clear, a synced badge, a season
 *  record, and four shared tables with a — two as opponents (one each way),
 *  one as partners, one abandoned (which must count for nothing). */
async function seedSubject() {
  await db.prepare('INSERT INTO user_achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)').bind('b', 'first-dub', 1000).run();
  await db.prepare('INSERT INTO user_achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)').bind('b', 'clean-nil', 2000).run();
  await db.prepare('INSERT INTO progress (user_id, data, updated_at) VALUES (?, ?, ?)').bind('b', JSON.stringify({ badges: [{ id: 'storm-chaser', earnedAt: 3000 }] }), 1).run();
  await db.prepare('INSERT INTO story_progress (user_id, track_key, stop_id, attempts, clears, first_cleared_at) VALUES (?, ?, ?, ?, ?, ?)').bind('b', 'solo', 'porch', 2, 1, 500).run();
  await db.prepare('INSERT INTO story_progress (user_id, track_key, stop_id, attempts, clears) VALUES (?, ?, ?, ?, ?)').bind('b', 'solo', 'barbershop', 1, 0).run();
  const season = await ensureSeason(db, NOW);
  await db.prepare('INSERT INTO season_ratings (user_id, season_id, kind, rating, games, wins, losses, peak_rating) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind('b', season.id, 'team', 1240, 10, 6, 4, 1300).run();
  await db.prepare('INSERT INTO season_ratings (user_id, season_id, kind, rating, games, wins, losses, peak_rating) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind('b', season.id, 'cutthroat', 980, 2, 1, 1, 1010).run();

  await game('g1', 'team', 100); await played('g1', 'a', 'team', 0, 1, 100); await played('g1', 'b', 'team', 1, 0, 100);
  await game('g2', 'cutthroat', 200); await played('g2', 'a', 'cutthroat', 0, 0, 200); await played('g2', 'b', 'cutthroat', 1, 1, 200);
  await game('g3', 'team', 300); await played('g3', 'a', 'team', 0, 1, 300, 'b'); await played('g3', 'b', 'team', 0, 1, 300, 'a');
  await game('g4', 'team', 400, 'abandoned'); await played('g4', 'a', 'team', 0, 1, 400); await played('g4', 'b', 'team', 1, 0, 400);
}

beforeEach(async () => {
  db = await makeD1();
  await user('a'); await user('b'); await user('c');
  await seedSubject();
});

describe('the rank ladder (cardRankForLevel)', () => {
  it('deals the suits in order, 3 through Ace, twelve steps each', () => {
    const at = (lv: number) => cardRankForLevel(lv);
    expect(at(1)).toMatchObject({ rank: '3', suit: 'hearts', symbol: '♥', tier: 'hearts', isJoker: false });
    expect(at(12)).toMatchObject({ rank: 'A', suit: 'hearts', rankName: 'Ace' });
    expect(at(13)).toMatchObject({ rank: '3', suit: 'clubs', symbol: '♣' });
    expect(at(24)).toMatchObject({ rank: 'A', suit: 'clubs' });
    expect(at(25)).toMatchObject({ rank: '3', suit: 'diamonds', symbol: '♦' });
    expect(at(34)).toMatchObject({ rank: 'Q', suit: 'diamonds', rankName: 'Queen' });
    expect(at(36)).toMatchObject({ rank: 'A', suit: 'diamonds' });
    expect(at(37)).toMatchObject({ rank: '3', suit: 'spades', symbol: '♠' });
    expect(at(48)).toMatchObject({ rank: 'A', suit: 'spades' });
  });
  it('crowns the ladder: Deuce at 49, Little Joker at 50, Big Joker only as the active prestige step', () => {
    expect(cardRankForLevel(49)).toMatchObject({ step: 49, rank: '2', rankName: 'Deuce', suit: 'spades', tier: 'spades', isJoker: false, prestige: false });
    expect(cardRankForLevel(50)).toMatchObject({ step: 50, rank: 'JOKER', rankName: 'Little Joker', suit: null, tier: 'spades', isJoker: true, isLittleJoker: true, isBigJoker: false, prestige: false });
    // level 50 alone NEVER deals the Big Joker — the active crown is an input, not a level
    expect(cardRankForLevel(50, { bigJoker: true })).toMatchObject({ step: 51, rank: 'JOKER', rankName: 'Big Joker', suit: null, isBigJoker: true, isLittleJoker: false, prestige: true, level: 50 });
    expect(cardRankForLevel(49, { bigJoker: true }).step).toBe(49);
  });
  it('every step is a distinct card, and out-of-range levels clamp onto the ladder', () => {
    const seen = new Set<string>();
    for (let lv = 1; lv <= 50; lv++) { const c = cardRankForLevel(lv); seen.add(`${c.step}:${c.rank}:${c.suit}`); }
    seen.add(`${cardRankForLevel(50, { bigJoker: true }).step}:JOKER:null`);
    expect(seen.size).toBe(51);
    expect(cardRankForLevel(0).level).toBe(1);
    expect(cardRankForLevel(99).level).toBe(50);
    expect(cardRankForLevel(99).step).toBe(50);
  });
  it('"all badges" is exactly the 18 achievements + the 13 story badges (31 total)', () => {
    expect(ACHIEVEMENTS).toHaveLength(18);
    expect(STORY_BADGE_DEFS).toHaveLength(13);
    const mk = (kind: BadgeSummary['kind'], n: number): BadgeSummary[] =>
      Array.from({ length: n }, (_, i) => ({ kind, id: `${kind}-${i}`, name: null, icon: null, earnedAt: null }));
    // progress badges never count toward the denominator or the numerator
    expect(badgeCompletionFor([...mk('achievement', 18), ...mk('story', 13), ...mk('badge', 7)])).toMatchObject({ earned: 31, total: 31, complete: true });
    expect(badgeCompletionFor([...mk('achievement', 18), ...mk('story', 12)])).toMatchObject({ earned: 30, total: 31, complete: false });
    expect(badgeCompletionFor([...mk('achievement', 17), ...mk('story', 13)])).toMatchObject({ complete: false });
    expect(badgeCompletionFor([])).toMatchObject({ earned: 0, total: 31, complete: false });
  });
});

describe('save validators', () => {
  it('status: shared hygiene, 90 cap, blank clears', () => {
    expect(cleanCardStatus('  Run it   back ')).toEqual({ ok: true, value: 'Run it back' });
    expect(cleanCardStatus('this shit is mine')).toEqual({ ok: true, value: 'this s*** is mine' });
    const long = cleanCardStatus('x'.repeat(200));
    expect(long.ok).toBe(true);
    if (long.ok) expect(long.value).toHaveLength(90);
    expect(cleanCardStatus('   ')).toEqual({ ok: true, value: null });
    expect(cleanCardStatus(42).ok).toBe(false);
  });
  it('tags: closed vocabulary, at most 3, duplicates collapse', () => {
    expect(cleanCardTags(['casual', 'competitive', 'casual'])).toEqual({ ok: true, value: ['casual', 'competitive'] });
    expect(cleanCardTags(['casual', 'nope']).ok).toBe(false);
    expect(cleanCardTags(['casual', 'competitive', 'big-bank', 'nil-hunter']).ok).toBe(false);
    expect(cleanCardTags('casual').ok).toBe(false);
    expect(cleanCardTags([])).toEqual({ ok: true, value: [] });
  });
  it('showcase: earned membership or nothing, at most 3', () => {
    const earned = new Set(['achievement:first-dub', 'story:porch-graduate']);
    expect(cleanCardShowcase(['story:porch-graduate'], earned)).toEqual({ ok: true, value: ['story:porch-graduate'] });
    expect(cleanCardShowcase(['achievement:century'], earned).ok).toBe(false);
    expect(cleanCardShowcase(['achievement:first-dub', 'story:porch-graduate', 'badge:x', 'badge:y'], new Set(['achievement:first-dub', 'story:porch-graduate', 'badge:x', 'badge:y'])).ok).toBe(false);
    // …while a duplicate of an earned pick just collapses (3 unique picks is legal)
    expect(cleanCardShowcase(['achievement:first-dub', 'achievement:first-dub'], earned)).toEqual({ ok: true, value: ['achievement:first-dub'] });
    expect(cleanCardShowcase('achievement:first-dub', earned).ok).toBe(false);
  });
});

describe('the earned pool + card payload', () => {
  it('earnedBadgesFor gathers all three sets with honest names and timestamps', async () => {
    const badges = await earnedBadgesFor(db, 'b');
    const byKey = new Map(badges.map((b) => [badgeKey(b), b]));
    expect(byKey.get('achievement:first-dub')).toMatchObject({ name: 'First Dub', earnedAt: 1000 });
    expect(byKey.get('achievement:clean-nil')).toMatchObject({ name: 'Clean Nil', earnedAt: 2000 });
    expect(byKey.get('story:porch-graduate')).toMatchObject({ name: 'Porch Graduate', icon: '🎓', earnedAt: null });
    expect(byKey.get('badge:storm-chaser')).toMatchObject({ name: null, earnedAt: 3000 });
    expect(badges).toHaveLength(4);
  });

  it('cardFor assembles the whole card from real rows', async () => {
    const card = await cardFor(db, 'b', 'a', NOW);
    expect(card).not.toBeNull();
    const c = card as PlayerCardData;
    expect(c.name).toBe('B');
    expect(c.memberSince).toBe(1_700_000_000_000);
    expect(c.level).toEqual({ level: 1, title: 'New Jack' });
    expect(c.rank).toMatchObject({ rank: '3', suit: 'hearts', level: 1 });
    expect(c.status).toBeNull();
    expect(c.tags).toEqual([]);
    expect(c.story).toEqual({ stopsCleared: 1, stopsTotal: 11, completed: false });
    // default showcase: the 3 most recently earned (story badges carry no
    // timestamp, so they sort after every dated earn)
    expect(c.showcase.map(badgeKey)).toEqual(['badge:storm-chaser', 'achievement:clean-nil', 'achievement:first-dub']);
    // stats: g4 (abandoned, unrated for b) counts for nothing
    expect(c.stats.games).toBe(3);
    expect(c.stats.wins).toBe(2);
    expect(c.stats.losses).toBe(1);
    expect(c.stats.winPct).toBe(66.7);
    expect(c.stats.streak).toBe(2);
    expect(c.stats.team).toEqual({ rating: 1240, games: 10, wins: 6, losses: 4 });
    expect(c.stats.cutthroat).toEqual({ rating: 980, games: 2, wins: 1, losses: 1 });
    // head-to-head from the VIEWER's side: a won g1, lost g2; the partner
    // game g3 and the abandoned g4 are not meetings across the table
    expect(c.vsViewer).toEqual({ games: 2, wins: 1, losses: 1 });
  });

  it('vsViewer appears only for a different signed-in viewer with real meetings', async () => {
    expect((await cardFor(db, 'b', 'b', NOW))?.vsViewer).toBeUndefined();
    expect((await cardFor(db, 'b', null, NOW))?.vsViewer).toBeUndefined();
    expect((await cardFor(db, 'b', 'c', NOW))?.vsViewer).toBeUndefined();
  });

  it('a zero-record player gets an honest empty card, not fabricated stats', async () => {
    const c = await cardFor(db, 'c', null, NOW);
    expect(c?.stats).toMatchObject({ games: 0, wins: 0, losses: 0, winPct: null, streak: 0 });
    expect(c?.stats.team).toEqual({ rating: 1000, games: 0, wins: 0, losses: 0 });
    expect(c?.badges).toEqual([]);
    expect(c?.showcase).toEqual([]);
    expect(c?.story.stopsCleared).toBe(0);
    expect(c?.rank).toMatchObject({ rank: '3', suit: 'hearts' });
  });
});

describe('the Big Joker: latched feat, seasonal crown', () => {
  /** d: level 50 with EVERY badge — all 18 achievements + story facts that
   *  earn all 13 story badges (route complete, every egg, 6+ feats incl.
   *  a nil feat and a clean feat, 12+ attempts, the five badge stops). */
  async function seedBigJokerPlayer() {
    await user('d');
    await db.prepare('INSERT INTO xp_state (user_id, xp, level, updated_at) VALUES (?, ?, ?, ?)').bind('d', 40_000, 50, 1).run();
    for (const a of ACHIEVEMENTS) {
      await db.prepare('INSERT INTO user_achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)').bind('d', a.id, 1000).run();
    }
    for (const [stop, attempts] of [['porch', 12], ['corner', 1], ['church-basement', 1], ['the-pjs', 1], ['legends', 1]] as const) {
      await db.prepare('INSERT INTO story_progress (user_id, track_key, stop_id, attempts, clears, first_cleared_at) VALUES (?, ?, ?, ?, ?, ?)').bind('d', 'solo', stop, attempts, 1, 500).run();
    }
    await db.prepare('INSERT INTO story_tracks (user_id, track_key, completed_at, updated_at) VALUES (?, ?, ?, ?)').bind('d', 'solo', 900, 900).run();
    for (const s of Object.values(STORY_SECRETS)) {
      await db.prepare('INSERT INTO story_finds (user_id, track_key, kind, find_id, created_at) VALUES (?, ?, ?, ?, ?)').bind('d', 'solo', 'egg', s.egg.id, 700).run();
    }
    for (const f of ['story-church-pencil', 'story-roof-coin', 'story-pjs-bulb', 'story-porch-cap', 'story-king-crown-cap', 'story-rec-buzzer']) {
      await db.prepare('INSERT INTO story_finds (user_id, track_key, kind, find_id, created_at) VALUES (?, ?, ?, ?, ?)').bind('d', 'solo', 'feat', f, 700).run();
    }
  }

  it('a level-50 all-badges player latches the feat and displays step 51 (inaugural season: active)', async () => {
    await seedBigJokerPlayer();
    const c = await cardFor(db, 'd', null, NOW);
    expect(c?.bigJoker).toEqual({ earned: true, active: true });
    expect(c?.rank).toMatchObject({ step: 51, prestige: true, rankName: 'Big Joker', level: 50 });
    const row = await db.prepare('SELECT big_joker_at AS at FROM users WHERE id = ?').bind('d').first<{ at: number | null }>();
    expect(row?.at).toBe(NOW);
  });

  it('the latch is permanent: losing a badge afterwards never revokes the feat', async () => {
    await seedBigJokerPlayer();
    await cardFor(db, 'd', null, NOW);
    await db.prepare("DELETE FROM user_achievements WHERE user_id = 'd' AND achievement_id = 'century'").run();
    const c = await cardFor(db, 'd', null, NOW + 1000);
    expect(c?.bigJoker.earned).toBe(true);
    expect(c?.rank.step).toBe(51);
  });

  it('level 50 without all badges is the Little Joker, full stop — and level 49 never latches', async () => {
    await user('e');
    await db.prepare('INSERT INTO xp_state (user_id, xp, level, updated_at) VALUES (?, ?, ?, ?)').bind('e', 40_000, 50, 1).run();
    const c = await cardFor(db, 'e', null, NOW);
    expect(c?.bigJoker).toEqual({ earned: false, active: false });
    expect(c?.rank).toMatchObject({ step: 50, rankName: 'Little Joker', prestige: false });
  });

  it('seasonal upkeep (bigJokerSeason): earn season counts, inaugural rule covers unset seasons, a registered set reads the record', async () => {
    await user('d');
    const earnedAt = Date.UTC(2026, 9, 15); // mid October 2026
    expect(seasonIdFor(earnedAt)).toBe('2026-10');
    // same season → active even with a (hypothetical) registered set
    expect(await bigJokerSeasonActive(db, 'd', earnedAt, '2026-10', new Set(['2026-10']))).toBe(true);
    // later season, no set registered → inaugural rule: active
    expect(await bigJokerSeasonActive(db, 'd', earnedAt, '2026-11')).toBe(true);
    // later season WITH a set → the completion record decides
    const withSet = new Set(['2026-11']);
    expect(await bigJokerSeasonActive(db, 'd', earnedAt, '2026-11', withSet)).toBe(false);
    await db.prepare('INSERT INTO big_joker_season_upkeep (user_id, season_id, completed_at) VALUES (?, ?, ?)').bind('d', '2026-11', null).run();
    expect(await bigJokerSeasonActive(db, 'd', earnedAt, '2026-11', withSet)).toBe(false);
    await db.prepare("UPDATE big_joker_season_upkeep SET completed_at = ? WHERE user_id = 'd' AND season_id = '2026-11'").bind(NOW).run();
    expect(await bigJokerSeasonActive(db, 'd', earnedAt, '2026-11', withSet)).toBe(true);
    // never earned → never active
    expect(await bigJokerSeasonActive(db, 'd', null, '2026-10')).toBe(false);
  });
});

describe('the card save route + profile payloads', () => {
  it('save → both profile reads carry the saved card; the public read answers vsViewer for the caller', async () => {
    const tokB = await session('b');
    const tokA = await session('a');
    const saved = await call(tokB, '/api/profile/me/card', {
      method: 'POST',
      body: JSON.stringify({ status: '  Tuesday   night champ ', tags: ['casual', 'story-coop'], showcase: ['story:porch-graduate', 'achievement:first-dub'] }),
    });
    expect(saved.status).toBe(200);
    const savedCard = (await saved.json() as { card: PlayerCardData }).card;
    expect(savedCard.status).toBe('Tuesday night champ');
    expect(savedCard.tags).toEqual(['casual', 'story-coop']);
    expect(savedCard.showcase.map(badgeKey)).toEqual(['story:porch-graduate', 'achievement:first-dub']);

    const me = await (await call(tokB, '/api/profile/me')).json() as { card: PlayerCardData };
    expect(me.card.status).toBe('Tuesday night champ');
    expect(me.card.vsViewer).toBeUndefined();

    const pubAnon = await (await call(null, '/api/profile/b')).json() as { card: PlayerCardData };
    expect(pubAnon.card.tags).toEqual(['casual', 'story-coop']);
    expect(pubAnon.card.vsViewer).toBeUndefined();

    const pubForA = await (await call(tokA, '/api/profile/b')).json() as { card: PlayerCardData };
    expect(pubForA.card.vsViewer).toEqual({ games: 2, wins: 1, losses: 1 });
  });

  it('rejects what the rules reject: unknown tag, unearned showcase, oversize picks, signed-out save', async () => {
    const tokB = await session('b');
    const post = (body: unknown) => call(tokB, '/api/profile/me/card', { method: 'POST', body: JSON.stringify(body) });
    expect((await post({ status: 'ok', tags: ['wizard'], showcase: [] })).status).toBe(400);
    expect((await post({ status: 'ok', tags: [], showcase: ['achievement:century'] })).status).toBe(400);
    expect((await post({ status: 'ok', tags: ['casual', 'competitive', 'big-bank', 'nil-hunter'], showcase: [] })).status).toBe(400);
    expect((await post({ status: 42, tags: [], showcase: [] })).status).toBe(400);
    const anon = await call(null, '/api/profile/me/card', { method: 'POST', body: JSON.stringify({ status: 'x', tags: [], showcase: [] }) });
    expect(anon.status).toBe(401);
    // and nothing was written by any of the rejected saves
    const me = await (await call(tokB, '/api/profile/me')).json() as { card: PlayerCardData };
    expect(me.card.status).toBeNull();
    expect(me.card.tags).toEqual([]);
  });

  it('the public payload leaks nothing private — exact key sets, card included', async () => {
    const pub = await (await call(null, '/api/profile/b')).json() as Record<string, unknown>;
    expect(Object.keys(pub).sort()).toEqual(['achievements', 'card', 'coins', 'level', 'rank', 'season', 'stats', 'user'].sort());
    expect(pub).not.toHaveProperty('challenges');
    expect(pub).not.toHaveProperty('unlocks');
    expect(pub).not.toHaveProperty('dev');
    expect(pub).not.toHaveProperty('storyAccess');
    const card = pub.card as PlayerCardData;
    expect(Object.keys(card).sort()).toEqual(
      ['userId', 'name', 'avatar', 'avatarUpdatedAt', 'memberSince', 'level', 'rank', 'bigJoker', 'status', 'tags', 'showcase', 'badges', 'story', 'stats'].sort());
    for (const b of card.badges) {
      expect(Object.keys(b).sort()).toEqual(['earnedAt', 'icon', 'id', 'kind', 'name'].sort());
    }
    const raw = JSON.stringify(pub);
    for (const secret of ['username_key', 'card_tags', 'card_showcase', 'social_settings', 'mutes', 'partner_id', 'pair:']) {
      expect(raw).not.toContain(secret);
    }
  });
});
