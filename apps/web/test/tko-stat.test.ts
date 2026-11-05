/**
 * @vitest-environment happy-dom
 *
 * 1st Round TKO as a major stat (owner, 2026-11-05) — the client half:
 *
 *  - `tkoDirectionFor` (shotOut.ts) is the postgame mirror of the stat's
 *    pinned definition: it must fire exactly when the game's own ending
 *    logic names the ending '1ST ROUND TKO' (shotOutBannerFor) for team
 *    games, and on the hand-1 elimination fact for cutthroat.
 *  - The postgame career-mark note (computeRewards) prints ONLY when the
 *    after-profile's recorded count moved by exactly +1 in the game's
 *    direction — a count that didn't move (record not landed, guest,
 *    older server) means no note, never a guess.
 *  - The Player Card back carries dealt as a headline row; the ticker
 *    and the Ranks board speak the stat's name.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Bid, type GameResult, type GameState, type HandRecord, type TableRules,
  checkGameEnd, hostMinimum, isShot, makeRules, scoreHand, shotCounts,
  shotOutOn, shotOutResult, shotOutSides, thirdSetResult,
} from '@spades/rules';
import { shotOutBannerFor, tkoDirectionFor } from '../src/shotOut';
import { computeRewards, type RewardsProfile } from '../src/GameOverRewards';
import { PlayerCard, type PlayerCardData } from '../src/profile/PlayerCard';
import { buildTickerLines } from '../src/social/LeagueTicker';
import { ranksEmptyLine, ranksFilterSummary } from '../src/social/Compete';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------ fixtures */

function shell(rules: TableRules, history: HandRecord[], scores: number[], result: GameResult | null): GameState {
  const n = rules.playerCount;
  return {
    rules, seed: 'tko', phase: 'gameOver', handNo: history.length, dealer: 0, turn: null,
    hands: Array.from({ length: n }, () => []),
    bids: Array.from({ length: n }, () => null), revealed: Array.from({ length: n }, () => true),
    exchange: [], trick: { leader: 0, plays: [], winner: null }, tricks: [], tricksWon: Array.from({ length: n }, () => 0),
    spadesBroken: true, scores, bags: Array.from({ length: rules.partnerships ? 2 : n }, () => 0), history, result,
  } as GameState;
}

function teamGame(hands: { bids: Bid[]; tricks: number[] }[], rules: TableRules = makeRules('joker')): GameState {
  let scores = [0, 0];
  let bags = [0, 0];
  const history: HandRecord[] = [];
  let result: GameResult | null = null;
  for (const [i, h] of hands.entries()) {
    const sides = scoreHand(rules, h.bids, h.tricks, scores, bags);
    const shot = sides.map((s) => isShot(rules, h.bids, s));
    if (shotOutOn(rules)) sides.forEach((s, j) => { s.shot = shot[j]; });
    const prev = history[history.length - 1];
    const prevShot = sides.map((_, j) => !!prev?.sides[j]?.shot);
    const record: HandRecord = { handNo: i + 1, dealer: 0, bids: [...h.bids], tricksWon: [...h.tricks], sides };
    const countsBefore = shotCounts(rules, history);
    const newScores = sides.map((s) => s.totalScore);
    result = thirdSetResult(newScores, shotCounts(rules, [...history, record]), countsBefore)
      ?? shotOutResult(newScores, shotOutSides(rules, i + 1, shot, prevShot, countsBefore.map((c) => c >= 2)))
      ?? checkGameEnd(rules, newScores);
    history.push(record);
    scores = newScores;
    bags = sides.map((s) => s.totalBags);
    if (result) break;
  }
  return shell(rules, history, scores, result);
}

