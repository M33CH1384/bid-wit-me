/**
 * Procedural detail maps for the table: the cloth's nap (albedo variation) and the soft contact shadow where the
 * cloth meets the rail. Canvas-drawn once and cached, so they cost no download and no extra shader program
 * (the shadow uses the same basic-map program as the printed logo).
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { FELT } from './layout';

/** deterministic, so the cloth looks the same on every device and in every screenshot */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

let nap: CanvasTexture | null = null;
/** Near-white tileable map multiplied into the felt colour: brushed patches, faint wear, fine fibre speckle. */
export function feltNapTexture(): CanvasTexture {
  if (nap) return nap;
  const S = 512;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ececec'; g.fillRect(0, 0, S, S);
  const r = rng(7);
  const wrapped = (x: number, y: number, rad: number, draw: (px: number, py: number) => void) => {
    for (const ox of [0, x < rad ? S : x > S - rad ? -S : null]) for (const oy of [0, y < rad ? S : y > S - rad ? -S : null]) {
      if (ox === null || oy === null) continue;
      draw(x + ox, y + oy);
    }
  };
  // brushed patches: where the nap lies the other way the cloth reads a touch lighter or darker
  for (let i = 0; i < 46; i++) {
    const x = r() * S, y = r() * S, rad = 50 + r() * 110, dark = r() < 0.55;
    wrapped(x, y, rad, (px, py) => {
      const grad = g.createRadialGradient(px, py, 0, px, py, rad);
      grad.addColorStop(0, dark ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.035)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    });
  }
  // fibre speckle
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 12;
    img.data[i] = Math.max(0, Math.min(255, img.data[i]! + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + n));
  }
  g.putImageData(img, 0, 0);
  nap = new CanvasTexture(c);
  nap.colorSpace = SRGBColorSpace;
  nap.wrapS = nap.wrapT = RepeatWrapping;
  nap.repeat.set(0.62, 0.62);
  nap.anisotropy = 4;
  return nap;
}

/** Size (world units) of the plane the rail shadow is drawn on: the felt's bounding box. */
export const RAIL_SHADOW_SIZE: [number, number] = [FELT.hx * 2, FELT.hz * 2];

let railShadow: CanvasTexture | null = null;
/** Transparent map with a soft dark band hugging the inside of the rail: the rail's contact shadow on the cloth. */
export function railShadowTexture(): CanvasTexture {
  if (railShadow) return railShadow;
  const W = 256, H = Math.round(256 * (FELT.hz / FELT.hx));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const rad = (FELT.r / (FELT.hx * 2)) * W;
  const path = () => {
    g.beginPath();
    g.moveTo(rad, 0); g.lineTo(W - rad, 0); g.arcTo(W, 0, W, rad, rad);
    g.lineTo(W, H - rad); g.arcTo(W, H, W - rad, H, rad);
    g.lineTo(rad, H); g.arcTo(0, H, 0, H - rad, rad);
    g.lineTo(0, rad); g.arcTo(0, 0, rad, 0, rad);
    g.closePath();
  };
  path(); g.clip();
  // wide falloff, then a tight dark line right at the cushion
  for (const [blur, width, alpha] of [[34, 10, 0.5], [12, 6, 0.6], [4, 3, 0.7]] as const) {
    g.shadowColor = `rgba(0,0,0,${alpha})`; g.shadowBlur = blur; g.strokeStyle = `rgba(0,0,0,${alpha})`; g.lineWidth = width;
    path(); g.stroke();
  }
  railShadow = new CanvasTexture(c);
  railShadow.colorSpace = SRGBColorSpace;
  return railShadow;
}
