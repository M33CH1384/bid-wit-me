/**
 * The settled-table pulse gate (perf fix B, 2026-11-03): the policy
 * half of three/framePulse.ts. The measured defect: continuous-life
 * tickers (figure breath/sway, crowd, venue ambience) demanded a full
 * scene render 20x/second at a settled table — ~110 draw calls a
 * frame, the sustained load behind the owner's heat/battery/slow-
 * motion reports. The gate must (a) pass every pulse while the table
 * is active, (b) coalesce settled pulses to one shared slot per
 * SETTLED_PULSE_MS across all tickers, and (c) re-open full cadence
 * the instant activity is noted again.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACTIVITY_WINDOW_MS,
  SETTLED_PULSE_MS,
  noteSceneActivity,
  pulseDue,
  resetFramePulseForTest,
  sceneIsActive,
} from '../src/three/framePulse';

beforeEach(() => { resetFramePulseForTest(); });

describe('framePulse gate', () => {
  it('starts settled: the first pulse passes, immediate repeats do not', () => {
    expect(sceneIsActive(10_000)).toBe(false);
    expect(pulseDue(10_000)).toBe(true);
    expect(pulseDue(10_050)).toBe(false);
    expect(pulseDue(10_100)).toBe(false);
  });

  it('settled pulses are spaced by SETTLED_PULSE_MS, shared across tickers', () => {
    expect(pulseDue(0)).toBe(true);
    expect(pulseDue(SETTLED_PULSE_MS - 1)).toBe(false);
    expect(pulseDue(SETTLED_PULSE_MS)).toBe(true);
    // a second ticker asking in the same slot gets nothing — the
    // rates coalesce instead of stacking
    expect(pulseDue(SETTLED_PULSE_MS + 10)).toBe(false);
    expect(pulseDue(2 * SETTLED_PULSE_MS)).toBe(true);
  });

  it('activity opens the full cadence for the whole window', () => {
    noteSceneActivity(5_000);
    expect(sceneIsActive(5_000)).toBe(true);
    for (let t = 5_000; t < 5_000 + ACTIVITY_WINDOW_MS; t += 50) {
      expect(pulseDue(t)).toBe(true);
    }
    expect(sceneIsActive(5_000 + ACTIVITY_WINDOW_MS)).toBe(false);
  });

  it('activity noted mid-settle re-opens instantly (no first-frame hitch)', () => {
    expect(pulseDue(0)).toBe(true);
    expect(pulseDue(50)).toBe(false); // settled: gated
    noteSceneActivity(60); // a play lands
    expect(pulseDue(60)).toBe(true);
    expect(pulseDue(110)).toBe(true);
  });

  it('the settled rate is at least a 4x cut against the 50 ms ticker family', () => {
    // 20 demands/sec at full cadence vs one per SETTLED_PULSE_MS
    expect(1000 / SETTLED_PULSE_MS).toBeLessThanOrEqual(20 / 4);
  });
});

describe('framePulse wiring (source pins)', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

  it('every continuous-life ticker routes through the gate', () => {
    for (const f of ['three/PersonaFigures.tsx', 'three/PorchFigures.tsx', 'three/KingRail.tsx', 'three/Venue3D.tsx', 'three/CornerStreetRoom.tsx', 'three/cubeVenue.tsx']) {
      expect(src(f), f).toContain('pulseDue()');
    }
  });

  it('a live seat video notes activity instead of gating (its texture is the content)', () => {
    expect(src('three/SeatVideo.tsx')).toContain('noteSceneActivity()');
  });

  it('the scene notes activity on game flow and on felt touches', () => {
    const scene = src('three/Scene.tsx');
    expect(scene).toContain('noteSceneActivity()');
    expect(scene).toContain("addEventListener('pointerdown'");
  });
});
