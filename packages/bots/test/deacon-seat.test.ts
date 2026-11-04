import { describe, expect, it } from 'vitest';
import { BOT_NAMES, pickBotNames } from '../src/names';
import { personaForName } from '../src/personas';
import { platePersona } from '../src/talk';
import { withDeaconOpponent } from '../src/deaconSeat';

/**
 * The Deacon seat guarantee (owner-approved, 2026-11-03): with "Fresh table
 * talk — Deacon" on, an offline bot game seats exactly one Deacon-persona bot
 * in an OPPONENT seat — never the partner seat — so the generated-dialogue
 * test never depends on the deal's luck. These tests pin the pure seating
 * adjustment; Table's wiring of the preference is pinned in the web suite.
 */

const deal = (n: number, seed: string): string[] => ['You', ...pickBotNames(n - 1, ['You'], seed, platePersona)];

const deaconSeats = (names: readonly string[]): number[] =>
  names.map((nm, i) => (personaForName(nm) === 'deacon' ? i : -1)).filter((i) => i >= 0);

function expectShape(names: string[], n: number) {
  expect(names).toHaveLength(n);
  expect(names[0]).toBe('You');
  // no duplicate names at a table, ever (case-insensitive, like pickBotNames)
  expect(new Set(names.map((x) => x.trim().toLowerCase())).size).toBe(n);
  // every bot name is a real roster name
  for (const nm of names.slice(1)) expect(BOT_NAMES).toContain(nm);
  // plate tags stay unique among the bot seats (the invariant pickBotNames keeps)
  const tags = names.slice(1).map((nm) => platePersona(nm));
  expect(new Set(tags).size).toBe(tags.length);
}

describe('withDeaconOpponent — partnership (4 seats, partner is seat 2)', () => {
  it('seats exactly one Deacon, in an opponent seat, across a seed sweep', () => {
    for (let i = 0; i < 300; i++) {
      const seed = `seat-sweep-${i}`;
      const out = withDeaconOpponent(deal(4, seed), { partnerships: true, seed });
      expectShape(out, 4);
      const ds = deaconSeats(out);
      expect(ds, `seed ${seed}: ${out.join(',')}`).toHaveLength(1);
      expect([1, 3]).toContain(ds[0]);
      expect(personaForName(out[2]!)).not.toBe('deacon');
    }
  });

  it('leaves an already-seated opponent Deacon untouched', () => {
    const input = ['You', 'Darius', 'Keisha', 'Marcus'];
    expect(withDeaconOpponent(input, { partnerships: true, seed: 'any' })).toEqual(input);
  });

  it('moves a dealt partner Deacon across the table', () => {
    const out = withDeaconOpponent(['You', 'Keisha', 'Darius', 'Marcus'], { partnerships: true, seed: 'partner-deacon' });
    expectShape(out, 4);
    expect(personaForName(out[2]!)).not.toBe('deacon');
    const ds = deaconSeats(out);
    expect(ds).toHaveLength(1);
    expect([1, 3]).toContain(ds[0]);
  });

  it('collapses a dealt Deacon pair (♂ + ♀) to exactly one opponent', () => {
    const out = withDeaconOpponent(['You', 'Darius', 'Keisha', 'Anjali'], { partnerships: true, seed: 'pair' });
    expectShape(out, 4);
    const ds = deaconSeats(out);
    expect(ds).toHaveLength(1);
    expect([1, 3]).toContain(ds[0]);
  });
});

describe('withDeaconOpponent — cutthroat (no partner seat)', () => {
  it('seats exactly one Deacon among the opponents, 4-seat sweep', () => {
    for (let i = 0; i < 200; i++) {
      const seed = `cut4-${i}`;
      const out = withDeaconOpponent(deal(4, seed), { partnerships: false, seed });
      expectShape(out, 4);
      const ds = deaconSeats(out);
      expect(ds, `seed ${seed}: ${out.join(',')}`).toHaveLength(1);
      expect([1, 2, 3]).toContain(ds[0]);
    }
  });

  it('seats exactly one Deacon among the opponents, 3-seat sweep', () => {
    for (let i = 0; i < 200; i++) {
      const seed = `cut3-${i}`;
      const out = withDeaconOpponent(deal(3, seed), { partnerships: false, seed });
      expectShape(out, 3);
      const ds = deaconSeats(out);
      expect(ds, `seed ${seed}: ${out.join(',')}`).toHaveLength(1);
      expect([1, 2]).toContain(ds[0]);
    }
  });
});

describe('withDeaconOpponent — discipline', () => {
  it('is deterministic for the same seed', () => {
    const a = withDeaconOpponent(deal(4, 'det-1'), { partnerships: true, seed: 'det-1' });
    const b = withDeaconOpponent(deal(4, 'det-1'), { partnerships: true, seed: 'det-1' });
    expect(a).toEqual(b);
    const c = withDeaconOpponent(deal(3, 'det-2'), { partnerships: false, seed: 'det-2' });
    const d = withDeaconOpponent(deal(3, 'det-2'), { partnerships: false, seed: 'det-2' });
    expect(c).toEqual(d);
  });

  it('does not mutate its input', () => {
    const input = deal(4, 'frozen-1');
    const copy = [...input];
    withDeaconOpponent(input, { partnerships: true, seed: 'frozen-1' });
    expect(input).toEqual(copy);
  });

  it('never seats a taken name (the player\'s own online name is off-limits)', () => {
    const input = ['You', 'Keisha', 'Marcus', 'Ty'];
    const out = withDeaconOpponent(input, { partnerships: true, seed: 'taken-1', taken: ['Darius', 'Anjali', 'You'] });
    expectShape(out, 4);
    const ds = deaconSeats(out);
    expect(ds).toHaveLength(1);
    expect(out[ds[0]!]).toBe('Kofi');
  });

  it('stays graceful when every Deacon name is taken', () => {
    const input = ['You', 'Keisha', 'Marcus', 'Ty'];
    const out = withDeaconOpponent(input, { partnerships: true, seed: 'taken-all', taken: ['Darius', 'Anjali', 'Kofi'] });
    expectShape(out, 4);
    expect(deaconSeats(out)).toHaveLength(0);
  });
});
