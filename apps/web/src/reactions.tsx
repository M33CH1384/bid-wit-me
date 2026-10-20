/**
 * Emoji reaction UI for chat lines (table chat + global chat share these pieces).
 * The emoji set is FIXED (REACT_EMOJIS from the protocol): one small strip, no keyboard.
 */
import { REACT_EMOJIS } from '@spades/protocol';

/** Reaction chips under a chat line: emoji + count, highlighted when `myId` reacted. Tapping a chip toggles it. */
export function ReactionChips({ reactions, myId, onToggle }: { reactions?: Record<string, string[]>; myId: string | null; onToggle: (emoji: string) => void }) {
  const used = REACT_EMOJIS.filter((e) => (reactions?.[e]?.length ?? 0) > 0);
  if (!used.length) return null;
  return (
    <span className="rx-chips">
      {used.map((e) => {
        const by = reactions![e]!;
        const mine = !!myId && by.includes(myId);
        return (
          <button key={e} type="button" className={`rx-chip${mine ? ' mine' : ''}`} aria-pressed={mine} aria-label={`React ${e}: ${by.length}`} data-testid="rx-chip" onClick={() => onToggle(e)}>
            {e} <b>{by.length}</b>
          </button>
        );
      })}
    </span>
  );
}

/** The small emoji picker strip (44px touch targets; fits the chat panel width). */
export function ReactionPicker({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <span className="rx-picker" role="group" aria-label="Add a reaction">
      {REACT_EMOJIS.map((e) => (
        <button key={e} type="button" className="rx-pick" aria-label={`React with ${e}`} data-testid="rx-pick" onClick={() => onPick(e)}>{e}</button>
      ))}
    </span>
  );
}
