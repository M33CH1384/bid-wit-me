/**
 * BWM Central Phase 2 (client): deterministic Headlines engine, rivalry
 * derivation, pair-praise threshold, favorites wiring. Pure-model tests +
 * source-wiring assertions in the repo idiom. Data honesty is the point:
 * no anchor -> no rivalry card; below sample -> no praise copy; a story is
 * "new" exactly once.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HEADLINES_MAX, buildHeadlines, markSeenIds, nearestMilestone, parseSeenIds,
  type HeadlineInputs,
} from '../src/social/headlines';
import { buildRivalries } from '../src/social/rivalries';
import {
  MIN_PAIR_PRAISE_GAMES, MIN_PAIR_PRAISE_WIN_PCT, pairPraise, pairWinPct,
} from '../src/social/pairRecord';
import {
  fetchFavoritesList, normalizeUserId, setFavoriteRemote, toggleFavoriteList,
} from '../src/social/favorites';
import type { RecentResult } from '../src/social/LeagueTicker';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const mk = (id: string, at: number, names: string[][], mode = 'joker'): RecentResult => ({
  id, at, kind: names.length > 2 ? 'cutthroat' : 'team', mode, code: 'ABCD',
  sides: names.map((n, i) => ({ names: n, score: 500 - i * 100, won: i === 0 })), wheels: false,
});

const base = (over: Partial<HeadlineInputs> = {}): HeadlineInputs => ({
  myName: 'Me', myUid: 'me1', results: [], me: null, h2h: [], powerRows: [],
  highlights: [], wagers: [], invites: [], sentInvites: [], friendNames: [], tables: [], seen: [],
  ...over,
});

afterEach(() => { vi.unstubAllGlobals(); });

/* ------------------------------------------------------------ own result */

describe('headlines: own-result', () => {
  it('the caller newest result in the feed becomes the top story, anchored to its id/at', () => {
    const cards = buildHeadlines(base({
      results: [mk('g2', 200, [['Other', 'A'], ['Me', 'B']]), mk('g1', 100, [['Me', 'B'], ['Other', 'A']])],
    }));
    expect(cards[0]?.type).toBe('own-result');
    expect(cards[0]?.id).toBe('own-result:g2');
    expect(cards[0]?.at).toBe(200);
    expect(cards[0]?.action).toEqual({ kind: 'match', id: 'g2' });
    expect(cards[0]?.text).toContain('Other + A def. Me + B');
  });
  it('no card when the caller is in no feed result, and never for guests', () => {
    const rows = [mk('g1', 100, [['A', 'B'], ['C', 'D']])];
    expect(buildHeadlines(base({ results: rows })).some((c) => c.type === 'own-result')).toBe(false);
    expect(buildHeadlines(base({ results: [mk('g1', 100, [['Me', 'B'], ['C', 'D']])], myName: null })).some((c) => c.type === 'own-result')).toBe(false);
  });
});

/* ----------------------------------------------------------- challenge-set */

