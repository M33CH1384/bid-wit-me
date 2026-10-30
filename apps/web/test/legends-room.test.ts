import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { roomGlbUrls } from '../src/assetGate';

/**
 * THE LEGENDS' TABLE — story Stop 10's 3D room (Batch 6b).
 * Pins the story-scoped seam and the room's certified
 * identity so the room can't silently regress: the room
 * mounts ONLY on a vegas story table carrying stop `legends`
 * at High quality; every other vegas table (and Low
 * everywhere) keeps the shipped VegasRoom (the cube room),
 * byte-for-byte the same mount as before. The room itself is
 * ALL CODE (the owner's code-first rule) — no GLB loading
 * anywhere — and it carries the Batch 6b identity anchors:
 * the framed B&W photo gallery (LEG-03), trophy cups on
 * their shelf (LEG-05), the bookshelf (LEG-06), chandeliers
 * (LEG-04) and sconces (LEG-07), velvet curtains (LEG-08),
 * the LEG-02 leather chairs at the seat spots plus four rail
 * chairs, and LEG-01 as a NW side display piece only.
 * Standing-camera discipline (2026-10-28 gate):
 * single-sided ceiling; chandeliers behind the far seat at
 * (±2.60, −3.80), over no part of the felt. Exclusions
 * pinned: no casino chrome, no readable captions or
 * engravings, no text. Named deviation pinned: parquet-block
 * floor, not herringbone.
 */

const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/three/LegendsTableRoom.tsx', import.meta.url), 'utf8');
const venueRoom = readFileSync(new URL('../src/three/VegasRoom.tsx', import.meta.url), 'utf8');
const story = readFileSync(new URL('../../../packages/bots/src/story.ts', import.meta.url), 'utf8');

describe("the Legends' Table — story canon", () => {
  it("stop legends plays at the vegas venue against Queenie & Ace", () => {
    const stop = story.split('\n').find((l) => l.includes("id: 'legends'"));
    expect(stop).toBeDefined();
    expect(stop).toContain("venueId: 'vegas'");
    expect(stop).toContain("pair: ['queenie', 'ace']");
  });
});

describe("the Legends' Table — the Scene seam", () => {
  it('mounts LegendsTableRoom only for the legends stop at High', () => {
    expect(scene).toContain("import LegendsTableRoom from './LegendsTableRoom';");
    expect(scene).toContain(
      "{vegas && textured && (props.storyStopId === 'legends' && props.quality === 'high'",
    );
    expect(scene).toContain('<LegendsTableRoom fxOn={!props.reduceFx} />');
  });

  it('keeps VegasRoom as the fallback on the same branch', () => {
    expect(scene).toContain(
      ': <VegasRoom quality={props.quality} handNo={props.handNo} />)}',
    );
    expect(venueRoom.length).toBeGreaterThan(0);
  });
});

describe("the Legends' Table — code-first, no downloads", () => {
  it('loads no model files and builds its textures procedurally', () => {
    expect(room).not.toContain('useLoader');
    expect(room).not.toContain('.glb');
    expect(room).not.toContain('GLTFLoader');
    expect(room).toContain('function makeParquetTexture()');
    expect(room).toContain('function makePanelTexture()');
    expect(room).toContain('function makePrintTexture(');
    expect(room).toContain('function makeBooksTexture(');
    expect(room).toContain('function makeVelvetTexture()');
  });

  it('adds only its story figures to the loader asset gate (all-code room)', () => {
    // The room itself stays all-code; the gate carries the stop's
    // seated story figures (rollout Batch 3, 2026-10-30), High only.
    expect(roomGlbUrls('vegas', 'high', 'legends')).toEqual([
      { label: expect.any(String), url: '/assets/figures/dee.glb' },
      { label: expect.any(String), url: '/assets/figures/queenie.glb' },
      { label: expect.any(String), url: '/assets/figures/ace.glb' },
    ]);
    expect(roomGlbUrls('vegas', 'low', 'legends')).toEqual([]);
    expect(roomGlbUrls('vegas', 'high', null)).toEqual([]);
  });
});

describe("the Legends' Table — identity anchors", () => {
  it('builds the gallery, chandeliers, shelves, curtains and chairs', () => {
    expect(room).toContain('function Gallery(');
    expect(room).toContain('function Chandeliers(');
    expect(room).toContain('function Sconces(');
    expect(room).toContain('function Bookshelf(');
    expect(room).toContain('function TrophyShelf(');
    expect(room).toContain('function Curtains(');
    expect(room).toContain('function LeatherChairs(');
    expect(room).toContain('function DisplayTable(');
  });

  it('places the walls and furniture per the certified layout', () => {
    expect(room).toContain('const WALL_N = 4.9;');
    expect(room).toContain('const WALL_S = 5.2;');
    expect(room).toContain('const WALL_X = 5.4;');
    expect(room).toContain('const SHELF_FRONT = 5.02;');
    expect(room).toContain('const CURTAIN_FACE = 5.15;');
  });

  it('keeps LEG-01 a side display piece, never the play surface', () => {
    expect(room).toContain('LEG-01 as a side display piece');
    expect(room).toContain("position={[-4.05, Y, -3.45]}");
  });

  it('honors the exclusions: no casino chrome, no text, no readable captions', () => {
    expect(room).not.toContain('fillText');
    expect(room).not.toContain('function SlotMachine');
    expect(room).toContain('no casino chrome');
    expect(room).toContain('no readable');
  });

  it('records the parquet deviation honestly', () => {
    expect(room).toContain('Named deviation: the floor is parquet-block, not the');
  });
});

describe("the Legends' Table — standing + clearance discipline", () => {
  it('keeps the ceiling single-sided at floor + 3.20', () => {
    expect(room).toContain('const CEIL_H = 3.2;');
    expect(room).toContain('rotation={[Math.PI / 2, 0, 0]} position={[0, Y + CEIL_H, 0]}');
  });

  it('hangs both chandeliers behind the far seat, off-axis, over no felt', () => {
    expect(room).toContain('const CHANDELIER_POS: [number, number][] = [[-2.6, -3.8], [2.6, -3.8]];');
  });

  it('measures seat back-clearance from the LEG-02 chair back (0.30 m)', () => {
    expect(room).toContain('const CHAIR_BACK = 0.3;');
    expect(room).toContain('gallery frame front −4.84');
    expect(room).toContain('bookshelf front +5.02 = 2.42 m');
  });

  it('renders no table of its own — chairs at the shared anchors', () => {
    expect(room).not.toContain('CodeTable');
    expect(room).toContain("import { CHAIR_SPOTS } from './classicStudioLayout';");
    expect(room).toContain('function LeatherChairs(');
  });

  it('gates the bulb shimmer behind fxOn in a warm EnvFog room', () => {
    expect(room).toContain('function BulbShimmer(');
    expect(room).toContain("new Fog('#160d0a', 12, 30)");
    expect(room).toContain('export default function LegendsTableRoom({ fxOn }: { fxOn: boolean })');
  });
});
