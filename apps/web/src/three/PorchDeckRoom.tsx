/**
 * THE PORCH — DECK ENVIRONMENT (production, rooms pipeline
 * Batch 3a, owner route 2026-10-28: code-first, mix when necessary;
 * "roll them all in as they become ready").
 *
 * The code-built Porch room from the immersive sandbox, ported
 * into the live game. Story-scoped mounting ONLY: Scene renders
 * this room when the table carries story stop `porch` (Stop 1,
 * Uncle Ray & Pat) at High quality, in place of GrandmaRoom. The
 * production `grandma` venue — the selectable Grandma's Kitchen —
 * is a different place and is untouched at both qualities, as are
 * non-story tables and the Porch at Low (GrandmaRoom exactly as
 * before). The game's own table, cards, layout, cameras and
 * gameplay are untouched — this is the porch AROUND the table:
 * the faded teal screen door centred behind the far seat, lit and
 * dark windows in the weatherboard wall, two rocking chairs with
 * a plaid throw (dressing, never play seats), string lights
 * looping the ceiling edges, railing + steps down to a quiet
 * street at dusk, and the four seat chairs (CHAIR_SPOTS).
 *
 * Route rule: ALL CODE, zero Forge mixes — nothing in this room
 * is a proven code-fails class (slatted wooden furniture is the
 * class the code folding chairs already passed at the owner's
 * eye); every texture is a procedural canvas, every form is
 * geometry. Zero downloads.
 *
 * Camera containment (the sandbox gate's hard lesson): the
 * beadboard ceiling is a SINGLE-SIDED downward plane at deck +
 * 3.2 m — the production cube-room discipline (STUDIO rooms
 * ceiling at 5 m) — because the game's raised sitting camera
 * rides ≈3.25 m over the floor and the standing camera above
 * that; a solid porch-height ceiling clipped the seated view
 * outright. Posts and walls are extended to the 3.2 m line to
 * meet it (the manifest's 2.6 m porch height yields to the
 * cameras; documented in the sandbox batch report).
 *
 * Effects discipline: the room has NO animated loops (string
 * lights burn steady at dusk), so it renders identically at
 * every effects setting — reduced motion is honored trivially
 * and no frame ticker runs. Sandbox certification:
 * _immersive3d-work/CODE-ROOMS-REPORT.md, Batch 3a (26,946 tris
 * / 89 draw calls worst frame, zero downloads).
 */
import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import {
  BoxGeometry, BufferGeometry, CanvasTexture, CatmullRomCurve3,
  CylinderGeometry, DoubleSide, Fog,
  MeshStandardMaterial,
  Quaternion, RepeatWrapping, SRGBColorSpace,
  SphereGeometry, TubeGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHAIR_SPOTS } from './classicStudioLayout';

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

function makeConcreteTexture(): CanvasTexture {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(4711);
    ctx.fillStyle = '#4b453e'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 9000, rnd, 0.13, false); speckle(ctx, w, h, 5000, rnd, 0.07, true);
    ctx.strokeStyle = 'rgba(12,10,9,0.55)'; ctx.lineWidth = 3;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  }, [6, 4]);
}

function makeAsphaltTexture(): CanvasTexture {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(9021);
    ctx.fillStyle = '#17181c'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 12000, rnd, 0.10, true); speckle(ctx, w, h, 8000, rnd, 0.2, false);
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

function makeGrateTexture(): CanvasTexture {
  return canvasTex(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    const step = 8;
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) ctx.fillRect(x + 3, y + 3, 2, 2);
  }, [10, 14]);
}

/** Weatherboard siding: horizontal boards, warm cream paint,
 *  shadow line under each board, grime toward the foot. */