describe('headlines: challenge-set', () => {
  const wager = (status: string, uid = 'me1') => ({
    id: 'w1', status, startAt: 5000, mode: 'joker', format: 'partnership' as const,
    players: [{ uid, name: 'Me', status: 'invited' }, { uid: 'x1', name: 'Rex', status: 'invited' }],
  });
  it('an upcoming wager challenge involving the caller, with its honest state word', () => {
    const cards = buildHeadlines(base({ wagers: [wager('pending')] }));
    const c = cards.find((x) => x.type === 'challenge-set');
    expect(c).toBeTruthy();
    expect(c?.text).toContain('Pending');
    expect(c?.at).toBe(5000);
    expect(c?.action).toEqual({ kind: 'challenge', id: 'w1' });
    const acc = buildHeadlines(base({ wagers: [wager('scheduled')] })).find((x) => x.type === 'challenge-set');
    expect(acc?.text).toContain('Accepted');
  });
  it('a wager the caller DECLINED makes no card (their state is not "set")', () => {
    const declined = {
      id: 'w2', status: 'pending', startAt: 5000, mode: 'joker', format: 'partnership' as const,
      players: [{ uid: 'me1', name: 'Me', status: 'declined' }, { uid: 'x1', name: 'Rex', status: 'invited' }],
    };
    expect(buildHeadlines(base({ wagers: [declined] })).some((c) => c.type === 'challenge-set')).toBe(false);
  });
  it('a wager the caller is not in, or a finished one, makes no card', () => {
    expect(buildHeadlines(base({ wagers: [wager('pending', 'someone-else')] })).some((c) => c.type === 'challenge-set')).toBe(false);
    expect(buildHeadlines(base({ wagers: [wager('settled')] })).some((c) => c.type === 'challenge-set')).toBe(false);
  });
  it('a pending table invite addressed to the caller makes the card instead', () => {
    const cards = buildHeadlines(base({
      invites: [{ id: 'i1', from: 'u:rex', fromName: 'Rex', code: 'WXYZ', mode: 'joker', expiresAt: 9000 }],
    }));
    const c = cards.find((x) => x.type === 'challenge-set');
    expect(c).toBeTruthy();
    expect(c?.text).toContain('Rex');
    expect(c?.text).toContain('Pending');
    expect(c?.action).toEqual({ kind: 'invite', id: 'i1' });
  });
});

/* ---------------------------------------------------------------- rivalry */

describe('headlines: rivalry (anchored only)', () => {
  const h2h = [{ id: 'u:rex', name: 'Rex', games: 5, wins: 3, losses: 2 }];
  it('top rivalry >=3 meetings WITH its latest meeting in the feed: series state copy', () => {
    const cards = buildHeadlines(base({
      h2h,
      results: [mk('g9', 300, [['Rex', 'A'], ['Me', 'B']])],
    }));
    const c = cards.find((x) => x.type === 'rivalry');
    expect(c).toBeTruthy();
    expect(c?.text).toContain('You lead Rex 3–2');
    expect(c?.text).toContain('5 games');
    expect(c?.action).toEqual({ kind: 'match', id: 'g9' });
  });
  it('NO anchor in the feed -> NO rivalry card, however many meetings', () => {
    const cards = buildHeadlines(base({ h2h, results: [mk('g1', 100, [['A', 'B'], ['C', 'D']])] }));
    expect(cards.some((c) => c.type === 'rivalry')).toBe(false);
  });
  it('fewer than 3 meetings -> no card even when anchored', () => {
    const cards = buildHeadlines(base({
      h2h: [{ id: 'u:rex', name: 'Rex', games: 2, wins: 1, losses: 1 }],
      results: [mk('g9', 300, [['Rex', 'A'], ['Me', 'B']])],
    }));
    expect(cards.some((c) => c.type === 'rivalry')).toBe(false);
  });
  it('a tied series reads ALL SQUARE', () => {
    const cards = buildHeadlines(base({
      h2h: [{ id: 'u:rex', name: 'Rex', games: 4, wins: 2, losses: 2 }],
      results: [mk('g9', 300, [['Rex', 'A'], ['Me', 'B']])],
    }));
    expect(cards.find((x) => x.type === 'rivalry')?.text).toContain('ALL SQUARE');
  });
});

/* -------------------------------------------------------------- milestone */

