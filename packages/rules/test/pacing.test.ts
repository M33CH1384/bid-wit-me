import { describe, expect, it } from 'vitest';
import { botPaceDelayMs, botPaceDraw, type BotPaceInput } from '../src';

const play = (over: Partial<BotPaceInput> = {}): BotPaceInput => ({
  seed: 'game-seed', handNo: 0, trickNo: 0, seat: 1, position: 1, playerCount: 4,
  kind: 'play', baseMs: 1200, ...over,
});

describe('botPaceDelayMs', () => {
  it('is deterministic: the same turn identity always draws the same wait', () => {
    for (const over of [{}, { seat: 3 }, { trickNo: 7 }, { handNo: 2 }, { kind: 'bid' as const }]) {
      expect(botPaceDelayMs(play(over))).toBe(botPaceDelayMs(play(over)));
      expect(botPaceDraw(play(over))).toBe(botPaceDraw(play(over)));
    }
  });

  it('different turn identities draw different waits (no shared metronome)', () => {
    const waits = new Set<number>();
    for (let trickNo = 0; trickNo < 13; trickNo++) {
      for (let seat = 0; seat < 4; seat++) waits.add(botPaceDelayMs(play({ trickNo, seat, position: seat })));
    }
    // 52 turns over a ~900-value band: near-uniqueness, and never a run of
    // four identical waits in a row (the old constant's signature).
    expect(waits.size).toBeGreaterThanOrEqual(44);
    const seq: number[] = [];
    for (let trickNo = 0; trickNo < 13; trickNo++) for (let seat = 0; seat < 4; seat++) seq.push(botPaceDelayMs(play({ trickNo, seat, position: seat })));
    let run = 1, maxRun = 1;
    for (let i = 1; i < seq.length; i++) { run = seq[i] === seq[i - 1] ? run + 1 : 1; maxRun = Math.max(maxRun, run); }
    expect(maxRun).toBeLessThanOrEqual(2);
  });

  it('stays inside the declared bands, per shape', () => {
    for (let i = 0; i < 400; i++) {
      const seed = `band-${i}`;
      const mid = botPaceDelayMs(play({ seed, position: 1 })) / 1200;
      expect(mid).toBeGreaterThanOrEqual(0.61); expect(mid).toBeLessThanOrEqual(1.39);
      const leader = botPaceDelayMs(play({ seed, position: 0 })) / 1200;
      expect(leader).toBeGreaterThanOrEqual(0.67); expect(leader).toBeLessThanOrEqual(1.53);
      const last = botPaceDelayMs(play({ seed, position: 3 })) / 1200;
      expect(last).toBeGreaterThanOrEqual(0.55); expect(last).toBeLessThanOrEqual(1.26);
      const bid = botPaceDelayMs(play({ seed, kind: 'bid', baseMs: 650 })) / 650;
      expect(bid).toBeGreaterThanOrEqual(0.77); expect(bid).toBeLessThanOrEqual(1.23);
    }
  });

  it('keeps the mean at the layer base (pace preserved, only uniformity removed)', () => {
    let sum = 0, bidSum = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      sum += botPaceDelayMs(play({ seed: `mean-${i}`, position: 1 }));
      bidSum += botPaceDelayMs(play({ seed: `mean-${i}`, kind: 'bid', baseMs: 650 }));
    }
    expect(Math.abs(sum / N - 1200) / 1200).toBeLessThan(0.02);
    expect(Math.abs(bidSum / N - 650) / 650).toBeLessThan(0.02);
  });

  it('the leader thinks longer and the last seat less, by the declared factors', () => {
    let lead = 0, mid = 0, last = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) {
      const seed = `shape-${i}`;
      lead += botPaceDelayMs(play({ seed, position: 0 }));
      mid += botPaceDelayMs(play({ seed, position: 1 }));
      last += botPaceDelayMs(play({ seed, position: 3 }));
    }
    expect(Math.abs(lead / mid - 1.1)).toBeLessThan(0.02);
    expect(Math.abs(last / mid - 0.9)).toBeLessThan(0.02);
  });

  it('a Joker down stretches the next play by exactly the declared factor', () => {
    for (let i = 0; i < 50; i++) {
      const seed = `joker-${i}`;
      const plain = botPaceDelayMs(play({ seed }));
      const joker = botPaceDelayMs(play({ seed, jokerDown: true }));
      expect(joker / plain).toBeGreaterThan(1.23);
      expect(joker / plain).toBeLessThan(1.27);
    }
  });

  it('never waits on a non-positive base (test timings stay instant)', () => {
    expect(botPaceDelayMs(play({ baseMs: 0 }))).toBe(0);
    expect(botPaceDelayMs(play({ baseMs: -5 }))).toBe(0);
    expect(botPaceDelayMs(play({ baseMs: 10 }))).toBeGreaterThan(0);
    expect(botPaceDelayMs(play({ baseMs: 10 }))).toBeLessThanOrEqual(16);
  });
});
