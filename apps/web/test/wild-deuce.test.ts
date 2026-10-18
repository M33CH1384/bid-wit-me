import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLASSIC_JOKER, makeRules } from '@spades/rules';
import { isPromoted, isWildDeuce } from '../src/cardFaces';
import { DEFAULT_SETTINGS, settingsToRules } from '../src/settings';

/**
 * DISPLAY verdict for the live-beta report "the two spades doesn't look like
 * it's holding its rank as a wild deuce": the rules always ranked 2♠ above
 * A♠ (pinned in packages/rules/test/deuce-rank.test.ts), but only the
 * off-suit 2♦ carried the trump badge — the 2♠ face was a plain low 2.
 */
describe('wild-deuce face badge (display)', () => {
  it('badges BOTH house deuces, and nothing else in the trump line', () => {
    const r = settingsToRules(DEFAULT_SETTINGS); // the live default: joker, house order
    expect(r.trumpOrderTop).toEqual(['BJ', 'LJ', '2D', '2S']);
    expect(isWildDeuce('2S', r)).toBe(true);
    expect(isWildDeuce('2D', r)).toBe(true);
    expect(isWildDeuce('AS', r)).toBe(false);
    expect(isWildDeuce('3S', r)).toBe(false);
    expect(isWildDeuce('BJ', r)).toBe(false); // jokers have their own face
    // the old badge covered only the off-suit deuce:
    expect(isPromoted('2D', r)).toBe(true);
    expect(isPromoted('2S', r)).toBe(false);
  });

  it('classic variants: no badge without deuce-high; 2♠ badged with it', () => {
    const plain = makeRules('joker', CLASSIC_JOKER);
    expect(isWildDeuce('2S', plain)).toBe(false);
    const high = makeRules('joker', { ...CLASSIC_JOKER, deuceOfSpadesHigh: true });
    expect(isWildDeuce('2S', high)).toBe(true);
    const ace = makeRules('aceDown');
    expect(isWildDeuce('2S', ace)).toBe(false); // a plain low spade there
  });

  it('every face-render path uses the both-deuces badge', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    const runZoom = readFileSync(new URL('../src/RunZoom.tsx', import.meta.url), 'utf8');
    expect(table).toContain('isWildDeuce');
    expect(runZoom).toContain('isWildDeuce');
    expect(table).not.toContain('isPromoted');
    expect(runZoom).not.toContain('isPromoted');
  });
});
