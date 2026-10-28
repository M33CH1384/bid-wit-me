/**
 * Run It tornado ladder (owner program, 2026-10-28): the 5-rung, per-side,
 * per-match progression. Pure pins on the parameter table (rung 2 IS the
 * funnel that shipped before the ladder; size gains stop at rung 4),
 * the pool caps, the honest claim scan (resolved run-flagged tricks only),
 * the tracker (partners share, once per hand, silent seed, resets), and
 * the fx-bus stamp that brands exactly the tornado a counted claim made.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { makeRules, type Trick } from '@spades/rules';
import { fx } from '../src/fx';
import { FELT } from '../src/three/layout';
import {
  TORNADO_LEVEL_NAMES, TORNADO_PARAMS, TORNADO_POOL, TornadoLadderTracker,
  lerpTornadoParams, runClaimOfHand, tornadoDrawCounts, tornadoLevelForCount,
  tornadoLevelName, tornadoParams,
} from '../src/three/tornadoLevel';

const rules = makeRules('joker'); // partnership: seats 0+2 = side 0, 1+3 = side 1
const cutRules = makeRules('cutthroat', { playerCount: 4 });

const runTrick = (winner: number | null, run = true): Trick => ({
  leader: 0,
  plays: [{ seat: winner ?? 0, card: 'AS', ...(run ? { run: true } : {}) }],
  winner,
}) as unknown as Trick;
const plainTrick = (winner: number): Trick => ({
  leader: 0, plays: [{ seat: winner, card: '9H' }], winner,
}) as unknown as Trick;

describe('the ladder names and rungs', () => {
  it('the names constant is the single source of the five rung names, in order', () => {
    expect([...TORNADO_LEVEL_NAMES]).toEqual(['Dust Devil', 'Twister', 'Storm', 'Supercell', 'Cataclysm']);
    expect(TORNADO_PARAMS.map((p) => p.level)).toEqual([1, 2, 3, 4, 5]);
    for (let l = 1; l <= 5; l++) expect(tornadoLevelName(l)).toBe(TORNADO_LEVEL_NAMES[l - 1]);
  });

  it('count → level clamps to the ladder (first claim is rung 1, nothing passes rung 5)', () => {
    expect(tornadoLevelForCount(0)).toBe(1);
    expect(tornadoLevelForCount(1)).toBe(1);
    expect(tornadoLevelForCount(2)).toBe(2);
    expect(tornadoLevelForCount(4)).toBe(4);
    expect(tornadoLevelForCount(5)).toBe(5);
    expect(tornadoLevelForCount(9)).toBe(5);
    expect(tornadoLevelForCount(-3)).toBe(1);
  });
});

describe('the parameter table', () => {
  it('rung 2 is the baseline funnel exactly: unit everything, full pools, no shells', () => {
    expect(tornadoParams(2)).toEqual({
      level: 2, height: 1.9, mouth: 0.77, radiusX: 1, ringR: 1.05, spin: 1,
      dustFrac: 1, debrisFrac: 1, pointSize: 1, body: 1, dark: 0, flicker: 0, signature: true,
    });
  });

  it('rung 1 is a knee-high, table-local dust devil: dust only, no signature debris', () => {
    const p = tornadoParams(1);
    expect(p.height).toBeCloseTo(0.62);
    expect(p.height).toBeLessThan(1.9 / 3 + 0.02); // ≈ ⅓ of the baseline height
    expect(p.signature).toBe(false);
    expect(p.debrisFrac).toBe(0);
    expect(p.mouth).toBeLessThan(FELT.hx); // the mouth stays well inside the felt
    expect(p.ringR).toBeLessThan(FELT.hx);
    expect(p.spin).toBeLessThan(1);
    expect(p.dark).toBe(0);
    expect(p.flicker).toBe(0);
  });

  it('rung 3 is taller, its dust ring spills past the table edge, and the light flickers', () => {
    const p = tornadoParams(3);
    expect(p.height).toBeGreaterThan(tornadoParams(2).height);
    expect(p.ringR).toBeCloseTo(1.95);
    expect(p.ringR).toBeGreaterThan(FELT.hx); // 1.95 > the felt's 1.5 half-width
    expect(p.flicker).toBeGreaterThan(0);
    expect(p.dark).toBeGreaterThan(0);
    expect(p.signature).toBe(true);
  });

  it('rung 4 is wider than the table and its debris field doubles the baseline', () => {
    const p = tornadoParams(4);
    expect(p.mouth * 2).toBeGreaterThan(FELT.hx * 2); // mouth diameter 3.44 > felt width 3.0
    expect(p.mouth).toBeGreaterThan(2 * tornadoParams(2).mouth);
    expect(p.radiusX).toBeGreaterThan(2);
    expect(p.dark).toBeGreaterThan(tornadoParams(3).dark);
  });

  it('rung 5 gains intensity, NOT size: dimensions identical to rung 4, spin/coverage/darkness up', () => {
    const l4 = tornadoParams(4);
    const l5 = tornadoParams(5);
    expect(l5.height).toBe(l4.height);
    expect(l5.mouth).toBe(l4.mouth);
    expect(l5.radiusX).toBe(l4.radiusX);
    expect(l5.ringR).toBe(l4.ringR);
    expect(l5.spin).toBeGreaterThan(l4.spin);
    expect(l5.pointSize).toBeGreaterThan(l4.pointSize);
    expect(l5.body).toBeGreaterThan(l4.body);
    expect(l5.dark).toBeGreaterThan(l4.dark);
    expect(l5.flicker).toBeGreaterThan(l4.flicker);
  });

  it('escalation is monotonic: size, spin, coverage and darkness never step down a rung', () => {
    for (let l = 2; l <= 5; l++) {
      const a = tornadoParams(l - 1);
      const b = tornadoParams(l);
      expect(b.height).toBeGreaterThanOrEqual(a.height);
      expect(b.mouth).toBeGreaterThanOrEqual(a.mouth);
      expect(b.ringR).toBeGreaterThanOrEqual(a.ringR);
      expect(b.spin).toBeGreaterThan(a.spin);
      expect(b.pointSize).toBeGreaterThanOrEqual(a.pointSize);
      expect(b.body).toBeGreaterThanOrEqual(a.body);
      expect(b.dark).toBeGreaterThanOrEqual(a.dark);
      expect(b.flicker).toBeGreaterThanOrEqual(a.flicker);
    }
    expect(tornadoParams(0).level).toBe(1); // clamped at the ends
    expect(tornadoParams(99).level).toBe(5);
  });

  it('the formation blend interpolates like the prototype, and the signature switch flips at the midpoint', () => {
    const mid = lerpTornadoParams(tornadoParams(1), tornadoParams(2), 0.5);
    expect(mid.height).toBeCloseTo((0.62 + 1.9) / 2);
    expect(mid.spin).toBeCloseTo((0.63 + 1) / 2);
    expect(mid.level).toBeCloseTo(1.5);
    expect(lerpTornadoParams(tornadoParams(1), tornadoParams(2), 0.25).signature).toBe(false);
    expect(lerpTornadoParams(tornadoParams(1), tornadoParams(2), 0.5).signature).toBe(true);
    expect(lerpTornadoParams(tornadoParams(1), tornadoParams(2), 0.75).signature).toBe(true);
    const same = lerpTornadoParams(tornadoParams(3), tornadoParams(3), 0.3);
    expect(same.height).toBeCloseTo(tornadoParams(3).height);
    expect(lerpTornadoParams(tornadoParams(1), tornadoParams(5), 2).height).toBeCloseTo(tornadoParams(5).height); // u clamps
  });
});

describe('draw counts stay inside the allocated pools', () => {
  it('the pools are the proven budgets, and rung 2 draws them in full on both profiles', () => {
    expect(TORNADO_POOL.high).toEqual({ dust: 1400, debris: 260 });
    expect(TORNADO_POOL.low).toEqual({ dust: 450, debris: 90 });
    expect(tornadoDrawCounts(2, true)).toEqual({ dust: 1400, debris: 260 });
    expect(tornadoDrawCounts(2, false)).toEqual({ dust: 450, debris: 90 });
  });

  it('no rung on either profile ever draws past its pool; rung 1 draws reduced dust and zero debris', () => {
    for (let l = 1; l <= 5; l++) {
      expect(tornadoDrawCounts(l, true).dust).toBeLessThanOrEqual(TORNADO_POOL.high.dust);
      expect(tornadoDrawCounts(l, true).debris).toBeLessThanOrEqual(TORNADO_POOL.high.debris);
      expect(tornadoDrawCounts(l, false).dust).toBeLessThanOrEqual(TORNADO_POOL.low.dust);
      expect(tornadoDrawCounts(l, false).debris).toBeLessThanOrEqual(TORNADO_POOL.low.debris);
    }
    expect(tornadoDrawCounts(1, true)).toEqual({ dust: 630, debris: 0 });
    expect(tornadoDrawCounts(1, false).debris).toBe(0);
    expect(tornadoDrawCounts(5, true)).toEqual({ dust: 1400, debris: 260 }); // density via point size, never counts
  });
});

describe('the claim scan — resolved run-flagged tricks only', () => {
  it('counts only a completed trick carrying the run flag with a winner; the last such trick is the claim', () => {
    expect(runClaimOfHand([])).toBeNull();
    expect(runClaimOfHand([plainTrick(1)])).toBeNull(); // no run flag
    expect(runClaimOfHand([runTrick(null)])).toBeNull(); // run flag but unresolved: counts for nothing
    expect(runClaimOfHand([runTrick(2)])).toEqual({ seat: 2, trickIndex: 0 });
    expect(runClaimOfHand([runTrick(0), plainTrick(1), runTrick(3)])).toEqual({ seat: 3, trickIndex: 2 });
    expect(runClaimOfHand([runTrick(0), runTrick(null)])).toEqual({ seat: 0, trickIndex: 0 });
  });
});

describe('the per-side, per-match tracker', () => {
  it('partners share one ladder: either partner’s claim ticks the side', () => {
    const tr = new TornadoLadderTracker();
    expect(tr.observe(1, [runTrick(0)], rules)).toMatchObject({ seat: 0, side: 0, count: 1, level: 1 });
    expect(tr.observe(2, [runTrick(2)], rules)).toMatchObject({ seat: 2, side: 0, count: 2, level: 2 }); // the partner
    expect(tr.observe(3, [runTrick(1)], rules)).toMatchObject({ seat: 1, side: 1, count: 1, level: 1 }); // the other side starts its own
    expect(tr.countForSide(0)).toBe(2);
    expect(tr.levelForSide(0)).toBe(2);
  });

  it('counts a hand’s claim once, however often the snapshot repeats', () => {
    const tr = new TornadoLadderTracker();
    const tricks = [runTrick(0)];
    expect(tr.observe(1, tricks, rules)).not.toBeNull();
    expect(tr.observe(1, tricks, rules)).toBeNull();
    expect(tr.observe(1, [runTrick(0), runTrick(0)], rules)).toBeNull(); // even a second flagged trick in the same hand
    expect(tr.countForSide(0)).toBe(1);
  });

  it('caps the rung at 5 while the honest count keeps going', () => {
    const tr = new TornadoLadderTracker();
    const levels: number[] = [];
    for (let h = 1; h <= 6; h++) levels.push(tr.observe(h, [runTrick(0)], rules)!.level);
    expect(levels).toEqual([1, 2, 3, 4, 5, 5]);
    expect(tr.countForSide(0)).toBe(6);
  });

  it('cutthroat seats ladder alone', () => {
    const tr = new TornadoLadderTracker();
    expect(tr.observe(1, [runTrick(0)], cutRules)).toMatchObject({ side: 0, count: 1 });
    expect(tr.observe(2, [runTrick(0)], cutRules)).toMatchObject({ side: 0, count: 2, level: 2 });
    expect(tr.observe(3, [runTrick(1)], cutRules)).toMatchObject({ side: 1, count: 1, level: 1 });
    expect(tr.countForSide(2)).toBe(0);
  });

  it('a new match key resets the ladder; the silent seed marks pre-held claims counted, never ticked', () => {
    const tr = new TornadoLadderTracker();
    tr.observe(1, [runTrick(0)], rules, 'match-a');
    tr.observe(2, [runTrick(0)], rules, 'match-a');
    expect(tr.countForSide(0)).toBe(2);
    expect(tr.observe(1, [runTrick(0)], rules, 'match-b')).toBeNull(); // reset + silent seed: no tick for the pre-held claim
    expect(tr.countForSide(0)).toBe(0);
    expect(tr.observe(2, [runTrick(0)], rules, 'match-b')).toMatchObject({ count: 1, level: 1 });
    // the same silent-seed discipline on its own: a claim already resolved
    // in the first held snapshot is marked counted, never ticked, and the
    // count is not fabricated — the NEXT live claim ticks honestly from 1
    const seeded = new TornadoLadderTracker();
    seeded.seedFrom(1, [runTrick(0)]);
    expect(seeded.observe(1, [runTrick(0)], rules)).toBeNull();
    expect(seeded.countForSide(0)).toBe(0);
    expect(seeded.observe(2, [runTrick(0)], rules)).toMatchObject({ count: 1, level: 1 });
  });

  it('a hand rewind (rematch) resets the ladder before evaluating', () => {
    const tr = new TornadoLadderTracker();
    tr.observe(3, [runTrick(0)], rules);
    tr.observe(4, [runTrick(0)], rules);
    expect(tr.countForSide(0)).toBe(2);
    // hand counts rewind to 1: a fresh match — its first claim is rung 1 again
    expect(tr.observe(1, [runTrick(2)], rules)).toMatchObject({ seat: 2, count: 1, level: 1 });
  });

});

describe('the fx-bus claim stamp', () => {
  it('stamps the pending claim onto the next plain tornado assignment', () => {
    fx.tornado = null;
    fx.clearTornadoClaim();
    fx.noteTornadoClaim({ level: 3, side: 1, seat: 3 });
    fx.tornado = { start: 1234, reduced: false }; // Table's exact assignment shape
    expect(fx.tornado).toEqual({ start: 1234, reduced: false, level: 3, side: 1, seat: 3 });
    fx.tornado = null;
  });

  it('is consumed on use, and an explicit level on the assignment wins over the stamp', () => {
    fx.tornado = null;
    fx.clearTornadoClaim();
    fx.noteTornadoClaim({ level: 2, side: 0, seat: 0 });
    fx.tornado = { start: 1, reduced: false };
    expect(fx.tornado?.level).toBe(2);
    fx.tornado = { start: 2, reduced: false }; // no new note: no stamp left to give
    expect(fx.tornado?.level).toBeUndefined();
    fx.noteTornadoClaim({ level: 4, side: 1, seat: 1 });
    fx.tornado = { start: 3, reduced: false, level: 5, side: 0, seat: 2 }; // explicit wins
    expect(fx.tornado).toMatchObject({ level: 5, side: 0, seat: 2 });
    fx.tornado = null;
  });

  it('expires after the TTL and clears on demand, so a stale claim never brands a later tornado', () => {
    fx.tornado = null;
    fx.clearTornadoClaim();
    let now = 50_000;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      fx.noteTornadoClaim({ level: 5, side: 0, seat: 0 });
      now += 10_001; // past the 10 s TTL
      fx.tornado = { start: 9, reduced: false };
      expect(fx.tornado?.level).toBeUndefined();
      fx.noteTornadoClaim({ level: 5, side: 0, seat: 0 });
      fx.clearTornadoClaim();
      fx.tornado = { start: 10, reduced: false };
      expect(fx.tornado?.level).toBeUndefined();
    } finally {
      spy.mockRestore();
      fx.tornado = null;
      fx.clearTornadoClaim();
    }
  });
});

describe('source wiring pins', () => {
  it('Tornado3D is driven by the ladder module — and never spells the rung-2 name (the branding pin)', () => {
    const src = readFileSync(new URL('../src/three/Tornado3D.tsx', import.meta.url), 'utf8');
    expect(src).toContain("from './tornadoLevel'");
    expect(src).toContain('uSpin');
    expect(src).toContain('setDrawRange');
    expect(src).toContain('TORNADO_POOL');
    expect(src).toContain('P.signature');
    expect(src).toContain('__bwmTornadoLevel');
    expect(src.toLowerCase()).not.toContain('twister');
    expect(src.toLowerCase()).not.toContain('dorothy');
  });

  it('the layer counts claims and renders the chip; the css skins it for both themes', () => {
    const layer = readFileSync(new URL('../src/animfx/AnimFxLayer.tsx', import.meta.url), 'utf8');
    expect(layer).toContain('TornadoLadderTracker');
    expect(layer).toContain('fx.noteTornadoClaim');
    expect(layer).toContain('fx.clearTornadoClaim()');
    expect(layer).toContain("'tornchip'");
    expect(layer).toContain('seedFrom');
    const fxSrc = readFileSync(new URL('../src/fx.ts', import.meta.url), 'utf8');
    expect(fxSrc).toContain('get tornado()');
    expect(fxSrc).toContain('noteTornadoClaim');
    const css = readFileSync(new URL('../src/animfx/animfx.css', import.meta.url), 'utf8');
    expect(css).toContain('.animfx-tornchip');
    expect(css).toContain('html[data-theme="neon"] .animfx-tornchip');
    expect(css).toContain('.animfx-tornchip.still');
  });
});
