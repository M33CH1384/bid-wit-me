import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { pickBotNames, platePersona, personaForName, withDeaconOpponent } from '@spades/bots';
import { carriedTableSeats } from '../src/seatNames';
import { consumeRematchSeats, stashRematchSeats } from '../src/rewardsStash';

// Rematch = same table (owner, 2026-11-04: "when I select rematch I don't
// get the same opponents or partner"). Before the fix, an offline table's
// seats were a pure function of the game seed and every rematch minted a
// fresh seed (App's onRematch), so the draw dealt a brand-new table. These
// tests pin the carry: the finished game's seats are handed to the next
// game in the sitting and dealt back, while a fresh table (no carry) still
// draws from its seed exactly as before.

/** The pre-fix offline draw (Table's offlineNames with no stored online
 *  name, so taken = ['You']) — the behavior a fresh table must keep. */
function dealtNames(n: number, seed: string, partnerships: boolean, genDialogue: boolean): string[] {
  const taken = ['You'];
  const picked = ['You', ...pickBotNames(n - 1, taken, seed, platePersona)];
  if (!genDialogue) return picked;
  return withDeaconOpponent(picked, { partnerships, seed, taken });
}

/** The per-game seat resolution the table runs: a valid carry wins over
 *  the seed draw (story/resume precedence sits above this and is pinned by
 *  deacon-seat-wiring.test.ts + the source pins below). */
function seatsForGame(n: number, seed: string, partnerships: boolean, genDialogue: boolean, carry: readonly string[] | null): string[] {
  return carriedTableSeats(carry, n, seed, partnerships, genDialogue) ?? dealtNames(n, seed, partnerships, genDialogue);
}

const isDeacon = (nm: string) => personaForName(nm) === 'deacon';
const deaconSeats = (names: readonly string[]) => names.map((nm, i) => (isDeacon(nm) ? i : -1)).filter((i) => i >= 0);

function findSeed(pred: (names: string[]) => boolean, n = 4, partnerships = true): string {
  for (let i = 0; i < 500; i++) {
    const s = `scan-${i}`;
    if (pred(dealtNames(n, s, partnerships, false))) return s;
  }
  throw new Error('no seed matched');
}

describe('the defect, reproduced at the seat-resolution level', () => {
  it('the seed draw alone deals a different table per seed (why a fresh-seed rematch lost the table)', () => {
    const a = dealtNames(4, 'game-one', true, false);
    const b = dealtNames(4, 'game-two', true, false);
    expect(b).not.toEqual(a);
  });

  it('a fresh table (no carry) still draws exactly the pre-fix names from its seed', () => {
    for (const seed of ['alpha', 'beta', 'gamma']) {
      expect(seatsForGame(4, seed, true, false, null)).toEqual(dealtNames(4, seed, true, false));
      expect(seatsForGame(4, seed, true, true, null)).toEqual(dealtNames(4, seed, true, true));
      expect(seatsForGame(3, seed, false, false, null)).toEqual(dealtNames(3, seed, false, false));
    }
  });
});

describe('rematch keeps the table', () => {
  it('offline quick rematch: same partner, same opponents, same seats', () => {
    const g1 = seatsForGame(4, 'series-game-1', true, false, null);
    const g2 = seatsForGame(4, 'a-fresh-rematch-seed', true, false, g1);
    expect(g2).toEqual(g1);
    expect(g2[2]).toBe(g1[2]); // partner seat
    expect([g2[1], g2[3]]).toEqual([g1[1], g1[3]]); // opponent seats
  });

  it('series games 2 and 3 keep game 1’s table', () => {
    const g1 = seatsForGame(4, 'srs-1', true, false, null);
    const g2 = seatsForGame(4, 'srs-2', true, false, g1);
    const g3 = seatsForGame(4, 'srs-3', true, false, g2);
    expect(g2).toEqual(g1);
    expect(g3).toEqual(g1);
  });

  it('cutthroat rematch keeps its opponents (4-seat and 3-seat)', () => {
    const g1 = seatsForGame(4, 'cut-1', false, false, null);
    expect(seatsForGame(4, 'cut-2', false, false, g1)).toEqual(g1);
    const h1 = seatsForGame(3, 'cut3-1', false, false, null);
    expect(seatsForGame(3, 'cut3-2', false, false, h1)).toEqual(h1);
  });

  it('a wrong-length or absent carry falls back to the seed draw', () => {
    expect(carriedTableSeats(null, 4, 'x', true, false)).toBeNull();
    expect(carriedTableSeats(undefined, 4, 'x', true, false)).toBeNull();
    expect(carriedTableSeats([], 4, 'x', true, false)).toBeNull();
    expect(carriedTableSeats(['You', 'A', 'B'], 4, 'x', true, false)).toBeNull();
    expect(seatsForGame(4, 'fallback-seed', true, false, ['You', 'A'])).toEqual(dealtNames(4, 'fallback-seed', true, false));
  });

  it('the carried array is never mutated and the result is a copy', () => {
    const g1 = Object.freeze(seatsForGame(4, 'frozen-1', true, false, null));
    const g2 = carriedTableSeats(g1, 4, 'frozen-2', true, false);
    expect(g2).toEqual(g1);
    expect(g2).not.toBe(g1);
  });
});

