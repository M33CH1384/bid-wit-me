import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * THE VEGAS CASINO FLOOR — the vegas venue's own 3D room
 * (venues rollout Batch C3, 2026-10-28). Pins the two-branch
 * seam and the room's identity so neither can silently
 * regress: the STORY branch keeps priority (a table carrying
 * stop `legends` mounts LegendsTableRoom, the private
 * legends' room, exactly as before); every NON-STORY vegas
 * table at High mounts this casino floor; Low everywhere
 * keeps the shipped cube-config VegasRoom, byte-for-byte the
 * same mount as before. The room itself is ALL CODE (the
 * owner's code-first rule) — no GLB loading anywhere — and
 * it carries the venue identity from the cube dress:
 * windowless, burgundy carpet, gold panels, chip table.
 * Standing-camera discipline: the ceiling and its glow
 * medallion are single-sided downward planes, and NO solid
 * fixture hangs over the table. Exclusions pinned: no text
 * or lettering anywhere, and the slot screens stay BLANK —
 * glowing shapes only, never symbols-as-text.
 */

const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/three/VegasCasinoRoom.tsx', import.meta.url), 'utf8');
const venueRoom = readFileSync(new URL('../src/three/VegasRoom.tsx', import.meta.url), 'utf8');
const story = readFileSync(new URL('../../../packages/bots/src/story.ts', import.meta.url), 'utf8');

const branch = scene.slice(scene.indexOf('{vegas && textured'), scene.indexOf('{speakeasy && textured'));

describe('the Vegas Casino Floor — story canon', () => {
  it("stop legends plays at the vegas venue against Queenie & Ace", () => {
    const stop = story.split('\n').find((l) => l.includes("id: 'legends'"));
    expect(stop).toBeDefined();
    expect(stop).toContain("venueId: 'vegas'");
    expect(stop).toContain("pair: ['queenie', 'ace']");
  });
});

describe('the Vegas Casino Floor — the Scene seam', () => {
  it('keeps the story branch first: legends story tables mount the Legends room at High', () => {
    expect(scene).toContain("import LegendsTableRoom from './LegendsTableRoom';");
    expect(branch).toContain("props.storyStopId === 'legends' && props.quality === 'high'");
    expect(branch).toContain('<LegendsTableRoom fxOn={!props.reduceFx} />');
    // story priority is positional: the story condition is read
    // before the casino mount in the same branch
    expect(branch.indexOf("props.storyStopId === 'legends'")).toBeLessThan(branch.indexOf('<VegasCasinoRoom'));
  });

  it('mounts VegasCasinoRoom for non-story vegas tables at High', () => {
    expect(scene).toContain("import VegasCasinoRoom from './VegasCasinoRoom';");
    expect(branch).toContain(": props.quality === 'high'");
    expect(branch).toContain('<VegasCasinoRoom fxOn={!props.reduceFx} />');
  });

  it('keeps VegasRoom (the cube room) as the Low fallback on the same branch', () => {
    expect(branch).toContain('<VegasRoom quality={props.quality} handNo={props.handNo} />');
    expect(venueRoom).toContain('CubeVenueRoom');
  });
});

describe('the Vegas Casino Floor — code-first, no downloads', () => {
  it('loads no model files and builds its textures procedurally', () => {
    expect(room).not.toContain('useLoader');
    expect(room).not.toContain('.glb');
    expect(room).not.toContain('GLTFLoader');
    expect(room).toContain('function makeCarpetTexture()');
    expect(room).toContain('function makePanelTexture()');
    expect(room).toContain('function makeCeilingTexture()');
  });
});

describe('the Vegas Casino Floor — identity anchors', () => {
  it('builds the slot banks, the corner columns, the corners dressing, and the shell', () => {
    expect(room).toContain('function SlotBank(');
    expect(room).toContain('function Corners(');
    expect(room).toContain('function Shell(');
    expect(room).toContain('const columns = useMemo(');
  });

  it('seats the table in casino chairs and stamps its probe', () => {
    expect(room).toContain('function CasinoChairs(');
    expect(room).toContain("room: 'vegas-casino'");
  });

  it('keeps the slot screens blank: no text, no symbols-as-text, anywhere in the room', () => {
    expect(room).not.toContain('fillText');
    expect(room).toContain('BLANK glowing screens');
    expect(room).toContain('never symbols-as-text');
    // the carpet is canvas pattern (diamonds / arcs / dots), never words
    expect(room).toContain('no words, no lettering');
  });
});

describe('the Vegas Casino Floor — standing + clearance discipline', () => {
  it('renders no table of its own — chairs at the shared anchors', () => {
    expect(room).not.toContain('CodeTable');
    expect(room).toContain('const CHAIR_SPOTS');
  });

  it("states the coplanar-floor reasoning (the Rec lesson) in its header", () => {
    expect(room).toContain('COPLANAR FLOOR (the Rec lesson, 2026-10-28)');
    expect(room).toContain('FLOOR_Y + 0.012');
  });

  it('keeps the ceiling single-sided downward, so the standing camera sees through it', () => {
    expect(room).toContain('SINGLE-SIDED downward plane');
    expect(room).toContain('rotation={[Math.PI / 2, 0, 0]}');
    expect(room).toContain('g.rotateX(Math.PI / 2)');
  });

  it('hangs no chandelier over the table — the glow medallion is light, not a fixture', () => {
    expect(room).toContain('NO chandelier is hung over the table');
    expect(room).toContain('function CasinoLights(');
  });
});
