import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { FELT_REST_Y } from '../src/three/layout';
import { slamFeel } from '../src/slam';
import { XR_DEFAULT_INTENSITY, XR_FELT_Y, xrPlayedRest } from '../src/xr/restPose';

describe('XR prototype follow-up: flat landing, gentle default (Sitting)', () => {
  it('played card rest pose is flat: 0deg tilt at felt height (reuses flatRest)', () => {
    const r = xrPlayedRest();
    const normal = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...r.quaternion));
    expect(Math.abs(normal.x)).toBeLessThan(1e-6);
    expect(normal.y).toBeCloseTo(1, 6); // face straight up: zero tilt off the felt
    expect(r.position[1]).toBeCloseTo(XR_FELT_Y + FELT_REST_Y, 6);
  });
  it('default play intensity is low (gentle), not a max slam', () => {
    expect(XR_DEFAULT_INTENSITY).toBeLessThanOrEqual(0.3);
    const f = slamFeel(XR_DEFAULT_INTENSITY);
    expect(f.intensity).toBe(XR_DEFAULT_INTENSITY);
    expect(f.shake).toBe(0); // gentle band: no slam shake
    expect(f.volume).toBeLessThan(slamFeel(1).volume);
  });
});
