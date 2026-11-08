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
  RUN_SLAM_GRIP_RELEASE_MS,
  RUN_SLAM_GRIP_SKIP_FADE_MS,
  RUN_STAND_LEAN_DIP,
  RUN_STAND_LEAN_SETTLE_MS,
  RUN_STAND_POP_OVERSHOOT,
  RUN_STAND_RISE_MS,
  RUN_STAND_RISE_START_MS,
  RUN_STAND_SIT_MS,
  RUN_STAND_SKIP_SIT_MS,
  STAND_REACH,
  slamGripFrame,
  standAmount,
  standFinished,
  standPelvisTarget,
  standRiseAmount,
  standShowEndMs,
  standSpineAmount,
  type StandLatch,
} from '../src/three/figureStand';
import {
  RUN_SLAM_FLIGHT_SEC,
  RUN_SLAM_IMPACT_T,
  runSlamGripPlan,
  runSlamPose,
  runSlamSchedule,
  type SlamGripPlan,
} from '../src/three/runSlamPose';
import { opponentFan } from '../src/three/layout';
import { playSeed, runScatter } from '../src/three/landing';
import { RUN_MEGA_SHOW_EXTRA_MS, RUN_SHOW_MS, RUN_ZOOM_MS } from '../src/runIt';
import type { Card } from '@spades/rules';

const AT = 100_000;
const latch = (mega = false, skipAt: number | null = null): StandLatch => ({ at: AT, mega, skipAt });

