/**
 * BWM Central Phase 3 (client): the celebration queue + its hub wiring,
 * duo pair cards, crew contract helpers, personal-bests honesty, and the
 * postgame personal-best diff. Pure modules first; source pins last.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CELEBRATION_PRIORITY, CelebrationQueue, celebrationPresentation,
  checkRankPromotion, PROMOTION_LEVEL_KEY,
} from '../src/social/celebration';
import { personalBestTiles, type PersonalBestsInput } from '../src/social/personalBests';
import { duoCardFromRow, type DuoRow } from '../src/social/duos';
import { crewLeaderboardUrl, normalizeCrewsPayload } from '../src/social/crews';
import { computeRewards, type RewardsProfile } from '../src/GameOverRewards';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

/* --------------------------------------------------------- celebration queue */

describe('celebration queue: priority, dedupe, skip, cancel', () => {
  it('orders promotion > personal best > rivalry > generic regardless of enqueue order', () => {
    const q = new CelebrationQueue();
    q.enqueue({ key: 'g1', kind: 'generic', title: 'G' });
    q.enqueue({ key: 'r1', kind: 'rivalry', title: 'R' });
    q.enqueue({ key: 'p1', kind: 'personal-best', title: 'PB' });
    q.enqueue({ key: 'pr1', kind: 'promotion', title: 'P' });
    expect(CELEBRATION_PRIORITY.promotion).toBeGreaterThan(CELEBRATION_PRIORITY['personal-best']);
    expect(q.current()?.key).toBe('pr1');
    q.dismiss();
    expect(q.current()?.key).toBe('p1');
    q.dismiss();
    expect(q.current()?.key).toBe('r1');
    q.dismiss();
    expect(q.current()?.key).toBe('g1');
    q.dismiss();
    expect(q.current()).toBeNull();
  });

  it('is FIFO inside one priority', () => {
    const q = new CelebrationQueue();
    q.enqueue({ key: 'a', kind: 'generic', title: 'A' });
    q.enqueue({ key: 'b', kind: 'generic', title: 'B' });
    expect(q.current()?.key).toBe('a');
    q.dismiss();
    expect(q.current()?.key).toBe('b');
  });

  it('dedupes by key for the whole session — even after the item showed', () => {
    const seen = new Set<string>();
    const q = new CelebrationQueue(seen);
    expect(q.enqueue({ key: 'allsquare:u:1', kind: 'rivalry', title: 'ALL SQUARE' })).toBe(true);
    expect(q.enqueue({ key: 'allsquare:u:1', kind: 'rivalry', title: 'ALL SQUARE' })).toBe(false);
    q.dismiss();
    // a fresh queue over the same session seen-set still refuses it
    const q2 = new CelebrationQueue(seen);
    expect(q2.enqueue({ key: 'allsquare:u:1', kind: 'rivalry', title: 'ALL SQUARE' })).toBe(false);
  });

  it('cancelAll clears current + pending (host unmount / route change)', () => {
    const q = new CelebrationQueue();
    q.enqueue({ key: 'a', kind: 'promotion', title: 'A' });
    q.enqueue({ key: 'b', kind: 'generic', title: 'B' });
    q.cancelAll();
    expect(q.current()).toBeNull();
    expect(q.pending()).toEqual([]);
  });
});

describe('celebration presentation: governor + reduced motion', () => {
  const item = { key: 'x', kind: 'generic' as const, title: 'X' };
  it('deepest governor trim (level 3) renders a static badge, no motion', () => {
    expect(celebrationPresentation(item, { governorLevel: 3, reducedMotion: false })).toBe('static');
  });
  it('below the deepest trim, motion is allowed', () => {
    expect(celebrationPresentation(item, { governorLevel: 2, reducedMotion: false })).toBe('motion');
    expect(celebrationPresentation(item, { governorLevel: 0, reducedMotion: false })).toBe('motion');
  });
  it('reduced motion is the instant final state, and wins over the governor', () => {
    expect(celebrationPresentation(item, { governorLevel: 0, reducedMotion: true })).toBe('instant');
    expect(celebrationPresentation(item, { governorLevel: 3, reducedMotion: true })).toBe('instant');
  });
});

