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
import { cameraFor, opponentFan, trickSpot, type CamSpec, type Xform } from '../src/three/layout';
import { PerspectiveCamera, Vector3 } from 'three';
import * as SceneModule from '../src/three/Scene';
import { peopleSpec } from '../src/three/Scene';
import { CHAIR_SPOTS } from '../src/three/classicStudioLayout';
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

describe('slam grip plan — the HUMAN claimer departs from his held strip slot', () => {
  // runSlamGripPlan's default origin is opponentFan — the call Cards
  // makes for a figure-seated claimer. The human's cards do not sit
  // in a fan: the slam builder departs them from his held strip
  // slots (departureSlot over held.current). Until the viewer's own
  // figure existed (owner 2026-11-08) no figure ever consumed a
  // human claim's plan, so the mismatch was inert; with his figure
  // standing for his own run, the plan must start where his cards
  // actually start or his hands tear off the middle card.
  const cards = ['A♠', 'K♠', 'Q♠', 'J♠', '10♠'] as Card[];
  const heldSlot: Xform = { p: [0.12, 0.46, 2.62], q: [0, 0, 0, 1], s: 1 };

  it('uses the held-slot override as the plan origin when given', () => {
    const plan = runSlamGripPlan({
      gameSeed: 'seed-1', handNo: 3, seat: 0, at: AT,
      cards, seatPos: 'bottom', n: 4, drop: 0, pinch: 0,
      fromOverride: heldSlot,
    });
    expect(plan).not.toBeNull();
    expect(plan!.from).toEqual(heldSlot);
    // the rest of the plan is the show's own schedule, unchanged
    expect(plan!.startAt).toBe(AT + RUN_ZOOM_MS);
  });

  it('without an override the origin is the fan slot, exactly as shipped for figure claimers', () => {
    const plan = runSlamGripPlan({
      gameSeed: 'seed-1', handNo: 3, seat: 0, at: AT,
      cards, seatPos: 'bottom', n: 4, drop: 0, pinch: 0,
    });
    const m = Math.round((cards.length - 1) / 2);
    expect(plan!.from).toEqual(opponentFan('bottom', 4, Math.min(m, cards.length - 1), cards.length, 0, 0));
  });

  it('Scene passes the override only for the human claimer, from the builder’s own departureSlot call', () => {
    const scene = readFileSync(join(process.cwd(), 'apps/web/src/three/Scene.tsx'), 'utf8');
    expect(scene).toContain('fromOverride: rs.seat === human && midCard ? departureSlot(held.current.slots, held.current.cards, midCard) : undefined');
    const pose = readFileSync(join(process.cwd(), 'apps/web/src/three/runSlamPose.ts'), 'utf8');
    expect(pose).toContain('fromOverride?: Xform');
    expect(pose).toContain('from: args.fromOverride ?? opponentFan(');
  });
});

