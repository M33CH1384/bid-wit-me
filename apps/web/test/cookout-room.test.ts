import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * THE COOKOUT — story Stop 4's 3D room (Batch 3b), un-scoped
 * to the whole venue by the venues rollout (2026-10-28). Pins
 * the venue-wide seam and the room's certified identity so
 * the yard can't silently regress: the room mounts on EVERY
 * backyard table at High quality (story tables render exactly
 * as before); Low everywhere keeps the shipped BackyardRoom,
 * byte-for-byte the same mount as before. The room itself is ALL CODE (the owner's
 * code-first rule) — no GLB loading anywhere — and it carries
 * the Batch 3b identity anchors: the two-storey siding house
 * behind the far seat, the H 1.80 plank fence on three sides,
 * the kettle grill at the south-west corner with smoke
 * drifting WEST away from the felt, camp chairs + empty
 * serving table + cooler as east dressing, and perimeter-only
 * string lights. Standing-camera discipline (2026-10-28 gate):
 * the room has NO ceiling and its string runs never cross
 * the table.
 */

const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/three/CookoutYardRoom.tsx', import.meta.url), 'utf8');
const backyardRoom = readFileSync(new URL('../src/three/BackyardRoom.tsx', import.meta.url), 'utf8');
const story = readFileSync(new URL('../../../packages/bots/src/story.ts', import.meta.url), 'utf8');

describe('the Cookout — story canon', () => {
  it("stop cookout plays at the backyard venue against Keisha & Teisha", () => {
    const stop = story.split('\n').find((l) => l.includes("id: 'cookout'"));
    expect(stop).toBeDefined();
    expect(stop).toContain("venueId: 'backyard'");
    expect(stop).toContain("pair: ['keisha', 'teisha']");
  });
});

describe('the Cookout — the Scene seam', () => {
  it('mounts CookoutYardRoom for every backyard table at High (venues rollout un-scope)', () => {
    expect(scene).toContain("import CookoutYardRoom from './CookoutYardRoom';");
    expect(scene).toContain(
      "{backyard && textured && (props.quality === 'high'",
    );
    // The stop term is gone: the room follows the venue, not the story flag.
    expect(scene).not.toContain("props.storyStopId === 'cookout'");
    expect(scene).toContain('<CookoutYardRoom fxOn={!props.reduceFx} />');
  });

  it('keeps BackyardRoom as the fallback on the same line', () => {
    expect(scene).toContain(
      ': <BackyardRoom quality={props.quality} handNo={props.handNo} />)}',
    );
    // Non-story speakeasy/grandma seams are untouched by this room.
    expect(backyardRoom.length).toBeGreaterThan(0);
  });
});

describe('the Cookout — code-first, no downloads', () => {
  it('loads no model files and builds its textures procedurally', () => {
    expect(room).not.toContain('useLoader');
    expect(room).not.toContain('.glb');
    expect(room).not.toContain('GLTFLoader');
    expect(room).toContain('function makeSidingTexture()');
    expect(room).toContain('function makeFenceTexture()');
    expect(room).toContain('function makeGrassTexture()');
    expect(room).toContain('function makeBlueHourSkyTexture()');
  });
});

describe('the Cookout — identity anchors', () => {
  it('builds the two-storey house, the H 1.80 fence, and the grill corner', () => {
    expect(room).toContain('function House(');
    expect(room).toContain('args={[7.4, 6.4, 0.3]}'); // two-storey wall
    expect(room).toContain('function FenceRun(');
    expect(room).toContain('parts.push(box(len, 1.8, 0.055, len / 2, 0.9, 0))'); // H 1.80 planks
    expect(room).toContain('function KettleGrill(');
    expect(room).toContain("position={[-3.6, FLOOR_Y, 1.5]}"); // south-west corner
  });

  it('carries the east dressing cluster: camp chairs, serving table, cooler', () => {
    expect(room).toContain('function CampChair(');
    expect(room).toContain('function ServingTable(');
    expect(room).toContain('function Cooler(');
  });

  it("drifts the grill smoke WEST, away from the felt (mirrored group)", () => {
    expect(room).toContain('scale={[-1, 1, 1]}');
    expect(room).toContain('function SpriteSmoke(');
  });
});

describe('the Cookout — standing-camera discipline', () => {
  it('has no ceiling and no element spanning the table', () => {
    expect(room.toLowerCase()).not.toContain('ceiling');
    // the back string run hangs behind the far seat at z −3.1,
    // and the side runs anchor to the fence tops — perimeter only
    expect(room).toContain('b={[5.35, FLOOR_Y + 1.95, -3.1]}');
    expect(room).toContain('b={[-5.4, FLOOR_Y + 1.95, -0.7]}');
  });

  it('renders no table of its own — chairs at the shared anchors', () => {
    expect(room).not.toContain('CodeTable');
    expect(room).toContain('const CHAIR_SPOTS');
    expect(room).toContain('function FoldingChairs(');
  });
});