describe('headlines: milestone (nearest completable, real progress only)', () => {
  const meWith = (challenges: unknown[], level = { level: 7, xp: 700, xpForNext: 275, xpIntoLevel: 200, title: 'Prospect' }) => ({
    level, challenges: { daily: challenges, weekly: [], season: { challenges: [] } },
  });
  it('a challenge with progress>0 unclaimed beats a lower-fraction level', () => {
    // challenge fraction 1/2 = .5; level fraction 10/275 ~= .04
    const m = nearestMilestone(meWith(
      [{ id: 'c1', title: 'Win 2 games', progress: 1, target: 2, claimed: false }],
      { level: 7, xp: 700, xpForNext: 275, xpIntoLevel: 10, title: 'Prospect' },
    ) as never);
    expect(m?.kind).toBe('challenge');
    expect(m?.title).toBe('Win 2 games');
    expect(m?.fraction).toBeCloseTo(0.5);
  });
  it('highest progress fraction wins across challenge and level', () => {
    const m = nearestMilestone(meWith(
      [{ id: 'c1', title: 'Win 2 games', progress: 1, target: 4, claimed: false }],
      { level: 7, xp: 700, xpForNext: 200, xpIntoLevel: 190, title: 'Prospect' },
    ) as never);
    expect(m?.kind).toBe('level');
    expect(m?.fraction).toBeCloseTo(0.95);
  });
  it('claimed or zero-progress challenges are not milestones', () => {
    const m = nearestMilestone(meWith([
      { id: 'c1', title: 'Done', progress: 2, target: 2, claimed: true },
      { id: 'c2', title: 'Untouched', progress: 0, target: 2, claimed: false },
    ], { level: 7, xp: 700, xpForNext: 275, xpIntoLevel: 200, title: 'Prospect' }) as never);
    expect(m?.kind).toBe('level');
  });
  it('O1: a level at 0 progress is NOT a milestone (coordinator ruling 2026-11-05)', () => {
    // The challenges path already requires progress > 0; the level path
    // must too — a brand-new player (0/100 XP to Level 2) has earned no
    // milestone story and gets the honest empty state instead.
    const m = nearestMilestone(meWith([],
      { level: 1, xp: 0, xpForNext: 100, xpIntoLevel: 0, title: 'New Jack' }) as never);
    expect(m).toBeNull();
  });
  it('O1: zero-progress level + zero-progress challenges -> no milestone at all', () => {
    const m = nearestMilestone(meWith(
      [{ id: 'c2', title: 'Untouched', progress: 0, target: 2, claimed: false }],
      { level: 1, xp: 0, xpForNext: 100, xpIntoLevel: 0, title: 'New Jack' }) as never);
    expect(m).toBeNull();
  });
  it('O1: a brand-new player builds ZERO headline cards (headline-empty renders)', () => {
    const cards = buildHeadlines(base({
      myName: 'NewPlayerNia', myUid: 'nia1',
      me: meWith([], { level: 1, xp: 0, xpForNext: 100, xpIntoLevel: 0, title: 'New Jack' }) as never,
    }));
    expect(cards).toEqual([]);
  });
  it('O1: level progress of 1 XP still qualifies (the gate is > 0, not a threshold)', () => {
    const m = nearestMilestone(meWith([],
      { level: 1, xp: 1, xpForNext: 100, xpIntoLevel: 1, title: 'New Jack' }) as never);
    expect(m?.kind).toBe('level');
  });
  it('the milestone card shows title + progress/target (challenge) or XP to next level', () => {
    const cards = buildHeadlines(base({
      me: meWith([{ id: 'c1', title: 'Take 15 books', progress: 14, target: 15, claimed: false }],
        { level: 3, xp: 300, xpForNext: 175, xpIntoLevel: 10, title: 'New Jack' }) as never,
    }));
    const c = cards.find((x) => x.type === 'milestone');
    expect(c?.text).toContain('Take 15 books');
    expect(c?.text).toContain('14/15');
    const lvl = buildHeadlines(base({ me: meWith([], { level: 3, xp: 300, xpForNext: 175, xpIntoLevel: 100, title: 'New Jack' }) as never }))
      .find((x) => x.type === 'milestone');
    expect(lvl?.text).toContain('75 XP');
    expect(lvl?.text).toContain('Level 4');
  });
  it('no me payload -> no milestone card', () => {
    expect(buildHeadlines(base({ me: null })).some((c) => c.type === 'milestone')).toBe(false);
  });
});

/* ----------------------------------------------------- friends-result/watch */

