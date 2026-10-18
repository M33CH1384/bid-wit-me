import type { CubeVenueConfig } from './cubeVenue';
import { cubeTris } from './cubeVenue';
/** Rooftop (VENUES.md): open-air. brushed_concrete 3x4, parapet in frame, night-blue + warm pool with magenta rim.
 *  Design-fix attempt for the flagged PARTIAL/FAIL ("skyline barely registers top-down"): parapet lowered to
 *  ~1.0m and skyline moved closer/taller (z=-5.4, 2.6-6.5m) with emissive lit windows + antennas, so the
 *  buildings clear the parapet in the playing view. Vent W per the N-seat note. */
const win = (x: number, y: number, z: number) => ({ p: [x, y, z] as [number, number, number], s: [0.42, 0.3, 0.05] as [number, number, number], c: '#2a2418', e: '#ffd98a', ei: 1.8 });
export const ROOFTOP: CubeVenueConfig = {
  id: 'rooftop', slug: 'rooftop',
  floorUrl: '/assets/venues/tex/brushed_concrete_512.jpg', floorRepeat: [3, 4], floorTint: '#9aa0ad', floorRough: 0.9,
  wall: '#3a3f4d', wallDark: '#2c303c', ceiling: null, open: true, sky: true, pendants: false,
  boxes: [
    // parapet (~1.0m, in frame all round)
    { p: [0, 0.5, -4.05], s: [7.4, 1.0, 0.18], c: '#4a4f5c', r: 0.9 },
    { p: [0, 1.03, -4.05], s: [7.5, 0.08, 0.26], c: '#5c6270', r: 0.8 },
    { p: [-3.6, 0.5, 0], s: [0.18, 1.0, 8.2], c: '#4a4f5c', r: 0.9 },
    { p: [3.6, 0.5, 0], s: [0.18, 1.0, 8.2], c: '#4a4f5c', r: 0.9 },
    // skyline at z=-5.4: dark towers, varied heights 2.6-6.5m
    { p: [-3.4, 2.6, -5.5], s: [1.5, 5.2, 0.8], c: '#232c44', r: 0.95 },
    { p: [-1.7, 1.9, -5.4], s: [1.1, 3.8, 0.8], c: '#1d2539', r: 0.95 },
    { p: [-0.2, 3.25, -5.6], s: [1.4, 6.5, 0.8], c: '#28324e', r: 0.95 },
    { p: [1.3, 1.55, -5.4], s: [1.0, 3.1, 0.8], c: '#202839', r: 0.95 },
    { p: [2.7, 2.35, -5.5], s: [1.3, 4.7, 0.8], c: '#252f4a', r: 0.95 },
    { p: [4.1, 1.3, -5.4], s: [0.9, 2.6, 0.8], c: '#1d2539', r: 0.95 },
    // lit windows on the towers (front faces)
    win(-3.6, 4.2, -5.08), win(-3.1, 3.3, -5.08), win(-3.5, 2.2, -5.08),
    win(-1.8, 2.9, -4.98), win(-1.55, 1.8, -4.98),
    win(-0.4, 5.4, -5.18), win(0.05, 4.4, -5.18), win(-0.3, 3.2, -5.18), win(0.1, 2.1, -5.18),
    win(1.25, 2.4, -4.98), win(1.45, 1.5, -4.98),
    win(2.5, 3.8, -5.08), win(2.9, 2.9, -5.08), win(2.6, 1.7, -5.08),
    win(4.05, 1.9, -4.98),
    // vent W (N-seat note) + water-tank silhouette E
    { p: [-3.0, 0.55, -2.4], s: [0.9, 1.1, 0.9], c: '#6a707c', r: 0.6, m: 0.6 },
    { p: [3.1, 0.75, -2.6], s: [0.16, 1.5, 0.16], c: '#3a3f4a', r: 0.8 },
    { p: [2.75, 0.75, -2.6], s: [0.16, 1.5, 0.16], c: '#3a3f4a', r: 0.8 },
    { p: [3.45, 0.75, -2.6], s: [0.16, 1.5, 0.16], c: '#3a3f4a', r: 0.8 },
  ],
  cyls: [
    { p: [-3.0, 1.35, -2.4], a: [0.28, 0.34, 0.5, 12], c: '#7d838f', r: 0.5, m: 0.7 },
    { p: [3.1, 2.05, -2.6], a: [0.62, 0.68, 1.1, 14], c: '#4c4238', r: 0.85 },
    { p: [-0.2, 6.9, -5.6], a: [0.02, 0.02, 0.9, 6], c: '#232838', m: 0.5 },
    { p: [2.7, 5.15, -5.5], a: [0.02, 0.02, 0.8, 6], c: '#232838', m: 0.5 },
  ],
  planes: [{ p: [0, 3.8, -7.2], s: [18, 6], sky: true }],
  points: [
    { p: [-1.2, 2.6, -1.2], c: '#ffe9c4', i: 6, d: 9 },
    { p: [2.6, 1.8, 1.8], c: '#ff4fd8', i: 3, d: 7 },
  ],
};
export function rooftopTris(withProps: boolean): number { return cubeTris(withProps, ROOFTOP); }
