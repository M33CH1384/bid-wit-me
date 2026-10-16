import type { Card } from '@spades/rules';

/**
 * Canvas card art with no WebGL imports. The Run it! zoom (and the first page load) draw faces from here.
 * Keeping this off `three` matters: Table imports the zoom, and a static three import pulls the whole
 * renderer into the first script. A cold reload then cannot paint until that script has downloaded and parsed.
 */

/** Procedural card faces (canvas). Courts use large letters, jokers a jester hat, the promoted 2♦ a spade badge. */

type Suit = 'S' | 'H' | 'D' | 'C';
const RED = '#c4122f';
const BLACK = '#15161a';
const PAPER = '#fbf8f1';

function suitPath(ctx: CanvasRenderingContext2D, suit: Suit) {
  // unit glyph centred at 0,0 spanning roughly [-0.5,0.5]
  ctx.beginPath();
  if (suit === 'H' || suit === 'S') {
    const flip = suit === 'S' ? -1 : 1;
    const sy = suit === 'S' ? 0.82 : 1;
    const oy = suit === 'S' ? -0.08 : 0;
    const P = (x: number, y: number): [number, number] => [x * (suit === 'S' ? 0.95 : 1), (y * flip) * sy + oy];
    ctx.moveTo(...P(0, 0.47));
    ctx.bezierCurveTo(...P(-0.12, 0.34), ...P(-0.5, 0.12), ...P(-0.5, -0.15));
    ctx.bezierCurveTo(...P(-0.5, -0.38), ...P(-0.32, -0.49), ...P(-0.19, -0.49));
    ctx.bezierCurveTo(...P(-0.08, -0.49), ...P(0, -0.42), ...P(0, -0.31));
    ctx.bezierCurveTo(...P(0, -0.42), ...P(0.08, -0.49), ...P(0.19, -0.49));
    ctx.bezierCurveTo(...P(0.32, -0.49), ...P(0.5, -0.38), ...P(0.5, -0.15));
    ctx.bezierCurveTo(...P(0.5, 0.12), ...P(0.12, 0.34), ...P(0, 0.47));
    ctx.closePath();
    if (suit === 'S') {
      ctx.moveTo(0, 0.08);
      ctx.quadraticCurveTo(0.02, 0.38, 0.2, 0.5);
      ctx.lineTo(-0.2, 0.5);
      ctx.quadraticCurveTo(-0.02, 0.38, 0, 0.08);
      ctx.closePath();
    }
  } else if (suit === 'D') {
    ctx.moveTo(0, -0.5);
    ctx.quadraticCurveTo(0.17, -0.2, 0.38, 0);
    ctx.quadraticCurveTo(0.17, 0.2, 0, 0.5);
    ctx.quadraticCurveTo(-0.17, 0.2, -0.38, 0);
    ctx.quadraticCurveTo(-0.17, -0.2, 0, -0.5);
    ctx.closePath();
  } else {
    const c = (x: number, y: number, r: number) => { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); };
    c(0, -0.24, 0.21);
    c(-0.24, 0.07, 0.21);
    c(0.24, 0.07, 0.21);
    ctx.moveTo(0, -0.05);
    ctx.quadraticCurveTo(0.02, 0.36, 0.19, 0.5);
    ctx.lineTo(-0.19, 0.5);
    ctx.quadraticCurveTo(-0.02, 0.36, 0, -0.05);
    ctx.closePath();
  }
}

