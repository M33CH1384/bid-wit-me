import { describe, expect, it } from 'vitest';
import { impactFraction } from '../src/landTiming';
import { PILE_THUMP, shakeOffset, slamThump } from '../src/three/shake';
import { smackSound } from '../src/audio';

const peak = (s: { dur: number; amp: number; thump?: boolean }) => { let m = 0; for (let t = 0; t <= s.dur; t += 1 / 240) m = Math.max(m, Math.abs(shakeOffset(s, t).ty)); return m; };

describe('landing sound/thump timing and strength', () => {
  it('impact fraction: glide touches down at 0.35, everything else at the end', () => {
    expect(impactFraction('glide')).toBe(0.35);
    for (const m of ['flight', 'slide', 'lift', undefined]) expect(impactFraction(m)).toBe(1);
  });
  it('thump strength: Run it pile > hard slam > gentle, all vertical only', () => {
    const gentle = slamThump(0.1), hard = slamThump(1);
    expect(peak(PILE_THUMP)).toBeGreaterThan(peak(hard));
    expect(peak(hard)).toBeGreaterThan(peak(gentle) * 3);
    for (const s of [PILE_THUMP, hard, gentle]) for (let t = 0; t <= s.dur; t += 1 / 120) { const o = shakeOffset(s, t); expect(o.x).toBe(0); expect(o.z).toBe(0); expect(o.roll).toBe(0); }
    expect(slamThump(1, true).amp).toBeLessThanOrEqual(0.01);
  });
  it('per-card slam volume scales with intensity', () => {
    expect(smackSound(0).gain).toBeCloseTo(0.35);
    expect(smackSound(0.85).gain).toBeGreaterThan(1.1);
    expect(smackSound(1).gain).toBeCloseTo(1.3);
    expect(smackSound(1).gain).toBeGreaterThan(smackSound(0.85).gain);
  });
});
