import { useMemo, useRef } from 'react';
import {
  BoxGeometry, CanvasTexture, ColorManagement, CylinderGeometry, DoubleSide, Fog,
  MeshStandardMaterial, Quaternion, RepeatWrapping, SRGBColorSpace, SphereGeometry,
  Sprite, SpriteMaterial, Vector3,
} from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The shared table's floor plane (sibling rooms keep their own). */
const FLOOR_Y = -0.9;

/**
 * THE COOKOUT — story Stop 4's 3D room (Keisha & Teisha).
 *
 * Mounted by Scene for every High-quality backyard table (the
 * venues rollout un-scoped it from story stop `cookout`,
 * 2026-10-28 — the room is the venue's own yard, no
 * story-specific dressing); Low quality everywhere keeps the
 * shipped BackyardRoom, untouched (pinned in
 * test/cookout-room.test.ts). The room is
 * sandbox-certified (CODE-ROOMS-REPORT.md Batch 3b, shots in
 * _immersive3d-work/shots/cookout/): blue-hour backyard, the
 * game table on the grass at yard centre, a two-storey cream
 * siding house with warm lit windows behind the far seat, a
 * weathered plank fence (H 1.80) enclosing the yard, string
 * lights at the perimeter, the kettle grill with its lid open
 * at the south-west corner (smoke drifting west, AWAY from the
 * felt), two camp chairs + the empty serving table + the blue
 * cooler as east-side dressing.
 *
 * Route per the owner's 2026-10-28 decision: ALL CODE, zero
 * Forge mixes — a kettle grill is lathe-and-tube work, camp
 * chairs are the X-frame class the folding chairs proved, the
 * fence is plank work, the cooler/serving table are box goods.
 * Nothing here is a proven code-fails class. No downloads.
 *
 * Standing-camera discipline (gate added 2026-10-28 after the
 * Porch header defect): nothing roofs the yard and nothing
 * spans over the table — the tallest dressing is the fence
 * (1.80) and the string runs stay at the yard perimeter and
 * behind the far seat — so no element can band across the
 * felt from either game camera. The room renders no table:
 * the shared game table is the anchor.
 */

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

type MatOpts = { color?: string; map?: CanvasTexture; roughness: number; metalness: number; emissive?: string; emissiveIntensity?: number; side?: typeof DoubleSide };
function std(o: MatOpts) {
  return new MeshStandardMaterial({
    color: o.color ?? '#ffffff', map: o.map ?? null,
    roughness: o.roughness, metalness: o.metalness,
    emissive: o.emissive ?? '#000000', emissiveIntensity: o.emissiveIntensity ?? 1,
    ...(o.side ? { side: o.side } : {}),
  });
}

type G = BoxGeometry | CylinderGeometry | SphereGeometry;
function box(w: number, h: number, d: number, x = 0, y = 0, z = 0, rx = 0) {
  const geo = new BoxGeometry(w, h, d);
  if (rx) geo.rotateX(rx);
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
  const g = mergeGeometries(parts as never[], false);
  for (const p of parts) (p as { dispose?: () => void }).dispose?.();
  return g!;
}

/* ------------------------------------------------------------------ */
/* textures                                                             */
/* ------------------------------------------------------------------ */

function makeSidingTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(90210);
    ctx.fillStyle = '#d3c5a4'; ctx.fillRect(0, 0, w, h);
    const bh = 42;
    for (let y = 0; y < h; y += bh) {
      const v = 0.93 + rnd() * 0.12;
      ctx.fillStyle = `rgb(${Math.round(213 * v)},${Math.round(198 * v)},${Math.round(166 * v)})`;
      ctx.fillRect(0, y, w, bh);
      ctx.fillStyle = 'rgba(70,54,30,0.5)'; ctx.fillRect(0, y + bh - 5, w, 5);
      ctx.fillStyle = 'rgba(255,248,228,0.22)'; ctx.fillRect(0, y, w, 3);
    }
    speckle(ctx, w, h, 2000, rnd, 0.07, false);
    const foot = ctx.createLinearGradient(0, h - 100, 0, h);
    foot.addColorStop(0, 'rgba(52,40,22,0)'); foot.addColorStop(1, 'rgba(52,40,22,0.32)');
    ctx.fillStyle = foot; ctx.fillRect(0, h - 100, w, 100);
  }, [3.2, 2.6]);
}

function makeFenceTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(5177);
    const pw = 64;
    for (let x = 0; x < w; x += pw) {
      const v = 0.82 + rnd() * 0.3;
      ctx.fillStyle = `rgb(${Math.round(122 * v)},${Math.round(104 * v)},${Math.round(84 * v)})`;
      ctx.fillRect(x, 0, pw - 3, h);
      ctx.fillStyle = 'rgba(24,18,12,0.85)'; ctx.fillRect(x + pw - 3, 0, 3, h);
      ctx.strokeStyle = 'rgba(52,40,26,0.35)'; ctx.lineWidth = 1.4;
      for (let gLine = 0; gLine < 6; gLine++) {
        const gx = x + 6 + rnd() * (pw - 14);
        ctx.beginPath(); ctx.moveTo(gx, 0);
        ctx.bezierCurveTo(gx + 3, h * 0.3, gx - 3, h * 0.6, gx + 2, h);
        ctx.stroke();
      }
      if (rnd() > 0.55) {
        const kx = x + 12 + rnd() * (pw - 24), ky = rnd() * h * 0.8;
        ctx.fillStyle = 'rgba(40,30,18,0.6)';
        ctx.beginPath(); ctx.ellipse(kx, ky, 4.5, 6.5, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    const moss = ctx.createLinearGradient(0, h - 130, 0, h);
    moss.addColorStop(0, 'rgba(46,66,32,0)'); moss.addColorStop(1, 'rgba(46,66,32,0.55)');
    ctx.fillStyle = moss; ctx.fillRect(0, h - 130, w, 130);
    speckle(ctx, w, h, 2400, rnd, 0.09, false);
  }, [4, 1]);
}

function makeGrassTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(31415);
    ctx.fillStyle = '#2c4423'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const g = 52 + rnd() * 88;
      ctx.fillStyle = `rgba(${Math.round(g * 0.52)},${Math.round(g)},${Math.round(g * 0.4)},0.75)`;
      ctx.fillRect(rnd() * w, rnd() * h, 1.6, 3 + rnd() * 4);
    }
    for (let i = 0; i < 7; i++) {
      const x = rnd() * w, y = rnd() * h, r = 26 + rnd() * 60;
      const p = ctx.createRadialGradient(x, y, 2, x, y, r);
      p.addColorStop(0, `rgba(96,84,50,${(0.10 + rnd() * 0.13).toFixed(2)})`);
      p.addColorStop(1, 'rgba(96,84,50,0)');
      ctx.fillStyle = p; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    speckle(ctx, w, h, 1600, rnd, 0.08, false);
  }, [9, 7]);
}

function makeBlueHourSkyTexture() {
  return canvasTex(1024, 512, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#141d3d');
    grad.addColorStop(0.45, '#2c3a63');
    grad.addColorStop(0.72, '#6b5570');
    grad.addColorStop(0.9, '#c47a4e');
    grad.addColorStop(1, '#e8a35c');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    const sun = ctx.createRadialGradient(w * 0.16, h * 0.98, 8, w * 0.16, h * 0.98, 300);
    sun.addColorStop(0, 'rgba(255,196,120,0.8)');
    sun.addColorStop(1, 'rgba(255,196,120,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h);
  });
}

