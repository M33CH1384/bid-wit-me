import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { pannerGainAt, pickVariant, seatCompensation, seatPoint } from '../src/spatial';
import { cameraFor } from '../src/three/layout';

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
  it('distance compensation: a far (top) slam lands within 15% of the near seat loudness, Sitting and Standing', () => {
    for (const view of ['sitting', 'standing'] as const) {
      const cam = cameraFor(390 / 844, false, view);
      const listener = { x: cam.pos[0]!, y: cam.pos[1]!, z: cam.pos[2]! };
      const eff = (pos: 'bottom' | 'top') => { const pt = seatPoint(pos, 4); const d = Math.hypot(pt.x - listener.x, pt.y - listener.y, pt.z - listener.z); return pannerGainAt(d) * seatCompensation(listener, pos, 4); };
      const near = eff('bottom'), far = eff('top');
      expect(Math.abs(far - near) / near).toBeLessThan(0.15);
      expect(seatCompensation(listener, 'bottom', 4)).toBe(1); // near seat unboosted: pre-spatial punch
      expect(seatCompensation(listener, 'top', 4)).toBeGreaterThan(1.5); // was ~40% too quiet
    }
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
    expect(scene).toContain("sound.setSpatialListener(pose.pos, pose.look)"); // listener follows the (Sitting) camera
    expect(scene).toContain("sfxLand: i === k - 1 ? 'play,runSlam' : 'play', spatialSeat: positions[seat]!"); // Run It slams spatialised + compensated too
    expect(audio).toContain('this.settings.spatial === false'); // spatial setting read per one-shot: toggling applies live
  });
});
