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
 *  - tier params scale monotonically: a bigger streak never burns lower;
 *  - the 2026-10-30 step-up: the sprite atlas is retired — the engine
 *    is a real-time procedural shader flame, tier rows reach it through
 *    the pinned shaderUniformsFor mapping (SMOLDER = embers + glow
 *    only, shimmer only at the top tier), and the cross-fade / breathe
 *    / calm contracts survive the renderer swap.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { trickStreak } from '../src/animfx/detect';
import {
  HOME_BREATHE_PERIOD_MS, HOME_FIRE_TIERS, SMOLDER_PARAMS, TRICK_FIRE_TIERS,
  TIER_CROSSFADE_MS,
  blendFireParams,
  homeBreatheFactor, homeFireLabel, homeFireTier, homeStreakFromProfile, homeStreakFromTotals,
  trickFire, trickFireLabel, type FireTier, type FireTierParams,
} from '../src/streakFire';
import { fireSeed, fireStartPhase, shaderUniformsFor } from '../src/fire/fireEngine';

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

describe('procedural shader renderer (2026-10-30 step-up)', () => {
  const engineSrc = () => readFileSync(new URL('../src/fire/fireEngine.ts', import.meta.url), 'utf8');

  it('the sprite atlas is retired: asset deleted, no stamped tongues anywhere', () => {
    expect(existsSync(new URL('../public/assets/fire/streak-fire-atlas.webp', import.meta.url))).toBe(false);
    const src = engineSrc();
    expect(src).not.toContain('STREAK_FIRE_ATLAS');
    expect(src).not.toContain('atlasFlameFrame');
    expect(src).not.toContain('drawImage');
    expect(src).not.toContain('createImageData');
    const logic = readFileSync(new URL('../src/streakFire.ts', import.meta.url), 'utf8');
    expect(logic).not.toContain('STREAK_FIRE_ATLAS');
    expect(logic).not.toContain('atlasFlameFrame');
  });

  it('the engine is a real-time procedural shader flame (with a procedural 2D fallback)', () => {
    const src = engineSrc();
    expect(src).toContain("getContext('webgl'");
    expect(src).toContain('createShader');
    expect(src).toContain('float fbm'); // GLSL turbulence field
    expect(src).toContain('emberLayer'); // procedural ember/spark points
    expect(src).toContain('u_mask'); // plate clip lives in the shader
    expect(src).toContain('u_shimmer'); // T4 heat shimmer
    expect(src).toContain('shaderUniformsFor');
    expect(src).toContain('drawStatic'); // calm mode: one static frame
    expect(src).toContain("clip('evenodd')"); // 2D fallback keeps the plate clip
    expect(src).not.toContain('Math.random'); // deterministic, seeded
  });

  it('the shader mapping: SMOLDER is embers + glow only — flame body off, no smoke', () => {
    const u = shaderUniformsFor(SMOLDER_PARAMS, 'plate', 140, 48);
    expect(u.flameOn).toBe(0);
    expect(u.flamePx).toBe(0);
    expect(u.smoke).toBe(0);
    expect(u.ember).toBeGreaterThan(0);
    expect(u.glow).toBeGreaterThan(0);
    expect(u.shimmer).toBe(0);
  });

  it('the shader mapping: flame height mirrors the shipped spawn-band geometry', () => {
    // band: flamePx = canvas height × flameHeight
    expect(shaderUniformsFor(HOME_FIRE_TIERS[2], 'band', 200, 0).flamePx).toBeCloseTo(200 * 0.68, 9);
    expect(shaderUniformsFor(HOME_FIRE_TIERS[4], 'band', 224, 0).flamePx).toBeCloseTo(224, 9);
    // plate: flamePx = (plate height × 0.9 + 46) × flameHeight
    expect(shaderUniformsFor(TRICK_FIRE_TIERS[2], 'plate', 140, 48).flamePx).toBeCloseTo((48 * 0.9 + 46) * 0.78, 9);
    expect(shaderUniformsFor(TRICK_FIRE_TIERS[4], 'plate', 154, 52).flamePx).toBeCloseTo(52 * 0.9 + 46, 9);
  });

  it('the shader mapping: density is the tier cap normalized per surface', () => {
    expect(shaderUniformsFor(HOME_FIRE_TIERS[4], 'band', 224, 0).dens).toBe(1); // 96/96
    expect(shaderUniformsFor(TRICK_FIRE_TIERS[4], 'plate', 154, 52).dens).toBe(1); // 60/60
    expect(shaderUniformsFor(TRICK_FIRE_TIERS[1], 'plate', 110, 48).dens).toBeCloseTo(20 / 60, 9);
    expect(shaderUniformsFor(HOME_FIRE_TIERS[1], 'band', 118, 0).dens).toBeCloseTo(30 / 96, 9);
    // ceiling fade: plate crowns fade deeper than the home band
    expect(shaderUniformsFor(HOME_FIRE_TIERS[4], 'band', 224, 0).ceil).toBe(0.22);
    expect(shaderUniformsFor(TRICK_FIRE_TIERS[4], 'plate', 154, 52).ceil).toBe(0.45);
  });

  it('the shader mapping: heat shimmer exists only at the top tier(s)', () => {
    expect(shaderUniformsFor(HOME_FIRE_TIERS[4], 'band', 224, 0).shimmer).toBe(1);
    expect(shaderUniformsFor(HOME_FIRE_TIERS[3], 'band', 184, 0).shimmer).toBe(0);
    expect(shaderUniformsFor(TRICK_FIRE_TIERS[4], 'plate', 154, 52).shimmer).toBeGreaterThan(0);
    expect(shaderUniformsFor(TRICK_FIRE_TIERS[3], 'plate', 140, 48).shimmer).toBe(0);
  });

  it('the shader mapping scales monotonically with the tier tables', () => {
    for (const [table, mode] of [[HOME_FIRE_TIERS, 'band'], [TRICK_FIRE_TIERS, 'plate']] as const) {
      let prev = { dens: -1, ember: -1, smoke: -1, glow: -1, flamePx: -1 };
      for (const t of [1, 2, 3, 4] as FireTier[]) {
        const u = shaderUniformsFor(table[t], mode, 200, 48);
        expect(u.dens).toBeGreaterThanOrEqual(prev.dens);
        expect(u.ember).toBeGreaterThanOrEqual(prev.ember);
        expect(u.smoke).toBeGreaterThanOrEqual(prev.smoke);
        expect(u.glow).toBeGreaterThanOrEqual(prev.glow);
        expect(u.flamePx).toBeGreaterThanOrEqual(prev.flamePx);
        prev = u;
      }
    }
  });

  it('start phase and shader seed are deterministic per tier row', () => {
    expect(fireStartPhase(HOME_FIRE_TIERS[3])).toBe(fireStartPhase(HOME_FIRE_TIERS[3]));
    expect(fireSeed(HOME_FIRE_TIERS[3])).toBe(fireSeed(HOME_FIRE_TIERS[3]));
    expect(fireSeed(HOME_FIRE_TIERS[1])).not.toBe(fireSeed(HOME_FIRE_TIERS[4]));
    expect(fireSeed(TRICK_FIRE_TIERS[2])).not.toBe(fireSeed(TRICK_FIRE_TIERS[4]));
  });

  it('tier cross-fade: endpoints exact, midpoint blended, smoothstepped, clamped', () => {
    const a = HOME_FIRE_TIERS[1], b = HOME_FIRE_TIERS[4];
    expect(TIER_CROSSFADE_MS).toBe(300);
    expect(blendFireParams(a, b, 0)).toEqual(a);
    expect(blendFireParams(a, b, 1)).toEqual(b);
    expect(blendFireParams(a, b, -0.5)).toEqual(a); // clamped below
    expect(blendFireParams(a, b, 1.5)).toEqual(b); // clamped above
    const mid = blendFireParams(a, b, 0.5);
    const keys = ['particles', 'spawnPerSec', 'flameHeight', 'embersPerSec', 'sparksPerSec', 'glow', 'smokePerSec'] as const;
    for (const k of keys) expect(mid[k]).toBeCloseTo((a[k] + b[k]) / 2, 9);
    // smoothstep: a quarter of the way in TIME is less than a quarter of
    // the way in VALUE (the blend eases in, it does not lerp linearly)
    const quarter = blendFireParams(a, b, 0.25);
    expect(quarter.particles).toBeGreaterThan(a.particles);
    expect(quarter.particles).toBeLessThan(a.particles + (b.particles - a.particles) * 0.25);
    // and it blends DOWN just as smoothly (a broken streak cools)
    expect(blendFireParams(HOME_FIRE_TIERS[4], HOME_FIRE_TIERS[0], 0.5).particles).toBeCloseTo(48, 9);
  });

  it('particle caps, the DPR cap and the plate clip survive the renderer swap', () => {
    expect(HOME_FIRE_TIERS[4].particles).toBe(96);
    expect(TRICK_FIRE_TIERS[4].particles).toBe(60);
    // a blended cap never exceeds the higher endpoint tier's cap
    const pairs: [FireTierParams, FireTierParams][] = [
      [HOME_FIRE_TIERS[1], HOME_FIRE_TIERS[4]], [HOME_FIRE_TIERS[4], HOME_FIRE_TIERS[0]],
      [TRICK_FIRE_TIERS[2], TRICK_FIRE_TIERS[4]], [TRICK_FIRE_TIERS[4], TRICK_FIRE_TIERS[1]],
    ];
    for (const [a, b] of pairs) {
      for (let t = 0; t <= 1.0001; t += 0.1) {
        expect(blendFireParams(a, b, t).particles).toBeLessThanOrEqual(Math.max(a.particles, b.particles) + 1e-9);
      }
    }
    const src = engineSrc();
    expect(src).toContain('MAX_DPR = 1.5');
    expect(src).toContain("clip('evenodd')");
  });

  it('the home band breathes: 4 s period, factor bounded 0.92–1.00', () => {
    expect(HOME_BREATHE_PERIOD_MS).toBe(4000);
    for (let t = 0; t <= 40_000; t += 37) {
      const f = homeBreatheFactor(t);
      expect(f).toBeGreaterThanOrEqual(0.92 - 1e-9);
      expect(f).toBeLessThanOrEqual(1.0 + 1e-9);
      expect(homeBreatheFactor(t + HOME_BREATHE_PERIOD_MS)).toBeCloseTo(f, 9); // periodic
    }
    expect(homeBreatheFactor(1000)).toBeCloseTo(1.0, 9); // crest
    expect(homeBreatheFactor(3000)).toBeCloseTo(0.92, 9); // trough
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
