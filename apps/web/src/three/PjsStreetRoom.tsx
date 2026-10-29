/**
 * THE PJ'S — STREET ENVIRONMENT (production, owner order 2026-10-28:
 * "Can we make this one live?").
 *
 * The code-built Pj's room from the immersive sandbox, ported into the
 * live game's venue dressing. Mounted by Venue3D ONLY for
 * blockAfterDark at High quality; Low keeps the photorealistic
 * bg.jpg + floor fallback exactly as before. The game's own table,
 * cards, layout, cameras and venue lock are untouched — this is the
 * street AROUND the table: picket fence, shepherd's-crook streetlight,
 * brick facades, kettle grill, crates, sidewalk/street, and the four
 * seat chairs (CHAIR_SPOTS).
 *
 * Route rule (owner, 2026-10-28): code-first, mix when necessary.
 * Everything here is procedural geometry + canvas textures EXCEPT the
 * parked sedan — the room's one Forge mix (TRELLIS, three.ws Forge,
 * creation 209057ed, gated PASS WITH DEVIATIONS in the sandbox rooms
 * program: vintage 1930s bodywork, near-black paint; the code sedan
 * read as a silhouette, the Forge car has real bodywork). The GLB
 * (public/assets/venues/blockAfterDark/sedan.glb, ~1.15 MB, ~77k tris,
 * one mesh) lazy-loads on mount for this venue only; a failed load
 * just omits the car (window.__pjsSedan names it), never the room.
 *
 * Effects discipline: `fxOn` (High + effects on, Venue3D's gate)
 * drives the streetlight flicker, the grill-smoke sprites and the
 * ember breathing. Effects off → the same room, steady light, no
 * smoke. Ambient frames come from Venue3D's AmbientTicker (this
 * venue is in its MOVES set); frameloop stays 'demand'.
 *
 * PROMO-LOOK PASS (owner, 2026-10-29: "My pjs venue needs to look
 * more like that video" — the Bid Wit Me promo's opening street):
 * the street gains its anchor tenant, a corner LIQUOR STORE
 * (awning, blade sign, barred glass, blue/red neon with real spill
 * light), poster-plastered brick with a rent notice and graffiti
 * tags, laundry lines overhead, night-haze veils with a bigger
 * streetlight bloom, fence-line clutter (bikes, trash can,
 * cardboard) and a taillight car down the block. All code — canvas
 * textures + merged geometry; the sedan stays the room's one Forge
 * mix, and no new downloads join the asset gate.
 */
