/**
 * @vitest-environment happy-dom
 *
 * The King's rail at the table (owner report, 2026-10-26: "I didnt see
 * anyone at the table at all"). The diagnosis: the rail cast was never a
 * data bug — railCastForAttempt deals the full 20 at the King, the story
 * session checkpoints it, resume restores it — but the cast's faces only
 * ever rendered in the ScriptPlayer intro/outro strip, story resume skips
 * the intro by design, and the King's moment rules (cap 3, quiet after
 * hand 3) leave a resumed Hand 4+ table with at most one witness line.
 * A design-realization gap: presence itself is the statement at the
 * finale, so the cast now stands at the table for the whole match.
 *
 * REALIZATION (owner, 2026-10-26, later the same day): the first fix
 * rendered the cast as DOM face-coin columns and was rejected on
 * sight — "remember this is a 3d table, they should be standing
 * around the table as human figures not coins with faces." The cast
 * now renders as standing figures INSIDE the 3D scene
 * (three/KingRail.tsx + three/kingRailLayout.ts), animated (seeded
 * idle, stir reactions, speaker leans), and the seated King / Ringer /
 * Dee are figures too, their plates gone to info strips. These pins
 * cover: the full cast on first entry AND resume (round-trip through
 * the session save), the gate's derivation matching the scene
 * channel's precedence, the coin columns GONE, figure completeness /
 * order / placement / occlusion envelopes, animation staggering,
 * reduced-motion stillness (source gates), seated identities and
 * plate parity, and no other stop gaining any of it.
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_CHARACTERS, STORY_RAIL, STORY_STOPS, railCastForAttempt, type StoryStop } from '@spades/bots';
import { makeRules, newGame } from '@spades/rules';
import Table, { kingRailCastFor } from '../src/Table';
import { loadStoryGame, saveStoryGame, type StorySavedGame } from '../src/story/storySave';
import { DEFAULT_SETTINGS } from '../src/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const king = STORY_STOPS.find((s) => s.id === 'king')!;
const porch = STORY_STOPS.find((s) => s.id === 'porch')!;
const legends = STORY_STOPS.find((s) => s.id === 'legends')!;
const FULL = [...STORY_RAIL['king']!];

/* The story prop StoryHome hands the table, in its three King shapes. */
const factsFor = (stop: StoryStop) => ({ attempts: 10, clears: 1, cleared: false, clearedStopIds: STORY_STOPS.slice(0, 10).map((s) => s.id) });
const storyProp = (stop: StoryStop, saveCtx?: object) => ({
  names: ['You', stop.pair[0]!.name, 'Dee', stop.pair[1]!.name],
  levelFor: () => 'pro' as const,
  onGameOver: () => {},
  scene: { stop, facts: factsFor(stop) },
  ...(saveCtx ? { saveCtx } : {}),
});

describe('the King contract: the full cast, first entry and resume', () => {
  it('the draw itself: the King deals the full 20 every attempt; Porch and High-Rise stay empty by design', () => {
    expect(FULL).toHaveLength(20);
    for (const n of [1, 2, 7]) expect(railCastForAttempt('king', n)).toEqual(FULL);
    expect(railCastForAttempt('porch', 1)).toEqual([]);
    expect(railCastForAttempt('high-rise', 3)).toEqual([]);
  });

  it('first entry: the attempt cast StoryHome drew is the cast at the table', () => {
    const story = storyProp(king, { attemptsAtStart: 0, clearsAtStart: 0, resumed: false, railCast: railCastForAttempt('king', 1) });
    expect(kingRailCastFor(story as never)).toEqual(FULL);
  });

  it('legacy first entry (no drawn cast anywhere): the local draw still deals the full 20', () => {
    const story = storyProp(king, { attemptsAtStart: 3, clearsAtStart: 0, resumed: false });
    expect(kingRailCastFor(story as never)).toEqual(FULL);
  });

  it('resume: the saved session cast wins — the exact faces the match started with', () => {
    const story = storyProp(king, {
      attemptsAtStart: 0, clearsAtStart: 0, resumed: true,
      initialSession: { fired: [], memory: [], satDown: true, railCast: [...FULL] },
    });
    expect(kingRailCastFor(story as never)).toEqual(FULL);
  });

  it('the derivation precedence matches the scene channel: saved cast > drawn cast > local draw', () => {
    // A marker cast proves precedence (production King casts are always the
    // full pool; the ORDER is what this pins — the faces shown must be the
    // faces the chime-in channel speaks from).
    const marker = ['queenie', 'ace'];
    const both = storyProp(king, {
      attemptsAtStart: 0, clearsAtStart: 0, resumed: true, railCast: ['pat'],
      initialSession: { fired: [], memory: [], satDown: true, railCast: marker },
    });
    expect(kingRailCastFor(both as never)).toEqual(marker);
    const drawnOnly = storyProp(king, { attemptsAtStart: 0, clearsAtStart: 0, resumed: false, railCast: ['pat'] });
    expect(kingRailCastFor(drawnOnly as never)).toEqual(['pat']);
  });

  it('unknown ids never reach the felt (a corrupt cast renders only real faces)', () => {
    const story = storyProp(king, { attemptsAtStart: 0, clearsAtStart: 0, resumed: false, railCast: ['pat', 'nobody', 'ace'] });
    expect(kingRailCastFor(story as never)).toEqual(['pat', 'ace']);
  });

  it('no other stop gains an in-match rail — not even with a cast in hand', () => {
    for (const stop of [porch, legends]) {
      const story = storyProp(stop, { attemptsAtStart: 0, clearsAtStart: 0, resumed: false, railCast: railCastForAttempt(stop.id, 1) });
      expect(kingRailCastFor(story as never), stop.id).toEqual([]);
    }
    expect(kingRailCastFor(undefined)).toEqual([]);
    expect(kingRailCastFor({} as never)).toEqual([]);
  });

  it('round-trip: a resumed King save carries the full cast through the session slot', () => {
    const st = newGame(makeRules('joker'), 'king-rail-seed');
    const save: StorySavedGame = {
      v: 1, savedAt: 1, seed: 'king-rail-seed', settings: DEFAULT_SETTINGS, state: st, chat: [],
      names: ['You', 'The King', 'Dee', 'Ringer'],
      story: {
        stopId: 'king', track: 'solo', attemptsAtStart: 0, clearsAtStart: 0,
        session: { fired: [], memory: [], satDown: true, railCast: railCastForAttempt('king', 1) },
      },
    };
    saveStoryGame(save, save.story);
    const back = loadStoryGame();
    expect(back?.story.session.railCast).toEqual(FULL);
    // …and the gate over the restored session deals those same faces.
    const story = storyProp(king, {
      attemptsAtStart: back!.story.attemptsAtStart, clearsAtStart: 0, resumed: true,
      initialSession: back!.story.session,
    });
    expect(kingRailCastFor(story as never)).toEqual(FULL);
  });
});

