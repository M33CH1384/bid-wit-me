/**
 * BLIZZARD, client side (owner, 2026-11-04 — losing-streak snow on the
 * Home Screen, "same thought as the fire but backwards").
 *
 * Pins:
 *  - tier boundaries are exact: 0–2 none · 3 flurry · 4–5 snowfall ·
 *    6+ blizzard (constants in blizzard.ts cite the directive);
 *  - the particle budget is hard-capped (SNOW_MAX_FLAKES) at every tier
 *    and the frost deepens monotonically — the Social crash was a menu
 *    transition's graphics spike, so this menu feature lives on a cap;
 *  - the payload read is honest: the loss streak comes only from the
 *    `streakFire` field of the self profile payload (the fire's own
 *    source); a payload without loss members (older build) or with
 *    malformed ones reads as NO weather, never an invented streak;
 *    a null payload (signed out / guest) reads null — no weather;
 *  - the chip label carries the real number, like the fire's chip;
 *  - snow.css keeps the crash lane's paint budget: no will-change
 *    retention, no backdrop-filter, no blur fields.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BLIZZARD_TIERS, SNOW_MAX_FLAKES, homeBlizzardLabel, homeBlizzardTier,
} from '../src/blizzard';
import { homeStreakFromProfile } from '../src/streakFire';

describe('blizzard tiers (current loss streak)', () => {
  it('0–2 none · 3 flurry · 4–5 snowfall · 6+ blizzard', () => {
    expect(homeBlizzardTier(0)).toBe(0);
    expect(homeBlizzardTier(1)).toBe(0);
    expect(homeBlizzardTier(2)).toBe(0);
    expect(homeBlizzardTier(3)).toBe(1);
    expect(homeBlizzardTier(4)).toBe(2);
    expect(homeBlizzardTier(5)).toBe(2);
    expect(homeBlizzardTier(6)).toBe(3);
    expect(homeBlizzardTier(7)).toBe(3);
    expect(homeBlizzardTier(25)).toBe(3);
    expect(homeBlizzardTier(Number.NaN)).toBe(0);
    expect(homeBlizzardTier(-2)).toBe(0);
  });

  it('flake counts stay under the hard cap and grow by tier', () => {
    expect(BLIZZARD_TIERS[0].flakes).toBe(0);
    for (const t of [1, 2, 3] as const) {
      expect(BLIZZARD_TIERS[t].flakes).toBeGreaterThan(0);
      expect(BLIZZARD_TIERS[t].flakes).toBeLessThanOrEqual(SNOW_MAX_FLAKES);
    }
    expect(BLIZZARD_TIERS[1].flakes).toBeLessThan(BLIZZARD_TIERS[2].flakes);
    expect(BLIZZARD_TIERS[2].flakes).toBeLessThan(BLIZZARD_TIERS[3].flakes);
    expect(BLIZZARD_TIERS[3].flakes).toBe(SNOW_MAX_FLAKES);
  });

  it('frost deepens monotonically with the tier', () => {
    expect(BLIZZARD_TIERS[0].frost).toBe(0);
    expect(BLIZZARD_TIERS[1].frost).toBeGreaterThan(0);
    expect(BLIZZARD_TIERS[1].frost).toBeLessThan(BLIZZARD_TIERS[2].frost);
    expect(BLIZZARD_TIERS[2].frost).toBeLessThan(BLIZZARD_TIERS[3].frost);
    expect(BLIZZARD_TIERS[3].frost).toBeLessThanOrEqual(1);
  });

  it('the label carries the real number', () => {
    expect(homeBlizzardLabel(3)).toBe('Ice cold — 3-game losing streak');
    expect(homeBlizzardLabel(8)).toBe('Ice cold — 8-game losing streak');
  });
});

describe('blizzard payload read (the fire’s own source, read backwards)', () => {
  it('reads lossCurrent / lossKind off streakFire', () => {
    expect(homeStreakFromProfile({ streakFire: { current: 0, kind: null, best: 5, lossCurrent: 4, lossKind: 'cutthroat' } }))
      .toMatchObject({ lossStreak: 4, lossKind: 'cutthroat' });
    expect(homeStreakFromProfile({ streakFire: { current: 2, kind: 'team', best: 9, lossCurrent: 0, lossKind: null } }))
      .toMatchObject({ streak: 2, lossStreak: 0, lossKind: null });
  });

  it('an older payload without loss members reads as no weather', () => {
    expect(homeStreakFromProfile({ streakFire: { current: 6, kind: 'team', best: 11 } }))
      .toMatchObject({ lossStreak: 0, lossKind: null });
  });

  it('malformed loss members read as zero, never an invented streak', () => {
    expect(homeStreakFromProfile({ streakFire: { current: 0, kind: null, best: 0, lossCurrent: 'four', lossKind: 'bogus' } }))
      .toMatchObject({ lossStreak: 0, lossKind: null });
    expect(homeStreakFromProfile({ streakFire: { current: 0, kind: null, best: 0, lossCurrent: -3 } }))
      .toMatchObject({ lossStreak: 0 });
    expect(homeStreakFromProfile({ streakFire: { current: 0, kind: null, best: 0, lossCurrent: 4.9, lossKind: 'team' } }))
      .toMatchObject({ lossStreak: 4, lossKind: 'team' });
  });

  it('signed out / guest: null payload and streakless payloads read null', () => {
    expect(homeStreakFromProfile(null)).toBeNull();
    expect(homeStreakFromProfile({})).toBeNull();
    expect(homeStreakFromProfile({ card: { stats: { streak: 9 } } })).toBeNull();
  });
});

describe('snow paint budget (the Social-crash lesson, pinned)', () => {
  const css = readFileSync(new URL('../src/snow/snow.css', import.meta.url), 'utf8');
  it('no layer-retention hints, no backdrop blur, no blur fields', () => {
    expect(css).not.toMatch(/will-change/);
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/blur\(/);
  });
  it('the layer never takes pointer events and never leaves the stage', () => {
    expect(css).toMatch(/\.home-blizzard\s*\{[^}]*position:\s*absolute/);
    expect(css).toMatch(/\.home-blizzard\s*\{[^}]*pointer-events:\s*none/);
  });
});
