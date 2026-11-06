/**
 * BWM Central Phase 1 (client): five destinations over the Social panel.
 * Pure-model tests (destinations, persistence, nav mode, turning point,
 * headline/match helpers) + source-wiring assertions in the repo idiom.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CENTRAL_DESTS, destOfTab, hubNavMode, myLatestResult, powerMovers, statCell } from '../src/social/central';
import { analyzeScoreTimeline } from '../src/turningPoint';
import { parseSocialView, serializeSocialView } from '../src/social/store';
import { buildPostgame, type PostgameHand } from '../src/GameOverRewards';
import type { RecentResult } from '../src/social/LeagueTicker';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('Central destinations', () => {
  it('the five destinations, in order, with their labels', () => {
    expect(CENTRAL_DESTS.map((d) => d.id)).toEqual(['headlines', 'rankings', 'matchups', 'crew', 'career']);
    expect(CENTRAL_DESTS.map((d) => d.label)).toEqual(['Headlines', 'Rankings', 'Matchups', 'Crew', 'My Career']);
  });
  it('legacy tabs map onto destinations; chat/messages/settings are utilities, not destinations', () => {
    expect(destOfTab('leaders')).toBe('rankings');
    expect(destOfTab('headlines')).toBe('headlines');
    expect(destOfTab('tournaments')).toBe('matchups');
    expect(destOfTab('challenges')).toBe('matchups');
    expect(destOfTab('matchups')).toBe('matchups');
    expect(destOfTab('match')).toBe('matchups');
    expect(destOfTab('players')).toBe('crew');
    expect(destOfTab('friends')).toBe('crew');
    expect(destOfTab('career')).toBe('career');
    expect(destOfTab('chat')).toBeNull();
    expect(destOfTab('messages')).toBeNull();
    expect(destOfTab('settings')).toBeNull();
  });
});

describe('Central view persistence', () => {
  it('round-trips destination, open match and profile-back data', () => {
    const v = {
      open: true, tab: 'match' as const, dmWith: null, names: {},
      dest: 'matchups' as const, matchId: 'g123',
      profileReturn: { tab: 'leaders' as const, scroll: 240 },
    };
    const parsed = parseSocialView(serializeSocialView(v));
    expect(parsed.tab).toBe('match');
    expect(parsed.dest).toBe('matchups');
    expect(parsed.matchId).toBe('g123');
    expect(parsed.profileReturn).toEqual({ tab: 'leaders', scroll: 240 });
  });
  it('a legacy saved view (old tab names, no Central fields) still parses', () => {
    const parsed = parseSocialView('{"open":true,"tab":"leaders","dmWith":null,"names":{}}');
    expect(parsed.tab).toBe('leaders');
    expect(parsed.dest).toBeUndefined();
    expect(parsed.matchId).toBeUndefined();
  });
  it('junk Central fields are rejected, never trusted', () => {
    const parsed = parseSocialView('{"tab":"headlines","dest":"nope","matchId":7,"profileReturn":{"tab":"nope","scroll":"x"}}');
    expect(parsed.dest).toBeUndefined();
    expect(parsed.matchId).toBeUndefined();
    expect(parsed.profileReturn).toBeUndefined();
  });
});

describe('hub nav mode (responsive)', () => {
  it('phone portrait 390×844 gets the labeled bottom bar', () => {
    expect(hubNavMode(390, 844)).toBe('bar');
  });
  it('phone landscape 844×390 gets the compact labeled nav', () => {
    expect(hubNavMode(844, 390)).toBe('compact');
  });
  it('tablet/desktop widths get top tabs', () => {
    expect(hubNavMode(1280, 800)).toBe('tabs');
    expect(hubNavMode(1024, 768)).toBe('tabs');
  });
});

describe('analyzeScoreTimeline (mechanical turning point)', () => {
  // margins (side0 - side1): +10, -20 (swing 30, lead flips), +50 (swing 70), +40
  const hands = [
    { hand: 1, scores: [60, 50] },
    { hand: 2, scores: [80, 100] },
    { hand: 3, scores: [200, 150] },
    { hand: 4, scores: [240, 200] },
  ];
  it('biggest swing: the largest hand-to-hand margin change', () => {
    const tp = analyzeScoreTimeline(hands);
    expect(tp.swing).toEqual({ hand: 3, delta: 70 });
  });
  it('final lead change: the last hand the lead changed sides', () => {
    const tp = analyzeScoreTimeline(hands);
    expect(tp.leadChangeHand).toBe(3);
    expect(tp.wireToWire).toBe(false);
  });
  it('wire-to-wire: one side led after every hand — no turning point', () => {
    const tp = analyzeScoreTimeline([
      { hand: 1, scores: [50, 20] },
      { hand: 2, scores: [120, 60] },
      { hand: 3, scores: [200, 90] },
    ]);
    expect(tp.wireToWire).toBe(true);
    expect(tp.leadChangeHand).toBeNull();
  });
  it('a tie game (level after every hand) has no swing and no lead change', () => {
    const tp = analyzeScoreTimeline([
      { hand: 1, scores: [40, 40] },
      { hand: 2, scores: [90, 90] },
    ]);
    expect(tp.swing).toBeNull();
    expect(tp.leadChangeHand).toBeNull();
    expect(tp.wireToWire).toBe(false);
  });
  it('empty and single-hand timelines are honest about having nothing to measure', () => {
    expect(analyzeScoreTimeline([])).toEqual({ swing: null, leadChangeHand: null, wireToWire: false });
    const one = analyzeScoreTimeline([{ hand: 1, scores: [10, 0] }]);
    expect(one.leadChangeHand).toBeNull();
  });
  it('cutthroat (4 sides): margin is leader vs the best of the rest', () => {
    const tp = analyzeScoreTimeline([
      { hand: 1, scores: [50, 30, 20, 10] },
      { hand: 2, scores: [60, 90, 20, 10] },
    ]);
    expect(tp.leadChangeHand).toBe(2);
    expect(tp.wireToWire).toBe(false);
  });
});

describe('buildPostgame turning point + timeline', () => {
  const H = (handNo: number, p0: number, p1: number): PostgameHand => ({
    handNo, tricksWon: [0, 0, 0, 0],
    sides: [
      { side: 0, tricks: 7, points: p0, nils: [] },
      { side: 1, tricks: 6, points: p1, nils: [] },
    ],
  });
  it('derives the score timeline from cumulative hand points', () => {
    const pg = buildPostgame({
      history: [H(1, 60, 50), H(2, 20, 50), H(3, 120, 50)],
      finalScores: [200, 150], sideLabels: ['A', 'B'], seatLabels: ['A', 'X', 'B', 'Y'], mySeat: 0, mySide: 0,
    });
    expect(pg.timeline).toEqual([
      { hand: 1, scores: [60, 50] },
      { hand: 2, scores: [80, 100] },
      { hand: 3, scores: [200, 150] },
    ]);
    // biggest swing is hand 3 (+70 margin change), from MY side's view +70
    expect(pg.turning?.swing).toEqual({ hand: 3, delta: 70 });
    expect(pg.turning?.leadChangeHand).toBe(3);
    expect(pg.topOpponent).toBe('X');
  });
});

describe('headline helpers', () => {
  const mk = (id: string, at: number, names: string[][]): RecentResult => ({
    id, at, kind: 'team', mode: 'joker', code: 'ABCD',
    sides: names.map((n, i) => ({ names: n, score: 500 - i * 100, won: i === 0 })), wheels: false,
  });
  it("myLatestResult returns the caller's newest result, null when they are in none", () => {
    const rows = [mk('g2', 200, [['Other', 'A'], ['Me', 'B']]), mk('g1', 100, [['Me', 'B'], ['Other', 'A']])];
    expect(myLatestResult(rows, 'Me')?.id).toBe('g2');
    expect(myLatestResult(rows, 'Nobody')).toBeNull();
    expect(myLatestResult(rows, null)).toBeNull();
  });
  it('powerMovers: biggest climbers first, new entries flagged, flat rows out', () => {
    const rows = [
      { rank: 1, id: 'a', name: 'A', power: 1300, rating: 1250, movement: 2 as const },
      { rank: 2, id: 'b', name: 'B', power: 1290, rating: 1240, movement: -5 as const },
      { rank: 3, id: 'c', name: 'C', power: 1280, rating: 1230, movement: 'new' as const },
      { rank: 4, id: 'd', name: 'D', power: 1270, rating: 1220, movement: 0 as const },
    ];
    const mv = powerMovers(rows, 3);
    expect(mv.map((r) => r.name)).toEqual(['B', 'A', 'C']);
  });
});

describe('match view stat cells', () => {
  it('a missing stat renders —, a present stat (even a real 0) renders its value', () => {
    expect(statCell({ books: 9 }, 'books')).toBe('9');
    expect(statCell({ books: 0 }, 'books')).toBe('0');
    expect(statCell({}, 'books')).toBe('—');
    expect(statCell(null, 'books')).toBe('—');
    expect(statCell({ books: 'x' }, 'books')).toBe('—');
  });
});

describe('Central wiring (source)', () => {
  const social = read('../src/social/Social.tsx');
  const rewards = read('../src/GameOverRewards.tsx');
  it('the panel is BWM CENTRAL with a labeled nav for all five destinations', () => {
    const model = read('../src/social/central.ts');
    expect(social).toContain('BWM CENTRAL');
    expect(social).toContain('data-testid="central-nav"');
    expect(social).toContain('central-nav-${d.id}');
    for (const d of ['headlines', 'rankings', 'matchups', 'crew', 'career']) {
      expect(model).toContain(`id: '${d}'`);
    }
    for (const label of ['Headlines', 'Rankings', 'Matchups', 'Crew', 'My Career']) {
      expect(model).toContain(`label: '${label}'`);
    }
    expect(social).toContain('central-nav-lbl');
  });
  it('messages/chat is a header utility with an unread badge, outside the destinations', () => {
    expect(social).toContain('data-testid="central-chat-btn"');
  });
  it('the gear menu no longer carries tournaments or challenges (they live in Matchups)', () => {
    expect(social).not.toContain('soc-tab-tournaments');
    expect(social).not.toContain('soc-tab-challenges');
    expect(social).toContain('soc-tab-settings');
  });
  it('postgame: rating pending state, mechanical swing labels and a Compare action', () => {
    expect(rewards).toContain('Rating finalizing…');
    expect(rewards).toContain('Biggest swing: Hand');
    expect(rewards).toContain('data-testid="rewards-compare"');
  });
  it('crew keeps BOTH of its old tabs reachable: a Players / Friends segment inside Crew', () => {
    // Pre-Central, Players and Friends were both top tabs. The Crew
    // destination lands on Players; Friends (requests, blocks, mutes)
    // must stay one tap away inside Crew, not toast-only.
    expect(social).toContain('data-testid="crew-seg-players"');
    expect(social).toContain('data-testid="crew-seg-friends"');
    expect(social).toContain("social.tab('friends')");
    expect(social).toContain("social.tab('players')");
  });
  it('rankings: a server-backed friends board is rendered as returned, not re-filtered client-side', () => {
    const compete = read('../src/social/Compete.tsx');
    expect(compete).toContain("if (fetchScope === 'friends') return rows;");
  });
  it('match view: the turning point names the swing size, not just the hand', () => {
    const centralTsx = read('../src/social/Central.tsx');
    expect(centralTsx).toContain('Math.abs(turning.swing.delta)');
  });
  it('honesty: the bjWins counter is never labelled Bostons (or Blackjack) — it counts Big-Joker trick wins', () => {
    // Server lane fixed the same mislabel in honors ("Most Bostons" summed
    // bjWins). The client Compare row and Stats grid label the SAME
    // counter; both must name what the number measures. No real Bostons
    // (took-every-book) stat exists in this payload — do not invent one.
    const pv = read('../src/profile/ProfileView.tsx');
    expect(pv).toContain("{ label: 'Big-Joker trick wins', a: ms.bjWins, b: ts.bjWins, fmt: whole }");
    expect(pv).toContain("bjWins: 'Big-Joker trick wins'");
    expect(pv).not.toContain("'Bostons'");
    expect(pv).not.toContain("'Blackjack wins'");
  });
});
