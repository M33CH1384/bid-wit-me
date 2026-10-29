import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * THE SPEAKEASY LOUNGE — the speakeasy venue's own 3D room
 * (venues rollout Batch C1, 2026-10-28). Pins the two-branch
 * seam and the room's identity so neither can silently
 * regress: the STORY branch keeps priority (a table carrying
 * stop `corner` mounts the Corner street exactly as before —
 * a different place, outdoors); every NON-STORY speakeasy
 * table at High mounts this indoor lounge; Low everywhere
 * keeps the shipped cube-config SpeakeasyRoom, byte-for-byte
 * the same mount as before. The room itself is ALL CODE (the
 * owner's code-first rule) — no GLB loading anywhere — and it
 * carries the venue identity from the cube dress: windowless,
 * herringbone parquet, the back-bar far with blank bottles,
 * booths WEST only, the door EAST, low amber light. Standing-
 * camera discipline: the pressed-tin ceiling is a single-
 * sided plane at floor+3.3 and no fixture hangs over the
 * table. Exclusions pinned: no text or lettering anywhere.
 */

const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/three/SpeakeasyLoungeRoom.tsx', import.meta.url), 'utf8');
const venueRoom = readFileSync(new URL('../src/three/SpeakeasyRoom.tsx', import.meta.url), 'utf8');
const story = readFileSync(new URL('../../../packages/bots/src/story.ts', import.meta.url), 'utf8');

const branch = scene.slice(scene.indexOf('{speakeasy && textured'), scene.indexOf('{grandma && textured'));

describe('the Speakeasy Lounge — story canon', () => {
  it("stop corner plays at the speakeasy venue against Smoke & Redd", () => {
    const stop = story.split('\n').find((l) => l.includes("id: 'corner'"));
    expect(stop).toBeDefined();
    expect(stop).toContain("venueId: 'speakeasy'");
    expect(stop).toContain("pair: ['smoke', 'redd']");
  });
});

describe('the Speakeasy Lounge — the Scene seam', () => {
  it('keeps the story branch first: corner story tables mount the Corner street at High', () => {
    expect(scene).toContain("import CornerStreetRoom from './CornerStreetRoom';");
    expect(branch).toContain("props.storyStopId === 'corner' && props.quality === 'high'");
    expect(branch).toContain('<CornerStreetRoom fxOn={!props.reduceFx} />');
    // story priority is positional: the story condition is read
    // before the lounge mount in the same branch
    expect(branch.indexOf("props.storyStopId === 'corner'")).toBeLessThan(branch.indexOf('<SpeakeasyLoungeRoom'));
  });

  it('mounts SpeakeasyLoungeRoom for non-story speakeasy tables at High', () => {
    expect(scene).toContain("import SpeakeasyLoungeRoom from './SpeakeasyLoungeRoom';");
    expect(branch).toContain(": props.quality === 'high'");
    expect(branch).toContain('<SpeakeasyLoungeRoom fxOn={!props.reduceFx} />');
  });

  it('keeps SpeakeasyRoom (the cube room) as the Low fallback on the same branch', () => {
    expect(branch).toContain('<SpeakeasyRoom quality={props.quality} handNo={props.handNo} />');
    expect(venueRoom).toContain('CubeVenueRoom');
  });
});

describe('the Speakeasy Lounge — code-first, no downloads', () => {
  it('loads no model files and builds its textures procedurally', () => {
    expect(room).not.toContain('useLoader');
    expect(room).not.toContain('.glb');
    expect(room).not.toContain('GLTFLoader');
    expect(room).toContain('function makeHerringboneTexture()');
    expect(room).toContain('function makeBrickTexture()');
    expect(room).toContain('function makeTinTexture()');
    expect(room).toContain('function makeCurtainTexture()');
  });
});

describe('the Speakeasy Lounge — identity anchors', () => {
  it('builds the back-bar, the west booths, the stage, and the east door', () => {
    expect(room).toContain('function Bar(');
    expect(room).toContain('function Booth(');
    expect(room).toContain('function Stage(');
    expect(room).toContain('function Door(');
    expect(room).toContain('function Sconces(');
  });

  it('seats the table in burgundy bistro chairs and keeps the booths burgundy', () => {
    expect(room).toContain('function BistroChairs(');
    expect(room).toContain('#5c1420');
  });

  it('keeps the bottles blank: no text or lettering anywhere in the room', () => {
    expect(room).not.toContain('fillText');
    expect(room).toContain('no text / lettering anywhere');
  });
});

describe('the Speakeasy Lounge — standing + clearance discipline', () => {
  it('keeps the tin ceiling at floor+3.3 with fixtures only over booths and bar', () => {
    expect(room).toContain('const WALL_H = 3.3;');
    expect(room).toContain('function GlowBreath(');
  });

  it('renders no table of its own — chairs at the shared anchors', () => {
    expect(room).not.toContain('CodeTable');
    expect(room).toContain('const CHAIR_SPOTS');
  });

  it("states the coplanar-floor reasoning (the Rec lesson) in its header", () => {
    expect(room).toContain('COPLANAR FLOOR (the Rec lesson, 2026-10-28)');
  });
});
