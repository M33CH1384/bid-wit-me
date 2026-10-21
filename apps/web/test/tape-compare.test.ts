/** League P-C (Demetrius 2026-10-20): Tale of the Tape prediction math +
 *  placement, and the profile Compare block. Predictions are stat-based and
 *  labeled; nothing renders a prediction without rated players. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { avgRating, blendH2h, expectancy, ffaShares } from '../src/social/wagerLogic';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const wager = () => read('../src/social/Wager.tsx');
const profileView = () => read('../src/profile/ProfileView.tsx');

describe('prediction math', () => {
  it('expectancy: equal ratings split; +400 gap is ~91%', () => {
    expect(expectancy(1200, 1200)).toBeCloseTo(0.5, 6);
    expect(expectancy(1600, 1200)).toBeCloseTo(0.909, 2);
    expect(expectancy(1200, 1600)).toBeCloseTo(0.091, 2);
  });
  it('ffa shares sum to 1 and favor the higher rating', () => {
    const s = ffaShares([1000, 1200, 1400]);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(s[2]!).toBeGreaterThan(s[0]!);
    expect(ffaShares([])).toEqual([]);
  });
  it('h2h blends only with a real record (≥3 meetings) at 25%', () => {
    expect(blendH2h(0.6, null)).toBe(0.6);
    expect(blendH2h(0.6, { games: 2, wins: 2 })).toBe(0.6);
    expect(blendH2h(0.6, { games: 4, wins: 1 })).toBeCloseTo(0.75 * 0.6 + 0.25 * 0.25, 6);
  });
  it('side averages ignore unrated players; no rated players → null', () => {
    expect(avgRating([1200, null, 1400])).toBe(1300);
    expect(avgRating([null, undefined])).toBeNull();
  });
});

describe('tape + compare placement', () => {
  it('the tape renders on unfinished challenges only, from profile payloads', () => {
    const w = wager();
    expect(w).toContain('{!finished && <TaleOfTape v={v} />}');
    expect(w).toContain('data-testid="wg-tape"');
    expect(w).toContain('Stat-based prediction');
    expect(w).toContain('/api/social/profile/');
    expect(w).not.toMatch(/wg-tape[^]*Elo/);
  });
  it('compare lives in the Stats tab of another player’s profile', () => {
    const pv = profileView();
    expect(pv).toContain('data-testid="compare-toggle"');
    expect(pv).toContain('data-testid="compare-table"');
    expect(pv).toContain('{!me && socialP && acct.user?.username && <CompareBlock');
    expect(pv).toContain("'Partnership rating'");
    expect(pv).toContain("'Books / hand'");
    expect(pv).toContain("'Bostons'");
  });
});
