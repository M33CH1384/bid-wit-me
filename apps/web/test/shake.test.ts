import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shakeOffset, swayOffset } from '../src/three/shake';

// every shake the game sets (fx.ts, Table.tsx 'Run it!' impact, the card slam and the cut cue)
const SHAKES = [
  { name: 'jokerLittle', dur: 0.35, amp: 0.035 }, { name: 'jokerBig', dur: 0.95, amp: 0.07 }, { name: 'nuke', dur: 2.2, amp: 0.15 },
  { name: 'overcut3', dur: 0.45, amp: 0.085 }, { name: 'overcut', dur: 0.24, amp: 0.045 }, { name: 'wheels', dur: 0.25, amp: 0.02 },
  { name: 'wheelsCar', dur: 0.6, amp: 0.025 }, { name: 'runIt', dur: 1.0, amp: 0.13 },
  { name: 'cut', dur: 0.14, amp: 0.012, thump: true }, { name: 'slam', dur: 0.29, amp: 0.025, thump: true },
];

describe('no shake moves the camera sideways', () => {
  it('every shake is vertical only: x, z and roll stay 0 on every frame', () => {
    for (const s of SHAKES) for (let t = 0; t <= s.dur + 0.05; t += 1 / 120) {
      const o = shakeOffset(s, t);
      expect(o.x, s.name).toBe(0); expect(o.z, s.name).toBe(0); expect(o.roll, s.name).toBe(0);
    }
    for (let u = 0; u <= 3; u += 0.01) { const o = swayOffset(u); expect(o.x).toBe(0); expect(o.roll).toBe(0); }
  });
  it('jokers and the nuke thump harder and heavier than a card slam', () => {
    const peak = (s: { dur: number; amp: number; thump?: boolean }) => { let m = 0; for (let t = 0; t <= s.dur; t += 1 / 240) m = Math.max(m, Math.abs(shakeOffset(s, t).ty)); return m; };
    const slam = peak(SHAKES.find((s) => s.name === 'slam')!);
    for (const n of ['jokerLittle', 'jokerBig', 'nuke']) expect(peak(SHAKES.find((s) => s.name === n)!)).toBeGreaterThan(slam);
    expect(peak(SHAKES.find((s) => s.name === 'nuke')!)).toBeGreaterThan(peak(SHAKES.find((s) => s.name === 'jokerBig')!));
  });
  it('the scene applies shakes only through shakeOffset / swayOffset', () => {
    const src = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
    const adds = src.match(/a\.(x|roll|z) \+= [^;]+;/g) ?? [];
    expect(adds.every((l) => /o\.(x|roll|z)/.test(l))).toBe(true);
  });
});
