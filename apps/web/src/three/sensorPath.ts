/**
 * The swarm of little tracker sensors riding the 'Run it!' funnel: pose math only — the
 * meshes (a small metal ball with a finned cap) live in Tornado3D with the dust, debris,
 * slippers and cow they travel with. Both run kinds share the one fx.tornado stage, the
 * poses run on the funnel's own clock and envelopes, and Reduce effects suppresses the
 * swarm with the funnel — no separate toggle.
 *
 * The sensors are SMALLER and FASTER than the cow: each one climbs the cone on its own
 * staggered phase, a hair inside the wall, so together they read as a released stream
 * spiralling up and away — never a ring, never in step. A few carry a tiny light that
 * blinks as they go.
 */

import { funnelFling, funnelGrow, funnelRadius } from './slipperPath';

export const SENSOR_COUNT = 12;

/** Ball radius, in plan units — a fleck next to the cow, a bead next to the slippers. */
export const SENSOR_BALL_R = 0.03;
/** The finned cap: a short mast on top of the ball, and the span of its crossed blades. */
export const SENSOR_FIN = { mastH: 0.022, mastR: 0.0045, span: 0.058, bladeY: 0.02 } as const;
/** Every Nth sensor carries the blinking light. */
export const SENSOR_LED_EVERY = 4;

export interface SensorPose {
  x: number;
  y: number;
  z: number;
  /** Gentle tumble wobble, radians. */
  rx: number;
  /** Heading: faces the direction of travel around the funnel wall. */
  ry: number;
  rz: number;
  /** 0..1 body opacity: the dust's own envelope — in/out at the height wrap, out at the fling. */
  alpha: number;
  /** Fin spin angle, radians — the little cap whirs as it climbs. */
  fin: number;
  /** 0..1 light blink strength (never above the body envelope; 0 for sensors with no light). */
  blink: number;
  /** Funnel height fraction this sensor is riding. */
  h: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const frac = (v: number) => v - Math.floor(v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const RISE = 0.66; // height loops per tornado second — faster than the debris band's 0.5

export function sensorPose(u: number, i: number): SensorPose {
  const grow = funnelGrow(u);
  const fling = funnelFling(u);
  // staggered phases up the cycle AND around the wall: a stream, not a ring
  const phase = i / SENSOR_COUNT + (i % 3) * 0.013;
  const h = frac(0.06 + u * RISE + phase);
  const ang = u * (8.5 - 4.5 * h) + h * 3.0 + phase * 2.4;
  const r = funnelRadius(h, fling) * 0.94; // a hair inside the wall
  // the slippers' envelope: vanish at both ends of the height loop — the wrap reads as
  // the next sensor released, never a teleport — and vanish with the fling
  const alpha = smooth(0, 0.07, h) * (1 - smooth(0.8, 0.95, h)) * (1 - fling) * grow;
  const blink =
    i % SENSOR_LED_EVERY === 0
      ? alpha * Math.pow(0.5 + 0.5 * Math.sin(u * 6.5 + i * 2.39), 6)
      : 0;
  return {
    x: Math.cos(ang) * r,
    y: h * 1.9 * grow,
    z: Math.sin(ang) * r,
    rx: 0.5 * Math.sin(u * 1.1 + i),
    ry: -(ang + Math.PI / 2),
    rz: 0.4 * Math.cos(u * 0.9 + i * 1.3),
    alpha,
    fin: u * 7.5 + i * 1.93,
    blink,
    h,
  };
}
