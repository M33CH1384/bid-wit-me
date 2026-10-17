/**
 * Opponent plates are drawn inside the canvas (drei Html, its own React root).
 * That root can still be showing the previous hand when the main tree already
 * says who deals. The chip and the bid/took line are corrected here, in the
 * main tree, before the "X deals" note is allowed to paint.
 */
import { type Bid, bidLabel } from '@spades/rules';

export function bidChipText(bid: Bid | null, bidding: boolean): string {
  if (bid === 'books') return 'BOOKS';
  if (bid === null) return bidding ? 'BID …' : 'BID —';
  return `BID ${bidLabel(bid).toUpperCase()}`;
}

export function tookChipText(tricks: number): string {
  return `TOOK ${tricks}`;
}

/** Each new hand starts clean: while the table is still bidding, no books have
 * been taken yet, so TOOK reads 0 even if a stale count leaks through. */
export function plateTookText(tricks: number, phase: string): string {
  return phase === 'bidding' ? 'TOOK 0' : tookChipText(tricks);
}

export interface SeatFact {
  seat: number;
  bid: string;
  took: string;
  dealer: boolean;
}

function childChip(parent: Element, match: (el: Element) => boolean): HTMLElement | null {
  for (const child of parent.children) {
    if (child instanceof HTMLElement && match(child)) return child;
  }
  return null;
}

/**
 * Write the current hand onto plates. Dealer chips are only moved inside
 * `.badge-layer` — the viewer's plate is rendered by this same commit.
 * Returns false when nothing was written (so a DOM observer can stop).
 */
export function syncPlateFacts(screen: ParentNode, facts: readonly SeatFact[]): boolean {
  const layer = screen.querySelector('.badge-layer');
  let wrote = false;
  for (const fact of facts) {
    const plates = screen.querySelectorAll(`[data-testid="seat-${fact.seat}"]`);
    plates.forEach((plate) => {
      const inLayer = !!layer && layer.contains(plate);
      if (inLayer) {
        const name = plate.querySelector('.plate-name');
        if (name) {
          // One DEALER chip per plate. React's own chip and a synced one could both survive a re-render.
          const dupes = [...name.children].filter((el) => el.classList.contains('dealer')).slice(1);
          for (const d of dupes) { d.remove(); wrote = true; }
          const chip = childChip(name, (el) => el.classList.contains('dealer'));
          if (fact.dealer) {
            if (!chip) {
              const span = name.ownerDocument.createElement('span');
              span.className = 'chip dealer';
              span.dataset.testid = `dealer-${fact.seat}`;
              span.textContent = 'DEALER';
              const first = childChip(name, (el) => el.classList.contains('chip'));
              if (first) name.insertBefore(span, first);
              else name.appendChild(span);
              wrote = true;
            } else if (chip.textContent !== 'DEALER') {
              chip.textContent = 'DEALER';
              wrote = true;
            }
          } else if (chip) {
            chip.remove();
            wrote = true;
          }
        }
      }
      const stats = plate.querySelector('.plate-stats');
      if (!stats) return;
      const chips = [...stats.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('chip') && !el.classList.contains('bad'));
      if (chips[0] && chips[0].textContent !== fact.bid) {
        chips[0].textContent = fact.bid;
        wrote = true;
      }
      if (chips[1] && chips[1].textContent !== fact.took) {
        chips[1].textContent = fact.took;
        wrote = true;
      }
    });
  }
  return wrote;
}

/** The only DEALER chip sits on this seat. A missing plate is not a match. */
export function dealerChipMatches(screen: ParentNode, dealerSeat: number): boolean {
  const chips = [...screen.querySelectorAll('.chip.dealer')];
  if (chips.length !== 1) return false;
  return chips[0]?.closest('.plate')?.getAttribute('data-testid') === `seat-${dealerSeat}`;
}
