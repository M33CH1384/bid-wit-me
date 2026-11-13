import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { CH, CW, FELT, FELT_REST_Y, RAIL, RAIL_TOP_Y, TABLE_CLEAR_MARGIN, tableClearLift, tableTopY } from '../src/three/layout';

/** lowest corner of a card at this pose, and the table under that corner */
function lowestGap(p: [number, number, number], q: Quaternion, s: number): number {
  let gap = Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const c = new Vector3((sx * CW) / 2, (sy * CH) / 2, 0).multiplyScalar(s).applyQuaternion(q);
    const top = tableTopY(p[0] + c.x, p[2] + c.z);
    if (top !== null) gap = Math.min(gap, p[1] + c.y - top);
  }
  return gap;
}
const lift = (p: [number, number, number], q: Quaternion, s: number) => tableClearLift(p[0], p[1], p[2], q.x, q.y, q.z, q.w, s);
const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

describe('tableClearLift — a moving card never cuts into the table', () => {
  it('leaves a card resting flat on the felt alone', () => {
    expect(lift([0, FELT_REST_Y, 0], flat, 2.25)).toBe(0);
  });

  it('leaves a book resting flat on the rail cap alone', () => {
    expect(lift([FELT.hx + RAIL / 2, RAIL_TOP_Y + FELT_REST_Y, 0], flat, 1)).toBe(0);
  });

  it('raises a flat card that slides from the felt into the rail', () => {
    const p: [number, number, number] = [FELT.hx + RAIL / 2, FELT_REST_Y, 0];
    const up = lift(p, flat, 1);
    expect(up).toBeGreaterThan(RAIL_TOP_Y - FELT_REST_Y);
    expect(lowestGap([p[0], p[1] + up, p[2]], flat, 1)).toBeGreaterThanOrEqual(TABLE_CLEAR_MARGIN - 1e-9);
  });

  it('raises a tilted card crossing the rail at a corner until its lowest corner is clear', () => {
    // the rounded corner of the rail, card mid-flip (the reported "through the table at the corners" pose)
    const diag = (FELT.r + RAIL / 2) / Math.SQRT2;
    const p: [number, number, number] = [FELT.hx - FELT.r + diag, 0.12, -(FELT.hz - FELT.r + diag)];
    for (const deg of [20, 45, 70, 90, 120]) {
      const q = flat.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (deg * Math.PI) / 180));
      expect(lowestGap(p, q, 1.6)).toBeLessThan(TABLE_CLEAR_MARGIN); // it does cut in without the guard
      const up = lift(p, q, 1.6);
      expect(up).toBeGreaterThan(0);
      expect(lowestGap([p[0], p[1] + up, p[2]], q, 1.6)).toBeGreaterThanOrEqual(TABLE_CLEAR_MARGIN - 1e-9);
    }
  });

  it('does nothing for a card that is not over the table', () => {
    expect(lift([FELT.hx + RAIL + 1.5, -0.4, 0], flat, 1)).toBe(0);
  });

  it('never pushes a card down', () => {
    expect(lift([0, 1.2, 0], flat, 1)).toBe(0);
  });
});
