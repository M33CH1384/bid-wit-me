import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { bidOrder, makeRules, newGame, type GameState } from '@spades/rules';
import { BidSummary, bidSummaryEntries } from '../src/PartnerTalk';

const names = ['You', 'Leilani', 'Queenie', 'Elena'];

function biddingState(mode: 'joker' | 'cutthroat' = 'joker'): GameState {
  const rules = makeRules(mode, { firstHandBidsItself: false });
  const st = newGame(rules, `bid-summary-${mode}`, { dealer: 0 });
  // dealer 0 => human bids last in team order [1,3,2,0]; everyone else has bid, partner (seat 2) bid 5
  return { ...st, phase: 'bidding', turn: 0, bids: [null, 4, 5, 3] };
}

describe('bid summary at the moment of decision', () => {
  it('lists every seat in bidding order from the same st.bids the plates read', () => {
    const st = biddingState();
    const entries = bidSummaryEntries(st, names, 0);
    expect(entries.map((e) => e.seat)).toEqual(bidOrder(st.rules, st.dealer));
    expect(entries.map((e) => e.bidText)).toEqual(['4', '3', '5', '…']);
  });
  it('partner (seat across) is flagged and rendered largest/gold via the partner class', () => {
    const st = biddingState();
    const entries = bidSummaryEntries(st, names, 0);
    const partner = entries.find((e) => e.isPartner)!;
    expect(partner.seat).toBe(2);
    expect(partner.who).toBe('Queenie');
    expect(partner.bidText).toBe('5');
    const html = renderToStaticMarkup(createElement(BidSummary, { st, names, me: 0 }));
    expect(html).toContain('bid-summary');
    expect(html).toContain('bs-seat partner');
    expect(html).toContain('★ PARTNER · Queenie');
    expect(html).toContain('aria-label="Partner Queenie: bid 5"');
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const partnerRule = css.slice(css.indexOf('.bs-seat.partner {'), css.indexOf('.bs-seat.partner small'));
    expect(partnerRule).toContain('linear-gradient');
    expect(css).toContain('.bs-seat.partner b { font-size: 24px;');
    expect(css).toContain('.bs-seat b { font-size: 17px;');
  });
  it('a partner who has not bid yet still shows, highlighted, as pending', () => {
    const st = { ...biddingState(), bids: [null, 4, null, 3] as GameState['bids'] };
    const partner = bidSummaryEntries(st, names, 0).find((e) => e.isPartner)!;
    expect(partner.hasBid).toBe(false);
    expect(partner.bidText).toBe('—');
    const html = renderToStaticMarkup(createElement(BidSummary, { st, names, me: 0 }));
    expect(html).toContain('Partner Queenie: has not bid yet');
  });
  it('cutthroat: all bids shown, nobody highlighted as partner', () => {
    const st = biddingState('cutthroat');
    const entries = bidSummaryEntries(st, names, 0);
    expect(entries).toHaveLength(st.rules.playerCount);
    expect(entries.some((e) => e.isPartner)).toBe(false);
    const html = renderToStaticMarkup(createElement(BidSummary, { st, names, me: 0 }));
    expect(html).not.toContain('PARTNER');
    expect(html).not.toContain('bs-seat partner');
  });

  it('bot partner who has not bid yet shows its intended bid as "thinks N", only for the partner seat', () => {
    const st = { ...biddingState(), bids: [null, 4, null, 3] as GameState['bids'] };
    const entries = bidSummaryEntries(st, names, 0, 7);
    const partner = entries.find((e) => e.isPartner)!;
    expect(partner.partnerEstimate).toBe(7);
    expect(partner.bidText).toBe('7');
    expect(entries.filter((e) => e.partnerEstimate !== null)).toHaveLength(1);
    const html = renderToStaticMarkup(createElement(BidSummary, { st, names, me: 0, partnerEstimate: 7 }));
    expect(html).toContain('THINKS');
    expect(html).toContain('thinks 7, has not bid yet');
    // no estimate passed (human partner / online): pending partner stays a plain dash
    const plain = bidSummaryEntries(st, names, 0).find((e) => e.isPartner)!;
    expect(plain.partnerEstimate).toBeNull();
    expect(plain.bidText).toBe('—');
    // once the partner has actually bid, the real bid replaces any estimate
    const bid = bidSummaryEntries(biddingState(), names, 0, 7).find((e) => e.isPartner)!;
    expect(bid.partnerEstimate).toBeNull();
    expect(bid.bidText).toBe('5');
  });

  it('lives inside the bid panel (both bid decisions), not as a new fixed overlay', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table.match(/<BidSummary /g)).toHaveLength(2);
    expect(table).toContain('partnerEstimate={partnerEstimate}');
    // the panel title no longer carries the old tiny partner text
    expect(table).not.toContain('partner bids right after you');
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const rule = css.slice(css.indexOf('.bid-summary {'), css.indexOf('.bs-title'));
    expect(rule).not.toContain('position: fixed');
    expect(rule).not.toContain('position: absolute');
  });
  it('renders nothing outside bidding', () => {
    const st = { ...biddingState(), phase: 'playing' as const };
    expect(renderToStaticMarkup(createElement(BidSummary, { st, names, me: 0 }))).toBe('');
    expect(bidSummaryEntries(st, names, 0).length).toBeGreaterThan(0); // helper itself is phase-agnostic; the component gates
  });
});
