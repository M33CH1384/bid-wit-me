import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CLASSIC_JOKER, cardLabel, makeRules, trumpOrder } from '@spades/rules';
import { MODES } from '../src/settings';
import { TrumpLadder, promotedTrumpLabels, trumpLadder, trumpLadderText } from '../src/trumpLadder';
import { topTrumps } from '../src/glossary';

function labels(r: ReturnType<typeof makeRules>, n: number, style: 'short' | 'long' | 'plain') {
  return trumpOrder(r).slice(0, n).map((c) => (c === 'BJ' || c === 'LJ' ? (style === 'long' ? (c === 'BJ' ? 'BIG JKR' : 'LIL JKR') : style === 'short' ? c : cardLabel(c)) : cardLabel(c)));
}

describe('trump ladder', () => {
  it('uses one spaced order, high to low, matching the rules', () => {
    const house = makeRules('joker');
    const text = trumpLadderText(house, 5, 'long');
    const short = trumpLadderText(house, 4, 'short');
    expect(text).toBe('BIG JKR › LIL JKR › 2♦ › 2♠ › A♠');
    expect(short).toBe('BJ › LJ › 2♦ › 2♠');
    expect(text.indexOf('2♦')).toBeLessThan(text.indexOf('2♠'));
    expect(short.indexOf('2♦')).toBeLessThan(short.indexOf('2♠'));
    expect(short).not.toMatch(/[^ ]›[^ ]/);
    expect(trumpLadder(house, 5, 'long')).toEqual(labels(house, 5, 'long'));
    expect(topTrumps(house)).toBe('Big Joker, Little Joker, 2♦, 2♠');
    expect(promotedTrumpLabels(house)).toEqual(['2♦', '2♠']);
    expect(MODES.find((m) => m.key === 'joker')!.blurb.startsWith('Big Joker › Little Joker › 2♦ › 2♠ › A♠')).toBe(true);
  });

  it('classic deuce-high ranks 2♠ under the jokers and drops 2♦', () => {
    const r = makeRules('joker', { ...CLASSIC_JOKER, deuceOfSpadesHigh: true });
    expect(trumpLadderText(r, 4, 'short')).toBe('BJ › LJ › 2♠ › A♠');
    expect(promotedTrumpLabels(r)).toEqual(['2♠']);
    expect(trumpLadderText(r, 4, 'short')).not.toContain('2♦');
  });

  it('renders both strips from the same rungs, each isolated left to right', () => {
    const r = makeRules('joker');
    for (const style of ['short', 'long'] as const) {
      const html = renderToStaticMarkup(createElement(TrumpLadder, { rules: r, n: style === 'short' ? 4 : 5, style }));
      expect(html).toContain('dir="ltr"');
      const rungs = [...html.matchAll(/data-trump="([^"]+)"/g)].map((m) => m[1]);
      expect(rungs).toEqual(trumpLadder(r, style === 'short' ? 4 : 5, style));
      expect(rungs.indexOf('2♦')).toBeLessThan(rungs.indexOf('2♠'));
    }
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain('<TrumpLadder rules={r} n={4} style="short" />');
    expect(table).toContain('<TrumpLadder rules={r} n={5} style="long" />');
    expect(table).not.toContain("join('›')");
    expect(table).not.toContain("join(' › ')");
  });
});

import { trumpStripShown } from '../src/trumpLadder';
describe('TRUMPS strip visibility', () => {
  it('shows through deal and bidding, hides after the first card, returns next hand', () => {
    expect(trumpStripShown({ phase: 'bidding', tricks: [], trick: { plays: [] } })).toBe(true);
    expect(trumpStripShown({ phase: 'playing', tricks: [], trick: { plays: [] } })).toBe(true);
    expect(trumpStripShown({ phase: 'playing', tricks: [], trick: { plays: [{}] } })).toBe(false);
    expect(trumpStripShown({ phase: 'playing', tricks: [{}], trick: { plays: [] } })).toBe(false);
    expect(trumpStripShown({ phase: 'bidding', tricks: [], trick: { plays: [] } })).toBe(true);
  });
});
