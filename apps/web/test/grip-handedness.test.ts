import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { opponentFan, seatDir, type SeatPos } from '../src/three/layout';

/**
 * GRIP HANDEDNESS (owner 2026-11-08: "The bot's hands are backwards").
 *
 * The bots' wrists are IK'd onto fanGripPoint targets built in the FAN's
 * own frame. That frame's +x is NOT the seat's left: opponentFan's yaw
 * makes fan-local +x the seated figure's anatomical RIGHT direction at
 * every bot seat (proved geometrically below from layout itself). The
 * grip assignment nevertheless placed 'Left' at +GRIP_HALF — the left
 * wrist was driven to the fan end on the figure's right side and vice
 * versa, and the hand-orientation solve then landed each hand's true
 * anatomical frame at the wrong corner: thumb on the fan's outer edge,
 * the hand reading as the opposite hand. Every earlier grip audit was
 * invariant under the swap (unsigned plane distances, distances to the
 * swapped targets), so three calibration rounds never saw it.
 *
 * Lap and stand targets are built in seat-GROUP space, where +x IS the
 * figure's left — those were always anatomical and must not change.
 */

const SEATS: SeatPos[] = ['left', 'top', 'right'];

describe('the fan frame is seat-centric (geometry, from layout)', () => {
  it('fan-local +x is the seated figure\'s anatomical RIGHT at every bot seat', () => {
    for (const pos of SEATS) {
      const fan = opponentFan(pos, 4, 6, 13, 0, 0);
      const inv = new Quaternion(...fan.q).invert();
      const facing = seatDir(pos, 4).negate(); // the figure faces the table centre
      const anatomicalRight = new Vector3().crossVectors(facing, new Vector3(0, 1, 0)).normalize();
      const inFan = anatomicalRight.applyQuaternion(inv);
      expect(inFan.x, `${pos}: anatomical right in fan frame`).toBeGreaterThan(0.9);
      expect(Math.abs(inFan.y), `${pos}: right vector stays in the fan plane`).toBeLessThan(0.6);
    }
  });

  it('so the anatomical LEFT wrist target must sit at fan-local x = -GRIP_HALF', () => {
    // GRIP_HALF = 0.085 (PersonaFigures/PorchFigures): the left grip is
    // the negative-x end of the fan, the right grip the positive end.
    for (const pos of SEATS) {
      const fan = opponentFan(pos, 4, 6, 13, 0, 0);
      const inv = new Quaternion(...fan.q).invert();
      const facing = seatDir(pos, 4).negate();
      const anatomicalLeft = new Vector3().crossVectors(new Vector3(0, 1, 0), facing).normalize();
      const inFan = anatomicalLeft.applyQuaternion(inv);
      expect(inFan.x, `${pos}: anatomical left in fan frame`).toBeLessThan(-0.9);
    }
  });
});

describe('fanGripPoint assigns the wrists anatomically (source pins, both figure systems)', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), 'apps/web/src/three', p), 'utf8');
  for (const file of ['PersonaFigures.tsx', 'PorchFigures.tsx']) {
    it(`${file}: Left grips at -GRIP_HALF, Right at +GRIP_HALF`, () => {
      const s = src(file);
      expect(s).toContain("side === 'Left' ? -GRIP_HALF : GRIP_HALF");
      expect(s).not.toContain("side === 'Left' ? GRIP_HALF : -GRIP_HALF");
      // the inverted frame belief that licensed the old sign is gone
      expect(s).not.toContain("runs from the seat's right hand toward its left");
    });

    it(`${file}: lap targets stay figure-centric (Left at +0.18 group space)`, () => {
      expect(src(file)).toContain("side === 'Left' ? 0.18 : -0.18");
    });
  }
});
