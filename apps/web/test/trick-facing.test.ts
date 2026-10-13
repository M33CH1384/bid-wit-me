import { describe, expect, it } from 'vitest';
import { opponentFan, trickSpot } from '../src/three/layout';
import { faceUpPlayFrom, frontNormalY, restingFacing, trickPlayFrom } from '../src/three/trickFacing';

describe('bot trick cards settle face-up', () => {
  const seats = ['left', 'top', 'right'] as const;

  it('rests on the trick face after the flight, even if the slerp left the fan quaternion', () => {
    for (const seat of seats) {
      const fan = opponentFan(seat, 4, 2, 8);
      const trick = trickSpot(seat, 4, 1, 0);
      expect(frontNormalY(fan.q)).toBeLessThan(0);
      expect(frontNormalY(trick.q)).toBeGreaterThan(0.5);
      // Landed, but the mesh is still holding the face-down fan. That is the bug.
      const rested = restingFacing(fan.q, trick.q, true);
      expect(frontNormalY(rested)).toBeGreaterThan(0.5);
      expect(rested).toEqual(trick.q);
      // Still in the air: don't snap it yet.
      expect(restingFacing(fan.q, trick.q, false)).toBe(fan.q);
    }
  });

  it('launches a bot card face-up once, then a rebuild rests on the trick spot', () => {
    const fan = opponentFan('top', 4, 1, 7);
    const first = trickPlayFrom({ firstShow: true, fan });
    expect(first).toBeDefined();
    expect(frontNormalY(first!.q)).toBeGreaterThan(0);
    expect(frontNormalY(faceUpPlayFrom(fan).q)).toBeGreaterThan(0);
    // Canvas rebuild / the play is already on screen: no face-down fan launch.
    expect(trickPlayFrom({ firstShow: false, fan })).toBeUndefined();
    const slot = trickSpot('bottom', 4, 0, 0);
    expect(trickPlayFrom({ firstShow: false, humanSlot: slot, fan })).toBe(slot);
  });
});
