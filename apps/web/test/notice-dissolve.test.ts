/**
 * Owner, 2026-11-13: "If a team is on notice and they make their books the on notice badge should
 * dissolve." A first notice warns of a second shot this hand; once the side's contract is covered
 * that cannot happen, so the badge lets go mid-hand. A sticky second notice, a side with a Nil on
 * it, and a side still short all keep theirs.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeRules, type Bid, type GameState, type HandRecord } from '@spades/rules';
import { noticeMadeSides, onNoticeSides } from '../src/shotOut';

const r = makeRules('joker');
const scored = (shot: boolean[]): HandRecord => ({
  handNo: 1, dealer: 0, bids: [3, 3, 3, 3], tricksWon: shot[0] ? [1, 5, 1, 6] : [4, 2, 4, 3],
  sides: [0, 1].map((side) => ({ side, seats: side ? [1, 3] : [0, 2], shot: shot[side]!, contract: 6, contractMade: !shot[side], nils: [] })),
} as unknown as HandRecord);
type St = Parameters<typeof noticeMadeSides>[0];
const st = (over: Partial<St> & { hist?: HandRecord[] } = {}): St => {
  const { hist, ...rest } = over;
  return { rules: r, phase: 'playing', history: hist ?? [scored([true, false])], bids: [3, 4, 2, 4] as Bid[], tricksWon: [0, 0, 0, 0], ...rest } as St;
};

describe('on notice dissolves when the books are made', () => {
  it('still short: the badge stays', () => {
    const s = st({ tricksWon: [2, 1, 2, 1] }); // side 0 bid 5, has 4
    expect(onNoticeSides(s as GameState)).toEqual([0]);
    expect(noticeMadeSides(s)).toEqual([]);
  });

  it('the owner’s screenshot: bid 3 + 2, took 3 + 2 — made, the badge goes', () => {
    expect(noticeMadeSides(st({ tricksWon: [2, 1, 3, 1] }))).toEqual([0]);
    expect(noticeMadeSides(st({ tricksWon: [4, 1, 3, 1] }))).toEqual([0]); // and stays gone with bags
  });

  it('only while the hand is being played', () => {
    expect(noticeMadeSides(st({ tricksWon: [2, 1, 3, 1], phase: 'bidding' }))).toEqual([]);
    expect(noticeMadeSides(st({ tricksWon: [2, 1, 3, 1], phase: 'handOver' }))).toEqual([]);
  });

  it('a side that is not on notice is never listed', () => {
    expect(noticeMadeSides(st({ tricksWon: [0, 4, 0, 4] }))).toEqual([]); // side 1 made, but was never on notice
  });

  it('a sticky second notice does not clear by making books', () => {
    const s = st({ hist: [scored([true, false]), scored([false, false]), scored([true, false])], tricksWon: [2, 1, 3, 1] });
    expect(onNoticeSides(s as GameState)).toEqual([0]);
    expect(noticeMadeSides(s)).toEqual([]);
  });

  it('a Nil on the side keeps it up: a busted Nil is a shot too', () => {
    expect(noticeMadeSides(st({ bids: [5, 4, 'nil', 4] as Bid[], tricksWon: [5, 1, 0, 1] }))).toEqual([]);
  });

  it('the plates carry it and the style lets it go', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain('const noticeMade = noticeMadeSides(sb);');
    expect(table.match(/chip notice\$\{noticeMade\.includes/g)).toHaveLength(2);
    const css = readFileSync(new URL('../src/uiPass.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.chip\.notice\.made \{ animation: notice-dissolve [^;]*forwards;/);
    expect(css).toMatch(/@keyframes notice-dissolve \{[\s\S]*100% \{ opacity: 0; max-width: 0;/);
  });
});