function drawSuit(ctx: CanvasRenderingContext2D, suit: Suit, x: number, y: number, size: number, color: string, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(size, size);
  ctx.fillStyle = color;
  suitPath(ctx, suit);
  ctx.fill('nonzero');
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function paper(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.6, PAPER);
  g.addColorStop(1, '#efe8d8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // faint linen grain
  ctx.globalAlpha = 0.035;
  ctx.fillStyle = '#000';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  ctx.globalAlpha = 1;
}

const PIPS: Record<string, [number, number][]> = {
  '2': [[0.5, 0.2], [0.5, 0.8]],
  '3': [[0.5, 0.2], [0.5, 0.5], [0.5, 0.8]],
  '4': [[0.3, 0.2], [0.7, 0.2], [0.3, 0.8], [0.7, 0.8]],
  '5': [[0.3, 0.2], [0.7, 0.2], [0.5, 0.5], [0.3, 0.8], [0.7, 0.8]],
  '6': [[0.3, 0.2], [0.7, 0.2], [0.3, 0.5], [0.7, 0.5], [0.3, 0.8], [0.7, 0.8]],
  '7': [[0.3, 0.2], [0.7, 0.2], [0.5, 0.35], [0.3, 0.5], [0.7, 0.5], [0.3, 0.8], [0.7, 0.8]],
  '8': [[0.3, 0.2], [0.7, 0.2], [0.5, 0.35], [0.3, 0.5], [0.7, 0.5], [0.5, 0.65], [0.3, 0.8], [0.7, 0.8]],
  '9': [[0.3, 0.2], [0.7, 0.2], [0.3, 0.4], [0.7, 0.4], [0.5, 0.5], [0.3, 0.6], [0.7, 0.6], [0.3, 0.8], [0.7, 0.8]],
  T: [[0.3, 0.2], [0.7, 0.2], [0.5, 0.31], [0.3, 0.4], [0.7, 0.4], [0.3, 0.6], [0.7, 0.6], [0.5, 0.69], [0.3, 0.8], [0.7, 0.8]],
};

/**
 * How far the corner tail runs, in em of the index. Barlow's bowl ends near 0.23em.
 * A phone fan exposes about 0.31 of the card, so 0.34em of tail (ink out to ~0.25 of
 * the card) sat on that edge. 0.26em clears the bowl and leaves a margin before the overlap.
 */
export const QUEEN_TAIL_EM = 0.26;

/**
 * Rightmost ink of the corner Q tail, as a fraction of card width.
 * Includes half the stroke, which extends past the endpoint on the diagonal.
 */
export function queenTailReach(cardW = 1): number {
  const fs = cardW * 0.28;
  const cx = cardW * 0.135;
  const x1 = cx + fs * QUEEN_TAIL_EM;
  const dy = fs * 0.12;
  const dx = fs * (QUEEN_TAIL_EM - 0.08);
  const len = Math.hypot(dx, dy) || 1;
  return (x1 + fs * 0.08 * Math.abs(dy) / len) / cardW;
}

/**
 * Barlow Condensed's Q tail is a short slab under the bowl (about 0.09em, and it
 * never clears the bowl's right edge). On a phone fan only the left third of the
 * card shows, so that slab reads as 0. This continues the same ink past the bowl,
 * still inside the exposed corner, so the letter on the card is still the Barlow glyph.
 */
function queenTail(ctx: CanvasRenderingContext2D, cx: number, baseline: number, fs: number, color: string) {
  ctx.save();
  // The corner index only. A round cap on a longer stroke ran through the pip and off the card.
  ctx.beginPath();
  ctx.rect(cx - fs * 0.55, baseline - fs * 0.9, fs * 0.95, fs * 1.05);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineCap = 'butt';
  ctx.lineWidth = fs * 0.16;
  ctx.beginPath();
  // Start on the native tail and leave the bowl (the bowl ends near 0.23em). Stop above the pip.
  ctx.moveTo(cx + fs * 0.08, baseline + fs * 0.02);
  ctx.lineTo(cx + fs * QUEEN_TAIL_EM, baseline + fs * 0.14);
  ctx.stroke();
  ctx.restore();
}

function corner(ctx: CanvasRenderingContext2D, W: number, rank: string, suit: Suit, color: string, badge: boolean) {
  const label = rank === 'T' ? '10' : rank;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // big, high-contrast index so a card reads at a glance on a phone-sized table
  const fs = W * (label.length > 1 ? 0.25 : 0.28);
  ctx.font = `800 ${fs}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
  const cx = W * 0.135;
  // a same-colour stroke thickens the index: bold, high-contrast corners that read at a glance
  ctx.strokeStyle = color;
  ctx.lineWidth = W * 0.011;
  ctx.lineJoin = 'round';
  if (label.length > 1) { ctx.save(); ctx.translate(cx, 0); ctx.scale(0.86, 1); ctx.fillText(label, 0, W * 0.255); ctx.strokeText(label, 0, W * 0.255); ctx.restore(); }
  else {
    ctx.fillText(label, cx, W * 0.255);
    ctx.strokeText(label, cx, W * 0.255);
  }
  drawSuit(ctx, suit, cx, W * 0.37, W * 0.165, color);
  // After the pip, so the tail stays visible where it passes the suit.
  if (label === 'Q') queenTail(ctx, cx, W * 0.255, fs, color);
  if (badge) {
    ctx.beginPath();
    ctx.arc(cx, W * 0.53, W * 0.07, 0, Math.PI * 2);
    ctx.fillStyle = BLACK;
    ctx.fill();
    ctx.lineWidth = W * 0.012;
    ctx.strokeStyle = '#e7b93f';
    ctx.stroke();
    drawSuit(ctx, 'S', cx, W * 0.53, W * 0.085, '#ffffff');
  }
}

/**
 * Court frame, as a fraction of card width. The fan shows at most 62% of a card (the fit
 * loop's step cap). The gold stroke is 1.8% wide, so the frame starts past that strip.
 * A frame in the exposed strip reads as a gold line through the next card.
 */
export const COURT_FRAME_X = 0.64;
export const COURT_FRAME_W = 0.3;

function court(ctx: CanvasRenderingContext2D, W: number, H: number, rank: string, suit: Suit, color: string) {
  // Right of the exposed corner. A frame on that strip reads as a gold line through the next card.
  const x = W * COURT_FRAME_X, y = H * 0.1, w = W * COURT_FRAME_W, h = H * 0.8;
  const mid = x + w / 2;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  const tint = color === RED ? ['#fde9e6', '#f6cfc7'] : ['#e9edf7', '#cfd6ea'];
  g.addColorStop(0, tint[0]!);
  g.addColorStop(1, tint[1]!);
  roundRect(ctx, x, y, w, h, W * 0.04);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = W * 0.018;
  ctx.strokeStyle = '#c9a03c';
  ctx.stroke();
  roundRect(ctx, x + W * 0.025, y + W * 0.025, w - W * 0.05, h - W * 0.05, W * 0.03);
  ctx.lineWidth = W * 0.006;
  ctx.strokeStyle = color;
  ctx.stroke();
  // crown band
  ctx.fillStyle = '#c9a03c';
  const cy = y + h * 0.2;
  ctx.beginPath();
  const n = rank === 'K' ? 5 : rank === 'Q' ? 4 : 3;
  const bw = w * 0.5, bx = mid - bw / 2;
  ctx.moveTo(bx, cy + W * 0.06);
  for (let i = 0; i <= n; i++) {
    const px = bx + (bw * i) / n;
    ctx.lineTo(px, cy - (i % 2 === 0 ? W * 0.04 : 0));
    if (i < n) ctx.lineTo(bx + (bw * (i + 0.5)) / n, cy + W * 0.02);
  }
  ctx.lineTo(bx + bw, cy + W * 0.06);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const courtFs = W * 0.3;
  ctx.font = `800 ${courtFs}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
  const courtY = y + h * 0.53;
  ctx.fillText(rank, mid, courtY);
  drawSuit(ctx, suit, mid, y + h * 0.84, W * 0.1, color);
  if (rank === 'Q') queenTail(ctx, mid, courtY + courtFs * 0.33, courtFs, color);
}

function joker(ctx: CanvasRenderingContext2D, W: number, H: number, big: boolean) {
  const ink = big ? '#b0122c' : BLACK;
  // corner "JOKER"
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${W * 0.14}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
  'JOKER'.split('').forEach((l, i) => ctx.fillText(l, W * 0.11, W * 0.13 + i * W * 0.13));
  ctx.save();
  ctx.translate(W, H);
  ctx.rotate(Math.PI);
  'JOKER'.split('').forEach((l, i) => ctx.fillText(l, W * 0.11, W * 0.13 + i * W * 0.13));
  ctx.restore();
  // jester hat
  const cx = W / 2, cy = H * 0.46, s = W * 0.62;
  const colors = big ? ['#7b2ff7', '#e0b13a', '#d7263d'] : ['#2a2a2e', '#8d8d93', '#4a4a50'];
  const tips: [number, number][] = [[-0.48, -0.32], [0, -0.55], [0.48, -0.32]];
  tips.forEach(([tx, ty], i) => {
    ctx.beginPath();
    ctx.moveTo(cx + (-0.34 + i * 0.23) * s, cy + 0.12 * s);
    ctx.quadraticCurveTo(cx + tx * s * 0.6, cy + ty * s * 0.2, cx + tx * s, cy + ty * s);
    ctx.quadraticCurveTo(cx + (tx * 0.3 + (i - 1) * 0.12) * s, cy - 0.05 * s, cx + (-0.11 + i * 0.23) * s, cy + 0.12 * s);
    ctx.closePath();
    ctx.fillStyle = colors[i]!;
    ctx.fill();
    ctx.lineWidth = W * 0.008;
    ctx.strokeStyle = big ? '#3b1060' : '#000';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + tx * s, cy + ty * s, s * 0.06, 0, Math.PI * 2);
    ctx.fillStyle = big ? '#f2c94c' : '#d9d9d9';
    ctx.fill();
    ctx.stroke();
  });
  // band
  roundRect(ctx, cx - 0.4 * s, cy + 0.1 * s, 0.8 * s, 0.13 * s, 0.05 * s);
  ctx.fillStyle = big ? '#e0b13a' : '#bdbdc2';
  ctx.fill();
  ctx.stroke();
  // diamonds on band
  for (let i = -1; i <= 1; i++) drawSuit(ctx, 'D', cx + i * 0.22 * s, cy + 0.165 * s, s * 0.09, big ? '#7b2ff7' : '#2a2a2e');
  ctx.fillStyle = ink;
  ctx.font = `800 ${W * 0.15}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
  ctx.fillText(big ? 'BIG' : 'LITTLE', cx, H * 0.7);
  ctx.font = `700 ${W * 0.1}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
  ctx.fillText('JOKER', cx, H * 0.79);
}

