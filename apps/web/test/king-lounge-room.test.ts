import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { roomGlbUrls } from '../src/assetGate';
import { CHAIR_SPOTS, STUDIO } from '../src/three/classicStudioLayout';

/**
 * THE KING'S LOUNGE — story Stop 11's 3D room (Batch 7).
 * Pins the story-scoped seam and the room's certified identity
 * so the room can't silently regress: the lounge mounts ONLY
 * on a blockAfterDark table carrying story stop `king` at
 * High quality; Stop 9 (The Pj's), every non-story
 * blockAfterDark table, and Low everywhere keep the shipped
 * street path (PjsStreetRoom at High, backdrop + PjsLife at
 * Low), byte-for-byte the same mounts as before. The room is
 * the Classic Studio cube dressed plum-and-gold per the
 * manifest (KIN-01…08): BWM canvas sign, credenza + bottles,
 * shaded floor lamp, round rug with gold ring, the shipped
 * studio chair/pendant GLBs. Exclusions pinned: the King's
 * revolver (KingGun) is a table prop — never imported here;
 * no second lettering beyond the one sanctioned sign; the
 * room touches neither KingGun nor KingRail. The room adds
 * nothing to the loader asset gate by design this batch (the
 * gate's composition is a separate lane — the blockAfterDark
 * entries stay exactly as shipped).
 */

