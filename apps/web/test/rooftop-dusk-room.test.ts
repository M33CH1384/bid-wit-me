import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * THE ROOFTOP — story Stop 7's 3D room (Batch 5b). Pins the
 * story-scoped seam and the room's certified identity so the
 * roof can't silently regress: the room mounts ONLY on a
 * rooftop story table carrying stop `rooftop` at High
 * quality; every other rooftop table (and Low everywhere)
 * keeps the shipped RooftopRoom (the cube room), byte-for-byte
 * the same mount as before. The room itself is ALL CODE (the
 * owner's code-first rule) — no GLB loading anywhere — and it
 * carries the Batch 5b identity anchors: the wooden water
 * tower behind the far seat, left of centre (tank Ø 2.60,
 * total H 6.00), the H 1.05 parapet with inner faces at ±7.5,
 * string lights on H 3.00 poles on PERIMETER RUNS ONLY along
 * the parapet lines at ±7.2, the empty pigeon coop off-axis,
 * the bulkhead hut with its blank steel door, the vent pipe
 * cluster, the crate cluster and the TV antenna. Standing-
 * camera discipline (2026-10-28 gate): open air, no ceiling,
 * no strand/pole over the table. Exclusions pinned: no
 * pigeons/birds, no text.
 */

const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/three/RooftopDuskRoom.tsx', import.meta.url), 'utf8');
const venueRoom = readFileSync(new URL('../src/three/RooftopRoom.tsx', import.meta.url), 'utf8');
const story = readFileSync(new URL('../../../packages/bots/src/story.ts', import.meta.url), 'utf8');

describe('the Rooftop — story canon', () => {
  it("stop rooftop plays at the rooftop venue against Poet & Seven", () => {
    const stop = story.split('\n').find((l) => l.includes("id: 'rooftop'"));
    expect(stop).toBeDefined();
    expect(stop).toContain("venueId: 'rooftop'");
    expect(stop).toContain("pair: ['poet', 'seven']");
  });
});

describe('the Rooftop — the Scene seam', () => {
  it('mounts RooftopDuskRoom only for the rooftop stop at High', () => {
    expect(scene).toContain("import RooftopDuskRoom from './RooftopDuskRoom';");
    expect(scene).toContain(
      "{rooftop && textured && (props.storyStopId === 'rooftop' && props.quality === 'high'",
    );
    expect(scene).toContain('<RooftopDuskRoom fxOn={!props.reduceFx} />');
  });

  it('keeps RooftopRoom as the fallback on the same branch', () => {
    expect(scene).toContain(
      ': <RooftopRoom quality={props.quality} handNo={props.handNo} />)}',
    );
    expect(venueRoom.length).toBeGreaterThan(0);
  });
});

describe('the Rooftop — code-first, no downloads', () => {
  it('loads no model files and builds its textures procedurally', () => {
    expect(room).not.toContain('useLoader');
    expect(room).not.toContain('.glb');
    expect(room).not.toContain('GLTFLoader');
    expect(room).toContain('function makeTarGravelTexture()');
    expect(room).toContain('function makeParapetTexture()');
    expect(room).toContain('function makeTimberTexture()');
    expect(room).toContain('function makeSunsetSkyTexture()');
    expect(room).toContain('function makeSkylineTexture()');
  });
});

describe('the Rooftop — identity anchors', () => {
  it('builds the water tower, the parapet, and the coop', () => {
    expect(room).toContain('function WaterTower(');
    expect(room).toContain('function Parapet(');
    expect(room).toContain('function PigeonCoop(');
    expect(room).toContain('function BulkheadHut(');
    expect(room).toContain('function StringLightRun(');
    expect(room).toContain('function VentPipes(');
    expect(room).toContain('function CrateCluster(');
    expect(room).toContain('function TvAntenna(');
    expect(room).toContain('function Skyline(');
  });

  it('sizes the tower per the manifest: tank Ø 2.60, total H 6.00, behind the far seat left of centre', () => {
    expect(room).toContain('args={[1.30, 1.34, 3.0, 24]}'); // tank Ø 2.60 × H 3.00
    expect(room).toContain('total H 6.00');
    expect(room).toContain("const TOWER_POS: [number, number] = [-2.5, -6.15];");
  });

  it('runs the parapet at H 1.05 with inner faces at ±7.5', () => {
    expect(room).toContain('const PARAPET_FACE = 7.5;');
    expect(room).toContain('box(L, 1.05, 0.30, 0, 0.525, -C)');
  });

  it('honors the exclusions: no pigeons/birds, no text', () => {
    expect(room).not.toContain('function Pigeon(');
    expect(room).not.toContain('function Bird');
    expect(room).not.toContain('fillText');
    expect(room).toContain('no live pigeons/birds (the coop');
  });
});

describe('the Rooftop — standing + clearance discipline', () => {
  it('keeps every string run on the parapet lines at ±7.2 — perimeter only, none over the table', () => {
    expect(room).toContain('const STRING_RUN_LINE = 7.2;');
    expect(room).toContain('const POLE_H = 3.0;');
    // the north run hangs behind the far seat on the z −7.2 line
    expect(room).toContain('b: [3.6, Y, -L], bulbs: 19');
    expect(room.toLowerCase()).not.toContain('ceiling');
  });

  it('renders no table of its own — chairs at the shared anchors', () => {
    expect(room).not.toContain('CodeTable');
    expect(room).toContain("import { CHAIR_SPOTS } from './classicStudioLayout';");
    expect(room).toContain('function FoldingChairs(');
  });

  it('gates the bulb shimmer behind fxOn in a sunset EnvFog room', () => {
    expect(room).toContain('function BulbShimmer(');
    expect(room).toContain("new Fog('#3d2638', 14, 52)");
    expect(room).toContain('export default function RooftopDuskRoom({ fxOn }: { fxOn: boolean })');
  });
});
