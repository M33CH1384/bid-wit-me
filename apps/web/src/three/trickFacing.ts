import { Quaternion, Vector3 } from 'three';
import type { Xform } from './layout';

const FLIP_Y = new Quaternion(0, 1, 0, 0);

/** World-up component of the card's face. Positive means the pips face the camera above the table. */
export function frontNormalY(q: readonly [number, number, number, number]): number {
  const quat = new Quaternion(q[0], q[1], q[2], q[3]);
  return new Vector3(0, 0, 1).applyQuaternion(quat).y;
}

/**
 * Opponent fan turned face-up in place. The fan itself shows the back to the table;
 * a card played from it has to travel face-up or it can settle in the trick still on its back.
 */
export function faceUpPlayFrom(fan: Xform): Xform {
  const q = new Quaternion(fan.q[0], fan.q[1], fan.q[2], fan.q[3]).multiply(FLIP_Y);
  return { p: fan.p, q: [q.x, q.y, q.z, q.w], s: fan.s };
}

/**
 * Where a trick card launches from.
 * The local card leaves its own fan slot (face-up). A bot card leaves a face-up fan pose
 * on the render that first shows the play. After that — and on any canvas rebuild —
 * there is no launch pose, so the mesh rests on the face-up trick spot.
 */
export function trickPlayFrom(o: { firstShow: boolean; humanSlot?: Xform; fan?: Xform }): Xform | undefined {
  if (o.humanSlot) return o.humanSlot;
  if (!o.firstShow || !o.fan) return undefined;
  return faceUpPlayFrom(o.fan);
}

/**
 * Cards already in the trick when a resumed scene first draws. They sit on the trick
 * spot. Launching them from the opponent fan on that first paint leaves the centre empty.
 * A card played after that is not in this set, so it still flies in.
 */
export function openingTrickKeys(resume: boolean, keys: readonly string[]): Set<string> {
  return new Set(resume ? keys : []);
}

/** True when this trick card should launch from a hand. False when it is already on the table. */
export function trickCardLaunches(playKey: string, opening: ReadonlySet<string>, seen: ReadonlySet<string>): boolean {
  if (opening.has(playKey)) return false;
  return !seen.has(playKey);
}

/** The flight has reached the trick spot (or is close enough that the card reads as landed). */
export function trickFacingArrived(t: number, distance: number): boolean {
  return t >= 1 || distance < 0.12;
}

/**
 * Quaternion once a card has landed. If the slerp from a face-down fan never finished,
 * the trick's own face-up quaternion replaces it. A face-down pile is left alone.
 */
export function restingFacing(
  current: readonly [number, number, number, number],
  target: readonly [number, number, number, number],
  arrived: boolean,
): readonly [number, number, number, number] {
  if (!arrived) return current;
  if (frontNormalY(target) > 0.2 && frontNormalY(current) < 0.2) return target;
  return current;
}
