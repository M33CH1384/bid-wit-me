import { useEffect, useMemo } from 'react';
import {
  BackSide, BoxGeometry, CanvasTexture, CatmullRomCurve3, ColorManagement, CylinderGeometry,
  DoubleSide, Fog, MeshStandardMaterial, Quaternion, RepeatWrapping, SRGBColorSpace,
  SphereGeometry, TubeGeometry, Vector3,
} from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHAIR_SPOTS } from './classicStudioLayout';

/** The shared table's floor plane (sibling rooms keep their own). */
const FLOOR_Y = -0.9;

/**
 * THE ROOFTOP — story Stop 7's 3D room (Poet & Seven).
 *
 * Mounted by Scene only for a story table carrying stop
 * `rooftop` at High quality; every other rooftop table — and
 * Low quality everywhere — keeps the shipped RooftopRoom (the
 * cube room), untouched (pinned in test/rooftop-dusk-room.test.ts).
 * Sandbox-certified (RooftopCodeRoom in the immersive sandbox,
 * Batch 5b): a tar-and-gravel rooftop at SUNSET — the route's
 * quiet, slow-beat room. The game table near roof centre; the
 * wooden water tower (ROO-01) behind the far seat, left of
 * centre, as the landmark; a low concrete parapet (ROO-02,
 * H 1.05) enclosing the roof on all four sides at distance;
 * string lights on poles (ROO-03) on PERIMETER RUNS ONLY along
 * the parapet lines; the pigeon coop (ROO-04) as foreground
 * dressing off-axis; bulkhead hut (ROO-05), vent pipe cluster
 * (ROO-06), crate cluster (ROO-07) and a TV antenna (ROO-08)
 * on the bulkhead roof. The skyline is distant environment:
 * far silhouette geometry at 34 m+ under a gradient sunset
 * dome — never a backdrop plane in the room.
 *
 * Route: ALL CODE, zero downloads — the water tower is timber
 * staves + steel bands + trestle frame, the coop is plank
 * construction; nothing here is a proven code-fails class.
 *
 * Standing-camera discipline (gate added 2026-10-28): open
 * air, no roof plane, nothing spans the table. String-light
 * catenaries run ONLY along the parapet lines at |x| or
 * |z| = 7.2 — behind every seat and far outside the felt
 * (half-extents 1.50 × 1.78 + 0.20 rail) — so no strand, pole,
 * the antenna or the tower can band across the felt or cross
 * the table view; they frame at the frame's top/edges only.
 *
 * Seat back-clearances (kit chair back = 0.274 m behind the
 * CHAIR_SPOTS origin): parapet inner faces at ±7.5 → far seat
 * (0, −2.45) back at z −2.72 → 4.78 m; player (0, +2.80) back
 * at z +3.07 → 4.43 m; west (−2.30, 0) back at x −2.57 →
 * 4.93 m; east (+2.30, 0) back at x +2.57 → 4.93 m. The
 * tower's nearest trestle leg (base −1.45, −5.10) stands
 * 2.78 m from the far seat's chair-back point. All ≥ 0.6 m.
 *
 * HARD EXCLUSIONS (manifest): no live pigeons/birds (the coop
 * stands empty), no text/signs anywhere, no roof-terrace
 * furniture (no planters, no loungers).
 *
 * Effects: `fxOn` (= !reduceFx at this table) gates the
 * string-light glow life — a gentle deterministic bulb
 * shimmer — and the sunset directional's shadows. Effects
 * off = the same room, one static frame. The room renders
 * no table: the shared game table is the anchor.
 */

/* ------------------------------------------------------------------ */
/* Layout constants — the standing + clearance discipline lives here.  */
/* ------------------------------------------------------------------ */

/** Parapet inner faces at ±PARAPET_FACE on both axes. */
const PARAPET_FACE = 7.5;
/** String-light runs sit on the parapet lines, 0.3 m inside the face. */
const STRING_RUN_LINE = 7.2;
/** Poles (ROO-03): H 3.00 over the deck. */
const POLE_H = 3.0;
/** Water tower (ROO-01): centre behind the far seat, left of centre. */
const TOWER_POS: [number, number] = [-2.5, -6.15];

