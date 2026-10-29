/**
 * @vitest-environment happy-dom
 *
 * PLAY-WELL on the rewards screen (owner, 2026-10-29): the postgame
 * breakdown gains a "Playing well" section listing ONLY the feats the
 * player earned in this match, each with its paid amount — the lines the
 * server computed at game end (cred_playwell), carried on the profile
 * payload and attached by computeRewards when the payload's latest
 * bonus row belongs to this match (a different game id than the
 * before-snapshot carried). Nothing renders when no bonus was earned.
 * The amounts are already inside the screen's XP/coins totals (they are
 * snapshot diffs of server-credited balances); the section itemizes.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GameOverRewards, { computeRewards, type PlayWellLine, type RewardsData, type RewardsProfile } from '../src/GameOverRewards';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const LINES: PlayWellLine[] = [
  { id: 'best-run', label: 'Best run — 5 books in a row', xp: 8, coins: 0 },
  { id: 'ran-table', label: 'Ran the table', xp: 25, coins: 15 },
  { id: 'nil', label: 'Made a nil', xp: 6, coins: 0 },
];
const ROW = { gameId: 'g-new', xp: 39, coins: 15, lines: LINES };
const OPTS = { won: true, headline: 'VICTORY!', sub: '4 hands played', kind: 'team' as const };

describe('computeRewards: play-well attachment', () => {
  it('attaches this match\'s lines when the after row is a new game', () => {
    const before = profile({ playWell: { gameId: 'g-old', xp: 4, coins: 0, lines: [LINES[0]!] } });
    const after = profile({
      level: { level: 8, xp: 1089, title: 'Prospect', xpForNext: 300, xpIntoLevel: 172 },
      coins: { balance: 1265 },
      playWell: ROW,
    });
    const d = computeRewards(before, after, OPTS);
    expect(d.playWell).toEqual({ xp: 39, coins: 15, lines: LINES });
    // the bonus is inside the totals, not added on top of them
    expect(d.xpGained).toBe(89); // 50 base + 39 bonus, as credited
    expect(d.coinsGained).toBe(15);
  });

  it('attaches for a legacy before-snapshot that predates the field', () => {
    const d = computeRewards(profile(), profile({ playWell: ROW }), OPTS);
    expect(d.playWell?.lines).toEqual(LINES);
  });

  it('does not re-attach the same game\'s row on a re-diff', () => {
    const before = profile({ playWell: ROW });
    const after = profile({ playWell: ROW });
    expect(computeRewards(before, after, OPTS).playWell).toBeNull();
  });

  it('a feat-less match (empty-lines row) attaches nothing — and shadows the last game', () => {
    const before = profile({ playWell: ROW });
    const after = profile({ playWell: { gameId: 'g-newer', xp: 0, coins: 0, lines: [] } });
    expect(computeRewards(before, after, OPTS).playWell).toBeNull();
  });

  it('no bonus row at all (no credited games) attaches nothing', () => {
    expect(computeRewards(profile(), profile({ playWell: null }), OPTS).playWell).toBeNull();
    expect(computeRewards(profile(), profile(), OPTS).playWell).toBeNull();
  });
});

/* ------------------------------------------------------------ rendering */

let rafQ: { id: number; cb: FrameRequestCallback }[] = [];
let rafSeq = 0;
let container: HTMLDivElement;
let root: Root;

function mount(data: RewardsData) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(GameOverRewards, {
      data,
      onHome: () => undefined,
      onRematch: () => undefined,
      onProfile: () => undefined,
      onOpenTables: () => undefined,
    }));
  });
}

beforeEach(() => {
  rafQ = [];
  rafSeq = 0;
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++rafSeq;
    rafQ.push({ id, cb });
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { rafQ = rafQ.filter((f) => f.id !== id); });
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the "Playing well" section', () => {
  it('renders exactly the earned lines, in order, with their amounts', () => {
    const d = computeRewards(profile(), profile({ playWell: ROW }), OPTS);
    mount(d);
    const section = container.querySelector('[data-testid="rewards-playwell"]');
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain('Playing well');
    expect(section!.textContent).toContain('+39 XP');
    const items = [...section!.querySelectorAll('.rw-playwell-lines li')];
    expect(items.map((li) => li.textContent)).toEqual([
      'Best run — 5 books in a row+8 XP',
      'Ran the table+25 XP · +15 ',
      'Made a nil+6 XP',
    ]);
  });

  it('renders nothing when the match earned no bonus', () => {
    const d = computeRewards(profile(), profile({ playWell: { gameId: 'g-x', xp: 0, coins: 0, lines: [] } }), OPTS);
    mount(d);
    expect(container.querySelector('[data-testid="rewards-playwell"]')).toBeNull();
    expect(container.textContent).not.toContain('Playing well');
  });
});