/* ------------------------------------------------------------- promotion */

function memStorage(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    dump: () => Object.fromEntries(m),
  };
}

describe('rank promotion: last-seen level in storage', () => {
  it('first-ever view stores silently — no fake promotion', () => {
    const st = memStorage();
    expect(checkRankPromotion(st, 7)).toBeNull();
    expect(st.dump()[PROMOTION_LEVEL_KEY]).toBe('7');
  });
  it('a higher level promotes once and updates the stored value', () => {
    const st = memStorage({ [PROMOTION_LEVEL_KEY]: '7' });
    expect(checkRankPromotion(st, 9)).toEqual({ from: 7, to: 9 });
    expect(st.dump()[PROMOTION_LEVEL_KEY]).toBe('9');
    expect(checkRankPromotion(st, 9)).toBeNull();
  });
  it('equal or lower never promotes and never lowers the high-water mark', () => {
    const st = memStorage({ [PROMOTION_LEVEL_KEY]: '9' });
    expect(checkRankPromotion(st, 9)).toBeNull();
    expect(checkRankPromotion(st, 5)).toBeNull();
    expect(st.dump()[PROMOTION_LEVEL_KEY]).toBe('9');
  });
  it('a corrupt stored value is treated as a first view (stored, silent)', () => {
    const st = memStorage({ [PROMOTION_LEVEL_KEY]: 'abc' });
    expect(checkRankPromotion(st, 3)).toBeNull();
    expect(st.dump()[PROMOTION_LEVEL_KEY]).toBe('3');
  });
});

/* ---------------------------------------------------------- personal bests */

const pbInput = (over: Partial<PersonalBestsInput> = {}): PersonalBestsInput => ({
  rank: {
    team: { peak: 1310, games: 40 },
    cutthroat: { peak: 1000, games: 0 },
  },
  stats: {
    team: { bestStreak: 6 },
    cutthroat: { bestStreak: 3 },
  },
  ...over,
});

describe('personal bests strip: existing fields only', () => {
  it('peak tiles only for kinds with rated games; best streak is the max across kinds', () => {
    const tiles = personalBestTiles(pbInput());
    expect(tiles).toContainEqual({ label: 'Peak rating — Partnership', value: '1,310' });
    expect(tiles.find((t) => t.label.includes('Cutthroat'))).toBeUndefined();
    expect(tiles).toContainEqual({ label: 'Best streak', value: '6' });
  });
  it('never invents a most-books-in-a-hand tile — the payload carries no such field', () => {
    const tiles = personalBestTiles(pbInput());
    expect(tiles.some((t) => /books in a hand/i.test(t.label))).toBe(false);
  });
  it('no games and no streak → no tiles at all (absent, never 0)', () => {
    expect(personalBestTiles({
      rank: { team: { peak: 1000, games: 0 }, cutthroat: { peak: 1000, games: 0 } },
      stats: { team: { bestStreak: 0 }, cutthroat: {} },
    })).toEqual([]);
    expect(personalBestTiles(null)).toEqual([]);
    expect(personalBestTiles({})).toEqual([]);
  });
});

/* ------------------------------------------------------- postgame plaque */

function profile(peak: number | undefined, elo = 1200): RewardsProfile {
  const rank = peak === undefined ? { elo } : { elo, peak };
  return {
    level: { level: 5, xp: 500, title: 'Certified', xpForNext: 600, xpIntoLevel: 100 },
    coins: { balance: 100 },
    rank: { team: rank, cutthroat: { elo: 1200 } },
    achievements: [],
    challenges: { daily: [], weekly: [] },
  } as RewardsProfile;
}
const opts = { won: true, headline: 'You win', sub: '', kind: 'team' as const };

describe('postgame personal best: the rewards diff carries a peak increase only', () => {
  it('peak rose → personalBest names the new peak', () => {
    const d = computeRewards(profile(1250), profile(1330, 1330), opts);
    expect(d.personalBest).toEqual({ peak: 1330 });
  });
  it('peak flat or down → no plaque', () => {
    expect(computeRewards(profile(1330), profile(1330), opts).personalBest).toBeNull();
    expect(computeRewards(profile(1400), profile(1330), opts).personalBest).toBeNull();
  });
  it('a snapshot without peak (older pin) → no plaque, never invented', () => {
    expect(computeRewards(profile(undefined), profile(1330), opts).personalBest).toBeNull();
    expect(computeRewards(profile(1250), profile(undefined), opts).personalBest).toBeNull();
  });
});

