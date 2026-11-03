import type { Card, GameState } from '@spades/rules';

/**
 * The playable-card highlight must arrive WITH the table, not with the state
 * (owner, 2026-10-30: "My card highlight which ones are available to play
 * about a second before anyone plays a card when it's not my turn").
 *
 * The legal set is derived from the authoritative state, and the state
 * advances the instant a play is applied — a bot's timer firing, a server
 * snapshot landing. The play's presentation runs on the Scene's frame clock
 * and finishes later: the flight itself, the bot-pacing flight spacing
 * (spacedPlayDelaySec), the sweep-serialization floor, and at a trick
 * boundary the review hold + collection, which the Scene anchors to the
 * last card's REST while the hooks' pause (the state-side gate) is anchored
 * to the apply. So when a play advances the turn to the human, the state
 * already calls it his turn while the previous card is still in the bot's
 * fan, still in the air, or the finished trick is still being reviewed —
 * and the highlight (with the tap/drag affordance tied to it) lit up over
 * a table that had not visibly reached his turn.
 *
 * The fix is one gate, here: the highlight set exists only once the Scene
 * certifies that the presentation has caught up with the state the set was
 * derived from. The Scene stamps every play's predicted rest on its frame
 * clock and calls back (onTurnPresented) with the key of the state whose
 * plays have all rested and whose pending collection has finished.
 * Table keys its state with turnStateKey and passes the set through
 * highlightLegal. Every surface (3D fan, felt hand, accessible hand,
 * drag/tap input) consumes that one gated set, so they can never disagree.
 *
 * The last-card free drop is the one deliberate exception: it is the
 * owner's own turn-free window (2026-10-19, generalized 2026-11-02 to
 * every trick) — throw your last card in WHILE the table is catching
 * up — so a one-card set is never held back by presentation. The
 * exemption follows the seat's one-card eligibility, not the turn
 * pointer (owner device report, 2026-11-03: "I'm still having to wait
 * to throw out the last card but the bots can go out of order"): the
 * first cut exempted only the out-of-turn case, so the moment the
 * pointer reached the one-card player — leading the final trick at
 * trick open, or a bot's drop advancing the turn while its card was
 * still flying — the highlight collapsed until certification, while
 * bot drops (which never consult this gate) landed in state inside
 * that same window. A multi-card turn is untouched: it still waits
 * for presentation like any other turn.
 */

/**
 * Identity of the turn-relevant state the highlight is derived from: the
 * hand, how many tricks are complete, how many plays the current trick
 * holds, and whether a finished trick is being held on the table. The
 * held/live term matters: the counts do not change when the hold releases,
 * but the presentation does (the collection runs between the two), so the
 * released state needs its own certification.
 */
export function turnStateKey(st: Pick<GameState, 'handNo' | 'tricks' | 'trick'>, pause: boolean): string {
  return `${st.handNo}:${st.tricks.length}:${st.trick.plays.length}:${pause ? 'held' : 'live'}`;
}

/**
 * The gated highlight set. `presented` is the Scene's certification for the
 * current turnStateKey; `myTurn` / `dropOpen` are Table's existing turn
 * derivations (actingSeat and the client mirror of the engine's last-card
 * free-drop window). The view's legal set itself is already turn-exact (the
 * engine's playableCards) — this gate only decides WHEN it may be shown.
 */
export function highlightLegal(o: {
  myTurn: boolean;
  dropOpen: boolean;
  phase: string;
  presented: boolean;
  viewLegal: readonly Card[];
  hand: readonly Card[] | null;
}): Card[] {
  if (o.phase !== 'playing') return [];
  if (!o.myTurn && !o.dropOpen) return [];
  // His turn waits for the table to reach it. The free drop does not: it is
  // defined by the plays still landing — and the exemption holds whether
  // or not the pointer has reached the one-card seat yet (2026-11-03).
  if (o.myTurn && !o.presented && !o.dropOpen) return [];
  const hand = o.hand ?? [];
  return o.viewLegal.filter((c) => hand.includes(c));
}
