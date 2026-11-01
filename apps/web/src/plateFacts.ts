/**
 * Opponent plates are drawn inside the canvas (drei Html, its own React root).
 * That root can still be showing the previous hand when the main tree already
 * says who deals. The chip and the bid/took line are corrected here, in the
 * main tree, before the "X deals" note is allowed to paint.
 *
 * OWNERSHIP RULE (the 2026-11-01 removeChild crash): the plates' DOM belongs
 * to a React root, and React deletes the nodes it rendered when they leave
 * its tree. If this module removes or replaces one of those nodes first,
 * that root's deletion walk calls removeChild on a node that is no longer a
 * child and the commit throws ("The object can not be found here." — the
 * field reports fired on every dealer rotation from hand 2 on). So the sync
 * NEVER removes, reparents, or replaces a node it did not create:
 *  - chips it inserts carry data-sync-chip and may be removed freely;
 *  - a stale chip owned by the plate root is HIDDEN (data-sync-stale +
 *    display:none), never removed — the root deletes it on its next commit,
 *    and the sync unhides it if the seat deals again before that commit;
 *  - chip text is written through the existing text node (nodeValue), never
 *    through textContent, which would orphan the root's text node and mute
 *    that root's own later updates.
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

const SYNC_CHIP = 'data-sync-chip';
const SYNC_STALE = 'data-sync-stale';

function isSyncChip(el: Element): boolean {
  return el.getAttribute(SYNC_CHIP) === '1';
}

/** Hide a plate-root-owned chip without moving it in the tree. Returns false
 * when it was already hidden. The owning root still removes it itself when
 * it commits the hand it is lagging on. */
function hideStaleChip(chip: HTMLElement): boolean {
  if (chip.dataset.syncStale === '1' && chip.style.display === 'none') return false;
  chip.dataset.syncStale = '1';
  chip.style.display = 'none';
  return true;
}

/** Undo hideStaleChip when the seat deals again before the owning root has
 * committed the in-between hand (its chip node was never unmounted). */
function unhideChip(chip: HTMLElement): boolean {
  if (chip.dataset.syncStale !== '1') return false;
  delete chip.dataset.syncStale;
  chip.style.display = '';
  return true;
}

/**
 * Write chip text through the chip's existing text node. A textContent write
 * would swap in a fresh text node and orphan the one the owning React root
 * updates (and later deletes with the chip). Chips whose content is not a
 * lone text node are left for their root to repaint.
 */
function writeChipText(chip: HTMLElement, text: string): boolean {
  if (chip.textContent === text) return false;
  const only = chip.childNodes.length === 1 ? chip.firstChild : null;
  if (only && only.nodeType === 3 && only.nodeValue !== text) {
    only.nodeValue = text;
    return true;
  }
  return false;
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
          // One DEALER chip per plate is ever visible. The plate root's own chip is
          // authoritative; a synced chip only stands in until that root
          // paints, and a stale root-owned chip is hidden, never removed
          // (see the ownership rule at the top of this file).
          const chips = [...name.children].filter((el) => el.classList.contains('dealer'));
          const own = chips.filter(isSyncChip);
          const foreign = chips.filter((el) => !isSyncChip(el));
          if (fact.dealer) {
            for (const extra of foreign.slice(1)) if (hideStaleChip(extra as HTMLElement)) wrote = true;
            if (foreign[0]) {
              if (unhideChip(foreign[0] as HTMLElement)) wrote = true;
              for (const o of own) { o.remove(); wrote = true; }
            } else if (own[0]) {
              for (const extra of own.slice(1)) { extra.remove(); wrote = true; }
            } else {
              const span = name.ownerDocument.createElement('span');
              span.className = 'chip dealer';
              span.dataset.testid = `dealer-${fact.seat}`;
              span.setAttribute(SYNC_CHIP, '1');
              span.textContent = 'DEALER';
              const first = childChip(name, (el) => el.classList.contains('chip'));
              if (first) name.insertBefore(span, first);
              else name.appendChild(span);
              wrote = true;
            }
            const visible = (foreign[0] ?? own[0]) as HTMLElement | undefined;
            if (visible && writeChipText(visible, 'DEALER')) wrote = true;
          } else {
            for (const o of own) { o.remove(); wrote = true; }
            for (const f of foreign) if (hideStaleChip(f as HTMLElement)) wrote = true;
          }
        }
      }
      const stats = plate.querySelector('.plate-stats');
      if (!stats) return;
      const chips = [...stats.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('chip') && !el.classList.contains('bad'));
      if (chips[0] && writeChipText(chips[0], fact.bid)) wrote = true;
      if (chips[1] && writeChipText(chips[1], fact.took)) wrote = true;
    });
  }
  return wrote;
}

/** The only VISIBLE DEALER chip sits on this seat. A stale chip the sync hid
 * (still owned by a lagging plate root) does not count. A missing plate is
 * not a match. */
export function dealerChipMatches(screen: ParentNode, dealerSeat: number): boolean {
  const chips = [...screen.querySelectorAll('.chip.dealer')].filter(
    (el) => !(el instanceof HTMLElement) || el.dataset.syncStale !== '1',
  );
  if (chips.length !== 1) return false;
  return chips[0]?.closest('.plate')?.getAttribute('data-testid') === `seat-${dealerSeat}`;
}

/**
 * Restart the TOOK pop on every copy of a seat's plate (the plate layer and
 * the canvas copy share the testid). The pop itself is pure CSS
 * (`.plate.took-pop`, appended in styles.css); removing the class and
 * forcing a reflow restarts it when books land back-to-back. A per-pop
 * token keeps an older pop's cleanup timer from ending a newer pop early.
 * Returns false when no plate for the seat is on screen.
 */
export function popPlateTook(screen: ParentNode, seat: number): boolean {
  let popped = false;
  const token = `${Date.now()}:${seat}`;
  screen.querySelectorAll(`[data-testid="seat-${seat}"]`).forEach((plate) => {
    if (!(plate instanceof HTMLElement)) return;
    plate.classList.remove('took-pop');
    void plate.offsetWidth; // restart the animation, don't resume it
    plate.dataset.tookPop = token;
    plate.classList.add('took-pop');
    popped = true;
    plate.ownerDocument.defaultView?.setTimeout(() => {
      if (plate.dataset.tookPop === token) {
        plate.classList.remove('took-pop');
        delete plate.dataset.tookPop;
      }
    }, 400);
  });
  return popped;
}
