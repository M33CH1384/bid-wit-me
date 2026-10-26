import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { funnelFling, funnelGrow, funnelRadius, slipperPose } from '../src/three/slipperPath';
import { COW_SPEC, cowLegFoot, cowPatch, cowPose } from '../src/three/cowPath';
import { SENSOR_BALL_R, SENSOR_COUNT, SENSOR_FIN, sensorPose } from '../src/three/sensorPath';

describe('the cow in the Run it! funnel', () => {
  it('rides the funnel wall at a mid height: radius and height match the dust profile', () => {
    for (let u = 0.2; u <= 2.3; u += 0.07) {
      const p = cowPose(u);
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(funnelRadius(p.h, funnelFling(u)), 9);
      expect(p.y).toBeCloseTo(p.h * 1.9 * funnelGrow(u), 9);
      // the mid band: never near the base, never near the lip — and never wrapping
      expect(p.h).toBeGreaterThanOrEqual(0.36);
      expect(p.h).toBeLessThanOrEqual(0.6);
    }
  });

  it('never teleports: consecutive poses stay close together across the whole show', () => {
    let prev = cowPose(0.4);
    for (let u = 0.41; u <= 2.3; u += 0.01) {
      const p = cowPose(u);
      const step = Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
      // orbital travel per 10ms tick — the bound widens with the fling, when the whole
      // funnel (dust included) bursts outward at once; a wrap teleport would break it
      expect(step).toBeLessThan(0.035 * (1 + 4 * funnelFling(u)));
      prev = p;
    }
  });

  it('is invisible before the funnel grows and after the fling, and on show in between', () => {
    expect(cowPose(0).alpha).toBe(0);
    expect(cowPose(2.3).alpha).toBe(0);
    expect(cowPose(1.2).alpha).toBeGreaterThan(0.9);
  });

  it('tumbles slowly and deadpan: one unhurried roll, far slower than the slippers', () => {
    const rate = (cowPose(1.6).rx - cowPose(0.6).rx) / 1.0;
    expect(rate).toBeGreaterThan(1.0); // a real rotation…
    expect(rate).toBeLessThan(1.6); // …but unhurried
    // the slippers tumble on two axes at once; the cow's bank barely drifts by comparison
    const slipRate = Math.abs(slipperPose(1.6, 0).rz - slipperPose(0.6, 0).rz);
    expect(cowPose(1.6).rz - cowPose(0.6).rz).toBeLessThan(slipRate * 0.3);
    // most of one full lazy turn across the visible show
    expect(cowPose(2.2).rx - cowPose(0.5).rx).toBeGreaterThan(2.2);
  });
});

