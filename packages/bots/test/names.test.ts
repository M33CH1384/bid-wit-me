import { describe, expect, it } from 'vitest';
import { BOT_NAMES, pickBotNames } from '../src/names';

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
  it('falls back to Bot N when the pool is exhausted', () => {
    const all = pickBotNames(BOT_NAMES.length + 2, [], 'x');
    expect(new Set(all).size).toBe(all.length);
    expect(all.slice(-2)).toEqual(['Bot 81', 'Bot 82'].map((_, i) => `Bot ${BOT_NAMES.length + 1 + i}`));
  });
});