function cutGame(hands: { bids: Bid[]; tricks: number[] }[], result: GameResult, rules: TableRules = makeRules('cutthroat')): GameState {
  const n = rules.playerCount;
  let scores = Array.from({ length: n }, () => 0);
  let bags = Array.from({ length: n }, () => 0);
  const history: HandRecord[] = [];
  const eliminated = Array.from({ length: n }, () => false);
  const streak = Array.from({ length: n }, () => 0);
  for (const [i, h] of hands.entries()) {
    const handNo = i + 1;
    const wasOut = [...eliminated];
    const sides = scoreHand(rules, h.bids, h.tricks, scores, bags);
    const books = h.bids.every((b) => b === 'books');
    const cumFails = Array.from({ length: n }, () => 0);
    for (const rec of history) for (const s of rec.sides) if (s.shot) cumFails[s.side] = (cumFails[s.side] ?? 0) + 1;
    for (let seat = 0; seat < n; seat++) {
      if (wasOut[seat]) {
        sides[seat] = { ...sides[seat]!, points: 0, bookPoints: 0, contractPoints: 0, contractMade: null, bagsAdded: 0, totalScore: scores[seat]!, totalBags: bags[seat]!, shot: false, out: true };
        continue;
      }
      const b = h.bids[seat];
      const failed = books
        ? hostMinimum(rules) > 0 && sides[seat]!.tricks < hostMinimum(rules)
        : b === null || b === 'books' ? false
          : (b === 'nil' || b === 'blindNil') ? sides[seat]!.tricks > 0
            : sides[seat]!.contractMade === false;
      streak[seat] = failed ? (streak[seat] ?? 0) + 1 : 0;
      const cum = (cumFails[seat] ?? 0) + (failed ? 1 : 0);
      const out = failed && (handNo === 1 || (streak[seat] ?? 0) >= 2 || cum >= 3);
      if (out) eliminated[seat] = true;
      sides[seat] = { ...sides[seat]!, shot: failed, out };
    }
    history.push({ handNo, dealer: 0, bids: [...h.bids], tricksWon: [...h.tricks], sides });
    scores = sides.map((s) => s.totalScore);
    bags = sides.map((s) => s.totalBags);
  }
  return shell(rules, history, scores, result);
}

const BOOKS: Bid[] = ['books', 'books', 'books', 'books'];

/* ------------------------------------------------------------ direction */

describe('tkoDirectionFor — exactly the games the ending logic names TKO', () => {
  it('team hand-1 shot-out: the banner says TKO; winners dealt, out side suffered', () => {
    const st = teamGame([{ bids: BOOKS, tricks: [6, 2, 4, 1] }]);
    expect(shotOutBannerFor(st)).toBe('1ST ROUND TKO');
    expect(tkoDirectionFor(st, 0)).toBe('dealt');
    expect(tkoDirectionFor(st, 1)).toBe('suffered');
  });

  it('back-to-back shot-out: banner names it, direction is null for both sides', () => {
    const st = teamGame([
      { bids: BOOKS, tricks: [4, 4, 3, 2] },
      { bids: [3, 6, 2, 3], tricks: [4, 3, 3, 3] },
      { bids: [3, 6, 2, 3], tricks: [4, 3, 3, 3] },
    ]);
    expect(shotOutBannerFor(st)).toBe('SHOT BACK 2 BACK');
    expect(tkoDirectionFor(st, 0)).toBeNull();
    expect(tkoDirectionFor(st, 1)).toBeNull();
  });

  it('both sides out on hand 1: the score-winner dealt, the loser suffered', () => {
    const st = teamGame([{ bids: [5, 5, 4, 3], tricks: [3, 3, 5, 2] }]);
    expect(shotOutBannerFor(st)).toBe('1ST ROUND TKO');
    expect(tkoDirectionFor(st, 1)).toBe('dealt');
    expect(tkoDirectionFor(st, 0)).toBe('suffered');
  });

  it('the hand-1 double-shot that ties plays on: no direction', () => {
    const rules = makeRules('joker', { targetScore: 100 });
    const st = teamGame([
      { bids: [5, 5, 4, 4], tricks: [3, 3, 5, 2] },
      { bids: [6, 3, 4, 3], tricks: [6, 2, 4, 1] },
      { bids: [7, 2, 4, 2], tricks: [6, 4, 5, 0] },
    ], rules);
    expect(tkoDirectionFor(st, 0)).toBeNull();
    expect(tkoDirectionFor(st, 1)).toBeNull();
  });

  it('cutthroat hand-1 elimination: out player suffered, the winner dealt, a surviving non-winner gets no note direction', () => {
    const st = cutGame([
      { bids: BOOKS, tricks: [5, 4, 0, 4] },
      { bids: [4, 4, 'books', 4], tricks: [5, 4, 0, 4] },
      { bids: [5, 3, 'books', 5], tricks: [6, 3, 0, 4] },
    ], { endReason: 'target', finalScores: [0, 0, 0, 0], placements: [1, 2, 3, 4], winners: [0] });
    expect(tkoDirectionFor(st, 2)).toBe('suffered');
    expect(tkoDirectionFor(st, 0)).toBe('dealt');
    expect(tkoDirectionFor(st, 1)).toBeNull();
    expect(tkoDirectionFor(st, 3)).toBeNull();
  });

  it('an ordinary target win: no direction', () => {
    const rules = makeRules('joker', { targetScore: 100 });
    const st = teamGame([{ bids: BOOKS, tricks: [6, 4, 4, 0] }], rules);
    expect(st.result?.endReason).toBe('target');
    expect(tkoDirectionFor(st, 0)).toBeNull();
    expect(tkoDirectionFor(st, 1)).toBeNull();
  });
});