const painted = new Map<string, HTMLCanvasElement>();

function faceKey(card: Card, W: number, badge: boolean): string {
  return `${card}:${W}:${badge ? 1 : 0}`;
}

/** Cached face. The HTML hand and the 3D card share one canvas, so a face is drawn once. */
export function paintFace(card: Card, W: number, H: number, badge: boolean): HTMLCanvasElement {
  const key = faceKey(card, W, badge);
  const hit = painted.get(key);
  if (hit) return hit;
  const cv = drawFace(card, W, H, badge);
  painted.set(key, cv);
  return cv;
}

export function paintedFaceKeys(): string[] {
  return [...painted.keys()];
}

/** Redraw one cached face in place (after webfonts arrive) and return that canvas. */
export function repaintFace(key: string): HTMLCanvasElement | null {
  const cv = painted.get(key);
  if (!cv) return null;
  const [card, w, badge] = key.split(':');
  const W = Number(w);
  const fresh = drawFace(card as Card, W, Math.round(W * 1.4), badge === '1');
  const ctx = cv.getContext('2d');
  if (ctx) { ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(fresh, 0, 0); }
  return cv;
}

export function drawFace(card: Card, W: number, H: number, badge: boolean): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  paper(ctx, W, H);
  if (card === 'BJ' || card === 'LJ') {
    joker(ctx, W, H, card === 'BJ');
    return cv;
  }
  const rank = card[0]!;
  const suit = card[1] as Suit;
  const color = suit === 'H' || suit === 'D' ? RED : BLACK;
  if (rank === 'A') {
    // the ace of spades' ring + big pip stay out of the exposed left strip too (no stray arc peeking out in a fan)
    const big = suit === 'S' ? 0.3 : 0.3;
    if (suit === 'S') {
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, W * 0.17, 0, Math.PI * 2);
      ctx.strokeStyle = '#c9a03c';
      ctx.lineWidth = W * 0.012;
      ctx.stroke();
    }
    drawSuit(ctx, suit, W / 2, H / 2, W * big, color);
  } else if (rank === 'J' || rank === 'Q' || rank === 'K') {
    court(ctx, W, H, rank, suit, color);
  } else {
    const x0 = W * 0.27, x1 = W * 0.73, y0 = H * 0.1, y1 = H * 0.9;
    for (const [px, py] of PIPS[rank]!) {
      drawSuit(ctx, suit, x0 + (x1 - x0) * px, y0 + (y1 - y0) * py, W * 0.15, color, py > 0.55 ? Math.PI : 0);
    }
  }
  corner(ctx, W, rank, suit, color, badge);
  ctx.save();
  ctx.translate(W, H);
  ctx.rotate(Math.PI);
  corner(ctx, W, rank, suit, color, badge);
  ctx.restore();
  return cv;
}

