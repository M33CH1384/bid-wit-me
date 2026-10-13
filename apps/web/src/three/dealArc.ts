/**
 * A dealt card follows one ribbon from the deck to its seat.
 * The control sits above the chord and out toward that seat, so the four seats
 * get four arcs instead of every card hopping straight up off the deck.
 */

/** Lift of a card dealt into your fan, in world units. */
export const DEAL_LIFT_HAND = 0.22;
/** Lift of a card dealt across the table to another seat. */
export const DEAL_LIFT_SEAT = 0.72;

const _out: [number, number, number] = [0, 0, 0];

/**
 * Point on the deal ribbon at `t` in 0..1. `t` 0 is the deck and `t` 1 is the fan slot.
 * `lift` is how high the ribbon rises, in world units.
 * The returned array is reused; copy it before the next call.
 */
export function dealArcPoint(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  t: number,
  lift: number,
  out: [number, number, number] = _out,
): [number, number, number] {
  const u = 1 - t;
  const mx = ax + (bx - ax) * 0.42;
  const mz = az + (bz - az) * 0.42;
  const seat = Math.hypot(bx, bz) || 1;
  const cx = mx * 0.72 + (bx / seat) * 0.34;
  const cy = Math.max(ay, by) + lift;
  const cz = mz * 0.72 + (bz / seat) * 0.34;
  out[0] = u * u * ax + 2 * u * t * cx + t * t * bx;
  out[1] = u * u * ay + 2 * u * t * cy + t * t * by;
  out[2] = u * u * az + 2 * u * t * cz + t * t * bz;
  return out;
}