/* ------------------------------------------------------------------ duos */

describe('duo pair cards: the pair record only', () => {
  const row: DuoRow = { rank: 1, id: 'u:a:u:b', name: 'Ana + Bo', value: 7, games: 10, extra: '70%' };
  it('splits both names, reads W–L off the same row, takes win% from extra', () => {
    expect(duoCardFromRow(row)).toEqual({
      rank: 1, names: ['Ana', 'Bo'], teamName: null, wins: 7, losses: 3, winPct: '70%', games: 10,
    });
  });
  it('carries a team name only when the payload carries one', () => {
    expect(duoCardFromRow({ ...row, teamName: 'Night Owls' }).teamName).toBe('Night Owls');
    expect(duoCardFromRow(row).teamName).toBeNull();
  });
  it('a single-name row stays a single name (no fabricated partner)', () => {
    expect(duoCardFromRow({ ...row, name: 'Solo' }).names).toEqual(['Solo']);
  });
});

/* ------------------------------------------------------------------ crews */

describe('crews contract helpers', () => {
  it('the leaderboard URL carries board, kind and period', () => {
    expect(crewLeaderboardUrl('k1', { board: 'wins', kind: 'cutthroat', period: 'month' }))
      .toBe('/api/social/crews/k1/leaderboard?board=wins&kind=cutthroat&period=month');
  });
  it('normalizes a payload with missing invites/members honestly', () => {
    const n = normalizeCrewsPayload({ crews: [{ id: 'k1', name: 'Kings' }] });
    expect(n.crews).toEqual([{ id: 'k1', name: 'Kings', ownerId: null, members: [], memberCount: null, role: null }]);
    expect(n.invites).toEqual([]);
  });
  it('reads invite crew names from either shape', () => {
    const n = normalizeCrewsPayload({ crews: [], invites: [{ id: 'i1', crewId: 'k1', crewName: 'Kings' }, { crew: { id: 'k2', name: 'Queens' } }] });
    expect(n.invites.map((i) => [i.crewId, i.crewName])).toEqual([['k1', 'Kings'], ['k2', 'Queens']]);
  });
  it('a non-payload normalizes to empty, not a crash', () => {
    expect(normalizeCrewsPayload(null)).toEqual({ crews: [], invites: [] });
  });
});

/* ------------------------------------------------------------ source wiring */

describe('phase 3 source wiring', () => {
  it('the Social panel mounts the celebration host', () => {
    expect(src('social/Social.tsx')).toContain('CelebrationHost');
  });
  it('rivalries enqueue the ALL SQUARE celebration once per rivalry', () => {
    const c = src('social/Central.tsx');
    expect(c).toContain('allsquare:');
    expect(c).toContain('hubCelebrations');
  });
  it('Rankings render the Duos section and run the promotion check', () => {
    const c = src('social/Compete.tsx');
    expect(c).toContain('DuoStandings');
    expect(c).toContain('data-testid="rankings-duos"');
    expect(c).toContain('useRankPromotion');
  });
  it('the Crew destination renders the Crews section built to the contract', () => {
    expect(src('social/Social.tsx')).toContain('<Crews');
    const crews = src('social/Crews.tsx');
    expect(crews).toContain('/api/social/crews');
    expect(crews).toContain('/invite');
    expect(crews).toContain('/respond');
    expect(crews).toContain('/leave');
    expect(crews).toContain('/leaderboard');
  });
  it('postgame renders the personal-best plaque; Career renders the bests strip', () => {
    expect(src('GameOverRewards.tsx')).toContain('data-testid="postgame-personal-best"');
    expect(src('GameOverRewards.tsx')).toContain('New personal best — Rating');
    expect(src('profile/ProfileView.tsx')).toContain('data-testid="personal-bests"');
  });
});
