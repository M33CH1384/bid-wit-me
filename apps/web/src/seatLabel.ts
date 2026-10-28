/**
 * What the table calls a local seat.
 * A seated viewer is "You" at seat 0. A spectator sees whoever is sitting there — a person or a bot — and never "You".
 */
export function seatFacingName(names: readonly string[], seat: number, spectating: boolean): string {
  const raw = (names[seat] ?? '').trim();
  if (spectating) {
    if (raw && raw.toLowerCase() !== 'you') return raw;
    return `Seat ${seat + 1}`;
  }
  if (seat === 0) return 'You';
  return raw || `Seat ${seat + 1}`;
}

/** Avatar letter for that label (Y only when the viewer is actually in the seat). */
export function seatInitial(name: string): string {
  return name.trim().charAt(0) || '?';
}

export function trickTakenLine(name: string): string {
  return name === 'You' ? 'YOU TAKE IT' : `${name.toUpperCase()} TAKES IT`;
}

/** Center bidding line. "Your partner" is only for the person sitting across from them. */
export function biddingNote(name: string, opts: { partnerships: boolean; partnerTurn: boolean; spectating: boolean }): string {
  if (!opts.spectating && opts.partnerships && opts.partnerTurn) return `Your partner ${name} is bidding…`;
  return `${name} is bidding…`;
}

export function noticeTip(spectating: boolean): string {
  return spectating
    ? "Got shot last hand: one more shot and they're out"
    : "Got shot last hand: one more shot and you're out";
}

/** The sticky second notice (owner, 2026-10-28): shot twice this game, so the notice never clears. */
export function noticeStickyTip(spectating: boolean): string {
  return spectating
    ? "On notice for good — shot twice this game: one more shot and they're out, and making a hand won't clear it"
    : "On notice for good — shot twice this game: one more shot and you're out, and making a hand won't clear it";
}
