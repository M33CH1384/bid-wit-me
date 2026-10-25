import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import type { Card } from '@spades/rules';
import { drawBack, paintFace, paintedFaceKeys, repaintFace, loadLogo, onLogoLoad } from '../cardArt';
import { deckBackUrl, getActiveDeck, onDeckArtLoad } from '../decks';
import { noteDiag } from '../diagnostics';

const cache = new Map<string, Texture>();

/** A face already painted this session, or null. Does not paint. */
export function peekFaceTexture(card: Card, res: 'high' | 'low', badge: boolean): Texture | null {
  return cache.get(`${getActiveDeck()}:${card}:${res}:${badge}`) ?? null;
}

export function faceTexture(card: Card, res: 'high' | 'low', badge: boolean, anisotropy: number): Texture {
  hookDeckArtRefresh();
  const key = `${getActiveDeck()}:${card}:${res}:${badge}`;
  let t = cache.get(key);
  if (t) return t;
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __bwmFaceLoads?: string[] };
    // Tests opt in. A cache miss is a real upload; a tap must not add one.
    if (w.__bwmFaceLoads) w.__bwmFaceLoads.push(key);
  }
  const W = res === 'high' ? 360 : 200;
  t = new CanvasTexture(paintFace(card, W, Math.round(W * 1.4), badge));
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = anisotropy;
  cache.set(key, t);
  return t;
}

/* ---------- per-deck card backs (founder-approved image set) ----------
 * One back per deck, driven by the deck selected in Setup (Table calls setActiveDeck
 * from Settings.deck, so your backs, opponents' backs and the deck pile all match).
 * Loaded like the wordmark: cached image + persistent waiters repainting on arrival.
 * Fallback chain: selected deck's back -> Base-back -> the old procedural back, which
 * now only ever paints while an image is still loading (or if every image failed).
 * The URL helper itself lives in ../decks (the registry) so light surfaces can
 * use it without statically importing three; it is re-exported here so this
 * module's existing importers keep their path. */
export { deckBackUrl } from '../decks';
const backImages = new Map<string, HTMLImageElement>();
const backFailed = new Set<string>();
const backWaiters = new Map<string, Set<() => void>>();
function loadDeckBack(deck: string, onReady: () => void): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  let img = backImages.get(deck);
  if (!img) {
    img = new Image();
    backImages.set(deck, img);
    img.onload = () => backWaiters.get(deck)?.forEach((f) => f());
    img.onerror = () => { noteDiag('card-back', deckBackUrl(deck)); backFailed.add(deck); backWaiters.get(deck)?.forEach((f) => f()); };
    img.src = deckBackUrl(deck);
  }
  if (img.complete && img.naturalWidth && !backFailed.has(deck)) return img;
  let set = backWaiters.get(deck);
  if (!set) { set = new Set(); backWaiters.set(deck, set); }
  set.add(onReady); // persistent: a later deck switch back must still repaint (cf. #188 waiters)
  return null;
}

export function backTexture(res: 'high' | 'low', anisotropy: number): Texture {
  const deck = getActiveDeck();
  const key = `back:${deck}:${res}`;
  let t = cache.get(key);
  if (t) return t;
  const W = res === 'high' ? 360 : 200;
  const H = Math.round(W * 1.4);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = anisotropy;
  const paint = () => {
    const ctx = cv.getContext('2d')!;
    const img = loadDeckBack(deck, paint) ?? (deck !== 'base' ? loadDeckBack('base', paint) : null);
    if (img) ctx.drawImage(img, 0, 0, W, H);
    else ctx.drawImage(drawBack(W, H), 0, 0);
    tex.needsUpdate = true;
  };
  paint();
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

let deckArtHooked = false;
/** When deck court art finishes loading, repaint cached faces in place and flag textures dirty.
 *  Self-subscribes on first face request so no scene/table wiring is needed. */
function hookDeckArtRefresh(): void {
  if (deckArtHooked) return;
  deckArtHooked = true;
  onDeckArtLoad(() => {
    for (const key of paintedFaceKeys()) repaintFace(key);
    for (const t of cache.values()) if (t.image) t.needsUpdate = true;
  });
}
