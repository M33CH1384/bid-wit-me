import { createRng } from '@spades/rules';
import { BOT_NAMES } from './names';
import { personaForName } from './personas';
import { platePersona } from './talk';

/**
 * The Deacon seat guarantee (owner-approved, 2026-11-03).
 *
 * There is no bot picker: offline seats are dealt by name at random, and the
 * Deacon persona rides on just three roster names (today Darius, Anjali and
 * Kofi — derived live below via personaForName), so he surfaces in only about
 * one game in seven. A player who turns on "Fresh table talk — Deacon" to
 * hear the generated lines should not need luck to meet him. When the table
 * opts in (Table's offlineNames, preference on), this adjustment rewrites the
 * dealt names so that:
 *
 *  - exactly ONE Deacon-persona name sits at the table,
 *  - it sits in an OPPONENT seat — in partnership play never the partner seat
 *    (seat (0 + 2) % n, the same formula Table uses), in cutthroat any
 *    non-human seat,
 *  - no name repeats at the table and no plate tag collides with a surviving
 *    seat (the invariants pickBotNames itself keeps),
 *  - every draw is deterministic, from a dedicated RNG seeded by the game
 *    seed — the dealt pick itself is never re-rolled.
 *
 * A seating that already satisfies the guarantee is returned unchanged.
 * Graceful by construction: if no eligible name can be drawn (e.g. every
 * Deacon name is taken), the affected seat simply keeps its dealt name.
 */
export function withDeaconOpponent(
  names: readonly string[],
  opts: { partnerships: boolean; seed: string; taken?: Iterable<string> },
): string[] {
  const out = [...names];
  if (out.length < 3) return out;
  const rng = createRng(`deacon-seat:${opts.seed}`);
  const partnerSeat = opts.partnerships ? 2 % out.length : -1;
  const taken = new Set([...(opts.taken ?? [])].map((s) => s.trim().toLowerCase()));
  const isDeacon = (nm: string) => personaForName(nm) === 'deacon';

  // Draw a roster name for `seat`: Deacon-side or not per `wantDeacon`, never
  // a name already seated or taken, never wearing a plate tag another
  // surviving seat wears (the vacated seat's own tag does not block it).
  const draw = (seat: number, wantDeacon: boolean): string | null => {
    const used = new Set(out.map((s) => s.trim().toLowerCase()));
    const tags = new Set(out.filter((_, i) => i !== seat && i !== 0).map((nm) => platePersona(nm)));
    const pool = BOT_NAMES.filter(
      (nm) =>
        isDeacon(nm) === wantDeacon &&
        !used.has(nm.trim().toLowerCase()) &&
        !taken.has(nm.trim().toLowerCase()) &&
        !tags.has(platePersona(nm)),
    );
    return pool.length ? pool[rng.int(pool.length)]! : null;
  };

  // The partner never hosts the Deacon — he talks AT the table, as an opponent.
  if (partnerSeat > 0 && isDeacon(out[partnerSeat]!)) {
    const sub = draw(partnerSeat, false);
    if (sub) out[partnerSeat] = sub;
  }

  const opponentSeats = out.map((_, i) => i).filter((i) => i > 0 && i !== partnerSeat);
  // Exactly one Deacon across the table: extra dealt Deacons are re-seated as
  // other personas (a ♂+♀ pair can be dealt together — their plate tags differ).
  for (const seat of opponentSeats.filter((i) => isDeacon(out[i]!)).slice(1)) {
    const sub = draw(seat, false);
    if (sub) out[seat] = sub;
  }
  if (!opponentSeats.some((i) => isDeacon(out[i]!))) {
    // Seat him across: a drawn opponent seat takes a drawn Deacon name.
    const order = [...opponentSeats];
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    for (const seat of order) {
      const sub = draw(seat, true);
      if (sub) {
        out[seat] = sub;
        break;
      }
    }
  }
  return out;
}
