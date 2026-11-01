/**
 * @vitest-environment happy-dom
 *
 * The deals popup is not allowed to paint while a canvas plate still wears
 * the previous dealer or the previous hand's bid and books.
 *
 * The canvas plates belong to their own React root: the sync may hide a
 * stale dealer chip and stand in with one of its own, but it must never
 * remove or replace a node that root rendered — doing so made that root's
 * next commit throw NotFoundError in removeChild on every dealer rotation
 * (field crash "The object can not be found here.", 2026-11-01).
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { bidChipText, dealerChipMatches, syncPlateFacts, tookChipText, type SeatFact } from '../src/plateFacts';

function screen(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'table-screen';
  root.innerHTML = `
    <div class="badge-layer">
      <div class="plate" data-testid="seat-1">
        <div class="plate-name">Unc<span class="chip dealer" data-testid="dealer-1">DEALER</span><span class="chip ally">PARTNER</span></div>
        <div class="plate-stats"><span class="chip">BID 4</span><span class="chip">TOOK 3</span></div>
      </div>
      <div class="plate" data-testid="seat-3">
        <div class="plate-name">Kai<span class="chip notice">ON NOTICE</span></div>
        <div class="plate-stats"><span class="chip">BID 2</span><span class="chip">TOOK 5</span></div>
      </div>
    </div>
    <div class="plate me-plate" data-testid="seat-0">
      <div class="plate-name">YOU</div>
      <div class="plate-stats"><span class="chip">BID 3</span><span class="chip">TOOK 2</span><span class="chip bad">NIL BUSTED</span></div>
    </div>
  `;
  document.body.appendChild(root);
  return root;
}

/** Dealer chips a player could actually see (a sync-hidden stale chip is not one). */
function visibleDealerChips(root: ParentNode): Element[] {
  return [...root.querySelectorAll('.chip.dealer')].filter(
    (el) => !(el instanceof HTMLElement) || (el.dataset.syncStale !== '1' && el.style.display !== 'none'),
  );
}

describe('plate facts on a new hand', () => {
  it('names a fresh bid the way the plate does', () => {
    expect(bidChipText(null, false)).toBe('BID —');
    expect(bidChipText(null, true)).toBe('BID …');
    expect(bidChipText('books', false)).toBe('BOOKS');
    expect(bidChipText('nil', false)).toBe('BID NIL');
    expect(tookChipText(0)).toBe('TOOK 0');
  });

  it('moves the dealer chip and clears the previous hand before anything else reads the plates', () => {
    const root = screen();
    const facts = [
      { seat: 0, bid: bidChipText(null, false), took: tookChipText(0), dealer: false },
      { seat: 1, bid: bidChipText(null, false), took: tookChipText(0), dealer: false },
      { seat: 3, bid: bidChipText(null, true), took: tookChipText(0), dealer: true },
    ];
    expect(syncPlateFacts(root, facts)).toBe(true);
    expect(dealerChipMatches(root, 3)).toBe(true);
    // The previous dealer's chip is NOT removed (its plate root owns it and
    // removes it on its next commit) — it is hidden so it cannot be read as
    // a second dealer in the meantime.
    const stale = root.querySelector('[data-testid="dealer-1"]') as HTMLElement;
    expect(stale).toBeTruthy();
    expect(stale.dataset.syncStale).toBe('1');
    expect(stale.style.display).toBe('none');
    expect(root.querySelector('[data-testid="seat-3"] .chip.dealer')?.textContent).toBe('DEALER');
    expect(root.querySelector('[data-testid="seat-3"] .chip.dealer')?.getAttribute('data-sync-chip')).toBe('1');
    // Partner and notice chips stay, and the dealer chip leads them.
    const kai = root.querySelector('[data-testid="seat-3"] .plate-name');
    expect(kai?.querySelector('.chip.notice')).toBeTruthy();
    expect(kai?.querySelector('.chip')?.classList.contains('dealer')).toBe(true);
    expect(root.querySelector('[data-testid="seat-1"] .chip.ally')).toBeTruthy();
    for (const seat of [0, 1, 3]) {
      const chips = root.querySelectorAll(`[data-testid="seat-${seat}"] .plate-stats .chip:not(.bad)`);
      expect(chips[0]?.textContent).toBe(seat === 3 ? 'BID …' : 'BID —');
      expect(chips[1]?.textContent).toBe('TOOK 0');
    }
    expect(root.querySelector('[data-testid="seat-0"] .chip.bad')?.textContent).toBe('NIL BUSTED');
    // A second pass, and a pass that puts the viewer back in the dealer seat, does not stack chips.
    expect(syncPlateFacts(root, facts)).toBe(false);
    const yours = facts.map((f) => (f.seat === 0 ? { ...f, dealer: true } : { ...f, dealer: false, bid: 'BID —' }));
    root.querySelector('[data-testid="seat-0"] .plate-name')!.insertAdjacentHTML('beforeend', '<span class="chip dealer" data-testid="dealer-0">DEALER</span>');
    syncPlateFacts(root, yours);
    expect(dealerChipMatches(root, 0)).toBe(true);
    expect(visibleDealerChips(root)).toHaveLength(1);
    root.remove();
  });
});