describe('headlines: friends-result and watch', () => {
  it('newest feed result containing a friend (and not the caller) is the friends story', () => {
    const cards = buildHeadlines(base({
      friendNames: ['Pal'],
      results: [mk('g5', 500, [['Pal', 'A'], ['C', 'D']]), mk('g4', 400, [['Me', 'A'], ['Pal', 'D']])],
    }));
    const c = cards.find((x) => x.type === 'friends-result');
    expect(c?.id).toBe('friends-result:g5');
    expect(c?.action).toEqual({ kind: 'match', id: 'g5' });
  });
  it('public live tables make a watch card linking to the lobby', () => {
    const cards = buildHeadlines(base({
      tables: [{ code: 'WXYZ', mode: 'joker', status: 'playing', humans: 3, open: 1 }],
    }));
    const c = cards.find((x) => x.type === 'watch');
    expect(c).toBeTruthy();
    expect(c?.action).toEqual({ kind: 'lobby' });
  });
  it('no public tables -> no watch card', () => {
    expect(buildHeadlines(base()).some((c) => c.type === 'watch')).toBe(false);
  });
});

/* --------------------------------------------------------- priority + cap */

describe('headlines: priority order, wire leftovers, cap', () => {
  it('priority: own-result > challenge-set > rivalry > milestone > friends-result > watch > wire', () => {
    const cards = buildHeadlines(base({
      results: [
        mk('own', 900, [['Me', 'B'], ['Rex', 'A']]),
        mk('pal', 800, [['Pal', 'A'], ['C', 'D']]),
        mk('wire1', 700, [['E', 'F'], ['G', 'H']]),
      ],
      wagers: [{ id: 'w1', status: 'pending', startAt: 5000, mode: 'joker', format: 'partnership', players: [{ uid: 'me1', name: 'Me', status: 'invited' }] }],
      h2h: [{ id: 'u:rex', name: 'Rex', games: 5, wins: 3, losses: 2 }],
      me: { level: { level: 3, xp: 1, xpForNext: 175, xpIntoLevel: 100, title: 'New Jack' }, challenges: { daily: [], weekly: [], season: { challenges: [] } } } as never,
      friendNames: ['Pal'],
      tables: [{ code: 'WXYZ', mode: 'joker', status: 'waiting', humans: 2, open: 2 }],
    }));
    expect(cards.slice(0, 6).map((c) => c.type)).toEqual(['own-result', 'challenge-set', 'rivalry', 'milestone', 'friends-result', 'watch']);
    expect(cards[6]?.type).toBe('wire-result');
    expect(cards[6]?.id).toBe('wire-result:wire1');
  });
  it('caps at HEADLINES_MAX (12) with a long wire', () => {
    const results = Array.from({ length: 30 }, (_, i) => mk(`g${i}`, 1000 - i, [['A', 'B'], ['C', 'D']]));
    const cards = buildHeadlines(base({ results }));
    expect(cards.length).toBe(HEADLINES_MAX);
    expect(HEADLINES_MAX).toBe(12);
  });
  it('ids are stable across rebuilds of the same inputs', () => {
    const input = base({ results: [mk('g1', 100, [['Me', 'B'], ['C', 'D']])] });
    expect(buildHeadlines(input).map((c) => c.id)).toEqual(buildHeadlines(input).map((c) => c.id));
  });
});

/* ---------------------------------------------------------------- seen-set */

describe('headlines: seen-set (a story is new exactly once)', () => {
  const input = () => base({
    results: [mk('own', 900, [['Me', 'B'], ['Rex', 'A']]), mk('wire1', 700, [['E', 'F'], ['G', 'H']])],
    tables: [{ code: 'WXYZ', mode: 'joker', status: 'waiting', humans: 2, open: 2 }],
  });
  it('first visit: every card is new; after marking seen, none is new and wire order holds', () => {
    const first = buildHeadlines(input());
    expect(first.every((c) => c.isNew)).toBe(true);
    const seen = markSeenIds([], first.map((c) => c.id));
    const second = buildHeadlines({ ...input(), seen });
    expect(second.some((c) => c.isNew)).toBe(false);
    expect(second.map((c) => c.type)).toEqual(first.map((c) => c.type));
  });
  it('a genuinely new story still surfaces as new on a later visit', () => {
    const first = buildHeadlines(input());
    const seen = markSeenIds([], first.map((c) => c.id));
    const later = buildHeadlines({ ...input(), seen, results: [mk('fresh', 950, [['Me', 'B'], ['Zed', 'A']]), ...input().results] });
    const fresh = later.find((c) => c.id === 'own-result:fresh');
    expect(fresh?.isNew).toBe(true);
    expect(later[0]?.id).toBe('own-result:fresh');
  });
  it('parse/mark round-trip, junk rejected, cap enforced', () => {
    expect(parseSeenIds('["a","b"]')).toEqual(['a', 'b']);
    expect(parseSeenIds('not json')).toEqual([]);
    expect(parseSeenIds('{"x":1}')).toEqual([]);
    const many = markSeenIds([], Array.from({ length: 500 }, (_, i) => `s${i}`));
    expect(many.length).toBeLessThanOrEqual(100);
    expect(many[many.length - 1]).toBe('s499');
  });
});