describe('the Deacon guarantee composes with the carry', () => {
  it('toggle on for both games: the carried table already seats its Deacon and passes unchanged', () => {
    const g1 = seatsForGame(4, 'deacon-table', true, true, null);
    // the guarantee the fresh draw made: exactly one Deacon, an opponent
    expect(deaconSeats(g1)).toHaveLength(1);
    expect([1, 3]).toContain(deaconSeats(g1)[0]);
    const g2 = seatsForGame(4, 'deacon-table-rematch', true, true, g1);
    expect(g2).toEqual(g1); // no re-draw — the preserved seats satisfy it
  });

  it('toggle flipped ON between games: the guarantee is applied to the carried table, partner preserved', () => {
    const seed = findSeed((names) => deaconSeats(names).length === 0);
    const g1 = seatsForGame(4, seed, true, false, null);
    const g2 = seatsForGame(4, 'flipped-on', true, true, g1);
    expect(deaconSeats(g2)).toHaveLength(1);
    expect([1, 3]).toContain(deaconSeats(g2)[0]); // an opponent seat
    expect(g2[0]).toBe('You');
    expect(g2[2]).toBe(g1[2]); // partner untouched (he held no Deacon)
    const changed = g2.map((nm, i) => (nm !== g1[i] ? i : -1)).filter((i) => i >= 0);
    expect(changed).toEqual(deaconSeats(g2)); // exactly the one seat changed
    expect(new Set(g2).size).toBe(4); // still no repeats at the table
  });

  it('toggle flipped ON with a Deacon dealt at the partner seat: he moves across the table', () => {
    const seed = findSeed((names) => isDeacon(names[2]!));
    const g1 = seatsForGame(4, seed, true, false, null);
    const g2 = seatsForGame(4, 'flipped-on-partner', true, true, g1);
    expect(isDeacon(g2[2]!)).toBe(false); // partner seat no longer hosts him
    expect(deaconSeats(g2)).toHaveLength(1);
    expect([1, 3]).toContain(deaconSeats(g2)[0]);
  });

  it('toggle flipped OFF between games: the table is carried verbatim (the Deacon stays as a regular seat)', () => {
    const g1 = seatsForGame(4, 'deacon-off-1', true, true, null);
    expect(deaconSeats(g1)).toHaveLength(1);
    const g2 = seatsForGame(4, 'deacon-off-2', true, false, g1);
    expect(g2).toEqual(g1);
  });
});

describe('the recovery-surface rematch handshake', () => {
  class MemStorage {
    private m = new Map<string, string>();
    getItem(k: string) { return this.m.get(k) ?? null; }
    setItem(k: string, v: string) { this.m.set(k, String(v)); }
    removeItem(k: string) { this.m.delete(k); }
  }
  beforeEach(() => {
    (globalThis as { sessionStorage?: unknown }).sessionStorage = new MemStorage();
  });

  it('stashes under the dedicated key and consumes exactly once', () => {
    stashRematchSeats(['You', 'Monique', 'Aaliyah', 'Darius']);
    expect((globalThis as { sessionStorage: MemStorage }).sessionStorage.getItem('bwm.rematchSeats.v1')).toBeTruthy();
    expect(consumeRematchSeats()).toEqual(['You', 'Monique', 'Aaliyah', 'Darius']);
    expect(consumeRematchSeats()).toBeNull(); // a later plain autostart must not inherit them
  });

  it('nothing stashed → null; garbage → null (and the key is cleared)', () => {
    expect(consumeRematchSeats()).toBeNull();
    (globalThis as { sessionStorage: MemStorage }).sessionStorage.setItem('bwm.rematchSeats.v1', 'not json');
    expect(consumeRematchSeats()).toBeNull();
    expect(consumeRematchSeats()).toBeNull();
    (globalThis as { sessionStorage: MemStorage }).sessionStorage.setItem('bwm.rematchSeats.v1', JSON.stringify(['You', 7]));
    expect(consumeRematchSeats()).toBeNull();
  });
});

describe('wiring pins', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

  it('Table deals the carry through offlineNames and records seats in the session shell', () => {
    const table = read('../src/Table.tsx');
    expect(table).toContain('carriedTableSeats(');
    expect(table).toContain('liveCarry');
    expect(table).toContain('offlineNames(n0, seed, initialRules.partnerships, liveCarry)');
    expect(table).toContain('seatNamesRef');
    const shell = table.slice(table.indexOf('export default function Table'));
    expect(shell).toContain('seatNamesRef');
    // the finished game's seats ride the rewards stash for the recovery path
    expect(table).toContain('seatNames:');
  });

  it('App consumes the recovery seats only on the autostart rematch and passes them to the table', () => {
    const app = read('../src/App.tsx');
    expect(app).toContain('consumeRematchSeats(');
    expect(app).toContain('carryNames');
  });

  it('the recovery surface stashes the seats when its Rematch is clicked', () => {
    const vr = read('../src/VictoryRecovery.tsx');
    expect(vr).toContain('stashRematchSeats(');
  });

  it('rewardsStash owns the dedicated key', () => {
    const stash = read('../src/rewardsStash.ts');
    expect(stash).toContain('bwm.rematchSeats.v1');
    expect(stash).toContain('export function stashRematchSeats');
    expect(stash).toContain('export function consumeRematchSeats');
  });
});
