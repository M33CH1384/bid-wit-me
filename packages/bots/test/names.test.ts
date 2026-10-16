import { describe, expect, it } from 'vitest';
import { BOT_NAMES, pickBotNames } from '../src/names';
import { platePersona } from '../src/talk';

describe('bot names', () => {
  it('a big, duplicate-free pool', () => {
    expect(BOT_NAMES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(BOT_NAMES.map((x) => x.toLowerCase())).size).toBe(BOT_NAMES.length);
  });
  it('distinct per table, never a human name (case-insensitive), stable for a seed', () => {
    const a = pickBotNames(3, ['keisha', 'Marcus'], 'seed-1');
    expect(new Set(a).size).toBe(3);
    expect(a.map((x) => x.toLowerCase())).not.toContain('keisha');
    expect(a).not.toContain('Marcus');
    expect(pickBotNames(3, ['keisha', 'Marcus'], 'seed-1')).toEqual(a);
  });
  it('varies across games', () => {
    const sets = new Set(Array.from({ length: 30 }, (_, i) => pickBotNames(3, [], `g${i}`).join()));
    expect(sets.size).toBeGreaterThan(25);
  });
  it('keeps plate tags unique at one table, including a shared Conspiracy Theorist tag', () => {
    const byTag = new Map<string, string[]>();
    for (const n of BOT_NAMES) byTag.set(platePersona(n), [...(byTag.get(platePersona(n)) ?? []), n]);
    const dup = byTag.get('Conspiracy Theorist');
    expect(dup && dup.length).toBeGreaterThan(1);
    const taken = BOT_NAMES.filter((n) => !dup!.includes(n));
    const forced = pickBotNames(2, taken, 'collision', platePersona);
    expect(new Set(forced.map(platePersona)).size).toBe(2);
    for (let i = 0; i < 30; i++) {
      const names = pickBotNames(3, ['Meech'], `tags-${i}`, platePersona);
      expect(new Set(names.map(platePersona)).size, names.join(', ')).toBe(3);
    }
  });
  it('falls back to Bot N when the pool is exhausted', () => {
    const all = pickBotNames(BOT_NAMES.length + 2, [], 'x');
    expect(new Set(all).size).toBe(all.length);
    expect(all.slice(-2)).toEqual(['Bot 81', 'Bot 82'].map((_, i) => `Bot ${BOT_NAMES.length + 1 + i}`));
  });
});
