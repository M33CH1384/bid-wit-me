import { useEffect, useMemo, useRef, type RefObject } from 'react';
import {
  BoxGeometry, CanvasTexture, ColorManagement, ConeGeometry, CylinderGeometry,
  MeshStandardMaterial, PlaneGeometry, Quaternion, RepeatWrapping, SphereGeometry, SRGBColorSpace,
  Vector3,
} from 'three';
import { useFrame } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The shared table's floor plane (sibling rooms keep their own). */
const FLOOR_Y = -0.9;

/**
 * THE BEACH CABANA — the beach venue's own 3D room for
 * REGULAR tables (venues rollout Batch C2, 2026-10-28: "Now
 * all the other venues need to be updated the same way").
 * The beach venue hosts no story stop, so there is no story
 * branch: Scene mounts this room for every beach table at
 * High quality, and Low quality keeps the shipped
 * cube-config BeachRoom (beachLayout), untouched.
 *
 * The room: an open-air cabana on the sand — the table sits
 * on a raised plank deck (solid footing: no chair ever sinks
 * into sand) under a thatched roof on four bamboo posts,
 * string lights sagging between the posts, a boardwalk
 * running south from the deck, tiki torches flanking it,
 * striped umbrellas and a palm out on the sand, and the
 * ocean meeting a bright sky at the horizon. Bright warm
 * daylight with the venue's sunset warmth in the light.
 * The identity carries over from the cube dress (VENUES.md:
 * open-air, cabana posts + thatch, sea beyond, tiki west;
 * felt #176660, bamboo rail).
 *
 * Route: ALL CODE, zero downloads — every item is box /
 * cylinder / cone / tube work, every texture a seeded
 * canvas.
 *
 * COPLANAR FLOOR (the Rec lesson, 2026-10-28): the deck top
 * sits at FLOOR_Y + 0.045, the sand at FLOOR_Y - 0.36, the
 * ocean at FLOOR_Y - 0.34 and the foam band at FLOOR_Y -
 * 0.315 — no two opaque surfaces share a depth; the foam is
 * transparent and depth-write-free besides. Nothing else
 * renders at these depths at this venue: TableModel's 30×30
 * ground plane is classic-only (Scene.tsx: `def.id ===
 * 'classic' && !roomFloor`), and the cube shell — whose
 * floor rides +0.005 over FLOOR_Y — never mounts on this
 * branch (same Scene ternary). The surfaces never share a
 * frame, let alone a depth.
 *
 * Standing-camera discipline: open-air — the thatch roof is
 * the only overhead, and it follows the shipped rooms'
 * ceiling rule (the Porch's beadboard, the Speakeasy's tin):
 * two SINGLE-SIDED downward planes meeting at a ridge at
 * floor + 3.86 with eaves at floor + 2.90. From below they
 * read as thatch; from the standing camera above — whose
 * sight line to the felt would pierce any solid roof over
 * the table — they are invisible, and the ridge carries no
 * beam or cap in the cone. The string lights hang at the
 * deck's edges, never over the table.
 *
 * HARD EXCLUSIONS: no text / lettering anywhere (umbrella
 * stripes and towel stripes are pattern, not words), no
 * people dressing (the character phase owns figures).
 *
 * Seat back-clearances (kit chair back = CHAIR_SPOTS origin +
 * ~0.25 m): far seat back z=-2.23 → open deck to the deck
 * edge -3.8 = 1.57 m (the cabana posts stand at the corners,
 * x=±3.35, never behind a seat); player back z=+2.23 →
 * deck edge +3.8 = 1.57 m (the boardwalk beyond runs lower);
 * west back x=-2.39 → deck edge -3.8 = 1.41 m; east back
 * x=+2.39 → deck edge +3.8 = 1.41 m. All ≥ 0.6 m.
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

type MatOpts = {
  color?: string; map?: CanvasTexture; roughness: number; metalness: number;
  emissive?: string; emissiveIntensity?: number; side?: MeshStandardMaterial['side'];
  transparent?: boolean; opacity?: number; alphaTest?: number; depthWrite?: boolean;
};
function std(o: MatOpts) {
  return new MeshStandardMaterial({
    color: o.color ?? '#ffffff', map: o.map ?? null,
    roughness: o.roughness, metalness: o.metalness,
    emissive: o.emissive ?? '#000000', emissiveIntensity: o.emissiveIntensity ?? 1,
    ...(o.side ? { side: o.side } : {}),
    ...(o.transparent ? { transparent: true, opacity: o.opacity ?? 1 } : {}),
    ...(o.alphaTest ? { alphaTest: o.alphaTest } : {}),
    ...(o.depthWrite === false ? { depthWrite: false } : {}),
  });
}

type G = BoxGeometry | CylinderGeometry | SphereGeometry | ConeGeometry;
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
  const g = mergeGeometries(parts as never[], false);
  for (const p of parts) (p as { dispose?: () => void }).dispose?.();
  return g!;
}

/* ------------------------------------------------------------------ */
/* textures                                                             */
/* ------------------------------------------------------------------ */

