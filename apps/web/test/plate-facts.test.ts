/**
 * @vitest-environment happy-dom
 *
 * The deals popup is not allowed to paint while a canvas plate still wears
 * the previous dealer or the previous hand's bid and books.
 */
import { describe, expect, it } from 'vitest';
import { bidChipText, dealerChipMatches, syncPlateFacts, tookChipText } from '../src/plateFacts';

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
    expect(root.querySelector('[data-testid="dealer-1"]')).toBeNull();
    expect(root.querySelector('[data-testid="seat-3"] .chip.dealer')?.textContent).toBe('DEALER');
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
    expect(root.querySelectorAll('.chip.dealer')).toHaveLength(1);
    root.remove();
  });
});

describe('one DEALER chip per plate', () => {
  it('drops a second DEALER chip on a bot plate and on your plate', () => {
    const root = screen();
    root.querySelector('[data-testid="seat-1"] .plate-name')!.insertAdjacentHTML('beforeend', '<span class="chip dealer">DEALER</span>');
    root.querySelector('[data-testid="seat-0"] .plate-name')!.insertAdjacentHTML('beforeend', '<span class="chip dealer">DEALER</span><span class="chip dealer">DEALER</span>');
    syncPlateFacts(root, [0, 1, 2, 3].map((seat) => ({ seat, dealer: seat === 1, bid: 'BID 3', took: 'TOOK 0' })) as never);
    expect(root.querySelectorAll('[data-testid="seat-1"] .chip.dealer').length).toBe(1);
    expect(root.querySelectorAll('[data-testid="seat-0"] .chip.dealer').length).toBeLessThanOrEqual(1);
    root.remove();
  });
});
