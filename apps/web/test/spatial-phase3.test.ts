import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { pickVariant, seatPoint } from '../src/spatial';

describe('spatial phase 3: event-driven gameplay SFX', () => {
  it('variant picker never repeats the same variant twice in a row', () => {
    let last = -1;
    for (const r of [0, 0.1, 0.49, 0.5, 0.99, 0, 0.34]) {
      const v = pickVariant(3, last, () => r);
      expect(v).not.toBe(last); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(3);
      last = v;
    }
    expect(pickVariant(1, 0)).toBe(0);
    expect(pickVariant(3, 1, () => 0.5)).toBe(2); // forced off the repeat
  });
  it('each seat maps to its own side of the table (probe positions per seat)', () => {
    expect(seatPoint('left', 4).x).toBeLessThan(0); expect(seatPoint('right', 4).x).toBeGreaterThan(0);
    expect(seatPoint('top', 4).z).toBeLessThan(0); expect(seatPoint('bottom', 4).z).toBeGreaterThan(0);
  });
  it('wiring: landing smack + start cues carry the seat, timing call sites unchanged in Card3D', () => {
    const card = readFileSync(new URL('../src/three/Card3D.tsx', import.meta.url), 'utf8');
    expect(card).toContain('sound.cardSmack(sl2.intensity, spatialSeat, spatialN)');
    expect(card).toContain("sound.play(st, spatialSeat ? { seat: spatialSeat, playerCount: spatialN } : {})");
    expect(card).toContain('impactFraction(motion)'); // #169: sound still fires on the impact frame
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    expect(audio).toContain('routeSfx'); expect(audio).toContain('spatialProbe'); expect(audio).toContain('pickVariant');
    const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
    expect(scene).toContain("sfxStart: 'sweep', spatialSeat: positions[w]!"); // collects from the winner's seat
  });
});