/* ------------------------------------------------- the figures (3D) */

import { Vector3 } from 'three';
import { makeCamera } from '../src/three/layout';
import {
  POSE_INFLATE, RAIL_FLOOR_Y, attentionYawFor, crowdPoseAt, faceCorners, figureCorners,
  kingRailFigures, newCrowdCue, restPose, seatedFaceCorners, seatedFigureFor, seatedPoseAt,
  stampSpeaker, stampStir, stampSeatSpeaker,
} from '../src/three/kingRailLayout';

const readSrc = (rel: string) => {
  const p = [`apps/web/${rel}`, rel].find((c) => { try { readFileSync(c, 'utf8'); return true; } catch { return false; } })!;
  return readFileSync(p, 'utf8');
};

describe('the coin columns are gone (negative pins)', () => {
  it('Table renders no king-rail DOM; styles.css carries no king-rail rules', () => {
    const table = readSrc('src/Table.tsx');
    expect(table).not.toContain('data-testid="king-rail"');
    expect(table).not.toContain('king-rail-face-');
    expect(table).not.toContain('kingRailHalf');
    const css = readSrc('src/styles.css');
    expect(css).not.toContain('.king-rail {');
    expect(css).not.toContain('.king-rail-side');
    expect(css).not.toContain('king-rail-face');
    // …and the seated figures' info-strip plate form exists instead.
    expect(css).toContain('.plate.plate--fig');
  });

  it('the scene mounts the figures, gated on the King cast / seated figures', () => {
    const scene = readSrc('src/three/Scene.tsx');
    expect(scene).toContain("import KingRail from './KingRail'");
    expect(scene).toContain('props.kingRailCast?.length ?? 0) > 0');
    expect(scene).toContain('crowdAnimate');
    const table = readSrc('src/Table.tsx');
    expect(table).toContain('kingRailCast={kingRail}');
    expect(table).toContain('seatedFigures={seatedFiguresArr}');
    expect(table).toContain('crowdAnimate={!reduceFx && !fx.osReducedMotion}');
  });

  it('co-op inherits the same gate: OnlineTable deals the cast + seated figures only at the King stop', () => {
    const ot = readSrc('src/online/OnlineTable.tsx');
    expect(ot).toContain("room.story?.stopId === 'king' ? railCastForAttempt('king', 1) : undefined");
    expect(ot).toContain("room.story?.stopId === 'king'");
    expect(ot).toContain('seatedFigures:');
  });
});

