/**
 * Streak Fire (owner, 2026-10-27): the pure tier + derivation rules.
 * Pins:
 *  - home tiers from the real win streak (no fire below 3; 3–4 / 5–6 /
 *    7–9 / 10+), read off stored cred_totals via the max-across-kinds
 *    rule and off the /api/profile/me payload's streakFire field;
 *  - in-game tiers from a trailing run of trick wins (2 = smolder
 *    pre-fire, 3 = T1, 4 = T2, 5–6 = T3, 7+ = T4), derived with the
 *    EXISTING animfx detector (trickStreak) from a scripted trick
 *    sequence — including reset when another seat takes a trick and
 *    reset at a new hand (a fresh hand starts from an empty tricks list);
 *  - tier params scale monotonically: a bigger streak never burns lower.
 */
import { describe, expect, it } from 'vitest';
import { trickStreak } from '../src/animfx/detect';
import {
  HOME_FIRE_TIERS, SMOLDER_PARAMS, TRICK_FIRE_TIERS,
  homeFireLabel, homeFireTier, homeStreakFromProfile, homeStreakFromTotals,
  trickFire, trickFireLabel, type FireTier,
} from '../src/streakFire';

const wt = (winner: number | null) => ({ leader: 0, plays: [], winner }) as never;
const run = (winners: (number | null)[]) => trickStreak(winners.map(wt));

describe('home fire tiers (win streak)', () => {
  it('no fire below 3, then 3–4 / 5–6 / 7–9 / 10+', () => {
    expect(homeFireTier(0)).toBe(0);
    expect(homeFireTier(1)).toBe(0);
    expect(homeFireTier(2)).toBe(0);
    expect(homeFireTier(3)).toBe(1);
    expect(homeFireTier(4)).toBe(1);
    expect(homeFireTier(5)).toBe(2);
    expect(homeFireTier(6)).toBe(2);
    expect(homeFireTier(7)).toBe(3);
    expect(homeFireTier(9)).toBe(3);
    expect(homeFireTier(10)).toBe(4);
    expect(homeFireTier(31)).toBe(4);
    expect(homeFireTier(Number.NaN)).toBe(0);
  });

  it('the label carries the real number', () => {
    expect(homeFireLabel(5)).toBe('On fire — 5-game win streak');
    expect(homeFireLabel(12)).toBe('On fire — 12-game win streak');
  });
});

describe('home streak derivation from stored totals', () => {
  it('takes the max current streak across kinds and names the kind', () => {
    expect(homeStreakFromTotals([
      { kind: 'team', curStreak: 2, bestStreak: 6 },
      { kind: 'cutthroat', curStreak: 5, bestStreak: 5 },
    ])).toEqual({ streak: 5, kind: 'cutthroat', best: 6 });
    expect(homeStreakFromTotals([
      { kind: 'team', curStreak: 7, bestStreak: 7 },
      { kind: 'cutthroat', curStreak: 1, bestStreak: 9 },
    ])).toEqual({ streak: 7, kind: 'team', best: 9 });
  });

  it('a tie keeps team (deterministic), no rows reads as zero', () => {
    expect(homeStreakFromTotals([
      { kind: 'cutthroat', curStreak: 4, bestStreak: 4 },
      { kind: 'team', curStreak: 4, bestStreak: 8 },
    ])).toEqual({ streak: 4, kind: 'team', best: 8 });
    expect(homeStreakFromTotals([])).toEqual({ streak: 0, kind: null, best: 0 });
  });

  it('reads the profile payload field, and nothing else', () => {
    expect(homeStreakFromProfile({ streakFire: { current: 6, kind: 'team', best: 11 } }))
      .toEqual({ streak: 6, kind: 'team', best: 11 });
    // the card's combined streak is NOT the fire's source
    expect(homeStreakFromProfile({ card: { stats: { streak: 9 } } })).toBeNull();
    expect(homeStreakFromProfile({ streakFire: { current: 'six', kind: 'team' } })).toBeNull();
    expect(homeStreakFromProfile({ streakFire: { current: 3, kind: 'bogus' } }))
      .toEqual({ streak: 3, kind: null, best: 3 });
    expect(homeStreakFromProfile(null)).toBeNull();
    expect(homeStreakFromProfile({})).toBeNull();
  });
});

