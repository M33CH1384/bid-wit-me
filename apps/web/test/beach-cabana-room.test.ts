import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * THE BEACH CABANA — the beach venue's own 3D room (venues
 * rollout Batch C2, 2026-10-28). The beach venue hosts no
 * story stop, so the seam has a single branch: every beach
 * table at High mounts this bespoke cabana; Low keeps the
 * shipped cube-config BeachRoom, byte-for-byte the same
 * mount as before. The room itself is ALL CODE (the owner's
 * code-first rule) — no GLB loading anywhere — and it
 * carries the venue identity from the cube dress: open-air
 * cabana posts + thatch, the sea beyond, tiki torches. The
 * table stands on a raised plank deck: solid footing, no
 * chair ever in the sand. Standing-camera discipline: the
 * thatch roof frames the view from above without crossing
 * the felt. Exclusions pinned: no text or lettering anywhere.
 */

const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/three/BeachCabanaRoom.tsx', import.meta.url), 'utf8');
const venueRoom = readFileSync(new URL('../src/three/BeachRoom.tsx', import.meta.url), 'utf8');

const branch = scene.slice(scene.indexOf('{beach && textured'), scene.indexOf('{backyard && textured'));

describe('the Beach Cabana — the Scene seam', () => {
  it('mounts BeachCabanaRoom for beach tables at High', () => {
    expect(scene).toContain("import BeachCabanaRoom from './BeachCabanaRoom';");
    expect(branch).toContain("props.quality === 'high'");
    expect(branch).toContain('<BeachCabanaRoom fxOn={!props.reduceFx} />');
  });

  it('keeps BeachRoom (the cube room) as the Low fallback on the same branch', () => {
    expect(branch).toContain('<BeachRoom quality={props.quality} handNo={props.handNo} />');
    expect(venueRoom).toContain('CubeVenueRoom');
  });

  it('has no story branch: the seam never reads a story stop', () => {
    expect(branch).not.toContain('storyStopId');
  });
});

describe('the Beach Cabana — code-first, no downloads', () => {
  it('loads no model files and builds its textures procedurally', () => {
    expect(room).not.toContain('useLoader');
    expect(room).not.toContain('.glb');
    expect(room).not.toContain('GLTFLoader');
    expect(room).toContain('function makeDeckTexture()');
    expect(room).toContain('function makeThatchTexture()');
    expect(room).toContain('function makeOceanTexture()');
    expect(room).toContain('function makeSandTexture()');
  });
});

describe('the Beach Cabana — identity anchors', () => {
  it('builds the cabana, the umbrellas, the palms, and the sand dressing', () => {
    expect(room).toContain('function Cabana(');
    expect(room).toContain('function Umbrella(');
    expect(room).toContain('function Palm(');
    expect(room).toContain('function SandDressing(');
    expect(room).toContain('function Shell(');
  });

  it('stands the table on a raised deck, never in the sand', () => {
    expect(room).toContain('const DECK_TOP = FLOOR_Y + 0.045');
    expect(room).toContain('function CabanaChairs(');
    expect(room).toContain("room: 'beach-cabana'");
  });

  it('keeps the stripes as pattern only: no text or lettering anywhere in the room', () => {
    expect(room).not.toContain('fillText');
    expect(room).toContain('no text / lettering anywhere');
  });
});

describe('the Beach Cabana — standing + clearance discipline', () => {
  it('renders no table of its own — chairs at the shared anchors', () => {
    expect(room).not.toContain('CodeTable');
    expect(room).toContain('const CHAIR_SPOTS');
  });

  it("states the coplanar-floor reasoning (the Rec lesson) in its header", () => {
    expect(room).toContain('COPLANAR FLOOR (the Rec lesson, 2026-10-28)');
  });

  it('keeps the thatch single-sided downward, so the standing camera sees through the roof', () => {
    expect(room).toContain('SINGLE-SIDED downward planes');
    expect(room).toContain('g.rotateX(Math.PI / 2)');
  });
});