import { Component, Suspense, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import {
  AdditiveBlending, Box3, BoxGeometry, BufferGeometry, CanvasTexture, CatmullRomCurve3,
  CircleGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, Fog,
  Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry, Quaternion, RepeatWrapping, SRGBColorSpace,
  SphereGeometry, SpriteMaterial, Texture, TorusGeometry,
  TubeGeometry, Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHAIR_SPOTS } from './classicStudioLayout';
import { fx } from '../fx';
import { SEDAN_BLAST_FLASH_S, sedanBlastPoseAt, sedanBlastReaction, sedanBlastReducer, type SedanBlastState } from './pjsSedanBlast';

const FLOOR_Y = -0.9;
const SEDAN_URL = '/assets/venues/blockAfterDark/sedan.glb';

/* ------------------------------------------------------------------ */
/* Deterministic RNG so every load paints the identical room           */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Procedural canvas textures — painted by code, no image files        */
/* ------------------------------------------------------------------ */

function canvasTex(w: number, h: number, paint: (c: CanvasRenderingContext2D, w: number, h: number) => void, repeat?: [number, number]): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  paint(ctx, w, h);
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) {
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, rnd: () => number, alpha: number, light: boolean): void {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(rnd() * 255);
    ctx.fillStyle = light
      ? `rgba(${200 + v % 55},${200 + v % 55},${200 + v % 55},${(rnd() * alpha).toFixed(3)})`
      : `rgba(0,0,0,${(rnd() * alpha).toFixed(3)})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

/** Red-brown brick courses with per-brick jitter and a grime foot. */
function makeBrickTexture(seed: number, tone: number, repeat: [number, number] = [3, 1.6]): CanvasTexture {
  return canvasTex(1024, 512, (ctx, w, h) => {
    const rnd = mulberry32(seed);
    ctx.fillStyle = '#2e2126'; // mortar
    ctx.fillRect(0, 0, w, h);
    const bh = 21, bw = 84, gap = 5;
    for (let row = 0; row * (bh + gap) < h + bh; row++) {
      const off = row % 2 === 0 ? 0 : (bw + gap) / 2;
      for (let col = -1; col * (bw + gap) < w + bw; col++) {
        const j = (rnd() - 0.5) * 22;
        const r = Math.floor((118 + j) * tone);
        const g = Math.floor((62 + j * 0.6) * tone);
        const b = Math.floor((46 + j * 0.5) * tone);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(col * (bw + gap) + off, row * (bh + gap), bw, bh);
        if (rnd() > 0.72) { // weather spot
          ctx.fillStyle = `rgba(20,12,10,${(rnd() * 0.25).toFixed(2)})`;
          ctx.fillRect(col * (bw + gap) + off + rnd() * bw * 0.6, row * (bh + gap), bw * 0.4, bh);
        }
      }
    }
    const grime = ctx.createLinearGradient(0, h * 0.72, 0, h);
    grime.addColorStop(0, 'rgba(0,0,0,0)');
    grime.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = grime;
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 3000, rnd, 0.08, false);
  }, repeat);
}

/** Sidewalk concrete: slab joints, speckle, hairline cracks. */
function makeConcreteTexture(): CanvasTexture {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(4202);
    ctx.fillStyle = '#55524e';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 9000, rnd, 0.10, true);
    speckle(ctx, w, h, 9000, rnd, 0.12, false);
    ctx.strokeStyle = 'rgba(24,22,20,0.85)';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, w, h); // slab joint (tiles per repeat)
    ctx.strokeStyle = 'rgba(30,28,26,0.5)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) { // cracks wander from a random edge point
      let x = rnd() * w, y = rnd() * h;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let s = 0; s < 6; s++) { x += (rnd() - 0.5) * 90; y += (rnd() - 0.5) * 90; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    for (let i = 0; i < 7; i++) { // stains
      const x = rnd() * w, y = rnd() * h, r = 30 + rnd() * 90;
      const st = ctx.createRadialGradient(x, y, 2, x, y, r);
      st.addColorStop(0, `rgba(18,16,14,${(0.10 + rnd() * 0.12).toFixed(2)})`);
      st.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = st;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, [5, 2.4]);
}

/** Wet-look asphalt: dark body, dense speckle, faint patch seams. */
function makeAsphaltTexture(): CanvasTexture {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(9911);
    ctx.fillStyle = '#17181c';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 15000, rnd, 0.16, true);
    speckle(ctx, w, h, 6000, rnd, 0.2, false);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.38); ctx.lineTo(w, h * 0.41); // patch seam
    ctx.stroke();
  }, [6, 3]);
}

/** Wooden crate planks: horizontal boards, grain streaks, nail dots. */
function makePlankTexture(): CanvasTexture {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(5150);
    ctx.fillStyle = '#6d4c2c';
    ctx.fillRect(0, 0, w, h);
    const rows = 4, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      const j = (rnd() - 0.5) * 26;
      ctx.fillStyle = `rgb(${109 + j},${76 + j * 0.7},${44 + j * 0.5})`;
      ctx.fillRect(0, r * rh + 2, w, rh - 4);
      ctx.strokeStyle = 'rgba(46,30,16,0.55)';
      for (let gLine = 0; gLine < 7; gLine++) {
        ctx.beginPath();
        const gy = r * rh + 6 + rnd() * (rh - 12);
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(w * 0.3, gy + (rnd() - 0.5) * 7, w * 0.7, gy + (rnd() - 0.5) * 7, w, gy);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(30,20,12,0.8)';
      for (const nx of [14, w - 14]) for (const ny of [r * rh + 12, r * rh + rh - 12]) {
        ctx.beginPath(); ctx.arc(nx, ny, 3.4, 0, Math.PI * 2); ctx.fill();
      }
    }
  });
}

/** Lit window: warm interior gradient, mullion cross, curtain edge. */
function makeLitWindowTexture(seed: number): CanvasTexture {
  return canvasTex(128, 176, (ctx, w, h) => {
    const rnd = mulberry32(seed);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#ffd9a0');
    grad.addColorStop(0.55, '#f7b45e');
    grad.addColorStop(1, '#d98a34');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    if (rnd() > 0.4) { // blind slats on some
      ctx.fillStyle = 'rgba(120,70,30,0.35)';
      for (let y = 8; y < h * 0.5; y += 9) ctx.fillRect(0, y, w, 4);
    }
    if (rnd() > 0.5) { // curtain pulled to one side
      ctx.fillStyle = 'rgba(146,84,44,0.55)';
      ctx.fillRect(0, 0, w * 0.3, h);
    }
    ctx.fillStyle = '#151312';
    ctx.fillRect(w / 2 - 3, 0, 6, h);
    ctx.fillRect(0, h / 2 - 3, w, 6);
    ctx.strokeStyle = '#0d0c0b';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, w, h);
  });
}

/** Unlit window: near-black glass with a cold diagonal sheen. */
function makeDarkWindowTexture(): CanvasTexture {
  return canvasTex(128, 176, (ctx, w, h) => {
    ctx.fillStyle = '#0a0f16';
    ctx.fillRect(0, 0, w, h);
    const sheen = ctx.createLinearGradient(0, 0, w, h);
    sheen.addColorStop(0, 'rgba(140,165,205,0.20)');
    sheen.addColorStop(0.45, 'rgba(140,165,205,0.03)');
    sheen.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#05070a';
    ctx.fillRect(w / 2 - 3, 0, 6, h);
    ctx.fillRect(0, h / 2 - 3, w, 6);
    ctx.strokeStyle = '#0d0c0b';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, w, h);
  });
}

/** Poster-plastered brick section: two layers of weathered flyers —
 *  header bands, portrait blocks, fake text lines, tape tabs, torn
 *  corners — over a dark brick ghost, grime rising from the foot. */
function makePosterWallTexture(seed: number): CanvasTexture {
  return canvasTex(1024, 512, (ctx, w, h) => {
    const rnd = mulberry32(seed);
    ctx.fillStyle = '#251b18';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 1500, rnd, 0.10, false);
    const palette = ['#d8cfb8', '#e5d9a8', '#c9d4d8', '#e0b7a0', '#b8cdb0', '#e8e3da', '#d9a0a8', '#a8c4d4', '#e6c87a'];
    const flyer = (x: number, y: number, fw: number, fh: number, rot: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.fillStyle = 'rgba(8,6,6,0.4)';
      ctx.fillRect(-fw / 2 + 4, -fh / 2 + 6, fw, fh); // drop shadow
      ctx.fillStyle = palette[Math.floor(rnd() * palette.length)]!;
      ctx.fillRect(-fw / 2, -fh / 2, fw, fh);
      ctx.fillStyle = `rgba(96,74,50,${(rnd() * 0.16).toFixed(2)})`; // sun fade
      ctx.fillRect(-fw / 2, -fh / 2, fw, fh);
      ctx.fillStyle = `rgba(22,19,26,${(0.55 + rnd() * 0.3).toFixed(2)})`; // header band
      ctx.fillRect(-fw / 2 + 6, -fh / 2 + 6, fw - 12, fh * 0.20);
      if (rnd() > 0.45) { // portrait block + head silhouette
        const pw = fw * 0.42, ph = fh * 0.38;
        ctx.fillStyle = 'rgba(42,36,32,0.72)';
        ctx.fillRect(-pw / 2, -fh / 2 + fh * 0.31, pw, ph);
        ctx.beginPath();
        ctx.arc(0, -fh / 2 + fh * 0.31 + ph * 0.36, pw * 0.17, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(22,18,16,0.9)';
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(30,26,26,0.62)'; // fake text lines
      for (let ly = -fh / 2 + fh * 0.76; ly < fh / 2 - 9; ly += 10) {
        ctx.fillRect(-fw / 2 + 8, ly, (fw - 16) * (0.55 + rnd() * 0.4), 3.5);
      }
      ctx.fillStyle = 'rgba(232,226,200,0.5)'; // tape tabs
      ctx.fillRect(-fw / 2 + 4, -fh / 2 - 2, 22, 8);
      ctx.fillRect(fw / 2 - 26, -fh / 2 - 2, 22, 8);
      if (rnd() > 0.55) { // torn corner, brick ghosting through
        ctx.fillStyle = '#251b18';
        ctx.beginPath();
        const cx = rnd() > 0.5 ? fw / 2 : -fw / 2;
        ctx.moveTo(cx, fh / 2);
        ctx.lineTo(cx - Math.sign(cx) * fw * 0.3, fh / 2);
        ctx.lineTo(cx, fh / 2 - fh * 0.26);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    };
    for (let i = 0; i < 15; i++) flyer(rnd() * w, 30 + rnd() * h * 0.88, 120 + rnd() * 130, 150 + rnd() * 165, (rnd() - 0.5) * 0.10);
    for (let i = 0; i < 13; i++) flyer(rnd() * w, 30 + rnd() * h * 0.88, 105 + rnd() * 120, 140 + rnd() * 155, (rnd() - 0.5) * 0.15);
    speckle(ctx, w, h, 2600, rnd, 0.12, false);
    const grime = ctx.createLinearGradient(0, h * 0.78, 0, h);
    grime.addColorStop(0, 'rgba(0,0,0,0)');
    grime.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = grime;
    ctx.fillRect(0, 0, w, h);
  });
}

/** The one legible notice in the plaster: APARTMENTS FOR RENT. */
function makeRentNoticeTexture(): CanvasTexture {
  return canvasTex(256, 340, (ctx, w, h) => {
    ctx.fillStyle = '#e9e7e0';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#274b8f';
    ctx.fillRect(0, 0, w, 94);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 29px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('APARTMENTS', w / 2, 40);
    ctx.fillText('FOR RENT', w / 2, 77);
    ctx.fillStyle = 'rgba(28,28,34,0.78)';
    const widths = [0.92, 0.78, 0.88, 0.6, 0.9, 0.72, 0.84, 0.66, 0.9, 0.58];
    widths.forEach((f, i) => ctx.fillRect(22, 122 + i * 17, (w - 44) * f, 6));
    ctx.fillStyle = '#274b8f';
    ctx.fillRect(22, h - 36, 96, 15); // phone tab block — a shape, no digits
    ctx.fillStyle = 'rgba(96,74,50,0.18)';
    ctx.fillRect(0, h - 26, w, 26);
  });
}

/** Graffiti tags on transparent ground: looping stroke tags with a
 *  dark shadow pass, painted — never lettered. */
function makeGraffitiTexture(seed: number): CanvasTexture {
  return canvasTex(1024, 256, (ctx, w, h) => {
    const rnd = mulberry32(seed);
    const tag = (x: number, y: number, s: number, col: string, shadow: string) => {
      const stroke = (width: number, style: string) => {
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 30);
        ctx.bezierCurveTo(30, -38, 74, -30, 84, 8);
        ctx.bezierCurveTo(90, 30, 66, 44, 48, 22);
        ctx.bezierCurveTo(90, -6, 128, -8, 150, 16);
        ctx.bezierCurveTo(162, 30, 150, 46, 132, 36);
        ctx.bezierCurveTo(168, 12, 196, 2, 214, 20);
        ctx.bezierCurveTo(226, 32, 210, 44, 196, 30);
        ctx.stroke();
      };
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(s, s);
      stroke(17, shadow);
      stroke(11, col);
      ctx.restore();
    };
    tag(50, 108, 1.45, 'rgba(228,222,206,0.85)', 'rgba(10,8,10,0.65)');
    tag(585, 128, 1.02, 'rgba(198,64,44,0.8)', 'rgba(10,8,10,0.6)');
    tag(830, 96, 0.72, 'rgba(120,170,220,0.7)', 'rgba(10,8,10,0.55)');
    ctx.fillStyle = 'rgba(228,222,206,0.45)'; // drips
    for (const dx of [118, 296, 398]) ctx.fillRect(dx, 148, 5, 24 + rnd() * 30);
    speckle(ctx, w, h, 260, rnd, 0.14, false);
  });
}

/** Storefront neon on transparent ground: blue tube frame, LIQUOR in
 *  blue, OPEN in red — drawn with glow passes, lit by its material. */
function makeNeonTexture(): CanvasTexture {
  return canvasTex(512, 320, (ctx, w, h) => {
    ctx.textAlign = 'center';
    ctx.shadowColor = '#57b6ff';
    ctx.shadowBlur = 18;
    ctx.strokeStyle = '#57b6ff';
    ctx.lineWidth = 3;
    for (let i = 0; i < 2; i++) ctx.strokeRect(18, 18, w - 36, h - 36);
    const neon = (text: string, y: number, size: number, col: string) => {
      ctx.font = `bold ${size}px system-ui, sans-serif`;
      ctx.shadowColor = col;
      ctx.shadowBlur = 26;
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) ctx.strokeText(text, w / 2, y);
      ctx.shadowBlur = 6;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = 1.4;
      ctx.strokeText(text, w / 2, y);
    };
    neon('LIQUOR', 140, 76, '#57b6ff');
    neon('OPEN', 250, 64, '#ff5040');
    ctx.shadowBlur = 0;
  });
}

/** The store's painted band sign. */
function makeStoreSignTexture(): CanvasTexture {
  return canvasTex(1024, 144, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#6d1517');
    grad.addColorStop(0.55, '#571011');
    grad.addColorStop(1, '#3f0c0d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e8c87a';
    ctx.fillRect(0, 8, w, 4);
    ctx.fillRect(0, h - 12, w, 4);
    ctx.font = 'bold 82px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f3e3bb';
    ctx.shadowColor = 'rgba(255,160,60,0.55)';
    ctx.shadowBlur = 10;
    ctx.fillText('LIQUOR STORE', w / 2, h / 2 + 30);
    ctx.shadowBlur = 0;
  });
}

/** Projecting blade sign: LIQUOR stacked down a dark panel. */
function makeBladeSignTexture(): CanvasTexture {
  return canvasTex(256, 640, (ctx, w, h) => {
    ctx.fillStyle = '#101014';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#c8a24a';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.font = 'bold 96px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(255,90,40,0.8)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#ff7847';
    'LIQUOR'.split('').forEach((ch, i) => ctx.fillText(ch, w / 2, 108 + i * 92));
    ctx.shadowBlur = 0;
  });
}

/** Awning canvas: red stripes with a shaded foot. */
function makeAwningTexture(): CanvasTexture {
  return canvasTex(512, 128, (ctx, w, h) => {
    for (let x = 0; x < w; x += 64) {
      ctx.fillStyle = Math.floor(x / 64) % 2 ? '#7e1a1c' : '#a32426';
      ctx.fillRect(x, 0, 64, h);
    }
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,190,150,0.10)');
    grad.addColorStop(1, 'rgba(0,0,0,0.34)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }, [3, 1]);
}

/** The side table's loud cloth: saturated ground, big loose blooms. */
function makeClothTexture(): CanvasTexture {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(777);
    ctx.fillStyle = '#14635e';
    ctx.fillRect(0, 0, w, h);
    const cols = ['#e8483f', '#f2a03d', '#f2e14c', '#e87fb0'];
    for (let i = 0; i < 26; i++) {
      const x = rnd() * w, y = rnd() * h, r = 13 + rnd() * 17;
      const col = cols[Math.floor(rnd() * cols.length)]!;
      ctx.fillStyle = col;
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2 + rnd() * 0.4;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.52, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#f7ead0';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(247,234,208,0.75)';
    for (let i = 0; i < 130; i++) {
      ctx.beginPath();
      ctx.arc(rnd() * w, rnd() * h, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [2, 1]);
}

/** Soft radial glow (lamp halo, smoke puff, ground blob). */
function makeGlowTexture(): CanvasTexture {
  return canvasTex(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.32)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

/** Charcoal grate: concentric rings + spokes, dark steel on clear. */
function makeGrateTexture(): CanvasTexture {
  const tex = canvasTex(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(38,36,38,1)';
    ctx.lineWidth = 7;
    for (const r of [34, 66, 98, 122]) {
      ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.lineTo(w / 2 + Math.cos(a) * 124, h / 2 + Math.sin(a) * 124);
      ctx.stroke();
    }
  });
  return tex;
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

type G = BufferGeometry;

function box(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): G {
  const g = new BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

function cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, seg = 14): G {
  const g = new CylinderGeometry(rt, rb, h, seg);
  g.translate(x, y, z);
  return g;
}

/** A tube (cylinder) stretched between two points — chair frames,
 *  grill legs, railing work. */
function tube(a: [number, number, number], b: [number, number, number], r: number, seg = 10): G {
  const va = new Vector3(...a), vb = new Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  const g = new CylinderGeometry(r, r, len, seg);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize()));
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

function merged(parts: G[]): BufferGeometry {
  // ExtrudeGeometry is non-indexed while Box/Cylinder/etc. are indexed;
  // mergeGeometries demands one kind — normalize everything to
  // non-indexed before merging.
  const norm = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const m = mergeGeometries(norm);
  norm.forEach((g) => g.dispose());
  parts.forEach((g) => g.dispose());
  if (!m) throw new Error('geometry merge failed');
  return m;
}

/* ------------------------------------------------------------------ */
/* Shared assets — built once, code only                               */
/* ------------------------------------------------------------------ */

type Assets = ReturnType<typeof buildAssets>;
let ASSETS: Assets | null = null;
function assets(): Assets {
  if (!ASSETS) ASSETS = buildAssets();
  return ASSETS;
}

function buildAssets() {
  const brickNearTex = makeBrickTexture(3101, 1.0);
  const brickFarTex = makeBrickTexture(777, 0.72, [7, 2.4]);
  const concreteTex = makeConcreteTexture();
  const asphaltTex = makeAsphaltTexture();
  const plankTex = makePlankTexture();
  const litWinTex = makeLitWindowTexture(2024);
  const darkWinTex = makeDarkWindowTexture();
  const glowTex = makeGlowTexture();
  const grateTex = makeGrateTexture();
  const posterTexA = makePosterWallTexture(515);
  const posterTexB = makePosterWallTexture(902);
  const rentNoticeTex = makeRentNoticeTexture();
  const graffitiTex = makeGraffitiTexture(31);
  const neonTex = makeNeonTexture();
  const storeSignTex = makeStoreSignTexture();
  const bladeSignTex = makeBladeSignTexture();
  const awningTex = makeAwningTexture();
  const clothTex = makeClothTexture();

  const std = (p: ConstructorParameters<typeof MeshStandardMaterial>[0]) => new MeshStandardMaterial(p);
  const mats = {
    tableBody: std({ color: '#241509', roughness: 0.72, metalness: 0 }),
    steelBlack: std({ color: '#101114', roughness: 0.42, metalness: 0.72 }),
    chairPanel: std({ color: '#17382b', roughness: 0.62, metalness: 0.05 }),
    // a whisper of emissiveMap keeps the brick from ever going pitch
    // black at night (the failure that killed the Forge facade) while
    // the windows still carry the read
    brickNear: std({ map: brickNearTex, emissive: '#59331e', emissiveMap: brickNearTex, emissiveIntensity: 0.42, roughness: 0.94, metalness: 0 }),
    brickFar: std({ map: brickFarTex, color: '#8d97a8', emissive: '#2c1a10', emissiveMap: brickFarTex, emissiveIntensity: 0.30, roughness: 0.97, metalness: 0 }),
    stoneTrim: std({ color: '#3d3a38', roughness: 0.9, metalness: 0 }),
    litWin: std({ map: litWinTex, emissive: '#ffb45e', emissiveMap: litWinTex, emissiveIntensity: 1.7, roughness: 0.4, metalness: 0 }),
    darkWin: std({ map: darkWinTex, roughness: 0.16, metalness: 0.55 }),
    concrete: std({ map: concreteTex, roughness: 0.94, metalness: 0 }),
    curb: std({ color: '#3f3d3a', roughness: 0.95, metalness: 0 }),
    asphalt: std({ map: asphaltTex, roughness: 0.46, metalness: 0.12 }),
    tire: std({ color: '#0a0a0a', roughness: 0.92, metalness: 0 }),
    lampMetal: std({ color: '#0b0b0d', roughness: 0.5, metalness: 0.6 }),
    grillBlack: std({ color: '#0d0d0f', roughness: 0.34, metalness: 0.35, side: DoubleSide }),
    grate: std({ map: grateTex, transparent: true, alphaTest: 0.35, color: '#9a9da2', roughness: 0.42, metalness: 0.8, side: DoubleSide }),
    crateBlack: std({ color: '#121215', roughness: 0.82, metalness: 0 }),
    crateBlue: std({ color: '#274b63', roughness: 0.82, metalness: 0 }),
    plank: std({ map: plankTex, roughness: 0.85, metalness: 0 }),
    darkWood: std({ color: '#4a341e', roughness: 0.85, metalness: 0 }),
    oliveTop: std({ color: '#565a41', roughness: 0.6, metalness: 0.05 }),
    puddle: std({ color: '#0c1420', roughness: 0.06, metalness: 0.9 }),
    // promo-look pass (2026-10-29): the plastered walls keep a whisper
    // of emissive like the brick so they never read pitch black
    posterA: std({ map: posterTexA, emissive: '#4a3423', emissiveMap: posterTexA, emissiveIntensity: 0.5, roughness: 0.95, metalness: 0 }),
    posterB: std({ map: posterTexB, emissive: '#3c2a1e', emissiveMap: posterTexB, emissiveIntensity: 0.45, roughness: 0.95, metalness: 0 }),
    rentNotice: std({ map: rentNoticeTex, emissive: '#8b93a8', emissiveMap: rentNoticeTex, emissiveIntensity: 0.4, roughness: 0.9, metalness: 0 }),
    graffiti: new MeshBasicMaterial({ map: graffitiTex, transparent: true, opacity: 0.92 }),
    neonSign: new MeshBasicMaterial({ map: neonTex, transparent: true, blending: AdditiveBlending, depthWrite: false }),
    storeSign: std({ map: storeSignTex, emissive: '#d8a04e', emissiveMap: storeSignTex, emissiveIntensity: 0.55, roughness: 0.6, metalness: 0 }),
    bladeSign: std({ map: bladeSignTex, emissive: '#c33d24', emissiveMap: bladeSignTex, emissiveIntensity: 0.7, roughness: 0.6, metalness: 0 }),
    awning: std({ map: awningTex, roughness: 0.85, metalness: 0, side: DoubleSide }),
    cloth: std({ map: clothTex, roughness: 0.9, metalness: 0 }),
    storeDark: std({ color: '#14161a', roughness: 0.55, metalness: 0.35 }),
    canMetal: std({ color: '#676c72', roughness: 0.48, metalness: 0.8 }),
    cardboard: std({ color: '#7d5f38', roughness: 1, metalness: 0 }),
    trashBag: std({ color: '#0b0c0f', roughness: 0.42, metalness: 0.08 }),
    carFar: std({ color: '#0a0c11', roughness: 0.38, metalness: 0.6 }),
    tailLight: std({ color: '#1c0505', emissive: '#ff2015', emissiveIntensity: 3.2, roughness: 0.4, metalness: 0 }),
    bikeTeal: std({ color: '#2e5f5a', roughness: 0.5, metalness: 0.6 }),
    bikeDark: std({ color: '#33363e', roughness: 0.55, metalness: 0.55 }),
    snackRed: std({ color: '#c23b2e', roughness: 0.7, metalness: 0 }),
    cupRed: std({ color: '#b3232a', roughness: 0.5, metalness: 0.05 }),
  };
  return { mats, glowTex };
}

/* ------------------------------------------------------------------ */
/* Folding chairs — tube X-frame construction, owner's scale:          */
/* total H ≈ 0.90, seat top ≈ 0.49 (the 0.82 fit read "a lil small").  */
/* Local space: floor at y = 0, chair faces +z.                        */
/* ------------------------------------------------------------------ */

function chairFrameGeo(): BufferGeometry {
  const parts: G[] = [];
  for (const sx of [-1, 1]) {
    const xr = 0.205 * sx, xf = 0.215 * sx;
    // rear uprights: floor → backrest top, one continuous tube (the
    // classic folding-chair leg that becomes the back post)
    parts.push(tube([xr, 0.012, -0.195], [0.185 * sx, 0.905, -0.262], 0.0115));
    // front legs
    parts.push(tube([xf, 0.012, 0.20], [0.20 * sx, 0.478, 0.172], 0.0115));
    // seat side rails
    parts.push(tube([0.20 * sx, 0.468, 0.185], [0.20 * sx, 0.468, -0.185], 0.0105));
    // X brace on each side
    parts.push(tube([0.212 * sx, 0.05, 0.19], [0.20 * sx, 0.44, -0.175], 0.0095));
    // glide feet
    parts.push(box(0.05, 0.02, 0.065, xf, 0.01, 0.20));
    parts.push(box(0.05, 0.02, 0.065, xr, 0.01, -0.195));
  }
  // cross bars: front stretcher, backrest top rail, under-seat rear bar
  parts.push(tube([-0.20, 0.16, 0.19], [0.20, 0.16, 0.19], 0.0095));
  parts.push(tube([-0.185, 0.895, -0.258], [0.185, 0.895, -0.258], 0.0115));
  parts.push(tube([-0.20, 0.468, -0.185], [0.20, 0.468, -0.185], 0.0105));
  return merged(parts);
}

function chairPanelGeo(): BufferGeometry {
  return merged([
    box(0.43, 0.028, 0.40, 0, 0.478, 0), // seat — top at 0.492
    box(0.43, 0.23, 0.024, 0, 0.775, -0.2435, -0.10), // backrest, slight recline
  ]);
}

function FoldingChairs() {
  const { mats } = assets();
  const frame = useMemo(chairFrameGeo, []);
  const panels = useMemo(chairPanelGeo, []);
  return (
    <group>
      {CHAIR_SPOTS.map((s, i) => (
        <group key={i} position={[s.x, FLOOR_Y, s.z]} rotation={[0, s.ry, 0]}>
          <mesh geometry={frame} material={mats.steelBlack} castShadow receiveShadow />
          <mesh geometry={panels} material={mats.chairPanel} castShadow receiveShadow />
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Black metal picket fence (owner photo-directed style) — square      */
/* posts with caps, two rails, spear-tip pickets, real gaps. One       */
/* merged geometry for the whole 13.2 m run.                           */
/* ------------------------------------------------------------------ */

function picketFenceGeo(): BufferGeometry {
  const parts: G[] = [];
  const LEN = 13.2, X0 = -LEN / 2;
  const postXs: number[] = [];
  for (let x = X0; x <= LEN / 2 + 0.01; x += 2.2) postXs.push(x);
  for (const x of postXs) {
    parts.push(box(0.06, 1.19, 0.06, x, 0.595, 0));
    parts.push(box(0.078, 0.022, 0.078, x, 1.20, 0)); // flat cap
  }
  parts.push(box(LEN, 0.035, 0.03, 0, 0.26, 0));
  parts.push(box(LEN, 0.035, 0.03, 0, 0.94, 0));
  for (let x = X0 + 0.11; x < LEN / 2 - 0.05; x += 0.11) {
    if (postXs.some((p) => Math.abs(x - p) < 0.06)) continue;
    parts.push(box(0.016, 1.06, 0.016, x, 0.585, 0)); // picket: 0.055 → 1.115
    const tip = new ConeGeometry(0.0113, 0.05, 4);
    tip.rotateY(Math.PI / 4);
    tip.translate(x, 1.14, 0);
    parts.push(tip);
  }
  return merged(parts);
}

function PicketFence() {
  const { mats } = assets();
  const geo = useMemo(picketFenceGeo, []);
  return <mesh geometry={geo} material={mats.steelBlack} position={[0, FLOOR_Y, -3.6]} castShadow receiveShadow />;
}

/* ------------------------------------------------------------------ */
/* Parked sedan — THE ONE FORGE MIX in this room (owner route rule).   */
/* Loaded DECLARATIVELY (useLoader + Suspense + error boundary): the  */
/* sandbox gate caught the imperative host-group variant intermittently */
/* never rendering the car despite its loaded flag, and certified this */
/* pattern instead. Box3 fit-and-ground on a clone of the cached       */
/* scene: longest horizontal extent → 4.4 m, spot (3.0, FLOOR, -5.9)    */
/* across the street. A failed load renders nothing and names itself   */
/* on window.__pjsSedan, never a broken scene.                         */
/* ------------------------------------------------------------------ */

/** Minimal error boundary for the mixed-in Forge asset. */
class SedanBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch() {
    (window as unknown as { __pjsSedan?: unknown }).__pjsSedan = { loaded: false, slug: 'pjs-sedan' };
  }
  override render() { return this.state.failed ? null : this.props.children; }
}

function ForgeSedanModel({ blastRef }: { blastRef: { current: SedanBlastState } }) {
  const gltf = useLoader(GLTFLoader, SEDAN_URL);
  const obj = useMemo(() => {
    const o = gltf.scene.clone(true) as Group;
    o.updateMatrixWorld(true);
    const box = new Box3().setFromObject(o);
    const size = box.getSize(new Vector3());
    const longest = Math.max(size.x, size.z);
    if (longest > 0) o.scale.setScalar(4.4 / longest);
    o.rotation.y = Math.PI / 2;
    o.position.set(3.0, FLOOR_Y, -5.9);
    o.updateMatrixWorld(true);
    const grounded = new Box3().setFromObject(o);
    o.position.y += FLOOR_Y - grounded.min.y;
    o.traverse((n) => {
      const mesh = n as Mesh;
      if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
    });
    return o;
  }, [gltf]);
  useEffect(() => {
    (window as unknown as { __pjsSedan?: unknown }).__pjsSedan = { loaded: true, slug: 'pjs-sedan' };
  }, []);
  return <SedanFlight obj={obj} blastRef={blastRef} />;
}

/**
 * The sedan vs a detonation (owner, 2026-10-28: "if the nuke happens the car should
 * be blown off the table with everything else"). The parked pose is baked on the
 * model inside this group; the group carries the blast offset — launched radially
 * off its spot on the flash, tumbling into the fog, gone for the rest of the hand,
 * restored when the hand changes (the next deal). Pure pose/state in pjsSedanBlast.ts.
 */
function SedanFlight({ obj, blastRef }: { obj: Group; blastRef: { current: SedanBlastState } }) {
  const g = useRef<Group>(null);
  const dirtied = useRef(false);
  useFrame(() => {
    const grp = g.current;
    if (!grp) return;
    const w = window as unknown as { __pjsSedan?: Record<string, unknown> };
    const st = blastRef.current;
    if (st.phase === 'parked') {
      if (dirtied.current) {
        grp.position.set(0, 0, 0);
        grp.rotation.set(0, 0, 0);
        grp.visible = true;
        dirtied.current = false;
        if (w.__pjsSedan) w.__pjsSedan = { ...w.__pjsSedan, blast: { flying: false, off: 0, visible: true } };
      }
      return;
    }
    const u = (performance.now() - st.at) / 1000 - SEDAN_BLAST_FLASH_S;
    const pose = sedanBlastPoseAt(u, st);
    grp.position.set(pose.off[0], pose.off[1], pose.off[2]);
    grp.rotation.set(pose.rot[0], pose.rot[1], pose.rot[2]);
    grp.visible = pose.visible;
    dirtied.current = true;
    if (w.__pjsSedan) w.__pjsSedan = { ...w.__pjsSedan, blast: { flying: true, off: Math.round(Math.hypot(pose.off[0], pose.off[2]) * 100) / 100, visible: pose.visible } };
  });
  return (
    <group ref={g}>
      <primitive object={obj} />
    </group>
  );
}

function ForgeSedan({ handKey }: { handKey?: number }) {
  const { glowTex } = assets();
  const [blast, dispatch] = useReducer(sedanBlastReducer, { phase: 'parked' } as SedanBlastState);
  const blastRef = useRef(blast);
  blastRef.current = blast;
  // the detonation seam: the same fx event Nuke3D keys off — no nuke-system changes
  useEffect(() => fx.on((e) => {
    if (e.kind !== 'nuke' && e.kind !== 'mega') return;
    if (sedanBlastReaction(e.kind, fx.nukeMode) === 'none') return;
    dispatch({ type: 'blast', at: e.at, mega: e.kind === 'mega', calm: fx.osReducedMotion });
  }), []);
  // restore point: the next hand's deal (the recap covers the swap between hands)
  const prevHand = useRef(handKey);
  useEffect(() => {
    if (prevHand.current !== handKey) {
      prevHand.current = handKey;
      dispatch({ type: 'hand' });
    }
  }, [handKey]);
  return (
    <group>
      {/* soft ground blob so the car sits IN the street, not on it — it stays behind
          as the parking spot when the blast takes the car */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[3.0, FLOOR_Y + 0.006, -5.9]}>
        <planeGeometry args={[5.2, 2.5]} />
        <meshBasicMaterial map={glowTex} color="#000000" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <SedanBoundary>
        <Suspense fallback={null}>
          <ForgeSedanModel blastRef={blastRef} />
        </Suspense>
      </SedanBoundary>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Streetlight — tapered pole, shepherd's-crook tube, lamp head with   */
/* emissive lens + glow sprite, and the room's sodium spot. The        */
/* flicker is code: a mostly-steady burn, slow mains wobble, and a     */
/* rare hashed dip — deterministic in t. fxOn=false → steady burn.     */
/* ------------------------------------------------------------------ */

function flickerHash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

function Streetlight({ fxOn }: { fxOn: boolean }) {
  const { mats, glowTex } = assets();
  const spotRef = useRef<import('three').SpotLight>(null);
  const lensRef = useRef<MeshStandardMaterial>(null);
  const glowRef = useRef<SpriteMaterial>(null);
  const haloRef = useRef<SpriteMaterial>(null);
  const target = useMemo(() => new Group(), []);
  const geos = useMemo(() => {
    const metal = merged([
      cyl(0.17, 0.21, 0.30, 0, 0.15, 0, 18),          // base flare
      cyl(0.048, 0.072, 4.17, 0, 2.335, 0, 14),      // pole: 0.25 → 4.42
    ]);
    const curve = new CatmullRomCurve3([
      new Vector3(0, 4.32, 0), new Vector3(0.05, 4.56, 0),
      new Vector3(0.36, 4.73, 0), new Vector3(0.84, 4.80, 0),
      new Vector3(1.28, 4.76, 0),
    ]);
    const crook = new TubeGeometry(curve, 24, 0.042, 10);
    return { metal, crook };
  }, []);
  useFrame(({ clock }) => {
    if (!fxOn) return; // steady burn: initial intensities stand
    const t = clock.elapsedTime;
    const wobble = Math.sin(t * 31.7) * 0.5 + Math.sin(t * 17.3 + 1.7) * 0.35 + Math.sin(t * 3.1) * 0.15;
    let dip = 1;
    const cell = Math.floor(t * 1.4);
    if (flickerHash(cell) > 0.93) dip = 0.74 + 0.18 * (0.5 + 0.5 * Math.sin(t * 90));
    const f = (0.95 + 0.045 * wobble) * dip;
    if (spotRef.current) spotRef.current.intensity = 66 * f;
    if (lensRef.current) lensRef.current.emissiveIntensity = 3.0 * f;
    if (glowRef.current) glowRef.current.opacity = 0.34 * f;
    if (haloRef.current) haloRef.current.opacity = 0.16 * f;
  });
  return (
    <group position={[-3.5, FLOOR_Y, -3.0]}>
      <mesh geometry={geos.metal} material={mats.lampMetal} castShadow />
      <mesh geometry={geos.crook} material={mats.lampMetal} castShadow />
      <group position={[1.38, 4.70, 0]} rotation={[0, 0, -0.07]}>
        <mesh material={mats.lampMetal} castShadow>
          <boxGeometry args={[0.66, 0.13, 0.27]} />
        </mesh>
        <mesh position={[0, -0.075, 0]}>
          <boxGeometry args={[0.56, 0.03, 0.20]} />
          <meshStandardMaterial ref={lensRef} color="#3a2408" emissive="#ffb14e" emissiveIntensity={3} roughness={0.4} />
        </mesh>
      </group>
      <sprite position={[1.38, 4.62, 0]} scale={[2.3, 2.3, 1]}>
        <spriteMaterial ref={glowRef} map={glowTex} color="#ff9c3a" transparent opacity={0.34} blending={AdditiveBlending} depthWrite={false} />
      </sprite>
      {/* the promo's bloom: a wide, faint halo the haze gives the lamp
          (promo-look pass) — flickers with the same mains wobble */}
      <sprite position={[1.38, 4.62, 0]} scale={[6.8, 6.8, 1]}>
        <spriteMaterial ref={haloRef} map={glowTex} color="#ff9c3a" transparent opacity={0.16} blending={AdditiveBlending} depthWrite={false} />
      </sprite>
      <sprite position={[1.38, 4.62, 0]} scale={[0.85, 0.85, 1]}>
        <spriteMaterial map={glowTex} color="#ffd9a0" transparent opacity={0.5} blending={AdditiveBlending} depthWrite={false} />
      </sprite>
      {/* The pool belongs on the sidewalk in front of the lamp, NOT on
          the felt: the sandbox spot (175, wide, table-centred) flooded
          the production felt tan under the venue key light — the
          shipped Pj's table reads dark. Narrower, dimmer, ground-led:
          it rims the table's left rail and lights the fence base. */}
      <spotLight
        ref={spotRef}
        position={[1.38, 4.62, 0]}
        target={target}
        angle={0.62} penumbra={0.85} intensity={66}
        color="#ff9c3a" castShadow
        shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004}
      />
      {/* world target: the sidewalk patch left-front of the table
          (local = world − lamp pos) */}
      <primitive object={target} position={[2.2, 0, 0.9]} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Brick facades — box mass with the code brick texture, merged        */
/* window frames + lit/dark glass, parapet cap, optional fire escape.  */
/* ------------------------------------------------------------------ */

function BrickFacade({ x, z, w, h, seed, litRatio, far = false, fireEscape = false }:
  { x: number; z: number; w: number; h: number; seed: number; litRatio: number; far?: boolean; fireEscape?: boolean }) {
  const { mats } = assets();
  const win = useMemo(() => {
    const rnd = mulberry32(seed);
    const frames: G[] = [], lit: G[] = [], dark: G[] = [];
    const cols = Math.max(2, Math.round(w / 1.55));
    for (let y = 1.3; y < h - 0.8; y += 1.52) {
      for (let c = 0; c < cols; c++) {
        const wx = -w / 2 + (c + 0.5) * (w / cols);
        frames.push(box(1.0, 1.42, 0.07, wx, y, 0.21));
        const glass = new PlaneGeometry(0.88, 1.30);
        glass.translate(wx, y, 0.252);
        (rnd() < litRatio ? lit : dark).push(glass);
      }
    }
    return {
      frames: merged(frames),
      lit: lit.length ? merged(lit) : null,
      dark: dark.length ? merged(dark) : null,
    };
  }, [w, h, seed, litRatio]);
  const escape = useMemo(() => {
    if (!fireEscape) return null;
    const parts: G[] = [];
    for (const py of [2.0, 3.55]) {
      parts.push(box(2.6, 0.05, 0.85, -1.1, py, 0.62)); // deck
      for (const px of [-2.35, -1.1, 0.15]) parts.push(tube([px, py, 1.0], [px, py + 0.82, 1.0], 0.016));
      parts.push(tube([-2.4, py + 0.82, 1.0], [0.2, py + 0.82, 1.0], 0.016)); // top rail
      parts.push(tube([-2.4, py + 0.45, 1.0], [0.2, py + 0.45, 1.0], 0.013)); // mid rail
      parts.push(tube([-2.38, py, 0.62], [-2.38, py + 0.82, 1.0], 0.014));
      parts.push(tube([0.18, py, 0.62], [0.18, py + 0.82, 1.0], 0.014));
    }
    // diagonal stair, lower deck → upper deck
    parts.push(tube([0.3, 2.02, 0.38], [-2.0, 3.57, 0.38], 0.028));
    parts.push(tube([0.3, 2.02, 0.88], [-2.0, 3.57, 0.88], 0.028));
    for (let i = 1; i < 8; i++) {
      const f = i / 8;
      parts.push(box(0.26, 0.04, 0.58, 0.3 + (-2.3) * f, 2.02 + 1.55 * f, 0.63));
    }
    // drop ladder, lower deck → ground
    parts.push(tube([-2.32, 0.03, 0.62], [-2.32, 2.0, 0.62], 0.016));
    parts.push(tube([-2.02, 0.03, 0.62], [-2.02, 2.0, 0.62], 0.016));
    for (let y = 0.3; y < 1.95; y += 0.28) parts.push(box(0.30, 0.03, 0.03, -2.17, y, 0.62));
    return merged(parts);
  }, [fireEscape]);
  return (
    <group position={[x, FLOOR_Y, z]}>
      <mesh material={far ? mats.brickFar : mats.brickNear} position={[0, h / 2, 0]} receiveShadow>
        <boxGeometry args={[w, h, 0.4]} />
      </mesh>
      <mesh material={mats.stoneTrim} position={[0, h + 0.10, 0]}>
        <boxGeometry args={[w + 0.18, 0.24, 0.54]} />
      </mesh>
      <mesh geometry={win.frames} material={mats.stoneTrim} />
      {win.lit && <mesh geometry={win.lit} material={mats.litWin} />}
      {win.dark && <mesh geometry={win.dark} material={mats.darkWin} />}
      {escape && <mesh geometry={escape} material={mats.steelBlack} castShadow />}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Charcoal kettle grill + drifting sprite smoke (smoke is a scene     */
/* effect, never a solid mesh). Smoke renders only when fxOn.          */
/* ------------------------------------------------------------------ */

function Grill({ fxOn }: { fxOn: boolean }) {
  const { mats } = assets();
  const emberRef = useRef<MeshStandardMaterial>(null);
  const geos = useMemo(() => {
    const bowl = new SphereGeometry(0.34, 26, 13, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    bowl.translate(0, 0.55, 0); // rim at 0.55, belly down to 0.21
    const rim = new TorusGeometry(0.335, 0.013, 8, 40);
    rim.rotateX(Math.PI / 2); rim.translate(0, 0.55, 0);
    const body = merged([
      bowl, rim,
      tube([0.19, 0.30, -0.13], [0.27, 0.02, -0.21], 0.013),
      tube([-0.19, 0.30, -0.13], [-0.27, 0.02, -0.21], 0.013),
      tube([0, 0.30, 0.22], [0, 0.02, 0.31], 0.013),
      cyl(0.13, 0.10, 0.07, 0, 0.17, 0), // ash catcher
    ]);
    const lid = new SphereGeometry(0.345, 26, 13, 0, Math.PI * 2, 0, Math.PI / 2);
    return { body, lid };
  }, []);
  useFrame(({ clock }) => {
    if (!fxOn || !emberRef.current) return; // steady ember when effects off
    const t = clock.elapsedTime;
    emberRef.current.emissiveIntensity = 1.05 + 0.45 * (0.5 + 0.5 * Math.sin(t * 2.2)) * (0.72 + 0.28 * Math.sin(t * 7.7));
  });
  return (
    <group position={[3.7, FLOOR_Y, -2.1]} rotation={[0, -0.5, 0]}>
      <mesh geometry={geos.body} material={mats.grillBlack} castShadow receiveShadow />
      {/* ember bed under the grate — breathes when effects are on */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.475, 0]}>
        <circleGeometry args={[0.27, 26]} />
        <meshStandardMaterial ref={emberRef} color="#1a0d06" emissive="#ff5a1a" emissiveIntensity={1.2} roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.545, 0]} material={mats.grate}>
        <circleGeometry args={[0.325, 26]} />
      </mesh>
      {/* lid, hinged open behind the bowl */}
      <group position={[0, 0.55, -0.30]} rotation={[-1.92, 0, 0]}>
        <mesh geometry={geos.lid} material={mats.grillBlack} position={[0, 0.01, 0.03]} castShadow />
        <mesh position={[0, 0.35, 0.03]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.014, 0.014, 0.18, 8]} />
          <meshStandardMaterial color="#6d4c2c" roughness={0.8} />
        </mesh>
      </group>
      {/* leg wheels */}
      {[-0.27, 0.27].map((wx) => (
        <mesh key={wx} position={[wx, 0.05, -0.21]} rotation={[0, 0, Math.PI / 2]} material={mats.tire}>
          <cylinderGeometry args={[0.05, 0.05, 0.03, 14]} />
        </mesh>
      ))}
    </group>
  );
}

function GrillSmoke() {
  const { glowTex } = assets();
  const COUNT = 20;
  const sprites = useRef<(import('three').Sprite | null)[]>([]);
  const smokeMats = useMemo(
    () => Array.from({ length: COUNT }, () => new SpriteMaterial({
      map: glowTex, color: '#b3a48f', transparent: true, opacity: 0, depthWrite: false,
    })),
    [glowTex],
  );
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    for (let i = 0; i < COUNT; i++) {
      const sp = sprites.current[i];
      if (!sp) continue;
      const age = (t * 0.085 + i / COUNT) % 1; // ~12 s rise, deterministic
      sp.position.set(
        Math.sin(age * 5 + i * 1.7) * 0.09 + age * 0.5, // drifts +x on the night air
        0.80 + age * 1.9,
        Math.cos(age * 4 + i) * 0.06,
      );
      const s = 0.26 + age * 1.15;
      sp.scale.set(s, s, 1);
      smokeMats[i]!.opacity = 0.24 * Math.pow(Math.sin(Math.PI * Math.min(age, 1)), 1.3);
    }
  });
  return (
    <group position={[3.7, FLOOR_Y, -2.1]}>
      {smokeMats.map((m, i) => (
        <sprite key={i} ref={(el) => { sprites.current[i] = el; }} material={m} />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Crates — milk crates as real code lattice; wooden crates as planked */
/* boxes with batten frames.                                           */
/* ------------------------------------------------------------------ */

function milkCrateGeo(): BufferGeometry {
  const parts: G[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push(box(0.03, 0.28, 0.03, 0.15 * sx, 0.14, 0.15 * sz)); // corner posts
  }
  for (const sz of [-1, 1]) {
    parts.push(box(0.33, 0.035, 0.03, 0, 0.2625, 0.15 * sz)); // top rim
    parts.push(box(0.33, 0.03, 0.03, 0, 0.015, 0.15 * sz));    // bottom rim
    parts.push(box(0.33, 0.025, 0.018, 0, 0.14, 0.15 * sz));  // mid band
    for (const bx of [-0.075, 0, 0.075]) parts.push(box(0.018, 0.21, 0.018, bx, 0.14, 0.15 * sz));
  }
  for (const sx of [-1, 1]) {
    parts.push(box(0.03, 0.035, 0.33, 0.15 * sx, 0.2625, 0));
    parts.push(box(0.03, 0.03, 0.33, 0.15 * sx, 0.015, 0));
    parts.push(box(0.018, 0.025, 0.33, 0.15 * sx, 0.14, 0));
    for (const bz of [-0.075, 0, 0.075]) parts.push(box(0.018, 0.21, 0.018, 0.15 * sx, 0.14, bz));
  }
  for (const bz of [-0.1, 0, 0.1]) parts.push(box(0.30, 0.015, 0.04, 0, 0.012, bz)); // floor slats
  return merged(parts);
}

function Crates() {
  const { mats } = assets();
  const milk = useMemo(milkCrateGeo, []);
  const battens = useMemo(() => merged([
    ...([-1, 1] as const).flatMap((sx) => ([-1, 1] as const).map((sz) =>
      box(0.055, 0.45, 0.055, 0.20 * sx, 0.225, 0.20 * sz))),
    box(0.45, 0.05, 0.05, 0, 0.425, 0.20), box(0.45, 0.05, 0.05, 0, 0.425, -0.20),
    box(0.45, 0.05, 0.05, 0, 0.025, 0.20), box(0.45, 0.05, 0.05, 0, 0.025, -0.20),
    box(0.05, 0.05, 0.45, 0.20, 0.425, 0), box(0.05, 0.05, 0.45, -0.20, 0.425, 0),
    box(0.05, 0.05, 0.45, 0.20, 0.025, 0), box(0.05, 0.05, 0.45, -0.20, 0.025, 0),
  ]), []);
  return (
    <group>
      {/* milk crates along the fence line */}
      <mesh geometry={milk} material={mats.crateBlack} position={[-4.3, FLOOR_Y, -3.1]} rotation={[0, 0.3, 0]} castShadow receiveShadow />
      <mesh geometry={milk} material={mats.crateBlack} position={[-4.3, FLOOR_Y + 0.28, -3.1]} rotation={[0, -0.15, 0]} castShadow />
      <mesh geometry={milk} material={mats.crateBlue} position={[-3.82, FLOOR_Y, -2.72]} rotation={[0, 0.9, 0]} castShadow receiveShadow />
      {/* wooden crates, right of the fence line */}
      {[0, 1].map((i) => (
        <group key={i} position={[4.32 - i * 0.05, FLOOR_Y + i * 0.45, -3.02 + i * 0.04]} rotation={[0, -0.35 + i * 0.55, 0]}>
          <mesh material={mats.plank} position={[0, 0.225, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.45, 0.45, 0.45]} />
          </mesh>
          <mesh geometry={battens} material={mats.darkWood} castShadow />
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* The poster's folding side table — dressing hero, front-left.        */
/* ------------------------------------------------------------------ */

function SideTable() {
  const { mats } = assets();
  const frame = useMemo(() => merged([
    tube([-0.5, 0.01, 0.24], [-0.5, 0.715, -0.24], 0.014),
    tube([-0.5, 0.01, -0.24], [-0.5, 0.715, 0.24], 0.014),
    tube([0.5, 0.01, 0.24], [0.5, 0.715, -0.24], 0.014),
    tube([0.5, 0.01, -0.24], [0.5, 0.715, 0.24], 0.014),
    tube([-0.5, 0.30, 0], [0.5, 0.30, 0], 0.011),
  ]), []);
  return (
    <group position={[-3.1, FLOOR_Y, -1.2]} rotation={[0, 0.45, 0]}>
      <mesh geometry={frame} material={mats.steelBlack} castShadow />
      <mesh material={mats.tableBody} position={[0, 0.70, 0]}>
        <boxGeometry args={[1.1, 0.03, 0.5]} />
      </mesh>
      {/* the promo table's loud cloth, worn by the DRESSING side table
          only — the play surface and its felt are never touched */}
      <mesh material={mats.cloth} position={[0, 0.735, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.035, 0.6]} />
      </mesh>
      {/* tabletop clutter on the cloth: a red cup + a snack box */}
      <mesh material={mats.cupRed} position={[0.28, 0.798, 0.08]} castShadow>
        <cylinderGeometry args={[0.036, 0.028, 0.09, 12]} />
      </mesh>
      <mesh material={mats.snackRed} position={[-0.22, 0.778, -0.04]} rotation={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[0.17, 0.05, 0.12]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Ground — sidewalk slab, curb, wet asphalt street, puddles, far fill */
/* ------------------------------------------------------------------ */

function Ground() {
  const { mats, glowTex } = assets();
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y + 0.002, 0.55]} material={mats.concrete} receiveShadow>
        <planeGeometry args={[17.5, 7.9]} />
      </mesh>
      <mesh position={[0, FLOOR_Y + 0.012, -3.44]} material={mats.curb} receiveShadow>
        <boxGeometry args={[17.5, 0.05, 0.22]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, -8.85]} material={mats.asphalt} receiveShadow>
        <planeGeometry args={[28, 10.8]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y - 0.01, -18]}>
        <planeGeometry args={[46, 9]} />
        <meshStandardMaterial color="#0a0b0f" roughness={1} />
      </mesh>
      {/* puddles: near-mirror dark ellipses that catch the sodium spot */}
      {([[-1.6, -5.2, 2.2, 1.1, 0.4], [5.6, -7.8, 1.6, 0.9, 1.1], [-5.5, -9.5, 1.3, 0.7, 0.2]] as const).map(([px, pz, sx, sz, r], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, r]} scale={[sx, sz, 1]} position={[px, FLOOR_Y + 0.004, pz]} material={mats.puddle}>
          <circleGeometry args={[0.5, 26]} />
        </mesh>
      ))}
      {/* fake sodium streak on the wet street under the lamp */}
      <mesh rotation={[-Math.PI / 2, 0, 0.45]} position={[-2.45, FLOOR_Y + 0.006, -5.4]}>
        <planeGeometry args={[0.9, 3.2]} />
        <meshBasicMaterial map={glowTex} color="#ff9c3a" transparent opacity={0.13} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* manhole */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.6, FLOOR_Y + 0.003, -6.8]}>
        <circleGeometry args={[0.36, 26]} />
        <meshStandardMaterial color="#101114" roughness={0.6} metalness={0.4} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Poster walls + graffiti (promo-look pass) — plastered over the      */
/* brick at a proud z-ladder (wall face −8.00, glass −7.948, posters   */
/* −7.93, graffiti −7.905, notice −7.90) so nothing sits coplanar.     */
/* ------------------------------------------------------------------ */

function PosterWalls() {
  const { mats } = assets();
  return (
    <group>
      {/* the plastered band behind the game, left facade */}
      <mesh material={mats.posterA} position={[-3.7, FLOOR_Y + 1.12, -7.93]}>
        <planeGeometry args={[6.6, 2.1]} />
      </mesh>
      {/* right facade: patches either side of the storefront */}
      <mesh material={mats.posterA} position={[6.55, FLOOR_Y + 1.05, -7.93]}>
        <planeGeometry args={[1.75, 1.95]} />
      </mesh>
      <mesh material={mats.posterB} position={[0.5, FLOOR_Y + 1.0, -7.93]}>
        <planeGeometry args={[0.95, 1.85]} />
      </mesh>
      {/* the one legible notice, pinned over the plaster */}
      <mesh material={mats.rentNotice} position={[-0.55, FLOOR_Y + 1.4, -7.90]} rotation={[0, 0, 0.02]}>
        <planeGeometry args={[0.52, 0.69]} />
      </mesh>
      {/* far facade band, hazed by the fog */}
      <mesh material={mats.posterB} position={[-3.4, FLOOR_Y + 1.25, -14.22]}>
        <planeGeometry args={[7.4, 2.3]} />
      </mesh>
      {/* graffiti tags over brick and plaster alike */}
      <mesh material={mats.graffiti} position={[3.1, FLOOR_Y + 2.95, -7.905]}>
        <planeGeometry args={[4.6, 1.15]} />
      </mesh>
      <mesh material={mats.graffiti} position={[-5.0, FLOOR_Y + 0.62, -7.905]}>
        <planeGeometry args={[3.4, 0.85]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* The liquor store (promo-look pass) — the street's anchor tenant:    */
/* a storefront bay on the right facade with barred glass, a blue/red  */
/* neon window sign with real spill light, painted band + blade        */
/* signs, and a striped awning.                                        */
/* ------------------------------------------------------------------ */

function LiquorStore() {
  const { mats, glowTex } = assets();
  const bars = useMemo(() => {
    const parts: G[] = [];
    for (let x = 1.52; x <= 4.5; x += 0.135) parts.push(box(0.022, 2.2, 0.022, x, FLOOR_Y + 1.28, -7.345));
    parts.push(box(3.1, 0.03, 0.03, 3.0, FLOOR_Y + 0.5, -7.345));
    parts.push(box(3.1, 0.03, 0.03, 3.0, FLOOR_Y + 2.06, -7.345));
    return merged(parts);
  }, []);
  const rods = useMemo(() => merged([
    tube([1.35, FLOOR_Y + 3.3, -7.9], [1.35, FLOOR_Y + 2.7, -6.42], 0.011),
    tube([5.55, FLOOR_Y + 3.3, -7.9], [5.55, FLOOR_Y + 2.7, -6.42], 0.011),
  ]), []);
  return (
    <group>
      {/* storefront bay, proud of the right facade (face −8.0 → −7.36) */}
      <mesh material={mats.storeDark} position={[3.45, FLOOR_Y + 1.55, -7.68]} castShadow receiveShadow>
        <boxGeometry args={[4.7, 3.1, 0.64]} />
      </mesh>
      <mesh material={mats.darkWin} position={[3.0, FLOOR_Y + 1.28, -7.352]}>
        <planeGeometry args={[3.1, 2.2]} />
      </mesh>
      <mesh geometry={bars} material={mats.steelBlack} />
      {/* the neon, glowing in the window */}
      <mesh material={mats.neonSign} position={[3.0, FLOOR_Y + 1.32, -7.33]}>
        <planeGeometry args={[1.8, 1.12]} />
      </mesh>
      {/* door + push bar */}
      <mesh material={mats.storeDark} position={[5.12, FLOOR_Y + 1.14, -7.40]} castShadow>
        <boxGeometry args={[0.94, 2.28, 0.07]} />
      </mesh>
      <mesh material={mats.canMetal} position={[5.12, FLOOR_Y + 1.05, -7.35]}>
        <boxGeometry args={[0.7, 0.035, 0.03]} />
      </mesh>
      {/* painted band sign */}
      <mesh material={mats.storeDark} position={[3.45, FLOOR_Y + 3.42, -7.60]}>
        <boxGeometry args={[4.95, 0.68, 0.18]} />
      </mesh>
      <mesh material={mats.storeSign} position={[3.45, FLOOR_Y + 3.42, -7.50]}>
        <planeGeometry args={[4.95, 0.68]} />
      </mesh>
      {/* blade sign, perpendicular to the wall, lettered both faces */}
      <mesh material={mats.storeDark} position={[1.06, FLOOR_Y + 3.62, -7.52]}>
        <boxGeometry args={[0.14, 1.78, 0.66]} />
      </mesh>
      <mesh material={mats.bladeSign} position={[1.135, FLOOR_Y + 3.62, -7.52]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[0.66, 1.78]} />
      </mesh>
      <mesh material={mats.bladeSign} position={[0.985, FLOOR_Y + 3.62, -7.52]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[0.66, 1.78]} />
      </mesh>
      <mesh geometry={rods} material={mats.steelBlack} />
      {/* striped awning, front edge dropped toward the street */}
      <mesh material={mats.awning} position={[3.45, FLOOR_Y + 2.83, -6.81]} rotation={[0.38, 0, 0]} castShadow>
        <boxGeometry args={[4.95, 0.05, 1.18]} />
      </mesh>
      {/* neon spill: blue key from the window sign, red accent, warm
          under-awning pool — short throws, no shadows */}
      <pointLight position={[3.0, FLOOR_Y + 1.35, -6.75]} intensity={18} distance={6.5} decay={2} color="#4d8dff" />
      <pointLight position={[4.5, FLOOR_Y + 1.1, -6.8]} intensity={5} distance={4.5} decay={2} color="#ff4030" />
      <pointLight position={[3.45, FLOOR_Y + 2.45, -6.9]} intensity={8} distance={5} decay={2} color="#ffb14e" />
      {/* the spill painted on the ground in front of the store */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[3.0, FLOOR_Y + 0.008, -6.45]}>
        <planeGeometry args={[3.4, 2.3]} />
        <meshBasicMaterial map={glowTex} color="#4d8dff" transparent opacity={0.22} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[4.5, FLOOR_Y + 0.011, -6.6]}>
        <planeGeometry args={[1.3, 1.0]} />
        <meshBasicMaterial map={glowTex} color="#ff4030" transparent opacity={0.16} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[3.45, FLOOR_Y + 0.01, -6.9]}>
        <planeGeometry args={[3.6, 1.6]} />
        <meshBasicMaterial map={glowTex} color="#ffb14e" transparent opacity={0.12} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Laundry lines (promo-look pass) — sagging lines strung between      */
/* the facades and to the streetlight pole, garments as vertex-        */
/* coloured planes hanging from the line. All high over the street:    */
/* nothing crosses the standing view near the table.                   */
/* ------------------------------------------------------------------ */

function sagPoint(a: [number, number, number], b: [number, number, number], sag: number, t: number): Vector3 {
  const p = new Vector3(...a).lerp(new Vector3(...b), t);
  p.y -= sag * 4 * t * (1 - t);
  return p;
}

function LaundryLines() {
  const { mats } = assets();
  const { lines, cloth } = useMemo(() => {
    const rnd = mulberry32(2029);
    const palette = ['#cfc8b8', '#8a4a3a', '#4a5a78', '#777d84', '#b8a86a', '#5d7052'];
    const specs: { a: [number, number, number]; b: [number, number, number]; sag: number; items: [number, number, number][] }[] = [
      { // the long cross-street line along the facade fronts
        a: [-6.9, FLOOR_Y + 5.0, -7.85], b: [6.9, FLOOR_Y + 4.72, -7.85], sag: 0.5,
        items: [[0.08, 0.8, 0.7], [0.2, 0.44, 0.55], [0.33, 0.52, 0.6], [0.47, 0.85, 0.72], [0.6, 0.4, 0.5], [0.72, 0.55, 0.62], [0.84, 0.44, 0.52], [0.93, 0.7, 0.66]],
      },
      { // facade → streetlight pole, over the sidewalk's far edge
        a: [-0.3, FLOOR_Y + 4.5, -7.85], b: [-3.42, FLOOR_Y + 4.3, -3.12], sag: 0.3,
        items: [[0.25, 0.5, 0.55], [0.52, 0.42, 0.5], [0.76, 0.62, 0.6]],
      },
      { // off to the far facade, for depth
        a: [6.9, FLOOR_Y + 4.85, -7.85], b: [2.0, FLOOR_Y + 5.3, -14.2], sag: 0.42,
        items: [[0.2, 0.55, 0.6], [0.45, 0.44, 0.5], [0.7, 0.66, 0.64]],
      },
    ];
    const lineGeos: G[] = [];
    const clothGeos: G[] = [];
    for (const spec of specs) {
      const pts: Vector3[] = [];
      for (let i = 0; i <= 8; i++) pts.push(sagPoint(spec.a, spec.b, spec.sag, i / 8));
      lineGeos.push(new TubeGeometry(new CatmullRomCurve3(pts), 32, 0.008, 6));
      const dir = new Vector3(...spec.b).sub(new Vector3(...spec.a));
      const ry = Math.atan2(dir.x, dir.z) - Math.PI / 2;
      for (const [t, w, h] of spec.items) {
        const g = new PlaneGeometry(w, h);
        g.translate(0, -h / 2, 0); // hang from the top edge
        const col = new Color(palette[Math.floor(rnd() * palette.length)]!);
        const n = g.attributes.position!.count;
        const colors = new Float32Array(n * 3);
        for (let v = 0; v < n; v++) {
          colors[v * 3] = col.r;
          colors[v * 3 + 1] = col.g;
          colors[v * 3 + 2] = col.b;
        }
        g.setAttribute('color', new Float32BufferAttribute(colors, 3));
        g.rotateY(ry + (rnd() - 0.5) * 0.2);
        g.rotateZ((rnd() - 0.5) * 0.07);
        const p = sagPoint(spec.a, spec.b, spec.sag, t);
        g.translate(p.x, p.y, p.z);
        clothGeos.push(g);
      }
    }
    return { lines: merged(lineGeos), cloth: merged(clothGeos) };
  }, []);
  const clothMat = useMemo(
    () => new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: DoubleSide }),
    [],
  );
  return (
    <group>
      <mesh geometry={lines} material={mats.lampMetal} />
      <mesh geometry={cloth} material={clothMat} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Fence-line + curb dressing (promo-look pass): two bicycles leaning  */
/* on the picket fence, a trash corner, flattened cardboard.           */
/* ------------------------------------------------------------------ */

function bikeGeo(): BufferGeometry {
  const parts: G[] = [];
  for (const wx of [-0.52, 0.52]) {
    const wheel = new TorusGeometry(0.335, 0.016, 8, 28);
    wheel.translate(wx, 0.335, 0);
    parts.push(wheel);
  }
  parts.push(tube([-0.52, 0.335, 0], [-0.05, 0.30, 0], 0.016)); // chain stay
  parts.push(tube([-0.52, 0.335, 0], [-0.18, 0.78, 0], 0.016)); // seat stay
  parts.push(tube([-0.18, 0.78, 0], [-0.05, 0.30, 0], 0.018)); // seat tube
  parts.push(tube([-0.18, 0.80, 0], [0.40, 0.74, 0], 0.018));  // top tube
  parts.push(tube([-0.05, 0.30, 0], [0.42, 0.72, 0], 0.018));  // down tube
  parts.push(tube([0.42, 0.72, 0], [0.52, 0.335, 0], 0.014));  // fork
  parts.push(tube([0.40, 0.74, 0], [0.44, 0.86, 0], 0.014));   // stem
  parts.push(tube([0.44, 0.86, -0.16], [0.44, 0.86, 0.16], 0.013)); // bars
  parts.push(box(0.22, 0.05, 0.09, -0.20, 0.82, 0));           // saddle
  return merged(parts);
}

function Bicycles() {
  const { mats } = assets();
  const geo = useMemo(bikeGeo, []);
  return (
    <group>
      <mesh geometry={geo} material={mats.bikeTeal} position={[-5.35, FLOOR_Y + 0.016, -3.40]} rotation={[-0.15, 0.04, 0]} castShadow />
      <mesh geometry={geo} material={mats.bikeDark} position={[5.78, FLOOR_Y + 0.016, -3.38]} rotation={[-0.13, -0.07, 0]} castShadow />
    </group>
  );
}

function TrashCorner() {
  const { mats } = assets();
  const can = useMemo(() => {
    const rim = new TorusGeometry(0.30, 0.02, 8, 24);
    rim.rotateX(Math.PI / 2);
    rim.translate(0, 0.80, 0);
    return merged([cyl(0.30, 0.265, 0.80, 0, 0.40, 0, 18), rim]);
  }, []);
  const bags = useMemo(() => {
    const b1 = new SphereGeometry(0.30, 12, 10);
    b1.scale(1, 0.78, 1);
    b1.translate(5.52, FLOOR_Y + 0.22, -3.22);
    const knot = new ConeGeometry(0.07, 0.13, 8);
    knot.translate(5.52, FLOOR_Y + 0.48, -3.22);
    const b2 = new SphereGeometry(0.24, 12, 10);
    b2.scale(1, 0.8, 1);
    b2.translate(4.48, FLOOR_Y + 0.18, -2.72);
    return merged([b1, knot, b2]);
  }, []);
  const cardboard = useMemo(() => merged([
    box(0.78, 0.55, 0.016, -4.78, FLOOR_Y + 0.29, -3.46, -0.30, 0.05, 0),
    box(0.60, 0.42, 0.016, -4.30, FLOOR_Y + 0.23, -3.42, -0.32, -0.15, 0),
    box(0.7, 0.014, 0.5, -4.55, FLOOR_Y + 0.012, -2.85),
  ]), []);
  return (
    <group>
      <mesh geometry={can} material={mats.canMetal} position={[4.95, FLOOR_Y, -3.02]} castShadow receiveShadow />
      {/* the can's lid, slid half off and leaning */}
      <mesh material={mats.canMetal} position={[5.29, FLOOR_Y + 0.72, -2.90]} rotation={[0.3, 0, 0.9]} castShadow>
        <cylinderGeometry args={[0.315, 0.315, 0.045, 18]} />
      </mesh>
      <mesh geometry={bags} material={mats.trashBag} castShadow />
      <mesh geometry={cardboard} material={mats.cardboard} castShadow receiveShadow />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* A car down the block (promo-look pass) — silhouette + taillights    */
/* for depth. The parked sedan across the street stays the hero car.   */
/* ------------------------------------------------------------------ */

function DistantCar() {
  const { mats, glowTex } = assets();
  const body = useMemo(() => merged([
    box(1.72, 0.62, 4.3, 0, 0.56, 0),
    box(1.54, 0.52, 2.1, 0, 1.10, -0.25),
  ]), []);
  const lights = useMemo(() => merged([
    box(0.30, 0.10, 0.04, -0.55, 0.74, 2.16),
    box(0.30, 0.10, 0.04, 0.55, 0.74, 2.16),
  ]), []);
  const tailGlow = useMemo(() => new SpriteMaterial({
    map: glowTex, color: '#ff3020', transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false,
  }), [glowTex]);
  return (
    <group position={[-10.6, FLOOR_Y, -10.6]} rotation={[0, 0.42, 0]}>
      <mesh geometry={body} material={mats.carFar} />
      <mesh geometry={lights} material={mats.tailLight} />
      {[-0.55, 0.55].map((lx) => (
        <sprite key={lx} material={tailGlow} position={[lx, 0.74, 2.34]} scale={[0.75, 0.75, 1]} />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Night haze (promo-look pass) — big soft veils across the street     */
/* plus warm smoke-glow around the streetlight: the atmosphere the     */
/* promo's bloom reads through.                                        */
/* ------------------------------------------------------------------ */

function HazeVeils() {
  const { glowTex } = assets();
  const veils: [number, number, number, number, number, string][] = [
    [-4.5, FLOOR_Y + 2.6, -6.2, 7.5, 0.055, '#93a7cc'],
    [1.5, FLOOR_Y + 3.3, -7.6, 9.5, 0.05, '#8b93ad'],
    [5.8, FLOOR_Y + 2.2, -6.0, 6.5, 0.06, '#a8b2c9'],
    [-7.5, FLOOR_Y + 3.7, -9.5, 11, 0.045, '#7e8cae'],
    [0.5, FLOOR_Y + 4.1, -11, 12, 0.04, '#76839f'],
    // warm smoke catching the streetlight — the promo's bloom cloud
    [-2.0, FLOOR_Y + 4.6, -3.3, 4.6, 0.085, '#c99a5e'],
    [-1.0, FLOOR_Y + 3.9, -3.9, 3.4, 0.065, '#c99a5e'],
    // low veils over the street itself — these sit inside the game
    // cameras' backdrop band, where the high facade dressing cannot
    [-0.5, FLOOR_Y + 2.5, -4.6, 8, 0.05, '#93a7cc'],
    [2.8, FLOOR_Y + 2.3, -5.2, 6.5, 0.05, '#c99a5e'],
  ];
  return (
    <group>
      {veils.map(([x, y, z, s, o, c], i) => (
        <sprite key={i} position={[x, y, z]} scale={[s, s, 1]}>
          <spriteMaterial map={glowTex} color={c} transparent opacity={o} depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Fog — the street's depth cue (the sandbox room's recipe). Save/     */
/* restore on unmount, the Backdrop component's discipline, so no      */
/* other venue ever inherits it.                                       */
/* ------------------------------------------------------------------ */

function EnvFog() {
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const prev = scene.fog;
    scene.fog = new Fog('#060a16', 12, 27);
    invalidate();
    return () => { scene.fog = prev; invalidate(); };
  }, [scene, invalidate]);
  return null;
}

/* ------------------------------------------------------------------ */

export default function PjsStreetRoom({ fxOn, handKey }: { fxOn: boolean; handKey?: number }) {
  return (
    <group>
      <EnvFog />
      <FoldingChairs />
      <PicketFence />
      <ForgeSedan handKey={handKey} />
      <Streetlight fxOn={fxOn} />
      <BrickFacade x={-3.6} z={-8.2} w={7.4} h={5.6} seed={11} litRatio={0.5} fireEscape />
      <BrickFacade x={3.7} z={-8.2} w={7.4} h={5.6} seed={23} litRatio={0.30} />
      <BrickFacade x={0} z={-14.5} w={18} h={7} seed={47} litRatio={0.20} far />
      <Grill fxOn={fxOn} />
      {fxOn && <GrillSmoke />}
      <Crates />
      <SideTable />
      <Ground />
      {/* promo-look pass (2026-10-29): store, plastered walls, laundry,
          fence-line clutter, depth car, haze */}
      <PosterWalls />
      <LiquorStore />
      <LaundryLines />
      <Bicycles />
      <TrashCorner />
      <DistantCar />
      <HazeVeils />
      {/* an off-frame streetlight to the right — its cool spill is
          what models the parked sedan across the street (the sandbox
          gate's 26 read marginal in this scene's dimmer rig; 44 gives
          the car's bodywork a fighting chance without touching the
          asset) */}
      <pointLight position={[6.5, 2.4, -4.2]} intensity={44} distance={11} decay={2} color="#7d94c9" />
      {/* cool night fill for the environment's own surfaces — the
          venue rig's hemisphere is tuned for the table; this lifts the
          street/facades to the sandbox room's legibility without
          warming the felt (colour stays on the blue side) */}
      <hemisphereLight args={['#33456e', '#0a0c10', 0.3]} />
    </group>
  );
}

export { SEDAN_URL };