describe('stand envelope — rise, hold, sit (normal show)', () => {
  it('is 0 before and at the rise start, fully standing by the rise end', () => {
    expect(standAmount(AT, latch())).toBe(0);
    expect(standAmount(AT + RUN_STAND_RISE_START_MS, latch())).toBe(0);
    expect(standAmount(AT + RUN_STAND_RISE_START_MS + RUN_STAND_RISE_MS, latch())).toBe(1);
  });

  it('pops — halfway through the rise he is most of the way up (owner 2026-11-08: rise energy)', () => {
    const mid = standAmount(AT + RUN_STAND_RISE_START_MS + RUN_STAND_RISE_MS / 2, latch());
    expect(mid).toBeCloseTo(standRiseAmount(0.5), 6);
    expect(mid).toBeGreaterThan(0.8); // the old smoothstep midpoint was 0.5 — the elevator
    const quarter = standAmount(AT + RUN_STAND_RISE_START_MS + RUN_STAND_RISE_MS / 4, latch());
    expect(quarter).toBeGreaterThan(0.5); // old smoothstep quarter was ~0.16
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
    const skipAt = AT + RUN_STAND_RISE_START_MS + RUN_STAND_RISE_MS / 2; // pop amount there
    const from = standRiseAmount(0.5);
    expect(standAmount(skipAt, latch(false, skipAt))).toBeCloseTo(from, 6);
    expect(standAmount(skipAt + RUN_STAND_SKIP_SIT_MS / 2, latch(false, skipAt))).toBeCloseTo(from / 2, 6);
    expect(standAmount(skipAt + RUN_STAND_SKIP_SIT_MS, latch(false, skipAt))).toBe(0);
  });

  it('a clear at/after the natural show end is not a skip — the normal sit runs', () => {
    const skipAt = AT + RUN_SHOW_MS + 50;
    expect(standAmount(AT + RUN_SHOW_MS + RUN_STAND_SIT_MS / 2, latch(false, skipAt))).toBeCloseTo(0.5, 6);
    expect(standFinished(AT + RUN_SHOW_MS + RUN_STAND_SIT_MS, latch(false, skipAt))).toBe(true);
    expect(standFinished(AT + RUN_SHOW_MS + RUN_STAND_SIT_MS - 1, latch(false, skipAt))).toBe(false);
  });

  it('exceeds 1 only inside the rise window, and only by the bounded pop overshoot', () => {
    const riseEnd = RUN_STAND_RISE_START_MS + RUN_STAND_RISE_MS;
    for (const mega of [false, true]) {
      for (let t = 0; t <= 9000; t += 37) {
        const s = standAmount(AT + t, latch(mega));
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1 + RUN_STAND_POP_OVERSHOOT + 0.005);
        if (t >= riseEnd) expect(s).toBeLessThanOrEqual(1); // hold + sit never overshoot
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

  it('Table stamps runStand from runFx (claimer, claim time, mega, cards)', () => {
    expect(src('src/Table.tsx')).toContain('runStand: runFx ? { seat: runFx.claimer, at: runFx.at, mega: runFx.mega, cards: runFx.cards } : null');
  });

  it('Scene forwards runStand to both figure layers', () => {
    const scene = src('src/three/Scene.tsx');
    expect(scene).toContain('runStand={props.runStand ?? null}');
    expect(scene).toContain('runStand?: { seat: number; at: number; mega: boolean; cards: Card[] } | null;');
  });

  it('both figure layers key the stand to their own seat only', () => {
    for (const f of ['src/three/PersonaFigures.tsx', 'src/three/PorchFigures.tsx']) {
      const s = src(f);
      expect(s).toContain("from './figureStand'");
      expect(s).toContain('standAt={runStand && runStand.seat === seat ? runStand.at : null}');
    }
  });
});

describe('rise pop curve (owner 2026-11-08: "didn\'t get up with the right energy")', () => {
  it('starts at 0 and lands on exactly 1 at the deadline — no bounce loop', () => {
    expect(standRiseAmount(0)).toBe(0);
    expect(standRiseAmount(1)).toBe(1);
    expect(standRiseAmount(1.5)).toBe(1);
    expect(standRiseAmount(-0.2)).toBe(0);
  });

  it('is fast through the first portion — a pop, not an elevator', () => {
    expect(standRiseAmount(0.3)).toBeGreaterThan(0.6); // smoothstep gave 0.216 here
    expect(standRiseAmount(0.5)).toBeGreaterThan(0.85);
  });

  it('overshoots by a few percent near the top of the rise, then settles onto 1', () => {
    let peak = 0; let peakU = 0;
    for (let u = 0; u <= 1.0001; u += 0.005) {
      const v = standRiseAmount(u);
      if (v > peak) { peak = v; peakU = u; }
    }
    expect(peak).toBeGreaterThan(1.005); // the overshoot exists
    expect(peak).toBeLessThan(1.04); // and stays bounded / dignified
    expect(peakU).toBeGreaterThan(0.6);
    expect(peakU).toBeLessThan(0.95);
    expect(standRiseAmount(0.99)).toBeLessThan(peak); // settling, not still climbing
  });

  it('the stand amount at the rise end is exactly 1 — fully standing by 1050 ms stands', () => {
    expect(standAmount(AT + RUN_STAND_RISE_START_MS + RUN_STAND_RISE_MS, latch())).toBe(1);
  });
});

describe('spine coil — a touch of forward eagerness at the top of the rise', () => {
  const riseEnd = RUN_STAND_RISE_START_MS + RUN_STAND_RISE_MS;

  it('matches the stand amount before the coil window (early rise is one motion)', () => {
    const t = AT + RUN_STAND_RISE_START_MS + RUN_STAND_RISE_MS * 0.3;
    expect(standSpineAmount(t, latch())).toBeCloseTo(standAmount(t, latch()), 6);
  });

  it('is still a touch leaned-in when the pelvis arrives (coiled over the table)', () => {
    const spine = standSpineAmount(AT + riseEnd, latch());
    expect(spine).toBeCloseTo(1 - RUN_STAND_LEAN_DIP, 6);
    expect(spine).toBeLessThan(standAmount(AT + riseEnd, latch()));
  });

  it('settles fully upright by the end of the settle window — before the slam lands', () => {
    expect(standSpineAmount(AT + riseEnd + RUN_STAND_LEAN_SETTLE_MS, latch())).toBe(1);
    expect(standSpineAmount(AT + 1499, latch())).toBe(1); // slam phase starts at 1500
  });

  it('equals the stand amount through the sit (the coil is long gone)', () => {
    const t = AT + RUN_SHOW_MS + RUN_STAND_SIT_MS / 2;
    expect(standSpineAmount(t, latch())).toBeCloseTo(standAmount(t, latch()), 6);
  });

  it('never goes negative or past the stand amount', () => {
    for (let t = 0; t <= 9000; t += 53) {
      const s = standSpineAmount(AT + t, latch());
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(standAmount(AT + t, latch()) + 1e-9);
    }
  });
});

describe('slam grip plan — the middle run card, computed with the show\'s own calls', () => {
  const cards = ['A♠', 'K♠', 'Q♠', 'J♠', '10♠'] as Card[];
  const plan = runSlamGripPlan({
    gameSeed: 'seed-1', handNo: 3, seat: 1, at: AT,
    cards, seatPos: 'left', n: 4, drop: 0, pinch: 0,
  });

  it('exists for a real claim and starts at the slam phase (claim + RUN_ZOOM_MS)', () => {
    expect(plan).not.toBeNull();
    expect(plan!.seat).toBe(1);
    expect(plan!.at).toBe(AT);
    expect(plan!.startAt).toBe(AT + RUN_ZOOM_MS);
  });

  it('from is the middle card\'s own fan departure slot (same opponentFan call Cards makes)', () => {
    const m = Math.round((cards.length - 1) / 2);
    expect(plan!.from).toEqual(opponentFan('left', 4, Math.min(m, cards.length - 1), cards.length, 0, 0));
  });

  it('delay and duration come from the show\'s own schedule (0.02 + compressed delay, RUN_SLAM_FLIGHT_SEC)', () => {
    const m = Math.round((cards.length - 1) / 2);
    const sched = runSlamSchedule(runScatter(playSeed('seed-1', 3, 99, 'runit:1'), cards.length));
    expect(plan!.delaySec).toBeCloseTo(0.02 + sched[m]!.delay, 9);
    expect(plan!.durationSec).toBe(RUN_SLAM_FLIGHT_SEC);
  });

  it('is null for an empty claim', () => {
    expect(runSlamGripPlan({
      gameSeed: 'seed-1', handNo: 3, seat: 1, at: AT,
      cards: [] as Card[], seatPos: 'left', n: 4, drop: 0, pinch: 0,
    })).toBeNull();
  });
});

describe('slam grip frame — hands ride the show\'s own slam path, then let go for the tornado', () => {
  const cards = ['A♠', 'K♠', 'Q♠', 'J♠', '10♠'] as Card[];
  const plan = runSlamGripPlan({
    gameSeed: 'seed-1', handNo: 3, seat: 1, at: AT,
    cards, seatPos: 'left', n: 4, drop: 0, pinch: 0,
  })!;
  const strikeMs = (plan.delaySec + RUN_SLAM_IMPACT_T * plan.durationSec) * 1000;

  it('during the zoom the hands stay on the fan (frame = the departure slot, fully engaged)', () => {
    const f = slamGripFrame(AT + 800, latch(), plan);
    expect(f).not.toBeNull();
    expect(f!.engage).toBe(1);
    expect(f!.p).toEqual(plan.from.p);
    expect(f!.q).toEqual(plan.from.q);
  });

  it('mid-flight the frame IS runSlamPose at the same flight t the card flies', () => {
    const ft = 0.3;
    const now = plan.startAt + (plan.delaySec + ft * plan.durationSec) * 1000;
    const f = slamGripFrame(now, latch(), plan);
    const pose = runSlamPose(plan.from, plan.to, ft);
    f!.p.forEach((v, i) => expect(v).toBeCloseTo(pose.p[i]!, 9));
    f!.q.forEach((v, i) => expect(v).toBeCloseTo(pose.q[i]!, 9));
    expect(f!.engage).toBe(1);
  });

  it('at the strike the hands arrive WITH the card (pose at RUN_SLAM_IMPACT_T, still gripping)', () => {
    const f = slamGripFrame(plan.startAt + strikeMs, latch(), plan);
    const pose = runSlamPose(plan.from, plan.to, RUN_SLAM_IMPACT_T);
    f!.p.forEach((v, i) => expect(v).toBeCloseTo(pose.p[i]!, 9));
    expect(f!.engage).toBe(1);
  });

  it('releases across the release window and is gone before the tornado takes the cards', () => {
    const mid = slamGripFrame(plan.startAt + strikeMs + RUN_SLAM_GRIP_RELEASE_MS / 2, latch(), plan);
    expect(mid!.engage).toBeCloseTo(0.5, 6);
    expect(slamGripFrame(plan.startAt + strikeMs + RUN_SLAM_GRIP_RELEASE_MS, latch(), plan)).toBeNull();
    // tornado fires at slam + 1750 ms — the hands let go well before
    expect(strikeMs + RUN_SLAM_GRIP_RELEASE_MS).toBeLessThan(1750);
    expect(slamGripFrame(AT + RUN_SHOW_MS, latch(), plan)).toBeNull();
  });

  it('a plan from a different claim never binds (at mismatch → null)', () => {
    expect(slamGripFrame(AT + 800, latch(), { ...plan, at: AT + 9999 })).toBeNull();
    expect(slamGripFrame(AT + 800, { at: AT + 9999, mega: false, skipAt: null }, plan)).toBeNull();
  });

  it('on skip the pose freezes at the skip moment and the grip fades out fast', () => {
    const skipAt = plan.startAt + (plan.delaySec + 0.3 * plan.durationSec) * 1000;
    const l = latch(false, skipAt);
    const frozen = slamGripFrame(skipAt, l, plan);
    const later = slamGripFrame(skipAt + RUN_SLAM_GRIP_SKIP_FADE_MS / 2, l, plan);
    expect(later!.p).toEqual(frozen!.p); // frozen — no continued flight
    expect(later!.engage).toBeCloseTo(0.5, 6);
    expect(slamGripFrame(skipAt + RUN_SLAM_GRIP_SKIP_FADE_MS, l, plan)).toBeNull();
  });
});
