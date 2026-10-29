import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { roomGlbUrls } from '../src/assetGate';

/**
 * THE HIGH-RISE — story Stop 8's 3D room (Batch 6a), un-scoped
 * to the whole mansion venue in the venues rollout (owner
 * 2026-10-28: the penthouse serves the mansion). Pins the
 * venue seam and the room's certified identity so the
 * penthouse can't silently regress: the room mounts on EVERY
 * mansion table at High quality — the `high-rise` story table
 * renders exactly as it did story-scoped, and regular mansion
 * tables now get the penthouse too; Low everywhere keeps the
 * shipped MansionRoom (the cube room), byte-for-byte the same
 * mount as before. The room itself is ALL CODE (the
 * owner's code-first rule) — no GLB loading anywhere — and it
 * carries the Batch 6a identity anchors: floor-to-ceiling
 * glass on N/E/W with the city far below (environment, not
 * items), brushed-steel columns, stone panels + steel
 * credenza on the south wall, cove light strips at the wall
 * heads, and the HIG-03 designer armchairs at the seat spots.
 * Standing-camera discipline (2026-10-28 gate): single-sided
 * ceiling, strips at the wall heads only, columns at the
 * corners — nothing over the table. Exclusions pinned: no
 * gold/velvet, no screens, no text, no people dressing (this
 * stop is empty by design for railbirds).
 */

const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/three/HighRisePenthouseRoom.tsx', import.meta.url), 'utf8');
const venueRoom = readFileSync(new URL('../src/three/MansionRoom.tsx', import.meta.url), 'utf8');
const story = readFileSync(new URL('../../../packages/bots/src/story.ts', import.meta.url), 'utf8');

describe('the High-Rise — story canon', () => {
  it("stop high-rise plays at the mansion venue against Velvet & The Accountant", () => {
    const stop = story.split('\n').find((l) => l.includes("id: 'high-rise'"));
    expect(stop).toBeDefined();
    expect(stop).toContain("venueId: 'mansion'");
    expect(stop).toContain("pair: ['velvet', 'accountant']");
  });
});

describe('the High-Rise — the Scene seam', () => {
  it('mounts HighRisePenthouseRoom for every mansion table at High (un-scoped)', () => {
    expect(scene).toContain("import HighRisePenthouseRoom from './HighRisePenthouseRoom';");
    expect(scene).toContain(
      "{mansion && textured && (props.quality === 'high'",
    );
    // The story term is gone from the branch: no mansion table is
    // routed to the cube fallback at High anymore.
    expect(scene).not.toContain("props.storyStopId === 'high-rise'");
    expect(scene).toContain('<HighRisePenthouseRoom fxOn={!props.reduceFx} />');
  });

  it('keeps MansionRoom as the fallback on the same branch', () => {
    expect(scene).toContain(
      ': <MansionRoom quality={props.quality} handNo={props.handNo} />)}',
    );
    expect(venueRoom.length).toBeGreaterThan(0);
  });
});

describe('the High-Rise — code-first, no downloads', () => {
  it('loads no model files and builds its textures procedurally', () => {
    expect(room).not.toContain('useLoader');
    expect(room).not.toContain('.glb');
    expect(room).not.toContain('GLTFLoader');
    expect(room).toContain('function makeConcreteFloorTexture()');
    expect(room).toContain('function makeStoneTexture()');
    expect(room).toContain('function makeBrushedTexture()');
    expect(room).toContain('function makeCityTexture()');
    expect(room).toContain('function makeNightSkyTexture()');
  });

  it('adds nothing to the loader asset gate (all-code room)', () => {
    expect(roomGlbUrls('mansion', 'high', 'high-rise')).toEqual([]);
    expect(roomGlbUrls('mansion', 'low', 'high-rise')).toEqual([]);
  });
});

describe('the High-Rise — identity anchors', () => {
  it('builds the glass box, columns, stone, credenza and armchairs', () => {
    expect(room).toContain('function GlassRun(');
    expect(room).toContain('function Columns(');
    expect(room).toContain('function StoneWalls(');
    expect(room).toContain('function LightStrips(');
    expect(room).toContain('function Credenza(');
    expect(room).toContain('function SideTable(');
    expect(room).toContain('function Armchairs(');
    expect(room).toContain('function CityBelow(');
  });

  it('places the glass faces and stone wall per the certified layout', () => {
    expect(room).toContain('const GLASS_N = -5.2;');
    expect(room).toContain('const GLASS_X = 5.2;');
    expect(room).toContain('const STONE_S = 5.6;');
    expect(room).toContain('const CREDENZA_FRONT = 5.15;');
  });

  it('honors the exclusions: no text, no figures of its own', () => {
    expect(room).not.toContain('fillText');
    expect(room).toContain('empty by design');
  });
});

describe('the High-Rise — standing + clearance discipline', () => {
  it('keeps the ceiling single-sided at floor + 3.40 and the strips at the wall heads', () => {
    expect(room).toContain('const CEIL_H = 3.4;');
    expect(room).toContain('rotation={[Math.PI / 2, 0, 0]} position={[0, Y + CEIL_H, 0]}');
    expect(room).toContain('[-5.02, 5.42].map');
  });

  it('measures seat back-clearance from the HIG-03 chair back (0.32 m)', () => {
    expect(room).toContain('const CHAIR_BACK = 0.32;');
    expect(room).toContain('glass face −5.20 = 2.43 m');
    expect(room).toContain('credenza front +5.15 =');
  });

  it('renders no table of its own — chairs at the shared anchors', () => {
    expect(room).not.toContain('CodeTable');
    expect(room).toContain("import { CHAIR_SPOTS } from './classicStudioLayout';");
    expect(room).toContain('function Armchairs(');
  });

  it('gates the strip shimmer behind fxOn in a cold EnvFog room', () => {
    expect(room).toContain('function StripShimmer(');
    expect(room).toContain("new Fog('#0b1424', 16, 90)");
    expect(room).toContain('export default function HighRisePenthouseRoom({ fxOn }: { fxOn: boolean })');
  });
});
