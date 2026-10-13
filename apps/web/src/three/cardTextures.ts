import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import type { Card } from '@spades/rules';
import { drawBack, drawFace, loadLogo, onLogoLoad } from '../cardArt';

const cache = new Map<string, Texture>();

export function faceTexture(card: Card, res: 'high' | 'low', badge: boolean, anisotropy: number): Texture {
  const key = `${card}:${res}:${badge}`;
  let t = cache.get(key);
  if (t) return t;
  const W = res === 'high' ? 360 : 200;
  t = new CanvasTexture(drawFace(card, W, Math.round(W * 1.4), badge));
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = anisotropy;
  cache.set(key, t);
  return t;
}

export function backTexture(res: 'high' | 'low', anisotropy: number): Texture {
  const key = `back:${res}`;
  let t = cache.get(key);
  if (t) return t;
  const W = res === 'high' ? 360 : 200;
  const tex = new CanvasTexture(drawBack(W, Math.round(W * 1.4), () => { tex.needsUpdate = true; }));
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = anisotropy;
  cache.set(key, tex);
  return tex;
}

/** Felt logo decal (white wordmark on transparent). */
export function logoTexture(onReady: () => void): Texture {
  const key = 'logo';
  let t = cache.get(key);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 276;
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  const draw = () => {
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(loadLogo(), 0, 0, cv.width, cv.height);
    tex.needsUpdate = true;
    onReady();
  };
  const img = loadLogo();
  if (img.complete && img.naturalWidth) draw();
  else onLogoLoad(draw);
  cache.set(key, tex);
  return tex;
}