/* ------------------------------------------------------------ postgame note */

const cardWith = (tkos: { dealt: number; suffered: number }) =>
  ({ stats: { tkos } }) as unknown as PlayerCardData;
function profile(over: Partial<RewardsProfile> = {}): RewardsProfile {
  return {
    level: { level: 8, xp: 1000, title: 'Prospect', xpForNext: 300, xpIntoLevel: 83 },
    coins: { balance: 1250 },
    rank: { team: { elo: 1000 }, cutthroat: { elo: 1000 } },
    achievements: [],
    challenges: { daily: [], weekly: [] },
    ...over,
  };
}
const OPTS = { won: true, headline: 'VICTORY!', sub: '1 hand played', kind: 'team' as const };

describe('computeRewards — the TKO career-mark note', () => {
  it('dealt: prints the new career mark when the recorded count moved by exactly one', () => {
    const before = profile({ card: cardWith({ dealt: 2, suffered: 1 }) });
    const after = profile({ card: cardWith({ dealt: 3, suffered: 1 }) });
    const d = computeRewards(before, after, { ...OPTS, tko: 'dealt' });
    expect(d.tkoNote).toBe('Your 3rd career 1st Round TKO dealt.');
  });

  it('suffered: prints the new career mark the same way', () => {
    const before = profile({ card: cardWith({ dealt: 2, suffered: 1 }) });
    const after = profile({ card: cardWith({ dealt: 2, suffered: 2 }) });
    const d = computeRewards(before, after, { ...OPTS, won: false, tko: 'suffered' });
    expect(d.tkoNote).toBe('Your 2nd career 1st Round TKO suffered.');
  });

  it('no note when the count did not move (record not landed yet)', () => {
    const before = profile({ card: cardWith({ dealt: 2, suffered: 1 }) });
    const after = profile({ card: cardWith({ dealt: 2, suffered: 1 }) });
    expect(computeRewards(before, after, { ...OPTS, tko: 'dealt' }).tkoNote).toBeNull();
  });

  it('no note without a direction, without snapshots, or without card counts', () => {
    const before = profile({ card: cardWith({ dealt: 2, suffered: 1 }) });
    const after = profile({ card: cardWith({ dealt: 3, suffered: 1 }) });
    expect(computeRewards(before, after, OPTS).tkoNote).toBeNull();
    expect(computeRewards(null, null, { ...OPTS, tko: 'dealt' }).tkoNote).toBeNull();
    expect(computeRewards(profile(), profile(), { ...OPTS, tko: 'dealt' }).tkoNote).toBeNull();
  });

  it('ordinals read naturally', () => {
    const mk = (n: number) => computeRewards(
      profile({ card: cardWith({ dealt: n - 1, suffered: 0 }) }),
      profile({ card: cardWith({ dealt: n, suffered: 0 }) }),
      { ...OPTS, tko: 'dealt' },
    ).tkoNote;
    expect(mk(1)).toBe('Your 1st career 1st Round TKO dealt.');
    expect(mk(2)).toBe('Your 2nd career 1st Round TKO dealt.');
    expect(mk(4)).toBe('Your 4th career 1st Round TKO dealt.');
    expect(mk(11)).toBe('Your 11th career 1st Round TKO dealt.');
    expect(mk(23)).toBe('Your 23rd career 1st Round TKO dealt.');
  });
});

