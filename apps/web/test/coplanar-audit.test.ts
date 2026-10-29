/**
 * COPLANAR AUDIT — venues rollout Batch D (2026-10-29).
 *
 * The Rec Center defect (fixed in 64f3d8e606): TableModel's classic
 * ground plane and the gym's court floor both sat at exactly FLOOR_Y
 * (−0.9), fully overlapping — per-pixel z-fighting that SwiftShader
 * certification resolved for the court and the owner's phone resolved
 * in dark patches. The lesson: certify from the GEOMETRY, not from a
 * clean capture. This suite is the audit's record: every seam-mounted
 * room's horizontal surfaces were inventoried from source, and the
 * verdicts below are pinned so a future edit that moves a floor onto
 * a shared depth fails here and forces a re-audit.
 *
 * Method: for each frame a seam can produce, list the opaque
 * horizontal surfaces and their world depths. A pair FAILS only if two
 * opaque surfaces share the SAME depth over an overlapping area.
 * Distinct depths — even 1 mm apart at these ranges — resolve cleanly
 * in a 24-bit depth buffer; exact equality is the defect. Only one
 * room mounts per venue branch (Scene's ternaries), and TableModel's
 * ground plane renders only for the classic venue, so the cross-room
 * pairs to check are few.
 *
 * VERDICTS (all PASS — no fix required, no code churned):
 *  - RecCenterGymRoom (classic, stop rec-center, High): court at
 *    FLOOR_Y; TableModel's ground plane is suppressed by the
 *    `roomFloor` prop under the IDENTICAL condition (pin 1).
 *  - ClassicStudio (classic, all other tables): shell floor at
 *    floorY + 0.005 vs the ground plane at FLOOR_Y — 5 mm apart.
 *  - KingLoungeRoom (blockAfterDark, stop king, High): Venue3D renders
 *    NO floor in that branch (env3d); the lounge's own floor/rug/ring
 *    sit at floorY + 0.005 / + 0.006 / + 0.008 — all distinct.
 *  - PjsStreetRoom (blockAfterDark, High): Venue3D renders no floor;
 *    the street layers sit at FLOOR_Y / + 0.002 / − 0.01, abutting or
 *    distinctly offset where they overlap.
 *  - Venue3D Low (blockAfterDark): the floor disc at FLOOR_Y is the
 *    only floor; blockAfterDark's floorRadius makes it transparent
 *    with depthWrite off — not an opaque surface at all. PjsLife adds
 *    no floor-level plane.
 *  - CornerStreetRoom: ground layers at FLOOR_Y, + 0.001, + 0.002,
 *    + 0.006, − 0.012 — five depths, no equality.
 *  - PorchDeckRoom: deck is a box whose top is exactly FLOOR_Y; the
 *    lawn (− 0.37), sidewalk box top (− 0.32) and asphalt (− 0.38)
 *    sit below and beyond the deck's footprint.
 *  - BarbershopMirrorRoom: interior floor at FLOOR_Y; the outside
 *    ground at − 0.005 relative, starting exactly at the storefront
 *    line (x 4.6) where the interior floor ends — abutting, lower.
 *  - BarbershopRoom (Low fallback): floor at floorY + 0.005, the
 *    exterior sidewalk at + 0.01 relative — distinct.
 *  - Single-floor rooms at exactly FLOOR_Y — ChurchBasementRoom,
 *    CookoutYardRoom, GrandmasKitchenRoom, SpeakeasyLoungeRoom,
 *    RooftopDuskRoom, RooftopSkylineRoom, YachtDeckRoom (deck; its
 *    sea rides at − 1.1), LegendsTableRoom and HighRisePenthouseRoom
 *    (floor at Y = FLOOR_Y; the city plane 22 m below): one floor
 *    each, and at their venues the TableModel ground plane never
 *    renders (classic-only), so FLOOR_Y is uncontested.
 *  - VegasCasinoRoom: carpet at FLOOR_Y, the gold inlay ring at
 *    + 0.012; ceiling medallion planes at two further depths.
 *  - BeachCabanaRoom: deck top at + 0.045; sand − 0.36, ocean − 0.34,
 *    foam band − 0.315 — four depths, no equality.
 *  - CubeVenueRoom (the nine Low fallbacks): one floor at
 *    floorY + 0.005; the configs' planes are vertical sky/sea
 *    backdrops, never horizontal at the floor's depth. At classic
 *    the same + 0.005 shell keeps 5 mm from the ground plane.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

describe('coplanar audit — the TableModel ground plane (the Rec mechanism)', () => {
  const scene = src('three/Scene.tsx');

  it('the ground plane renders for the classic venue only, at exactly FLOOR_Y', () => {
    expect(scene).toContain("{def.id === 'classic' && !roomFloor && (");
    expect(scene).toContain('position={[0, -0.9, 0]}');
    expect(scene).toContain('planeGeometry args={[30, 30]}');
  });

  it('its suppression condition is identical to the Rec gym mount condition', () => {
    // the gym mounts iff classic && stop rec-center && High (Scene branch);
    // roomFloor must suppress the plane in exactly those frames — no wider
    // (a regular classic table keeps its ground) and no narrower.
    expect(scene).toContain("roomFloor={classic && props.storyStopId === 'rec-center' && props.quality === 'high'}");
    expect(scene).toContain("(props.storyStopId === 'rec-center' && props.quality === 'high'\n        ? <RecCenterGymRoom");
  });

  it('Venue3D mounts only where no cube/classic branch claims the venue', () => {
    expect(scene).toContain('{!classic && !cubeRoom && textured && <Venue3D');
  });
});

describe('coplanar audit — studio-family shells keep +0.005 over the ground plane', () => {
  for (const f of ['three/ClassicStudio.tsx', 'three/KingLoungeRoom.tsx', 'three/cubeVenue.tsx', 'three/BarbershopRoom.tsx']) {
    it(`${f}: the shell floor rides at local +0.005`, () => {
      expect(src(f)).toContain('position={[0, 0.005, 0]}');
    });
  }

  it("the King's rug and ring ride above its floor at distinct depths", () => {
    const lounge = src('three/KingLoungeRoom.tsx');
    expect(lounge).toContain('position={[0, 0.006, 0]}'); // rug over the +0.005 floor
    expect(lounge).toContain('position={[0, 0.008, 0]}'); // ring over the rug
  });

  it('Venue3D renders no floor at all under the street room or the lounge', () => {
    const venue3d = src('three/Venue3D.tsx');
    expect(venue3d).toContain('{!env3d && <VenueFloor');
  });

  it("the Pj's Low floor disc is transparent (alpha fade, no depth write) — never an opaque pair", () => {
    const venue3d = src('three/Venue3D.tsx');
    expect(venue3d).toContain('transparent={!!alpha} depthWrite={!alpha}');
    const venues = src('venues.ts');
    expect(venues).toContain('floorRadius: 10'); // blockAfterDark's disc radius (the alpha path)
  });
});

describe('coplanar audit — layered grounds keep distinct depths', () => {
  it('CornerStreetRoom: five ground depths, none equal', () => {
    const corner = src('three/CornerStreetRoom.tsx');
    for (const off of ['FLOOR_Y + 0.001', 'FLOOR_Y + 0.002', 'FLOOR_Y + 0.006', 'FLOOR_Y - 0.012']) {
      expect(corner, off).toContain(off);
    }
    expect(corner).toContain('position={[0, FLOOR_Y, 8.7]}'); // the road itself, the fifth depth
  });

  it('PjsStreetRoom: sidewalk +0.002, street at FLOOR_Y, far plane −0.01', () => {
    const pjs = src('three/PjsStreetRoom.tsx');
    expect(pjs).toContain('position={[0, FLOOR_Y + 0.002, 0.55]}');
    expect(pjs).toContain('position={[0, FLOOR_Y, -8.85]}');
    expect(pjs).toContain('position={[0, FLOOR_Y - 0.01, -18]}');
  });

  it('PorchDeckRoom: deck box top lands exactly on FLOOR_Y; the yard layers sit below', () => {
    const porch = src('three/PorchDeckRoom.tsx');
    // box centred at FLOOR_Y − 0.05 with height 0.1 → top at FLOOR_Y
    expect(porch).toContain('position={[0, FLOOR_Y - 0.05, 0.5]}');
    expect(porch).toContain('boxGeometry args={[7.6, 0.1, 7.6]}');
    expect(porch).toContain('position={[0, FLOOR_Y - 0.37, 7.5]}'); // lawn
    expect(porch).toContain('position={[0, FLOOR_Y - 0.38, 12.5]}'); // asphalt
  });

  it('BarbershopMirrorRoom: outside ground abuts the floor at the storefront, 5 mm lower', () => {
    const mirror = src('three/BarbershopMirrorRoom.tsx');
    expect(mirror).toContain('<group position={[0, FLOOR_Y, 0]}>');
    expect(mirror).toContain('position={[0, 0, -0.1]}'); // the floor plane, at the group's FLOOR_Y
    expect(mirror).toContain('position={[7.3, -0.005, -0.1]}');
  });

  it('BeachCabanaRoom: deck, sand, ocean, foam at four depths', () => {
    const beach = src('three/BeachCabanaRoom.tsx');
    expect(beach).toContain('const DECK_TOP = FLOOR_Y + 0.045;');
    expect(beach).toContain('position={[0, FLOOR_Y - 0.36, 0]}');
    expect(beach).toContain('position={[0, FLOOR_Y - 0.34, -21.6]}');
  });

  it('VegasCasinoRoom: the inlay ring rides +0.012 over the carpet', () => {
    expect(src('three/VegasCasinoRoom.tsx')).toContain('position={[0, FLOOR_Y + 0.012, 0]}');
  });

  it('YachtDeckRoom: sea 1.1 below the deck floor', () => {
    const yacht = src('three/YachtDeckRoom.tsx');
    expect(yacht).toContain('position={[0, FLOOR_Y, 0]}');
    expect(yacht).toContain('position={[0, FLOOR_Y - 1.1, 0]}');
  });
});

describe('coplanar audit — single-floor rooms at FLOOR_Y (uncontested off classic)', () => {
  const SINGLE: [string, string][] = [
    ['three/RecCenterGymRoom.tsx', 'position={[0, FLOOR_Y, 0]}'],
    ['three/ChurchBasementRoom.tsx', 'position={[0, FLOOR_Y, 0]}'],
    ['three/CookoutYardRoom.tsx', 'position={[0, FLOOR_Y, 0]}'],
    ['three/GrandmasKitchenRoom.tsx', 'position={[0, FLOOR_Y, 0]}'],
    ['three/SpeakeasyLoungeRoom.tsx', 'position={[0, FLOOR_Y, 0]}'],
    ['three/RooftopDuskRoom.tsx', 'position={[0, FLOOR_Y, 0]}'],
    ['three/RooftopSkylineRoom.tsx', 'position={[0, FLOOR_Y, 0]}'],
    ['three/HighRisePenthouseRoom.tsx', 'const Y = FLOOR_Y;'],
    ['three/LegendsTableRoom.tsx', 'position={[0.25, Y, 0.15]}'],
  ];
  for (const [f, pin] of SINGLE) {
    it(`${f}: its one floor sits at FLOOR_Y`, () => {
      expect(src(f)).toContain(pin);
    });
  }

  it('every bespoke room shares the one FLOOR_Y constant value', () => {
    for (const f of [
      'three/BarbershopMirrorRoom.tsx', 'three/BeachCabanaRoom.tsx', 'three/ChurchBasementRoom.tsx',
      'three/CookoutYardRoom.tsx', 'three/CornerStreetRoom.tsx', 'three/GrandmasKitchenRoom.tsx',
      'three/HighRisePenthouseRoom.tsx', 'three/LegendsTableRoom.tsx', 'three/PjsStreetRoom.tsx',
      'three/PorchDeckRoom.tsx', 'three/RecCenterGymRoom.tsx', 'three/RooftopDuskRoom.tsx',
      'three/RooftopSkylineRoom.tsx', 'three/SpeakeasyLoungeRoom.tsx', 'three/VegasCasinoRoom.tsx',
      'three/YachtDeckRoom.tsx',
    ]) {
      expect(src(f), f).toContain('const FLOOR_Y = -0.9;');
    }
  });
});