/** Weathered deck planks: grey-brown boards across the tile,
 *  sun-bleached, with dark gaps (tile = 2.55 m at [3,3]). */
function makeDeckTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(53011);
    ctx.fillStyle = '#3d2c1c'; // the gaps
    ctx.fillRect(0, 0, w, h);
    const ph = 512 / 6; // six boards down the tile
    for (let p = 0; p < 6; p++) {
      const j = (rnd() - 0.5) * 22;
      ctx.fillStyle = `rgb(${Math.round(146 + j)},${Math.round(116 + j * 0.8)},${Math.round(84 + j * 0.6)})`;
      ctx.fillRect(0, p * ph + 2, w, ph - 4);
      ctx.fillStyle = 'rgba(61,44,28,0.8)';
      ctx.fillRect(rnd() * w, p * ph + 2, 3, ph - 4); // a butt joint
      ctx.strokeStyle = 'rgba(90,66,40,0.35)';
      ctx.lineWidth = 1;
      for (let gLine = 0; gLine < 4; gLine++) {
        ctx.beginPath();
        const gy = p * ph + 6 + rnd() * (ph - 12);
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(w * 0.3, gy + 2, w * 0.6, gy - 2, w, gy + 1);
        ctx.stroke();
      }
    }
    speckle(ctx, w, h, 1600, rnd, 0.06, false);
    speckle(ctx, w, h, 800, rnd, 0.05, true);
  }, [3, 3]);
}