function makeSidingTexture(): CanvasTexture {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(8181);
    ctx.fillStyle = '#c9baa0'; ctx.fillRect(0, 0, w, h);
    const bh = 42;
    for (let y = 0; y < h; y += bh) {
      const v = 0.92 + rnd() * 0.14;
      ctx.fillStyle = `rgb(${Math.round(203 * v)},${Math.round(188 * v)},${Math.round(160 * v)})`;
      ctx.fillRect(0, y, w, bh);
      ctx.fillStyle = 'rgba(60,44,26,0.55)'; ctx.fillRect(0, y + bh - 5, w, 5);
      ctx.fillStyle = 'rgba(255,246,225,0.20)'; ctx.fillRect(0, y, w, 3);
    }
    speckle(ctx, w, h, 2200, rnd, 0.08, false);
    const foot = ctx.createLinearGradient(0, h - 110, 0, h);
    foot.addColorStop(0, 'rgba(50,36,20,0)'); foot.addColorStop(1, 'rgba(50,36,20,0.35)');
    ctx.fillStyle = foot; ctx.fillRect(0, h - 110, w, 110);
  }, [3, 1.4]);
}

/** Beadboard ceiling: narrow vertical grooves, cream paint. */
function makeBeadboardTexture(): CanvasTexture {
  return canvasTex(256, 256, (ctx, w, h) => {
    const rnd = mulberry32(4242);
    ctx.fillStyle = '#c9bda6'; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      ctx.fillStyle = 'rgba(70,54,34,0.5)'; ctx.fillRect(x, 0, 2, h);
      ctx.fillStyle = 'rgba(255,250,235,0.16)'; ctx.fillRect(x + 2, 0, 2, h);
    }
    speckle(ctx, w, h, 700, rnd, 0.06, false);
  }, [6, 4]);
}

/** Plaid throw: rust-orange and brown checks with a woven grain. */
function makePlaidTexture(): CanvasTexture {
  return canvasTex(256, 256, (ctx, w, h) => {
    const rnd = mulberry32(60221);
    ctx.fillStyle = '#9a4a24'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(70,36,20,0.85)';
    for (let x = 0; x < w; x += 64) ctx.fillRect(x, 0, 26, h);
    for (let y = 0; y < h; y += 64) ctx.fillRect(0, y, w, 26);
    ctx.fillStyle = 'rgba(240,214,170,0.5)';
    for (let x = 32; x < w; x += 64) ctx.fillRect(x, 0, 5, h);
    for (let y = 32; y < h; y += 64) ctx.fillRect(0, y, w, 5);
    speckle(ctx, w, h, 2600, rnd, 0.10, false); speckle(ctx, w, h, 1800, rnd, 0.06, true);
  });
}

/** Dusk sky: amber horizon melting up through rose to blue-violet. */
function makeDuskSkyTexture(): CanvasTexture {
  return canvasTex(1024, 512, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#232a4a');
    grad.addColorStop(0.42, '#5a4470');
    grad.addColorStop(0.68, '#b4656a');
    grad.addColorStop(0.86, '#e89a52');
    grad.addColorStop(1, '#f7bd72');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    const sun = ctx.createRadialGradient(w * 0.36, h * 0.97, 8, w * 0.36, h * 0.97, 330);
    sun.addColorStop(0, 'rgba(255,214,150,0.85)');
    sun.addColorStop(1, 'rgba(255,214,150,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h);
  });
}

