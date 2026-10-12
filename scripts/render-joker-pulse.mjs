/**
 * Procedural radioactive loop for the Big Joker.
 * Output: raw RGBA frames, 512×720, 30fps, 1.2s, seamless.
 * No third-party images. The pixels are generated here and dedicated to the public domain (CC0).
 *
 *   node scripts/render-joker-pulse.mjs /tmp/joker-pulse.raw
 */
import { writeFileSync } from 'node:fs';

const W = 512;
const H = 720;
const FRAMES = 36;
const CARD_W = W / 2.6;
const CARD_H = CARD_W * (0.35 / 0.25);

function sdRound(x, y, bx, by, r) {
  const dx = Math.abs(x) - bx + r;
  const dy = Math.abs(y) - by + r;
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r;
}

function swell(frame) {
  const p = frame / FRAMES;
  const bump = (c) => {
    let d = Math.abs(p - c);
    d = Math.min(d, 1 - d);
    return Math.exp(-(d * d) / 0.012);
  };
  return 0.42 + 0.58 * Math.max(bump(0.15), bump(0.6));
}

function dust(i, frame) {
  const u = (i * 0.173 + frame / FRAMES) % 1;
  const x = ((Math.sin(i * 12.9898) * 43758.5453) % 1) * W;
  const xx = x < 0 ? x + W : x;
  const y = (1 - u) * H;
  return { x: xx, y };
}

const out = Buffer.alloc(W * H * 4 * FRAMES);
const cx = W / 2;
const cy = H / 2;

for (let f = 0; f < FRAMES; f++) {
  const base = f * W * H * 4;
  const s = swell(f);
  const dustPts = [];
  for (let i = 0; i < 70; i++) dustPts.push(dust(i, f));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = sdRound(x - cx, y - cy, CARD_W / 2, CARD_H / 2, 18);
      let r = 0, g = 0, b = 0, a = 0;
      if (d > 0) {
        const haze = Math.exp(-d / (90 + 40 * s)) * s;
        const rim = Math.exp(-d / 14) * s;
        // #7CFF4F near the card, #1F5C12 in the haze
        r = 31 * haze + 124 * rim;
        g = 92 * haze + 255 * rim;
        b = 18 * haze + 79 * rim;
        a = Math.min(1, haze * 0.85 + rim);
      }
      const o = base + (y * W + x) * 4;
      out[o] = Math.max(0, Math.min(255, r));
      out[o + 1] = Math.max(0, Math.min(255, g));
      out[o + 2] = Math.max(0, Math.min(255, b));
      out[o + 3] = Math.max(0, Math.min(255, a * 255));
    }
  }
  for (const p of dustPts) {
    const rad = 2;
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const x = (p.x + dx) | 0;
        const y = (p.y + dy) | 0;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (dx * dx + dy * dy > rad * rad) continue;
        const d = sdRound(x - cx, y - cy, CARD_W / 2, CARD_H / 2, 18);
        if (d <= 0) continue;
        const o = base + (y * W + x) * 4;
        const add = 180 * s;
        out[o] = Math.min(255, out[o] + add * 0.6);
        out[o + 1] = Math.min(255, out[o + 1] + add);
        out[o + 2] = Math.min(255, out[o + 2] + add * 0.35);
        out[o + 3] = Math.min(255, out[o + 3] + 140);
      }
    }
  }
  // A short electric nick on the card edge, brighter on the swells. Loops with the frame.
  const ang = (f / FRAMES) * Math.PI * 2;
  for (let k = 0; k < 18; k++) {
    const t = k / 18;
    const x = (cx + Math.cos(ang + t) * (CARD_W / 2 + 6 + Math.sin(t * 20) * 4)) | 0;
    const y = (cy + Math.sin(ang * 2 + t * 3) * (CARD_H / 2 + 4)) | 0;
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const o = base + (y * W + x) * 4;
    const add = 220 * s;
    out[o] = Math.min(255, out[o] + add);
    out[o + 1] = Math.min(255, out[o + 1] + add);
    out[o + 2] = Math.min(255, out[o + 2] + add * 0.7);
    out[o + 3] = Math.min(255, out[o + 3] + 200);
  }
  if (f % 6 === 0) process.stderr.write(`frame ${f}\n`);
}

const dest = process.argv[2] || '/tmp/joker-pulse.raw';
writeFileSync(dest, out);
process.stderr.write(`wrote ${dest} ${out.length} bytes\n`);
