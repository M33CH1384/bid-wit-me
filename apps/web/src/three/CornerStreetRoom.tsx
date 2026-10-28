/**
 * THE CORNER — STREET ENVIRONMENT (production, rooms pipeline
 * Batch 2, owner route 2026-10-28: code-first, mix when necessary;
 * "roll them all in as they become ready").
 *
 * The code-built Corner room from the immersive sandbox, ported
 * into the live game. Story-scoped mounting ONLY: Scene renders
 * this room when the table carries story stop `corner` (Stop 5,
 * Smoke & Redd) at High quality, in place of SpeakeasyRoom. The
 * production `speakeasy` venue — the selectable Speakeasy Lounge —
 * is a different place and is untouched at both qualities, as are
 * non-story tables and the Corner at Low (SpeakeasyRoom exactly as
 * before). The game's own table, cards, layout, cameras, venue
 * locks and gameplay are untouched — this is the street corner
 * AROUND the table: the glowing corner store + striped awning
 * behind the far seat, the chain-link fence and vacant lot on
 * the west flank, one flickering streetlight, a tenement with a
 * fire escape, trash at the fence base, and the four seat chairs
 * (CHAIR_SPOTS).
 *
 * Route rule: everything here is procedural geometry + canvas
 * textures EXCEPT the parked sedan — a REUSE of the Pj's one Forge
 * mix (TRELLIS, creation 209057ed; the identical GLB already live
 * at SEDAN_URL), with the Corner manifest's darker in-engine tint.
 * Vehicle bodywork is the proven code-fails class (sandbox Batch 0
 * record); no new generation was made. The GLB lazy-loads on mount
 * for this room only, DECLARATIVELY (useLoader + Suspense + error
 * boundary — the certified pattern; a failed load omits the car
 * and names itself on window.__cornerSedan, never the room).
 *
 * Effects discipline: `fxOn` (= !reduceFx at this table) drives
 * the streetlight flicker and the room's frame ticker. Effects off
 * → the same room, steady light, static frame. Sandbox
 * certification: _immersive3d-work/CODE-ROOMS-REPORT.md, Batch 2
 * (97,122 tris / 68 draw calls worst frame, sedan in frame).
 */
import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import {
  AdditiveBlending, Box3, BoxGeometry, BufferGeometry, CanvasTexture, CatmullRomCurve3,
  CircleGeometry, CylinderGeometry, DoubleSide, Fog,
  Group, Mesh, MeshStandardMaterial,
  PlaneGeometry, Quaternion, RepeatWrapping, SRGBColorSpace,
  SphereGeometry, Texture, TorusGeometry,
  TubeGeometry, Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHAIR_SPOTS } from './classicStudioLayout';
import { SEDAN_URL } from './PjsStreetRoom';

