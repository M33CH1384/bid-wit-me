import { withDeaconOpponent } from '@spades/bots';

/**
 * Rematch seat carry (owner, 2026-11-04: "when I select rematch I don't get
 * the same opponents or partner").
 *
 * An offline table's seats are dealt from the game seed (Table's
 * offlineNames), and a rematch mints a fresh seed — so without a carry the
 * draw deals a brand-new table and the rematch loses its partner and
 * opponents. The finished game's seats are therefore handed to the next
 * game in the sitting (by the table session shell, or by the victory
 * recovery surface through App's autostart) and dealt back here:
 *
 * - No carry, or a carry whose length is not this table's seat count:
 *   null — the caller falls back to the seed draw, so a genuinely NEW
 *   table keeps its variety exactly as before.
 * - Fresh table talk off: the carried seats pass verbatim — a rematch is
 *   the same table, seat for seat.
 * - Fresh table talk on: the carried seats pass through the Deacon seat
 *   guarantee (withDeaconOpponent). A seating that already satisfies it —
 *   every table dealt while the switch was on — is returned unchanged, so
 *   the normal rematch is still verbatim. Only a table dealt while the
 *   switch was OFF and rematched after it was flipped ON is adjusted, and
 *   then by the guarantee's own minimal move (one opponent seat re-drawn,
 *   or a Deacon dealt at the partner seat moved across).
 */

/** Names the deal must never seat as bots: your own online name, and 'You'.
 *  (Table's offlineNames keeps its own inline copy of this read — this one
 *  serves the carry's Deacon adjustment, where the same exclusion applies.) */
export function ownTakenNames(): string[] {
  let mine = '';
  try { mine = (localStorage.getItem('bwm.online.name') ?? '').replace(/^"|"$/g, ''); } catch { /* ignore */ }
  return mine ? [mine, 'You'] : ['You'];
}

export function carriedTableSeats(
  carry: readonly string[] | null | undefined,
  n: number,
  seed: string,
  partnerships: boolean,
  genDialogue: boolean,
): string[] | null {
  if (!carry || carry.length !== n) return null;
  if (!genDialogue) return [...carry];
  return withDeaconOpponent(carry, { partnerships, seed, taken: ownTakenNames() });
}
