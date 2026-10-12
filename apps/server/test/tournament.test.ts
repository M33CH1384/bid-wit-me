import { describe, expect, it } from 'vitest';
import { type Entry, newState, pendingMatches, report, standings, start } from '../src/tournament/engine';

const entries = (n: number, checked = n): Entry[] => Array.from({ length: n }, (_, i) => ({
  id: `e${i + 1}`, name: `Team ${i + 1}`, seed: i + 1, checkedIn: i < checked, members: [{ uid: `u${i}a`, name: `P${i}a` }, { uid: `u${i}b`, name: `P${i}b` }],
}));

describe('single elimination', () => {
  it('4-team bracket: 2 semis → final → champion, standings', () => {
    let s = start(newState('single', 2, 0, entries(4)), { botsForNoShows: false, seed: 7 });
    expect(s.rounds).toBe(2);
    const semis = pendingMatches(s);
    expect(semis).toHaveLength(2);
    expect(semis.map((m) => m.entries)).toEqual([['e1', 'e4'], ['e2', 'e3']]); // 1v4, 2v3
    s = report(s, semis[0]!.id, [500, 320], [1, 2]);
    expect(s.round).toBe(1);
    s = report(s, semis[1]!.id, [280, 510], [2, 1]);
    expect(s.round).toBe(2);
    const final = pendingMatches(s);
    expect(final).toHaveLength(1);
    expect(final[0]!.entries).toEqual(['e1', 'e3']);
    s = report(s, final[0]!.id, [300, 505], [2, 1]);
    expect(s.done).toBe(true);
    expect(s.champion).toBe('e3');
    expect(standings(s).map((r) => r.id).slice(0, 2)).toEqual(['e3', 'e1']);
    // a late duplicate report changes nothing
    expect(report(s, final[0]!.id, [600, 0], [1, 2])).toBe(s);
  });

  it('byes for a short field (6 teams → 2 byes), no-shows drop without bots, kept with bots', () => {
    let s = start(newState('single', 2, 0, entries(6)), { botsForNoShows: false, seed: 1 });
    const r1 = s.matches.filter((m) => m.round === 1);
    expect(r1.filter((m) => m.bye).map((m) => m.entries[0])).toEqual(['e1', 'e2']);
    expect(pendingMatches(s)).toHaveLength(2);
    for (const m of pendingMatches(s)) s = report(s, m.id, [400, 100], [1, 2]);
    expect(s.round).toBe(2);
    expect(pendingMatches(s)).toHaveLength(2);
    const noShow = start(newState('single', 2, 0, entries(4, 3)), { botsForNoShows: false, seed: 1 });
    expect(noShow.entries.find((e) => e.id === 'e4')!.dropped).toBe(true);
    expect(noShow.matches.some((m) => m.bye)).toBe(true);
    const withBots = start(newState('single', 2, 0, entries(4, 3)), { botsForNoShows: true, seed: 1 });
    expect(withBots.entries.some((e) => e.dropped)).toBe(false);
    expect(pendingMatches(withBots)).toHaveLength(2);
  });

  it('ties for first are broken by score then seed', () => {
    let s = start(newState('single', 2, 0, entries(2)), { botsForNoShows: false, seed: 1 });
    s = report(s, pendingMatches(s)[0]!.id, [400, 450], [1, 1]);
    expect(s.champion).toBe('e2');
  });

  it('Cutthroat: 8 players, tables of 4, winners meet in the final', () => {
    let s = start(newState('single', 4, 0, entries(8)), { botsForNoShows: false, seed: 3 });
    expect(s.rounds).toBe(2);
    expect(pendingMatches(s).map((m) => m.entries.length)).toEqual([4, 4]);
    for (const m of pendingMatches(s)) s = report(s, m.id, [300, 200, 100, 0], [1, 2, 3, 4]);
    expect(pendingMatches(s)[0]!.entries).toHaveLength(2);
    s = report(s, pendingMatches(s)[0]!.id, [10, 300], [2, 1]);
    expect(s.done).toBe(true);
  });
});

describe('Swiss', () => {
  it('6 teams × 3 rounds: everyone plays every round, no rematches, standings by points then score', () => {
    let s = start(newState('swiss', 2, 3, entries(6)), { botsForNoShows: false, seed: 11 });
    const pairs = new Set<string>();
    for (let r = 1; r <= 3; r++) {
      expect(s.round).toBe(r);
      const ms = pendingMatches(s);
      expect(ms).toHaveLength(3);
      for (const m of ms) {
        const key = [...m.entries].sort().join('-');
        expect(pairs.has(key)).toBe(false);
        pairs.add(key);
        // lower entry number wins (deterministic)
        const [a, b] = m.entries.map((id) => Number(id.slice(1)));
        s = report(s, m.id, a! < b! ? [500, 300] : [300, 500], a! < b! ? [1, 2] : [2, 1]);
      }
    }
    expect(s.done).toBe(true);
    const st = standings(s);
    expect(st[0]!.id).toBe('e1');
    expect(st[0]!.points).toBe(3);
    expect(s.champion).toBe('e1');
    expect(st.every((r) => r.played === 3)).toBe(true);
  });

  it('odd field: one bye per round worth a win', () => {
    const s = start(newState('swiss', 2, 2, entries(5)), { botsForNoShows: false, seed: 2 });
    const byes = s.matches.filter((m) => m.bye);
    expect(byes).toHaveLength(1);
    expect(s.points[byes[0]!.entries[0]!]).toBe(1);
  });
});
