/**
 * Wave B surfaces rebuild (recap/victory, Fuse Clock, Run It sweep):
 * the rebuilt visuals are pure, seekable functions — same inputs, same
 * frame, on every device. Timings are the held contract (±10% of shipped):
 * wire 900/750 ms, photo 3000 ms, confetti 2300/1300 ms + 2.15 s fall,
 * fuse window 5 s, sweep gone at 1.9 s.
 */
import { describe, expect, it } from 'vitest';
import {
  CONFETTI_COUNT, CONFETTI_FALL_MS, CONFETTI_MS, CONFETTI_STILL_COUNT, CONFETTI_STILL_MS,
  PHOTO_MS, WIRE_MS, WIRE_STILL_MS,
  confettiPieceAt, confettiPieces, photoScoresLine, photoTapeAt, photoTapeSegments, wireGlowAt, wireShadowAt,
} from '../src/recapfx';
import { FUSE_EMBER_COUNT, FUSE_WINDOW_MS, fuseSparkFrame } from '../src/turnRing';
import { sweepParamsFor, sweepPoseAt, sweepRand, sweepSeedFor } from '../src/three/tornadoSweep';

describe('down to the wire — held-breath edge light', () => {
  it('keeps the shipped durations', () => {
    expect(WIRE_MS).toBe(900);
    expect(WIRE_STILL_MS).toBe(750);
  });

  it('inhales, HOLDS at the peak, then exhales to zero', () => {
    expect(wireGlowAt(0).breath).toBe(0);
    const inhale = wireGlowAt(270).breath; // 30%
    const holdStart = wireGlowAt(300).breath;
    const peak = wireGlowAt(558).breath; // 62%
    expect(inhale).toBeGreaterThan(0.6);
    expect(holdStart).toBeGreaterThan(inhale - 0.05);
    expect(peak).toBeCloseTo(1);
    // the hold: mid-hold is still near the peak (the shipped pulse released at 30%)
    expect(wireGlowAt(450).breath).toBeGreaterThan(0.8);
    expect(wireGlowAt(900).breath).toBe(0);
    expect(wireGlowAt(5000).breath).toBe(0);
  });

  it('the calm read is one low outline with no glow bloom', () => {
    const g = wireGlowAt(225, true);
    expect(g.glowAlpha).toBe(0);
    expect(g.edgePx).toBe(2);
    expect(g.edgeAlpha).toBeLessThanOrEqual(0.7);
    expect(wireShadowAt(450)).toContain('rgba(255, 190, 90');
  });
});

describe('photo finish — tape snap with both scores at the tape', () => {
  it('keeps the shipped 3 s hold', () => {
    expect(PHOTO_MS).toBe(3000);
  });

  it('the tape snaps with an overshoot, settles, and the scores print after it lands', () => {
    expect(photoTapeAt(0).tape).toBeCloseTo(0);
    const mid = photoTapeAt(330).tape;
    expect(mid).toBeGreaterThan(1); // out-back overshoot
    expect(photoTapeAt(450).tape).toBe(1);
    expect(photoTapeAt(450).scoresAlpha).toBe(0);
    expect(photoTapeAt(700).scoresAlpha).toBe(1);
    expect(photoTapeAt(2999).out).toBeLessThan(1);
    expect(photoTapeAt(3000).out).toBe(0);
  });

  it('the tape is a checker and the scores line prints real scores', () => {
    const segs = photoTapeSegments();
    expect(segs.length).toBe(28);
    expect(segs.every((s, i) => s === (i % 2 === 0))).toBe(true);
    expect(photoScoresLine(512, 504, 8)).toBe('512 — 504 · decided by 8');
  });
});

describe('victory confetti — seeded flutter rain', () => {
  it('keeps the shipped durations and piece budget', () => {
    expect(CONFETTI_MS).toBe(2300);
    expect(CONFETTI_STILL_MS).toBe(1300);
    expect(CONFETTI_FALL_MS).toBe(2150);
    expect(confettiPieces(null)).toHaveLength(CONFETTI_COUNT);
    expect(confettiPieces(null, true)).toHaveLength(CONFETTI_STILL_COUNT);
  });

  it('with no seed reproduces the shipped scatter exactly', () => {
    const [p0, p1] = confettiPieces(null);
    const h1 = Math.abs(Math.sin(0 * 127.1 + 311.7));
    expect(p0!.l).toBeCloseTo(3 + h1 * 94);
    expect(p0!.c).toBe('#ffd940');
    expect(p1!.c).toBe('#f5c542');
  });

  it('is deterministic per match seed and differs across seeds', () => {
    const a = confettiPieces('match-42');
    const b = confettiPieces('match-42');
    const c = confettiPieces('match-43');
    expect(a).toEqual(b);
    expect(a[0]!.l).not.toBeCloseTo(c[0]!.l);
    // winning side colours replace the palette, cycled deterministically
    const team = confettiPieces('match-42', false, ['#111111', '#222222']);
    expect(team[0]!.c).toBe('#111111');
    expect(team[1]!.c).toBe('#222222');
  });

  it('flutter physics: falls the full height, sways, flips edge-on, fades on the shipped envelope', () => {
    const p = confettiPieces('match-42')[0]!;
    const W = 400, H = 800;
    const start = confettiPieceAt(p, p.d + 10, W, H);
    const mid = confettiPieceAt(p, p.d + 1100, W, H);
    const end = confettiPieceAt(p, p.d + CONFETTI_FALL_MS - 30, W, H);
    expect(start.y).toBeLessThan(mid.y);
    expect(mid.y).toBeLessThan(end.y);
    expect(end.y).toBeGreaterThan(H); // rains past the bottom edge
    expect(mid.face).toBeGreaterThanOrEqual(0);
    expect(mid.face).toBeLessThanOrEqual(1);
    expect(start.opacity).toBeLessThan(1);
    expect(confettiPieceAt(p, p.d - 1, W, H).visible).toBe(false);
    // same inputs → same pose (seekable)
    expect(confettiPieceAt(p, p.d + 1100, W, H)).toEqual(mid);
  });
});

