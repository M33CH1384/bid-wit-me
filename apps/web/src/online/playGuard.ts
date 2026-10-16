/**
 * After one play is sent, further play taps wait until that trick moves.
 * A duplicate tap must not put a second card from the same seat into the trick.
 */

export interface PlayTrick {
  handNo: number;
  tricks: number;
  plays: number;
  turn: number | null;
}

export function playTrickOf(st: { handNo: number; tricks: readonly unknown[]; trick: { plays: readonly unknown[] }; turn: number | null }): PlayTrick {
  return { handNo: st.handNo, tricks: st.tricks.length, plays: st.trick.plays.length, turn: st.turn };
}

/** True while a play is outstanding and the trick it was sent from has not moved. */
export function ignorePlayTap(held: PlayTrick | null, now: PlayTrick): boolean {
  if (!held) return false;
  return held.handNo === now.handNo && held.tricks === now.tricks && held.plays === now.plays && held.turn === now.turn;
}

/**
 * A play sent against `sentSeq` stays blocked until the server's seq moves past it.
 * `sentSeq` null means nothing is held. A rejected play clears the hold so the seat can choose again.
 */
export function playSendBlocked(sentSeq: number | null, serverSeq: number): boolean {
  return sentSeq !== null && serverSeq <= sentSeq;
}

/**
 * How long a freshly selected card stays a selection. A second pointer event in this window
 * (a touch plus the mouse event iOS synthesises) must not play the card it just selected,
 * and it must not play the neighbour underneath a card that is still rising.
 */
export const TAP_PLAY_ARM_MS = 120;

/**
 * One tap selects. The next tap plays, and the card that leaves the hand is the selected id.
 * A hit on a different card changes the selection. It never plays that other card.
 * The pointer event that follows the selecting tap (a touch, then the mouse event, or the
 * card sliding out from under the finger) must not drop that selection.
 */
export function confirmPlay(selected: string | null, hit: string, selectedAt: number, now: number):
  { type: 'play'; card: string } | { type: 'select'; card: string } | { type: 'ignore' } {
  if (!hit) return { type: 'ignore' };
  if (selected !== null && hit === selected) {
    if (!(now - selectedAt >= TAP_PLAY_ARM_MS)) return { type: 'ignore' };
    return { type: 'play', card: selected };
  }
  if (selected !== null && now - selectedAt < TAP_PLAY_ARM_MS) return { type: 'ignore' };
  return { type: 'select', card: hit };
}