/** Beach sand: warm pale grain with shell flecks. */
function makeSandTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(53122);
    ctx.fillStyle = '#e3c48f';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 9000, rnd, 0.10, false);
    speckle(ctx, w, h, 5000, rnd, 0.12, true);
    for (let i = 0; i < 90; i++) { // shell flecks
      ctx.fillStyle = `rgba(${rnd() > 0.5 ? '250,246,238' : '196,150,110'},${(0.35 + rnd() * 0.4).toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(rnd() * w, rnd() * h, 1.5 + rnd() * 2.5, 1 + rnd() * 1.5, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [10, 10]);
}

/** Thatch: layered straw strokes in sun-dried golds. */
function makeThatchTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(53233);
    ctx.fillStyle = '#8a6a34';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2400; i++) {
      const x = rnd() * w, y = rnd() * h, len = 14 + rnd() * 26;
      const tone = rnd();
      ctx.strokeStyle = tone > 0.66 ? 'rgba(214,178,102,0.5)' : tone > 0.33 ? 'rgba(166,128,62,0.5)' : 'rgba(110,82,38,0.5)';
      ctx.lineWidth = 1 + rnd() * 1.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 4, y + len);
      ctx.stroke();
    }
    // horizontal binding rows
    for (const y of [0.25, 0.55, 0.85]) {
      ctx.fillStyle = 'rgba(70,52,24,0.35)';
      ctx.fillRect(0, h * y, w, 5);
    }
  }, [3, 3]);
}

/** Ocean: bright blue-green with wavelet sparkle — drawn
 *  once, drifted slowly under fxOn (same trick as the yacht). */
function makeOceanTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(53344);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#2f7ea8');
    grad.addColorStop(0.5, '#2b749e');
    grad.addColorStop(1, '#3b8cae');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) {
      const y = rnd() * h, x = rnd() * w, len = 8 + rnd() * 32;
      ctx.strokeStyle = `rgba(${rnd() > 0.5 ? '205,238,248' : '16,64,96'},${(0.05 + rnd() * 0.10).toFixed(2)})`;
      ctx.lineWidth = 1 + rnd() * 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + len / 2, y + (rnd() - 0.5) * 3, x + len, y);
      ctx.stroke();
    }
    speckle(ctx, w, h, 1000, rnd, 0.10, true);
  }, [8, 3]);
}

/** Sky dome gradient: bright blue to a warm near-white horizon. */
function makeSkyTexture() {
  return canvasTex(64, 512, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#4f96dc');
    grad.addColorStop(0.45, '#83b6e6');
    grad.addColorStop(0.72, '#c8e2f4');
    grad.addColorStop(0.88, '#fdeecb');
    grad.addColorStop(1, '#fff6dc');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });
}

/** Umbrella stripes: coral and cream wedges (vertical stripes
 *  wrap the cone into wedges). Pattern only — no words. */
function makeStripeTexture() {
  return canvasTex(256, 64, (ctx, w, h) => {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#e2664a' : '#f6ecd8';
      ctx.fillRect((w / 8) * i, 0, w / 8, h);
    }
  }, [2, 1]);
}

/** A palm frond: a rib with angled leaflets, alpha-cut. */
function makeFrondTexture() {
  const t = canvasTex(128, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#3f7031';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(w / 2, h);
    ctx.quadraticCurveTo(w / 2 + 6, h * 0.5, w / 2, 6);
    ctx.stroke();
    for (let i = 0; i < 22; i++) {
      const f = i / 22;
      const y = h - f * (h - 14);
      const len = 14 + Math.sin(f * Math.PI) * 46;
      const droop = 10 + f * 22;
      ctx.strokeStyle = `rgba(${52 + i * 2},${112 + i},${44},0.95)`;
      ctx.lineWidth = 3.2 - f * 1.2;
      ctx.beginPath();
      ctx.moveTo(w / 2 + 3, y);
      ctx.quadraticCurveTo(w / 2 + len * 0.6, y - droop * 0.3, w / 2 + len, y + droop * 0.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(w / 2 - 3, y);
      ctx.quadraticCurveTo(w / 2 - len * 0.6, y - droop * 0.3, w / 2 - len, y + droop * 0.4);
      ctx.stroke();
    }
  });
  return t;
}

/** Shoreline foam: soft blotches, alpha-faded at the edges. */
function makeFoamTexture() {
  return canvasTex(512, 64, (ctx, w, h) => {
    const rnd = mulberry32(53455);
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 240; i++) {
      const x = rnd() * w, y = h * 0.5 + (rnd() - 0.5) * h * 0.7;
      const r = 3 + rnd() * 12;
      const fade = 1 - Math.abs(y - h / 2) / (h / 2);
      ctx.fillStyle = `rgba(252,253,250,${(0.10 + rnd() * 0.22) * fade})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.8, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [6, 1]);
}

