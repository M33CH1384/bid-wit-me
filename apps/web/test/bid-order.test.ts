import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { bidOrder, makeRules, newGame } from '@spades/rules';
import { BidOrder, showCenterBidOrder } from '../src/PartnerTalk';

const names = ['You', 'Leilani', 'Queenie', 'Elena'];

describe('bid order display', () => {
  it('stays up for the whole auction, including the hand you bid first', () => {
    expect(showCenterBidOrder('bidding', false, false)).toBe(true);
    expect(showCenterBidOrder('bidding', true, false)).toBe(false);
    expect(showCenterBidOrder('bidding', false, true)).toBe(false);
    expect(showCenterBidOrder('playing', false, false)).toBe(false);
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain('showCenterBidOrder(st.phase, pause, dealing)');
    expect(table).not.toContain('st.turn !== HUMAN && <BidOrder');
  });

  it('lists every player, in bid order, for every dealer', () => {
    const rules = makeRules('joker', { firstHandBidsItself: false });
    for (let dealer = 0; dealer < 4; dealer++) {
      const st = newGame(rules, `bid-order-${dealer}`, { dealer });
      expect(st.phase).toBe('bidding');
      expect(st.dealer).toBe(dealer);
      const html = renderToStaticMarkup(createElement(BidOrder, { st, names, me: 0 }));
      const order = bidOrder(st.rules, dealer);
      expect(html.match(/data-testid="bid-order-/g)).toHaveLength(4);
      let at = -1;
      for (const seat of order) {
        const who = seat === 0 ? 'You' : names[seat]!;
        const i = html.indexOf(`>${who}<`);
        expect(i, `${who} missing when dealer is ${dealer}`).toBeGreaterThan(at);
        at = i;
      }
      expect(html).toContain('Dealer bids last');
    }
  });

  it('does not relabel the bottom seat as You for a spectator', () => {
    const rules = makeRules('joker', { firstHandBidsItself: false });
    const st = newGame(rules, 'bid-order-spec', { dealer: 0 });
    const html = renderToStaticMarkup(createElement(BidOrder, { st, names: ['Ava', 'Lamar', 'Mei', 'Jules'], me: -1 }));
    expect(html).toContain('>Ava<');
    expect(html).not.toContain('>You<');
    expect(html).toContain('Dealer bids last');
  });

  it('names a seat when the roster has a hole', () => {
    const rules = makeRules('joker', { firstHandBidsItself: false });
    const st = newGame(rules, 'bid-order-hole', { dealer: 1 });
    const html = renderToStaticMarkup(createElement(BidOrder, { st, names: ['You', 'Leilani', '', 'Elena'], me: 0 }));
    expect(html).toContain('>Seat 3<');
    expect(html).toContain('>Leilani<');
    expect(html).toContain('>Elena<');
    expect(html).toContain('>You<');
  });

  it('wraps inside the viewport instead of clipping a name off a pill', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const rule = css.slice(css.indexOf('.bid-order {'), css.indexOf('.bid-panel .bid-order'));
    expect(rule).toContain('flex-wrap: wrap');
    expect(rule).toContain('min-width: 0');
    expect(rule).toContain('overflow: visible');
    expect(rule).toContain('border-radius: 12px');
    expect(rule).not.toContain('999px');
    expect(css).toContain('.bo-seat { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; opacity: .75; flex: 0 0 auto; min-width: min-content; }');
    expect(css).toContain('.center-note-wrap > .bid-order { position: static;');
  });
});
