import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * THE ROOFTOP SKYLINE — the rooftop venue's own 3D room
 * (venues rollout Batch C3, 2026-10-28). Pins the two-branch
 * seam and the room's identity so neither can silently
 * regress: the STORY branch keeps priority (a table carrying
 * stop `rooftop` mounts RooftopDuskRoom, pinned to dusk,
 * exactly as before); every NON-STORY rooftop table at High
 * mounts this Skyline room; Low everywhere keeps the shipped
 * cube-config RooftopRoom, byte-for-byte the same mount as
 * before. The room itself is ALL CODE (the owner's code-first
 * rule) — no GLB loading anywhere — and it PRESERVES the
 * cube room's local-clock character: the same useLocalTod
 * hand lock and the same todLighting table drive its sky,
 * sun and glows (dawn / day / golden / night), so regular
 * rooftop play still follows the player's local time.
 * Standing-camera discipline: open air, no ceiling; the
 * string lights run along the deck's edges only.
 * Exclusions pinned: no text or lettering anywhere.
 */

const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/three/RooftopSkylineRoom.tsx', import.meta.url), 'utf8');
const venueRoom = readFileSync(new URL('../src/three/RooftopRoom.tsx', import.meta.url), 'utf8');
const dusk = readFileSync(new URL('../src/three/RooftopDuskRoom.tsx', import.meta.url), 'utf8');
const story = readFileSync(new URL('../../../packages/bots/src/story.ts', import.meta.url), 'utf8');

const branch = scene.slice(scene.indexOf('{rooftop && textured'), scene.indexOf('{yacht && textured'));

describe('the Rooftop Skyline — story canon', () => {
  it("stop rooftop plays at the rooftop venue against Poet & Seven", () => {
    const stop = story.split('\n').find((l) => l.includes("id: 'rooftop'"));
    expect(stop).toBeDefined();
    expect(stop).toContain("venueId: 'rooftop'");
    expect(stop).toContain("pair: ['poet', 'seven']");
  });
});

describe('the Rooftop Skyline — the Scene seam', () => {
  it('keeps the story branch first: rooftop story tables mount the Dusk room at High', () => {
    expect(scene).toContain("import RooftopDuskRoom from './RooftopDuskRoom';");
    expect(branch).toContain("props.storyStopId === 'rooftop' && props.quality === 'high'");
    expect(branch).toContain('<RooftopDuskRoom fxOn={!props.reduceFx} />');
    // story priority is positional: the story condition is read
    // before the skyline mount in the same branch
    expect(branch.indexOf("props.storyStopId === 'rooftop'")).toBeLessThan(branch.indexOf('<RooftopSkylineRoom'));
  });

  it('mounts RooftopSkylineRoom for non-story rooftop tables at High', () => {
    expect(scene).toContain("import RooftopSkylineRoom from './RooftopSkylineRoom';");
    expect(branch).toContain(": props.quality === 'high'");
    expect(branch).toContain('<RooftopSkylineRoom fxOn={!props.reduceFx} handNo={props.handNo} />');
  });

  it('keeps RooftopRoom (the cube room) as the Low fallback on the same branch', () => {
    expect(branch).toContain('<RooftopRoom quality={props.quality} handNo={props.handNo} />');
    expect(venueRoom).toContain('CubeVenueRoom');
  });
});

describe('the Rooftop Skyline — code-first, no downloads', () => {
  it('loads no model files and builds its textures procedurally', () => {
    expect(room).not.toContain('useLoader');
    expect(room).not.toContain('.glb');
    expect(room).not.toContain('GLTFLoader');
    expect(room).toContain('function makeConcreteTexture()');
    expect(room).toContain('function makeSkyTexture(tod: TodState)');
    expect(room).toContain('function makeFoliageTexture()');
  });
});

describe('the Rooftop Skyline — the local-clock TOD, preserved', () => {
  it("reads the cube room's own hand lock and lighting table", () => {
    expect(room).toContain("import { useLocalTod } from './cubeVenue';");
    expect(room).toContain("import { todLighting, type TodState } from './barbershopLayout';");
    expect(room).toContain('const lock = useLocalTod(handNo);');
    expect(room).toContain('todLighting(tod)');
  });

  it('carries all four TOD states in its sky and sun rigs', () => {
    for (const tod of ['dawn', 'day', 'golden', 'night']) {
      expect(room).toContain(`${tod}:`);
    }
    expect(room).toContain('const SKY_STOPS: Record<TodState,');
    expect(room).toContain('const SUN: Record<TodState,');
    expect(room).toContain("room: 'rooftop-skyline'");
    expect(room).toContain('tod };');
  });

  it("never touches the story room's pinned dusk", () => {
    expect(room).not.toContain("from './RooftopDuskRoom'");
    expect(dusk).not.toContain('RooftopSkylineRoom');
    expect(dusk).not.toContain('useLocalTod');
  });
});

describe('the Rooftop Skyline — identity anchors', () => {
  it('builds the parapet shell, the skyline, the bulkhead, the water tower, and the string lights', () => {
    expect(room).toContain('function Shell(');
    expect(room).toContain('function Skyline(');
    expect(room).toContain('function Bulkhead(');
    expect(room).toContain('function WaterTower(');
    expect(room).toContain('function VentAndPlanters(');
    expect(room).toContain('function StringLights(');
  });

  it('seats the table in rooftop lounge chairs and stamps its probe', () => {
    expect(room).toContain('function RoofChairs(');
    expect(room).toContain("room: 'rooftop-skyline'");
  });

  it('keeps the skyline windows as pattern only: no text or lettering anywhere in the room', () => {
    expect(room).not.toContain('fillText');
    expect(room).toContain('no text / lettering anywhere');
  });
});

describe('the Rooftop Skyline — standing + clearance discipline', () => {
  it('renders no table of its own — chairs at the shared anchors', () => {
    expect(room).not.toContain('CodeTable');
    expect(room).toContain('const CHAIR_SPOTS');
  });

  it("states the coplanar-floor reasoning (the Rec lesson) in its header", () => {
    expect(room).toContain('COPLANAR FLOOR (the Rec lesson, 2026-10-28)');
  });

  it('is open-air: no ceiling is built at all', () => {
    expect(room).toContain('open-air — no ceiling at all');
  });
});