let logo: HTMLImageElement | null = null;
const logoWaiters: (() => void)[] = [];
export function loadLogo(): HTMLImageElement {
  if (logo) return logo;
  logo = new Image();
  logo.onload = () => logoWaiters.splice(0).forEach((f) => f());
  logo.src = '/assets/bwm-wordmark-white.svg';
  return logo;
}

export function drawBack(W: number, H: number, onReady?: () => void): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const paint = () => {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);
    const m = W * 0.06;
    roundRect(ctx, m, m, W - 2 * m, H - 2 * m, W * 0.05);
    const g = ctx.createRadialGradient(W / 2, H / 2, W * 0.1, W / 2, H / 2, H * 0.7);
    g.addColorStop(0, '#3a1a6e');
    g.addColorStop(1, '#14082b');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // lattice
    ctx.strokeStyle = 'rgba(190,150,255,0.16)';
    ctx.lineWidth = W * 0.006;
    const step = W * 0.075;
    for (let x = -H; x < W + H; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + H, 0); ctx.stroke();
    }
    ctx.restore();
    roundRect(ctx, m * 1.6, m * 1.6, W - 3.2 * m, H - 3.2 * m, W * 0.035);
    ctx.strokeStyle = '#e0b13a';
    ctx.lineWidth = W * 0.01;
    ctx.stroke();
    // centre band with the wordmark
    const bh = W * 0.3;
    ctx.fillStyle = 'rgba(8,4,18,0.85)';
    ctx.fillRect(m, H / 2 - bh / 2, W - 2 * m, bh);
    ctx.fillStyle = '#e0b13a';
    ctx.fillRect(m, H / 2 - bh / 2, W - 2 * m, W * 0.008);
    ctx.fillRect(m, H / 2 + bh / 2 - W * 0.008, W - 2 * m, W * 0.008);
    const img = loadLogo();
    if (img.complete && img.naturalWidth) {
      const lw = W * 0.7, lh = (lw * 688) / 2552;
      ctx.drawImage(img, W / 2 - lw / 2, H / 2 - lh / 2, lw, lh);
    }
  };
  paint();
  if (!(logo && logo.complete && logo.naturalWidth)) logoWaiters.push(() => { paint(); onReady?.(); });
  return cv;
}


/** Run once the wordmark has decoded. Used by the WebGL logo texture, which lives in a separate module. */
export function onLogoLoad(fn: () => void): void {
  if (logo && logo.complete && logo.naturalWidth) fn();
  else logoWaiters.push(fn);
}