/* ------------------------------------------------------------ card + ticker + board */

const cardBase = (over: Partial<PlayerCardData> = {}): PlayerCardData => ({
  userId: 'u-1',
  name: 'ShotCaller',
  avatar: null,
  avatarUpdatedAt: null,
  memberSince: 1760000000000,
  level: { level: 34, title: 'Shot Caller' },
  rank: { level: 34, step: 34, prestige: false, rank: 'Q', rankName: 'Queen', suit: 'diamonds', symbol: '♦', tier: 'diamonds', isJoker: false, isLittleJoker: false, isBigJoker: false },
  bigJoker: { earned: false, active: false },
  status: null,
  tags: [],
  showcase: [],
  badges: [],
  story: { stopsCleared: 4, stopsTotal: 11, completed: false },
  stats: {
    games: 50, wins: 32, losses: 18, winPct: 64, streak: 3, bestStreak: 7,
    team: { rating: 1240, games: 10, wins: 6, losses: 4 },
    cutthroat: { rating: 980, games: 2, wins: 1, losses: 1 },
  },
  ...over,
});

let root: Root | null = null;
let el: HTMLDivElement | null = null;
async function render(node: React.ReactNode) {
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(node); });
  return el;
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove(); el = null;
});

describe('surfaces', () => {
  it('the Player Card back carries dealt TKOs as a headline row', async () => {
    await render(createElement(PlayerCard, {
      data: cardBase({
        stats: {
          games: 50, wins: 32, losses: 18, winPct: 64, streak: 3, bestStreak: 7,
          team: { rating: 1240, games: 10, wins: 6, losses: 4 },
          cutthroat: { rating: 980, games: 2, wins: 1, losses: 1 },
          tkos: { dealt: 3, suffered: 1 },
        },
      }),
    }));
    const row = el!.querySelector('[data-testid="pcard-row-tko"]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain('1st Round TKOs');
    expect(row!.textContent).toContain('3');
  });

  it('a card payload without TKO counts renders no TKO row (stale payload degrades)', async () => {
    await render(createElement(PlayerCard, { data: cardBase() }));
    expect(el!.querySelector('[data-testid="pcard-row-tko"]')).toBeNull();
  });

  it('the ticker speaks TKO leaders in the rotation format', () => {
    const lines = buildTickerLines({
      kind: 'team', top: [], online: [], mine: null,
      tkos: [{ name: 'Alpha', value: 3 }, { name: 'Bravo', value: 2 }],
    });
    expect(lines.map((l) => l.text)).toContain('1st Round TKOs · Partnership — Alpha 3 · Bravo 2');
  });

  it('the Ranks board names the category and its empty state', () => {
    expect(ranksFilterSummary('tkos', 'global', 'all')).toBe('1st Round TKOs · Global · All-time');
    expect(ranksEmptyLine('tkos', 'all', 'global')).toBe('No 1st Round TKOs on this board yet.');
  });
});
