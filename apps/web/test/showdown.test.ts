/**
 * Last-card showdown (owner, 2026-11-12: "a special animation for this
 * scenario where it gets down to the last card and both team must win out").
 * Pins the detector (final trick, at least two sides each needing exactly
 * this book), the quickening heartbeat, and the wiring: bots play the last
 * card in turn at a held pace, and the scene flies those cards slower.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeRules, type Bid, type Trick } from '@spades/rules';
import { BOT_PLAY_MS } from '../src/useGame';
import { SHOWDOWN_BOT_MS, SHOWDOWN_FLIGHT, heartbeatMs, isShowdown, showdownSides } from '../src/showdown';

const joker = makeRules('joker'); // 4p partnerships, 13 tricks
const cut4 = makeRules('cutthroat'); // 4p, every seat its own side

type St = Parameters<typeof isShowdown>[0];
const st = (over: Partial<St> & { done?: number } = {}): St => {
  const { done = 12, ...rest } = over;
  return {
    rules: joker,
    phase: 'playing',
    bids: [4, 3, 3, 4] as (Bid | null)[], // side 0 bid 7, side 1 bid 7: 14 books for 13 tricks
    tricksWon: [3, 3, 3, 3], // 6 each with one to play
    tricks: Array.from({ length: done }, () => ({}) as Trick),
    ...rest,
  } as St;
};

describe('showdown detector', () => {
  it('both sides one book short on the last trick is a showdown', () => {
    expect(showdownSides(st())).toEqual([0, 1]);
    expect(isShowdown(st())).toBe(true);
  });

  it('not before the last trick, even when both sides must win out', () => {
    // 11 done, two left, each side needs two.
    expect(isShowdown(st({ done: 11, tricksWon: [3, 2, 2, 4], bids: [4, 3, 3, 4] }))).toBe(false);
  });

  it('one side already home is not a showdown', () => {
    expect(isShowdown(st({ bids: [3, 3, 3, 4], tricksWon: [3, 3, 3, 3] }))).toBe(false);
  });

  it('a side already set is not riding on the book', () => {
    // side 0 bid 9 with 6 — two short with one left.
    expect(isShowdown(st({ bids: [5, 3, 4, 4] }))).toBe(false);
  });

  it('only during live play', () => {
    expect(isShowdown(st({ phase: 'handOver' }))).toBe(false);
    expect(isShowdown(st({ done: 13 }))).toBe(false);
  });

  it('cutthroat: two or more seats each needing the last book', () => {
    const s = st({ rules: cut4, bids: [4, 4, 3, 3] as (Bid | null)[], tricksWon: [3, 3, 3, 3] });
    expect(showdownSides(s)).toEqual([0, 1]);
  });
});

describe('showdown feel', () => {
  it('the heartbeat quickens with every card down and never runs away', () => {
    const beats = [0, 1, 2, 3].map(heartbeatMs);
    for (let i = 1; i < beats.length; i++) expect(beats[i]!).toBeLessThan(beats[i - 1]!);
    expect(heartbeatMs(99)).toBeGreaterThanOrEqual(400);
  });

  it('bots hold the last card longer than a normal play, and the card hangs longer', () => {
    expect(SHOWDOWN_BOT_MS).toBeGreaterThan(BOT_PLAY_MS * 1.5);
    expect(SHOWDOWN_FLIGHT.duration).toBeGreaterThan(0.5);
  });
});

describe('showdown wiring', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

  it('bots skip the out-of-turn last-card drop and use the held pace', () => {
    const src = read('../src/useGame.ts');
    expect(src).toContain("if (!forced && !showdown && st.phase === 'playing')");
    expect(src).toContain('showdown ? SHOWDOWN_BOT_MS : BOT_PLAY_MS');
  });

  it('the scene slows the flight but leaves drags and over-cuts alone', () => {
    const src = read('../src/three/Scene.tsx');
    expect(src).toMatch(/overcut \? \{[^}]+\} : dragged \? \{[^}]+\} : props\.showdown \? \{ \.\.\.SHOWDOWN_FLIGHT \}/);
  });

  it('the layer never takes a tap and sits under the modals', () => {
    const css = read('../src/showdown.css');
    expect(css).toMatch(/\.showdown \{[^}]*pointer-events: none/);
    expect(css).toMatch(/\.showdown \{[^}]*z-index: 6\b/);
  });
});