/* --------------------------------------------------------------- rivalries */

describe('rivalry derivation', () => {
  const h2h = [
    { id: 'u:rex', name: 'Rex', games: 5, wins: 3, losses: 2 },
    { id: 'u:sam', name: 'Sam', games: 4, wins: 2, losses: 2 },
    { id: 'u:kim', name: 'Kim', games: 2, wins: 2, losses: 0 },
  ];
  it('series W-L, win% and games ride the card; most-played first', () => {
    const cards = buildRivalries(h2h, [], 'Me');
    expect(cards.map((c) => c.name)).toEqual(['Rex', 'Sam', 'Kim']);
    expect(cards[0]).toMatchObject({ games: 5, wins: 3, losses: 2, winPct: 60 });
  });
  it('a tied series is ALL SQUARE (tied flag, no leader)', () => {
    const sam = buildRivalries(h2h, [], 'Me')[1]!;
    expect(sam.tied).toBe(true);
    expect(sam.leaderName).toBeNull();
    const rex = buildRivalries(h2h, [], 'Me')[0]!;
    expect(rex.tied).toBe(false);
    expect(rex.leaderName).toBe('Me');
  });
  it('last meeting only counts when the pair are on OPPOSITE sides of a feed row', () => {
    const sameSide = buildRivalries(h2h, [mk('g1', 100, [['Me', 'Rex'], ['A', 'B']])], 'Me');
    expect(sameSide[0]?.lastMeeting).toBeNull();
    expect(sameSide[0]?.runItBackMode).toBeNull();
    const opp = buildRivalries(h2h, [mk('g2', 200, [['Rex', 'A'], ['Me', 'B']], 'aceDown')], 'Me');
    expect(opp[0]?.lastMeeting?.id).toBe('g2');
    expect(opp[0]?.runItBackMode).toBe('aceDown');
    expect(opp[0]?.lastMeetingOpponents).toEqual(['Rex', 'A']);
  });
  it('no feed meeting -> runItBackMode null (the card must not offer Run It Back)', () => {
    expect(buildRivalries(h2h, [], 'Me').every((c) => c.runItBackMode === null)).toBe(true);
  });
});

/* -------------------------------------------------------------- pair praise */

describe('pair praise threshold (10 games AND 55%)', () => {
  it('the named constants are the documented thresholds', () => {
    expect(MIN_PAIR_PRAISE_GAMES).toBe(10);
    expect(MIN_PAIR_PRAISE_WIN_PCT).toBe(55);
  });
  it('9 games at 100% -> no praise (sample too small)', () => {
    expect(pairPraise({ games: 9, wins: 9, losses: 0 })).toBe(false);
  });
  it('10 games at 54% -> no praise', () => {
    // 54% is not representable at 10 games; use 50 games, 27 wins = 54%
    expect(pairWinPct({ games: 50, wins: 27, losses: 23 })).toBe(54);
    expect(pairPraise({ games: 50, wins: 27, losses: 23 })).toBe(false);
  });
  it('10 games at 55%+ -> praise (20 games, 11 wins = 55%; 10 games 60%)', () => {
    expect(pairPraise({ games: 20, wins: 11, losses: 9 })).toBe(true);
    expect(pairPraise({ games: 10, wins: 6, losses: 4 })).toBe(true);
  });
  it('win% of an empty record is null, never 0 or 100', () => {
    expect(pairWinPct({ games: 0, wins: 0, losses: 0 })).toBeNull();
    expect(pairPraise({ games: 0, wins: 0, losses: 0 })).toBe(false);
  });
});

