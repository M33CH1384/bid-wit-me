import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * THE REC CENTER — story Stop 3's 3D room (Batch 5a). Pins the
 * story-scoped seam and the room's certified identity so the
 * gym can't silently regress: the room mounts ONLY on a classic
 * story table carrying stop `rec-center` at High quality; every
 * other classic table (and Low everywhere) keeps the shipped
 * ClassicStudio, byte-for-byte the same mount as before. The
 * room itself is ALL CODE (the owner's code-first rule) — no
 * model loading anywhere — and it carries the Batch 5a identity
 * anchors: a polished maple court floor with painted lines, a
 * blue bleacher bank under a BLANK mustard banner on the far
 * wall, ceiling-suspended hoop assemblies at both court ends,
 * a south-wall padding run, a mat stack, a ball rack, a folded-
 * chair lean and blue double exit doors. Standing-camera
 * discipline (2026-10-28 gate): the gym ceiling is a single-
 * sided plane at floor+7.00 and the fluorescent fixtures run
 * at z=±3.4 around the table instead of crossing it. Seat
 * back-clearance (2026-10-28 gate): every seat measures ≥ 0.6 m
 * (far 3.20 m to the bleacher front, player 4.34 m to the
 * padding face, sides 8.45 m to the walls). Exclusions pinned:
 * no score display, no text anywhere — the banner is blank.
 */

const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/three/RecCenterGymRoom.tsx', import.meta.url), 'utf8');
const studio = readFileSync(new URL('../src/three/ClassicStudio.tsx', import.meta.url), 'utf8');
const story = readFileSync(new URL('../../../packages/bots/src/story.ts', import.meta.url), 'utf8');

describe('the Rec Center — story canon', () => {
  it("stop rec-center plays at the classic venue against Lil' Man & Trey", () => {
    const stop = story.split('\n').find((l) => l.includes("id: 'rec-center'"));
    expect(stop).toBeDefined();
    expect(stop).toContain("venueId: 'classic'");
    expect(stop).toContain("pair: ['lilMan', 'trey']");
  });
});

describe('the Rec Center — the Scene seam', () => {
  it('mounts RecCenterGymRoom only for the rec-center stop at High', () => {
    expect(scene).toContain("import RecCenterGymRoom from './RecCenterGymRoom';");
    expect(scene).toContain(
      "{classic && textured && (props.storyStopId === 'rec-center' && props.quality === 'high'",
    );
    expect(scene).toContain('<RecCenterGymRoom fxOn={!props.reduceFx} />');
  });

  it('keeps ClassicStudio as the fallback on the same branch', () => {
    expect(scene).toContain(': <ClassicStudio quality={props.quality} />)}');
    expect(studio.length).toBeGreaterThan(0);
  });
});

describe('the Rec Center — code-first, no downloads', () => {
  it('loads no model files and builds its textures procedurally', () => {
    expect(room).not.toContain('useLoader');
    expect(room).not.toContain('.glb');
    expect(room).not.toContain('GLTFLoader');
    expect(room).toContain('function makeCourtFloorTexture()');
    expect(room).toContain('function makeBlockWallTexture(');
    expect(room).toContain('function makeGymCeilingTexture()');
  });

  it("imports its seat anchors from classicStudioLayout, not a local copy", () => {
    expect(room).toContain("import { CHAIR_SPOTS } from './classicStudioLayout';");
    expect(room).toContain('CHAIR_SPOTS.map(');
  });
});

describe('the Rec Center — identity anchors', () => {
  it('builds the bleachers, both hoops, and the blank banner (REC-01…03)', () => {
    expect(room).toContain('function Bleachers(');
    expect(room).toContain('function HoopAssembly(');
    expect(room).toContain('function Banner(');
    expect(room).toContain('#d9a92c'); // the mustard-yellow banner fabric
    expect(room).toContain('#1d2c4e'); // its navy border
  });

  it('builds the dressing: padding, mats, ball rack, chair stack, doors (REC-04…08)', () => {
    expect(room).toContain('function WallPadding(');
    expect(room).toContain('function MatStack(');
    expect(room).toContain('function BallRack(');
    expect(room).toContain('function FoldingChairStack(');
    expect(room).toContain('function ExitDoors(');
    expect(room).toContain('function ClerestoryWindow(');
  });

  it('seats the table in blue-grey moulded folding chairs', () => {
    expect(room).toContain('function FoldingChairs(');
    expect(room).toContain('#5b6b7d');
  });

  it('swaps the dark classic fog for a bright gym fog while mounted', () => {
    expect(room).toContain('function EnvFog()');
    expect(room).toContain("new Fog('#dfe8ee', 16, 42)");
    expect(room).toContain('scene.fog = prev');
  });

  it('honors the exclusions: no score display, no text anywhere', () => {
    expect(room.toLowerCase()).not.toContain('scoreboard');
    expect(room).not.toContain('fillText');
    expect(room).toContain('HARD EXCLUSIONS (manifest): no score display, no text /');
    expect(room).toContain('BLANK');
  });
});

describe('the Rec Center — standing + clearance discipline', () => {
  it('keeps the gym ceiling at floor+7.00 with fixtures ringing the table', () => {
    expect(room).toContain('const WALL_H = 7.0;');
    expect(room).toContain('function FluoroFixtures(');
    expect(room).toContain('function FluoroShimmer(');
    // the fixture rows sit at z = ±3.4 — none spans the table
    expect(room).toContain('([-3.4, 3.4] as const)');
  });

  it('keeps the hoops at the court ends, ~9 m from the table', () => {
    expect(room).toContain('side * 9.3');
    expect(room).toContain('<HoopAssembly side={-1} a={a} />');
    expect(room).toContain('<HoopAssembly side={1} a={a} />');
  });

  it('records the measured seat back-clearances in the header', () => {
    expect(room).toContain('bleacher front face');
    expect(room).toContain('3.20 m');
    expect(room).toContain('4.34 m');
    expect(room).toContain('8.45 m');
  });

  it('renders no table of its own — chairs at the shared anchors', () => {
    expect(room).not.toContain('CodeTable');
    expect(room).toContain('NO table here — the shared game table is the anchor');
  });
});
