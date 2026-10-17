import { FELT, RAIL } from './layout';

/**
 * Classic Studio: the cube room from the design test (docs: scenes-audit/cube-room) fitted around the game's
 * own table. One box — floor / far wall / two side walls / ceiling locked to shared constants, so a wall can
 * never lean — dressed with the Poly Haven chair + lamp (decimated + KTX2, see CREDITS.md).
 *
 * Units are metres in STUDIO space: the group sits at FLOOR_Y, so studio y=0 is the floorboards and the
 * game's felt (y=0 world) is at studio y=0.9. Constants come straight from the founder-QA'd test scene;
 * chairs/lamps are re-spaced for the game's 3.4 m table (the test's 2.26 m GLB table stays out — see PR).
 */
export const STUDIO = {
  /** world y of the studio floor (the game's shared floor height) */
  floorY: -0.9,
  /** half-width: side walls at x=±roomX */
  roomX: 3.6,
  /** far wall z */
  zFar: -4.2,
  /** room depth (open on the camera side) */
  depth: 8.4,
  /** ceiling height above the floor */
  height: 5.0,
  baseboardH: 0.16,
  /** ceiling beam: box fixed to the ceiling face, underside here */
  beamBottom: 4.82,
  /** pendant shade bottoms above the floor */
  lampShadeBottom: 1.82,
  lampX: 0.58,
  /** production triangle counts of the shipped GLBs (gltfpack -si, measured at bake time) */
  chairTris: 9904,
  lampTris: 6192,
} as const;

/** Chair clones at N/S/W/E, front (+Z local) facing the table centre, spaced for the game's rail. */
export const CHAIR_SPOTS: readonly { x: number; z: number; ry: number }[] = [
  { x: 0, z: -2.45, ry: 0 },
  { x: 0, z: 2.8, ry: Math.PI },
  { x: -2.3, z: 0, ry: Math.PI / 2 },
  { x: 2.3, z: 0, ry: -Math.PI / 2 },
];

/** The game's table footprint incl. rail: chairs must clear it, lamps must clear the felt. */
export const TABLE_HALF = { x: FELT.hx + RAIL, z: FELT.hz + RAIL };

/** Triangle estimate for the dressed studio (shell is a handful of planes/boxes). */
export function studioTris(withProps: boolean): number {
  const shell = 120;
  return shell + (withProps ? CHAIR_SPOTS.length * STUDIO.chairTris + 2 * STUDIO.lampTris : 0);
}
