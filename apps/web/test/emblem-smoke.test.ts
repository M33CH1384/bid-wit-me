/**
 * Emblem smoke (owner, 2026-10-29): the animated smoke inside the Neon
 * home emblem. These pins hold the three things that make the effect
 * safe to ship:
 *  - the canvas's painting geometry mirrors styles.css's `.wiz-home
 *    ::before` background math in all three regimes (if the CSS paint
 *    moves, this math must move with it — layout-home-fit pins the CSS
 *    side);
 *  - the puff field is a true seamless loop (every period divides the
 *    master loop) with poses that stay within the swirl's reach of
 *    their anchors;
 *  - the field carries both blend families (bright screen + dark
 *    multiply) — screen alone was invisible over the art's bright
 *    clouds (owner, 2026-10-29);
 *  - the ART WARP (round 3 — the owner liked the veil but "the smoke
 *    in the image doesn't move"): three bands of the painting itself,
 *    each on its own loop-exact transform, amplitudes capped small,
 *    masks forming a partition of unity over the glass;
 *  - the gate is Neon-only and yields to every calming signal.
 * Plus source pins: the layer is mounted in the home, its CSS box/mask
 * mirror the emblem layer, and the component adds no downloads.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ART_BANDS, EMBLEM_ART_URL, EMBLEM_H, EMBLEM_W, SMOKE_DARK_TINTS, SMOKE_LOOP_S, SMOKE_PUFFS, SMOKE_TINTS, SPADE_GLASS_PATH_D,
  SWIRL_CX, SWIRL_CY, artBandMaskAlpha, artBandPose, emblemPaintRect, emblemSmokeActive, puffPose,
} from '../src/neon/emblemSmoke';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const AR = EMBLEM_W / EMBLEM_H;

describe('emblemPaintRect mirrors the ::before background math', () => {
  it('base regime: height-driven 80%, centered, lifted 16px', () => {
    const r = emblemPaintRect({ boxW: 390, boxH: 718, wide: false, shortLandscape: false });
    expect(r.h).toBeCloseTo(0.8 * 718);
    expect(r.w).toBeCloseTo(0.8 * 718 * AR);
    expect(r.x).toBeCloseTo((390 - r.w) / 2);
    expect(r.y).toBe(-16);
  });

  it('wide regime: cover — the image fills the bled box, still lifted 16px', () => {
    const r = emblemPaintRect({ boxW: 1056, boxH: 718, wide: true, shortLandscape: false });
    // cover scale is driven by width here (1056/690 > 718/770)
    expect(r.w).toBeCloseTo(1056);
    expect(r.h).toBeCloseTo(770 * (1056 / 690));
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBe(-16);
    // and by height when the box is tall
    const tall = emblemPaintRect({ boxW: 800, boxH: 900, wide: true, shortLandscape: false });
    expect(tall.h).toBeCloseTo(900);
    expect(tall.w).toBeCloseTo(690 * (900 / 770));
    expect(tall.x).toBeCloseTo((800 - tall.w) / 2);
  });

  it('short landscape: 94% height at 10% / -8px, and it beats the wide regime', () => {
    const r = emblemPaintRect({ boxW: 844, boxH: 390, wide: false, shortLandscape: true });
    expect(r.h).toBeCloseTo(0.94 * 390);
    expect(r.w).toBeCloseTo(0.94 * 390 * AR);
    expect(r.x).toBeCloseTo((844 - r.w) * 0.1);
    expect(r.y).toBe(-8);
    const both = emblemPaintRect({ boxW: 1056, boxH: 500, wide: true, shortLandscape: true });
    expect(both.h).toBeCloseTo(0.94 * 500);
    expect(both.y).toBe(-8);
  });
});

describe('the puff field', () => {
  it('every period divides the master loop (seamless by construction)', () => {
    for (const p of SMOKE_PUFFS) {
      for (const per of [p.px, p.py, p.pa, p.psw, p.pr]) {
        expect(SMOKE_LOOP_S % per, `period ${per}`).toBe(0);
      }
    }
  });

  it('poses repeat exactly after one master loop', () => {
    for (const p of SMOKE_PUFFS) {
      for (const t of [0, 7.3, 41.9, 59.9]) {
        const a = puffPose(p, t);
        const b = puffPose(p, t + SMOKE_LOOP_S);
        expect(b.x).toBeCloseTo(a.x, 9);
        expect(b.y).toBeCloseTo(a.y, 9);
        expect(b.r).toBeCloseTo(a.r, 9);
        expect(b.alpha).toBeCloseTo(a.alpha, 9);
        expect(b.rot).toBeCloseTo(a.rot, 9);
      }
    }
  });

  it('carries both blend families, tint indices inside their own tables', () => {
    const bright = SMOKE_PUFFS.filter((p) => !p.dark);
    const dark = SMOKE_PUFFS.filter((p) => p.dark);
    expect(bright.length).toBeGreaterThanOrEqual(17);
    expect(dark.length).toBeGreaterThanOrEqual(6);
    for (const p of bright) expect(p.tint).toBeLessThan(SMOKE_TINTS.length);
    for (const p of dark) expect(p.tint).toBeLessThan(SMOKE_DARK_TINTS.length);
    // the dark family is genuinely dark — multiply needs color density
    for (const t of SMOKE_DARK_TINTS) {
      expect(Math.max(...t)).toBeLessThanOrEqual(128);
    }
  });

  it('poses stay within the swirl’s reach of their anchors; alpha + radius breathe in bounds', () => {
    for (const p of SMOKE_PUFFS) {
      // the swirl rotates the anchor's offset from the glass center by
      // at most |sw| radians: the offset vector moves at most the chord
      // 2·d·sin(|sw|/2); the wander adds its own amplitude on top.
      const d = Math.hypot((p.nx - SWIRL_CX) * EMBLEM_W, (p.ny - SWIRL_CY) * EMBLEM_H);
      const chord = 2 * d * Math.sin(Math.abs(p.sw) / 2);
      const boundX = chord / EMBLEM_W + p.ax;
      const boundY = chord / EMBLEM_H + p.ay;
      for (let t = 0; t < SMOKE_LOOP_S; t += 3.7) {
        const pose = puffPose(p, t);
        expect(Math.abs(pose.x - p.nx)).toBeLessThanOrEqual(boundX + 1e-9);
        expect(Math.abs(pose.y - p.ny)).toBeLessThanOrEqual(boundY + 1e-9);
        // hard safety: centers stay inside the painting, off the stem
        expect(pose.x).toBeGreaterThan(0);
        expect(pose.x).toBeLessThan(1);
        expect(pose.y).toBeGreaterThan(0.02);
        expect(pose.y).toBeLessThan(0.92);
        expect(pose.alpha).toBeGreaterThan(0.5 * p.alpha);
        expect(pose.alpha).toBeLessThanOrEqual(p.alpha + 1e-9);
        expect(pose.r).toBeGreaterThanOrEqual(p.r * (1 - p.rb) - 1e-9);
        expect(pose.r).toBeLessThanOrEqual(p.r * (1 + p.rb) + 1e-9);
      }
      // anchors live in the glass bulb, never down the stem or out at the rim
      expect(p.nx).toBeGreaterThan(0.15);
      expect(p.nx).toBeLessThan(0.85);
      expect(p.ny).toBeGreaterThan(0.12);
      expect(p.ny).toBeLessThan(0.74);
    }
  });
});

describe('the art warp (round 3 — the painting itself moves)', () => {
  it('every art-motion period divides the master loop (seamless by construction)', () => {
    for (const b of ART_BANDS) {
      for (const per of [b.prot, b.pdx, b.pdy, b.psc]) {
        expect(SMOKE_LOOP_S % per, `period ${per}`).toBe(0);
      }
    }
  });

  it('band poses repeat exactly after one master loop', () => {
    for (const b of ART_BANDS) {
      for (const t of [0, 7.3, 41.9, 59.9]) {
        const a = artBandPose(b, t);
        const c = artBandPose(b, t + SMOKE_LOOP_S);
        expect(c.rot).toBeCloseTo(a.rot, 9);
        expect(c.dx).toBeCloseTo(a.dx, 9);
        expect(c.dy).toBeCloseTo(a.dy, 9);
        expect(c.scale).toBeCloseTo(a.scale, 9);
      }
    }
  });

  it('amplitudes stay small — smoke motion, never an emblem wobble', () => {
    for (const b of ART_BANDS) {
      expect(Math.abs(b.rot)).toBeLessThanOrEqual(0.03);
      expect(Math.abs(b.dx)).toBeLessThanOrEqual(6);
      expect(Math.abs(b.dy)).toBeLessThanOrEqual(3);
      expect(Math.abs(b.sc)).toBeLessThanOrEqual(0.03);
      for (let t = 0; t < SMOKE_LOOP_S; t += 1.7) {
        const pose = artBandPose(b, t);
        expect(Math.abs(pose.rot)).toBeLessThanOrEqual(Math.abs(b.rot) + 1e-9);
        expect(Math.abs(pose.dx)).toBeLessThanOrEqual(Math.abs(b.dx) + 1e-9);
        expect(Math.abs(pose.dy)).toBeLessThanOrEqual(Math.abs(b.dy) + 1e-9);
        expect(pose.scale).toBeGreaterThanOrEqual(1 - Math.abs(b.sc) - 1e-9);
        expect(pose.scale).toBeLessThanOrEqual(1 + Math.abs(b.sc) + 1e-9);
      }
      // pivots sit inside the glass bulb
      expect(b.cx).toBeGreaterThan(200);
      expect(b.cx).toBeLessThan(490);
      expect(b.cy).toBeGreaterThan(120);
      expect(b.cy).toBeLessThan(620);
    }
  });

  it('the motion is differential — the bands genuinely move against each other', () => {
    expect(ART_BANDS.length).toBe(3);
    // over the loop, some pair of bands must separate by real pixels —
    // a single rigid transform of the whole painting would fail this.
    let maxSep = 0;
    for (let t = 0; t < SMOKE_LOOP_S; t += 0.5) {
      const poses = ART_BANDS.map((b) => artBandPose(b, t));
      for (let i = 0; i < poses.length; i++) {
        for (let j = i + 1; j < poses.length; j++) {
          maxSep = Math.max(maxSep, Math.abs(poses[i]!.dx - poses[j]!.dx), Math.abs(poses[i]!.rot - poses[j]!.rot) * 200);
        }
      }
    }
    expect(maxSep).toBeGreaterThan(3);
    // and every band actually moves (no static filler band)
    for (const b of ART_BANDS) {
      let travel = 0;
      for (let t = 0; t < SMOKE_LOOP_S; t += 0.5) {
        const pose = artBandPose(b, t);
        travel = Math.max(travel, Math.abs(pose.dx), Math.abs(pose.rot) * 200, Math.abs(pose.scale - 1) * 200);
      }
      expect(travel).toBeGreaterThan(1);
    }
  });

  it('band masks form a partition of unity over the glass — one painting thick everywhere', () => {
    // the glass bulb spans roughly y 82..596 in image coords
    for (let y = 60; y <= 620; y += 3.1) {
      let sum = 0;
      for (const b of ART_BANDS) {
        const a = artBandMaskAlpha(b, y);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
        sum += a;
      }
      expect(sum, `mask sum at y=${y}`).toBeCloseTo(1, 6);
    }
    // the windows chain: each band's fade-in completes exactly where
    // the previous band's fade-out ends
    expect(ART_BANDS[1]!.yTop + ART_BANDS[1]!.fadeIn).toBe(ART_BANDS[0]!.yBottom);
    expect(ART_BANDS[2]!.yTop + ART_BANDS[2]!.fadeIn).toBe(ART_BANDS[1]!.yBottom);
    // coverage reaches past both ends of the glass
    expect(ART_BANDS[0]!.yTop).toBeLessThanOrEqual(82);
    expect(ART_BANDS[2]!.yBottom).toBeGreaterThanOrEqual(596);
  });

  it('the art URL is the CSS painting’s own file', () => {
    expect(EMBLEM_ART_URL).toBe('/assets/neon/spade-emblem.webp');
    const css = read('../src/styles.css');
    expect(css).toContain(`background: url('${EMBLEM_ART_URL}')`);
  });
});

describe('the spade glass path', () => {
  it('is a closed path inside the artwork bounds', () => {
    expect(SPADE_GLASS_PATH_D.startsWith('M ')).toBe(true);
    expect(SPADE_GLASS_PATH_D.endsWith('Z')).toBe(true);
    const nums = SPADE_GLASS_PATH_D.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    for (let i = 0; i < nums.length; i += 2) {
      expect(nums[i]).toBeGreaterThanOrEqual(60); // x: well inside the rim
      expect(nums[i]).toBeLessThanOrEqual(630);
      expect(nums[i + 1]).toBeGreaterThanOrEqual(40); // y
      expect(nums[i + 1]).toBeLessThanOrEqual(625); // stops at the lobes — no stem
    }
  });
});

describe('the gate', () => {
  const base = { theme: 'neon', reducedMotion: false, reduceEffects: false, lowEnd: false };
  it('runs only in Neon with motion fully allowed', () => {
    expect(emblemSmokeActive(base)).toBe(true);
    expect(emblemSmokeActive({ ...base, theme: 'classic' })).toBe(false);
    expect(emblemSmokeActive({ ...base, reducedMotion: true })).toBe(false);
    expect(emblemSmokeActive({ ...base, reduceEffects: true })).toBe(false);
    expect(emblemSmokeActive({ ...base, lowEnd: true })).toBe(false);
  });
});

describe('source pins', () => {
  it('Setup mounts the layer as the home stage’s first child', () => {
    const setup = read('../src/Setup.tsx');
    expect(setup).toContain("import EmblemSmoke from './neon/EmblemSmoke';");
    const homeAt = setup.indexOf('<div className="wiz-home">');
    const smokeAt = setup.indexOf('<EmblemSmoke />');
    const splashAt = setup.indexOf('<div className="splash">');
    expect(homeAt).toBeGreaterThan(-1);
    expect(smokeAt).toBeGreaterThan(homeAt);
    expect(smokeAt).toBeLessThan(splashAt);
  });

  it('the layer CSS mirrors the emblem box + mask and never shows outside Neon', () => {
    const css = read('../src/styles.css');
    const base = css.match(/\.emblem-smoke \{([^}]*)\}/);
    expect(base, 'base .emblem-smoke rule exists').toBeTruthy();
    expect(base![1]).toContain('display: none');
    expect(base![1]).toContain('pointer-events: none');
    const neon = css.match(/html\[data-theme="neon"\] \.wiz-home > \.emblem-smoke \{([^}]*)\}/);
    expect(neon, 'neon .emblem-smoke rule exists').toBeTruthy();
    expect(neon![1]).toContain('display: block');
    expect(neon![1]).toContain('mask-image: radial-gradient(ellipse 96% 64% at 50% 24%, #000 54%, transparent 88%)');
    expect(css).toContain('width: min(1056px, 100vw)');
    // the emblem painting itself is untouched by this layer
    const before = css.match(/html\[data-theme="neon"\] \.wiz-home::before \{([^}]*)\}/);
    expect(before![1]).toContain("background: url('/assets/neon/spade-emblem.webp')");
  });

  it('the component loads only the emblem’s own artwork — no other downloads, no three.js', () => {
    const src = read('../src/neon/EmblemSmoke.tsx');
    expect(src).not.toMatch(/fetch\(|XMLHttpRequest|from 'three|from "three|import\(/);
    expect(src).not.toMatch(/url\(/);
    // the one image load is the artwork itself, via the pinned URL —
    // the same file the CSS background already fetches
    expect(src).toContain('new Image()');
    expect(src).toContain('artImg.src = EMBLEM_ART_URL');
    expect(src).not.toMatch(/https?:\/\//); // no external or second asset URL anywhere
    expect(src).toContain("globalCompositeOperation = 'multiply'");
    expect(src).toContain("globalCompositeOperation = 'screen'");
    expect(src).toContain('SPADE_GLASS_PATH_D');
  });

  it('the component warps the art in bands and fades it before the rim', () => {
    const src = read('../src/neon/EmblemSmoke.tsx');
    expect(src).toContain('ART_BANDS');
    expect(src).toContain('artBandPose');
    expect(src).toContain('artBandMaskAlpha'); // masks derive from the pinned math
    expect(src).toContain("globalCompositeOperation = 'destination-in'"); // band + glass masks
    expect(src).toContain('drawImage(artCanvas'); // warped stack composited under the veil
  });
});
