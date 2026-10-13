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
