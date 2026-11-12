import { describe, expect, it } from 'vitest';
import { type HandRecord, makeRules } from '@spades/rules';
import { pickMvp } from '../src/mvp';

const r = makeRules('joker'); // partnerships: seats 0+2 vs 1+3
const hand = (bids: (number | 'nil' | 'blindNil')[], took: number[], extra: Partial<HandRecord> = {}, nilMade: Record<number, boolean> = {}): HandRecord => ({
  handNo: 1, dealer: 0, bids, tricksWon: took,
  sides: [0, 1].map((side) => ({ side, nils: bids.flatMap((b, seat) => (seat % 2 === side && typeof b !== 'number' ? [{ seat, kind: b, tricks: took[seat], made: !!nilMade[seat], points: 0 }] : [])) })),
  ...extra,
} as unknown as HandRecord);

describe('pickMvp', () => {
  it('no hands, no MVP', () => {
    expect(pickMvp(r, [], [0])).toBeNull();
  });

  it('comes from the winning side: the seat that took the books and made its own bids', () => {
    const h = [hand([4, 3, 2, 4], [6, 3, 2, 2]), hand([5, 3, 2, 3], [6, 4, 1, 2])];
    const m = pickMvp(r, h, [0])!;
    expect(m.seat).toBe(0);
    expect(m.side).toBe(0);
    expect(m.books).toBe(12);
    expect(m.hitBid).toBe(2);
    expect(m.bidHands).toBe(2);
    expect(m.lines[0]).toEqual({ label: 'Books taken', value: '12' });
    expect(m.lines).toContainEqual({ label: 'Made own bid', value: '2 of 2' });
  });

  it('a monster on the losing side is not the MVP', () => {
    const h = [hand([2, 6, 2, 3], [2, 7, 2, 2])];
    expect(pickMvp(r, h, [0])!.side).toBe(0);
  });

  it('nils made count, and lead the stat lines after books', () => {
    const h = [hand([5, 3, 'nil', 3], [4, 4, 0, 5], {}, { 2: true }), hand([5, 3, 'nil', 3], [4, 5, 0, 4], {}, { 2: true })];
    const m = pickMvp(r, h, [0])!;
    expect(m.seat).toBe(2);
    expect(m.nilsMade).toBe(2);
    expect(m.lines[1]).toEqual({ label: 'Nils made', value: '2' });
  });

  it('a busted nil costs; runs and nukes are credited', () => {
    const bust = pickMvp(r, [hand(['nil', 3, 4, 3], [2, 4, 4, 3], {}, { 0: false })], [0])!;
    expect(bust.seat).toBe(2);
    const run = pickMvp(r, [hand([4, 3, 4, 3], [4, 3, 4, 2], { bestRuns: [1, 1, 5, 1], nuke: { seat: 2 } })], [0])!;
    expect(run.seat).toBe(2);
    expect(run.bestRun).toBe(5);
    expect(run.nukes).toBe(1);
    expect(run.lines.length).toBeLessThanOrEqual(3);
  });

  it('is deterministic on a dead tie: the lower seat', () => {
    expect(pickMvp(r, [hand([3, 3, 3, 3], [3, 4, 3, 3])], [0])!.seat).toBe(0);
  });
});
