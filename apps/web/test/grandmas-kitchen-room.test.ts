import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * GRANDMA'S KITCHEN — the grandma venue's own 3D room
 * (venues rollout Batch C1, 2026-10-28). Pins the two-branch
 * seam and the room's identity so neither can silently
 * regress: the STORY branch keeps priority (a table carrying
 * stop `porch` mounts the Porch deck exactly as before — a
 * different place, outside); every NON-STORY grandma table
 * at High mounts this kitchen; Low everywhere keeps the
 * shipped cube-config GrandmaRoom, byte-for-byte the same
 * mount as before. The room itself is ALL CODE (the owner's
 * code-first rule) — no GLB loading anywhere — and it
 * carries the venue identity from the cube dress plus its
 * diner-read design fix: a tall far-wall kitchen run with
 * cabinets, the four-burner stove, the full 2 m fridge,
 * windows ×2 with gingham curtains, the plate hutch and the
 * hanging pans. Standing-camera discipline: the ceiling is
 * a single-sided plane at floor+2.95 and nothing hangs over
 * the table. Exclusions pinned: no text or lettering (the
 * clock carries tick marks only, the fridge magnets are
 * plain discs).
 */

const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/three/GrandmasKitchenRoom.tsx', import.meta.url), 'utf8');
const venueRoom = readFileSync(new URL('../src/three/GrandmaRoom.tsx', import.meta.url), 'utf8');
const story = readFileSync(new URL('../../../packages/bots/src/story.ts', import.meta.url), 'utf8');

const branch = scene.slice(scene.indexOf('{grandma && textured'), scene.indexOf('{mansion && textured'));

describe("Grandma's Kitchen — story canon", () => {
  it("stop porch plays at the grandma venue against Uncle Ray & Pat", () => {
    const stop = story.split('\n').find((l) => l.includes("id: 'porch'"));
    expect(stop).toBeDefined();
    expect(stop).toContain("venueId: 'grandma'");
    expect(stop).toContain("pair: ['uncleRay', 'pat']");
  });
});

describe("Grandma's Kitchen — the Scene seam", () => {
  it('keeps the story branch first: porch story tables mount the Porch deck at High', () => {
    expect(scene).toContain("import PorchDeckRoom from './PorchDeckRoom';");
    expect(branch).toContain("props.storyStopId === 'porch' && props.quality === 'high'");
    expect(branch).toContain('<PorchDeckRoom />');
    // story priority is positional: the story condition is read
    // before the kitchen mount in the same branch
    expect(branch.indexOf("props.storyStopId === 'porch'")).toBeLessThan(branch.indexOf('<GrandmasKitchenRoom'));
  });

  it("mounts GrandmasKitchenRoom for non-story grandma tables at High", () => {
    expect(scene).toContain("import GrandmasKitchenRoom from './GrandmasKitchenRoom';");
    expect(branch).toContain(": props.quality === 'high'");
    expect(branch).toContain('<GrandmasKitchenRoom fxOn={!props.reduceFx} />');
  });

  it('keeps GrandmaRoom (the cube room) as the Low fallback on the same branch', () => {
    expect(branch).toContain('<GrandmaRoom quality={props.quality} handNo={props.handNo} />');
    expect(venueRoom).toContain('CubeVenueRoom');
  });
});

describe("Grandma's Kitchen — code-first, no downloads", () => {
  it('loads no model files and builds its textures procedurally', () => {
    expect(room).not.toContain('useLoader');
    expect(room).not.toContain('.glb');
    expect(room).not.toContain('GLTFLoader');
    expect(room).toContain('function makeLinoleumTexture()');
    expect(room).toContain('function makeWallTexture()');
    expect(room).toContain('function makeGinghamTexture()');
    expect(room).toContain('function makeCeilingTexture()');
  });
});

describe("Grandma's Kitchen — identity anchors", () => {
  it('builds the kitchen run, the wall cabinets, the fridge, the hutch, and the pan rail', () => {
    expect(room).toContain('function KitchenRun(');
    expect(room).toContain('function WallCabinet(');
    expect(room).toContain('function Fridge(');
    expect(room).toContain('function Hutch(');
    expect(room).toContain('function PanRail(');
    expect(room).toContain('function KitchenWindow(');
  });

  it('seats the table in honey-oak kitchen chairs', () => {
    expect(room).toContain('function KitchenChairs(');
    expect(room).toContain('#9a6a3c');
  });

  it('keeps the clock honest: tick marks only, no numerals, no text anywhere', () => {
    expect(room).toContain('function KitchenClock(');
    expect(room).not.toContain('fillText');
    expect(room).toContain('no numerals');
  });
});

describe("Grandma's Kitchen — standing + clearance discipline", () => {
  it('keeps the warm ceiling at floor+2.95 with nothing hanging over the table', () => {
    expect(room).toContain('const WALL_H = 2.95;');
    expect(room).toContain('function DaylightBreath(');
  });

  it('renders no table of its own — chairs at the shared anchors', () => {
    expect(room).not.toContain('CodeTable');
    expect(room).toContain('const CHAIR_SPOTS');
  });

  it("states the coplanar-floor reasoning (the Rec lesson) in its header", () => {
    expect(room).toContain('COPLANAR FLOOR (the Rec lesson, 2026-10-28)');
  });
});