function makeLeafTexture(seed: number) {
  return canvasTex(256, 256, (ctx, w, h) => {
    const rnd = mulberry32(seed);
    ctx.fillStyle = '#24391f'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const g = 46 + rnd() * 92;
      ctx.fillStyle = `rgba(${Math.round(g * 0.55)},${Math.round(g)},${Math.round(g * 0.42)},0.8)`;
      ctx.beginPath();
      ctx.ellipse(rnd() * w, rnd() * h, 2 + rnd() * 4, 1 + rnd() * 2.4, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function makeGlowTexture() {
  return canvasTex(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.42)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
}

function makeLitWindowTexture(seed: number) {
  return canvasTex(256, 320, (ctx, w, h) => {
    const rnd = mulberry32(seed);
    ctx.fillStyle = '#1c130a'; ctx.fillRect(0, 0, w, h);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#ffd9a0'); grad.addColorStop(1, '#f0a44e');
    ctx.fillStyle = grad; ctx.fillRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = 'rgba(120,66,16,0.5)';
    for (let y = 22; y < h - 16; y += 15) ctx.fillRect(10, y, w - 20, 6);
    ctx.fillStyle = 'rgba(60,32,8,0.9)';
    ctx.fillRect(w / 2 - 5, 10, 10, h - 20);
    ctx.fillRect(10, h / 2 - 5, w - 20, 10);
    speckle(ctx, w, h, 260, rnd, 0.08, true);
  });
}

function makeDarkWindowTexture() {
  return canvasTex(256, 320, (ctx, w, h) => {
    ctx.fillStyle = '#0b0f16'; ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(140,170,220,0.20)');
    g.addColorStop(0.5, 'rgba(140,170,220,0.03)');
    g.addColorStop(1, 'rgba(140,170,220,0.12)');
    ctx.fillStyle = g; ctx.fillRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = 'rgba(6,8,12,0.9)';
    ctx.fillRect(w / 2 - 5, 8, 10, h - 16);
    ctx.fillRect(8, h / 2 - 5, w - 16, 10);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 10;
    ctx.strokeRect(4, 4, w - 8, h - 8);
  });
}

function makeGrateTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#17181a'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#3d4045'; ctx.lineWidth = 5;
    for (let x = 22; x < w; x += 26) { ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x, h - 6); ctx.stroke(); }
    ctx.strokeStyle = '#2c2e33'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(128, 128, 112, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(128, 128, 66, 0, Math.PI * 2); ctx.stroke();
  });
}

/* ------------------------------------------------------------------ */
/* cached assets                                                        */
/* ------------------------------------------------------------------ */

type CookoutAssets = {
  siding: MeshStandardMaterial; fence: MeshStandardMaterial; grass: MeshStandardMaterial;
  sky: MeshStandardMaterial; shutters: MeshStandardMaterial; roofDark: MeshStandardMaterial;
  canvasOlive: MeshStandardMaterial; aluFrame: MeshStandardMaterial;
  coolerBlue: MeshStandardMaterial; coolerLid: MeshStandardMaterial; serveTop: MeshStandardMaterial;
  ember: MeshStandardMaterial; leaf: MeshStandardMaterial; leafDark: MeshStandardMaterial;
  trunk: MeshStandardMaterial; bulb: MeshStandardMaterial; wire: MeshStandardMaterial;
  doorPaint: MeshStandardMaterial; grillBlack: MeshStandardMaterial; steelBlack: MeshStandardMaterial;
  darkWood: MeshStandardMaterial; grate: MeshStandardMaterial; litWin: MeshStandardMaterial;
  darkWin: MeshStandardMaterial; concrete: MeshStandardMaterial;
  glowTex: CanvasTexture;
};

let ASSETS: CookoutAssets | null = null;
function assets(): CookoutAssets {
  if (ASSETS) return ASSETS;
  ColorManagement.enabled = true;
  ASSETS = {
    siding: std({ map: makeSidingTexture(), color: '#ddd5c2', roughness: 0.9, metalness: 0 }),
    fence: std({ map: makeFenceTexture(), roughness: 0.95, metalness: 0 }),
    grass: std({ map: makeGrassTexture(), roughness: 1, metalness: 0 }),
    sky: new MeshStandardMaterial({ map: makeBlueHourSkyTexture(), roughness: 1, metalness: 0, fog: false }),
    shutters: std({ color: '#2e3436', roughness: 0.8, metalness: 0 }),
    roofDark: std({ color: '#232028', roughness: 0.95, metalness: 0 }),
    canvasOlive: std({ color: '#5c6647', roughness: 0.94, metalness: 0, side: DoubleSide }),
    aluFrame: std({ color: '#b9bcbe', roughness: 0.32, metalness: 0.85 }),
    coolerBlue: std({ color: '#2456a8', roughness: 0.42, metalness: 0.05 }),
    coolerLid: std({ color: '#e8e6df', roughness: 0.5, metalness: 0.02 }),
    serveTop: std({ color: '#b9b2a2', roughness: 0.6, metalness: 0.05 }),
    ember: std({ color: '#3a1408', emissive: '#ff5a1a', emissiveIntensity: 1.6, roughness: 0.9, metalness: 0 }),
    leaf: std({ map: makeLeafTexture(60606), roughness: 1, metalness: 0 }),
    leafDark: std({ map: makeLeafTexture(70707), color: '#8fa383', roughness: 1, metalness: 0 }),
    trunk: std({ color: '#3d2f22', roughness: 0.95, metalness: 0 }),
    bulb: std({ color: '#ffb85e', emissive: '#ff9e45', emissiveIntensity: 1.2, roughness: 0.3, metalness: 0 }),
    wire: std({ color: '#0c0c0d', roughness: 0.7, metalness: 0.2 }),
    doorPaint: std({ color: '#4a5548', roughness: 0.7, metalness: 0.05 }),
    grillBlack: std({ color: '#17181c', roughness: 0.38, metalness: 0.55, side: DoubleSide }),
    steelBlack: std({ color: '#26282c', roughness: 0.34, metalness: 0.8 }),
    darkWood: std({ color: '#4c3a26', roughness: 0.78, metalness: 0 }),
    grate: std({ map: makeGrateTexture(), roughness: 0.5, metalness: 0.6 }),
    litWin: std({ map: makeLitWindowTexture(4242), roughness: 0.4, metalness: 0, emissive: '#ffb763', emissiveIntensity: 0.55 }),
    darkWin: std({ map: makeDarkWindowTexture(), roughness: 0.25, metalness: 0.2 }),
    concrete: std({ color: '#8d8d90', roughness: 0.95, metalness: 0 }),
    glowTex: makeGlowTexture(),
  };
  return ASSETS;
}

/* ------------------------------------------------------------------ */
/* fog + lights                                                         */
/* ------------------------------------------------------------------ */

function EnvFog() {
  const scene = useThree((s) => s.scene);
  useMemo(() => {
    const prev = scene.fog;
    scene.fog = new Fog('#33222e', 11, 28);
    return () => { scene.fog = prev; };
  }, [scene]);
  return null;
}

function CookoutLights({ fxOn }: { fxOn: boolean }) {
  return (
    <>
      <hemisphereLight args={['#8ea3d4', '#33452a', 0.8]} />
      <directionalLight
        position={[-6, 8, 5]}
        target-position={[0, -0.6, -1]}
        color="#a9c2f5"
        intensity={0.72}
        castShadow={fxOn}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-9} shadow-camera-right={9}
        shadow-camera-top={9} shadow-camera-bottom={-7}
        shadow-bias={-0.0004}
      />
      {/* string-light pool over the table */}
      <pointLight position={[0, 1.9, -0.6]} intensity={9} distance={8} decay={2} color="#ffb45e" />
      {/* house warmth spilling from the door side */}
      <pointLight position={[0.9, 1.5, -4.2]} intensity={6.5} distance={7} decay={2} color="#ff9e45" />
      {/* grill ember glow */}
      <pointLight position={[-3.6, FLOOR_Y + 1.0, 1.5]} intensity={2.6} distance={3.5} decay={2} color="#ff6a22" />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* the four seats — the kit folding chair at owner scale (H 0.90,      */
/* seat ~0.49), at the shared table's anchors                          */
/* ------------------------------------------------------------------ */

const CHAIR_SPOTS: { pos: [number, number, number]; ry: number }[] = [
  { pos: [0, FLOOR_Y, 1.98], ry: Math.PI },
  { pos: [2.14, FLOOR_Y, 0], ry: -Math.PI / 2 },
  { pos: [0, FLOOR_Y, -1.98], ry: 0 },
  { pos: [-2.14, FLOOR_Y, 0], ry: Math.PI / 2 },
];

function foldingChairGeo() {
  const seatParts: G[] = [], backParts: G[] = [], legParts: G[] = [], backLegParts: G[] = [];
  seatParts.push(box(0.42, 0.028, 0.40, 0, 0.49, 0.02));
  backParts.push(box(0.42, 0.30, 0.026, 0, 0.79, -0.185, -0.10));
  for (const sx of [-1, 1]) {
    const x = 0.20 * sx;
    legParts.push(tube([x, 0.02, 0.24], [x, 0.49, -0.10], 0.0135));
    backLegParts.push(tube([x, 0.02, -0.235], [x, 0.90, -0.225], 0.0135));
    legParts.push(box(0.026, 0.022, 0.36, x, 0.27, 0.005));
  }
  return {
    seat: merged(seatParts), back: merged(backParts),
    legs: merged(legParts), backLegs: merged(backLegParts),
  };
}

function FoldingChairs({ a }: { a: CookoutAssets }) {
  const geos = useMemo(foldingChairGeo, []);
  const seatBack = std({ color: '#31463a', roughness: 0.62, metalness: 0.08 });
  return (
    <group>
      {CHAIR_SPOTS.map(({ pos, ry }, i) => (
        <group key={i} position={pos} rotation={[0, ry, 0]}>
          <mesh geometry={geos.seat} material={seatBack} castShadow receiveShadow />
          <mesh geometry={geos.back} material={seatBack} castShadow receiveShadow />
          <mesh geometry={geos.legs} material={a.steelBlack} castShadow />
          <mesh geometry={geos.backLegs} material={a.steelBlack} castShadow />
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* string lights (shared catenary builder)                              */
/* ------------------------------------------------------------------ */

function catenaryPoint(a: [number, number, number], b: [number, number, number], t: number, sag: number): [number, number, number] {
  const drop = sag * 4 * t * (1 - t);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - drop, a[2] + (b[2] - a[2]) * t];
}

function StringLights({ a, b, sag, bulbs, a2 }: {
  a: [number, number, number]; b: [number, number, number]; sag: number; bulbs: number; a2: CookoutAssets;
}) {
  const wire = useMemo(() => {
    const pts: G[] = [];
    for (let i = 0; i < bulbs; i++) {
      const t0 = i / bulbs, t1 = (i + 1) / bulbs;
      pts.push(tube(catenaryPoint(a, b, t0, sag), catenaryPoint(a, b, t1, sag), 0.0045));
    }
    return merged(pts);
  }, [a, b, sag, bulbs]);
  return (
    <group>
      <mesh geometry={wire} material={a2.wire} />
      {Array.from({ length: bulbs }, (_, i) => {
        const p = catenaryPoint(a, b, (i + 0.5) / bulbs, sag);
        return (
          <group key={i}>
            <mesh position={[p[0], p[1] - 0.035, p[2]]} material={a2.bulb}>
              <sphereGeometry args={[0.026, 10, 8]} />
            </mesh>
            <mesh position={[p[0], p[1] - 0.012, p[2]]} material={a2.steelBlack}>
              <cylinderGeometry args={[0.008, 0.010, 0.025, 6]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* grill smoke — soft sprites on the room clock, drift mirrored WEST   */
/* (away from the felt) by the caller's group scale. fxOn off holds a  */
/* static mid-rise pose.                                               */
/* ------------------------------------------------------------------ */

function SpriteSmoke({ a, fxOn, count = 14, rise = 1.5, rate = 0.075 }: {
  a: CookoutAssets; fxOn: boolean; count?: number; rise?: number; rate?: number;
}) {
  const refs = useRef<(Sprite | null)[]>([]);
  const mats = useMemo(() => Array.from({ length: count }, (_, i) => {
    const m = new SpriteMaterial({ map: a.glowTex, color: '#cbb59a', transparent: true, opacity: 0, depthWrite: false });
    m.rotation = (i * 2.399) % (Math.PI * 2);
    return m;
  }), [a, count]);
  const seeds = useMemo(() => Array.from({ length: count }, (_, i) => ({
    ph: i / count,
    wob: 0.5 + ((i * 37) % 10) / 14,
    spin: ((i * 53) % 10) / 10 - 0.5,
  })), [count]);
  const posed = useRef(false);
  useFrame((state, dt) => {
    if (!fxOn && posed.current) return;
    const t = fxOn ? state.clock.elapsedTime : 6.5;
    seeds.forEach((s, i) => {
      const sp = refs.current[i];
      if (!sp) return;
      const age = (t * rate + s.ph) % 1;
      const wob = Math.sin(age * 5.1 + s.ph * 9.0) * 0.05 * s.wob;
      sp.position.set(age * 0.38 + wob, 0.3 + age * rise, Math.cos(age * 4.3 + s.ph * 7.0) * 0.045);
      const sc = 0.16 + age * 0.62;
      sp.scale.set(sc, sc, 1);
      mats[i]!.opacity = Math.sin(age * Math.PI) * 0.30;
      mats[i]!.rotation += (fxOn ? dt : 0) * s.spin * 0.14;
    });
    posed.current = true;
  });
  return (
    <group>
      {seeds.map((_, i) => (
        <sprite key={i} ref={(el) => { refs.current[i] = el; }} material={mats[i]} />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the fence — plank slab + rails + posts, H 1.80                       */
/* ------------------------------------------------------------------ */

function FenceRun({ from, to, a }: { from: [number, number]; to: [number, number]; a: CookoutAssets }) {
  const geo = useMemo(() => {
    const [x0, z0] = from, [x1, z1] = to;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const parts: G[] = [];
    parts.push(box(len, 1.8, 0.055, len / 2, 0.9, 0));
    parts.push(box(len, 0.09, 0.035, len / 2, 1.52, -0.05));
    parts.push(box(len, 0.09, 0.035, len / 2, 0.42, -0.05));
    const n = Math.max(1, Math.round(len / 1.8));
    for (let i = 0; i <= n; i++) parts.push(box(0.11, 1.86, 0.11, (i / n) * len, 0.93, -0.02));
    const g = merged(parts);
    g.rotateY(-Math.atan2(z1 - z0, x1 - x0));
    g.translate(x0, 0, z0);
    return g;
  }, [from, to]);
  return <mesh geometry={geo} material={a.fence} position={[0, FLOOR_Y, 0]} castShadow receiveShadow />;
}

/* ------------------------------------------------------------------ */
/* the kettle grill — bowl, open lid, grate + embers, tripod            */
/* ------------------------------------------------------------------ */

function KettleGrill({ position, ry, a }: { position: [number, number, number]; ry: number; a: CookoutAssets }) {
  const geos = useMemo(() => {
    const bowl = new SphereGeometry(0.285, 22, 12, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58);
    bowl.scale(1, 0.82, 1);
    bowl.translate(0, 0.90, 0);
    const lid = new SphereGeometry(0.29, 22, 10, 0, Math.PI * 2, 0, Math.PI * 0.46);
    lid.scale(1, 0.8, 1);
    lid.translate(0, 0, 0.27);
    lid.rotateX(-1.95);
    lid.translate(0, 0.90, -0.27);
    const legs = merged([
      tube([0.13, 0.06, 0.13], [0.10, 0.68, 0.10], 0.013),
      tube([-0.13, 0.06, 0.13], [-0.10, 0.68, 0.10], 0.013),
      tube([0, 0.05, -0.17], [0, 0.68, -0.12], 0.013),
      cyl(0.085, 0.085, 0.028, 0.13, 0.06, 0.13, 16),
      cyl(0.085, 0.085, 0.028, -0.13, 0.06, 0.13, 16),
      tube([-0.09, 0.94, -0.30], [0.09, 0.94, -0.30], 0.011),
    ]);
    return { bowl, lid, legs };
  }, []);
  return (
    <group position={position} rotation={[0, ry, 0]}>
      <mesh geometry={geos.bowl} material={a.grillBlack} castShadow receiveShadow />
      <mesh geometry={geos.lid} material={a.grillBlack} castShadow />
      <mesh geometry={geos.legs} material={a.steelBlack} castShadow />
      <mesh material={a.grate} position={[0, 0.885, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.265, 24]} />
      </mesh>
      <mesh material={a.ember} position={[0, 0.845, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.24, 20]} />
      </mesh>
      <mesh material={a.darkWood} position={[0, 0.93, 0.30]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.017, 0.017, 0.13, 8]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* camp chair (dressing), cooler, serving table                         */
/* ------------------------------------------------------------------ */

function CampChair({ position, ry, a }: { position: [number, number, number]; ry: number; a: CookoutAssets }) {
  const geos = useMemo(() => {
    const frame: G[] = [], canvasParts: G[] = [];
    for (const sx of [-1, 1]) {
      const x = 0.26 * sx;
      frame.push(tube([x, 0.02, 0.30], [x, 0.44, -0.05], 0.011));
      frame.push(tube([x, 0.02, -0.24], [x, 0.44, 0.22], 0.011));
      frame.push(tube([x, 0.44, -0.05], [x, 0.85, -0.30], 0.011));
      frame.push(tube([x, 0.62, 0.10], [x, 0.62, -0.16], 0.010));
      frame.push(tube([x, 0.44, 0.10], [x, 0.62, 0.10], 0.009));
    }
    frame.push(tube([-0.26, 0.10, 0.26], [0.26, 0.10, 0.26], 0.009));
    frame.push(tube([-0.26, 0.82, -0.285], [0.26, 0.82, -0.285], 0.010));
    canvasParts.push(box(0.52, 0.018, 0.40, 0, 0.435, 0.02, -0.06));
    canvasParts.push(box(0.52, 0.36, 0.016, 0, 0.66, -0.235, -0.24));
    return { frame: merged(frame), canvas: merged(canvasParts) };
  }, []);
  return (
    <group position={position} rotation={[0, ry, 0]}>
      <mesh geometry={geos.frame} material={a.aluFrame} castShadow />
      <mesh geometry={geos.canvas} material={a.canvasOlive} castShadow receiveShadow />
    </group>
  );
}

function Cooler({ position, ry, a }: { position: [number, number, number]; ry: number; a: CookoutAssets }) {
  const parts = useMemo(() => merged([
    box(0.65, 0.40, 0.40, 0, 0.20, 0),
    box(0.60, 0.035, 0.35, 0, 0.415, 0),
    box(0.05, 0.10, 0.16, -0.345, 0.26, 0), box(0.05, 0.10, 0.16, 0.345, 0.26, 0),
  ]), []);
  const lid = useMemo(() => merged([
    box(0.67, 0.055, 0.42, 0, 0.455, 0),
    box(0.40, 0.02, 0.24, 0, 0.49, 0),
  ]), []);
  return (
    <group position={position} rotation={[0, ry, 0]}>
      <mesh geometry={parts} material={a.coolerBlue} castShadow receiveShadow />
      <mesh geometry={lid} material={a.coolerLid} castShadow />
    </group>
  );
}

function ServingTable({ position, ry, a }: { position: [number, number, number]; ry: number; a: CookoutAssets }) {
  const legs = useMemo(() => merged([
    tube([-0.52, 0.02, 0.22], [-0.40, 0.70, -0.20], 0.013),
    tube([-0.52, 0.02, -0.22], [-0.40, 0.70, 0.20], 0.013),
    tube([0.52, 0.02, 0.22], [0.40, 0.70, -0.20], 0.013),
    tube([0.52, 0.02, -0.22], [0.40, 0.70, 0.20], 0.013),
    box(0.86, 0.03, 0.44, 0, 0.685, 0),
  ]), []);
  return (
    <group position={position} rotation={[0, ry, 0]}>
      <mesh geometry={legs} material={a.steelBlack} castShadow />
      <mesh material={a.serveTop} position={[0, 0.715, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.03, 0.6]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the house — two storeys, gable, lit windows, back door               */
/* ------------------------------------------------------------------ */

function House({ a }: { a: CookoutAssets }) {
  const gable = useMemo(() => {
    const parts: G[] = [];
    for (let i = 0; i < 5; i++) {
      const wdt = 7.4 * (1 - (i + 0.5) / 5);
      parts.push(box(wdt, 0.34, 0.28, 0, 6.4 + 0.17 + i * 0.34, 0));
    }
    return merged(parts);
  }, []);
  const win = (x: number, y: number, lit: boolean, shutters = true) => (
    <group key={`${x}-${y}`} position={[x, y, 0.17]}>
      <mesh material={a.shutters}><boxGeometry args={[0.94, 1.24, 0.06]} /></mesh>
      <mesh material={lit ? a.litWin : a.darkWin} position={[0, 0, 0.04]}>
        <planeGeometry args={[0.78, 1.08]} />
      </mesh>
      <mesh material={a.shutters} position={[0, 0, 0.055]}><boxGeometry args={[0.045, 1.08, 0.02]} /></mesh>
      <mesh material={a.shutters} position={[0, 0, 0.055]}><boxGeometry args={[0.78, 0.045, 0.02]} /></mesh>
      {shutters && [-0.60, 0.60].map((sx) => (
        <mesh key={sx} material={a.shutters} position={[sx, 0, 0.02]} castShadow>
          <boxGeometry args={[0.20, 1.18, 0.035]} />
        </mesh>
      ))}
    </group>
  );
  return (
    <group position={[0, FLOOR_Y, -5.35]}>
      <mesh material={a.siding} position={[0, 3.2, 0]} receiveShadow castShadow>
        <boxGeometry args={[7.4, 6.4, 0.3]} />
      </mesh>
      <mesh geometry={gable} material={a.siding} />
      {[-1, 1].map((s) => (
        <mesh key={s} material={a.roofDark} position={[s * 1.94, 7.32, 0.1]} rotation={[0, 0, s * -0.42]} castShadow>
          <boxGeometry args={[4.35, 0.09, 1.15]} />
        </mesh>
      ))}
      {win(-2.2, 4.9, true)}
      {win(1.9, 4.9, true)}
      {win(-2.5, 1.75, true)}
      {win(2.9, 1.75, false)}
      <group position={[0.9, 0, 0.17]}>
        <mesh material={a.shutters}><boxGeometry args={[1.0, 2.16, 0.07]} /></mesh>
        <mesh material={a.doorPaint} position={[0, 1.06, 0.045]} castShadow>
          <boxGeometry args={[0.88, 2.06, 0.05]} />
        </mesh>
        <mesh material={a.darkWin} position={[0, 1.62, 0.075]}>
          <planeGeometry args={[0.5, 0.62]} />
        </mesh>
        <mesh material={a.steelBlack} position={[0.34, 1.02, 0.08]}>
          <boxGeometry args={[0.035, 0.035, 0.05]} />
        </mesh>
        <mesh material={a.concrete} position={[0, 0.07, 0.42]} receiveShadow castShadow>
          <boxGeometry args={[1.3, 0.14, 0.7]} />
        </mesh>
        <mesh material={a.steelBlack} position={[0.72, 2.32, 0.1]}>
          <boxGeometry args={[0.09, 0.16, 0.09]} />
        </mesh>
        <mesh position={[0.72, 2.30, 0.17]}>
          <boxGeometry args={[0.055, 0.10, 0.02]} />
          <meshStandardMaterial color="#3a2408" emissive="#ffb14e" emissiveIntensity={2.6} roughness={0.4} />
        </mesh>
      </group>
      {[[-3.3, 0.7], [-1.5, 0.65], [2.2, 0.7], [3.4, 0.65]].map(([sx, sz], i) => (
        <group key={i} position={[sx!, 0, sz!]}>
          <mesh material={i % 2 ? a.leaf : a.leafDark} position={[0, 0.42, 0]} scale={[1.25, 0.8, 0.9]} castShadow>
            <sphereGeometry args={[0.42, 10, 8]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* greenery                                                             */
/* ------------------------------------------------------------------ */

function YardTree({ position, s = 1, a }: { position: [number, number, number]; s?: number; a: CookoutAssets }) {
  return (
    <group position={position} scale={[s, s, s]}>
      <mesh material={a.trunk} position={[0, 1.1, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.11, 2.2, 8]} />
      </mesh>
      <mesh material={a.leaf} position={[0, 2.9, 0]} scale={[1.3, 0.95, 1.3]} castShadow>
        <sphereGeometry args={[1.05, 12, 9]} />
      </mesh>
      <mesh material={a.leafDark} position={[0.7, 2.4, 0.3]} scale={[1, 0.8, 1]} castShadow>
        <sphereGeometry args={[0.7, 10, 8]} />
      </mesh>
      <mesh material={a.leafDark} position={[-0.65, 2.5, -0.25]} scale={[1, 0.85, 1]} castShadow>
        <sphereGeometry args={[0.62, 10, 8]} />
      </mesh>
    </group>
  );
}

function Shrub({ position, s = 1, a }: { position: [number, number, number]; s?: number; a: CookoutAssets }) {
  return (
    <group position={position} scale={[s, s, s]}>
      <mesh material={a.leaf} position={[0, 0.34, 0]} scale={[1.2, 0.75, 0.95]} castShadow>
        <sphereGeometry args={[0.4, 10, 8]} />
      </mesh>
      <mesh material={a.leafDark} position={[0.25, 0.26, 0.1]} scale={[1, 0.7, 1]} castShadow>
        <sphereGeometry args={[0.27, 9, 7]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */

export default function CookoutYardRoom({ fxOn }: { fxOn: boolean }) {
  const a = assets();
  return (
    <group>
      <EnvFog />
      <CookoutLights fxOn={fxOn} />
      <FoldingChairs a={a} />
      {/* the grass — the whole yard floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} material={a.grass} receiveShadow>
        <planeGeometry args={[30, 24]} />
      </mesh>
      <House a={a} />
      {/* the fence on three sides — the house closes the fourth.
          The south run passes BEHIND the player's seat: you sit
          IN the yard, not at its edge. */}
      <FenceRun from={[-5.4, -5.1]} to={[-5.4, 3.6]} a={a} />
      <FenceRun from={[5.4, -5.1]} to={[5.4, 3.6]} a={a} />
      <FenceRun from={[-5.4, 3.6]} to={[5.4, 3.6]} a={a} />
      {/* the grill at the south-west corner, lid open away from
          the table; its smoke drifts WEST, away from the felt */}
      <KettleGrill position={[-3.6, FLOOR_Y, 1.5]} ry={0.5} a={a} />
      <group position={[-3.6, FLOOR_Y, 1.5]} scale={[-1, 1, 1]}>
        <SpriteSmoke a={a} fxOn={fxOn} />
      </group>
      {/* the east-side dressing cluster */}
      <CampChair position={[3.1, FLOOR_Y, 0.7]} ry={-0.85} a={a} />
      <CampChair position={[3.45, FLOOR_Y, -0.75]} ry={-1.25} a={a} />
      <ServingTable position={[2.9, FLOOR_Y, -2.1]} ry={0.12} a={a} />
      <Cooler position={[2.15, FLOOR_Y, -1.55]} ry={0.35} a={a} />
      <YardTree position={[4.55, FLOOR_Y, -4.15]} s={1.05} a={a} />
      <Shrub position={[-5.0, FLOOR_Y, -1.8]} s={1.1} a={a} />
      <Shrub position={[-5.0, FLOOR_Y, 1.2]} s={0.9} a={a} />
      <Shrub position={[5.0, FLOOR_Y, -2.9]} s={1.0} a={a} />
      <Shrub position={[-2.2, FLOOR_Y, 3.15]} s={0.95} a={a} />
      <Shrub position={[3.9, FLOOR_Y, 3.15]} s={1.05} a={a} />
      {/* string lights: house to fence on both sides + one run
          across the BACK of the yard behind the far seat.
          Perimeter only — nothing spans the table. */}
      <StringLights a={[-3.5, FLOOR_Y + 3.6, -5.05]} b={[-5.4, FLOOR_Y + 1.95, -0.7]} sag={0.38} bulbs={11} a2={a} />
      <StringLights a={[3.5, FLOOR_Y + 3.6, -5.05]} b={[5.4, FLOOR_Y + 1.95, -0.7]} sag={0.38} bulbs={11} a2={a} />
      <StringLights a={[-5.35, FLOOR_Y + 1.95, -3.1]} b={[5.35, FLOOR_Y + 1.95, -3.1]} sag={0.5} bulbs={19} a2={a} />
      {/* the sky, closing the yard at the fence line and above */}
      <mesh material={a.sky} position={[0, FLOOR_Y + 5.4, -13.5]}>
        <planeGeometry args={[64, 15]} />
      </mesh>
      <mesh material={a.sky} position={[0, FLOOR_Y + 5.4, 13.5]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[64, 15]} />
      </mesh>
    </group>
  );
}
