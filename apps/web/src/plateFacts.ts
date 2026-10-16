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
      // One DEALER chip per plate (bots and you). React's own chip and a synced one could both survive a re-render.
      const nameEl = plate.querySelector('.plate-name');
      if (nameEl) for (const d of [...nameEl.children].filter((el) => el.classList.contains('dealer')).slice(1)) { d.remove(); wrote = true; }
      if (inLayer) {
        const name = plate.querySelector('.plate-name');
        if (name) {
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
