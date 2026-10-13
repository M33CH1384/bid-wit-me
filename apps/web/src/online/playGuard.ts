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