/* --------------------------------------------------------------- favorites */

describe('favorites wiring', () => {
  it('id forms normalize: u:-prefixed and raw are the same partner', () => {
    expect(normalizeUserId('u:abc')).toBe('abc');
    expect(normalizeUserId('abc')).toBe('abc');
  });
  it('toggle helper adds/removes without duplicates', () => {
    const a = toggleFavoriteList([], { userId: 'abc', name: 'Abc' }, true);
    expect(a).toEqual([{ userId: 'abc', name: 'Abc' }]);
    expect(toggleFavoriteList(a, { userId: 'u:abc', name: 'Abc' }, true)).toEqual(a);
    expect(toggleFavoriteList(a, { userId: 'abc', name: 'Abc' }, false)).toEqual([]);
  });
  it('star/unstar hit POST/DELETE on the favorites endpoint (mocked fetch)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    await setFavoriteRemote('u:abc', true);
    expect(fetchMock).toHaveBeenCalledWith('/api/social/favorites/abc', expect.objectContaining({ method: 'POST' }));
    await setFavoriteRemote('abc', false);
    expect(fetchMock).toHaveBeenCalledWith('/api/social/favorites/abc', expect.objectContaining({ method: 'DELETE' }));
  });
  it('the favorites list reads GET /api/social/favorites (mocked fetch)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ favorites: [{ userId: 'abc', name: 'Abc' }] }) }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchFavoritesList()).resolves.toEqual([{ userId: 'abc', name: 'Abc' }]);
    expect(fetchMock).toHaveBeenCalledWith('/api/social/favorites', expect.anything());
  });
});

/* ------------------------------------------------------------ source wiring */

describe('Phase 2 wiring (source)', () => {
  it('Headlines renders the engine, not the Phase 1 card assembly', () => {
    const central = read('../src/social/Central.tsx');
    expect(central).toContain('buildHeadlines');
    expect(central).toContain('HEADLINE_SEEN_KEY');
    expect(central).toContain('data-testid={`headline-card-');
    expect(central).toContain('headline-new');
  });
  it('Matchups carries Rivalries and a Challenges surfacing section; Big Bank stays', () => {
    const central = read('../src/social/Central.tsx');
    expect(central).toContain('data-testid="matchup-rivalries"');
    expect(central).toContain('buildRivalries');
    expect(central).toContain('ALL SQUARE');
    expect(central).toContain('data-testid={`rivalry-run-it-back-');
    expect(central).toContain('data-testid="matchup-challenges"');
    expect(central).toContain('social.replyInvite');
    expect(central).toContain('WagerChallenges');
  });
  it('Crew carries Favorite partners; friends + recent rows carry star toggles', () => {
    const central = read('../src/social/Central.tsx');
    const social = read('../src/social/Social.tsx');
    expect(central).toContain('data-testid="favorite-partners"');
    expect(central).toContain('Star a partner to pin them here');
    expect(central).toContain('/api/profile/pair/');
    expect(social).toContain('FavoritePartners');
    expect(social).toContain('testid={`fav-star-');
    expect(social).toContain('testid={`fav-star-recent-');
  });
  it('the pair block on profiles shows the record, gates praise on the named constants, and carries a star', () => {
    const pv = read('../src/profile/ProfileView.tsx');
    expect(pv).toContain('data-testid="pair-together"');
    expect(pv).toContain('You two together');
    expect(pv).toContain('pairPraise');
    expect(pv).toContain('You two play well together');
    expect(pv).toContain('/api/profile/pair/');
    expect(pv).toContain('FavoriteStar');
  });
  it('favorites toggles go through the Phase 1 endpoints only (no new send paths)', () => {
    const fav = read('../src/social/favorites.ts');
    expect(fav).toContain('/api/social/favorites');
    expect(fav).toContain("method: 'POST'");
    expect(fav).toContain("method: 'DELETE'");
  });
});