const FLOOR_Y = -0.9;

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
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  paint(ctx, w, h);
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) { tex.wrapS = tex.wrapT = RepeatWrapping; tex.repeat.set(repeat[0], repeat[1]); }
  return tex;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, rnd: () => number, alpha: number, light: boolean): void {
  for (let i = 0; i < n; i++) {
    const a = (rnd() * alpha).toFixed(3);
    ctx.fillStyle = light ? `rgba(235,230,220,${a})` : `rgba(5,5,8,${a})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

function makeBrickTexture(seed: number, tone: number, repeat: [number, number] = [3, 1.6]): CanvasTexture {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(seed);
    ctx.fillStyle = '#14100d'; ctx.fillRect(0, 0, w, h);
    const bh = 16, bw = 62;
    for (let row = 0; row * bh < h; row++) {
      const off = row % 2 ? -bw / 2 : 0;
      for (let col = -1; col * bw < w + bw; col++) {
        const v = (0.72 + rnd() * 0.5) * tone;
        const r = Math.round(96 * v), g = Math.round(52 * v), b = Math.round(36 * v);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(col * bw + off + 2, row * bh + 2, bw - 4, bh - 4);
        if (rnd() < 0.16) { ctx.fillStyle = 'rgba(10,8,8,0.35)'; ctx.fillRect(col * bw + off + 2, row * bh + 2, bw - 4, bh - 4); }
        if (rnd() < 0.10) { ctx.fillStyle = 'rgba(190,170,150,0.10)'; ctx.fillRect(col * bw + off + 2, row * bh + 2, bw - 4, 3); }
      }
    }
    speckle(ctx, w, h, 2600, rnd, 0.16, false);
    const grad = ctx.createLinearGradient(0, h * 0.7, 0, h);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  }, repeat);
}

function makeConcreteTexture(): CanvasTexture {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(4711);
    ctx.fillStyle = '#4b453e'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 9000, rnd, 0.13, false); speckle(ctx, w, h, 5000, rnd, 0.07, true);
    ctx.strokeStyle = 'rgba(12,10,9,0.55)'; ctx.lineWidth = 3;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.strokeStyle = 'rgba(15,13,11,0.35)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      let x = rnd() * w, y = rnd() * h; ctx.moveTo(x, y);
      for (let sIdx = 0; sIdx < 5; sIdx++) { x += (rnd() - 0.5) * 90; y += (rnd() - 0.5) * 90; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    for (let i = 0; i < 7; i++) {
      const x = rnd() * w, y = rnd() * h, r = 20 + rnd() * 70;
      const stain = ctx.createRadialGradient(x, y, 2, x, y, r);
      stain.addColorStop(0, `rgba(18,15,12,${(0.10 + rnd() * 0.16).toFixed(2)})`); stain.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = stain; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, [6, 4]);
}

function makeAsphaltTexture(): CanvasTexture {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(9021);
    ctx.fillStyle = '#17181c'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 12000, rnd, 0.10, true); speckle(ctx, w, h, 8000, rnd, 0.2, false);
    for (let i = 0; i < 6; i++) {
      const x = rnd() * w, y = rnd() * h, r = 30 + rnd() * 90;
      const patch = ctx.createRadialGradient(x, y, 2, x, y, r);
      patch.addColorStop(0, `rgba(6,6,8,${(0.14 + rnd() * 0.2).toFixed(2)})`); patch.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = patch; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, [8, 3]);
}

function makePlankTexture(): CanvasTexture {
  return canvasTex(512, 256, (ctx, w, h) => {
    const rnd = mulberry32(60221023);
    const rows = 4, rh = h / rows;
    for (let rIdx = 0; rIdx < rows; rIdx++) {
      const v = 0.8 + rnd() * 0.35;
      ctx.fillStyle = `rgb(${Math.round(96 * v)},${Math.round(70 * v)},${Math.round(44 * v)})`;
      ctx.fillRect(0, rIdx * rh, w, rh - 3);
      ctx.strokeStyle = 'rgba(30,18,8,0.35)'; ctx.lineWidth = 1;
      for (let gLine = 0; gLine < 7; gLine++) {
        const gy = rIdx * rh + 4 + rnd() * (rh - 10);
        ctx.beginPath(); ctx.moveTo(0, gy);
        for (let x = 0; x <= w; x += 32) ctx.lineTo(x, gy + Math.sin(x * 0.02 + rIdx * 7 + gLine) * 1.6);
        ctx.stroke();
      }
      const kx = rnd() * w, ky = rIdx * rh + rh / 2;
      ctx.strokeStyle = 'rgba(35,20,8,0.5)';
      ctx.beginPath(); ctx.ellipse(kx, ky, 6 + rnd() * 5, 3.5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    speckle(ctx, w, h, 1500, rnd, 0.12, false);
  }, [1.6, 1.6]);
}

function makeLitWindowTexture(seed: number): CanvasTexture {
  return canvasTex(256, 320, (ctx, w, h) => {
    const rnd = mulberry32(seed);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#f2b05e'); grad.addColorStop(1, '#c47f33');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(70,40,16,0.55)';
    ctx.fillRect(0, h * 0.18, w, 7); ctx.fillRect(0, h * 0.52, w, 7);
    if (rnd() < 0.8) { ctx.fillStyle = 'rgba(60,34,14,0.8)'; ctx.fillRect(w * (0.15 + rnd() * 0.5), h * 0.6, w * 0.22, h * 0.4); }
    ctx.fillStyle = 'rgba(255,240,205,0.20)'; ctx.fillRect(0, 0, w, 10);
    speckle(ctx, w, h, 260, rnd, 0.08, false);
  });
}

function makeDarkWindowTexture(): CanvasTexture {
  return canvasTex(256, 320, (ctx, w, h) => {
    const rnd = mulberry32(1357);
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#131a26'); grad.addColorStop(0.5, '#0a0e16'); grad.addColorStop(1, '#05070c');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(150,180,230,0.10)';
    ctx.beginPath(); ctx.moveTo(w * 0.15, h); ctx.lineTo(w * 0.55, 0); ctx.lineTo(w * 0.8, 0); ctx.lineTo(w * 0.4, h); ctx.fill();
    speckle(ctx, w, h, 200, rnd, 0.1, false);
  });
}

function makeGlowTexture(): CanvasTexture {
  return canvasTex(128, 128, (ctx, w, h) => {
    const grad = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.38)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  });
}

/** Shop window: warm interior, stocked shelf rows with bottle/jar
 *  silhouettes, a hanging-lamp glow. Shapes only — NO readable text
 *  or lettering-like marks, per the standing exclusion. `dim` is
 *  the door-glass variant: darker, sparser, so the door does not
 *  read as a third display window (sandbox gate fix). */
function makeShopWindowTexture(seed: number, dim = false): CanvasTexture {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(seed);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    if (dim) {
      grad.addColorStop(0, '#8a5a28'); grad.addColorStop(0.5, '#6f451d'); grad.addColorStop(1, '#4c2d12');
    } else {
      grad.addColorStop(0, '#e8a355'); grad.addColorStop(0.5, '#cf8438'); grad.addColorStop(1, '#9c5c22');
    }
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    const lamp = ctx.createRadialGradient(w / 2, 60, 4, w / 2, 60, 190);
    lamp.addColorStop(0, 'rgba(255,236,190,0.95)'); lamp.addColorStop(1, 'rgba(255,236,190,0)');
    ctx.fillStyle = lamp; ctx.fillRect(0, 0, w, h);
    for (let s = 0; s < (dim ? 2 : 4); s++) {
      const sy = 120 + s * 92;
      ctx.fillStyle = 'rgba(43,24,10,0.92)';
      ctx.fillRect(18, sy + 52, w - 36, 9);
      let x = 30 + rnd() * 14;
      while (x < w - 46) {
        const bw = 15 + rnd() * 17, bh = 30 + rnd() * 20;
        const tone = ['rgba(58,32,12,0.95)', 'rgba(38,44,20,0.95)', 'rgba(74,44,16,0.95)', 'rgba(30,30,34,0.95)'][Math.floor(rnd() * 4)]!;
        ctx.fillStyle = tone;
        ctx.fillRect(x, sy + 52 - bh, bw, bh);
        ctx.fillRect(x + bw * 0.32, sy + 52 - bh - 8, bw * 0.36, 9);
        x += bw + 5 + rnd() * 10;
      }
    }
    const foot = ctx.createLinearGradient(0, h - 90, 0, h);
    foot.addColorStop(0, 'rgba(30,16,6,0)'); foot.addColorStop(1, 'rgba(30,16,6,0.55)');
    ctx.fillStyle = foot; ctx.fillRect(0, h - 90, w, 90);
    const sheen = ctx.createLinearGradient(0, 0, w, h);
    sheen.addColorStop(0, 'rgba(190,210,255,0.10)'); sheen.addColorStop(0.4, 'rgba(190,210,255,0.02)'); sheen.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sheen; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 500, rnd, 0.05, false);
  });
}

/** Awning canvas: faded black-and-cream stripes, weather stains. */
function makeAwningTexture(): CanvasTexture {
  return canvasTex(512, 256, (ctx, w, h) => {
    const rnd = mulberry32(3141);
    const stripe = w / 12;
    for (let i = 0; i < 12; i++) { ctx.fillStyle = i % 2 ? '#191919' : '#cfc4a6'; ctx.fillRect(i * stripe, 0, stripe, h); }
    const bleach = ctx.createLinearGradient(0, 0, 0, h);
    bleach.addColorStop(0, 'rgba(60,44,26,0.25)'); bleach.addColorStop(0.6, 'rgba(0,0,0,0)'); bleach.addColorStop(1, 'rgba(216,204,170,0.20)');
    ctx.fillStyle = bleach; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      const x = rnd() * w, y = h * 0.4 + rnd() * h * 0.6, r = 14 + rnd() * 40;
      const st = ctx.createRadialGradient(x, y, 2, x, y, r);
      st.addColorStop(0, `rgba(40,30,16,${(0.10 + rnd() * 0.14).toFixed(2)})`); st.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = st; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    speckle(ctx, w, h, 1600, rnd, 0.07, false);
  });
}

/** Valance strip: same stripes, scalloped bottom edge cut by alpha. */
function makeValanceTexture(): CanvasTexture {
  return canvasTex(1024, 64, (ctx, w, h) => {
    const stripe = w / 24;
    for (let i = 0; i < 24; i++) { ctx.fillStyle = i % 2 ? '#191919' : '#cfc4a6'; ctx.fillRect(i * stripe, 0, stripe, h); }
    const grime = ctx.createLinearGradient(0, 0, 0, h);
    grime.addColorStop(0, 'rgba(50,36,20,0.15)'); grime.addColorStop(1, 'rgba(30,20,10,0.35)');
    ctx.fillStyle = grime; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-out';
    const r = w / 48;
    for (let cx = r; cx < w; cx += r * 2) { ctx.beginPath(); ctx.arc(cx, h, r, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalCompositeOperation = 'source-over';
  });
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

type G = BufferGeometry;

function box(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): G {
  const g = new BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

function cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, seg = 14): G {
  const g = new CylinderGeometry(rt, rb, h, seg);
  g.translate(x, y, z);
  return g;
}

function tube(a: [number, number, number], b: [number, number, number], r: number, seg = 10): G {
  const va = new Vector3(...a), vb = new Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  const g = new CylinderGeometry(r, r, len, seg);
  g.translate(0, len / 2, 0);
  const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(quat);
  g.translate(va.x, va.y, va.z);
  return g;
}

function merged(parts: G[]): BufferGeometry {
  const m = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!m) throw new Error('geometry merge failed');
  return m;
}

/* ------------------------------------------------------------------ */
/* The room's one material/texture set — created once, shared          */
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
  const shopTex = makeShopWindowTexture(60221023);
  const doorTex = makeShopWindowTexture(9182, true);

  const std = (p: ConstructorParameters<typeof MeshStandardMaterial>[0]) => new MeshStandardMaterial(p);
  const mats = {
    steelBlack: std({ color: '#101114', roughness: 0.42, metalness: 0.72 }),
    chairPanel: std({ color: '#17382b', roughness: 0.62, metalness: 0.05 }),
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
    darkWood: std({ color: '#4a341e', roughness: 0.85, metalness: 0 }),
    puddle: std({ color: '#0c1420', roughness: 0.06, metalness: 0.9 }),
    shopWin: std({ map: shopTex, emissive: '#ffb45e', emissiveMap: shopTex, emissiveIntensity: 1.35, roughness: 0.35, metalness: 0 }),
    shopDoor: std({ map: doorTex, emissive: '#c07c34', emissiveMap: doorTex, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0 }),
    awning: std({ map: makeAwningTexture(), roughness: 0.92, metalness: 0 }),
    valance: std({ map: makeValanceTexture(), transparent: true, alphaTest: 0.5, side: DoubleSide, roughness: 0.92, metalness: 0 }),
    chainMesh: std({ map: makeChainLinkTexture(), transparent: false, alphaTest: 0.45, side: DoubleSide, color: '#c9ccd1', roughness: 0.45, metalness: 0.6 }),
    trashBag: std({ color: '#0b0b0d', roughness: 0.3, metalness: 0.05 }),
    trashGrey: std({ color: '#33343a', roughness: 0.42, metalness: 0.02 }),
    cardboard: std({ map: plankTex, color: '#c8ab7d', roughness: 0.95, metalness: 0 }),
    dirt: std({ color: '#17120d', roughness: 1, metalness: 0 }),
  };
  return { mats, glowTex };
}

/* ------------------------------------------------------------------ */
/* Folding chairs — tube X-frame construction, owner's scale:          */
/* total H ≈ 0.90, seat top ≈ 0.49 (same geometry as the Pj's room).   */
/* Local space: floor at y = 0, chair faces +z.                        */
/* ------------------------------------------------------------------ */

function chairFrameGeo(): BufferGeometry {
  const parts: G[] = [];
  for (const sx of [-1, 1]) {
    const xr = 0.205 * sx, xf = 0.215 * sx;
    parts.push(tube([xr, 0.012, -0.195], [0.185 * sx, 0.905, -0.262], 0.0115));
    parts.push(tube([xf, 0.012, 0.20], [0.20 * sx, 0.478, 0.172], 0.0115));
    parts.push(tube([0.20 * sx, 0.468, 0.185], [0.20 * sx, 0.468, -0.185], 0.0105));
    parts.push(tube([0.212 * sx, 0.05, 0.19], [0.20 * sx, 0.44, -0.175], 0.0095));
    parts.push(box(0.05, 0.02, 0.065, xf, 0.01, 0.20));
    parts.push(box(0.05, 0.02, 0.065, xr, 0.01, -0.195));
  }
  parts.push(tube([-0.20, 0.16, 0.19], [0.20, 0.16, 0.19], 0.0095));
  parts.push(tube([-0.185, 0.895, -0.258], [0.185, 0.895, -0.258], 0.0115));
  parts.push(tube([-0.20, 0.468, -0.185], [0.20, 0.468, -0.185], 0.0105));
  return merged(parts);
}

function chairPanelGeo(): BufferGeometry {
  return merged([
    box(0.43, 0.028, 0.40, 0, 0.478, 0),
    box(0.43, 0.23, 0.024, 0, 0.775, -0.2435, -0.10),
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
/* The corner storefront (COR-01). Local space: facade front plane at  */
/* z = 0 facing +z, floor at y = 0. Brick mass 5.2 × 3.6; two shop     */
/* windows with stocked-shelf glow; glass door; blank fascia band      */
/* (no lettering, ever); stone lintel + parapet.                       */
/* ------------------------------------------------------------------ */

function Storefront() {
  const { mats } = assets();
  const parts = useMemo(() => {
    const frame: G[] = [], bulk: G[] = [];
    bulk.push(box(1.86, 0.55, 0.06, -1.32, 0.275, 0.20));
    bulk.push(box(1.86, 0.55, 0.06, 0.62, 0.275, 0.20));
    frame.push(box(0.10, 2.35, 0.08, -2.32, 1.175, 0.20));
    frame.push(box(0.10, 2.35, 0.08, -0.32, 1.175, 0.20));
    frame.push(box(0.10, 2.35, 0.08, 1.58, 1.175, 0.20));
    frame.push(box(0.10, 2.35, 0.08, 2.48, 1.175, 0.20));
    frame.push(box(4.9, 0.10, 0.08, 0.08, 2.32, 0.20));
    frame.push(box(0.98, 0.07, 0.09, 2.03, 2.235, 0.20));
    frame.push(box(0.06, 0.03, 0.05, 2.03, 1.06, 0.23));
    return { frame: merged(frame), bulk: merged(bulk) };
  }, []);
  return (
    <group position={[0, FLOOR_Y, -4.7]}>
      <mesh material={mats.brickNear} position={[0, 1.8, 0]} receiveShadow>
        <boxGeometry args={[5.2, 3.6, 0.35]} />
      </mesh>
      <mesh material={mats.stoneTrim} position={[0, 3.68, 0]}>
        <boxGeometry args={[5.38, 0.18, 0.5]} />
      </mesh>
      <mesh material={mats.stoneTrim} position={[0, 2.98, 0.1]}>
        <boxGeometry args={[5.2, 0.16, 0.42]} />
      </mesh>
      {/* blank fascia band — a board, deliberately no lettering */}
      <mesh position={[0, 2.66, 0.19]}>
        <boxGeometry args={[4.9, 0.44, 0.05]} />
        <meshStandardMaterial color="#1d1410" roughness={0.85} />
      </mesh>
      <mesh geometry={parts.frame} material={mats.steelBlack} castShadow />
      <mesh geometry={parts.bulk} material={mats.darkWood} receiveShadow />
      {[-1.32, 0.62].map((x) => (
        <mesh key={x} material={mats.shopWin} position={[x, 1.47, 0.185]}>
          <planeGeometry args={[1.8, 1.78]} />
        </mesh>
      ))}
      {[-1.32, 0.62].map((x) => (
        <group key={`m${x}`} position={[x, 1.47, 0.20]}>
          <mesh material={mats.steelBlack}><boxGeometry args={[0.05, 1.78, 0.03]} /></mesh>
          <mesh material={mats.steelBlack}><boxGeometry args={[1.8, 0.05, 0.03]} /></mesh>
        </group>
      ))}
      <mesh material={mats.shopDoor} position={[2.03, 1.62, 0.185]}>
        <planeGeometry args={[0.9, 1.14]} />
      </mesh>
      <mesh material={mats.darkWood} position={[2.03, 0.51, 0.185]}>
        <planeGeometry args={[0.9, 1.02]} />
      </mesh>
      <mesh material={mats.curb} position={[2.03, 0.035, 0.32]} receiveShadow>
        <boxGeometry args={[1.1, 0.07, 0.5]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Striped awning (COR-02): sloped canvas over the windows + door,     */
/* scalloped valance on the front edge, two support rods.              */
/* ------------------------------------------------------------------ */

function Awning() {
  const { mats } = assets();
  const rods = useMemo(() => merged([
    tube([-2.25, 2.98, 0.19], [-2.25, 2.30, 1.30], 0.011),
    tube([2.35, 2.98, 0.19], [2.35, 2.30, 1.30], 0.011),
  ]), []);
  return (
    <group position={[0, FLOOR_Y, -4.7]}>
      <mesh material={mats.awning} position={[0.05, 2.42, 0.78]} rotation={[0.29, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[4.95, 0.03, 1.24]} />
      </mesh>
      <mesh material={mats.valance} position={[0.05, 2.16, 1.36]}>
        <planeGeometry args={[4.95, 0.17]} />
      </mesh>
      <mesh geometry={rods} material={mats.steelBlack} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Streetlight (COR-03) — the same form as the Pj's lamp, at the       */
/* corner of the lot. fxOn=false → steady burn, no flicker.            */
/* ------------------------------------------------------------------ */

function flickerHash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

function Streetlight({ fxOn }: { fxOn: boolean }) {
  const { mats, glowTex } = assets();
  const spotRef = useRef<import('three').SpotLight>(null);
  const lensRef = useRef<MeshStandardMaterial>(null);
  const glowRef = useRef<import('three').SpriteMaterial>(null);
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
    if (spotRef.current) spotRef.current.intensity = 60 * f;
    if (lensRef.current) lensRef.current.emissiveIntensity = 3.0 * f;
    if (glowRef.current) glowRef.current.opacity = 0.34 * f;
  });
  return (
    <group position={[-3.6, FLOOR_Y, -2.7]}>
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
      {/* The pool belongs on the sidewalk in front of the lamp, NOT on
          the felt (the production Pj's lesson: a table-centred spot
          floods the felt tan under the venue key light). Ground-led:
          it rims the table's west rail and lights the fence base. */}
      <spotLight
        ref={spotRef}
        position={[1.38, 4.62, 0]}
        target={target}
        angle={0.62} penumbra={0.85} intensity={60}
        color="#ff9c3a" castShadow
        shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004}
      />
      {/* world target: the sidewalk patch west-front of the table
          (local = world − lamp pos) */}
      <primitive object={target} position={[2.2, 0, 0.9]} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Brick facades — box mass with the code brick texture, merged        */
/* window frames + lit/dark glass, parapet cap, optional fire escape.  */
/* (Same construction as the Pj's room facades.)                       */
/* ------------------------------------------------------------------ */

function BrickFacade({ x, z, w, h, seed, litRatio, far = false, fireEscape = false, ry = 0 }:
  { x: number; z: number; w: number; h: number; seed: number; litRatio: number; far?: boolean; fireEscape?: boolean; ry?: number }) {
  const { mats } = assets();
  const win = useMemo(() => {
    const rnd = mulberry32(seed);
    const lit: G[] = [], dark: G[] = [], frame: G[] = [];
    const cols = Math.max(2, Math.floor(w / 1.35));
    const rows = Math.max(2, Math.floor(h / 1.85));
    for (let rIdx = 0; rIdx < rows; rIdx++) {
      for (let cIdx = 0; cIdx < cols; cIdx++) {
        const wx = -w / 2 + (cIdx + 0.5) * (w / cols);
        const wy = 0.75 + rIdx * ((h - 1.2) / rows) + 0.55;
        if (wy > h - 0.7) continue;
        frame.push(box(0.78, 1.14, 0.07, wx, wy, 0.21));
        (rnd() < litRatio ? lit : dark).push(box(0.66, 1.02, 0.05, wx, wy, 0.22));
        frame.push(box(0.66, 0.045, 0.06, wx, wy, 0.23));
        frame.push(box(0.045, 1.02, 0.06, wx, wy, 0.23));
      }
    }
    return { lit: merged(lit), dark: merged(dark), frame: merged(frame) };
  }, [seed, w, h, litRatio]);
  const esc = useMemo(() => {
    if (!fireEscape) return null;
    const parts: G[] = [];
    for (const ly of [2.1, 3.9]) {
      for (let gx = -1.5; gx <= 1.5; gx += 0.19) parts.push(box(0.045, 0.03, 0.62, gx, ly, 0.62));
      parts.push(box(3.2, 0.05, 0.05, 0, ly + 0.5, 0.92));
      parts.push(box(3.2, 0.05, 0.05, 0, ly + 0.95, 0.92));
      for (const px of [-1.55, 0, 1.55]) parts.push(box(0.045, 0.95, 0.045, px, ly + 0.48, 0.92));
      parts.push(tube([1.62, ly + 0.02, 0.75], [1.62, ly + 1.02, 0.75], 0.02));
      parts.push(tube([-1.62, ly + 0.02, 0.75], [-1.62, ly + 1.02, 0.75], 0.02));
    }
    parts.push(tube([1.62, 2.12, 0.75], [-1.45, 3.88, 0.75], 0.022));
    parts.push(tube([1.30, 2.12, 0.75], [-1.62, 3.88, 0.75], 0.022));
    parts.push(tube([1.62, 0.1, 0.7], [1.62, 2.1, 0.7], 0.024));
    return merged(parts);
  }, [fireEscape]);
  return (
    <group position={[x, FLOOR_Y, z]} rotation={[0, ry, 0]}>
      <mesh material={far ? mats.brickFar : mats.brickNear} position={[0, h / 2, 0]} receiveShadow>
        <boxGeometry args={[w, h, 0.4]} />
      </mesh>
      <mesh material={mats.stoneTrim} position={[0, h + 0.07, 0]}>
        <boxGeometry args={[w + 0.18, 0.16, 0.55]} />
      </mesh>
      <mesh geometry={win.frame} material={mats.steelBlack} />
      <mesh geometry={win.lit} material={mats.litWin} />
      <mesh geometry={win.dark} material={mats.darkWin} />
      {esc && <mesh geometry={esc} material={mats.steelBlack} castShadow />}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Chain-link fence (COR-04) — the lot run: 6.0 m, H 1.10, modeled     */
/* posts/frame + an alpha-tested diamond mesh. OWNER DECISION          */
/* 2026-10-28: the room was certified with the Pj's picket fence,      */
/* but the Corner's own shipped story art shows chain-link around      */
/* the lot; shown a matched-angle comparison set, the owner picked     */
/* chain-link ("Go with your suggestion") and the room was              */
/* re-certified with this build. The mesh is alphaTest (never          */
/* blended), so it cannot produce sorting artifacts.                   */
/* ------------------------------------------------------------------ */

/** Chain-link diamond mesh: two diagonal wire families on a
 *  transparent tile, galvanized grey with a lighter wire core. */
function makeChainLinkTexture(): CanvasTexture {
  const tex = canvasTex(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    for (const [width, style] of [[9, '#565b61'], [4, '#a8adb4']] as const) {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      for (let k = -h; k < w + h; k += 128) {
        ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + h, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(k + h, 0); ctx.lineTo(k, h); ctx.stroke();
      }
    }
  }, [72, 12]);
  tex.anisotropy = 8;
  return tex;
}

function ChainLinkFence() {
  const { mats } = assets();
  const parts = useMemo(() => {
    const frame: G[] = [];
    for (let px = -3; px <= 3.001; px += 1.5) {
      frame.push(cyl(0.024, 0.024, 1.1, px, 0.55, 0, 10));
      const cap = new SphereGeometry(0.03, 8, 6);
      cap.translate(px, 1.11, 0);
      frame.push(cap);
    }
    frame.push(tube([-3, 1.06, 0], [3, 1.06, 0], 0.016));
    frame.push(tube([-3, 0.05, 0], [3, 0.05, 0], 0.006));
    return merged(frame);
  }, []);
  return (
    <group position={[-4.3, FLOOR_Y, -0.2]} rotation={[0, Math.PI / 2, 0]}>
      <mesh geometry={parts} material={mats.steelBlack} castShadow receiveShadow />
      <mesh material={mats.chainMesh} position={[0, 0.56, 0]} receiveShadow>
        <planeGeometry args={[6.0, 1.02]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* The sedan (COR-07) — REUSE of the Pj's Forge mix (the identical     */
/* GLB at SEDAN_URL), Box3 fit-and-ground, with the Corner manifest's  */
/* darker tint (0.55) multiplied into cloned materials. Loaded         */
/* DECLARATIVELY; a failed load renders nothing and names itself on    */
/* window.__cornerSedan, never a broken scene.                        */
/* ------------------------------------------------------------------ */

class CornerSedanBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch() {
    (window as unknown as { __cornerSedan?: unknown }).__cornerSedan = { loaded: false, slug: 'pjs-sedan-corner-reuse' };
  }
  override render() { return this.state.failed ? null : this.props.children; }
}

function CornerSedanModel() {
  const gltf = useLoader(GLTFLoader, SEDAN_URL);
  const obj = useMemo(() => {
    const o = gltf.scene.clone(true) as Group;
    o.traverse((n) => {
      const mesh = n as Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true; mesh.receiveShadow = true;
        const m = mesh.material as MeshStandardMaterial | MeshStandardMaterial[];
        const tint = (mm: MeshStandardMaterial) => { const c = mm.clone(); if (c.color) c.color.multiplyScalar(0.55); return c; };
        mesh.material = Array.isArray(m) ? m.map(tint) : tint(m);
      }
    });
    o.updateMatrixWorld(true);
    const b = new Box3().setFromObject(o);
    const size = b.getSize(new Vector3());
    const longest = Math.max(size.x, size.z);
    if (longest > 0) o.scale.setScalar(4.4 / longest);
    o.rotation.y = Math.PI / 2;
    o.position.set(-1.8, FLOOR_Y, 5.6);
    o.updateMatrixWorld(true);
    const grounded = new Box3().setFromObject(o);
    o.position.y += FLOOR_Y - grounded.min.y;
    return o;
  }, [gltf]);
  useEffect(() => {
    (window as unknown as { __cornerSedan?: unknown }).__cornerSedan = { loaded: true, slug: 'pjs-sedan-corner-reuse' };
  }, []);
  return <primitive object={obj} />;
}

function CornerSedan() {
  const { glowTex } = assets();
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-1.8, FLOOR_Y + 0.006, 5.6]}>
        <planeGeometry args={[5.2, 2.5]} />
        <meshBasicMaterial map={glowTex} color="#000000" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <CornerSedanBoundary>
        <Suspense fallback={null}>
          <CornerSedanModel />
        </Suspense>
      </CornerSedanBoundary>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Trash bag pile at the fence base (COR-08): squashed glossy sacks    */
/* + one split cardboard box.                                          */
/* ------------------------------------------------------------------ */

function TrashPile() {
  const { mats } = assets();
  const bags = useMemo(() => {
    const specs: [number, number, number, number, number][] = [
      [0, 0, 0.27, 0.62, 0.4], [0.38, 0.10, 0.23, 0.58, 1.7], [-0.36, 0.12, 0.22, 0.66, 2.9],
      [0.16, -0.26, 0.21, 0.6, 0.9], [-0.14, -0.24, 0.19, 0.55, 2.1], [0.05, 0.02, 0.2, 0.5, 1.2],
    ];
    return specs.map(([x, z, r, sq, ry]) => {
      const g = new SphereGeometry(r, 14, 10);
      g.scale(1, sq, 1);
      g.rotateY(ry);
      g.translate(x, r * sq * 0.92, z);
      return g;
    });
  }, []);
  return (
    <group position={[-3.85, FLOOR_Y, 2.35]} rotation={[0, 0.5, 0]}>
      {bags.map((g, i) => (
        <mesh key={i} geometry={g} material={i === 4 ? mats.trashGrey : mats.trashBag} castShadow receiveShadow />
      ))}
      {[[0.02, 0.36, 0.02], [0.4, 0.29, 0.12]].map(([x, y, z], i) => (
        <mesh key={`k${i}`} material={mats.trashBag} position={[x!, y!, z!]}>
          <sphereGeometry args={[0.05, 8, 6]} />
        </mesh>
      ))}
      <group position={[0.78, 0, -0.28]} rotation={[0, -0.7, 0]}>
        <mesh material={mats.cardboard} position={[0, 0.16, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.52, 0.32, 0.42]} />
        </mesh>
        <mesh material={mats.cardboard} position={[-0.13, 0.36, 0]} rotation={[0, 0, 0.85]}>
          <boxGeometry args={[0.26, 0.015, 0.42]} />
        </mesh>
        <mesh material={mats.cardboard} position={[0.14, 0.37, 0]} rotation={[0, 0, -0.7]}>
          <boxGeometry args={[0.26, 0.015, 0.42]} />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Ground — sidewalk wrapping the store corner, kerb + wet street      */
/* beyond the near seat, the vacant lot west behind the fence.         */
/* ------------------------------------------------------------------ */

function Ground() {
  const { mats, glowTex } = assets();
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y + 0.002, -1.3]} material={mats.concrete} receiveShadow>
        <planeGeometry args={[16.5, 10.4]} />
      </mesh>
      <mesh position={[0, FLOOR_Y + 0.012, 3.86]} material={mats.curb} receiveShadow>
        <boxGeometry args={[16.5, 0.05, 0.22]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 8.7]} material={mats.asphalt} receiveShadow>
        <planeGeometry args={[26, 9.6]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-7.1, FLOOR_Y + 0.001, -0.2]} material={mats.dirt} receiveShadow>
        <planeGeometry args={[5.6, 10.4]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y - 0.012, 0]}>
        <planeGeometry args={[60, 44]} />
        <meshStandardMaterial color="#07080c" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0.3]} scale={[1.9, 1.0, 1]} position={[1.4, FLOOR_Y + 0.004, 3.1]} material={mats.puddle}>
        <circleGeometry args={[0.55, 26]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0.12]} position={[1.15, FLOOR_Y + 0.006, 2.2]}>
        <planeGeometry args={[1.1, 2.6]} />
        <meshBasicMaterial map={glowTex} color="#ff9a4d" transparent opacity={0.10} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.8, FLOOR_Y + 0.003, 6.9]}>
        <circleGeometry args={[0.36, 26]} />
        <meshStandardMaterial color="#101114" roughness={0.6} metalness={0.4} />
      </mesh>
      <mesh position={[-5.1, FLOOR_Y + 0.31, -1.7]} rotation={[0.22, 0.4, 0.1]} material={mats.tire} castShadow>
        <torusGeometry args={[0.30, 0.105, 10, 22]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Fog — the corner's depth cue, a touch tighter than the Pj's (the    */
/* sparser room falls off sooner). Saves/restores the scene fog.       */
/* ------------------------------------------------------------------ */

function EnvFog() {
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const prev = scene.fog;
    scene.fog = new Fog('#05070f', 11, 26);
    invalidate();
    return () => { scene.fog = prev; invalidate(); };
  }, [scene, invalidate]);
  return null;
}

/* ------------------------------------------------------------------ */
/* Frame ticker — the cube-room pattern (cubeVenue.tsx): while fxOn,   */
/* invalidate on an interval so the flicker animates under the         */
/* demand frameloop. Effects off → no ticker, static frame.            */
/* ------------------------------------------------------------------ */

function RoomTicker({ fxOn }: { fxOn: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!fxOn) return;
    const id = window.setInterval(() => { if (!document.hidden) invalidate(); }, 90);
    return () => window.clearInterval(id);
  }, [fxOn, invalidate]);
  return null;
}

/* ------------------------------------------------------------------ */

export default function CornerStreetRoom({ fxOn }: { fxOn: boolean }) {
  const { mats } = assets();
  return (
    <group>
      <EnvFog />
      <RoomTicker fxOn={fxOn} />
      <FoldingChairs />
      <Storefront />
      <Awning />
      <Streetlight fxOn={fxOn} />
      <ChainLinkFence />
      <BrickFacade x={5.9} z={-6.0} w={5.6} h={6.4} seed={31} litRatio={0.14} fireEscape />
      <BrickFacade x={-1} z={13.8} w={17} h={6.5} seed={59} litRatio={0.18} far ry={Math.PI} />
      <CornerSedan />
      <TrashPile />
      <Ground />
      {/* the store's spill: warm light falling out of the shop windows
          onto the sidewalk and the far seat */}
      <pointLight position={[0.3, FLOOR_Y + 2.2, -3.0]} intensity={30} distance={9} decay={2} color="#ff9a4d" />
      {/* cool rim for the sedan across the street */}
      <pointLight position={[6.5, FLOOR_Y + 3.1, 5.0]} intensity={40} distance={12} decay={2} color="#7d94c9" />
      {/* cool night fill for the environment's own surfaces — the
          venue rig's hemisphere is tuned for the table; this lifts
          the street/facades to the sandbox room's legibility */}
      <hemisphereLight args={['#2e4066', '#04060a', 0.3]} />
    </group>
  );
}
