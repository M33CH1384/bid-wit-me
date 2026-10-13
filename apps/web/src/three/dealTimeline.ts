/** Shuffle + deal timing (seconds), scaled by game speed. Shared by the 3D scene and the bots' wait. */
export interface DealTimeline { shuffle: number; step: number; fly: number; dealSpan: number; total: number }

export function dealTimeline(k: number, players: number, cards = 52): DealTimeline {
  const kk = Math.max(0.2, Math.min(1.5, k));
  const shuffle = 0.95 * kk;
  const step = 0.028 * kk; // between consecutive dealt cards
  const fly = Math.max(0.12, 0.38 * kk);
  const dealSpan = step * Math.max(0, cards - 1);
  return { shuffle, step, fly, dealSpan, total: shuffle + dealSpan + fly };
}

/** Clockwise deal index, starting on the dealer's left. `slot` is that seat's nth card. */
export function dealOrder(players: number, slot: number, seat: number, dealer: number): number {
  const n = Math.max(1, players);
  return slot * n + ((seat - dealer - 1 + n) % n);
}

/** Seconds from the start of the shuffle until this card leaves the deck. */
export function seatDealDelay(tl: DealTimeline, players: number, slot: number, seat: number, dealer: number): number {
  return tl.shuffle + dealOrder(players, slot, seat, dealer) * tl.step;
}

/** How many of this seat's cards have left the deck by `elapsed` seconds. Slots are dealt in order. */
export function dealtSlotCount(elapsed: number, tl: DealTimeline, players: number, seat: number, dealer: number, slots: number): number {
  let count = 0;
  for (let slot = 0; slot < slots; slot++) {
    if (elapsed < seatDealDelay(tl, players, slot, seat, dealer)) break;
    count++;
  }
  return count;
}
