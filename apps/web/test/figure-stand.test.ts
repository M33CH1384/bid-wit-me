/**
 * Run It figure stand (owner 2026-11-08): when a player runs it, their
 * seated figure stands before the slam and returns to its seat after
 * the tornado. The choreography is a pure wall-clock envelope
 * (three/figureStand.ts) keyed to the SAME claim the show itself uses
 * (runFx.at / runFx.claimer — Table stamps runStand from runFx), so it
 * can never strand a figure standing: any frame, however late, computes
 * the true amount from the clock.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RUN_STAND_RISE_MS,
  RUN_STAND_RISE_START_MS,
  RUN_STAND_SIT_MS,
  RUN_STAND_SKIP_SIT_MS,
  STAND_REACH,
  standAmount,
  standFinished,
  standPelvisTarget,
  standShowEndMs,
  type StandLatch,
} from '../src/three/figureStand';
import { RUN_MEGA_SHOW_EXTRA_MS, RUN_SHOW_MS } from '../src/runIt';

const AT = 100_000;
const latch = (mega = false, skipAt: number | null = null): StandLatch => ({ at: AT, mega, skipAt });

describe('stand envelope — rise, hold, sit (normal show)', () => {
  it('is 0 before and at the rise start, fully standing by the rise end', () => {
    expect(standAmount(AT, latch())).toBe(0);
    expect(standAmount(AT + RUN_STAND_RISE_START_MS, latch())).toBe(0);
    expect(standAmount(AT + RUN_STAND_RISE_START_MS + RUN_STAND_RISE_MS, latch())).toBe(1);
  });

  it('eases smoothly — halfway through the rise is halfway up', () => {
    const mid = standAmount(AT + RUN_STAND_RISE_START_MS + RUN_STAND_RISE_MS / 2, latch());
    expect(mid).toBeCloseTo(0.5, 6);
    const quarter = standAmount(AT + RUN_STAND_RISE_START_MS + RUN_STAND_RISE_MS / 4, latch());
    expect(quarter).toBeGreaterThan(0);
    expect(quarter).toBeLessThan(0.5);
  });

  it('is fully standing before the slam phase even starts (rise ends inside the zoom window)', () => {
    // runIt.ts: the slam phase begins at RUN_ZOOM_MS = 1500; the slam
    // impact lands ~810–930 ms after that. Standing by 1050 leaves the
    // figure up well before both.
    expect(RUN_STAND_RISE_START_MS + RUN_STAND_RISE_MS).toBeLessThan(1500);
    expect(standAmount(AT + 1499, latch())).toBe(1);
  });

  it('holds standing through the slam and the whole tornado', () => {
    expect(standAmount(AT + 2400, latch())).toBe(1); // slam impact window
    expect(standAmount(AT + 4300, latch())).toBe(1); // tornado mid-flight
    expect(standAmount(AT + RUN_SHOW_MS, latch())).toBe(1); // tornado done
  });

  it('sits after the show ends and is fully re-seated RUN_STAND_SIT_MS later', () => {
    expect(standAmount(AT + RUN_SHOW_MS + RUN_STAND_SIT_MS / 2, latch())).toBeCloseTo(0.5, 6);
    expect(standAmount(AT + RUN_SHOW_MS + RUN_STAND_SIT_MS, latch())).toBe(0);
    expect(standAmount(AT + RUN_SHOW_MS + RUN_STAND_SIT_MS + 5000, latch())).toBe(0);
  });

  it('is not finished during the show, and is finished once re-seated', () => {
    expect(standFinished(AT + 3000, latch())).toBe(false);
    expect(standFinished(AT + RUN_SHOW_MS + RUN_STAND_SIT_MS - 1, latch())).toBe(false);
    expect(standFinished(AT + RUN_SHOW_MS + RUN_STAND_SIT_MS, latch())).toBe(true);
  });
});

describe('stand envelope — mega show runs longer', () => {
  it('show end is RUN_SHOW_MS + the mega extra', () => {
    expect(standShowEndMs(false)).toBe(RUN_SHOW_MS);
    expect(standShowEndMs(true)).toBe(RUN_SHOW_MS + RUN_MEGA_SHOW_EXTRA_MS);
  });

  it('still standing at the normal show end, seated after the mega sit', () => {
    const end = RUN_SHOW_MS + RUN_MEGA_SHOW_EXTRA_MS;
    expect(standAmount(AT + RUN_SHOW_MS + 100, latch(true))).toBe(1);
    expect(standAmount(AT + end + RUN_STAND_SIT_MS / 2, latch(true))).toBeCloseTo(0.5, 6);
    expect(standAmount(AT + end + RUN_STAND_SIT_MS, latch(true))).toBe(0);
    expect(standFinished(AT + end + RUN_STAND_SIT_MS, latch(true))).toBe(true);
  });
});

describe('stand envelope — skip (the player taps out of the show early)', () => {
  it('sits from fully standing over the skip duration when skipped during the hold', () => {
    const skipAt = AT + 3000;
    expect(standAmount(skipAt, latch(false, skipAt))).toBe(1);
    expect(standAmount(skipAt + RUN_STAND_SKIP_SIT_MS / 2, latch(false, skipAt))).toBeCloseTo(0.5, 6);
    expect(standAmount(skipAt + RUN_STAND_SKIP_SIT_MS, latch(false, skipAt))).toBe(0);
    expect(standFinished(skipAt + RUN_STAND_SKIP_SIT_MS, latch(false, skipAt))).toBe(true);
  });

  it('sits from a partial rise when skipped mid-rise — no snap to full height first', () => {
    const skipAt = AT + RUN_STAND_RISE_START_MS + RUN_STAND_RISE_MS / 2; // amount 0.5
    expect(standAmount(skipAt, latch(false, skipAt))).toBeCloseTo(0.5, 6);
    expect(standAmount(skipAt + RUN_STAND_SKIP_SIT_MS / 2, latch(false, skipAt))).toBeCloseTo(0.25, 6);
    expect(standAmount(skipAt + RUN_STAND_SKIP_SIT_MS, latch(false, skipAt))).toBe(0);
  });

  it('a clear at/after the natural show end is not a skip — the normal sit runs', () => {
    const skipAt = AT + RUN_SHOW_MS + 50;
    expect(standAmount(AT + RUN_SHOW_MS + RUN_STAND_SIT_MS / 2, latch(false, skipAt))).toBeCloseTo(0.5, 6);
    expect(standFinished(AT + RUN_SHOW_MS + RUN_STAND_SIT_MS, latch(false, skipAt))).toBe(true);
    expect(standFinished(AT + RUN_SHOW_MS + RUN_STAND_SIT_MS - 1, latch(false, skipAt))).toBe(false);
  });

  it('never exceeds [0, 1] anywhere on the timeline', () => {
    for (const mega of [false, true]) {
      for (let t = 0; t <= 9000; t += 137) {
        const s = standAmount(AT + t, latch(mega));
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('stand pelvis target — the standing solution of the seat solve', () => {
  // A representative seat (group space): pelvis low over the chair,
  // ankles planted on the floor 0.38 in front of the seated hips.
  const pelvis = { x: 0, y: -0.36, z: -0.16 };
  const ankleL = { x: -0.09, y: -0.83, z: 0.22 };
  const ankleR = { x: 0.09, y: -0.83, z: 0.22 };

  it('puts the pelvis over the planted ankles at near-full leg reach', () => {
    const legLen = 0.9;
    const p = standPelvisTarget(pelvis, ankleL, ankleR, legLen);
    expect(p).not.toBeNull();
    // centred over the ankles, a hair behind the ankle line
    expect(p!.x).toBeCloseTo(0, 6);
    expect(p!.z).toBeLessThan(0.22);
    expect(p!.z).toBeGreaterThan(0.22 - 0.05);
    // both hip-to-ankle distances equal the reach the pose allows
    const dL = Math.hypot(p!.x - ankleL.x, p!.y - ankleL.y, p!.z - ankleL.z);
    const dR = Math.hypot(p!.x - ankleR.x, p!.y - ankleR.y, p!.z - ankleR.z);
    expect(dL).toBeCloseTo(legLen * STAND_REACH, 3);
    expect(dR).toBeCloseTo(legLen * STAND_REACH, 3);
    // and it actually stands UP from the seat
    expect(p!.y).toBeGreaterThan(pelvis.y + 0.3);
  });

  it('follows asymmetric ankles (the pelvis centres over wherever the feet are)', () => {
    const p = standPelvisTarget(pelvis, { x: -0.02, y: -0.83, z: 0.2 }, { x: 0.14, y: -0.83, z: 0.24 }, 0.9);
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(0.06, 6);
  });

  it('refuses a stand the legs cannot carry (no fake)', () => {
    // ankles 0.6 apart with 0.2 legs: no standing solution exists
    expect(standPelvisTarget(pelvis, { x: -0.3, y: -0.83, z: 0.22 }, { x: 0.3, y: -0.83, z: 0.22 }, 0.2)).toBeNull();
  });
});

describe('wiring — the stand rides the show’s own claimer', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), 'apps/web', p), 'utf8');

  it('Table stamps runStand from runFx (claimer, claim time, mega)', () => {
    expect(src('src/Table.tsx')).toContain('runStand: runFx ? { seat: runFx.claimer, at: runFx.at, mega: runFx.mega } : null');
  });

  it('Scene forwards runStand to both figure layers', () => {
    const scene = src('src/three/Scene.tsx');
    expect(scene).toContain('runStand={props.runStand ?? null}');
    expect(scene).toContain('runStand?: { seat: number; at: number; mega: boolean } | null;');
  });

  it('both figure layers key the stand to their own seat only', () => {
    for (const f of ['src/three/PersonaFigures.tsx', 'src/three/PorchFigures.tsx']) {
      const s = src(f);
      expect(s).toContain("from './figureStand'");
      expect(s).toContain('standAt={runStand && runStand.seat === seat ? runStand.at : null}');
    }
  });
});