describe('the cow silhouette (offline raster check of COW_SPEC)', () => {
  // WebGL cannot render in this environment, so the cow's read is checked the way the
  // slippers' shape was: rasterise the construction spec's side profile and measure it.
  const X0 = -0.32, X1 = 0.4, Y0 = -0.3, Y1 = 0.18, CW = 0.004;
  const cols = Math.floor((X1 - X0) / CW), rows = Math.floor((Y1 - Y0) / CW);
  const ell = (cx: number, cy: number, rx: number, ry: number) => (x: number, y: number) =>
    ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const seg = (ax: number, ay: number, bx: number, by: number, w: number) => (x: number, y: number) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= w / 2;
  };
  const S = COW_SPEC;
  const [ffx, ffy] = cowLegFoot(true);
  const [rfx, rfy] = cowLegFoot(false);
  const parts = [
    ell(S.body.c[0], S.body.c[1], S.body.r[0], S.body.r[1]),
    ell(S.head.c[0], S.head.c[1], S.head.r[0], S.head.r[1]),
    ell(S.muzzle.c[0], S.muzzle.c[1], S.muzzle.r[0], S.muzzle.r[1]),
    ell(S.udder.c[0], S.udder.c[1], S.udder.r[0], S.udder.r[1]),
    ell(S.ear.c[0], S.ear.c[1], S.ear.r[0], S.ear.r[1]),
    seg(S.leg.attach[0], S.leg.attach[1], ffx, ffy, S.leg.r * 2),
    seg(-S.leg.attach[0], S.leg.attach[1], rfx, rfy, S.leg.r * 2),
    ell(ffx, ffy, S.hoof.r, S.hoof.r * 0.62),
    ell(rfx, rfy, S.hoof.r, S.hoof.r * 0.62),
    seg(S.tail.base[0], S.tail.base[1], S.tail.end[0], S.tail.end[1], S.tail.r * 2),
    ell(S.tail.end[0], S.tail.end[1], S.tail.tuft, S.tail.tuft),
  ];
  const filled = (x: number, y: number) => parts.some((p) => p(x, y));
  const grid: boolean[][] = [];
  for (let rI = 0; rI < rows; rI++) {
    grid.push([]);
    for (let cI = 0; cI < cols; cI++) grid[rI]!.push(filled(X0 + (cI + 0.5) * CW, Y0 + (rI + 0.5) * CW));
  }
  const at = (x: number, y: number) => filled(x, y);

  it('has cow proportions: a long body on legs, not a blob', () => {
    let minC = cols, maxC = -1, minR = rows, maxR = -1, fill = 0;
    grid.forEach((row, rI) => row.forEach((f, cI) => {
      if (!f) return;
      fill++;
      minC = Math.min(minC, cI); maxC = Math.max(maxC, cI);
      minR = Math.min(minR, rI); maxR = Math.max(maxR, rI);
    }));
    const w = (maxC - minC + 1) * CW, h = (maxR - minR + 1) * CW;
    expect(w / h).toBeGreaterThan(1.4);
    expect(w / h).toBeLessThan(1.85);
    expect(fill / ((maxC - minC + 1) * (maxR - minR + 1))).toBeGreaterThan(0.3);
    expect(fill / ((maxC - minC + 1) * (maxR - minR + 1))).toBeLessThan(0.65);
  });

  it('reads at the ends: head mass out front, a tail at the back, an udder underneath', () => {
    expect(at(0.31, 0.0)).toBe(true); // muzzle, beyond the body's front (0.185)
    expect(at(0.24, 0.1)).toBe(true); // head top
    expect(at(-0.24, -0.1)).toBe(true); // tail, hanging behind and below the rump
    expect(at(-0.025, -0.14)).toBe(true); // udder, below the belly line (-0.12)
    expect(at(0.06, -0.145)).toBe(false); // open air beside the udder
  });

  it('legs stick OUT: two separated legs in the low band, splayed apart', () => {
    // scan the low band for filled column runs — front and rear legs, gap between
    const y = -0.21;
    const runs: Array<[number, number]> = [];
    let start: number | null = null;
    for (let cI = 0; cI < cols; cI++) {
      const x = X0 + (cI + 0.5) * CW;
      const f = at(x, y);
      if (f && start === null) start = x;
      if (!f && start !== null) { runs.push([start, x]); start = null; }
    }
    if (start !== null) runs.push([start, X1]);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    const [a, b] = [runs[0]!, runs[runs.length - 1]!];
    expect(b[0] - a[1]).toBeGreaterThan(0.15); // the splay: daylight between the feet
    expect((ffx - rfx)).toBeGreaterThan(0.3); // feet land far apart by construction
  });

  it('the hide is patched, not plain and not mostly black', () => {
    let black = 0, n = 0;
    for (let y = 0; y < 100; y++) for (let x = 0; x < 200; x++) { black += cowPatch(x / 200, y / 100); n++; }
    expect(black / n).toBeGreaterThan(0.28);
    expect(black / n).toBeLessThan(0.5);
  });

  it('is the biggest single piece of debris — clearly larger than a slipper', () => {
    const len = S.muzzle.c[0] + S.muzzle.r[0] - (S.tail.end[0] - S.tail.tuft);
    expect(len).toBeGreaterThan(0.45); // slippers are ~0.21 long
    expect(len).toBeLessThan(0.7); // …but never so large it swallows the funnel's mouth
  });
});