describe('one VISIBLE DEALER chip per plate', () => {
  it('hides a second DEALER chip on a canvas plate instead of removing it', () => {
    const root = screen();
    root.querySelector('[data-testid="seat-1"] .plate-name')!.insertAdjacentHTML('beforeend', '<span class="chip dealer">DEALER</span>');
    syncPlateFacts(root, [0, 1, 2, 3].map((seat) => ({ seat, dealer: seat === 1, bid: 'BID 3', took: 'TOOK 0' })) as never);
    // Both chips stay in the DOM (their owner removes its own); only one shows.
    expect(root.querySelectorAll('[data-testid="seat-1"] .chip.dealer').length).toBe(2);
    expect(visibleDealerChips(root.querySelector('[data-testid="seat-1"]')!)).toHaveLength(1);
    expect(dealerChipMatches(root, 1)).toBe(true);
    root.remove();
  });

  it('leaves your own plate structurally untouched — its root renders in the same commit', () => {
    const root = screen();
    root.querySelector('[data-testid="seat-0"] .plate-name')!.insertAdjacentHTML('beforeend', '<span class="chip dealer">DEALER</span><span class="chip dealer">DEALER</span>');
    syncPlateFacts(root, [0, 1, 2, 3].map((seat) => ({ seat, dealer: seat === 1, bid: 'BID 3', took: 'TOOK 0' })) as never);
    // No removal and no hiding outside the badge layer: the main root owns
    // this plate outright and never lags it.
    const mine = [...root.querySelectorAll('[data-testid="seat-0"] .chip.dealer')] as HTMLElement[];
    expect(mine).toHaveLength(2);
    expect(mine.every((c) => c.dataset.syncStale !== '1')).toBe(true);
    root.remove();
  });
});

/* ------------------------------------------------------------------ */
/* Regression: the sync against plates a REAL React root owns. The plate
 * below mirrors Table.tsx renderSeat (dealer chip conditional, plate-stats
 * keyed by hand). The canvas root commits a beat AFTER the main tree has
 * already corrected the plates from the new hand's facts.               */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Plate(seat: number, name: string, dealer: boolean, bid: string, handNo: number) {
  return createElement(
    'div',
    { className: 'plate foe', 'data-testid': `seat-${seat}`, key: `p${seat}` },
    createElement(
      'div',
      { className: 'plate-body' },
      createElement(
        'div',
        { className: 'plate-name' },
        name,
        dealer ? createElement('span', { className: 'chip dealer', 'data-testid': `dealer-${seat}` }, 'DEALER') : null,
        seat === 1 ? createElement('span', { className: 'chip ally' }, 'PARTNER') : null,
      ),
      createElement(
        'div',
        { className: 'plate-stats', key: handNo },
        createElement('span', { className: 'chip', 'data-testid': `bid-${seat}` }, bid),
        createElement('span', { className: 'chip took', 'data-testid': `books-${seat}` }, 'TOOK 0'),
      ),
    ),
  );
}