describe('fuse clock — spark model (a READ of the clock, never a timer)', () => {
  it('the window is the ring warn tail: the final 5 s only', () => {
    expect(FUSE_WINDOW_MS).toBe(5000);
    expect(fuseSparkFrame(5001, 0).lit).toBe(false);
    expect(fuseSparkFrame(5000, 0).lit).toBe(true);
    expect(fuseSparkFrame(0, 0).lit).toBe(false);
    expect(fuseSparkFrame(-5, 0).lit).toBe(false);
  });

  it('the spark head crawls exactly with the remaining fraction', () => {
    expect(fuseSparkFrame(5000, 0).head).toBe(1);
    expect(fuseSparkFrame(2500, 0).head).toBeCloseTo(0.5);
    expect(fuseSparkFrame(100, 0).head).toBeCloseTo(0.02);
    expect(fuseSparkFrame(2500, 0).progress).toBeCloseTo(0.5);
  });

  it('embers trail BEHIND the head, fall below it, and stay inside the budget', () => {
    const f = fuseSparkFrame(1500, 800);
    expect(f.embers.length).toBeGreaterThan(0);
    expect(f.embers.length).toBeLessThanOrEqual(FUSE_EMBER_COUNT);
    for (const e of f.embers) {
      expect(e.dx).toBeLessThanOrEqual(0);
      expect(e.dy).toBeGreaterThanOrEqual(0);
      expect(e.alpha).toBeGreaterThan(0);
      expect(e.alpha).toBeLessThanOrEqual(1);
    }
    // deterministic: the same (remaining, t) frame is identical
    expect(fuseSparkFrame(1500, 800)).toEqual(f);
    // calm: one static flicker value, embers still a pure function of progress
    expect(fuseSparkFrame(1500, 12345, true).flicker).toBe(fuseSparkFrame(1500, 999, true).flicker);
  });
});

describe('run it sweep — seekable card-path geometry', () => {
  const params = sweepParamsFor('A♠', 0.3, -0.2, false);

  it('reproduces the shipped per-card seed hash', () => {
    let h = 7;
    for (const ch of 'A♠') h = (h * 31 + ch.charCodeAt(0)) | 0;
    expect(sweepSeedFor('A♠')).toBe(h);
    expect(sweepRand(h, 1)).toBeGreaterThanOrEqual(0);
    expect(sweepRand(h, 1)).toBeLessThan(1);
    const again = sweepParamsFor('A♠', 0.3, -0.2, false);
    expect(again).toEqual(params);
    // hand cards start sooner than table cards (shipped delay bases 0 / 0.1)
    expect(sweepParamsFor('A♠', 0.3, -0.2, true).delay).toBeLessThan(params.delay);
    expect(params.delay).toBeGreaterThanOrEqual(0.1);
    expect(params.delay).toBeLessThan(0.3);
  });

  it('pull-in is the shipped 0.5 s cubic; the funnel rises, then flings at 1.25 s', () => {
    expect(sweepPoseAt(params, 0).pull).toBe(0);
    expect(sweepPoseAt(params, 0.25).pull).toBeCloseTo(0.875);
    expect(sweepPoseAt(params, 0.5).pull).toBe(1);
    const rise = sweepPoseAt(params, 1.0);
    const fling = sweepPoseAt(params, 1.6);
    expect(fling.y).toBeGreaterThan(rise.y);
    const rRise = Math.hypot(rise.x, rise.z);
    const rFling = Math.hypot(fling.x, fling.z);
    expect(rFling).toBeGreaterThan(rRise + 0.5); // the fling throws it outward
  });

  it('gone at exactly the shipped 1.9 s; the shrink counts as gone under reduced effects', () => {
    expect(sweepPoseAt(params, 1.89).left).toBe(false);
    expect(sweepPoseAt(params, 1.9).left).toBe(true);
    expect(sweepPoseAt(params, 0.9, true).left).toBe(true);
    expect(sweepPoseAt(params, 0.2, true).scale).toBe(1);
  });

  it('bank rolls into the turn and is capped; poses are pure', () => {
    const mid = sweepPoseAt(params, 1.0);
    expect(mid.bank).toBeGreaterThan(0);
    expect(mid.bank).toBeLessThanOrEqual(0.6);
    expect(sweepPoseAt(params, 1.0)).toEqual(mid);
    expect(sweepPoseAt(params, 0).bank).toBe(0);
  });
});
