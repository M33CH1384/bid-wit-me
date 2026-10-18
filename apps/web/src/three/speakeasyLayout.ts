import type { CubeVenueConfig } from './cubeVenue';
import { cubeTris } from './cubeVenue';
/** Speakeasy (VENUES.md): windowless by design. Herringbone dark/fine 7x9 tint #4a2a1c, back-bar far (blank bottles), booths WEST only, door EAST, low amber pools. Felt #5c0d1a. */
export const SPEAKEASY: CubeVenueConfig = {
  id: 'speakeasy', slug: 'speakeasy',
  floorUrl: '/assets/venues/tex/herringbone_parquet_512.jpg', floorRepeat: [7, 9], floorTint: '#4a2a1c', floorRough: 0.55,
  wall: '#33202a', wallDark: '#24141e', ceiling: '#1c0f14', sky: false, pendants: true,
  boxes: [
    { p: [0, 1.05, -3.95], s: [4.8, 2.1, 0.35], c: '#2a1408', r: 0.6 },
    { p: [0, 1.55, -3.72], s: [4.4, 0.06, 0.3], c: '#4a2a14', r: 0.5 },
    { p: [0, 0.85, -3.72], s: [4.4, 0.06, 0.3], c: '#4a2a14', r: 0.5 },
    { p: [-3.05, 0.55, -1.2], s: [0.95, 1.1, 1.3], c: '#5c1420', r: 0.9 },
    { p: [-3.05, 0.55, 0.6], s: [0.95, 1.1, 1.3], c: '#5c1420', r: 0.9 },
    { p: [-3.05, 0.55, 2.2], s: [0.95, 1.1, 1.1], c: '#5c1420', r: 0.9 },
    { p: [3.56, 1.6, 0.8], s: [0.08, 3.2, 1.05], c: '#1a0d08', r: 0.6 },
    { p: [3.52, 1.6, 0.8], s: [0.05, 2.6, 0.8], c: '#3a2412', r: 0.5 },
  ],
  cyls: [
    { p: [-1.6, 1.75, -3.72], a: [0.05, 0.06, 0.38, 8], c: '#24381e', r: 0.3 },
    { p: [-0.9, 1.78, -3.72], a: [0.05, 0.06, 0.44, 8], c: '#5a3a14', r: 0.3 },
    { p: [-0.2, 1.73, -3.72], a: [0.05, 0.06, 0.34, 8], c: '#38242e', r: 0.3 },
    { p: [0.5, 1.79, -3.72], a: [0.05, 0.06, 0.46, 8], c: '#24381e', r: 0.3 },
    { p: [1.2, 1.74, -3.72], a: [0.05, 0.06, 0.36, 8], c: '#5a3a14', r: 0.3 },
    { p: [1.8, 1.77, -3.72], a: [0.05, 0.06, 0.42, 8], c: '#38242e', r: 0.3 },
  ],
  points: [{ p: [0, 2.6, -2.5], c: '#ffb45c', i: 5, d: 6 }],
};
export function speakeasyTris(withProps: boolean): number { return cubeTris(withProps, SPEAKEASY); }
