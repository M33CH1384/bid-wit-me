import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * THE BARBERSHOP (mirror room) — story Stop 2's 3D room (Batch 4),
 * un-scoped to the whole venue by the venues rollout (2026-10-28).
 * Pins the venue-wide seam and the room's certified identity so
 * the shop can't silently regress: the room mounts on EVERY
 * barbershop table at High quality (story tables render exactly
 * as before); Low everywhere keeps the shipped BarbershopRoom,
 * byte-for-byte the same mount as before. The room itself is ALL CODE (the owner's code-first
 * rule) — no GLB loading anywhere — and it carries the Batch 4
 * identity anchors: the mirror wall with three stations behind
 * the far seat, the vintage barber chairs as dressing, the
 * striped pole by the glass door, the photo row over the mirrors,
 * the waiting bench + wall fan west, the towel shelf. Standing-
 * camera discipline (2026-10-28 gate): the tin ceiling is a
 * single-sided plane at floor+3.55 and nothing spans the table.
 * Seat back-clearance (2026-10-28 gate): far seat 0.72 m to the
 * barber-chair footrest, every other seat 1.66 m+.
 */

const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/three/BarbershopMirrorRoom.tsx', import.meta.url), 'utf8');
const venueRoom = readFileSync(new URL('../src/three/BarbershopRoom.tsx', import.meta.url), 'utf8');
const story = readFileSync(new URL('../../../packages/bots/src/story.ts', import.meta.url), 'utf8');

describe('the Barbershop (mirror room) — story canon', () => {
  it("stop barbershop plays at the barbershop venue against Mr. Coleman & June", () => {
    const stop = story.split('\n').find((l) => l.includes("id: 'barbershop'"));
    expect(stop).toBeDefined();
    expect(stop).toContain("venueId: 'barbershop'");
    expect(stop).toContain("pair: ['mrColeman', 'june']");
  });
});

describe('the Barbershop (mirror room) — the Scene seam', () => {
  it('mounts BarbershopMirrorRoom for every barbershop table at High (venues rollout un-scope)', () => {
    expect(scene).toContain("import BarbershopMirrorRoom from './BarbershopMirrorRoom';");
    expect(scene).toContain(
      "{barbershop && textured && (props.quality === 'high'",
    );
    // The stop term is gone: the room follows the venue, not the story flag.
    expect(scene).not.toContain("props.storyStopId === 'barbershop'");
    expect(scene).toContain('<BarbershopMirrorRoom fxOn={!props.reduceFx} />');
  });

  it('keeps BarbershopRoom as the fallback on the same branch', () => {
    expect(scene).toContain(
      ': <BarbershopRoom quality={props.quality} handNo={props.handNo} />)}',
    );
    expect(venueRoom.length).toBeGreaterThan(0);
  });
});

describe('the Barbershop (mirror room) — code-first, no downloads', () => {
  it('loads no model files and builds its textures procedurally', () => {
    expect(room).not.toContain('useLoader');
    expect(room).not.toContain('.glb');
    expect(room).not.toContain('GLTFLoader');
    expect(room).toContain('function makeTinTexture()');
    expect(room).toContain('function makeSepiaTexture(seed: number)');
    expect(room).toContain('function makeStripeTexture()');
    expect(room).toContain('function makeGlowSkyTexture()');
  });
});

describe('the Barbershop (mirror room) — identity anchors', () => {
  it('builds the mirror stations, barber chairs, and the pole', () => {
    expect(room).toContain('function MirrorStations(');
    expect(room).toContain('function BarberChairs(');
    expect(room).toContain('function BarberPole(');
    // aged glass, never a real reflector (manifest exclusion)
    expect(room).toContain("mirror: std({ color: '#bcd6de', metalness: 0.85, roughness: 0.18 })");
  });

  it('carries the west dressing and the photo row', () => {
    expect(room).toContain('function PhotoRow(');
    expect(room).toContain('function Bench(');
    expect(room).toContain('function WallFan(');
    expect(room).toContain('function TowelShelf(');
  });
});

describe('the Barbershop (mirror room) — standing + clearance discipline', () => {
  it('keeps the tin ceiling single-sided at floor+3.55, nothing over the table', () => {
    expect(room).toContain('const ROOM = { x: 4.6, zFar: -4.6, zNear: 4.4, h: 3.55 };');
    expect(room).toContain('SINGLE-SIDED plane facing DOWN only');
  });

  it('renders no table of its own — chairs at the shared anchors', () => {
    expect(room).not.toContain('CodeTable');
    expect(room).toContain('const CHAIR_SPOTS');
    expect(room).toContain('function FoldingChairs(');
    // the far seat's certified clearance, stated in the room header
    expect(room).toContain('back z=-2.23 → barber-chair footrest front z=-2.95 = 0.72 m');
  });
});