describe('crowd placement: complete, ordered, deterministic, off the felt', () => {
  const figs = kingRailFigures(FULL);

  it('one figure per cast member — the complete 20, in cast order', () => {
    expect(figs).toHaveLength(20);
    expect(figs.map((f) => f.id)).toEqual(FULL);
    // The seated three are never in the crowd.
    for (const seated of ['king', 'ringer', 'dee']) expect(FULL).not.toContain(seated);
  });

  it('the ring reads left-to-right in cast order (slots sorted by angle)', () => {
    const angles = figs.map((f) => Math.atan2(f.x, -f.z));
    for (let i = 1; i < angles.length; i++) expect(angles[i]!).toBeGreaterThan(angles[i - 1]!);
  });

  it('deterministic: the same cast deals the identical ring (resume-safe)', () => {
    expect(kingRailFigures(FULL)).toEqual(figs);
    expect(kingRailFigures([...FULL].reverse()).map((f) => f.id)).toEqual([...FULL].reverse());
  });

  it('life-size, feet on the venue floor, everybody outside the felt + rail', () => {
    for (const f of figs) {
      expect(f.height).toBeGreaterThanOrEqual(1.63);
      expect(f.height).toBeLessThanOrEqual(1.82);
      const corners = figureCorners(f);
      expect(Math.min(...corners.map((c) => c.y))).toBeCloseTo(RAIL_FLOOR_Y, 6);
      expect(Math.max(...corners.map((c) => c.y))).toBeCloseTo(RAIL_FLOOR_Y + f.height, 6);
      // Outside the felt's bounds (1.5 × 1.78 + 0.2 rail) with margin:
      // the ring never enters the table's footprint.
      const radial = Math.hypot(f.x / 1.78, f.z / 2.06);
      expect(radial, f.id).toBeGreaterThan(1.05);
      // Nobody between the player and the felt: the near-centre sector
      // (behind the player's seat, |angle| > 130°) stays empty, and no
      // figure stands in the centre gap behind the partner either.
      const ang = (Math.atan2(f.x, -f.z) * 180) / Math.PI;
      expect(Math.abs(ang), f.id).toBeLessThan(125);
      expect(Math.abs(ang), f.id).toBeGreaterThan(30);
    }
  });
});

describe('crowd life: seeded idle, stir ripple, speaker lean — still when reduced', () => {
  const figs = kingRailFigures(FULL);
  const cue = newCrowdCue();

  it('idle poses are staggered — no two figures share a pose at the same instant', () => {
    const poses = figs.map((f) => crowdPoseAt(f, 123456, cue));
    const keys = new Set(poses.map((p) => `${p.swayRad.toFixed(4)}|${p.headYawRad.toFixed(4)}|${p.bobY.toFixed(4)}`));
    expect(keys.size).toBe(figs.length);
  });

  it('idle poses move over time (breathing/sway are alive, bounded by the inflate envelope)', () => {
    const f = figs[5]!;
    const a = crowdPoseAt(f, 100000, cue);
    const b = crowdPoseAt(f, 101900, cue);
    expect(Math.abs(a.swayRad - b.swayRad) + Math.abs(a.bobY - b.bobY)).toBeGreaterThan(0.001);
    for (let t = 0; t < 30000; t += 977) {
      const p = crowdPoseAt(f, t, cue);
      expect(Math.abs(p.swayRad)).toBeLessThanOrEqual(0.035);
      expect(Math.abs(p.leanRad)).toBeLessThanOrEqual(0.001);
      expect(p.stepIn).toBe(0);
      expect(Math.abs(p.bobY)).toBeLessThanOrEqual(0.007);
    }
    void POSE_INFLATE;
  });

  it('a stir ripples: lean peaks later for later figures, then settles', () => {
    const c = newCrowdCue();
    stampStir(c, 5000, 1);
    const early = crowdPoseAt(figs[2]!, 5450, c);
    const late = crowdPoseAt(figs[12]!, 5450, c);
    expect(early.leanRad).toBeGreaterThan(0.02);
    expect(late.leanRad).toBeLessThan(early.leanRad);
    const settled = crowdPoseAt(figs[2]!, 5000 + 4000, c);
    expect(settled.leanRad).toBeCloseTo(0, 3);
  });

  it('only the speaking railbird leans in', () => {
    const c = newCrowdCue();
    stampSpeaker(c, 'redd', 8000);
    const speaker = crowdPoseAt(figs.find((f) => f.id === 'redd')!, 8500, c);
    const bystander = crowdPoseAt(figs.find((f) => f.id === 'pat')!, 8500, c);
    expect(speaker.leanRad).toBeGreaterThan(0.03);
    expect(speaker.stepIn).toBeGreaterThan(0.02);
    expect(bystander.leanRad).toBeLessThan(0.005);
  });

  it('the rest pose is exactly still — the reduced path applies it verbatim', () => {
    const r = restPose();
    expect(r).toEqual({ bobY: 0, breathK: 1, swayRad: 0, leanRad: 0, stepIn: 0, headYawRad: 0, headPitchRad: 0 });
    const kr = readSrc('src/three/KingRail.tsx');
    // Ticker (the only frame driver) mounts only when animated; figures
    // apply restPose() when not animated.
    expect(kr).toContain('{animate && <CrowdTicker />}');
    expect(kr).toContain('animate ? crowdPoseAt(fig, t, cue) : restPose()');
    expect(kr).toContain('animate ? seatedPoseAt(fig, t, cue, attn.current) : restPose()');
  });
});

