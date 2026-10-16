/**
 * Every screen shake in the game is a vertical thump: the table (and a touch of the camera) drops and
 * rebounds. Nothing ever moves the camera sideways or rolls it, so cards never look like they wiggle.
 * Bigger hits (jokers, the nuke, a 'Run it!' impact) are heavier: deeper, slower, more rebounds.
 */
export interface ShakeOffset { x: number; y: number; z: number; roll: number; ty: number }

export function shakeOffset(s: { dur: number; amp: number; thump?: boolean }, t: number): ShakeOffset {
  if (t < 0 || t > s.dur || s.dur <= 0) return { x: 0, y: 0, z: 0, roll: 0, ty: 0 };
  const k = s.amp * Math.pow(1 - t / s.dur, 2);
  // a light card slam: one quick dip; heavy hits: slower, rebounding drops
  const heavy = !s.thump;
  const hz = heavy ? Math.max(4, 9 - s.amp * 30) : 9;
  const dip = Math.abs(Math.sin(2 * Math.PI * hz * t * 0.5));
  return { x: 0, y: heavy ? -k * 0.35 * dip : 0, z: 0, roll: 0, ty: -k * (heavy ? 1.4 : 1) * dip };
}

/** 'Run it!' funnel: a slow vertical bob instead of a sideways sway. */
export function swayOffset(u: number): ShakeOffset {
  if (u <= 0 || u >= 2.6) return { x: 0, y: 0, z: 0, roll: 0, ty: 0 };
  const env = Math.sin(Math.PI * Math.min(1, u / 2.6));
  return { x: 0, y: 0.025 * env * Math.sin(u * 4.1 + 1), z: 0, roll: 0, ty: 0 };
}