/** Foliage: layered green speckle for the plant blobs. */
function makeLeafTexture(seed: number): CanvasTexture {
  return canvasTex(256, 256, (ctx, w, h) => {
    const rnd = mulberry32(seed);
    ctx.fillStyle = '#2c4a26'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const g = 60 + rnd() * 110;
      ctx.fillStyle = `rgba(${Math.round(g * 0.55)},${Math.round(g)},${Math.round(g * 0.42)},0.8)`;
      ctx.beginPath();
      ctx.ellipse(rnd() * w, rnd() * h, 2 + rnd() * 4, 1 + rnd() * 2.4, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
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
/* Materials                                                           */
/* ------------------------------------------------------------------ */

interface PorchAssets {
  mats: Record<string, MeshStandardMaterial>;
}

let cached: PorchAssets | null = null;
function assets(): PorchAssets {
  if (cached) return cached;
  const tex = {
    concreteTex: makeConcreteTexture(),
    asphaltTex: makeAsphaltTexture(),
    plankTex: makePlankTexture(),
    litWinTex: makeLitWindowTexture(555),
    darkWinTex: makeDarkWindowTexture(),
    grateTex: makeGrateTexture(),
  };
  const std = (p: Record<string, unknown>) => new MeshStandardMaterial(p as never);
  const mats: Record<string, MeshStandardMaterial> = {
    siding: std({ map: makeSidingTexture(), color: '#d9d2c2', roughness: 0.9, metalness: 0 }),
    beadboard: std({ map: makeBeadboardTexture(), roughness: 0.92, metalness: 0 }),
    deckWood: std({ map: tex.plankTex, color: '#a79b8a', roughness: 0.88, metalness: 0 }),
    postPaint: std({ color: '#a89a80', roughness: 0.82, metalness: 0 }),
    trim: std({ color: '#54432c', roughness: 0.8, metalness: 0 }),
    doorTeal: std({ color: '#33655c', roughness: 0.72, metalness: 0.05 }),
    doorMesh: std({ map: tex.grateTex, transparent: true, alphaTest: 0.35, side: DoubleSide, color: '#23282c', roughness: 0.6, metalness: 0.4 }),
    litWin: std({ map: tex.litWinTex, emissive: '#ffb35c', emissiveMap: tex.litWinTex, emissiveIntensity: 0.95, roughness: 0.4, metalness: 0 }),
    darkWin: std({ map: tex.darkWinTex, roughness: 0.25, metalness: 0.1 }),
    rockerWood: std({ color: '#5e6b57', roughness: 0.78, metalness: 0 }),
    plaid: std({ map: makePlaidTexture(), roughness: 0.95, metalness: 0 }),
    tableWood: std({ color: '#4c3823', roughness: 0.7, metalness: 0 }),
    terra: std({ color: '#8a4a30', roughness: 0.85, metalness: 0 }),
    potDark: std({ color: '#4e3a2a', roughness: 0.85, metalness: 0 }),
    leafA: std({ map: makeLeafTexture(777), roughness: 0.95, metalness: 0 }),
    leafB: std({ map: makeLeafTexture(778), roughness: 0.95, metalness: 0 }),
    bulb: std({ color: '#ffb85e', emissive: '#ff9e45', emissiveIntensity: 1.2, roughness: 0.3, metalness: 0 }),
    wire: std({ color: '#17130e', roughness: 0.7, metalness: 0.2 }),
    concrete: std({ map: tex.concreteTex, roughness: 0.95, metalness: 0 }),
    asphalt: std({ map: tex.asphaltTex, roughness: 0.98, metalness: 0 }),
    chairGreen: std({ color: '#2c4632', roughness: 0.55, metalness: 0.35 }),
    chairSteel: std({ color: '#22242a', roughness: 0.45, metalness: 0.7 }),
    houseA: std({ color: '#1c2233', roughness: 0.95, metalness: 0 }),
    houseB: std({ color: '#2a2130', roughness: 0.95, metalness: 0 }),
    lawnDark: std({ color: '#26331d', roughness: 1, metalness: 0 }),
    sky: new MeshStandardMaterial({ map: makeDuskSkyTexture(), fog: false }),
  };
  cached = { mats };
  return cached;
}

/* ------------------------------------------------------------------ */
/* The play chairs — kit folding-chair geometry at the game's spots.   */
/* ------------------------------------------------------------------ */

function chairGeos() {
  const frameParts: G[] = [];
  const ySeat = FLOOR_Y + 0.49;
  const H = 0.90;
  for (const sx of [-1, 1]) {
    frameParts.push(tube([sx * 0.185, FLOOR_Y, 0.185], [sx * 0.185, ySeat, 0.185], 0.013));
    frameParts.push(tube([sx * 0.185, ySeat, 0.185], [sx * 0.185, FLOOR_Y + H, -0.215], 0.013));
    frameParts.push(tube([sx * 0.185, FLOOR_Y + 0.03, -0.225], [sx * 0.185, ySeat - 0.03, 0.175], 0.011));
    frameParts.push(tube([sx * 0.185, FLOOR_Y + 0.03, 0.185], [sx * 0.185, ySeat - 0.04, -0.20], 0.009));
  }
  frameParts.push(tube([-0.185, FLOOR_Y + 0.16, -0.228], [0.185, FLOOR_Y + 0.16, -0.228], 0.009));
  const frame = merged(frameParts);
  const seat = box(0.42, 0.028, 0.40, 0, ySeat - 0.014, 0);
  const lean = (FLOOR_Y + H - ySeat) / Math.hypot(0.40, FLOOR_Y + H - ySeat);
  const backTilt = Math.atan2(0.40, FLOOR_Y + H - ySeat);
  const back = box(0.42, 0.30, 0.026, 0, 0, 0);
  back.applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), backTilt - Math.PI / 2 + Math.acos(lean) * 0));
  back.translate(0, ySeat + 0.245, -0.20);
  return { frame, seat, back };
}

function FoldingChairs() {
  const { mats } = assets();
  const geos = useMemo(() => chairGeos(), []);
  return (
    <group>
      {CHAIR_SPOTS.map((s, i) => (
        <group key={i} position={[s.x, 0, s.z]} rotation={[0, s.ry, 0]}>
          <mesh geometry={geos.frame} material={mats.chairSteel} castShadow />
          <mesh geometry={geos.seat} material={mats.chairGreen} castShadow receiveShadow />
          <mesh geometry={geos.back} material={mats.chairGreen} castShadow />
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* String lights — catenary wire + stems + emissive bulbs, merged,     */
/* 3 draw calls per strand (kit component, production copy).           */
/* ------------------------------------------------------------------ */

function catenaryPoint(a: [number, number, number], b: [number, number, number], sag: number, t: number): [number, number, number] {
  const x = a[0] + (b[0] - a[0]) * t;
  const z = a[2] + (b[2] - a[2]) * t;
  const y = a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t);
  return [x, y, z];
}

function StringLights({ a, b, sag, bulbs }: {
  a: [number, number, number]; b: [number, number, number]; sag: number; bulbs: number;
}) {
  const { mats } = assets();
  const geos = useMemo(() => {
    const pts: Vector3[] = [];
    for (let i = 0; i <= 20; i++) pts.push(new Vector3(...catenaryPoint(a, b, sag, i / 20)));
    const wireGeo = new TubeGeometry(new CatmullRomCurve3(pts), 32, 0.006, 5);
    const stemParts: G[] = [];
    const bulbParts: G[] = [];
    for (let i = 1; i < bulbs; i++) {
      const [x, y, z] = catenaryPoint(a, b, sag, i / bulbs);
      stemParts.push(cyl(0.006, 0.006, 0.05, x, y - 0.025, z, 6));
      const s = new SphereGeometry(0.021, 10, 8);
      s.scale(1, 1.2, 1);
      s.translate(x, y - 0.075, z);
      bulbParts.push(s);
    }
    return { wire: wireGeo, stems: merged(stemParts), bulbs: merged(bulbParts) };
  }, [a, b, sag, bulbs]);
  return (
    <group>
      <mesh geometry={geos.wire} material={mats.wire} />
      <mesh geometry={geos.stems} material={mats.wire} />
      <mesh geometry={geos.bulbs} material={mats.bulb} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Faded teal screen door — frame, mesh panels, handle plate,          */
/* cross-brace. Stays dark: the mesh never shows an interior.          */
/* ------------------------------------------------------------------ */

function ScreenDoor() {
  const { mats } = assets();
  const frame = useMemo(() => merged([
    box(0.07, 2.1, 0.05, -0.415, 1.05, 0), box(0.07, 2.1, 0.05, 0.415, 1.05, 0),
    box(0.9, 0.07, 0.05, 0, 2.065, 0), box(0.9, 0.07, 0.05, 0, 0.035, 0),
    box(0.9, 0.055, 0.05, 0, 0.78, 0),
    tube([-0.38, 0.06, 0], [0.38, 0.75, 0], 0.016),
    box(0.05, 0.16, 0.02, 0.36, 1.02, 0.035),
  ]), []);
  return (
    <group position={[0.1, FLOOR_Y, -2.5]}>
      <mesh material={mats.trim}>
        <boxGeometry args={[1.02, 2.22, 0.1]} />
      </mesh>
      <mesh geometry={frame} material={mats.doorTeal} position={[0, 0.03, 0.045]} castShadow />
      <mesh material={mats.doorMesh} position={[0, 1.45, 0.045]}>
        <planeGeometry args={[0.76, 1.18]} />
      </mesh>
      <mesh material={mats.doorMesh} position={[0, 0.42, 0.045]}>
        <planeGeometry args={[0.76, 0.62]} />
      </mesh>
      <mesh material={mats.houseB} position={[0, 1.08, -0.02]}>
        <planeGeometry args={[0.9, 2.1]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Rocking chair — slatted back, wide armrests, curved rockers         */
/* (POR-01, dressing only, never a play seat). The throw (POR-07)      */
/* drapes over one back.                                               */
/* ------------------------------------------------------------------ */

function rockingChairGeos(): { frame: G; slats: G } {
  const frame: G[] = [];
  const slats: G[] = [];
  const seatY = 0.42;
  for (const sx of [-1, 1]) {
    frame.push(tube([sx * 0.24, 0.10, 0.20], [sx * 0.24, seatY, 0.20], 0.021));
    frame.push(tube([sx * 0.24, 0.10, -0.20], [sx * 0.24, seatY + 0.03, -0.20], 0.021));
    frame.push(tube([sx * 0.24, seatY + 0.03, -0.20], [sx * 0.24, 1.05, -0.30], 0.021));
    frame.push(tube([sx * 0.26, seatY + 0.16, 0.22], [sx * 0.26, seatY + 0.19, -0.24], 0.018));
    frame.push(tube([sx * 0.26, seatY + 0.02, 0.16], [sx * 0.26, seatY + 0.17, 0.20], 0.014));
    frame.push(tube([sx * 0.26, seatY + 0.02, -0.16], [sx * 0.26, seatY + 0.18, -0.22], 0.014));
    const rockerPts: Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const z = -0.42 + t * 0.88;
      rockerPts.push(new Vector3(sx * 0.26, 0.035 + Math.pow(Math.abs(t - 0.5) * 2, 2) * 0.055, z));
    }
    frame.push(new TubeGeometry(new CatmullRomCurve3(rockerPts), 16, 0.02, 7));
  }
  frame.push(box(0.52, 0.035, 0.05, 0, 0.13, 0.20));
  frame.push(box(0.52, 0.035, 0.05, 0, 0.13, -0.20));
  for (let i = 0; i < 5; i++) slats.push(box(0.44, 0.032, 0.018, 0, seatY + 0.005, -0.17 + i * 0.088));
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    slats.push(box(0.42, 0.085, 0.016, 0, seatY + 0.16 + t * 0.42, -0.215 - t * 0.075));
  }
  slats.push(box(0.44, 0.05, 0.02, 0, seatY + 0.63, -0.30));
  return { frame: merged(frame), slats: merged(slats) };
}

function RockingChair({ spot, throwPlaid }: { spot: { x: number; z: number; ry: number }; throwPlaid?: boolean }) {
  const { mats } = assets();
  const geos = useMemo(() => rockingChairGeos(), []);
  return (
    <group position={[spot.x, FLOOR_Y, spot.z]} rotation={[0, spot.ry, 0]}>
      <mesh geometry={geos.frame} material={mats.rockerWood} castShadow />
      <mesh geometry={geos.slats} material={mats.rockerWood} castShadow receiveShadow />
      {throwPlaid && (
        <mesh material={mats.plaid} position={[0.02, 0.88, -0.315]} rotation={[-0.16, 0, 0.03]} castShadow>
          <boxGeometry args={[0.4, 0.5, 0.016]} />
        </mesh>
      )}
    </group>
  );
}

/** Round side table (POR-06): turned-leg lathe profile, code. */
function SideTable({ spot }: { spot: { x: number; z: number } }) {
  const { mats } = assets();
  const geo = useMemo(() => {
    const parts: G[] = [cyl(0.275, 0.275, 0.025, 0, 0.64, 0, 22)];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      parts.push(tube([Math.cos(a) * 0.19, 0.63, Math.sin(a) * 0.19], [Math.cos(a) * 0.23, 0.02, Math.sin(a) * 0.23], 0.016));
    }
    parts.push(cyl(0.05, 0.07, 0.05, 0, 0.025, 0, 12));
    return merged(parts);
  }, []);
  return <mesh geometry={geo} material={mats.tableWood} position={[spot.x, FLOOR_Y, spot.z]} castShadow receiveShadow />;
}

/** Potted plant (POR-05): pot + two foliage blobs. */
function PottedPlant({ spot, pot }: { spot: { x: number; z: number; s?: number }; pot: 'terra' | 'dark' }) {
  const { mats } = assets();
  const s = spot.s ?? 1;
  return (
    <group position={[spot.x, FLOOR_Y, spot.z]} scale={s}>
      <mesh material={pot === 'terra' ? mats.terra : mats.potDark} position={[0, 0.13, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.095, 0.26, 12]} />
      </mesh>
      <mesh material={mats.leafA} position={[0, 0.38, 0]} castShadow>
        <sphereGeometry args={[0.17, 10, 8]} />
      </mesh>
      <mesh material={mats.leafB} position={[0.07, 0.5, 0.04]} castShadow>
        <sphereGeometry args={[0.12, 9, 7]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Railing run (POR-04): top + bottom rails, balusters, newel posts.   */
/* ------------------------------------------------------------------ */

function RailingRun({ from, to }: { from: [number, number]; to: [number, number] }) {
  const { mats } = assets();
  const geo = useMemo(() => {
    const [ax, az] = from; const [bx, bz] = to;
    const len = Math.hypot(bx - ax, bz - az);
    const parts: G[] = [];
    parts.push(box(len, 0.055, 0.09, len / 2, 0.885, 0));
    parts.push(box(len, 0.04, 0.05, len / 2, 0.10, 0));
    const n = Math.max(2, Math.round(len / 0.14));
    for (let i = 0; i <= n; i++) parts.push(box(0.028, 0.76, 0.028, (i / n) * len, 0.49, 0));
    parts.push(box(0.09, 0.95, 0.09, 0.02, 0.475, 0));
    parts.push(box(0.09, 0.95, 0.09, len - 0.02, 0.475, 0));
    parts.push(box(0.12, 0.04, 0.12, 0.02, 0.965, 0));
    parts.push(box(0.12, 0.04, 0.12, len - 0.02, 0.965, 0));
    const g = merged(parts);
    const ang = Math.atan2(bz - az, bx - ax);
    g.applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -ang));
    g.translate(ax, FLOOR_Y, az);
    return g;
  }, [from, to]);
  return <mesh geometry={geo} material={mats.postPaint} castShadow receiveShadow />;
}

/* ------------------------------------------------------------------ */
/* Porch lights — golden hour: a warm sun raking in from the street    */
/* side (the room's one shadow caster), table and edge points.         */
/* ------------------------------------------------------------------ */

function EnvFog() {
  const { scene } = useThree();
  useEffect(() => {
    const prev = scene.fog;
    scene.fog = new Fog('#4a3040', 10, 26);
    return () => { scene.fog = prev; };
  }, [scene]);
  return null;
}

function PorchLights() {
  return (
    <group>
      <hemisphereLight args={['#ffd9a8', '#4a3423', 0.65]} />
      <directionalLight
        position={[6.5, 3.4, 7.5]}
        target-position={[0, -0.4, -1.5]}
        color="#ffc07d"
        intensity={1.6}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-camera-far={30}
        shadow-bias={-0.0004}
      />
      {/* fills kept low: the venue rig already keys the table —
          the first production capture stacked into a blown pool
          at centre-felt */}
      <pointLight position={[0, 0.9, 0]} color="#ffc98a" intensity={5} distance={7} decay={1.6} />
      <pointLight position={[-2.6, 1.6, 1.6]} color="#ffab54" intensity={4} distance={6} decay={1.7} />
      <pointLight position={[0.1, 1.4, -2.0]} color="#ff9e45" intensity={4} distance={4.5} decay={1.8} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* The room                                                            */
/* ------------------------------------------------------------------ */

export default function PorchDeckRoom() {
  const { mats } = assets();
  const ceilY = FLOOR_Y + 3.08;
  return (
    <group>
      <EnvFog />
      <PorchLights />
      <FoldingChairs />

      {/* plank deck, top at the floor line */}
      <mesh material={mats.deckWood} position={[0, FLOOR_Y - 0.05, 0]} receiveShadow>
        <boxGeometry args={[7.6, 0.1, 4.8]} />
      </mesh>
      <mesh material={mats.postPaint} position={[0, FLOOR_Y - 0.06, 2.42]}>
        <boxGeometry args={[7.6, 0.14, 0.06]} />
      </mesh>
      {/* back wall: weatherboard siding (3.2 m — camera containment) */}
      <mesh material={mats.siding} position={[0, FLOOR_Y + 1.6, -2.62]} receiveShadow>
        <boxGeometry args={[7.6, 3.2, 0.16]} />
      </mesh>
      {/* side returns: the house wraps only the back portion */}
      {[-3.85, 3.85].map((x) => (
        <mesh key={x} material={mats.siding} position={[x, FLOOR_Y + 1.6, -1.62]} receiveShadow>
          <boxGeometry args={[0.16, 3.2, 2.0]} />
        </mesh>
      ))}
      {/* beadboard ceiling: single-sided downward plane at deck +
          3.2 (invisible from above — production cube-room
          discipline, see the file header), beams + fascia */}
      <mesh material={mats.beadboard} rotation={[Math.PI / 2, 0, 0]} position={[0, FLOOR_Y + 3.2, 0]} receiveShadow>
        <planeGeometry args={[7.6, 4.8]} />
      </mesh>
      {[-1.2, 1.2].map((z) => (
        <mesh key={z} material={mats.postPaint} position={[0, FLOOR_Y + 3.13, z]}>
          <boxGeometry args={[7.6, 0.1, 0.14]} />
        </mesh>
      ))}
      <mesh material={mats.postPaint} position={[0, FLOOR_Y + 3.08, 2.42]}>
        <boxGeometry args={[7.6, 0.26, 0.06]} />
      </mesh>
      {/* windows: warm lit left of the door, sleeping dark right */}
      <group position={[-1.9, FLOOR_Y, -2.5]}>
        <mesh material={mats.trim} position={[0, 1.55, 0]}>
          <boxGeometry args={[1.06, 1.36, 0.1]} />
        </mesh>
        <mesh material={mats.litWin} position={[0, 1.55, 0.06]}>
          <planeGeometry args={[0.88, 1.18]} />
        </mesh>
        <mesh material={mats.trim} position={[0, 1.55, 0.075]}>
          <boxGeometry args={[0.05, 1.18, 0.02]} />
        </mesh>
        <mesh material={mats.trim} position={[0, 1.55, 0.075]}>
          <boxGeometry args={[0.88, 0.05, 0.02]} />
        </mesh>
      </group>
      <group position={[2.1, FLOOR_Y, -2.5]}>
        <mesh material={mats.trim} position={[0, 1.55, 0]}>
          <boxGeometry args={[1.06, 1.36, 0.1]} />
        </mesh>
        <mesh material={mats.darkWin} position={[0, 1.55, 0.06]}>
          <planeGeometry args={[0.88, 1.18]} />
        </mesh>
        <mesh material={mats.trim} position={[0, 1.55, 0.075]}>
          <boxGeometry args={[0.05, 1.18, 0.02]} />
        </mesh>
        <mesh material={mats.trim} position={[0, 1.55, 0.075]}>
          <boxGeometry args={[0.88, 0.05, 0.02]} />
        </mesh>
      </group>
      <ScreenDoor />
      {/* POR-08: support posts at the open edge (3.2 m line) */}
      {[-3.3, 3.3].map((x) => (
        <group key={x} position={[x, FLOOR_Y, 2.1]}>
          <mesh material={mats.postPaint} position={[0, 1.6, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.14, 3.2, 0.14]} />
          </mesh>
          <mesh material={mats.postPaint} position={[0, 0.09, 0]}>
            <boxGeometry args={[0.2, 0.18, 0.2]} />
          </mesh>
          <mesh material={mats.postPaint} position={[0, 3.12, 0]}>
            <boxGeometry args={[0.19, 0.14, 0.19]} />
          </mesh>
        </group>
      ))}
      {/* railing: front-left + front-right with the steps gap */}
      <RailingRun from={[-3.3, 2.1]} to={[-0.75, 2.1]} />
      <RailingRun from={[0.95, 2.1]} to={[3.3, 2.1]} />
      <RailingRun from={[-3.3, 2.1]} to={[-3.3, 0.4]} />
      {/* steps down at the door axis */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} material={mats.deckWood} position={[0.1, FLOOR_Y - 0.12 * (i + 1) + 0.06, 2.62 + i * 0.3]} receiveShadow castShadow>
          <boxGeometry args={[1.5, 0.09, 0.32]} />
        </mesh>
      ))}
      {/* yard, sidewalk, street */}
      <mesh material={mats.lawnDark} rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y - 0.37, 5.6]} receiveShadow>
        <planeGeometry args={[30, 6.4]} />
      </mesh>
      <mesh material={mats.concrete} position={[0, FLOOR_Y - 0.345, 6.4]} receiveShadow>
        <boxGeometry args={[30, 0.05, 1.6]} />
      </mesh>
      <mesh material={mats.asphalt} rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y - 0.38, 10.6]} receiveShadow>
        <planeGeometry args={[40, 7]} />
      </mesh>
      {/* across the street: porch silhouettes against the dusk */}
      {[
        { x: -7.5, mat: 'houseA', w: 5.4, h: 3.4 },
        { x: -1.2, mat: 'houseB', w: 6.2, h: 4.1 },
        { x: 5.6, mat: 'houseA', w: 5.8, h: 3.7 },
      ].map((hh, i) => (
        <group key={i} position={[hh.x, FLOOR_Y - 0.38, 14.6]} rotation={[0, Math.PI, 0]}>
          <mesh material={mats[hh.mat]} position={[0, hh.h / 2, 0]}>
            <boxGeometry args={[hh.w, hh.h, 0.4]} />
          </mesh>
          <mesh material={mats[hh.mat]} position={[0, hh.h + 0.5, 0]}>
            <boxGeometry args={[hh.w + 0.5, 1.0, 0.5]} />
          </mesh>
          <mesh material={mats.litWin} position={[-hh.w / 4, 1.15, -0.26]}>
            <planeGeometry args={[0.62, 0.85]} />
          </mesh>
          <mesh material={mats.litWin} position={[hh.w / 4, 1.15, -0.26]}>
            <planeGeometry args={[0.62, 0.85]} />
          </mesh>
        </group>
      ))}
      {/* dusk sky */}
      <mesh material={mats.sky} position={[0, 3.4, 20]}>
        <planeGeometry args={[70, 16]} />
      </mesh>
      {/* string lights (POR-03): ceiling front edge + west perimeter + railing swag */}
      <StringLights a={[-3.3, ceilY, 2.02]} b={[3.3, ceilY, 2.02]} sag={0.30} bulbs={17} />
      <StringLights a={[-3.3, ceilY, 2.02]} b={[-3.3, ceilY, -2.35]} sag={0.34} bulbs={11} />
      <StringLights a={[-3.3, FLOOR_Y + 0.92, 2.14]} b={[-0.78, FLOOR_Y + 0.92, 2.14]} sag={0.13} bulbs={7} />
      {/* dressing: rockers on the west flank, side table, plants */}
      <RockingChair spot={{ x: -3.0, z: -1.55, ry: Math.PI / 2 + 0.35 }} throwPlaid />
      <RockingChair spot={{ x: -3.05, z: 0.15, ry: Math.PI / 2 - 0.2 }} />
      <SideTable spot={{ x: -2.95, z: -0.7 }} />
      <group position={[-2.95, FLOOR_Y + 0.66, -0.7]} scale={0.62}>
        <mesh material={mats.terra} position={[0, 0.13, 0]} castShadow>
          <cylinderGeometry args={[0.13, 0.095, 0.26, 12]} />
        </mesh>
        <mesh material={mats.leafA} position={[0, 0.38, 0]} castShadow>
          <sphereGeometry args={[0.17, 10, 8]} />
        </mesh>
      </group>
      <PottedPlant spot={{ x: 2.9, z: -2.1 }} pot="terra" />
      <PottedPlant spot={{ x: 3.15, z: -1.75, s: 0.8 }} pot="dark" />
      <PottedPlant spot={{ x: 2.7, z: -1.8, s: 0.66 }} pot="terra" />
      <PottedPlant spot={{ x: -2.2, z: 1.75, s: 0.85 }} pot="dark" />
    </group>
  );
}
