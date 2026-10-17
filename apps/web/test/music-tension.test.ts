import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { musicTension } from '../src/musicTension';
describe('music tension', () => {
  it('calm early, hot at match point', () => {
    const calm = musicTension({ scores: [20, 10], target: 500, phase: 'playing', handNo: 1 });
    const hot = musicTension({ scores: [490, 470], target: 500, phase: 'playing', handNo: 9, nilBid: true });
    expect(calm).toBeLessThan(0.2); expect(hot).toBeGreaterThan(0.85); expect(hot).toBeLessThanOrEqual(1);
  });
  it('menu/game-over is calm-ish; nil raises it', () => {
    const base = musicTension({ scores: [250, 250], target: 500, phase: 'gameOver', handNo: 5 });
    const nil = musicTension({ scores: [250, 250], target: 500, phase: 'gameOver', handNo: 5, nilBid: true });
    expect(nil).toBeGreaterThan(base);
  });
});

describe('music tension: closeness (Phase 6 fix)', () => {
  it('a close race near the target is tenser than the same leader in a blowout', () => {
    const race = musicTension({ scores: [400, 390], target: 500, phase: 'playing', handNo: 5 });
    const blowout = musicTension({ scores: [400, 100], target: 500, phase: 'playing', handNo: 5 });
    expect(race).toBeGreaterThan(blowout + 0.2);
  });
  it('level scores mid-game beat a runaway leader at the same top score', () => {
    const level = musicTension({ scores: [300, 295], target: 500, phase: 'playing', handNo: 5 });
    const runaway = musicTension({ scores: [300, 40], target: 500, phase: 'playing', handNo: 5 });
    expect(level).toBeGreaterThan(runaway);
  });
  it('music-off stops the pad immediately (fast ramp + oscillator stop, no linger)', () => {
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    expect(audio).toContain('stopTensionPad()');
    expect(audio).toContain('setTargetAtTime(0, c.currentTime, 0.05)');
    expect(audio).toContain('o.stop()');
  });
});
