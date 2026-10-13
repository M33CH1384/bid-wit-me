import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import type { Card } from '@spades/rules';
import { drawBack, paintFace, paintedFaceKeys, repaintFace, loadLogo, onLogoLoad } from '../cardArt';

const cache = new Map<string, Texture>();

export function faceTexture(card: Card, res: 'high' | 'low', badge: boolean, anisotropy: number): Texture {
  const key = `${card}:${res}:${badge}`;
  let t = cache.get(key);
  if (t) return t;
  const W = res === 'high' ? 360 : 200;
  t = new CanvasTexture(paintFace(card, W, Math.round(W * 1.4), badge));
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

/** Fonts arrived: redraw cached faces one canvas per frame so the main thread never repaints the deck at once. */
export function refreshFacesGradually(onPaint: () => void): () => void {
  const keys = paintedFaceKeys();
  let i = 0;
  let raf = 0;
  const step = () => {
    if (i >= keys.length) return;
    const key = keys[i++]!;
    if (repaintFace(key)) {
      for (const t of cache.values()) if (t.image) t.needsUpdate = true;
      onPaint();
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
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
