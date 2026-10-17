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

/** Seconds from the start of the shuffle until this card leaves the deck.
 *  Cards go clockwise, one per seat, starting on the dealer's left. `slot` is that seat's nth card. */
export function seatDealDelay(tl: DealTimeline, players: number, slot: number, seat: number, dealer: number, live?: readonly number[]): number {
  const n = Math.max(1, players);
  // After a Cutthroat ejection the deck goes around the LIVE seats only. Scheduling against all
  // `players` seats pushed the last cards of every live seat past the end of the deal clock
  // (slot*4 instead of slot*3), so on first load those cards were still waiting to leave the
  // deck when the deal was declared over. With `live` given, rank seats clockwise from the
  // dealer's left among live seats only, matching how the cards are actually dealt.
  if (live && live.length > 0 && live.length < n) {
    const ordered: number[] = [];
    for (let k = 1; k <= n; k++) { const s = (dealer + k) % n; if (live.includes(s)) ordered.push(s); }
    const idx = ordered.indexOf(seat);
    if (idx >= 0) return tl.shuffle + (slot * ordered.length + idx) * tl.step;
  }
  const order = slot * n + ((seat - dealer - 1 + n) % n);
  return tl.shuffle + order * tl.step;
}

/** How many of this seat's cards have left the deck by `elapsed` seconds. Slots are dealt in order. */
export function dealtSlotCount(elapsed: number, tl: DealTimeline, players: number, seat: number, dealer: number, slots: number, live?: readonly number[]): number {
  let count = 0;
  for (let slot = 0; slot < slots; slot++) {
    if (elapsed < seatDealDelay(tl, players, slot, seat, dealer, live)) break;
    count++;
  }
  return count;
}