describe('seated figures (Part 2): identities, posture, personalities', () => {
  const kingF = seatedFigureFor('king', 1, 'left', 4);
  const deeF = seatedFigureFor('dee', 2, 'top', 4);
  const ringerF = seatedFigureFor('ringer', 3, 'right', 4);

  it('the three sit at their seats, beyond the felt edge, facing in', () => {
    expect(kingF.x).toBeLessThan(-1.7);
    expect(ringerF.x).toBeGreaterThan(1.7);
    expect(deeF.z).toBeLessThan(-1.98);
    for (const f of [kingF, deeF, ringerF]) {
      // facing the centre: the yaw's forward vector points back at (0,0)
      const fwd = new Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw));
      const toCentre = new Vector3(-f.x, 0, -f.z).normalize();
      expect(fwd.dot(toCentre)).toBeGreaterThan(0.99);
    }
  });

  it('seated crowns: above the felt like a seated adult, the King tallest', () => {
    for (const f of [kingF, deeF, ringerF]) {
      expect(f.crown).toBeGreaterThan(0.28);
      expect(f.crown).toBeLessThan(0.55);
    }
    expect(kingF.crown).toBeGreaterThan(ringerF.crown);
    expect(ringerF.crown).toBeGreaterThan(deeF.crown);
  });

  it('attention: looking at the centre is no turn; turns clamp to a natural range', () => {
    expect(Math.abs(attentionYawFor(deeF, 0, 0))).toBeLessThan(0.01);
    expect(Math.abs(attentionYawFor(kingF, 0, 0))).toBeLessThan(0.01);
    expect(Math.abs(attentionYawFor(deeF, -8, 4))).toBeLessThanOrEqual(0.5);
    expect(Math.abs(attentionYawFor(deeF, 8, 4))).toBeLessThanOrEqual(0.5);
  });

  it('personalities: the King barely stirs, Dee leans most; a seated speaker leans', () => {
    const c = newCrowdCue();
    stampStir(c, 2000, 1);
    const t = 2450;
    const kingLean = seatedPoseAt(kingF, t, c, 0).leanRad;
    const deeLean = seatedPoseAt(deeF, t, c, 0).leanRad;
    const ringerLean = seatedPoseAt(ringerF, t, c, 0).leanRad;
    expect(kingLean).toBeGreaterThan(0);
    expect(kingLean).toBeLessThan(ringerLean);
    expect(ringerLean).toBeLessThan(deeLean);
    const c2 = newCrowdCue();
    stampSeatSpeaker(c2, 'dee', 3000);
    expect(seatedPoseAt(deeF, 3400, c2, 0).leanRad).toBeGreaterThan(0.02);
    expect(seatedPoseAt(kingF, 3400, c2, 0).leanRad).toBeLessThan(0.005);
  });
});

/* ------------------------------------------- occlusion (projections) */

type Rect = [number, number, number, number];
const rectOf = (cam: ReturnType<typeof makeCamera>, pts: Vector3[]): Rect => {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of pts) {
    const v = p.clone().project(cam);
    x0 = Math.min(x0, (v.x + 1) / 2); x1 = Math.max(x1, (v.x + 1) / 2);
    y0 = Math.min(y0, (1 - v.y) / 2); y1 = Math.max(y1, (1 - v.y) / 2);
  }
  return [x0, y0, x1, y1];
};
const hit = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const depth = (a: Rect, b: Rect) => Math.min(a[3], b[3]) - Math.max(a[1], b[1]);

/** Measured rects at 390×844 (fractions): the scorebug from the owner's
 *  own device screenshot (Hand 1 at the King); the plates from the real
 *  Chromium render of this build (badge-layer rects: strips are 93×41 —
 *  the partner strip spans y .225–.274, NOT the faced plate's old
 *  footprint). DOM paints over the canvas structurally; these pins keep
 *  faces from being visually cut by those rects. */
const P_ZONES: Record<string, Rect> = {
  bug: [0, 0.045, 1, 0.155], partner: [0.379, 0.225, 0.618, 0.274],
  leftPlate: [0.015, 0.319, 0.254, 0.367], rightPlate: [0.746, 0.319, 0.985, 0.367],
  dock: [0.855, 0.375, 1, 0.62], trick: [0.16, 0.31, 0.84, 0.57],
  hand: [0, 0.57, 1, 1], bid: [0.06, 0.35, 0.94, 0.82],
};

