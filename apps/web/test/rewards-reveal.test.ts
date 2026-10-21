/**
 * @vitest-environment happy-dom
 *
 * REWARDS REVEAL (owner report, 2026-10-20: "the animation never plays on
 * this screen — when it loads the points are already present"). The reveal
 * used to be armed at mount (CSS timelines + a mount-timer count-up) while
 * the screen is reached by a full page load, so a slow first paint spent
 * the whole show before the page was visible. These tests pin the fix:
 * the screen renders in its PRE-reveal state (counters at their pre-game
 * values, the level bar at the pre-game progress), and only once the
 * reveal gate opens (two painted frames) do the counters tween to the
 * exact final values and the bar fill to the post-game progress. Reduced
 * motion renders the final state immediately.
 *
 * RAF is a manual queue so frame timestamps are deterministic; timers are
 * vitest fakes for the same reason.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GameOverRewards, { computeRewards, type RewardsData, type RewardsProfile } from '../src/GameOverRewards';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------ fixtures */

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

/** +50 XP (bar 83/300 → 133/300, same level), +150 coins, rating 1000 → 1012. */
function rewardsData(): RewardsData {
  const after = profile({
    level: { level: 8, xp: 1050, title: 'Prospect', xpForNext: 300, xpIntoLevel: 133 },
    coins: { balance: 1400 },
    rank: { team: { elo: 1012 }, cutthroat: { elo: 1000 } },
  });
  return computeRewards(profile(), after, { won: true, headline: 'VICTORY!', sub: '3 hands played', kind: 'team' });
}

/** Same game but the XP crosses into level 9 (bar 25/375 in the new level). */
function levelUpData(): RewardsData {
  const after = profile({
    level: { level: 9, xp: 1150, title: 'Certified', xpForNext: 375, xpIntoLevel: 25 },
    coins: { balance: 1400 },
    rank: { team: { elo: 1012 }, cutthroat: { elo: 1000 } },
  });
  return computeRewards(profile(), after, { won: true, headline: 'VICTORY!', sub: '3 hands played', kind: 'team' });
}

/* ------------------------------------------------------- raf + mounting */

let rafQ: { id: number; cb: FrameRequestCallback }[] = [];
let rafSeq = 0;

function pumpFrame(ts: number) {
  const q = rafQ;
  rafQ = [];
  act(() => { for (const f of q) f.cb(ts); });
}

function advance(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}

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

const page = () => container.querySelector('.rewards-page')!;
const xpNum = () => [...container.querySelectorAll('.rw-row .rw-num')].map((n) => n.textContent ?? '');
const barFill = () => container.querySelector('.rw-levelbar-fill') as HTMLElement;
const barPct = () => parseFloat(barFill().style.width);

/** Open the reveal gate: the two post-paint frames the gate waits for. */
function openGate() {
  pumpFrame(0);
  pumpFrame(16);
  expect(page().classList.contains('rw-play')).toBe(true);
}

/** Run every pending tween to completion: jump the delays, then step frames. */
function finishTweens() {
  advance(2000);
  let ts = 100;
  for (let i = 0; i < 14; i++) { pumpFrame(ts); ts += 100; }
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

/* ---------------------------------------------------------------- tests */

describe('rewards reveal gate', () => {
  it('renders the pre-reveal state first: counters at zero, bar at the pre-game progress', () => {
    mount(rewardsData());
    expect(page().classList.contains('rw-armed')).toBe(true);
    expect(page().classList.contains('rw-play')).toBe(false);
    expect(page().classList.contains('rw-reduced')).toBe(false);
    // XP and coins counters have not moved; the rating delta neither
    expect(xpNum()).toEqual(['+0', '+0', '▲ 0']);
    // the bar starts where the player was BEFORE the match (83 of 300)
    expect(barPct()).toBeCloseTo((83 / 300) * 100, 5);
  });

  it('plays after the gate opens and lands exactly on the final values', () => {
    mount(rewardsData());
    openGate();
    finishTweens();
    expect(xpNum()).toEqual(['+50', '+150', '▲ 12']);
    expect(barPct()).toBeCloseTo((133 / 300) * 100, 5);
  });

  it('mid-flight values are between the start and the target (it visibly counts)', () => {
    mount(rewardsData());
    openGate();
    advance(200); // XP row delay
    pumpFrame(1000); // first tween frame: start
    pumpFrame(1500); // halfway through the ease
    const mid = xpNum()[0]!;
    expect(mid).not.toBe('+0');
    expect(mid).not.toBe('+50');
    const n = Number(mid.replace('+', ''));
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(50);
  });

  it('level-up bar: fills the old level, snaps to empty, fills into the new level', () => {
    mount(levelUpData());
    expect(barPct()).toBeCloseTo((83 / 300) * 100, 5);
    openGate();
    advance(200); // bar leg 1 starts
    expect(barPct()).toBe(100);
    expect(barFill().classList.contains('fast')).toBe(true);
    advance(620); // snap point: empty, transition held off
    expect(barPct()).toBe(0);
    expect(barFill().classList.contains('instant')).toBe(true);
    pumpFrame(2000);
    pumpFrame(2016); // double-frame: re-enable the transition, fill the new level
    expect(barFill().classList.contains('instant')).toBe(false);
    expect(barPct()).toBeCloseTo((25 / 375) * 100, 5);
  });

  it('reduced motion renders the final state immediately, no gate', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('prefers-reduced-motion'),
      media: q,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));
    mount(rewardsData());
    expect(page().classList.contains('rw-reduced')).toBe(true);
    expect(xpNum()).toEqual(['+50', '+150', '▲ 12']);
    expect(barPct()).toBeCloseTo((133 / 300) * 100, 5);
    // opening frames change nothing — the values are already final
    pumpFrame(0);
    pumpFrame(16);
    expect(xpNum()).toEqual(['+50', '+150', '▲ 12']);
  });
});
