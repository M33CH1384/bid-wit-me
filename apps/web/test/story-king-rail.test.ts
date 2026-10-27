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
 * then rendered as standing figures INSIDE the 3D scene, and the
 * seated King / Ringer / Dee became figures too, their plates gone
 * to info strips.
 *
 * REMOVAL (owner, 2026-10-26, final word: "we can go ahead and
 * remove the floating heads at this point"): the standing bust crowd
 * is OUT — the construction itself was the problem, and the real 3D
 * replacements are being built separately. The rail now stands EMPTY
 * at the King table. What remains in the scene: the seated three
 * (untouched) and Uncle Ray's filmed visit (below), which appears at
 * his historical rail spot only inside stamped windows. These pins
 * cover: the full cast derivation on first entry AND resume
 * (round-trip through the session save — the cast still drives rail
 * dialogue and the visit's placement), the gate's derivation matching
 * the scene channel's precedence, the coin columns GONE, the standing
 * ring GONE (source + layout contract), the visitor's slot fidelity,
 * reduced-motion stillness (source gates), seated identities /
 * occlusion envelopes / plate parity, and no other stop gaining any
 * of it. Rail dialogue systems are pinned by their own suites; here
 * only their figure coupling is pinned — now: none for rail speakers,
 * the seated lean intact.
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
  RAIL_BACK_R, RAIL_FRONT_R, attentionYawFor, newCrowdCue, railVisitorFigures, restPose,
  seatedFaceCorners, seatedFigureFor, seatedPoseAt, stampStir, stampSeatSpeaker,
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

  it('the standing ring is removed: no crowd figures in the scene, no ring in the layout, no rail-lean cue', () => {
    const kr = readSrc('src/three/KingRail.tsx');
    expect(kr).not.toContain('CrowdFigure');
    expect(kr).not.toContain('silhouette(');
    expect(kr).not.toContain('standing.map');
    expect(kr).not.toContain('crowdPoseAt');
    // …the scene renders visitors + the seated three, nothing else.
    expect(kr).toContain('visitFigs.map((f) => <VisitFigure');
    expect(kr).toContain('seatedFigs.map((f) => (f ? <SeatedFigure3D');
    const layout = readSrc('src/three/kingRailLayout.ts');
    expect(layout).not.toContain('kingRailFigures');
    expect(layout).not.toContain('crowdPoseAt');
    expect(layout).not.toContain('figureCorners');
    expect(layout).not.toContain('faceCorners');
    // The cue carries no rail-speaker lean anymore (the stir the
    // seated three react to, and the seated speaker lean, remain).
    const cue = readSrc('src/three/crowdCue.ts');
    expect(cue).not.toContain('speakerId');
    expect(cue).not.toContain('stampSpeaker');
    expect(cue).toContain('stampSeatSpeaker');
    const table = readSrc('src/Table.tsx');
    expect(table).not.toContain('stampSpeaker');
  });
});

describe('the rail stands empty: only the visitor keeps a slot', () => {
  it('the full King cast produces exactly ONE figure — the registered visitor', () => {
    const figs = railVisitorFigures(FULL);
    expect(figs).toHaveLength(1);
    expect(figs[0]!.id).toBe('uncleRay');
    expect(figs[0]!.index).toBe(0);
    // Nobody else in the cast — and never a seated character — gets a figure.
    for (const id of FULL) {
      if (id !== 'uncleRay') expect(figs.map((f) => f.id)).not.toContain(id);
    }
    for (const seated of ['king', 'ringer', 'dee']) expect(FULL).not.toContain(seated);
  });

  it("the visitor's slot is the one the ring dealt him: cast index 0, back row, −114°", () => {
    const f = railVisitorFigures(FULL)[0]!;
    const rad = (-114 * Math.PI) / 180;
    expect(f.row).toBe(1);
    expect(f.x).toBeCloseTo(Math.sin(rad) * RAIL_BACK_R, 9);
    expect(f.z).toBeCloseTo(-Math.cos(rad) * RAIL_BACK_R, 9);
    expect(f.height).toBeGreaterThanOrEqual(1.63);
    expect(f.height).toBeLessThanOrEqual(1.82);
    // Outside the felt's bounds (1.5 × 1.78 + 0.2 rail) with margin:
    // the visit never enters the table's footprint.
    expect(Math.hypot(f.x / 1.78, f.z / 2.06)).toBeGreaterThan(1.05);
  });

  it('the slot follows cast order, not a hardcode — a different index deals a different slot', () => {
    const figs = railVisitorFigures(['pat', 'uncleRay', 'ace']);
    expect(figs).toHaveLength(1);
    const f = figs[0]!;
    expect(f.index).toBe(1);
    // Cast index 1 is the front row's −104° slot.
    const rad = (-104 * Math.PI) / 180;
    expect(f.row).toBe(0);
    expect(f.x).toBeCloseTo(Math.sin(rad) * RAIL_FRONT_R, 9);
    expect(f.z).toBeCloseTo(-Math.cos(rad) * RAIL_FRONT_R, 9);
  });

  it('deterministic and ring-scaled: the same cast deals the identical slot (resume-safe)', () => {
    expect(railVisitorFigures(FULL)).toEqual(railVisitorFigures(FULL));
    const wide = railVisitorFigures(FULL, 1.18)[0]!;
    const base = railVisitorFigures(FULL)[0]!;
    expect(Math.hypot(wide.x, wide.z)).toBeCloseTo(Math.hypot(base.x, base.z) * 1.18, 9);
    expect(wide.height).toBe(base.height);
  });

  it('a cast without a registered visitor — or no cast at all — renders an empty rail', () => {
    expect(railVisitorFigures(['pat', 'ace', 'queenie'])).toEqual([]);
    expect(railVisitorFigures([])).toEqual([]);
  });
});