describe('occlusion envelopes at phone size (390×844), poses inflated', () => {
  const figs = kingRailFigures(FULL);
  const dee = seatedFigureFor('dee', 2, 'top', 4);
  const kingS = seatedFigureFor('king', 1, 'left', 4);
  const ringerS = seatedFigureFor('ringer', 3, 'right', 4);

  it('standing: no crowd face touches the scorebug, a plate, the dock, the trick, the hand, or the bid area', () => {
    const cam = makeCamera(390 / 844, false, 'standing');
    for (const f of figs) {
      const face = rectOf(cam, faceCorners(f, true));
      for (const [zn, zr] of Object.entries(P_ZONES)) {
        expect(hit(face, zr), `${f.id} face × ${zn}`).toBe(false);
      }
    }
  });

  it('sitting: faces stay clear of plates/dock/trick/hand/bid; a far face may tuck its crown behind the scorebug only', () => {
    const cam = makeCamera(390 / 844, false, 'sitting');
    for (const f of figs) {
      const face = rectOf(cam, faceCorners(f, true));
      for (const [zn, zr] of Object.entries(P_ZONES)) {
        if (zn === 'bug') continue;
        expect(hit(face, zr), `${f.id} face × ${zn}`).toBe(false);
      }
      // If the bug covers the top of a far face, the chin must still
      // emerge below it — the face is cropped by the frame furniture,
      // never swallowed by it.
      if (hit(face, P_ZONES.bug!)) expect(face[3]).toBeLessThanOrEqual(0.24);
    }
  });

  it('seated Dee: her face clears the scorebug; her own strip may cross the forehead, never the eyes', () => {
    const cam = makeCamera(390 / 844, false, 'standing');
    const face = rectOf(cam, seatedFaceCorners(dee, true));
    expect(hit(face, P_ZONES.bug!)).toBe(false);
    // The strip is her lower-third: its bottom edge may cross the top
    // ~14px of the (inflated) face region — forehead and hair. The
    // eyes sit ~55% down the region, a full 0.02 of screen below the
    // strip's edge at this bound.
    if (hit(face, P_ZONES.partner!)) expect(depth(face, P_ZONES.partner!)).toBeLessThanOrEqual(0.016);
    const camS = makeCamera(390 / 844, false, 'sitting');
    const faceS = rectOf(camS, seatedFaceCorners(dee, true));
    expect(hit(faceS, P_ZONES.bug!)).toBe(false);
  });

  it('seated side figures: in portrait their faces sit outside the frame (their strips anchor at the edges, as today)', () => {
    for (const view of ['standing', 'sitting'] as const) {
      const cam = makeCamera(390 / 844, false, view);
      const kf = rectOf(cam, seatedFaceCorners(kingS, true));
      const rf = rectOf(cam, seatedFaceCorners(ringerS, true));
      expect(kf[2], `king face right edge ${view}`).toBeLessThanOrEqual(0.005);
      expect(rf[0], `ringer face left edge ${view}`).toBeGreaterThanOrEqual(0.995);
    }
  });

  it('presence: faces are actually in frame at every briefed size and view', () => {
    const sizes = [
      { w: 390, h: 844, short: false, min: 2 },
      { w: 932, h: 430, short: true, min: 6 },
      { w: 667, h: 375, short: true, min: 6 },
      { w: 1440, h: 900, short: false, min: 6 },
    ] as const;
    for (const s of sizes) {
      for (const view of ['standing', 'sitting'] as const) {
        const cam = makeCamera(s.w / s.h, s.short, view);
        const inFrame = figs.filter((f) => {
          const r = rectOf(cam, faceCorners(f, true));
          return r[2] > 0 && r[0] < 1 && r[3] > 0 && r[1] < 1;
        });
        expect(inFrame.length, `${s.w}×${s.h} ${view}`).toBeGreaterThanOrEqual(s.min);
      }
    }
  });
});

/* ------------------------------------------------------------ the felt */

let root: Root | null = null;
let el: HTMLDivElement | null = null;