describe('in-game fire tiers (trick run)', () => {
  it('0–1 none · 2 smolder · 3 T1 · 4 T2 · 5–6 T3 · 7+ T4', () => {
    expect(trickFire(0)).toMatchObject({ kind: 'none', tier: 0 });
    expect(trickFire(1)).toMatchObject({ kind: 'none', tier: 0 });
    expect(trickFire(2)).toMatchObject({ kind: 'smolder', tier: 0 });
    expect(trickFire(3)).toMatchObject({ kind: 'fire', tier: 1 });
    expect(trickFire(4)).toMatchObject({ kind: 'fire', tier: 2 });
    expect(trickFire(5)).toMatchObject({ kind: 'fire', tier: 3 });
    expect(trickFire(6)).toMatchObject({ kind: 'fire', tier: 3 });
    expect(trickFire(7)).toMatchObject({ kind: 'fire', tier: 4 });
    expect(trickFire(13)).toMatchObject({ kind: 'fire', tier: 4 });
  });

  it('marker labels: heating up at 2, ON FIRE from 3, nothing below', () => {
    expect(trickFireLabel(1)).toBeNull();
    expect(trickFireLabel(2)).toBe('HEATING UP ×2');
    expect(trickFireLabel(3)).toBe('ON FIRE ×3');
    expect(trickFireLabel(8)).toBe('ON FIRE ×8');
  });

  it('the smolder has embers and glow but NO flame tongues or smoke', () => {
    expect(SMOLDER_PARAMS.particles).toBe(0);
    expect(SMOLDER_PARAMS.spawnPerSec).toBe(0);
    expect(SMOLDER_PARAMS.smokePerSec).toBe(0);
    expect(SMOLDER_PARAMS.embersPerSec).toBeGreaterThan(0);
    expect(SMOLDER_PARAMS.glow).toBeGreaterThan(0);
    expect(SMOLDER_PARAMS.glow).toBeLessThan(TRICK_FIRE_TIERS[1].glow + 0.2);
  });
});

describe('in-game derivation from a scripted trick sequence', () => {
  it('builds as the same seat keeps taking tricks', () => {
    expect(run([1])).toEqual({ seat: 1, count: 1 });
    expect(trickFire(run([1, 1])!.count).kind).toBe('smolder');
    expect(trickFire(run([1, 1, 1])!.count)).toMatchObject({ kind: 'fire', tier: 1 });
    expect(trickFire(run([0, 1, 1, 1, 1])!.count)).toMatchObject({ kind: 'fire', tier: 2 });
    expect(trickFire(run([2, 2, 2, 2, 2, 2, 2])!.count)).toMatchObject({ kind: 'fire', tier: 4 });
  });

  it('resets the moment another seat takes a trick', () => {
    const s = run([3, 3, 3, 1]);
    expect(s).toEqual({ seat: 1, count: 1 });
    expect(trickFire(s!.count).kind).toBe('none');
    // and the new seat starts its own run from zero
    expect(trickFire(run([3, 3, 3, 1, 1])!.count).kind).toBe('smolder');
  });

  it('resets each new hand: a fresh hand has an empty tricks list', () => {
    // hand 1 ends with seat 2 on a 5-run…
    expect(trickFire(run([2, 2, 2, 2, 2])!.count)).toMatchObject({ tier: 3 });
    // …hand 2 starts from st.tricks = [] — nothing carries over
    expect(run([])).toBeNull();
    expect(trickFire(run([2])!.count).kind).toBe('none');
  });

  it('a trick with no winner yet breaks nothing and counts nothing', () => {
    expect(run([1, 1, null])).toBeNull(); // trailing unresolved trick: the detector stops there
  });
});

describe('tier params scale monotonically', () => {
  const keys = ['particles', 'spawnPerSec', 'flameHeight', 'embersPerSec', 'sparksPerSec', 'glow', 'smokePerSec'] as const;
  for (const [name, table] of [['home', HOME_FIRE_TIERS], ['trick', TRICK_FIRE_TIERS]] as const) {
    it(`${name}: every dimension is non-decreasing from T1 to T4 and lit at T1`, () => {
      for (const k of keys) {
        let prev = 0;
        for (const t of [1, 2, 3, 4] as FireTier[]) {
          expect(table[t][k], `${name} T${t} ${k}`).toBeGreaterThanOrEqual(prev);
          prev = table[t][k];
        }
        expect(table[1][k]).toBeGreaterThan(0);
        expect(table[4][k]).toBeGreaterThan(table[1][k]);
      }
    });
  }
});
