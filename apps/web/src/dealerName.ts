/**
 * Who is dealing this hand.
 *
 * The engine's dealer is a server seat on the current hand (`GameState.dealer` / `PlayerView.dealer`).
 * The table then rotates so the viewer sits at the bottom, and a seat's occupant can change (someone sits,
 * or a bot takes over) without that seat index changing. Naming the dealer from a frozen chat line, or by
 * treating local seat 0 as "You", or by using the server seat as an index into the rotated name list,
 * shows the wrong person. This reads the current dealer seat and the current occupant, then applies the
 * same name the seat plate uses.
 */

export interface SeatOccupant {
  name: string;
  kind: 'human' | 'bot' | 'empty';
}

export interface DealerIdentity {
  /** Dealer seat in server / engine order. */
  serverSeat: number;
  /** Dealer seat after the table rotates the viewer to the bottom. Spectators stay anchored at server seat 0. */
  localSeat: number;
  /** Plate name: "You" only when the viewer is sitting in the dealer seat. */
  name: string;
  /** "You deal" or "Name deals". */
  phrase: string;
}

function mod(x: number, n: number): number {
  return ((x % n) + n) % n;
}

/** Name a seat plate would show for this occupant. Empty seats use the server seat number ("Seat 3"). */
export function occupantName(occ: SeatOccupant | undefined, serverSeat: number): string {
  const raw = occ?.name?.trim() ?? '';
  if (!occ || occ.kind === 'empty' || !raw) return `Seat ${serverSeat + 1}`;
  return raw;
}

/**
 * Current hand's dealer, from server/engine truth.
 * `viewerSeat` is null while spectating (the view is anchored at server seat 0, and that seat is not "You").
 */
export function dealerFromServer(args: {
  serverDealer: number;
  occupants: readonly SeatOccupant[];
  viewerSeat: number | null;
}): DealerIdentity {
  const n = args.occupants.length;
  if (n <= 0) {
    const name = 'Seat 1';
    return { serverSeat: 0, localSeat: 0, name, phrase: dealerPhrase(name) };
  }
  const serverSeat = mod(args.serverDealer, n);
  const spectating = args.viewerSeat === null || !Number.isFinite(args.viewerSeat);
  const me = spectating ? 0 : mod(args.viewerSeat as number, n);
  const localSeat = mod(serverSeat - me, n);
  const seatedHere = !spectating && me === serverSeat;
  const name = seatedHere ? 'You' : occupantName(args.occupants[serverSeat], serverSeat);
  return { serverSeat, localSeat, name, phrase: dealerPhrase(name) };
}

/** Name already stored in local-seat order (index 0 is the bottom of the screen). */
export function hudSeatName(localSeat: number, names: readonly string[]): string {
  const raw = (names[localSeat] ?? '').trim();
  return raw || `Seat ${localSeat + 1}`;
}

export function dealerPhrase(name: string): string {
  return name === 'You' ? 'You deal' : `${name} deals`;
}

export function dealerAnnouncement(handNo: number, name: string): string {
  return `Hand ${handNo} · ${dealerPhrase(name)}`;
}

/** True for the system line that names who deals a hand, not the scored-hand line ("Hand 3: …"). */
export function isDealerLine(text: string, handNo: number): boolean {
  return text.startsWith(`Hand ${handNo} · `) && text.includes(' deal');
}

/**
 * Point the current hand's dealer line at a new occupant. Older hands stay as they were.
 * Returns null when nothing changed (no line yet, or it already says this).
 */
export function withCurrentDealerLine(texts: readonly string[], handNo: number, line: string): string[] | null {
  let i = -1;
  for (let k = texts.length - 1; k >= 0; k--) if (isDealerLine(texts[k]!, handNo)) { i = k; break; }
  if (i < 0 || texts[i] === line) return null;
  const next = texts.slice();
  next[i] = line;
  return next;
}