const until = async (pred: () => boolean, ms = 4000): Promise<boolean> => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
  return pred();
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  // happy-dom has no FontFaceSet loader; the Scene's font gate needs the
  // stub every table-mounting suite uses (misdeal-fan, spectator-loop).
  if (!document.fonts?.load) {
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: () => Promise.resolve([]), ready: Promise.resolve() } });
  }
  localStorage.clear();
  sessionStorage.clear();
  try { localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); } catch { /* storage off */ }
  try { sessionStorage.setItem('bwm.versus.king-rail-seed', '1'); } catch { /* storage off */ }
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => {
  act(() => root?.unmount());
  el?.remove();
  root = null;
  el = null;
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

const mountTable = (story?: object) => {
  act(() => {
    root!.render(createElement(Table, {
      rules: makeRules('joker'), seed: 'king-rail-seed',
      settings: { ...DEFAULT_SETTINGS, quality: 'low', speed: 'turbo' },
      onExit: () => {}, onRematch: () => {}, onQuality: () => {},
      ...(story ? { story } : {}),
    } as never));
  });
};

describe('the King table in the DOM: no coins, plates become info strips', () => {
  it('first entry + resume: no rail DOM at all (the crowd is in the 3D scene now)', async () => {
    mountTable(storyProp(king, { attemptsAtStart: 0, clearsAtStart: 0, resumed: false, railCast: railCastForAttempt('king', 1) }));
    expect(await until(() => !!document.querySelector('[data-testid="bug-hand"]')), 'king table up').toBe(true);
    expect(document.querySelector('[data-testid="king-rail"]')).toBeNull();
    expect(document.querySelector('.king-rail')).toBeNull();
    expect(document.querySelector('[data-testid^="king-rail-face-"]')).toBeNull();
  });

  it('resume: still no coin DOM', async () => {
    mountTable(storyProp(king, {
      attemptsAtStart: 0, clearsAtStart: 0, resumed: true,
      initialSession: { fired: [], memory: [], satDown: true, railCast: [...FULL] },
    }));
    expect(await until(() => !!document.querySelector('[data-testid="bug-hand"]')), 'king table up on resume').toBe(true);
    expect(document.querySelector('[data-testid="king-rail"]')).toBeNull();
  });

  it('other stops: no rail either', async () => {
    mountTable(storyProp(porch, { attemptsAtStart: 0, clearsAtStart: 0, resumed: false, railCast: [] }));
    expect(await until(() => !!document.querySelector('[data-testid="bug-hand"]')), 'porch table up').toBe(true);
    expect(document.querySelector('[data-testid="king-rail"]')).toBeNull();
  });

  // The badge layer (plates) only mounts with a live WebGL canvas, which
  // happy-dom cannot provide — plate parity is pinned at the renderSeat
  // source (the same pattern as cow-path) and proven in real Chromium.
  it('plate parity (source): figure seats lose ONLY the face; every datum stays', () => {
    const table = readSrc('src/Table.tsx');
    // The gate: solo King seats come from storySeatIds (pair + Dee)…
    expect(table).toContain("story?.scene?.stop.id === 'king' && storySeatIds");
    // …the strip class rides the same plate element, same testid…
    expect(table).toContain("${figSeat ? ' plate--fig' : ''}`} data-testid={`seat-${seat}`}");
    // …the face (button or plain) renders only when NOT a figure seat…
    expect(table).toContain('{!figSeat && (seatProfile ? (');
    // …and the body with name/bid/took testids is rendered unconditionally.
    const renderSeat = table.slice(table.indexOf('const renderSeat'));
    expect(renderSeat).toContain('data-testid={`bid-${seat}`}');
    expect(renderSeat).toContain('data-testid={`books-${seat}`}');
    expect(renderSeat).toContain('data-testid={`dealer-${seat}`}');
    expect(renderSeat).toContain("online?.seatExtra(seat)");
    // The player's own seat (0) is never a figure seat in solo…
    expect(table).toContain("? { 1: story.scene.stop.pair[0], 2: 'dee', 3: story.scene.stop.pair[1] }");
  });
});

/* ------------------------------------------- the apparition (ghost) */
/*
 * THE APPARITION (owner, 2026-10-26, evening): "can we try some sort
 * of 3d video that has people coming and going like force ghost
 * dropping quotes" — the standing ring reads as furniture, so Uncle
 * Ray (the first railbird ever named) leaves it and only VISITS: a
 * silent video presence materializes a beat before his line, the line
 * lands, he dissolves. Plus his second staging idea the same
 * evening: "the lights going out and lightning revealing someone
 * with a message at times" — a RARE lightning tier on the heaviest
 * moments only. These pins cover the choreography math (windows,
 * envelopes, flash safety), the caps/gates at the table source, the
 * ring split, the reduced-effects still path, and the thunder's
 * license credit.
 */
import { statSync } from 'node:fs';
import {
  GHOST_AFTERGLOW_MS, GHOST_CLIP, GHOST_DIP_MS, GHOST_HOLD_MS, GHOST_ID, GHOST_LEAD_MS,
  GHOST_LINE_LAG_MS, GHOST_PEAK, GHOST_STRIKE_MS, ambientGhostVisit, ghostIsLightning,
  ghostPresenceAt, ghostStrikesEndMs, stampApparition, stampLightning,
} from '../src/three/kingRailLayout';

const assetSize = (rel: string): number => {
  const p = [`apps/web/${rel}`, rel].find((c) => { try { statSync(c); return true; } catch { return false; } })!;
  return statSync(p).size;
};

describe('the apparition — Uncle Ray visits, he does not stand', () => {
  const T0 = 1_000_000;

  it('sample clip assets exist inside the story-video caps', () => {
    expect(GHOST_CLIP.src).toBe('/assets/story/videos/ray-apparition.mp4');
    expect(GHOST_CLIP.poster).toBe('/assets/story/videos/ray-apparition-poster.webp');
    expect(assetSize('public/assets/story/videos/ray-apparition.mp4')).toBeLessThanOrEqual(800 * 1024);
    expect(assetSize('public/assets/story/videos/ray-apparition-poster.webp')).toBeLessThanOrEqual(120 * 1024);
    expect(assetSize('public/assets/sfx/thunder.mp3')).toBeGreaterThan(0);
  });

  it('warm window: materializes BEFORE the line, lingers, dissolves AFTER', () => {
    const cue = newCrowdCue();
    const lineAt = T0 + GHOST_LEAD_MS;
    stampApparition(cue, lineAt - GHOST_LEAD_MS, lineAt + GHOST_HOLD_MS);
    expect(ghostPresenceAt(lineAt - GHOST_LEAD_MS - 1, cue).opacity).toBe(0);
    expect(ghostPresenceAt(lineAt - GHOST_LEAD_MS + 375, cue).opacity).toBeGreaterThan(0.2); // mid fade-in
    expect(ghostPresenceAt(lineAt, cue).opacity).toBeCloseTo(GHOST_PEAK, 5); // full presence as the line lands
    expect(ghostPresenceAt(lineAt + 2000, cue).opacity).toBeCloseTo(GHOST_PEAK, 5); // the linger
    expect(ghostPresenceAt(lineAt + GHOST_HOLD_MS - 200, cue).opacity).toBeLessThan(GHOST_PEAK * 0.4); // dissolving
    expect(ghostPresenceAt(lineAt + GHOST_HOLD_MS + 1, cue).opacity).toBe(0);
    // a warm visit never touches the venue
    expect(ghostPresenceAt(lineAt, cue).exposureK).toBe(1);
    expect(ghostPresenceAt(lineAt, cue).strikeK).toBe(0);
    expect(ghostIsLightning(cue)).toBe(false);
  });

  it('windows merge: an exchange comeback extends the SAME visit', () => {
    const cue = newCrowdCue();
    stampApparition(cue, T0, T0 + 4700);
    stampApparition(cue, T0 + 3000, T0 + 3000 + 4700);
    expect(cue.apparitionAt).toBe(T0); // never re-materializes
    expect(cue.apparitionUntil).toBe(T0 + 7700); // one continuous presence
    stampApparition(cue, T0 + 20000, T0 + 24700); // after it closed: a fresh visit
    expect(cue.apparitionAt).toBe(T0 + 20000);
  });

  it('lightning reveal: dip → strike → after-glow → gone as the lights settle', () => {
    const cue = newCrowdCue();
    const L = T0;
    const lineAt = L + ghostStrikesEndMs(1) + GHOST_LINE_LAG_MS;
    stampLightning(cue, L, lineAt + GHOST_AFTERGLOW_MS, 1);
    expect(ghostIsLightning(cue)).toBe(true);
    const dip = ghostPresenceAt(L + GHOST_DIP_MS * 0.6, cue);
    expect(dip.exposureK).toBeLessThan(0.6); // the lights are dying…
    expect(dip.opacity).toBe(0); // …and he is NOT there yet
    const flash = ghostPresenceAt(L + GHOST_DIP_MS + GHOST_STRIKE_MS / 2, cue);
    expect(flash.exposureK).toBeGreaterThan(1.5);
    expect(flash.strikeK).toBe(1);
    expect(flash.opacity).toBeGreaterThan(0.9); // standing there, lit stark
    expect(flash.brightK).toBeGreaterThan(1.5);
    const glow = ghostPresenceAt(lineAt, cue); // the line lands in the after-glow
    expect(glow.opacity).toBeGreaterThan(0.3);
    expect(glow.exposureK).toBeLessThan(1.2);
    const done = ghostPresenceAt(lineAt + GHOST_AFTERGLOW_MS + 1, cue);
    expect(done.opacity).toBe(0);
    expect(done.exposureK).toBe(1); // the venue is itself again
  });

  it('flash safety is structural: at most 2 pulses, each one strike long, never a strobe', () => {
    for (const strikes of [1, 2]) {
      const cue = newCrowdCue();
      stampLightning(cue, T0, T0 + 4000, strikes);
      let brightMs = 0; let pulses = 0; let wasBright = false;
      for (let d = 0; d <= 4000; d += 10) {
        const bright = ghostPresenceAt(T0 + d, cue).exposureK > 1.3;
        if (bright) { brightMs += 10; if (!wasBright) pulses++; }
        wasBright = bright;
      }
      expect(pulses).toBe(strikes);
      expect(brightMs).toBeLessThanOrEqual(strikes * GHOST_STRIKE_MS + 20);
    }
  });

  it('double strike belongs to the heaviest beats only — pinned at the table source', () => {
    const table = readSrc('src/Table.tsx');
    expect(table).toContain('const strikes = shotOutNow ? 2 : 1;');
    expect(table).toContain("e.kind === 'mega' ? 2 : 1");
  });

  it('ambient visits: seeded, sparse, and never on the final hand', () => {
    expect(ambientGhostVisit(1, 1, true)).toBeNull();
    const v = ambientGhostVisit(1, 1, false);
    expect(v).not.toBeNull(); // attempt 1, hand 1: the known roll fires
    expect(v!.delayMs).toBeGreaterThanOrEqual(5000);
    expect(v!.delayMs).toBeLessThan(12000);
    expect(v!.holdMs).toBeGreaterThan(4000);
    let fired = 0;
    for (let seed = 1; seed <= 60; seed++) for (let hand = 1; hand <= 6; hand++) if (ambientGhostVisit(seed, hand, false)) fired++;
    expect(fired / (60 * 6)).toBeGreaterThan(0.2);
    expect(fired / (60 * 6)).toBeLessThan(0.5);
  });

  it('tier discipline at the table source: caps, gates, reduced suppression', () => {
    const table = readSrc('src/Table.tsx');
    expect(table).toContain('if (G.reveals >= 2) return false;'); // hard cap: 2 per match
    expect(table).toContain('if (gate.handNo <= G.lastRevealHand) return false;'); // never back-to-back
    expect(table).toContain('lightningAt - G.lastRevealAt < 20000'); // …and a real pause between
    expect(table).toContain('if (gate.selected) return false;'); // never over the player's own card motion
    expect(table).toContain('if (gate.reduced) return false;'); // reduced effects: warm visits only
    expect(table).toContain('const ghostSoloKing = !online && kingRail.includes(GHOST_ID);'); // solo King only
    expect(table).toContain('sound.thunderRoll('); // the real thunder, on the sfx bus
  });

  it('event mapping at the table source: only the heavy set reveals; everything else visits warm', () => {
    const table = readSrc('src/Table.tsx');
    expect(table).toContain("wantRail === 'nilMade' || wantRail === 'nilBusted'");
    expect(table).toContain("wantRail === 'finalHand'");
    expect(table).toContain("evs.includes('bigSwing')");
    expect(table).toContain('snap.lastHand.mySet || snap.lastHand.theirSet || shotOutNow');
    expect(table).toContain("e.kind !== 'nuke' && e.kind !== 'mega'");
  });

  it('Ray leaves the standing ring ONLY under the ghost gate; the other 19 + seated are untouched', () => {
    const kr = readSrc('src/three/KingRail.tsx');
    expect(kr).toContain('figures.filter((f) => f.id !== GHOST_ID)');
    expect(kr).toContain('ghost ? figures.find((f) => f.id === GHOST_ID) : undefined');
    expect(kr).toContain('<GhostFigure');
    expect(kr).toContain('standing.map((f) => <CrowdFigure');
    expect(kr).toContain('seatedFigs.map((f) => (f ? <SeatedFigure3D');
    // the layout still deals all 20 slots — Ray's slot is his visit spot
    const cast = railCastForAttempt('king', 1);
    const figs = kingRailFigures(cast, 1);
    expect(figs).toHaveLength(20);
    expect(figs.find((f) => f.id === GHOST_ID)).toBeDefined();
    expect(kingRailFigures(cast, 1)).toEqual(figs); // deterministic — approval keeps every slot
    const scene = readSrc('src/three/Scene.tsx');
    expect(scene).toContain('ghost={props.ghostRail ?? false}');
    const table = readSrc('src/Table.tsx');
    expect(table).toContain('ghostRail={ghostSoloKing}');
  });

  it('reduced effects: the still-frame path — poster, no video, ticker-driven fades', () => {
    const kr = readSrc('src/three/KingRail.tsx');
    expect(kr).toContain("if (!animate || typeof document === 'undefined') return null;");
    expect(kr).toContain('const tex = animate && !videoDead ? videoTex : poster;');
    expect(kr).toContain('{!animate && ghostFig && <GhostTicker cue={cue} />}');
    expect(kr).toContain('GHOST_CLIP.poster');
    expect(kr).toContain('function GhostDirector');
  });

  it('no input lock: the apparition takes no pointer path (source)', () => {
    const kr = readSrc('src/three/KingRail.tsx');
    const ghost = kr.slice(kr.indexOf('function GhostFigure'), kr.indexOf('export interface KingRailProps'));
    expect(ghost).not.toContain('onPointer');
    expect(ghost).not.toContain('onClick');
    expect(ghost).not.toContain('raycast');
    const table = readSrc('src/Table.tsx');
    const gate = table.slice(table.indexOf('const tryGhostLightning'), table.indexOf('// THE STORM ALSO ANSWERS'));
    expect(gate).not.toContain('setPointerCapture');
  });

  it('the thunder is credited with its license in both credit surfaces', () => {
    // repo-root CREDITS.md — whichever candidate this checkout's cwd serves
    const cand = ['CREDITS.md', 'apps/web/../CREDITS.md', '../CREDITS.md', '../../CREDITS.md'];
    const hit = cand.find((c) => { try { readFileSync(c, 'utf8'); return true; } catch { return false; } })!;
    const credits = readFileSync(hit, 'utf8');
    expect(credits).toContain('thunder.mp3');
    expect(credits).toContain('InspectorJ');
    expect(credits).toContain('CC-BY 3.0');
    const ui = readSrc('src/Credits.tsx');
    expect(ui).toContain('InspectorJ');
    expect(ui).toContain('CC-BY 3.0');
  });

  it('the audio engine carries the thunder on the sfx bus', () => {
    const audio = readSrc('src/audio.ts');
    expect(audio).toContain("thunder: ['thunder'],");
    expect(audio).toContain('thunderRoll(delayS = 0)');
    expect(audio).toContain('g.connect(this.sfxBus);');
  });
});
