import { describe, expect, it } from 'vitest';
import {
  sedanBlastPoseAt, sedanBlastReaction, sedanBlastReducer, type SedanBlastState,
} from '../src/three/pjsSedanBlast';

const parked: SedanBlastState = { phase: 'parked' };

describe("the Pj's sedan vs a detonation — all cars get blown away", () => {
  it('sits parked until the flash lands', () => {
    const p = sedanBlastPoseAt(-0.05, { mega: false, calm: false });
    expect(p.off).toEqual([0, 0, 0]);
    expect(p.rot).toEqual([0, 0, 0]);
    expect(p.visible).toBe(true);
  });

  it('launches radially off its spot — away from the table, up and tumbling', () => {
    const p = sedanBlastPoseAt(1.0, { mega: false, calm: false });
    expect(p.off[0]).toBeGreaterThan(2); // +x, the way it was parked from the table
    expect(p.off[2]).toBeLessThan(-4.5); // deep into the street
    expect(p.off[1]).toBeGreaterThan(1); // lifted
    expect(Math.abs(p.rot[0]) + Math.abs(p.rot[2])).toBeGreaterThan(1); // tumbling
    expect(p.visible).toBe(true);
  });

  it('a mega throws it farther than a nuke at the same instant', () => {
    const n = sedanBlastPoseAt(1.0, { mega: false, calm: false });
    const m = sedanBlastPoseAt(1.0, { mega: true, calm: false });
    const dn = Math.hypot(n.off[0], n.off[2]);
    const dm = Math.hypot(m.off[0], m.off[2]);
    expect(dm).toBeGreaterThan(dn * 1.2);
  });

  it("the mega's second detonation re-kicks it", () => {
    const gapAt1 = (() => { const n = sedanBlastPoseAt(1.0, { mega: false, calm: false }); const m = sedanBlastPoseAt(1.0, { mega: true, calm: false }); return Math.hypot(m.off[0], m.off[2]) - Math.hypot(n.off[0], n.off[2]); })();
    const gapAt2 = (() => { const n = sedanBlastPoseAt(2.0, { mega: false, calm: false }); const m = sedanBlastPoseAt(2.0, { mega: true, calm: false }); return Math.hypot(m.off[0], m.off[2]) - Math.hypot(n.off[0], n.off[2]); })();
    expect(gapAt2).toBeGreaterThan(gapAt1 + 1);
  });

  it('is gone (hidden, deep in the dark) by the end of the blast window', () => {
    expect(sedanBlastPoseAt(3.2, { mega: false, calm: false }).visible).toBe(true);
    expect(sedanBlastPoseAt(3.4, { mega: false, calm: false }).visible).toBe(false);
    expect(sedanBlastPoseAt(4.2, { mega: true, calm: false }).visible).toBe(false);
  });

  it('calm (OS reduce-motion): slides away with no tumble and is gone sooner', () => {
    const p = sedanBlastPoseAt(0.8, { mega: false, calm: true });
    expect(p.rot).toEqual([0, 0, 0]);
    expect(Math.hypot(p.off[0], p.off[2])).toBeGreaterThan(3);
    expect(sedanBlastPoseAt(1.2, { mega: false, calm: true }).visible).toBe(false);
  });

  it("gate: 'off' mode sweeps nothing anywhere — the sedan stays parked", () => {
    expect(sedanBlastReaction('nuke', 'off')).toBe('none');
    expect(sedanBlastReaction('mega', 'off')).toBe('none');
    expect(sedanBlastReaction('nuke', 'full')).toBe('nuke');
    expect(sedanBlastReaction('mega', 'lite')).toBe('mega');
  });
});

describe('sedan blast state — launch, stay gone, restore at the next hand', () => {
  it('parked → flying on a detonation, carrying the blast facts', () => {
    const s = sedanBlastReducer(parked, { type: 'blast', at: 1234, mega: true, calm: false });
    expect(s).toEqual({ phase: 'flying', at: 1234, mega: true, calm: false });
  });

  it('a second detonation while it is gone does NOT pop it back to its spot', () => {
    const flying = sedanBlastReducer(parked, { type: 'blast', at: 1000, mega: false, calm: false });
    const again = sedanBlastReducer(flying, { type: 'blast', at: 9000, mega: true, calm: false });
    expect(again).toBe(flying);
  });

  it("restores at the next hand's deal — and can be blown away again", () => {
    const flying = sedanBlastReducer(parked, { type: 'blast', at: 1000, mega: false, calm: false });
    const restored = sedanBlastReducer(flying, { type: 'hand' });
    expect(restored).toEqual({ phase: 'parked' });
    const blownAgain = sedanBlastReducer(restored, { type: 'blast', at: 5000, mega: false, calm: false });
    expect(blownAgain.phase).toBe('flying');
  });
});