describe('wiring — the viewer’s own player stands for his own run (owner 2026-11-08)', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), 'apps/web', p), 'utf8');

  it('Table resolves the viewer’s own figure key from his seat name (spectators: none)', () => {
    const table = src('src/Table.tsx');
    expect(table).toContain("ownFigureKey: spectating ? null : personaFigureKeyForName(names[HUMAN] ?? '')");
    // and his GLB joins the High asset gate, so the body is warm before he can claim
    expect(table).toContain('glb figure (own run-it ');
  });

  it('Scene threads ownFigureKey through both figure layers — and no camera branch keys on his claim (owner correction 2026-11-08)', () => {
    const scene = src('src/three/Scene.tsx');
    expect(scene).toContain('ownFigureKey?: string | null;');
    expect(scene).toContain('ownFigureKey={props.ownFigureKey ?? null}');
    expect(scene).toContain('ownSeat={props.human}');
    // The owner simplified his ask — jump to standing, then slam —
    // so the camera does for his run exactly what it does for a
    // bot's: the rig renders the base spec unconditionally, and no
    // own-show framing survives anywhere in the file, in code or
    // in comment.
    expect(scene).toContain('const spec = base;');
    expect(scene).not.toContain('ownShow');
    expect(scene).not.toContain('OWN_SHOW_CAM');
    expect(scene).not.toContain('showM');
  });

  it('Scene exports no own-show camera helper at runtime', () => {
    expect((SceneModule as Record<string, unknown>).ownShowSpec).toBeUndefined();
    expect((SceneModule as Record<string, unknown>).OWN_SHOW_CAM).toBeUndefined();
  });

  it('the fan refit takes no input from the claim — his fan layout during his show equals the layout outside it', () => {
    const scene = src('src/three/Scene.tsx');
    // the pre-lane (a91a19e) refit, restored verbatim: its only
    // inputs are the people framing, the player's saved tilt/zoom
    // and the motion sway — the live claim (runStand /
    // ownFigureKey) appears nowhere in it, so the hand cannot move
    // when his show starts or ends
    expect(scene).toContain('if (!peopleCam && isDefaultViewAdjust(vaState.adj) && swayDeg === 0) return null;');
    expect(scene).toContain('const base = peopleCam ? people : stock;');
    expect(scene).toContain('return peopleM ? adjM.multiply(peopleM) : adjM;');
    expect(scene).toContain('}, [peopleCam, aspect, short, view, vaState.adj, swayDeg]);');
  });

  it('both figure layers hold a show-window latch for the viewer’s seat and nothing else changes', () => {
    for (const f of ['src/three/PersonaFigures.tsx', 'src/three/PorchFigures.tsx']) {
      const s = src(f);
      expect(s).toContain('ownFigureKey?: string | null;');
      expect(s).toContain('ownSeat?: number;');
      expect(s).toContain('setOwnClaim');
      // the figure leaves exactly when the envelope finishes — the
      // natural deadline is the show end + the full sit, never a
      // mid-motion unmount
      expect(s).toContain('claim.at + standShowEndMs(claim.mega) + RUN_STAND_SIT_MS + 250');
      expect(s).toContain('RUN_STAND_SKIP_SIT_MS + 250');
    }
    // PorchFigures resolves the viewer's story figure through the
    // same persona register table the regular layer uses — one asset
    // path, no second register
    expect(src('src/three/PersonaFigures.tsx')).toContain('export { FIGURE_REGISTERS as PERSONA_FIGURE_REGISTERS };');
    expect(src('src/three/PorchFigures.tsx')).toContain('PERSONA_FIGURE_REGISTERS');
  });
});
describe('own show under the standard camera — framing truth on record (owner correction 2026-11-08)', () => {
  // The owner took the standard camera for his own show, knowing
  // the standing figure at his own seat (bottom edge, dead ahead of
  // the lens) may be partly cropped — the camera no longer moves
  // for him. This block MEASURES that truth with the retired
  // proof's disc model and leaves the numbers in the test log for
  // his glance; it gates on nothing but the projection running.
  // (The occlusion gate itself was retired with the show framing
  // it justified.) Silhouette placement as in the retired proof:
  // pelvis over the ankles at standE = 1, head directly above it,
  // at both bottom-spot geometries in the game (studio 2.8 / kit
  // 1.98), both floor heights, the shipped stature band.
  const poseSrc = (p: string) => readFileSync(join(process.cwd(), 'apps/web', p), 'utf8');
  const statures = [...poseSrc('src/three/PersonaFigures.tsx').matchAll(/stature: ([\d.]+)/g),
    ...poseSrc('src/three/PorchFigures.tsx').matchAll(/stature: ([\d.]+)/g)].map((m) => Number(m[1]));
  const FIG_SCALE = 1.33; // FIGURE_SCALE in both figure layers
  const spots = [CHAIR_SPOTS[1]!.z, 1.98];
  const floors = [-0.9, -0.855]; // FLOOR_Y; the beach mural floor sits 4.5 cm higher
  const pile = trickSpot('bottom', 4, 1, 0).p;
  const pileP: [number, number, number] = [pile[0]!, pile[1]!, pile[2]!];
  const vortexC: [number, number, number] = [0, 1.05, 0]; // the tornado's column centre over the felt

  const camOf = (spec: CamSpec, aspect: number) => {
    const cam = new PerspectiveCamera(spec.fov, aspect, 0.05, 60);
    cam.position.set(...spec.pos);
    cam.lookAt(new Vector3(...spec.look));
    cam.updateMatrixWorld(true);
    return cam;
  };
  const ndc = (cam: PerspectiveCamera, p: [number, number, number]) => new Vector3(...p).project(cam);
  function clearance(cam: PerspectiveCamera, P: [number, number, number], headY: number, headZ: number, pelvisY: number, aspect: number) {
    const p = ndc(cam, P);
    const discs: { c: [number, number, number]; r: number }[] = [
      { c: [0, headY - 0.13, headZ], r: 0.14 },
      { c: [0, headY - 0.45, headZ + 0.05], r: 0.26 },
      { c: [0, pelvisY + 0.1, headZ + 0.03], r: 0.24 },
      { c: [-0.11, (pelvisY - 0.9) / 2 + 0.2, headZ + 0.02], r: 0.095 },
      { c: [0.11, (pelvisY - 0.9) / 2 + 0.2, headZ + 0.02], r: 0.095 },
    ];
    let worst = Infinity;
    for (const d of discs) {
      const c = ndc(cam, d.c);
      const rx = Math.abs(ndc(cam, [d.c[0] + d.r, d.c[1], d.c[2]]).x - c.x);
      const ry = Math.abs(ndc(cam, [d.c[0], d.c[1] + d.r, d.c[2]]).y - c.y);
      const dist = Math.hypot((p.x - c.x) * aspect, p.y - c.y);
      worst = Math.min(worst, dist - Math.max(rx * aspect, ry));
    }
    return worst;
  }
  const views: { name: string; aspect: number; short: boolean; view: 'standing' | 'sitting'; people?: boolean }[] = [
    { name: 'portrait-standing', aspect: 390 / 844, short: false, view: 'standing' },
    { name: 'portrait-sitting', aspect: 390 / 844, short: false, view: 'sitting' },
    { name: 'landscape-standing', aspect: 932 / 430, short: true, view: 'standing' },
    { name: 'landscape-sitting', aspect: 932 / 430, short: true, view: 'sitting' },
    { name: 'portrait-sitting-people', aspect: 390 / 844, short: false, view: 'sitting', people: true },
    { name: 'landscape-sitting-people', aspect: 932 / 430, short: true, view: 'sitting', people: true },
    { name: 'desktop-standing', aspect: 1440 / 900, short: false, view: 'standing' },
    { name: 'desktop-sitting', aspect: 1440 / 900, short: false, view: 'sitting' },
  ];
  const band = [Math.min(...statures), (Math.min(...statures) + Math.max(...statures)) / 2, Math.max(...statures)];

  it('the register band the measurement runs against is the shipped one (1.6–1.95 m)', () => {
    expect(Math.min(...statures)).toBeGreaterThanOrEqual(1.6);
    expect(Math.max(...statures)).toBeLessThanOrEqual(1.95);
  });

  it('records, per view, the head line, the in-frame body span and the pile/vortex clearance under the standard camera', () => {
    const rows: string[] = [];
    for (const v of views) {
      let base = cameraFor(v.aspect, v.short, v.view);
      if (v.people) base = peopleSpec(base);
      const cam = camOf(base, v.aspect);
      let worstPile = Infinity;
      let worstVortex = Infinity;
      let headTopMin = Infinity;
      let headTopMax = -Infinity;
      let spanMin = Infinity;
      for (const sz of spots) for (const floorY of floors) for (const st of band) {
        const headY = floorY + st * FIG_SCALE;
        const headZ = sz - 0.2;
        const pelvisY = floorY + st * FIG_SCALE * 0.52;
        worstPile = Math.min(worstPile, clearance(cam, pileP, headY, headZ, pelvisY, v.aspect));
        worstVortex = Math.min(worstVortex, clearance(cam, vortexC, headY, headZ, pelvisY, v.aspect));
        const top = ndc(cam, [0, headY, headZ]).y;
        headTopMin = Math.min(headTopMin, top);
        headTopMax = Math.max(headTopMax, top);
        // the share of the body's vertical extent (floor to head
        // top, in NDC) that lands inside the frame's [-1, 1]
        const feet = ndc(cam, [0, floorY, headZ]).y;
        const span = Math.max(0, Math.min(top, 1) - Math.max(feet, -1)) / Math.max(1e-6, top - feet);
        spanMin = Math.min(spanMin, span);
      }
      rows.push(`${v.name}: headTop NDC ${headTopMin.toFixed(2)}..${headTopMax.toFixed(2)} | body in frame ≥ ${(spanMin * 100).toFixed(0)}% | pile clearance ${worstPile.toFixed(3)} | vortex clearance ${worstVortex.toFixed(3)}`);
      expect(Number.isFinite(worstPile)).toBe(true);
      expect(Number.isFinite(worstVortex)).toBe(true);
    }
    // eslint-disable-next-line no-console
    console.log('\n[framing truth — standard camera, viewer’s own show]\n' + rows.join('\n'));
  });
});