describe('the tracker sensor swarm', () => {
  it('is a swarm of 8–12, each riding inside the wall on the dust profile', () => {
    expect(SENSOR_COUNT).toBeGreaterThanOrEqual(8);
    expect(SENSOR_COUNT).toBeLessThanOrEqual(12);
    for (let u = 0.2; u <= 2.3; u += 0.11) {
      for (let i = 0; i < SENSOR_COUNT; i++) {
        const p = sensorPose(u, i);
        expect(Math.hypot(p.x, p.z)).toBeCloseTo(funnelRadius(p.h, funnelFling(u)) * 0.94, 9);
        expect(p.y).toBeCloseTo(p.h * 1.9 * funnelGrow(u), 9);
      }
    }
  });

  it('reads as a released stream, not a ring: heights and angles spread at any moment', () => {
    for (const u of [0.7, 1.1, 1.5]) {
      const hs = Array.from({ length: SENSOR_COUNT }, (_, i) => sensorPose(u, i).h);
      expect(Math.max(...hs) - Math.min(...hs)).toBeGreaterThan(0.55);
      expect(new Set(hs.map((h) => h.toFixed(3))).size).toBe(SENSOR_COUNT);
    }
  });

  it('never pops at the height wrap, and is gone after the fling', () => {
    for (let u = 0.2; u <= 2.3; u += 0.01) {
      for (let i = 0; i < SENSOR_COUNT; i++) {
        const p = sensorPose(u, i);
        if (p.h > 0.96) expect(p.alpha).toBeLessThan(0.05);
        if (p.h < 0.012) expect(p.alpha).toBeLessThan(0.2);
      }
    }
    for (let i = 0; i < SENSOR_COUNT; i++) expect(sensorPose(2.3, i).alpha).toBe(0);
    const lit = Array.from({ length: SENSOR_COUNT }, (_, i) => sensorPose(1.1, i).alpha);
    expect(lit.filter((a) => a > 0.3).length).toBeGreaterThanOrEqual(6);
  });

  it('climbs faster than the cow rides, fins whirring, blink never above the envelope', () => {
    // height loops per second, from the phase velocity of each pose family
    const dh = (fn: (u: number) => number) => {
      let wraps = 0, prev = fn(0.5);
      for (let u = 0.51; u <= 1.5; u += 0.01) { const h = fn(u); if (h < prev - 0.5) wraps++; prev = h; }
      return wraps;
    };
    expect(dh((u) => sensorPose(u, 0).h)).toBeGreaterThan(dh((u) => cowPose(u).h));
    expect(sensorPose(1.3, 0).fin - sensorPose(0.8, 0).fin).toBeGreaterThan(3);
    for (let u = 0; u <= 2.3; u += 0.1) {
      for (let i = 0; i < SENSOR_COUNT; i++) {
        const p = sensorPose(u, i);
        expect(p.blink).toBeGreaterThanOrEqual(0);
        expect(p.blink).toBeLessThanOrEqual(p.alpha + 1e-9);
      }
    }
    // only some sensors carry a light
    const blinkers = Array.from({ length: SENSOR_COUNT }, (_, i) =>
      [0.6, 0.9, 1.2, 1.5].some((u) => sensorPose(u, i).blink > 0.01));
    expect(blinkers.filter(Boolean).length).toBeGreaterThanOrEqual(2);
    expect(blinkers.filter(Boolean).length).toBeLessThan(SENSOR_COUNT);
  });

  it('the finned cap reads: the fin span is wider than the ball', () => {
    expect(SENSOR_FIN.span).toBeGreaterThan(SENSOR_BALL_R * 2 * 0.9);
  });
});

describe('the cow and sensors are part of the one tornado stage (both run kinds)', () => {
  const tornado = readFileSync(new URL('../src/three/Tornado3D.tsx', import.meta.url), 'utf8');
  const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');

  it('Tornado3D builds them and drives them from the funnel clock and show flag', () => {
    expect(tornado).toContain('buildCow');
    expect(tornado).toContain('cowPose');
    expect(tornado).toContain('buildSensor');
    expect(tornado).toContain('sensorPose');
    expect(tornado).toContain('__bwmCowDrawn');
    expect(tornado).toContain('__bwmSensorsDrawn');
    // suppressed with the funnel: the same `show` gates the cow and the swarm
    expect(tornado).toContain('if (!show) { cow.group.visible = false; for (const s of sensors) s.group.visible = false; }');
    // warmed with the funnel, so their material programs link before the first run
    expect(tornado).toContain('warmedCows');
    expect(tornado).toContain('warmedSensors');
  });

  it('regular and mega runs alike set fx.tornado — the one stage they ride', () => {
    expect(table).toContain('RUN_MEGA_TORNADO_AFTER_MS');
    expect(table).toContain('fx.tornado = {');
  });

  it('ships no movie branding in the tornado sources', () => {
    const cow = readFileSync(new URL('../src/three/cowPath.ts', import.meta.url), 'utf8');
    const sensor = readFileSync(new URL('../src/three/sensorPath.ts', import.meta.url), 'utf8');
    for (const src of [tornado, cow, sensor]) {
      expect(src.toLowerCase()).not.toContain('twister');
      expect(src.toLowerCase()).not.toContain('dorothy');
    }
  });
});
