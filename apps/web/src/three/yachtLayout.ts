import type { CubeVenueConfig } from './cubeVenue';
import { cubeTris } from './cubeVenue';
/** Yacht Deck (VENUES.md): open-air. wood_floor_deck 3x5 directional along z, mast at z=-2.95 + rigging to side rails, life-ring E, rails all round, sea/sky beyond. Cabin wall is on the S (camera) side — noted, not faked into the playing view. */
export const YACHT: CubeVenueConfig = {
  id: 'yacht', slug: 'yacht',
  floorUrl: '/assets/venues/tex/wood_floor_deck_512.jpg', floorRepeat: [3, 5], floorTint: '#d9b48a', floorRough: 0.6,
  wall: '#c08a5a', wallDark: '#a87648', ceiling: null, open: true, sky: true, pendants: false,
  boxes: [
    { p: [0, 1.0, -4.15], s: [7.2, 0.09, 0.14], c: '#c08a5a', r: 0.5 },
    { p: [-3.55, 1.0, 0], s: [0.14, 0.09, 8.3], c: '#c08a5a', r: 0.5 },
    { p: [3.55, 1.0, 0], s: [0.14, 0.09, 8.3], c: '#c08a5a', r: 0.5 },
    { p: [0, 0.55, -4.15], s: [7.2, 0.05, 0.08], c: '#d8dde2', r: 0.3, m: 0.8 },
    { p: [-0.9, 2.9, -3.55], s: [0.04, 2.6, 0.04], c: '#d8dde2', r: 0.4, m: 0.6, rz: 0.55 },
    { p: [0.9, 2.9, -3.55], s: [0.04, 2.6, 0.04], c: '#d8dde2', r: 0.4, m: 0.6, rz: -0.55 },
  ],
  cyls: [
    { p: [0, 2.2, -2.95], a: [0.055, 0.075, 4.4, 12], c: '#8a8e93', r: 0.3, m: 0.85 },
    { p: [0, 0.65, -2.95], a: [0.5, 0.55, 0.5, 14], c: '#e8e4da', r: 0.5 },
    { p: [-3.5, 0.5, -2], a: [0.04, 0.04, 1.0, 8], c: '#d8dde2', m: 0.85, r: 0.3 },
    { p: [-3.5, 0.5, 0], a: [0.04, 0.04, 1.0, 8], c: '#d8dde2', m: 0.85, r: 0.3 },
    { p: [3.5, 0.5, -2], a: [0.04, 0.04, 1.0, 8], c: '#d8dde2', m: 0.85, r: 0.3 },
    { p: [3.5, 0.5, 0], a: [0.04, 0.04, 1.0, 8], c: '#d8dde2', m: 0.85, r: 0.3 },
  ],
  tori: [{ p: [3.5, 1.45, -0.6], a: [0.27, 0.07, 10, 24], c: '#e86a2a', ry: Math.PI / 2 }],
  planes: [
    { p: [0, 3.6, -6.8], s: [17, 5.5], sky: true },
    { p: [0, 0.95, -6.6], s: [17, 1.9], sea: true, c: '#2a6a9a' },
  ],
  points: [{ p: [2.4, 2.6, -1.2], c: '#fff4e0', i: 5, d: 8 }],
};
export function yachtTris(withProps: boolean): number { return cubeTris(withProps, YACHT); }
