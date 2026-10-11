import { describe, expect, it } from 'vitest';
import { PINNED_TRASH, QUICK_TRASH_SET, generalLines, quickLines } from '../src/quickTrash';

describe('Talk trash presets', () => {
  it("'Slow your roll, cowboy!' leads the Big bid, Partner and General tabs at every intensity", () => {
    expect(PINNED_TRASH).toBe('Slow your roll, cowboy!');
    for (const i of ['family', 'cookout', 'nomercy'] as const) {
      expect(quickLines('bidTooHigh', i)[0]).toBe(PINNED_TRASH);
      expect(quickLines('partnerBlunder', i)[0]).toBe(PINNED_TRASH);
      expect(generalLines(i)[0]).toBe(PINNED_TRASH);
      expect(generalLines(i).filter((l) => l === PINNED_TRASH)).toHaveLength(1);
    }
    expect(QUICK_TRASH_SET.has(PINNED_TRASH)).toBe(true);
  });
});
