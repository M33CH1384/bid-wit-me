import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CH, CT, CW, FAN_FLOOR_MARGIN, FELT, opponentFan, tableTopY, type SeatPos, type Xform } from '../src/three/layout';

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

/**
 * ROUND 5 (owner 2026-11-05, second report): "sometime one of the cards
 * poke thru the table" at the partner seat, and the side opponents
 * "still too close to the table — their cards are on top of the table
 * instead of sitting on the outside as if a real person was holding
 * them." Round 4's pins above measure the fan's CENTRE card; a fan is
 * an arc, and measured per-card against the table's true surface (the
 * rail cap stands 0.10 over the felt where the resting fan sits) the
 * rested 13-card fan's wing corners reached 0.149 UNDER the surface,
 * and the side fans never left the felt at all (centre |x| 1.37,
 * inboard of the 1.5 felt edge). The guarantee is now per-card, in
 * opponentFan itself; these pins hold it, hold the heightfield to the
 * raycast profile it was fitted from, and hold the side fans fully
 * outboard of the rim.
 */
describe('held fan anchors — round 5: per-card clearance, side fans outboard', () => {
  const SEATS: SeatPos[] = ['top', 'right', 'bottom', 'left'];
  const corners = (pose: Xform): [number, number, number][] => {
    const q = new Quaternion(...pose.q);
    const out: [number, number, number][] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const c = new Vector3((sx * CW) / 2, (sy * CH) / 2, (sz * CT) / 2).multiplyScalar(pose.s).applyQuaternion(q);
      out.push([pose.p[0] + c.x, pose.p[1] + c.y, pose.p[2] + c.z]);
    }
    return out;
  };
  const minClearance = (pose: Xform): number => {
    let v = Infinity;
    for (const [cx, cy, cz] of corners(pose)) {
      const top = tableTopY(cx, cz);
      if (top !== null) v = Math.min(v, cy - top);
    }
    return v;
  };

  it('tableTopY tracks the measured table profile (raycasts of geometry.ts)', () => {
    expect(tableTopY(0, 0)).toBe(0); // felt flat
    expect(tableTopY(1.44, 0)).toBe(0); // still inside the bevel foot
    expect(tableTopY(1.46, 0)).toBeCloseTo(0.08, 1); // bevel, measured 0.080
    expect(tableTopY(1.5, 0)).toBe(0.1); // rail cap at the felt outline
    expect(tableTopY(0, -1.9)).toBe(0.1); // cap across the ring
    expect(tableTopY(0, -2.0)).toBeCloseTo(0.095, 1); // outer bevel falling
    expect(tableTopY(0, -2.06)).toBeNull(); // no material past the rim
    expect(tableTopY(1.75, 0)).toBeNull();
  });

  it('PER-CARD: no card corner enters the table — every seat, count, and rest state', () => {
    const poses: [number, number][] = [[0, 0], [0, 1], [0.25, 0.25], [0.5, 0], [0.5, 0.5], [0.75, 0.75], [1, 0], [1, 0.5], [1, 1]];
    for (const pos of SEATS) for (const count of [1, 5, 9, 13]) for (const [r, pc] of poses) {
      for (let i = 0; i < count; i++) {
        const c = minClearance(opponentFan(pos, 4, i, count, r, pc));
        if (c !== Infinity) expect(c, `${pos} count=${count} card=${i} pose=${r}/${pc}`).toBeGreaterThanOrEqual(FAN_FLOOR_MARGIN - 0.002);
      }
    }
  });

  it('side fans sit fully OUTSIDE the table: centre and every corner past the rim line', () => {
    for (const pos of ['left', 'right'] as SeatPos[]) {
      for (const [r, pc] of [[0, 0], [1, 0], [1, 1]] as [number, number][]) {
        const centre = opponentFan(pos, 4, 6, 13, r, pc);
        // Fan centre well past the table's outermost material (|x| ~1.75).
        expect(Math.abs(centre.p[0]), `${pos} pose=${r}/${pc}`).toBeGreaterThanOrEqual(1.85);
        for (let i = 0; i < 13; i++) {
          // No corner over the table at all: clearance is unbounded.
          expect(minClearance(opponentFan(pos, 4, i, 13, r, pc)), `${pos} card=${i} pose=${r}/${pc}`).toBe(Infinity);
        }
      }
    }
  });

  it('top seat centre card is round 4\u2019s exactly — the floor never touches it', () => {
    const open = opponentFan('top', 4, 4, 9, 0);
    expect(open.p[0]).toBeCloseTo(0, 9);
    expect(open.p[1]).toBeCloseTo(0.26, 9);
    expect(open.p[2]).toBeCloseTo(-1.8364, 6);
    // At rest its bottom edge rides the rim cap + margin (never through).
    const rest = opponentFan('top', 4, 4, 9, 1, 1);
    expect(minClearance(rest)).toBeGreaterThanOrEqual(FAN_FLOOR_MARGIN - 0.002);
    expect(minClearance(rest)).toBeLessThanOrEqual(FAN_FLOOR_MARGIN + 0.01);
  });
});
