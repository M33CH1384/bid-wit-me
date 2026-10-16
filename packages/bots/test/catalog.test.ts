import { afterEach, describe, expect, it } from 'vitest';
import { type CatalogLine, bucketFor, pickCatalog, setActiveCatalog } from '../src/catalog';
import { personaForName, voiceGender } from '../src';
import { botTalk, newTalkState, type TalkTable } from '../src/talk';

const NAMES = ['You', 'Big Mike', 'Omar', 'Sven'];
const table = (aiTalk: boolean): TalkTable => ({ seats: NAMES.map((name, i) => ({ name, bot: i !== 0 })), partnerships: true, teamNames: ['US', 'THEM'], aiTalk });
/** one catalog line per bot for every bucket we test, so whoever answers has a match */
const lines: CatalogLine[] = NAMES.slice(1).flatMap((n, k) => (['set2', 'win', 'wheelsBid:10:11'] as const).map((bucket, j) => ({ id: `id${k}${j}`, persona: personaForName(n), g: voiceGender(n), bucket, text: `catalog ${bucket} ${n}` })));

afterEach(() => setActiveCatalog(null));

describe('Voice Phase 3 catalog', () => {
  it('buckets: set by 1/2/3+, Wheels bid vs underbid, win', () => {
    expect(bucketFor('set', { bid: 5, books: 4 })).toBe('set1');
    expect(bucketFor('set', { bid: 5, books: 3 })).toBe('set2');
    expect(bucketFor('set', { bid: 6, books: 1 })).toBe('set3');
    expect(bucketFor('set', { bid: 5, books: 5 })).toBeNull();
    expect(bucketFor('wheels', { bid: 10, books: 11 })).toBe('wheelsBid:10:11');
    expect(bucketFor('wheels', { bid: 7, books: 10 })).toBe('wheelsUnder:7:10');
    expect(bucketFor('wheels', { bid: 7, books: 9 })).toBeNull();
    expect(bucketFor('win', {})).toBe('win');
  });
  it('never repeats a catalog line in a game', () => {
    const mem = {};
    const p = lines[0]!;
    expect(pickCatalog(mem, p.persona, p.g, p.bucket, () => 0, lines)?.id).toBe(p.id);
    expect(pickCatalog(mem, p.persona, p.g, p.bucket, () => 0, lines)).toBeNull();
  });

  const fire = (aiTalk: boolean, ev: Parameters<typeof botTalk>[2]) => {
    for (let seed = 0; seed < 200; seed++) {
      let s = seed + 1; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      const l = botTalk(newTalkState(), table(aiTalk), ev, 1e9, rnd);
      if (l) return l;
    }
    return null;
  };
  it('host flag off (default): canned line only, even with a matching catalog', () => {
    setActiveCatalog(lines);
    const l = fire(false, { kind: 'win', side: 1 });
    expect(l).not.toBeNull();
    expect(l!.ai).toBeUndefined();
  });
  it('host flag on: the line carries the catalog alternative and keeps the canned text as the fallback', () => {
    setActiveCatalog(lines);
    const l = fire(true, { kind: 'win', side: 1 });
    expect(l?.ai?.text).toMatch(/^catalog win|^CATALOG WIN/);
    expect(l!.text).not.toMatch(/catalog/i);
  });
  it('host flag on but no catalog match: canned only', () => {
    setActiveCatalog([]);
    const l = fire(true, { kind: 'win', side: 1 });
    expect(l).not.toBeNull();
    expect(l!.ai).toBeUndefined();
  });
});
