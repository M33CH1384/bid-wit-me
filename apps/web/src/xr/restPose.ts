/** WebXR prototype rest pose: the played card lands FLAT on the felt, reusing the 2D game's
 *  flatRest (0deg tilt, felt rest height + stack step) instead of floating at ~29 degrees. */
import { FELT_REST_Y, flatRest } from '../three/layout';

export const XR_FELT_Y = 0.72; // prototype felt top (seated table height)
/** Sitting is the prototype default, and a default play is GENTLE — slam only via a V/flick-equivalent gesture (spike mapping), never max by default. */
export const XR_DEFAULT_INTENSITY = 0.15;

export function xrPlayedRest(feltY = XR_FELT_Y): { position: [number, number, number]; quaternion: [number, number, number, number] } {
  const r = flatRest(0, -0.15, 0, 0, 1);
  return { position: [r.p[0]!, feltY + FELT_REST_Y, r.p[2]!], quaternion: r.q };
}
