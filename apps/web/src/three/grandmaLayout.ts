import type { CubeVenueConfig } from './cubeVenue';
import { cubeTris } from './cubeVenue';
/**
 * Grandma's Kitchen (VENUES.md): linoleum_brown 5x6, counter+cabinets far,
 * fridge W, stove E, windows x2 above cabinets, door S (opp view).
 * DESIGN FIX for the top-down "diner" read (hero was PARTIAL): the counter
 * run is made taller (0.95m) and deeper, wall cabinets protrude 0.45m at
 * head height, the fridge stands a full 2m, and a stove + pie + wall clock
 * sit in the far strip — from the playing camera the far edge now reads as a
 * home kitchen run, not a diner counter. Felt regraded #9e1b24.
 */
export const GRANDMA: CubeVenueConfig = {
  id: 'grandma', slug: 'grandma',
  floorUrl: '/assets/venues/tex/linoleum_brown_512.jpg', floorRepeat: [5, 6], floorTint: '#d6c6a8', floorRough: 0.5,
  wall: '#e6d7b8', wallDark: '#dbc9a4', ceiling: '#f4ead2', sky: true, pendants: true,
  windows: [{ x: -1.1, y: 3.15, w: 1.2, h: 1.0 }, { x: 1.1, y: 3.15, w: 1.2, h: 1.0 }],
  boxes: [
    { p: [0, 0.475, -3.82], s: [5.2, 0.95, 0.72], c: '#8a5a34', r: 0.7 },
    { p: [0, 0.99, -3.82], s: [5.4, 0.07, 0.84], c: '#eadfc6', r: 0.4 },
    { p: [-2.15, 2.05, -3.95], s: [1.5, 1.25, 0.45], c: '#8a5a34', r: 0.65 },
    { p: [2.15, 2.05, -3.95], s: [1.5, 1.25, 0.45], c: '#8a5a34', r: 0.65 },
    { p: [0, 1.78, -3.98], s: [1.1, 0.7, 0.4], c: '#8a5a34', r: 0.65 },
    // under-cabinet light strips (the bespoke kitchen's stripGlow, ported):
    // warm pools on the counter under each wall cabinet
    { p: [-2.15, 1.418, -3.76], s: [1.3, 0.018, 0.07], c: '#ffeec4', r: 0.6, e: '#ffdf9e', ei: 1.1 },
    { p: [2.15, 1.418, -3.76], s: [1.3, 0.018, 0.07], c: '#ffeec4', r: 0.6, e: '#ffdf9e', ei: 1.1 },
    { p: [0, 1.423, -3.8], s: [0.95, 0.018, 0.07], c: '#ffeec4', r: 0.6, e: '#ffdf9e', ei: 1.1 },
    // the wall clock's ticks + hands inside the rim below (tick marks
    // only — no numerals, the house rule): half past five, dinner time,
    // the same hour the bespoke kitchen's clock keeps; its red second
    // hand parks at twelve (the cube shell has no per-prop animation)
    { p: [0, 4.005, -4.108], s: [0.013, 0.04, 0.006], c: '#2a2118', r: 0.5 },
    { p: [0.0775, 3.984, -4.108], s: [0.011, 0.026, 0.006], c: '#2a2118', r: 0.5, rz: -0.524 },
    { p: [0.134, 3.928, -4.108], s: [0.011, 0.026, 0.006], c: '#2a2118', r: 0.5, rz: -1.047 },
    { p: [0.155, 3.85, -4.108], s: [0.013, 0.04, 0.006], c: '#2a2118', r: 0.5, rz: -1.571 },
    { p: [0.134, 3.772, -4.108], s: [0.011, 0.026, 0.006], c: '#2a2118', r: 0.5, rz: -2.094 },
    { p: [0.0775, 3.716, -4.108], s: [0.011, 0.026, 0.006], c: '#2a2118', r: 0.5, rz: -2.618 },
    { p: [0, 3.695, -4.108], s: [0.013, 0.04, 0.006], c: '#2a2118', r: 0.5, rz: -3.142 },
    { p: [-0.0775, 3.716, -4.108], s: [0.011, 0.026, 0.006], c: '#2a2118', r: 0.5, rz: -3.665 },
    { p: [-0.134, 3.772, -4.108], s: [0.011, 0.026, 0.006], c: '#2a2118', r: 0.5, rz: -4.189 },
    { p: [-0.155, 3.85, -4.108], s: [0.013, 0.04, 0.006], c: '#2a2118', r: 0.5, rz: -4.712 },
    { p: [-0.134, 3.928, -4.108], s: [0.011, 0.026, 0.006], c: '#2a2118', r: 0.5, rz: -5.236 },
    { p: [-0.0775, 3.984, -4.108], s: [0.011, 0.026, 0.006], c: '#2a2118', r: 0.5, rz: -5.76 },
    { p: [0.025, 3.807, -4.102], s: [0.02, 0.1, 0.008], c: '#2a2118', r: 0.5, rz: -2.618 },
    { p: [0, 3.785, -4.102], s: [0.014, 0.13, 0.008], c: '#2a2118', r: 0.5, rz: -3.142 },
    { p: [0, 3.9, -4.102], s: [0.006, 0.15, 0.006], c: '#b03030', r: 0.5 },
    { p: [-3.0, 1.0, -3.55], s: [0.92, 2.0, 0.82], c: '#e9e1cd', r: 0.35, m: 0.15 },
    { p: [-3.0, 1.42, -3.12], s: [0.94, 0.05, 0.04], c: '#b9ac8e', r: 0.4 },
    { p: [2.95, 0.5, -3.82], s: [1.05, 1.0, 0.72], c: '#e8e4da', r: 0.35 },
    { p: [2.95, 1.03, -3.82], s: [1.05, 0.05, 0.72], c: '#2a2a2a', r: 0.5 },
    { p: [-1.1, 2.55, -4.12], s: [1.24, 0.14, 0.03], c: '#b03030', r: 0.9 },
    { p: [1.1, 2.55, -4.12], s: [1.24, 0.14, 0.03], c: '#b03030', r: 0.9 },
    { p: [-2.9, 1.3, -4.55], s: [1.3, 2.6, 0.8], c: '#3a4a34', r: 1 },
    { p: [2.9, 1.2, -4.55], s: [1.4, 2.4, 0.8], c: '#44543c', r: 1 },
  ],
  cyls: [
    { p: [1.35, 1.06, -3.8], a: [0.17, 0.19, 0.07, 16], c: '#c98a3a', r: 0.55 },
    // the back burner carries a low ember — something is on the stove
    { p: [2.75, 1.07, -3.95], a: [0.11, 0.11, 0.02, 14], c: '#111111', r: 0.4, e: '#43190a', ei: 0.7 },
    { p: [3.15, 1.07, -3.68], a: [0.09, 0.09, 0.02, 14], c: '#111111', r: 0.4 },
    // the wall clock's face: a warm-white disc inside the rim (rx turns
    // the cylinder's axis to face the room), plus its centre pin
    { p: [0, 3.85, -4.125], a: [0.2, 0.2, 0.02, 24], c: '#f8f3e4', r: 0.35, rx: Math.PI / 2 },
    { p: [0, 3.85, -4.1], a: [0.016, 0.016, 0.012, 10], c: '#2a2118', r: 0.5, rx: Math.PI / 2 },
  ],
  // the clock's rim: warm wood, so the ring reads as a clock against
  // the cream wall (it shipped cream-on-cream and read as a wreath)
  tori: [{ p: [0, 3.85, -4.12], a: [0.22, 0.035, 10, 24], c: '#7d5430' }],
  // Wave D kitchen life: one warm pendant light over the counter run —
  // CubeLifePulse breathes it on the grandma channel (steady, slow).
  // Plus a soft amber glow at the stove, breathing on the same channel.
  points: [{ p: [0, 2.7, -2.4], c: '#ffe6b8', i: 5, d: 7 }, { p: [2.95, 1.5, -3.25], c: '#ffb36b', i: 2.2, d: 3.5 }],
};
export function grandmaTris(withProps: boolean): number { return cubeTris(withProps, GRANDMA); }