describe('stillness: the rest pose contract the reduced path applies', () => {
  it('the rest pose is exactly still', () => {
    const r = restPose();
    expect(r).toEqual({ bobY: 0, breathK: 1, swayRad: 0, leanRad: 0, stepIn: 0, headYawRad: 0, headPitchRad: 0 });
  });

  it('the ticker (the only frame driver) mounts only when animated; the seated pose gates on animate', () => {
    const kr = readSrc('src/three/KingRail.tsx');
    expect(kr).toContain('{animate && <CrowdTicker />}');
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

describe('occlusion envelopes at phone size (390×844), poses inflated — the seated three', () => {
  const dee = seatedFigureFor('dee', 2, 'top', 4);
  const kingS = seatedFigureFor('king', 1, 'left', 4);
  const ringerS = seatedFigureFor('ringer', 3, 'right', 4);

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

/* ------------------------------------------- the filmed visit */
/*
 * THE FILMED VISIT (owner, 2026-10-26, late): the bust-portrait
 * apparition shipped the same evening was rejected on sight — "that
 * doesn't look like real people it looks like live posters on a
 * pillar" — and the owner picked full-body filmed visits: "3d video
 * that has people coming and going." Uncle Ray (the first railbird
 * ever named) only VISITS: full-body film walks him in with real
 * steps, he settles into living presence, his line lands in his cast
 * voice, he lingers, then walks out into the dark. (The standing ring
 * he once left has since been removed entirely — see the header —
 * so between visits the rail is simply empty, exactly as it is
 * during them.) The lightning tier that rode the apparition
 * stays reverted — these pins also keep it OUT. The pins cover the
 * registry + asset caps, the phase machine, the window merge, the
 * ambient discipline, the visit gate, the scheduling extension at
 * the table source, and the reduced-effects still path.
 */
import { statSync } from 'node:fs';
import {
  RAIL_VISITORS, VISIT_ARRIVE_MS, VISIT_DEPART_MS, VISIT_FADE_IN_MS, VISIT_IDLE_MS,
  VISIT_PEAK, VISIT_SETTLED_MS, VISITOR_ID, ambientVisit, stampVisit, visitStateAt,
} from '../src/three/kingRailLayout';

const assetSize = (rel: string): number => {
  const p = [`apps/web/${rel}`, rel].find((c) => { try { statSync(c); return true; } catch { return false; } })!;
  return statSync(p).size;
};

describe('the filmed visit — Uncle Ray walks in, he does not stand', () => {
  const T0 = 1_000_000;
  const clips = RAIL_VISITORS[VISITOR_ID]!;
  /** the window the table stamps for a speaking visit whose line lands at lineAt */
  const speechCue = (lineAt: number) => {
    const cue = newCrowdCue();
    stampVisit(cue, lineAt - VISIT_ARRIVE_MS, lineAt + VISIT_SETTLED_MS + VISIT_DEPART_MS, VISIT_SETTLED_MS);
    return cue;
  };

  it('the registry names Ray, and his three clips + poster sit inside the story-video caps', () => {
    expect(VISITOR_ID).toBe('uncleRay');
    expect(clips.arrive).toBe('/assets/story/videos/ray-visit-arrive.mp4');
    expect(clips.idle).toBe('/assets/story/videos/ray-visit-idle.mp4');
    expect(clips.depart).toBe('/assets/story/videos/ray-visit-depart.mp4');
    expect(clips.poster).toBe('/assets/story/videos/ray-visit-poster.webp');
    for (const f of ['ray-visit-arrive.mp4', 'ray-visit-idle.mp4', 'ray-visit-depart.mp4']) {
      expect(assetSize(`public/assets/story/videos/${f}`)).toBeLessThanOrEqual(800 * 1024);
    }
    expect(assetSize('public/assets/story/videos/ray-visit-poster.webp')).toBeLessThanOrEqual(120 * 1024);
    // the shoe line sits low in the frame — a full body, head to shoes
    expect(clips.feetFrac).toBeGreaterThan(0.9);
    expect(clips.feetFrac).toBeLessThan(1);
  });

  it('phase machine: walk in → settled as the line lands → linger → walk out', () => {
    const lineAt = T0 + VISIT_ARRIVE_MS + 400; // the beat base extended past the walk
    const cue = speechCue(lineAt);
    const at = cue.visitAt;
    expect(visitStateAt(at - 1, cue, clips).phase).toBe('gone');
    expect(visitStateAt(at - 1, cue, clips).opacity).toBe(0);
    // mid-arrival: he is crossing the frame, still gathering
    const mid = visitStateAt(at + VISIT_ARRIVE_MS / 2, cue, clips);
    expect(mid.phase).toBe('arrive');
    expect(mid.clipMs).toBeCloseTo(VISIT_ARRIVE_MS / 2, -2);
    expect(mid.figureX).toBeGreaterThan(clips.enterX);
    expect(mid.figureX).toBeLessThan(clips.settleX);
    expect(visitStateAt(at + VISIT_FADE_IN_MS / 2, cue, clips).opacity).toBeCloseTo(VISIT_PEAK * 0.5, 2);
    // the line lands exactly as he settles: full presence, idle at 0
    const settled = visitStateAt(lineAt, cue, clips);
    expect(settled.phase).toBe('settled');
    expect(settled.opacity).toBeCloseTo(VISIT_PEAK, 5);
    expect(settled.clipMs).toBe(0);
    expect(settled.figureX).toBe(clips.settleX);
    // the presence loop wraps inside a long settled hold
    const longCue = newCrowdCue();
    stampVisit(longCue, T0, T0 + VISIT_ARRIVE_MS + VISIT_IDLE_MS + 1500 + VISIT_DEPART_MS, VISIT_IDLE_MS + 1500);
    const looped = visitStateAt(T0 + VISIT_ARRIVE_MS + VISIT_IDLE_MS + 500, longCue, clips);
    expect(looped.phase).toBe('settled');
    expect(looped.clipMs).toBe(500);
    // departure: he crosses toward the exit and the ghost lets go at the end
    const depAt = lineAt + VISIT_SETTLED_MS;
    const dep = visitStateAt(depAt + 100, cue, clips);
    expect(dep.phase).toBe('depart');
    expect(dep.clipMs).toBe(100);
    const leaving = visitStateAt(depAt + VISIT_DEPART_MS / 2, cue, clips);
    expect(leaving.figureX).toBeGreaterThan(clips.settleX);
    expect(leaving.opacity).toBeCloseTo(VISIT_PEAK, 5); // still fully there mid-walk
    expect(visitStateAt(cue.visitUntil - 100, cue, clips).opacity).toBeLessThan(VISIT_PEAK * 0.15);
    expect(visitStateAt(cue.visitUntil, cue, clips).phase).toBe('gone');
    expect(visitStateAt(cue.visitUntil, cue, clips).opacity).toBe(0);
  });

  it('windows merge: an exchange comeback extends the SAME visit', () => {
    const cue = newCrowdCue();
    stampVisit(cue, T0, T0 + VISIT_ARRIVE_MS + VISIT_SETTLED_MS + VISIT_DEPART_MS, VISIT_SETTLED_MS);
    const until0 = cue.visitUntil;
    stampVisit(cue, T0 + 9000, T0 + 9000 + VISIT_SETTLED_MS + VISIT_DEPART_MS, VISIT_SETTLED_MS);
    expect(cue.visitAt).toBe(T0); // never walks in twice
    expect(cue.visitUntil).toBeGreaterThan(until0); // one continuous stay…
    expect(cue.visitSettledMs).toBe(VISIT_SETTLED_MS + (cue.visitUntil - until0)); // …the hold absorbs the extension
    stampVisit(cue, T0 + 60000, T0 + 60000 + 1000, 500); // after it closed: a fresh visit
    expect(cue.visitAt).toBe(T0 + 60000);
    expect(cue.visitSettledMs).toBe(500);
  });

  it('ambient visits: seeded, sparse, and never on the final hand', () => {
    expect(ambientVisit(1, 1, true)).toBeNull();
    const v = ambientVisit(1, 1, false);
    expect(v).not.toBeNull(); // attempt 1, hand 1: the known roll fires
    expect(v!.delayMs).toBeGreaterThanOrEqual(5000);
    expect(v!.delayMs).toBeLessThan(12000);
    expect(v!.settledMs).toBeGreaterThan(4000);
    let fired = 0;
    for (let seed = 1; seed <= 60; seed++) for (let hand = 1; hand <= 6; hand++) if (ambientVisit(seed, hand, false)) fired++;
    expect(fired / (60 * 6)).toBeGreaterThan(0.2);
    expect(fired / (60 * 6)).toBeLessThan(0.5);
  });

  it('the scheduling contract at the table source: the beat waits for the walk-in', () => {
    const table = readSrc('src/Table.tsx');
    expect(table).toContain('const visitSoloKing = !online && kingRail.includes(VISITOR_ID);'); // solo King only
    expect(table).toContain('Math.max(baseDelay, VISIT_ARRIVE_MS + 400)'); // the whole beat extends…
    expect(table).toContain('stampVisit(crowdCue, lineAt - VISIT_ARRIVE_MS, lineAt + VISIT_SETTLED_MS + VISIT_DEPART_MS, VISIT_SETTLED_MS)'); // …so the line lands at settle
    expect(table).toContain('stampVisit(crowdCue, at, at + VISIT_ARRIVE_MS + visit.settledMs + VISIT_DEPART_MS, visit.settledMs)'); // ambient rides the same window
    expect(table).toContain('visitRail={visitSoloKing}');
  });

  it('the lightning tier stays reverted: no stamps, no thunder, no director', () => {
    const table = readSrc('src/Table.tsx');
    expect(table).not.toContain('stampLightning');
    expect(table).not.toContain('thunderRoll');
    expect(table).not.toContain('tryGhostLightning');
    const kr = readSrc('src/three/KingRail.tsx');
    expect(kr).not.toContain('GhostDirector');
    expect(kr).not.toContain('toneMappingExposure');
    const cue = readSrc('src/three/crowdCue.ts');
    expect(cue).not.toContain('lightningAt');
    expect(cue).not.toContain('stampLightning');
  });

  it('Ray appears ONLY as a visit under the visit gate; the seated three are untouched', () => {
    const kr = readSrc('src/three/KingRail.tsx');
    // Visitor figures exist only when the gate is on — and they are
    // the ONLY figures the cast produces (no standing ring remains).
    expect(kr).toContain('visit ? railVisitorFigures(cast, ringScale) : []');
    expect(kr).toContain('visitFigs.map((f) => <VisitFigure');
    expect(kr).not.toContain('CrowdFigure');
    expect(kr).toContain('seatedFigs.map((f) => (f ? <SeatedFigure3D');
    // the layout deals the visitor his historical slot from the full cast
    const cast = railCastForAttempt('king', 1);
    const figs = railVisitorFigures(cast, 1);
    expect(figs).toHaveLength(1);
    expect(figs[0]!.id).toBe(VISITOR_ID);
    expect(railVisitorFigures(cast, 1)).toEqual(figs); // deterministic — resume keeps his spot
    const scene = readSrc('src/three/Scene.tsx');
    expect(scene).toContain('visit={props.visitRail ?? false}');
    const table = readSrc('src/Table.tsx');
    expect(table).toContain('visitRail={visitSoloKing}');
  });

  it('floor-anchored at life scale: the shoe line plants on the venue floor', () => {
    const kr = readSrc('src/three/KingRail.tsx');
    expect(kr).toContain('const ph = fig.height / clips.feetFrac;'); // his in-frame span becomes his real height
    expect(kr).toContain('position={[0, RAIL_FLOOR_Y + ph / 2, 0]}'); // the frame's bottom rides the floor offset…
    expect(kr).toContain('uFeet'); // …and the shader cuts the frame at the shoe line
    expect(kr).toContain('AdditiveBlending'); // black-keyed into the night
    expect(kr).toContain('shadow.current.position.x = (st.figureX - 0.5) * pw'); // the contact shadow tracks the walk
  });

  it('reduced effects: the still-frame path — full-body poster, no video, ticker-driven fades', () => {
    const kr = readSrc('src/three/KingRail.tsx');
    expect(kr).toContain("if (!animate || typeof document === 'undefined') return null;");
    expect(kr).toContain('visitPoster(clips');
    expect(kr).toContain('{!animate && visitFigs.length > 0 && <VisitTicker cue={cue} />}');
  });

  it('no input lock: the visit takes no pointer path (source)', () => {
    const kr = readSrc('src/three/KingRail.tsx');
    const visit = kr.slice(kr.indexOf('function VisitFigure'), kr.indexOf('export interface KingRailProps'));
    expect(visit).not.toContain('onPointer');
    expect(visit).not.toContain('onClick');
    expect(visit).not.toContain('raycast');
  });
});
