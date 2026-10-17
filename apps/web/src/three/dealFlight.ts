import type { Xform } from './layout';

export interface FlightPose {
  from?: Xform;
  delay: number;
}

/**
 * The mesh mounts with a deal flight, then a later render marks the card seen and
 * clears `from` / `delay` before the first frame. That used to drop the whole hand
 * into the fan while other seats were still being dealt. The opening tween keeps
 * the flight the card was mounted with. A later tween (slide, play) uses the live props.
 */
export function openingFlight(live: FlightPose, mounted: FlightPose, firstTween: boolean): FlightPose {
  if (!firstTween) return { from: live.from, delay: live.delay };
  const delay = live.delay > 0 ? live.delay : mounted.delay > 0 ? mounted.delay : live.delay;
  return { from: live.from ?? mounted.from, delay };
}

/** Face-up cards key by id. A face-down slot has no id yet, so it keys by index. */
export function handSlotKey(cardId: string, index: number): string {
  return cardId || `down-${index}`;
}

/**
 * A hand card flies in from the deck only on the show we have not committed yet.
 * A Blind Nil reveal flips in place and must not take another trip from the deck.
 */
export function handNeedsDeal(o: { intro: boolean; flip: boolean; seen: ReadonlySet<string>; slotKey: string }): boolean {
  return o.intro && !o.flip && !o.seen.has(o.slotKey);
}

/**
 * The fan on screen is the current hand. A card that is already in state is drawn in its slot,
 * not held at the deck until its deal beat (that beat is what left cards missing and taps ignored).
 * A repeated id is one card. Two meshes for the queen is the ghost face behind it.
 */
export function handOnFan<T extends string>(hand: readonly (T | null)[]): { card: T | null; hidden: boolean }[] {
  const seen = new Set<string>();
  const out: { card: T | null; hidden: boolean }[] = [];
  for (const card of hand) {
    if (card !== null) {
      if (seen.has(card)) continue;
      seen.add(card);
    }
    out.push({ card, hidden: false });
  }
  return out;
}

/**
 * A fresh deal: your cards are not on the fan yet. Each one leaves the deck face down on its
 * deal beat and turns face up as it lands. A resumed hand (not the intro hand) is drawn at once.
 */
export function handDealsIn(o: { intro: boolean; dealing: boolean; flip: boolean }): boolean {
  return o.intro && o.dealing && !o.flip;
}

/**
 * The intro hand's cards wait for the table. Before it is up, nothing of this hand is drawn,
 * so the deal (and its clock) starts when the felt is on screen, not behind the loader.
 */
export function dealHeld(o: { intro: boolean; dealReady: boolean }): boolean {
  return o.intro && !o.dealReady;
}

/** The deal clock (bots, YOUR TURN, the timer) runs only once the table can show the deal. */
export function dealClockArmed(introHand: number | null, dealReady: boolean): boolean {
  return introHand !== null && dealReady;
}