function stageCanvasPlates(): { screen: HTMLElement; root: Root } {
  document.body.innerHTML = '';
  const screen = document.createElement('div');
  screen.className = 'table-screen';
  const layer = document.createElement('div');
  layer.className = 'badge-layer';
  screen.appendChild(layer);
  document.body.appendChild(screen);
  const host = document.createElement('div');
  layer.appendChild(host);
  return { screen, root: createRoot(host) };
}

function renderHand(root: Root, dealerSeat: number, handNo: number, bids: Record<number, string> = {}) {
  act(() => {
    root.render(
      createElement('div', null,
        Plate(1, 'Unc', dealerSeat === 1, bids[1] ?? 'BID —', handNo),
        Plate(2, 'Kai', dealerSeat === 2, bids[2] ?? 'BID —', handNo),
        Plate(3, 'Zed', dealerSeat === 3, bids[3] ?? 'BID —', handNo)),
    );
  });
}

function handFacts(dealerSeat: number, bids: Record<number, string> = {}): SeatFact[] {
  return [1, 2, 3].map((seat) => ({ seat, bid: bids[seat] ?? 'BID —', took: 'TOOK 0', dealer: dealerSeat === seat }));
}

describe('sync against React-owned canvas plates (removeChild regression)', () => {
  it('dealer rotation with a lagging plate root: no throw, one visible chip throughout', () => {
    const { screen, root } = stageCanvasPlates();
    renderHand(root, 1, 1);
    // Main tree is on hand 2 already; the plate root still shows hand 1.
    syncPlateFacts(screen, handFacts(2));
    // Before the plate root commits: the stand-in chip shows on seat 2 and
    // the stale chip on seat 1 is hidden — exactly one visible dealer.
    expect(visibleDealerChips(screen)).toHaveLength(1);
    expect(dealerChipMatches(screen, 2)).toBe(true);
    expect(screen.querySelector('[data-testid="seat-2"] .chip.dealer')?.getAttribute('data-sync-chip')).toBe('1');
    // The plate root commits hand 2: it deletes its own seat-1 chip itself.
    expect(() => renderHand(root, 2, 2)).not.toThrow();
    // The observer pass that follows any plate mutation retires the stand-in
    // now that the root's own chip has painted.
    syncPlateFacts(screen, handFacts(2));
    expect(visibleDealerChips(screen)).toHaveLength(1);
    expect(dealerChipMatches(screen, 2)).toBe(true);
    expect(screen.querySelector('[data-testid="seat-2"] .chip.dealer')?.getAttribute('data-sync-chip')).toBeNull();
    expect(screen.querySelector('[data-testid="dealer-1"]')).toBeNull();
    // And the next rotation stays clean too (the trap does not re-arm).
    syncPlateFacts(screen, handFacts(3));
    expect(() => renderHand(root, 3, 3)).not.toThrow();
    syncPlateFacts(screen, handFacts(3));
    expect(dealerChipMatches(screen, 3)).toBe(true);
    expect(() => act(() => root.unmount())).not.toThrow();
    document.body.innerHTML = '';
  });

  it('bid text is corrected through the text node, so the plate root’s own update still lands', () => {
    const { screen, root } = stageCanvasPlates();
    renderHand(root, 1, 1, { 1: 'BID …' });
    syncPlateFacts(screen, handFacts(1, { 1: 'BID 4' }));
    expect(screen.querySelector('[data-testid="bid-1"]')?.textContent).toBe('BID 4');
    // The root catches up with a NEWER value of its own: pre-fix the sync's
    // textContent write had orphaned the root's text node and this render
    // silently changed nothing on screen.
    renderHand(root, 1, 1, { 1: 'BID 5' });
    expect(screen.querySelector('[data-testid="bid-1"]')?.textContent).toBe('BID 5');
    // Hand 2 remounts plate-stats (key={handNo}): the old subtree deletes clean.
    syncPlateFacts(screen, handFacts(2));
    expect(() => renderHand(root, 2, 2)).not.toThrow();
    expect(() => act(() => root.unmount())).not.toThrow();
    document.body.innerHTML = '';
  });
});
