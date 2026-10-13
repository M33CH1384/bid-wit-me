import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applyAction, bidOptions, hostMinimum, makeRules } from '@spades/rules';
import { fill, rigged } from '../../../packages/rules/test/helpers';
import { MinBidLine, bidChoices, minBidNote } from '../src/minBid';

describe('hand 4 bid picker under default Minimum 4', () => {
  const rules = makeRules('joker'); // default: Minimum 4, partnerships, books bid themselves on hand 1

  it('is the house minimum combined with the partner bid, not a hand-number bug', () => {
    expect(hostMinimum(rules)).toBe(4);
    // Hand 4 is an ordinary bidding hand. The first partner can still bid 1; the buttons start at 1.
    let st = rigged(rules, fill(rules, [[], [], [], []]), 3);
    st = { ...st, handNo: 4 };
    expect(st.handNo).toBe(4);
    expect(st.turn).toBe(0);
    const first = bidOptions(st, 0);
    expect(first.min).toBe(1);
    expect(bidChoices(first.min, first.max)[0]).toBe(1);
    expect(minBidNote(first, rules, null)).toBeNull();

    // Partner bid 1. The other seat's buttons start at 3 because 1 + 3 = the team minimum of 4.
    st = applyAction(st, { type: 'bid', seat: 0, bid: 1 });
    const cover = bidOptions(st, 2);
    expect(cover.min).toBe(3);
    expect(bidChoices(cover.min, cover.max)[0]).toBe(3);
    expect(bidChoices(cover.min, cover.max)).not.toContain(1);
    expect(bidChoices(cover.min, cover.max)).not.toContain(2);
    expect(() => applyAction(st, { type: 'bid', seat: 2, bid: 2 })).toThrow(/Minimum is 4/);
    expect(applyAction(st, { type: 'bid', seat: 2, bid: 3 }).bids[2]).toBe(3);

    const note = minBidNote(cover, rules, 1);
    expect(note).toEqual({
      label: 'Min bid 3 · house rule',
      reason: 'Partner bid 1 — your team needs 4, so Nil is off',
    });
    const html = renderToStaticMarkup(createElement(MinBidLine, { note: note! }));
    expect(html).toContain('data-testid="bid-min"');
    expect(html).toContain('Min bid 3 · house rule');
    expect(html).toContain('Partner bid 1 — your team needs 4, so Nil is off');
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain('<MinBidLine note={raisedMin} />');
    expect(table).toContain('bidChoices(view.bidOptions.min, view.bidOptions.max)');
  });

  it('explains a Nil partner and a Cutthroat floor, and stays quiet when 1 is legal', () => {
    const nil = minBidNote({ min: 4, nil: false }, rules, 'nil');
    expect(nil).toEqual({ label: 'Min bid 4 · house rule', reason: 'Partner bid Nil — you need 4' });
    const blind = minBidNote({ min: 4, nil: false }, rules, 'blindNil');
    expect(blind?.reason).toContain('Blind Nil');
    const cut = makeRules('cutthroat', { playerCount: 4, minTeamBid: 4, firstHandBidsItself: false });
    expect(minBidNote({ min: 4, nil: false }, cut, null)).toEqual({
      label: 'Min bid 4 · house rule',
      reason: 'Each bid has to reach 4',
    });
    expect(minBidNote({ min: 1, nil: true }, rules, 5)).toBeNull();
    expect(bidChoices(1, 3)).toEqual([1, 2, 3]);
    expect(bidChoices(3, 2)).toEqual([]);
  });
});
