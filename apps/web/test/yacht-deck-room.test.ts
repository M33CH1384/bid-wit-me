import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * THE YACHT DECK — the yacht venue's own 3D room (venues
 * rollout Batch C2, 2026-10-28). The yacht venue hosts no
 * story stop, so the seam has a single branch: every yacht
 * table at High mounts this bespoke deck; Low keeps the
 * shipped cube-config YachtRoom, byte-for-byte the same
 * mount as before. The room itself is ALL CODE (the owner's
 * code-first rule) — no GLB loading anywhere — and it
 * carries the venue identity from the cube dress: open-air
 * teak deck, sea and sky beyond the rails, the mast's place
 * taken by the cabin + flybridge on the far side. Standing-
 * camera discipline: open air, no ceiling; the only
 * overhead structure is the radar arch aft. Exclusions
 * pinned: no text or lettering anywhere.
 */

const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/three/YachtDeckRoom.tsx', import.meta.url), 'utf8');
const venueRoom = readFileSync(new URL('../src/three/YachtRoom.tsx', import.meta.url), 'utf8');

const branch = scene.slice(scene.indexOf('{yacht && textured'), scene.indexOf('{beach && textured'));

describe('the Yacht Deck — the Scene seam', () => {
  it('mounts YachtDeckRoom for yacht tables at High', () => {
    expect(scene).toContain("import YachtDeckRoom from './YachtDeckRoom';");
    expect(branch).toContain("props.quality === 'high'");
    expect(branch).toContain('<YachtDeckRoom fxOn={!props.reduceFx} />');
  });

  it('keeps YachtRoom (the cube room) as the Low fallback on the same branch', () => {
    expect(branch).toContain('<YachtRoom quality={props.quality} handNo={props.handNo} />');
    expect(venueRoom).toContain('CubeVenueRoom');
  });

  it('has no story branch: the seam never reads a story stop', () => {
    expect(branch).not.toContain('storyStopId');
  });
});

describe('the Yacht Deck — code-first, no downloads', () => {
  it('loads no model files and builds its textures procedurally', () => {
    expect(room).not.toContain('useLoader');
    expect(room).not.toContain('.glb');
    expect(room).not.toContain('GLTFLoader');
    expect(room).toContain('function makeTeakTexture()');
    expect(room).toContain('function makeSeaTexture()');
    expect(room).toContain('function makeSkyTexture()');
  });
});

describe('the Yacht Deck — identity anchors', () => {
  it('builds the cabin, the radar arch, the aft dressing, and the ensign', () => {
    expect(room).toContain('function Cabin(');
    expect(room).toContain('function Arch(');
    expect(room).toContain('function Dressing(');
    expect(room).toContain('function Ensign(');
    expect(room).toContain('function Shell(');
  });

  it('seats the table in teak deck chairs and stamps its probe', () => {
    expect(room).toContain('function DeckChairs(');
    expect(room).toContain("room: 'yacht-deck'");
  });

  it('keeps the name board blank: no text or lettering anywhere in the room', () => {
    expect(room).not.toContain('fillText');
    expect(room).toContain('no text / lettering anywhere');
  });
});

describe('the Yacht Deck — standing + clearance discipline', () => {
  it('renders no table of its own — chairs at the shared anchors', () => {
    expect(room).not.toContain('CodeTable');
    expect(room).toContain('const CHAIR_SPOTS');
  });

  it("states the coplanar-floor reasoning (the Rec lesson) in its header", () => {
    expect(room).toContain('COPLANAR FLOOR (the Rec lesson, 2026-10-28)');
  });
});
