import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CH, CT, CW, FELT, opponentFan, type SeatPos, type Xform } from '../src/three/layout';

/**
 * HELD-FAN ANCHORS (owner 2026-11-05): every opponent's held fan read as
 * lying ON the table — "the opponents cards sit on the table instead of
 * 'behind' it as if a player were holding them" — and the partner's fan
 * disappeared behind her torso. The fan's anchor had been lowered across
 * three owner rounds (base Y 0.30 → 0.25 → 0.165 → 0.162, base out
 * 0.12 → 0.02) chasing face clearance, until the OPEN fan's bottom edge
 * grazed the felt (+0.013) and the RESTED fan's bottom edge sat BELOW
 * the felt plane (−0.077), with the grip line under the table (−0.17).
 * Face clearance is the figure solve's head/chin gate's job; the fan
 * itself must anchor like a held fan: centre up at the holder's chest,
 * bottom edge clear of the felt in BOTH poses, body toward the holder
 * past the felt's edge line. These pins hold that anchor.
 */

/** Lowest of the card's 8 real corners at a pose. */
function lowestCorner(pose: Xform): number {
  const q = new Quaternion(...pose.q);
  let min = Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const c = new Vector3((sx * CW) / 2, (sy * CH) / 2, (sz * CT) / 2).multiplyScalar(pose.s).applyQuaternion(q);
    min = Math.min(min, pose.p[1] + c.y);
  }
  return min;
}

const SEATS: SeatPos[] = ['top', 'left', 'right'];
const COUNTS = [5, 9, 13];

describe('held-fan anchors (opponentFan)', () => {
  it('the centre card\'s bottom edge clears the felt in the open AND rested poses', () => {
    for (const pos of SEATS) {
      for (const count of COUNTS) {
        const mid = (count - 1) / 2;
        const open = opponentFan(pos, 4, mid, count, 0, 0);
        const rest = opponentFan(pos, 4, mid, count, 1, 0);
        expect(lowestCorner(open), `${pos} open n=${count}`).toBeGreaterThanOrEqual(0.08);
        expect(lowestCorner(rest), `${pos} rest n=${count}`).toBeGreaterThanOrEqual(0.03);
      }
    }
  });

  it('the fan centre rides at held height, not at the felt', () => {
    for (const pos of SEATS) {
      for (const count of COUNTS) {
        const mid = (count - 1) / 2;
        expect(opponentFan(pos, 4, mid, count, 0, 0).p[1], `${pos} open`).toBeGreaterThanOrEqual(0.24);
        expect(opponentFan(pos, 4, mid, count, 1, 0).p[1], `${pos} rest`).toBeGreaterThanOrEqual(0.18);
      }
    }
  });

  it('the top seat\'s fan body sits toward the holder, past the felt\'s far edge line', () => {
    for (const count of COUNTS) {
      const mid = (count - 1) / 2;
      const open = opponentFan('top', 4, mid, count, 0, 0);
      const rest = opponentFan('top', 4, mid, count, 1, 0);
      expect(-open.p[2]).toBeGreaterThanOrEqual(FELT.hz + 0.05);
      expect(-rest.p[2]).toBeGreaterThanOrEqual(FELT.hz + 0.12);
    }
  });

  it('the grip line (0.23 down the fan face, PersonaFigures GRIP_EDGE) is above the felt when open', () => {
    for (const pos of SEATS) {
      const count = 13;
      const mid = (count - 1) / 2;
      const fan = opponentFan(pos, 4, mid, count, 0, 0);
      const q = new Quaternion(...fan.q);
      const up = new Vector3(0, 1, 0).applyQuaternion(q);
      const grip = new Vector3(...fan.p).addScaledVector(up, -0.23);
      expect(grip.y, `${pos} grip`).toBeGreaterThanOrEqual(0.0);
    }
  });
});

describe('figure placement idempotency (source pins, both figure systems)', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), 'apps/web/src/three', p), 'utf8');
  for (const file of ['PersonaFigures.tsx', 'PorchFigures.tsx']) {
    it(`${file}: pelvis measured as the joints' offset FROM the root, spine restored from bind`, () => {
      const s = src(file);
      // The frame-mixing form (measuring world joints against a root
      // offset a previous run already placed) zeroed root.y on any
      // effect re-run and left the pelvis at bind height, ~0.42 over
      // the seat; the lean stacked a second time on top.
      expect(s).toContain("toLocal(jp('LeftUpLeg')).sub(root.position)");
      expect(s).toContain("toLocal(jp('RightUpLeg')).sub(root.position)");
      expect(s).toContain('prep.bind[nm]');
      expect(s).toContain('bind: Record<string, Quaternion>');
      // The head/chin gate + settle answer for the full fan even when
      // the mount lands before the deal (count 0).
      expect(s).toContain('const effCount = count > 0 ? count : 13;');
    });
  }
});