/* ------------------------------------------------------------------ */
/* small builders (sibling rooms keep their own copies by design)      */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(
  w: number, h: number,
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  repeat?: [number, number],
) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d')!, w, h);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, rnd: () => number, alpha: number, light: boolean) {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(rnd() * 255);
    ctx.fillStyle = light
      ? `rgba(255,244,214,${(alpha * rnd()).toFixed(3)})`
      : `rgba(${v},${v},${v},${(alpha * rnd()).toFixed(3)})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

type MatOpts = {
  color?: string; map?: CanvasTexture; roughness: number; metalness: number;
  emissive?: string; emissiveMap?: CanvasTexture; emissiveIntensity?: number;
  side?: MeshStandardMaterial['side']; transparent?: boolean; alphaTest?: number;
};
function std(o: MatOpts) {
  return new MeshStandardMaterial({
    color: o.color ?? '#ffffff', map: o.map ?? null,
    roughness: o.roughness, metalness: o.metalness,
    emissive: o.emissive ?? '#000000', emissiveMap: o.emissiveMap ?? null,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    ...(o.side ? { side: o.side } : {}),
    ...(o.transparent ? { transparent: true } : {}),
    ...(o.alphaTest ? { alphaTest: o.alphaTest } : {}),
  });
}

type G = BoxGeometry | CylinderGeometry | SphereGeometry | TubeGeometry;
function box(w: number, h: number, d: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const geo = new BoxGeometry(w, h, d);
  if (rx) geo.rotateX(rx);
  if (ry) geo.rotateY(ry);
  if (rz) geo.rotateZ(rz);
  geo.translate(x, y, z);
  return geo;
}
function cyl(rt: number, rb: number, h: number, x = 0, y = 0, z = 0, seg = 12) {
  const geo = new CylinderGeometry(rt, rb, h, seg);
  geo.translate(x, y, z);
  return geo;
}
function tube(a: [number, number, number], b: [number, number, number], r: number) {
  const [ax, ay, az] = a, [bx, by, bz] = b;
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  const geo = new CylinderGeometry(r, r, len, 8);
  geo.translate(0, len / 2, 0);
  const dir = new Vector3(bx - ax, by - ay, bz - az).normalize();
  geo.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir));
  geo.translate(ax, ay, az);
  return geo;
}
function merged(parts: G[]) {
  const norm = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const g = mergeGeometries(norm as never[], false);
  for (const p of parts) (p as { dispose?: () => void }).dispose?.();
  return g!;
}

/* ------------------------------------------------------------------ */
/* textures                                                             */
/* ------------------------------------------------------------------ */

/** Tar-and-gravel deck: dark tar body, dense gravel speckle, seams. */
function makeTarGravelTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(70707);
    ctx.fillStyle = '#37343b'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 15000; i++) {
      const v = 55 + rnd() * 120;
      ctx.fillStyle = `rgba(${Math.round(v)},${Math.round(v * 0.97)},${Math.round(v * 1.05)},0.8)`;
      ctx.fillRect(rnd() * w, rnd() * h, 1.4 + rnd() * 1.8, 1.4 + rnd() * 1.8);
    }
    ctx.strokeStyle = 'rgba(10,9,11,0.8)'; ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(12,11,13,0.45)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, h * 0.52); ctx.lineTo(w, h * 0.49); ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const x = rnd() * w, y = rnd() * h, r = 30 + rnd() * 80;
      const p = ctx.createRadialGradient(x, y, 2, x, y, r);
      p.addColorStop(0, `rgba(150,146,150,${(0.05 + rnd() * 0.07).toFixed(2)})`);
      p.addColorStop(1, 'rgba(150,146,150,0)');
      ctx.fillStyle = p; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    speckle(ctx, w, h, 2400, rnd, 0.10, false);
  }, [6, 6]);
}

/** Parapet concrete: grey body, vertical water streaks, grime foot. */
function makeParapetTexture() {
  return canvasTex(512, 256, (ctx, w, h) => {
    const rnd = mulberry32(8123);
    ctx.fillStyle = '#7e7e85'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 7000, rnd, 0.09, true);
    speckle(ctx, w, h, 7000, rnd, 0.12, false);
    for (let i = 0; i < 26; i++) {
      const x = rnd() * w, len = h * (0.3 + rnd() * 0.65), wd = 3 + rnd() * 9;
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, `rgba(28,27,30,${(0.20 + rnd() * 0.22).toFixed(2)})`);
      g.addColorStop(1, 'rgba(28,27,30,0)');
      ctx.fillStyle = g; ctx.fillRect(x, 0, wd, len);
    }
    const foot = ctx.createLinearGradient(0, h - 60, 0, h);
    foot.addColorStop(0, 'rgba(20,19,22,0)'); foot.addColorStop(1, 'rgba(20,19,22,0.42)');
    ctx.fillStyle = foot; ctx.fillRect(0, h - 60, w, 60);
    ctx.fillStyle = 'rgba(196,194,198,0.5)'; ctx.fillRect(0, 0, w, 7);
    for (let i = 0; i < 40; i++) ctx.fillRect(rnd() * w, rnd() * 8, 2 + rnd() * 6, 2 + rnd() * 4);
  }, [5, 1]);
}

/** Water-tower staves: vertical weathered-brown timber boards. */
function makeTimberTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(6161);
    const pw = 46;
    for (let x = 0; x < w; x += pw) {
      const v = 0.80 + rnd() * 0.34;
      ctx.fillStyle = `rgb(${Math.round(122 * v)},${Math.round(94 * v)},${Math.round(64 * v)})`;
      ctx.fillRect(x, 0, pw - 3, h);
      ctx.fillStyle = 'rgba(26,18,10,0.9)'; ctx.fillRect(x + pw - 3, 0, 3, h);
      ctx.strokeStyle = 'rgba(52,36,20,0.4)'; ctx.lineWidth = 1.3;
      for (let gLine = 0; gLine < 5; gLine++) {
        const gy = rnd() * h;
        ctx.beginPath(); ctx.moveTo(x + 3, gy);
        ctx.bezierCurveTo(x + pw * 0.3, gy + 4, x + pw * 0.6, gy - 4, x + pw - 5, gy + 2);
        ctx.stroke();
      }
    }
    const top = ctx.createLinearGradient(0, 0, 0, 90);
    top.addColorStop(0, 'rgba(230,200,150,0.20)'); top.addColorStop(1, 'rgba(230,200,150,0)');
    ctx.fillStyle = top; ctx.fillRect(0, 0, w, 90);
    const foot = ctx.createLinearGradient(0, h - 110, 0, h);
    foot.addColorStop(0, 'rgba(24,18,12,0)'); foot.addColorStop(1, 'rgba(24,18,12,0.38)');
    ctx.fillStyle = foot; ctx.fillRect(0, h - 110, w, 110);
    speckle(ctx, w, h, 2600, rnd, 0.09, false);
  }, [3, 1]);
}

/** Weathered pale planks (coop + crates): horizontal boards. */
function makeWeatheredPlankTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(4249);
    const rows = 5, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      const v = 0.82 + rnd() * 0.3;
      ctx.fillStyle = `rgb(${Math.round(148 * v)},${Math.round(124 * v)},${Math.round(94 * v)})`;
      ctx.fillRect(0, r * rh + 2, w, rh - 4);
      ctx.strokeStyle = 'rgba(58,44,28,0.5)';
      for (let gLine = 0; gLine < 6; gLine++) {
        ctx.beginPath();
        const gy = r * rh + 8 + rnd() * (rh - 16);
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(w * 0.3, gy + (rnd() - 0.5) * 6, w * 0.7, gy + (rnd() - 0.5) * 6, w, gy);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(34,26,16,0.85)';
      for (const nx of [16, w - 16]) for (const ny of [r * rh + 13, r * rh + rh - 13]) {
        ctx.beginPath(); ctx.arc(nx, ny, 3.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    speckle(ctx, w, h, 3200, rnd, 0.09, false);
  });
}

/** Wire mesh (coop front): a plain grid on transparency. */
function makeMeshTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(168,170,174,0.95)'; ctx.lineWidth = 2;
    for (let i = 0; i <= w; i += 16) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke();
    }
  }, [3, 2]);
}

/** Sunset sky: slate-violet up top melting to amber at the horizon. */
function makeSunsetSkyTexture() {
  return canvasTex(1024, 512, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1d2447');
    grad.addColorStop(0.30, '#47406e');
    grad.addColorStop(0.44, '#8a5570');
    grad.addColorStop(0.50, '#d97e52');
    grad.addColorStop(0.54, '#f7a95c');
    grad.addColorStop(0.58, '#7a4450');
    grad.addColorStop(1, '#241722');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    const sun = ctx.createRadialGradient(w * 0.30, h * 0.53, 8, w * 0.30, h * 0.53, 340);
    sun.addColorStop(0, 'rgba(255,205,130,0.85)');
    sun.addColorStop(1, 'rgba(255,205,130,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h);
  });
}

/** Distant tower facade: near-black body, sparse lit windows. */
function makeSkylineTexture() {
  return canvasTex(256, 512, (ctx, w, h) => {
    const rnd = mulberry32(9026);
    ctx.fillStyle = '#141824'; ctx.fillRect(0, 0, w, h);
    for (let y = 14; y < h - 10; y += 22) {
      for (let x = 12; x < w - 12; x += 20) {
        if (rnd() > 0.30) continue;
        const warm = rnd() > 0.25;
        ctx.fillStyle = warm ? 'rgba(255,205,130,0.95)' : 'rgba(190,215,255,0.85)';
        ctx.fillRect(x, y, 9, 12);
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* cached assets                                                        */
/* ------------------------------------------------------------------ */

type RoofAssets = {
  tar: MeshStandardMaterial; parapet: MeshStandardMaterial; coping: MeshStandardMaterial;
  timber: MeshStandardMaterial; trestle: MeshStandardMaterial; steelBand: MeshStandardMaterial;
  roofCone: MeshStandardMaterial; plankOld: MeshStandardMaterial; meshWire: MeshStandardMaterial;
  coopDark: MeshStandardMaterial; bulkWall: MeshStandardMaterial; bulkDoor: MeshStandardMaterial;
  tarPaper: MeshStandardMaterial; galv: MeshStandardMaterial; rust: MeshStandardMaterial;
  alu: MeshStandardMaterial; sky: MeshStandardMaterial; skyline: MeshStandardMaterial;
  bulb: MeshStandardMaterial; wire: MeshStandardMaterial; pole: MeshStandardMaterial;
  steelBlack: MeshStandardMaterial; chairPanel: MeshStandardMaterial;
};

let ASSETS: RoofAssets | null = null;
function assets(): RoofAssets {
  if (ASSETS) return ASSETS;
  ColorManagement.enabled = true;
  const skylineTex = makeSkylineTexture();
  ASSETS = {
    tar: std({ map: makeTarGravelTexture(), roughness: 1, metalness: 0 }),
    parapet: std({ map: makeParapetTexture(), roughness: 0.95, metalness: 0 }),
    coping: std({ color: '#8b8b90', roughness: 0.9, metalness: 0 }),
    timber: std({ map: makeTimberTexture(), roughness: 0.88, metalness: 0 }),
    trestle: std({ color: '#5d4630', roughness: 0.92, metalness: 0 }),
    steelBand: std({ color: '#2c2e33', roughness: 0.45, metalness: 0.8 }),
    roofCone: std({ color: '#4c3a2c', roughness: 0.9, metalness: 0.05 }),
    plankOld: std({ map: makeWeatheredPlankTexture(), roughness: 0.92, metalness: 0 }),
    meshWire: std({
      map: makeMeshTexture(), transparent: true, alphaTest: 0.3,
      color: '#c9cbce', roughness: 0.5, metalness: 0.6, side: DoubleSide,
    }),
    coopDark: std({ color: '#17130f', roughness: 1, metalness: 0 }),
    bulkWall: std({ color: '#77726c', roughness: 0.94, metalness: 0 }),
    bulkDoor: std({ color: '#3e4448', roughness: 0.55, metalness: 0.6 }),
    tarPaper: std({ color: '#232126', roughness: 0.98, metalness: 0 }),
    galv: std({ color: '#9aa0a4', roughness: 0.42, metalness: 0.85 }),
    rust: std({ color: '#7a4a2c', roughness: 0.8, metalness: 0.4 }),
    alu: std({ color: '#b9bcbe', roughness: 0.35, metalness: 0.85 }),
    sky: new MeshStandardMaterial({ map: makeSunsetSkyTexture(), roughness: 1, metalness: 0, fog: false, side: BackSide }),
    skyline: std({
      map: skylineTex, emissive: '#ffcf8a', emissiveMap: skylineTex,
      emissiveIntensity: 0.5, color: '#9aa2b8', roughness: 1, metalness: 0,
    }),
    bulb: std({ color: '#ffb85e', emissive: '#ff9e45', emissiveIntensity: 2.2, roughness: 0.3, metalness: 0 }),
    wire: std({ color: '#0c0c0d', roughness: 0.7, metalness: 0.2 }),
    pole: std({ color: '#1c1d20', roughness: 0.5, metalness: 0.65 }),
    steelBlack: std({ color: '#101114', roughness: 0.42, metalness: 0.72 }),
    chairPanel: std({ color: '#17382b', roughness: 0.62, metalness: 0.05 }),
  };
  return ASSETS;
}

/* ------------------------------------------------------------------ */
/* fog + lights                                                         */
/* ------------------------------------------------------------------ */

function EnvFog() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const prev = scene.fog;
    // sunset register: Cookout's dusk family, pushed long so the
    // 34 m+ skyline fades into it instead of vanishing
    scene.fog = new Fog('#3d2638', 14, 52);
    return () => { scene.fog = prev; };
  }, [scene]);
  return null;
}

function RooftopLights({ fxOn }: { fxOn: boolean }) {
  return (
    <>
      <hemisphereLight args={['#a87fc0', '#57403a', 1.05]} />
      <directionalLight
        position={[-8, 5.5, -3]}
        target-position={[0, -0.7, 0]}
        color="#ff9a50"
        intensity={1.5}
        castShadow={fxOn}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-10} shadow-camera-right={10}
        shadow-camera-top={10} shadow-camera-bottom={-10}
        shadow-bias={-0.0004}
      />
      {/* string-light pool over the table */}
      <pointLight position={[0, 1.85, -0.4]} intensity={11} distance={9} decay={2} color="#ffb45e" />
      {/* warm lift on the tower + far deck so the landmark reads */}
      <pointLight position={[-2.5, 2.6, -5.0]} intensity={5} distance={11} decay={2} color="#ff9e50" />
      {/* a low cool fill so the east seats don't fall to black */}
      <pointLight position={[4.5, 1.2, 3.5]} intensity={2.4} distance={8} decay={2} color="#7a86c8" />
    </>
  );
}

/** The string-light glow life: a gentle deterministic bulb
 *  shimmer when fxOn; effects off holds one static frame. */
function BulbShimmer({ a, fxOn }: { a: RoofAssets; fxOn: boolean }) {
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    a.bulb.emissiveIntensity = fxOn
      ? 2.2 + Math.sin(t * 1.7) * 0.12 + Math.sin(t * 4.3 + 1.3) * 0.06
      : 2.2;
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* the four seats — the kit folding chair at owner scale (H 0.90,      */
/* seat ~0.49), at the shared table's anchors (CHAIR_SPOTS import)     */
/* ------------------------------------------------------------------ */

function chairFrameGeo() {
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

function chairPanelGeo() {
  return merged([
    box(0.43, 0.028, 0.40, 0, 0.478, 0),
    box(0.43, 0.23, 0.024, 0, 0.775, -0.2435, -0.10),
  ]);
}

function FoldingChairs({ a }: { a: RoofAssets }) {
  const frame = useMemo(chairFrameGeo, []);
  const panels = useMemo(chairPanelGeo, []);
  return (
    <group>
      {CHAIR_SPOTS.map((s, i) => (
        <group key={i} position={[s.x, FLOOR_Y, s.z]} rotation={[0, s.ry, 0]}>
          <mesh geometry={frame} material={a.steelBlack} castShadow receiveShadow />
          <mesh geometry={panels} material={a.chairPanel} castShadow receiveShadow />
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* ROO-01 — the water tower: timber trestle frame (legs splay from     */
/* ±1.05 at the deck to ±0.80 at the tank, X-braces on all four        */
/* faces) to h 2.25; the stave tank (Ø 2.60, H 3.00) with steel        */
/* bands; a conical roof to a total H of 6.00. Plus a side ladder.     */
/* Local: floor y=0.                                                   */
/* ------------------------------------------------------------------ */

function WaterTower({ a }: { a: RoofAssets }) {
  const frame = useMemo(() => {
    const parts: G[] = [];
    const baseH = 1.05, topH = 0.80, frameH = 2.25;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      parts.push(tube([sx * baseH, 0, sz * baseH], [sx * topH, frameH, sz * topH], 0.075));
      parts.push(box(0.24, 0.10, 0.24, sx * baseH, 0.05, sz * baseH));
    }
    for (const s of [-1, 1]) {
      parts.push(tube([-baseH, 0.15, s * baseH], [topH, frameH - 0.15, s * topH], 0.038));
      parts.push(tube([baseH, 0.15, s * baseH], [-topH, frameH - 0.15, s * topH], 0.038));
      parts.push(box(2 * baseH, 0.09, 0.06, 0, 1.12, s * (baseH + topH) / 2));
      parts.push(tube([s * baseH, 0.15, -baseH], [s * topH, frameH - 0.15, topH], 0.038));
      parts.push(tube([s * baseH, 0.15, baseH], [s * topH, frameH - 0.15, -topH], 0.038));
      parts.push(box(0.06, 0.09, 2 * baseH, s * (baseH + topH) / 2, 1.12, 0));
    }
    parts.push(box(1.95, 0.14, 0.16, 0, frameH - 0.02, -0.80));
    parts.push(box(1.95, 0.14, 0.16, 0, frameH - 0.02, 0.80));
    parts.push(box(0.16, 0.14, 1.95, -0.80, frameH - 0.02, 0));
    parts.push(box(0.16, 0.14, 1.95, 0.80, frameH - 0.02, 0));
    return merged(parts);
  }, []);
  const bands = useMemo(() => {
    const parts: G[] = [];
    for (const y of [2.55, 3.45, 4.35, 5.10]) parts.push(cyl(1.315, 1.315, 0.055, 0, y, 0, 28));
    return merged(parts);
  }, []);
  const ladder = useMemo(() => {
    const parts: G[] = [];
    parts.push(tube([1.02, 0.1, -0.18], [0.86, 5.2, -0.18], 0.022));
    parts.push(tube([1.02, 0.1, 0.18], [0.86, 5.2, 0.18], 0.022));
    for (let y = 0.45; y < 5.1; y += 0.38) {
      const x = 1.02 + (0.86 - 1.02) * (y / 5.2);
      parts.push(tube([x, y, -0.18], [x, y, 0.18], 0.014));
    }
    return merged(parts);
  }, []);
  return (
    <group position={[TOWER_POS[0], FLOOR_Y, TOWER_POS[1]]}>
      <mesh geometry={frame} material={a.trestle} castShadow receiveShadow />
      {/* the stave tank: Ø 2.60, H 3.00, sill at h 2.25 */}
      <mesh material={a.timber} position={[0, 2.25 + 1.5, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.30, 1.34, 3.0, 24]} />
      </mesh>
      <mesh geometry={bands} material={a.steelBand} />
      {/* conical roof: base h 5.25, apex h 6.00 — total H 6.00 */}
      <mesh material={a.roofCone} position={[0, 5.25 + 0.375, 0]} castShadow>
        <coneGeometry args={[1.58, 0.75, 24]} />
      </mesh>
      <mesh material={a.steelBand} position={[0, 5.28, 0]}>
        <cylinderGeometry args={[1.42, 1.46, 0.07, 24]} />
      </mesh>
      <mesh geometry={ladder} material={a.steelBand} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* ROO-02 — the parapet: H 1.05 concrete runs on all four sides,       */
/* inner faces at ±7.5, chipped coping cap on top.                     */
/* ------------------------------------------------------------------ */

function Parapet({ a }: { a: RoofAssets }) {
  const walls = useMemo(() => {
    const C = PARAPET_FACE + 0.15, L = 2 * C + 0.3;
    return merged([
      box(L, 1.05, 0.30, 0, 0.525, -C),
      box(L, 1.05, 0.30, 0, 0.525, C),
      box(0.30, 1.05, L, -C, 0.525, 0),
      box(0.30, 1.05, L, C, 0.525, 0),
    ]);
  }, []);
  const coping = useMemo(() => {
    const C = PARAPET_FACE + 0.15, L = 2 * C + 0.36;
    return merged([
      box(L, 0.07, 0.38, 0, 1.085, -C),
      box(L, 0.07, 0.38, 0, 1.085, C),
      box(0.38, 0.07, L, -C, 1.085, 0),
      box(0.38, 0.07, L, C, 1.085, 0),
    ]);
  }, []);
  return (
    <group position={[0, FLOOR_Y, 0]}>
      <mesh geometry={walls} material={a.parapet} castShadow receiveShadow />
      <mesh geometry={coping} material={a.coping} castShadow receiveShadow />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* ROO-03 — string lights on poles: poles H 3.00 at the corners and    */
/* at ±3.6 offsets (never on a seat's centre axis), strands ONLY       */
/* along the parapet lines at |x|/|z| = STRING_RUN_LINE.               */
/* ------------------------------------------------------------------ */

const POLE_SPOTS: [number, number][] = [
  [-7.2, -7.2], [-3.6, -7.2], [3.6, -7.2], [7.2, -7.2],
  [-7.2, 7.2], [-3.6, 7.2], [3.6, 7.2], [7.2, 7.2],
  [-7.2, -3.6], [-7.2, 3.6], [7.2, -3.6], [7.2, 3.6],
];

function StringLightPoles({ a }: { a: RoofAssets }) {
  const geo = useMemo(() => {
    const parts: G[] = [];
    for (const [x, z] of POLE_SPOTS) {
      parts.push(cyl(0.035, 0.045, POLE_H, x, POLE_H / 2, z, 10));
      parts.push(cyl(0.09, 0.11, 0.06, x, 0.03, z, 10));
      parts.push(box(0.05, 0.05, 0.05, x, POLE_H - 0.02, z));
    }
    return merged(parts);
  }, []);
  return <mesh geometry={geo} material={a.pole} position={[0, FLOOR_Y, 0]} castShadow />;
}

function catenaryPoint(a: [number, number, number], b: [number, number, number], sag: number, t: number): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t),
    a[2] + (b[2] - a[2]) * t,
  ];
}

/** One perimeter catenary run between two pole tops (world coords):
 *  wire + stems + emissive bulbs, merged to three draw calls. */
function StringLightRun({ a, b, sag = 0.35, bulbs, assets: ra }: {
  a: [number, number, number]; b: [number, number, number]; sag?: number; bulbs: number; assets: RoofAssets;
}) {
  const geos = useMemo(() => {
    const pts: Vector3[] = [];
    for (let i = 0; i <= 20; i++) pts.push(new Vector3(...catenaryPoint(a, b, sag, i / 20)));
    const wire = new TubeGeometry(new CatmullRomCurve3(pts), 32, 0.008, 6, false);
    const bulbParts: G[] = [], stemParts: G[] = [];
    for (let i = 1; i < bulbs + 1; i++) {
      const t = i / (bulbs + 1);
      const [x, y, z] = catenaryPoint(a, b, sag, t);
      stemParts.push(cyl(0.006, 0.006, 0.05, x, y - 0.025, z, 6));
      const s = new SphereGeometry(0.027, 10, 8);
      s.scale(1, 1.2, 1);
      s.translate(x, y - 0.075, z);
      bulbParts.push(s);
    }
    return { wire, bulbs: merged(bulbParts), stems: merged(stemParts) };
  }, [a, b, sag, bulbs]);
  return (
    <group>
      <mesh geometry={geos.wire} material={ra.wire} />
      <mesh geometry={geos.stems} material={ra.wire} />
      <mesh geometry={geos.bulbs} material={ra.bulb} />
    </group>
  );
}

function StringLightRuns({ a }: { a: RoofAssets }) {
  const Y = FLOOR_Y + POLE_H - 0.02;
  const L = STRING_RUN_LINE;
  const runs: { a: [number, number, number]; b: [number, number, number]; bulbs: number }[] = [
    // north line, z = −7.2 — behind the far seat
    { a: [-L, Y, -L], b: [-3.6, Y, -L], bulbs: 10 },
    { a: [-3.6, Y, -L], b: [3.6, Y, -L], bulbs: 19 },
    { a: [3.6, Y, -L], b: [L, Y, -L], bulbs: 10 },
    // south line, z = +7.2 — behind the player's seat (and camera)
    { a: [-L, Y, L], b: [-3.6, Y, L], bulbs: 10 },
    { a: [-3.6, Y, L], b: [3.6, Y, L], bulbs: 19 },
    { a: [3.6, Y, L], b: [L, Y, L], bulbs: 10 },
    // west line, x = −7.2
    { a: [-L, Y, -L], b: [-L, Y, -3.6], bulbs: 10 },
    { a: [-L, Y, -3.6], b: [-L, Y, 3.6], bulbs: 19 },
    { a: [-L, Y, 3.6], b: [-L, Y, L], bulbs: 10 },
    // east line, x = +7.2
    { a: [L, Y, -L], b: [L, Y, -3.6], bulbs: 10 },
    { a: [L, Y, -3.6], b: [L, Y, 3.6], bulbs: 19 },
    { a: [L, Y, 3.6], b: [L, Y, L], bulbs: 10 },
  ];
  return (
    <group>
      {runs.map((r, i) => <StringLightRun key={i} a={r.a} b={r.b} bulbs={r.bulbs} assets={a} />)}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* ROO-04 — the pigeon coop: 1.60 × 0.80, H 1.10, weathered planks,     */
/* wire-mesh front, slanted roof. EMPTY — no pigeons, ever (pinned     */
/* exclusion). Foreground dressing off-axis in the SW quadrant.        */
/* Local: floor y=0, mesh front faces +z.                              */
/* ------------------------------------------------------------------ */

function PigeonCoop({ position, ry, a }: { position: [number, number, number]; ry: number; a: RoofAssets }) {
  const frame = useMemo(() => merged([
    box(0.055, 1.0, 0.055, -0.77, 0.5, 0.37), box(0.055, 1.0, 0.055, 0.77, 0.5, 0.37),
    box(0.055, 1.0, 0.055, -0.77, 0.5, -0.37), box(0.055, 1.0, 0.055, 0.77, 0.5, -0.37),
    box(1.60, 0.06, 0.05, 0, 0.97, 0.38), box(1.60, 0.06, 0.05, 0, 0.10, 0.38),
    box(1.60, 0.05, 0.05, 0, 0.55, 0.38),
    box(0.70, 0.035, 0.14, -0.30, 0.44, 0.44),
    tube([-0.62, 0.36, 0.46], [-0.02, 0.36, 0.46], 0.014),
    box(0.06, 0.12, 0.06, -0.72, 0.06, 0.32), box(0.06, 0.12, 0.06, 0.72, 0.06, 0.32),
    box(0.06, 0.12, 0.06, -0.72, 0.06, -0.32), box(0.06, 0.12, 0.06, -0.72, 0.06, -0.32),
  ]), []);
  return (
    <group position={position} rotation={[0, ry, 0]}>
      <mesh material={a.plankOld} position={[0, 0.55, -0.385]} castShadow receiveShadow>
        <boxGeometry args={[1.60, 0.86, 0.04]} />
      </mesh>
      <mesh material={a.plankOld} position={[-0.785, 0.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.04, 0.86, 0.80]} />
      </mesh>
      <mesh material={a.plankOld} position={[0.785, 0.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.04, 0.86, 0.80]} />
      </mesh>
      <mesh material={a.plankOld} position={[0, 0.145, 0]} receiveShadow>
        <boxGeometry args={[1.60, 0.05, 0.80]} />
      </mesh>
      <mesh material={a.plankOld} position={[0, 0.315, 0.385]} castShadow receiveShadow>
        <boxGeometry args={[1.60, 0.39, 0.035]} />
      </mesh>
      {/* the dark interior behind the mesh — empty, by the exclusion */}
      <mesh material={a.coopDark} position={[0, 0.76, 0.30]}>
        <planeGeometry args={[1.48, 0.38]} />
      </mesh>
      <mesh material={a.meshWire} position={[0, 0.76, 0.40]}>
        <planeGeometry args={[1.50, 0.40]} />
      </mesh>
      <mesh geometry={frame} material={a.trestle} castShadow />
      {/* slanted roof: one plank slab tipped forward, H to 1.10 */}
      <mesh material={a.plankOld} position={[0, 1.06, 0.01]} rotation={[0.13, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.72, 0.045, 0.98]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* ROO-05 — the roof bulkhead hut: 1.80 × 1.20, H 2.30, grey rendered   */
/* masonry, a BLANK steel door on its west face, tar-paper roof.       */
/* ROO-08 — the TV antenna on its roof (see TvAntenna).                */
/* ------------------------------------------------------------------ */

function BulkheadHut({ position, a }: { position: [number, number, number]; a: RoofAssets }) {
  return (
    <group position={position}>
      <mesh material={a.bulkWall} position={[0, 1.15, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.8, 2.3, 1.2]} />
      </mesh>
      <mesh material={a.tarPaper} position={[0, 2.34, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.94, 0.08, 1.34]} />
      </mesh>
      {/* the blank steel door on the west face — no signs, no text */}
      <mesh material={a.bulkDoor} position={[-0.915, 0.95, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.04, 1.9, 0.82]} />
      </mesh>
      <mesh material={a.steelBand} position={[-0.945, 0.95, 0.30]}>
        <boxGeometry args={[0.03, 0.04, 0.16]} />
      </mesh>
      {/* a vent louvre high on the south face (slats, no lettering) */}
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} material={a.steelBand} position={[0.35, 1.78 - i * 0.09, 0.605]}>
          <boxGeometry args={[0.44, 0.045, 0.02]} />
        </mesh>
      ))}
    </group>
  );
}

/** ROO-08 — TV antenna: rusted mast (H 1.80 over the bulkhead
 *  roof) with dull aluminium cross elements. It stands at the
 *  roof's NE corner — frame edge from every game camera. */
function TvAntenna({ position, a }: { position: [number, number, number]; a: RoofAssets }) {
  const parts = useMemo(() => {
    const g: G[] = [];
    g.push(cyl(0.021, 0.026, 1.8, 0, 0.9, 0, 8));
    g.push(tube([-0.28, 1.78, 0], [0.28, 1.78, 0], 0.010));
    for (let i = 0; i < 5; i++) {
      const bx = -0.24 + i * 0.12;
      const half = 0.42 - i * 0.055;
      g.push(tube([bx, 1.78, -half], [bx, 1.78, half], 0.006));
    }
    g.push(tube([-0.16, 1.30, 0], [0.16, 1.30, 0], 0.008));
    return merged(g);
  }, []);
  return <mesh geometry={parts} material={a.alu} position={position} castShadow />;
}

/* ------------------------------------------------------------------ */
/* ROO-06 — vent pipe cluster: three galvanised/rusted pipes with      */
/* cap vents, tallest H 0.90, on a shared curb footprint.              */
/* ROO-07 — wooden crate cluster: three weathered slat crates.         */
/* ------------------------------------------------------------------ */

function VentPipes({ position, a }: { position: [number, number, number]; a: RoofAssets }) {
  const pipes: { x: number; z: number; h: number; r: number; rusted: boolean }[] = [
    { x: -0.22, z: 0.05, h: 0.90, r: 0.085, rusted: false },
    { x: 0.14, z: -0.10, h: 0.62, r: 0.070, rusted: true },
    { x: 0.20, z: 0.18, h: 0.45, r: 0.055, rusted: false },
  ];
  return (
    <group position={position}>
      <mesh material={a.coping} position={[0, 0.05, 0]} receiveShadow castShadow>
        <boxGeometry args={[0.80, 0.10, 0.50]} />
      </mesh>
      {pipes.map((p, i) => (
        <group key={i} position={[p.x, 0.10, p.z]}>
          <mesh material={p.rusted ? a.rust : a.galv} position={[0, p.h / 2, 0]} castShadow>
            <cylinderGeometry args={[p.r, p.r, p.h, 12]} />
          </mesh>
          <mesh material={p.rusted ? a.rust : a.galv} position={[0, p.h + 0.075, 0]} castShadow>
            <coneGeometry args={[p.r * 1.7, 0.09, 14]} />
          </mesh>
          <mesh material={a.steelBand} position={[0, p.h + 0.02, 0]}>
            <cylinderGeometry args={[p.r * 0.5, p.r * 0.5, 0.05, 8]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function CrateCluster({ position, ry, a }: { position: [number, number, number]; ry: number; a: RoofAssets }) {
  const geos = useMemo(() => {
    const crate = (wdt: number) => merged([
      box(wdt, wdt * 0.92, wdt, 0, (wdt * 0.92) / 2, 0),
      box(wdt + 0.03, 0.05, wdt + 0.03, 0, wdt * 0.92 - 0.025, 0),
      box(wdt + 0.03, 0.05, 0.04, 0, 0.10, wdt / 2),
      box(wdt + 0.03, 0.05, 0.04, 0, 0.10, -wdt / 2),
    ]);
    return { a: crate(0.55), b: crate(0.46) };
  }, []);
  return (
    <group position={position} rotation={[0, ry, 0]}>
      <mesh geometry={geos.a} material={a.plankOld} castShadow receiveShadow />
      <mesh geometry={geos.b} material={a.plankOld} position={[0.52, 0, 0.18]} rotation={[0, 0.4, 0]} castShadow receiveShadow />
      <mesh geometry={geos.b} material={a.plankOld} position={[0.10, 0.506, 0.02]} rotation={[0, -0.22, 0]} castShadow receiveShadow />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* The skyline + sky: distant environment only. Silhouette towers      */
/* at 34–46 m (merged, fog-faded, sparse emissive windows) under a     */
/* gradient sunset dome — far geometry, never a backdrop plane         */
/* in the room.                                                        */
/* ------------------------------------------------------------------ */

function Skyline({ a }: { a: RoofAssets }) {
  const geo = useMemo(() => {
    const rnd = mulberry32(1979);
    const parts: G[] = [];
    const n = 30;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.12;
      const dist = 38 + rnd() * 10;
      const wdt = 5 + rnd() * 6, dep = 5 + rnd() * 5, hgt = 5 + rnd() * 9;
      const g = box(wdt, hgt, dep, 0, 0, 0);
      g.rotateY(-ang + (rnd() - 0.5) * 0.4);
      g.translate(Math.sin(ang) * dist, FLOOR_Y - 5 + hgt / 2, -Math.cos(ang) * dist);
      parts.push(g);
      if (rnd() > 0.55) {
        parts.push(cyl(0.5, 0.55, 1.1, Math.sin(ang) * dist, FLOOR_Y - 5 + hgt + 0.55, -Math.cos(ang) * dist, 8));
      }
    }
    return merged(parts);
  }, []);
  return <mesh geometry={geo} material={a.skyline} />;
}

function SkyDome({ a }: { a: RoofAssets }) {
  const geo = useMemo(() => new SphereGeometry(52, 24, 16), []);
  return <mesh geometry={geo} material={a.sky} position={[0, FLOOR_Y, 0]} />;
}

/* ------------------------------------------------------------------ */

export default function RooftopDuskRoom({ fxOn }: { fxOn: boolean }) {
  const a = assets();
  return (
    <group>
      <EnvFog />
      <RooftopLights fxOn={fxOn} />
      <BulbShimmer a={a} fxOn={fxOn} />
      <FoldingChairs a={a} />
      {/* the tar-and-gravel deck, out to the parapet's outer line */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} material={a.tar} receiveShadow>
        <planeGeometry args={[16.2, 16.2]} />
      </mesh>
      <Parapet a={a} />
      <WaterTower a={a} />
      <StringLightPoles a={a} />
      <StringLightRuns a={a} />
      {/* ROO-04: foreground dressing, off-axis SW — clear of every
          seat's back-clearance zone and every camera lane */}
      <PigeonCoop position={[-5.7, FLOOR_Y, 4.9]} ry={0.55} a={a} />
      {/* ROO-05/08: bulkhead in the NE quadrant + its antenna */}
      <BulkheadHut position={[5.3, FLOOR_Y, -4.9]} a={a} />
      <TvAntenna position={[5.3, FLOOR_Y + 2.38, -4.9]} a={a} />
      {/* ROO-06: vent cluster east, 1.6 m north of the east seat's axis */}
      <VentPipes position={[5.9, FLOOR_Y, -1.6]} a={a} />
      {/* ROO-07: crates against the NW parapet stretch */}
      <CrateCluster position={[-5.9, FLOOR_Y, -3.4]} ry={0.3} a={a} />
      <Skyline a={a} />
      <SkyDome a={a} />
      {/* NO table here — the shared game table is the anchor. */}
    </group>
  );
}