/** Woven rattan for the chair seats and backs. */
function makeRattanTexture() {
  return canvasTex(128, 128, (ctx, w, h) => {
    const rnd = mulberry32(53566);
    ctx.fillStyle = '#a87f4e';
    ctx.fillRect(0, 0, w, h);
    const cell = 16;
    for (let y = 0; y < h / cell; y++) for (let x = 0; x < w / cell; x++) {
      if ((x + y) % 2 === 0) {
        ctx.fillStyle = 'rgba(70,48,22,0.28)';
        ctx.fillRect(x * cell, y * cell, cell, cell);
      } else {
        ctx.fillStyle = 'rgba(240,214,160,0.20)';
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    speckle(ctx, w, h, 500, rnd, 0.08, false);
  }, [2, 2]);
}

/* ------------------------------------------------------------------ */
/* cached assets                                                        */
/* ------------------------------------------------------------------ */

type CabanaAssets = {
  deck: MeshStandardMaterial; sand: MeshStandardMaterial; thatch: MeshStandardMaterial;
  ocean: MeshStandardMaterial; sky: MeshStandardMaterial; bamboo: MeshStandardMaterial;
  darkWood: MeshStandardMaterial; rattan: MeshStandardMaterial; stripes: MeshStandardMaterial;
  creamCanvas: MeshStandardMaterial; frond: MeshStandardMaterial; foam: MeshStandardMaterial;
  towel: MeshStandardMaterial; coolerWhite: MeshStandardMaterial; coolerTeal: MeshStandardMaterial;
  bulbGlow: MeshStandardMaterial; flame: MeshStandardMaterial; sailWhite: MeshStandardMaterial;
  trunk: MeshStandardMaterial;
  oceanTex: CanvasTexture;
};

let ASSETS: CabanaAssets | null = null;
function assets(): CabanaAssets {
  if (ASSETS) return ASSETS;
  ColorManagement.enabled = true;
  const oceanTex = makeOceanTexture();
  ASSETS = {
    deck: std({ map: makeDeckTexture(), roughness: 0.8, metalness: 0.02 }),
    sand: std({ map: makeSandTexture(), roughness: 1, metalness: 0 }),
    thatch: std({ map: makeThatchTexture(), roughness: 0.95, metalness: 0 }),
    ocean: std({ map: oceanTex, roughness: 0.3, metalness: 0.05 }),
    sky: std({ map: makeSkyTexture(), roughness: 1, metalness: 0, side: 2 /* BackSide */ }),
    bamboo: std({ color: '#b08d54', roughness: 0.75, metalness: 0.02 }),
    darkWood: std({ color: '#6a4a28', roughness: 0.8, metalness: 0 }),
    rattan: std({ map: makeRattanTexture(), roughness: 0.9, metalness: 0 }),
    stripes: std({ map: makeStripeTexture(), roughness: 0.85, metalness: 0, side: 2 /* DoubleSide */ }),
    creamCanvas: std({ color: '#f6ecd8', roughness: 0.9, metalness: 0, side: 2 /* DoubleSide */ }),
    frond: std({ map: makeFrondTexture(), roughness: 0.9, metalness: 0, side: 2, transparent: true, alphaTest: 0.35 }),
    foam: std({ map: makeFoamTexture(), roughness: 0.6, metalness: 0, transparent: true, opacity: 0.85, depthWrite: false }),
    towel: std({ color: '#e2664a', roughness: 0.95, metalness: 0 }),
    coolerWhite: std({ color: '#eef0ee', roughness: 0.45, metalness: 0.05 }),
    coolerTeal: std({ color: '#2a7a8a', roughness: 0.45, metalness: 0.05 }),
    bulbGlow: std({ color: '#ffd9a0', emissive: '#ffb45c', emissiveIntensity: 1.2, roughness: 0.5, metalness: 0 }),
    flame: std({ color: '#ffb45c', emissive: '#ff7a3d', emissiveIntensity: 2.2, roughness: 0.6, metalness: 0 }),
    sailWhite: std({ color: '#f8f6f0', roughness: 0.7, metalness: 0, side: 2 /* DoubleSide */ }),
    trunk: std({ color: '#7a5c38', roughness: 0.95, metalness: 0 }),
    oceanTex,
  };
  return ASSETS;
}

/** Local height helper: metres above the deck top → world y.
 *  The deck top is the room's floor for furniture purposes. */
const DECK_TOP = FLOOR_Y + 0.045;
const Y = (h: number) => DECK_TOP + h;

/* ------------------------------------------------------------------ */
/* motion + light life — fxOn only: the ocean drifts, the      */
/* string bulbs breathe almost imperceptibly, the torch flames */
/* flicker. fxOn off holds everything dead steady.             */
/* ------------------------------------------------------------------ */

type FlameRef = RefObject<{ intensity: number } | null>;

function CabanaLife({ a, fxOn, flames }: { a: CabanaAssets; fxOn: boolean; flames: FlameRef[] }) {
  useFrame(({ clock }, delta) => {
    if (!fxOn) return;
    a.oceanTex.offset.x = (a.oceanTex.offset.x + delta * 0.003) % 1;
    const t = clock.elapsedTime;
    a.bulbGlow.emissiveIntensity = 1.2 + Math.sin(t * 1.9) * 0.07;
    for (let i = 0; i < flames.length; i++) {
      const f = flames[i]!.current;
      if (f) f.intensity = 1.5 + Math.sin(t * 11 + i * 2.4) * 0.35 + Math.sin(t * 23 + i) * 0.2;
    }
  });
  return null;
}

function CabanaLights({ fxOn, flames }: { fxOn: boolean; flames: FlameRef[] }) {
  return (
    <>
      <hemisphereLight args={['#bfe2ff', '#caa06a', 0.66]} />
      <directionalLight
        position={[-7, 5.5, 2.5]}
        target-position={[0, -0.6, -0.5]}
        color="#ffd9a3"
        intensity={1.2}
        castShadow={fxOn}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8} shadow-camera-right={8}
        shadow-camera-top={8} shadow-camera-bottom={-8}
        shadow-bias={-0.0004}
      />
      {/* warm daylight bounce over the felt */}
      <pointLight position={[0, Y(2.8), 0]} intensity={4.5} distance={9} decay={2} color="#ffdcb0" />
      {/* the tiki torches flanking the boardwalk */}
      <pointLight ref={flames[0] as never} position={[-1.5, FLOOR_Y + 1.55, 6.4]} intensity={1.5} distance={4.5} decay={2} color="#ff9e45" />
      <pointLight ref={flames[1] as never} position={[1.5, FLOOR_Y + 1.55, 6.4]} intensity={1.5} distance={4.5} decay={2} color="#ff9e45" />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* the four seats — the kit chair at owner scale, dressed as a   */
/* cabana chair: bamboo-toned frame, woven rattan seat + back    */
/* ------------------------------------------------------------------ */

const CHAIR_SPOTS: { pos: [number, number, number]; ry: number }[] = [
  { pos: [0, DECK_TOP, 1.98], ry: Math.PI },
  { pos: [2.14, DECK_TOP, 0], ry: -Math.PI / 2 },
  { pos: [0, DECK_TOP, -1.98], ry: 0 },
  { pos: [-2.14, DECK_TOP, 0], ry: Math.PI / 2 },
];

function cabanaChairGeo() {
  const seatParts: G[] = [], backParts: G[] = [], legParts: G[] = [];
  seatParts.push(box(0.44, 0.04, 0.42, 0, 0.47, 0.01));
  backParts.push(box(0.42, 0.34, 0.04, 0, 0.82, -0.19, -0.10));
  for (const sx of [-1, 1]) {
    const x = 0.20 * sx;
    legParts.push(tube([x, 0.02, 0.24], [x, 0.47, -0.10], 0.016));
    legParts.push(tube([x, 0.02, -0.235], [x, 0.95, -0.225], 0.016));
    legParts.push(box(0.03, 0.025, 0.36, x, 0.27, 0.005));
  }
  return { seat: merged(seatParts), back: merged(backParts), legs: merged(legParts) };
}

function CabanaChairs({ a }: { a: CabanaAssets }) {
  const geos = useMemo(cabanaChairGeo, []);
  return (
    <group>
      {CHAIR_SPOTS.map(({ pos, ry }, i) => (
        <group key={i} position={pos} rotation={[0, ry, 0]}>
          <mesh geometry={geos.seat} material={a.rattan} castShadow receiveShadow />
          <mesh geometry={geos.back} material={a.rattan} castShadow receiveShadow />
          <mesh geometry={geos.legs} material={a.bamboo} castShadow />
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the shell — sky dome, ocean, sand, the raised deck, the       */
/* boardwalk south, the foam line at the shore                   */
/* ------------------------------------------------------------------ */

function Shell({ a }: { a: CabanaAssets }) {
  return (
    <group>
      {/* the sky dome — BackSide gradient, warm at the horizon */}
      <mesh material={a.sky} position={[0, FLOOR_Y + 0.4, 0]}>
        <sphereGeometry args={[44, 24, 16]} />
      </mesh>
      {/* the sand — the ground everything beyond the deck stands on */}
      <mesh material={a.sand} rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y - 0.36, 0]} receiveShadow>
        <planeGeometry args={[48, 48]} />
      </mesh>
      {/* the ocean: from the shoreline (z=-9.6) to the horizon */}
      <mesh material={a.ocean} rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y - 0.34, -21.6]} receiveShadow>
        <planeGeometry args={[64, 24]} />
      </mesh>
      {/* the foam line where the water meets the sand */}
      <mesh material={a.foam} rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y - 0.315, -9.45]}>
        <planeGeometry args={[46, 1.3]} />
      </mesh>
      {/* THE deck — a raised plank platform, top at FLOOR_Y+0.045
          (see header): the table and chairs stand on it, never
          in the sand */}
      <mesh material={a.deck} position={[0, FLOOR_Y, 0]} castShadow receiveShadow>
        <boxGeometry args={[7.6, 0.09, 7.6]} />
      </mesh>
      {/* the boardwalk south: lower planks running to the torches */}
      <mesh material={a.deck} position={[0, FLOOR_Y - 0.075, 8.35]} rotation={[0, 0.04, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.2, 0.07, 5.6]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the cabana — four bamboo posts, ridge beams, the thatch roof, */
/* string lights sagging along the front and back edges          */
/* ------------------------------------------------------------------ */

function StringRun({ a, z }: { a: CabanaAssets; z: number }) {
  const geos = useMemo(() => {
    const wire: G[] = [], bulbs: G[] = [];
    const sag = (x0: number, x1: number) => {
      const mid: [number, number, number] = [(x0 + x1) / 2, 2.86, z];
      wire.push(tube([x0, 3.24, z], mid, 0.008));
      wire.push(tube(mid, [x1, 3.24, z], 0.008));
      for (const f of [0.22, 0.5, 0.78]) {
        const x = x0 + (x1 - x0) * f;
        const y = 3.24 - Math.sin(f * Math.PI) * 0.38;
        bulbs.push(new SphereGeometry(0.035, 8, 8).translate(x, y - 0.05, z));
      }
    };
    sag(-3.35, 0);
    sag(0, 3.35);
    return { wire: merged(wire), bulbs: merged(bulbs) };
  }, [z]);
  return (
    <group position={[0, DECK_TOP, 0]}>
      <mesh geometry={geos.wire} material={a.darkWood} />
      <mesh geometry={geos.bulbs} material={a.bulbGlow} />
    </group>
  );
}

function Cabana({ a }: { a: CabanaAssets }) {
  const frame = useMemo(() => {
    const parts: G[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(cyl(0.055, 0.065, 3.3, sx * 3.35, 1.65, sz * 3.35, 10));
    // the side eave beams only — nothing spans the sight cone
    // over the table (no ridge beam, no front/back beams)
    parts.push(box(0.1, 0.1, 7.3, -3.35, 3.24, 0));
    parts.push(box(0.1, 0.1, 7.3, 3.35, 3.24, 0));
    // thatch fringe hanging off both eaves
    for (const sx of [-1, 1]) for (let i = 0; i < 18; i++) parts.push(box(0.03, 0.2, 0.06, sx * 3.82, 2.84, -3.6 + i * 0.42));
    return merged(parts);
  }, []);
  // The thatch: SINGLE-SIDED downward planes (see header) —
  // each plane is turned face-down, then tilted to the slope
  // (run 3.9 / rise 1.0 → ±0.249), so the standing camera
  // above looks straight through the roof at the table while
  // the seated view reads thatch overhead.
  const thatchWest = useMemo(() => {
    const g = new PlaneGeometry(4.35, 7.9);
    g.rotateX(Math.PI / 2);
    g.rotateZ(0.249);
    g.translate(-1.93, 3.40, 0);
    return g;
  }, []);
  const thatchEast = useMemo(() => {
    const g = new PlaneGeometry(4.35, 7.9);
    g.rotateX(Math.PI / 2);
    g.rotateZ(-0.249);
    g.translate(1.93, 3.40, 0);
    return g;
  }, []);
  return (
    <group position={[0, DECK_TOP, 0]}>
      <mesh geometry={frame} material={a.bamboo} castShadow receiveShadow />
      <mesh geometry={thatchWest} material={a.thatch} receiveShadow />
      <mesh geometry={thatchEast} material={a.thatch} receiveShadow />
      <StringRun a={a} z={3.35} />
      <StringRun a={a} z={-3.35} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* out on the sand — umbrellas, a towel + cooler, the torches,   */
/* palms, a lifeguard chair far east, a sailboat on the water    */
/* ------------------------------------------------------------------ */

function Umbrella({ a, pos, tilt, flip }: { a: CabanaAssets; pos: [number, number, number]; tilt: number; flip?: boolean }) {
  return (
    <group position={pos} rotation={[flip ? -tilt : tilt, 0, flip ? 0.1 : -0.06]}>
      <mesh material={a.bamboo} position={[0, 1.15, 0]} castShadow>
        <cylinderGeometry args={[0.028, 0.034, 2.3, 8]} />
      </mesh>
      <mesh material={a.stripes} position={[0, 2.32, 0]} castShadow>
        <coneGeometry args={[1.55, 0.44, 14, 1, true]} />
      </mesh>
      <mesh material={a.creamCanvas} position={[0, 2.26, 0]} castShadow>
        <coneGeometry args={[1.2, 0.34, 14, 1, true]} />
      </mesh>
      <mesh material={a.darkWood} position={[0, 2.62, 0]}>
        <sphereGeometry args={[0.045, 8, 8]} />
      </mesh>
    </group>
  );
}

function Palm({ a, pos, s }: { a: CabanaAssets; pos: [number, number, number]; s: number }) {
  const trunk = useMemo(() => {
    const parts: G[] = [];
    let x = 0, y = 0;
    for (let i = 0; i < 5; i++) {
      const nx = x + 0.16, ny = y + 0.78;
      parts.push(tube([x, y, 0], [nx, ny, 0], 0.11 - i * 0.012));
      x = nx; y = ny;
    }
    return merged(parts);
  }, []);
  const fronds = useMemo(() => {
    const parts: G[] = [];
    for (let i = 0; i < 7; i++) {
      const g = new BoxGeometry(0.55, 2.3, 0.01);
      g.translate(0, 1.05, 0);
      g.rotateX(-1.15 - (i % 3) * 0.16);
      g.rotateY((i / 7) * Math.PI * 2);
      g.translate(0.8, 3.9, 0);
      parts.push(g);
    }
    return merged(parts);
  }, []);
  return (
    <group position={pos} scale={[s, s, s]}>
      <mesh geometry={trunk} material={a.trunk} castShadow />
      <mesh geometry={fronds} material={a.frond} castShadow />
    </group>
  );
}

function SandDressing({ a }: { a: CabanaAssets }) {
  const torch = useMemo(() => merged([
    cyl(0.035, 0.045, 1.5, 0, 0.75, 0, 8),
    cyl(0.075, 0.055, 0.24, 0, 1.6, 0, 10),
  ]), []);
  const lifeguard = useMemo(() => merged([
    box(0.07, 2.0, 0.07, -0.45, 1.0, -0.3),
    box(0.07, 2.0, 0.07, 0.45, 1.0, -0.3),
    box(0.07, 1.7, 0.07, -0.45, 0.85, 0.35),
    box(0.07, 1.7, 0.07, 0.45, 0.85, 0.35),
    box(1.1, 0.07, 0.8, 0, 1.78, 0),
    box(1.1, 0.55, 0.07, 0, 2.1, -0.36),
    box(1.0, 0.05, 0.05, 0, 0.9, 0.33),
    box(1.0, 0.05, 0.05, 0, 1.3, 0.33),
  ]), []);
  return (
    <group>
      <Umbrella a={a} pos={[-6.4, FLOOR_Y - 0.36, -5.4]} tilt={0.14} />
      <Umbrella a={a} pos={[6.6, FLOOR_Y - 0.36, -4.4]} tilt={0.11} flip />
      {/* a striped towel + a cooler resting on the sand */}
      <mesh material={a.towel} position={[-5.3, FLOOR_Y - 0.345, 1.6]} rotation={[-Math.PI / 2, 0, 0.4]} receiveShadow>
        <planeGeometry args={[0.75, 1.7]} />
      </mesh>
      <mesh material={a.coolerWhite} position={[5.4, FLOOR_Y - 0.15, 2.6]} rotation={[0, -0.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.62, 0.42, 0.4]} />
      </mesh>
      <mesh material={a.coolerTeal} position={[5.4, FLOOR_Y + 0.09, 2.6]} rotation={[0, -0.3, 0]} castShadow>
        <boxGeometry args={[0.66, 0.07, 0.44]} />
      </mesh>
      {/* the tiki torches flanking the boardwalk's end */}
      {([-1.5, 1.5] as const).map((x) => (
        <group key={x} position={[x, FLOOR_Y - 0.36, 6.4]}>
          <mesh geometry={torch} material={a.darkWood} castShadow />
          <mesh material={a.flame} position={[0, 1.82, 0]}>
            <coneGeometry args={[0.055, 0.22, 8]} />
          </mesh>
        </group>
      ))}
      <Palm a={a} pos={[-7.6, FLOOR_Y - 0.36, -3.2]} s={1} />
      <Palm a={a} pos={[7.9, FLOOR_Y - 0.36, -5.8]} s={0.8} />
      {/* a lifeguard chair far east, silhouette scale */}
      <mesh geometry={lifeguard} material={a.creamCanvas} position={[8.8, FLOOR_Y - 0.36, -7.6]} rotation={[0, -0.5, 0]} castShadow />
      {/* a sailboat on the water: hull + two plain sails */}
      <group position={[-13, FLOOR_Y - 0.3, -25]} rotation={[0, 0.4, 0]}>
        <mesh material={a.darkWood}>
          <boxGeometry args={[1.7, 0.28, 0.44]} />
        </mesh>
        <mesh material={a.sailWhite} position={[-0.1, 1.05, 0]}>
          <boxGeometry args={[0.03, 1.7, 1.05]} />
        </mesh>
        <mesh material={a.sailWhite} position={[0.55, 0.8, 0]}>
          <boxGeometry args={[0.03, 1.15, 0.7]} />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */

export default function BeachCabanaRoom({ fxOn }: { fxOn: boolean }) {
  const a = assets();
  const flameA = useRef<{ intensity: number } | null>(null);
  const flameB = useRef<{ intensity: number } | null>(null);
  const flames = useMemo(() => [flameA, flameB], []);
  useEffect(() => {
    (window as unknown as { __bwmVenue?: unknown }).__bwmVenue = { id: 'beach', fx: fxOn, studio: true, room: 'beach-cabana', props: false };
  }, [fxOn]);
  return (
    <group>
      <CabanaLights fxOn={fxOn} flames={flames} />
      <CabanaLife a={a} fxOn={fxOn} flames={flames} />
      <CabanaChairs a={a} />
      <Shell a={a} />
      <Cabana a={a} />
      <SandDressing a={a} />
      {/* NO table here — the shared game table is the anchor. */}
    </group>
  );
}
