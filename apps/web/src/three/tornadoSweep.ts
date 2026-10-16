/**
 * The Run it! funnel. Once it has taken a card, clearing the clock must not
 * put that card back on its spot. That restore is the previous trick and the
 * old hand flashing onto the felt before the recap.
 */

export interface TornadoCardState {
  /** The funnel has started moving this card. */
  taken: boolean;
  /** The card has left and must not return for the rest of this mount. */
  gone: boolean;
  visible: boolean;
}

/**
 * `fx.tornado` is null, or the funnel has not reached this card yet.
 * A card still on its spot is left alone. A card the funnel has taken stays invisible.
 */
export function releaseTornadoCard(card: TornadoCardState): TornadoCardState {
  if (card.gone || card.taken) return { taken: true, gone: true, visible: false };
  return card;
}

/**
 * The card has left the table. 1.9s is the fling (Tornado3D). Reduce effects
 * shrinks the card away instead, and that counts as gone too.
 */
export function tornadoCardLeft(tt: number, scale: number): boolean {
  return tt >= 1.9 || scale <= 0.002;
}