const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
const venue3d = readFileSync(new URL('../src/three/Venue3D.tsx', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/three/KingLoungeRoom.tsx', import.meta.url), 'utf8');
const story = readFileSync(new URL('../../../packages/bots/src/story.ts', import.meta.url), 'utf8');

/** Studio chair back extent behind the seat-spot origin (m),
 *  measured from the shipped chair GLB's transformed bounds. */
const CHAIR_BACK = 0.331;

describe("the King's Lounge — story canon", () => {
  it('stop king plays at the blockAfterDark venue against the King & the Ringer', () => {
    const stop = story.split('\n').find((l) => l.includes("id: 'king'") && l.includes('n: 11'));
    expect(stop).toBeDefined();
    expect(stop).toContain("venueId: 'blockAfterDark'");
    expect(stop).toContain("pair: ['king', 'ringer']");
    expect(stop).toContain('targetScore: 750');
  });
});

describe("the King's Lounge — the Venue3D seam", () => {
  it('Scene passes the story stop into Venue3D', () => {
    expect(scene).toContain('storyStopId={props.storyStopId ?? null}');
  });

  it('the lounge activates only for the king stop at High on blockAfterDark', () => {
    expect(venue3d).toContain("const kingActive = def.id === 'blockAfterDark' && storyStopId === 'king' && quality === 'high';");
  });

  it('VenueProps mounts the lounge ahead of the street, street ahead of life', () => {
    expect(venue3d).toContain("import KingLoungeRoom from './KingLoungeRoom';");
    expect(venue3d).toContain(
      "case 'blockAfterDark': return king ? <KingLoungeRoom fxOn={fxOn} /> : env3d ? <PjsStreetRoom fxOn={fxOn} handKey={handKey} /> : <PjsLife fxOn={fxOn} />;",
    );
  });

  it('the street still suppresses backdrop + floor whenever it is active', () => {
    expect(venue3d).toContain("const envActive = def.id === 'blockAfterDark' && quality === 'high' && !kingActive;");
    expect(venue3d).toContain('const env3d = envActive || kingActive;');
    expect(venue3d).toContain('{urls.bg && !env3d && <Backdrop');
    expect(venue3d).toContain('{!env3d && <VenueFloor');
  });

  it("Stop 9 keeps the street: the king branch never fires for the pjs stop or no stop", () => {
    // kingActive's equality on 'king' is the whole scoping — the-pjs (Stop 9)
    // and null (non-story) both fall through to the shipped street branch.
    expect(venue3d).not.toContain("storyStopId === 'the-pjs'");
    expect(roomGlbUrls('blockAfterDark', 'high', 'king')).toEqual(roomGlbUrls('blockAfterDark', 'high', 'the-pjs'));
  });

  it('adds nothing to the loader asset gate (gate composition unchanged this batch)', () => {
    expect(roomGlbUrls('blockAfterDark', 'high', 'king')).toEqual([
      { label: expect.any(String), url: '/assets/venues/blockAfterDark/sedan.glb' },
    ]);
    expect(roomGlbUrls('blockAfterDark', 'low', 'king')).toEqual([]);
    expect(room).not.toContain("from '../assetGate'");
    expect(room).not.toContain('roomGlbUrls');
    expect(room).not.toContain('noteRoomAssets');
  });
});

describe("the King's Lounge — identity anchors (KIN-01…08)", () => {
  it('is the Classic Studio cube, locked to the shared constants', () => {
    expect(room).toContain("import { CHAIR_SPOTS, STUDIO } from './classicStudioLayout';");
    expect(room).toContain("const WALL = '#55314d'");
    expect(room).toContain("const WALL_DARK = '#3f1e38'");
    expect(room).toContain("const PANEL = '#542848'");
  });

  it('builds the sign, rug, credenza, bottles and lamp from the staging', () => {
    expect(room).toContain('function makeSignTexture()');
    expect(room).toContain("g.fillText('B W M', 512, 118)");
    expect(room).toContain("g.fillText('S P A D E S   L O U N G E', 512, 208)");
    expect(room).toContain('const RUG_R = 3.1;');
    expect(room).toContain('const RING_IN = 2.92;');
    expect(room).toContain('const RING_OUT = 3.02;');
    expect(room).toContain('const CREDENZA_POS: [number, number, number] = [-2.5, 0, -3.9];');
    expect(room).toContain('const LAMP_POS: [number, number, number] = [2.6, 0, -3.85];');
    expect(room).toContain('const BOTTLE_X = [-0.7, -0.45, -0.2, 0.15, 0.42, 0.68] as const;');
    expect(room).toContain('function makeWoodTexture()');
  });

  it('hangs the one sanctioned sign on the far wall — and no other lettering', () => {
    expect(room).toContain('const SIGN_POS: [number, number, number] = [0, 3.5, STUDIO.zFar + 0.02];');
    expect(room.match(/fillText/g)).toHaveLength(2); // B W M + SPADES LOUNGE, nothing else
  });

  it('loads the shipped studio GLBs with the ClassicStudio pattern (KIN-06/07)', () => {
    expect(room).toContain('GLTFLoader');
    expect(room).toContain('KTX2Loader');
    expect(room).toContain('MeshoptDecoder');
    expect(room).toContain('`${BASE}/chair.glb`');
    expect(room).toContain('`${BASE}/lamp.glb`');
    expect(room).toContain('STUDIO.lampShadeBottom - box.min.y');
    expect(room).not.toContain('useLoader');
  });

  it('renders no table of its own and never touches the King props or rail', () => {
    expect(room).not.toContain("from './KingGun'");
    expect(room).not.toContain('<KingGun');
    expect(room).not.toContain('<KingRail');
    expect(room).toContain('NOT a room\n * item; this room neither builds nor touches it'); // the documented exclusion
    expect(room).toContain('export default function KingLoungeRoom({ fxOn }: { fxOn: boolean })');
  });
});

describe("the King's Lounge — standing + clearance discipline", () => {
  it('keeps the ceiling a single-sided plane at floor + 5.00 (the cube discipline)', () => {
    expect(room).toContain('rotation={[Math.PI / 2, 0, 0]} position={[0, STUDIO.height, 0]}');
    expect(STUDIO.height).toBe(5.0);
  });

  it('measures seat back-clearance from the studio chair back (0.331 m)', () => {
    expect(room).toContain('const CHAIR_BACK = 0.331;');
    expect(room).toContain('trim face −4.165 = 1.38 m');
  });

  it('every seat clears the walls by ≥ 0.6 m of open floor (audit arithmetic)', () => {
    // nearest proud faces: far baseboard box (centre zFar+0.02, 0.03 thick)
    // → −4.165; side baseboard boxes (centre ±(roomX−0.02), 0.03 thick) → ±3.565
    const farFace = Math.abs(STUDIO.zFar + 0.02) - 0.015; // 4.165
    const sideFace = STUDIO.roomX - 0.02 - 0.015; // 3.565
    const floorEdge = Math.abs(STUDIO.zFar); // open camera side: floor runs to +4.20
    const [far, player, west, east] = CHAIR_SPOTS;
    const clearances = [
      farFace - (Math.abs(far!.z) + CHAIR_BACK), // far seat → far trim face
      floorEdge - (player!.z + CHAIR_BACK), // player → open side, floor edge
      sideFace - (Math.abs(west!.x) + CHAIR_BACK), // west → side baseboard face
      sideFace - (Math.abs(east!.x) + CHAIR_BACK), // east → side baseboard face
    ];
    expect(clearances[0]).toBeCloseTo(1.38, 2);
    expect(clearances[1]).toBeCloseTo(1.07, 2);
    expect(clearances[2]).toBeCloseTo(0.93, 2);
    expect(clearances[3]).toBeCloseTo(0.93, 2);
    for (const d of clearances) expect(d).toBeGreaterThanOrEqual(0.6);
  });

  it('keeps the credenza off every seat axis (behind no seat)', () => {
    // credenza spans x −3.45…−1.55 at the far wall; the far seat sits at x 0,
    // the west seat's back line runs along x at z 0 — the credenza (z −3.9)
    // stands behind neither.
    expect(room).toContain('stands\n * off-axis west, 0.87 m from the back point\'s line, behind\n * no seat');
  });

  it('gates the lamp breathing behind fxOn in a plum EnvFog room', () => {
    expect(room).toContain('function EnvFog()');
    expect(room).toContain("new Fog('#1a0b26', 10, 26)");
    expect(room).toContain('if (!fxOn || !shadeRef.current) return;');
  });
});
