import { useEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry, CanvasTexture, ColorManagement, CylinderGeometry,
  MeshStandardMaterial, Quaternion, RepeatWrapping, SphereGeometry, SRGBColorSpace,
  TorusGeometry, Vector3,
} from 'three';
import { useFrame } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The shared table's floor plane (sibling rooms keep their own). */
const FLOOR_Y = -0.9;

/**
 * THE YACHT DECK — the yacht venue's own 3D room for REGULAR
 * tables (venues rollout Batch C2, 2026-10-28: "Now all the
 * other venues need to be updated the same way"). The yacht
 * venue hosts no story stop, so there is no story branch:
 * Scene mounts this room for every yacht table at High
 * quality, and Low quality keeps the shipped cube-config
 * YachtRoom (yachtLayout), untouched.
 *
 * The room: the aft deck of a motor yacht in miniature — a
 * teak deck under the table, the white cabin wall far with
 * its sliding door, brass-rimmed portholes and a blank name
 * board, a flybridge brow and windshield above it, a radar
 * arch over the aft deck, stainless rails all round with
 * open water beyond, a transom bench aft, sun pads forward
 * on both sides, a helm console hint to the west and a plain
 * ensign at the stern. Daytime-bright: clean sky, white
 * gelcoat, polished wood. The identity carries over from the
 * cube dress (VENUES.md: open-air deck, teak underfoot, sea
 * and sky beyond the rails; felt #14365e, teak rail).
 *
 * Route: ALL CODE, zero downloads — every item is box /
 * cylinder / tube / torus work, every texture a seeded canvas.
 *
 * COPLANAR FLOOR (the Rec lesson, 2026-10-28): this room's
 * teak deck sits at FLOOR_Y, the depth every bespoke room
 * owns; the sea rides 1.1 m BELOW it and the hull's top face
 * 0.02 below it — no two opaque surfaces share a depth here.
 * Nothing else renders at
 * FLOOR_Y at this venue: TableModel's 30×30 ground plane is
 * classic-only (Scene.tsx: `def.id === 'classic' &&
 * !roomFloor`), and the cube shell — whose floor rides
 * +0.005 over the same depth — never mounts on this branch
 * (same Scene ternary). The surfaces never share a frame,
 * let alone a depth.
 *
 * Standing-camera discipline: the room is open-air — no
 * ceiling at all. The only overhead structure is the radar
 * arch (posts at the aft corners, crossbar at floor + 2.9
 * behind the far seat) and the flybridge brow on the far
 * wall; nothing crosses the sight cone over the felt.
 *
 * HARD EXCLUSIONS: no text / lettering anywhere (the name
 * board is blank mahogany, the ensign is a plain field, no
 * labels), no people dressing (the character phase owns
 * figures).
 *
 * Seat back-clearances (kit chair back = CHAIR_SPOTS origin +
 * ~0.25 m): far seat back z=-2.23 → cabin wall face -4.425 =
 * 2.20 m; player back z=+2.23 → transom bench front 4.445 =
 * 2.22 m (the open aft rail at 5.2 is further); west back
 * x=-2.39 → sun pad inner edge -3.45 = 1.06 m (on-axis the
 * open deck runs to the bulwark at -5.28 = 2.89 m); east back
 * x=+2.39 → sun pad inner edge 3.45 = 1.06 m (the settee
 * face at 4.3 is 1.91 m). All ≥ 0.6 m.
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
      ? `rgba(255,240,214,${(alpha * rnd()).toFixed(3)})`
      : `rgba(${v},${v},${v},${(alpha * rnd()).toFixed(3)})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

type MatOpts = {
  color?: string; map?: CanvasTexture; roughness: number; metalness: number;
  emissive?: string; emissiveIntensity?: number; side?: MeshStandardMaterial['side'];
  transparent?: boolean; opacity?: number;
};
function std(o: MatOpts) {
  return new MeshStandardMaterial({
    color: o.color ?? '#ffffff', map: o.map ?? null,
    roughness: o.roughness, metalness: o.metalness,
    emissive: o.emissive ?? '#000000', emissiveIntensity: o.emissiveIntensity ?? 1,
    ...(o.side ? { side: o.side } : {}),
    ...(o.transparent ? { transparent: true, opacity: o.opacity ?? 1 } : {}),
  });
}

type G = BoxGeometry | CylinderGeometry | SphereGeometry | TorusGeometry;
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

/** Teak decking: pale golden planks running fore-aft with dark
 *  caulk seams (canvas tile = 2.75 m at [4,4] over the deck). */
function makeTeakTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(52011);
    ctx.fillStyle = '#4a3220'; // the caulk seams
    ctx.fillRect(0, 0, w, h);
    const pw = 512 / 6; // six planks across the tile
    for (let p = 0; p < 6; p++) {
      const j = (rnd() - 0.5) * 26;
      ctx.fillStyle = `rgb(${Math.round(196 + j)},${Math.round(152 + j * 0.8)},${Math.round(102 + j * 0.6)})`;
      ctx.fillRect(p * pw + 2, 0, pw - 4, h);
      // butt joints staggered per plank
      const joints = 1 + Math.floor(rnd() * 2);
      ctx.fillStyle = 'rgba(74,50,32,0.85)';
      for (let b = 0; b < joints; b++) ctx.fillRect(p * pw + 2, rnd() * h, pw - 4, 3);
      // grain
      ctx.strokeStyle = 'rgba(120,84,48,0.30)';
      ctx.lineWidth = 1;
      for (let gLine = 0; gLine < 5; gLine++) {
        ctx.beginPath();
        const gx = p * pw + 6 + rnd() * (pw - 12);
        ctx.moveTo(gx, 0);
        ctx.bezierCurveTo(gx + 3, h * 0.3, gx - 3, h * 0.6, gx + 2, h);
        ctx.stroke();
      }
    }
    speckle(ctx, w, h, 1500, rnd, 0.05, false);
    speckle(ctx, w, h, 700, rnd, 0.05, true);
  }, [4, 4]);
}

/** Open water: a deep blue-green gradient field with sun
 *  sparkle — drawn once, drifted slowly under fxOn. */
function makeSeaTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(52122);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#2e6ea6');
    grad.addColorStop(0.55, '#2a6496');
    grad.addColorStop(1, '#35789f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // wavelet strokes
    for (let i = 0; i < 260; i++) {
      const y = rnd() * h, x = rnd() * w, len = 8 + rnd() * 30;
      ctx.strokeStyle = `rgba(${rnd() > 0.5 ? '190,225,245' : '18,52,84'},${(0.05 + rnd() * 0.10).toFixed(2)})`;
      ctx.lineWidth = 1 + rnd() * 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + len / 2, y + (rnd() - 0.5) * 3, x + len, y);
      ctx.stroke();
    }
    speckle(ctx, w, h, 900, rnd, 0.10, true);
  }, [7, 7]);
}

/** Sky dome gradient: zenith blue to a near-white horizon. */
function makeSkyTexture() {
  return canvasTex(64, 512, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#5f97d6');
    grad.addColorStop(0.45, '#8fb9e4');
    grad.addColorStop(0.72, '#cfe4f6');
    grad.addColorStop(0.88, '#eef6fc');
    grad.addColorStop(1, '#f7fbff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });
}

/* ------------------------------------------------------------------ */
/* cached assets                                                        */
/* ------------------------------------------------------------------ */

type DeckAssets = {
  teak: MeshStandardMaterial; sea: MeshStandardMaterial; sky: MeshStandardMaterial;
  gelcoat: MeshStandardMaterial; mahogany: MeshStandardMaterial; teakDark: MeshStandardMaterial;
  chrome: MeshStandardMaterial; brass: MeshStandardMaterial; navy: MeshStandardMaterial;
  glassNavy: MeshStandardMaterial; ringWhite: MeshStandardMaterial; ringRed: MeshStandardMaterial;
  ensign: MeshStandardMaterial;
  seaTex: CanvasTexture;
};

let ASSETS: DeckAssets | null = null;
function assets(): DeckAssets {
  if (ASSETS) return ASSETS;
  ColorManagement.enabled = true;
  const seaTex = makeSeaTexture();
  ASSETS = {
    teak: std({ map: makeTeakTexture(), roughness: 0.55, metalness: 0.04 }),
    sea: std({ map: seaTex, roughness: 0.32, metalness: 0.05 }),
    sky: std({ map: makeSkyTexture(), roughness: 1, metalness: 0, side: 2 /* BackSide */ }),
    gelcoat: std({ color: '#f2f0ea', roughness: 0.28, metalness: 0.05 }),
    mahogany: std({ color: '#5a3420', roughness: 0.42, metalness: 0.05 }),
    teakDark: std({ color: '#8a6238', roughness: 0.6, metalness: 0.02 }),
    chrome: std({ color: '#d8dde2', roughness: 0.22, metalness: 0.9 }),
    brass: std({ color: '#c9a24d', roughness: 0.3, metalness: 0.9 }),
    navy: std({ color: '#1d3350', roughness: 0.85, metalness: 0.02 }),
    glassNavy: std({ color: '#16283e', roughness: 0.08, metalness: 0.85 }),
    ringWhite: std({ color: '#f4f2ec', roughness: 0.5, metalness: 0.02 }),
    ringRed: std({ color: '#c83a2e', roughness: 0.5, metalness: 0.02 }),
    ensign: std({ color: '#274b73', roughness: 0.9, metalness: 0, side: 2 /* DoubleSide */ }),
    seaTex,
  };
  return ASSETS;
}

/** Local height helper: metres above the deck → world y. */
const Y = (h: number) => FLOOR_Y + h;

/* ------------------------------------------------------------------ */
/* motion — fxOn only: the sea drifts almost imperceptibly and   */
/* the ensign stirs in the breeze. fxOn off holds both dead      */
/* steady (and the frameloop rests).                             */
/* ------------------------------------------------------------------ */

function SeaDrift({ a, fxOn }: { a: DeckAssets; fxOn: boolean }) {
  useFrame((_, delta) => {
    if (fxOn) a.seaTex.offset.x = (a.seaTex.offset.x + delta * 0.004) % 1;
  });
  return null;
}

function Ensign({ a, fxOn }: { a: DeckAssets; fxOn: boolean }) {
  const grp = useRef<{ rotation: { set: (x: number, y: number, z: number) => void } } | null>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const g = grp.current as unknown as { rotation: { y: number; z: number } } | null;
    if (!g) return;
    g.rotation.y = fxOn ? Math.sin(t * 1.9) * 0.16 + Math.sin(t * 3.7) * 0.05 : 0.1;
    g.rotation.z = fxOn ? Math.sin(t * 2.6) * 0.04 : 0;
  });
  return (
    <group position={[0.03, Y(3.14), 5.28]}>
      {/* the flag flies from the stern staff toward the table (+x hoist) */}
      <group ref={grp as never}>
        <mesh material={a.ensign} position={[0.44, -0.26, 0]} castShadow>
          <planeGeometry args={[0.88, 0.52]} />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* lights — daytime-bright: a high sun, sky fill, and a warm     */
/* bounce over the felt. Shadows ride fxOn like the siblings.    */
/* ------------------------------------------------------------------ */

function DeckLights({ fxOn }: { fxOn: boolean }) {
  return (
    <>
      <hemisphereLight args={['#cfe6ff', '#3a5a74', 0.62]} />
      <directionalLight
        position={[6, 9, 3]}
        target-position={[0, -0.6, -0.5]}
        color="#fff1d6"
        intensity={1.15}
        castShadow={fxOn}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-7} shadow-camera-right={7}
        shadow-camera-top={7} shadow-camera-bottom={-7}
        shadow-bias={-0.0004}
      />
      <pointLight position={[0, Y(2.6), 0]} intensity={5} distance={9} decay={2} color="#fff4e0" />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* the four seats — the kit chair at owner scale, dressed as a   */
/* teak deck chair: teak slats, chrome frame, navy pads          */
/* ------------------------------------------------------------------ */

const CHAIR_SPOTS: { pos: [number, number, number]; ry: number }[] = [
  { pos: [0, FLOOR_Y, 1.98], ry: Math.PI },
  { pos: [2.14, FLOOR_Y, 0], ry: -Math.PI / 2 },
  { pos: [0, FLOOR_Y, -1.98], ry: 0 },
  { pos: [-2.14, FLOOR_Y, 0], ry: Math.PI / 2 },
];

function deckChairGeo() {
  const frameParts: G[] = [], slatParts: G[] = [], padParts: G[] = [], legParts: G[] = [];
  frameParts.push(box(0.44, 0.045, 0.42, 0, 0.47, 0.01));
  padParts.push(box(0.40, 0.035, 0.38, 0, 0.51, 0.01));
  // back: two teak slats on chrome posts, a navy pad between
  slatParts.push(box(0.42, 0.09, 0.028, 0, 0.94, -0.205, -0.10));
  slatParts.push(box(0.42, 0.07, 0.028, 0, 0.66, -0.178, -0.10));
  padParts.push(box(0.38, 0.15, 0.025, 0, 0.80, -0.192, -0.10));
  for (const sx of [-1, 1]) {
    const x = 0.20 * sx;
    legParts.push(tube([x, 0.02, 0.24], [x, 0.47, -0.10], 0.0135));
    legParts.push(tube([x, 0.02, -0.235], [x, 0.97, -0.225], 0.0135));
    legParts.push(box(0.026, 0.022, 0.36, x, 0.27, 0.005));
  }
  return {
    frame: merged(frameParts), slats: merged(slatParts),
    pads: merged(padParts), legs: merged(legParts),
  };
}

function DeckChairs({ a }: { a: DeckAssets }) {
  const geos = useMemo(deckChairGeo, []);
  return (
    <group>
      {CHAIR_SPOTS.map(({ pos, ry }, i) => (
        <group key={i} position={pos} rotation={[0, ry, 0]}>
          <mesh geometry={geos.frame} material={a.teakDark} castShadow receiveShadow />
          <mesh geometry={geos.slats} material={a.teakDark} castShadow receiveShadow />
          <mesh geometry={geos.pads} material={a.navy} castShadow receiveShadow />
          <mesh geometry={geos.legs} material={a.chrome} castShadow />
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the shell — teak deck, sea, sky dome, bulwark caps + rails    */
/* ------------------------------------------------------------------ */

function Shell({ a }: { a: DeckAssets }) {
  const rails = useMemo(() => {
    const parts: G[] = [];
    // stanchions along both sides and across the stern
    for (const sx of [-1, 1]) for (let i = 0; i < 9; i++) parts.push(cyl(0.016, 0.016, 1.0, sx * 5.3, 0.5, -4.8 + i * 1.2, 8));
    for (let i = 0; i < 9; i++) {
      const x = -4.8 + i * 1.2;
      if (Math.abs(x) < 1.0) continue; // the stern gate gap
      parts.push(cyl(0.016, 0.016, 1.0, x, 0.5, 5.2, 8));
    }
    // the two wire rows, both sides + stern
    for (const sx of [-1, 1]) for (const hgt of [0.55, 0.78]) parts.push(tube([sx * 5.3, hgt, -4.85], [sx * 5.3, hgt, 5.2], 0.006));
    for (const hgt of [0.55, 0.78]) {
      parts.push(tube([-5.3, hgt, 5.2], [-1.0, hgt, 5.2], 0.006));
      parts.push(tube([1.0, hgt, 5.2], [5.3, hgt, 5.2], 0.006));
    }
    return merged(parts);
  }, []);
  const caps = useMemo(() => merged([
    box(0.16, 0.06, 10.7, -5.32, 1.02, 0),
    box(0.16, 0.06, 10.7, 5.32, 1.02, 0),
    box(4.4, 0.06, 0.16, -3.2, 1.02, 5.22),
    box(4.4, 0.06, 0.16, 3.2, 1.02, 5.22),
    // brass cleats on the side caps
    box(0.2, 0.05, 0.06, -5.32, 1.07, -3.4),
    box(0.2, 0.05, 0.06, -5.32, 1.07, 3.4),
    box(0.2, 0.05, 0.06, 5.32, 1.07, -3.4),
    box(0.2, 0.05, 0.06, 5.32, 1.07, 3.4),
  ]), []);
  return (
    <group>
      {/* the sky dome — BackSide gradient, horizon at deck level */}
      <mesh material={a.sky} position={[0, FLOOR_Y + 0.4, 0]}>
        <sphereGeometry args={[42, 24, 16]} />
      </mesh>
      {/* open water, 1.1 m below the deck — never coplanar */}
      <mesh material={a.sea} rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y - 1.1, 0]} receiveShadow>
        <planeGeometry args={[95, 95]} />
      </mesh>
      {/* the teak deck — THE floor at FLOOR_Y (see header) */}
      <mesh material={a.teak} rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} receiveShadow>
        <planeGeometry args={[11.0, 10.6]} />
      </mesh>
      {/* the hull edge under the deck rim, so the deck reads afloat —
          its top sits 0.02 BELOW the teak (never coplanar with it) */}
      <mesh material={a.gelcoat} position={[0, FLOOR_Y - 0.30, 0]}>
        <boxGeometry args={[11.06, 0.56, 10.66]} />
      </mesh>
      <mesh geometry={rails} material={a.chrome} position={[0, FLOOR_Y, 0]} castShadow />
      <mesh geometry={caps} material={a.teakDark} position={[0, FLOOR_Y, 0]} castShadow receiveShadow />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the cabin — far wall: gelcoat panel, sliding door, brass      */
/* portholes, the blank name board, flybridge above              */
/* ------------------------------------------------------------------ */

function Cabin({ a }: { a: DeckAssets }) {
  const portholes = useMemo(() => {
    const rims: G[] = [], glass: G[] = [];
    for (const x of [-3.4, -2.15, -0.9]) {
      const rim = new CylinderGeometry(0.23, 0.23, 0.05, 20);
      rim.rotateX(Math.PI / 2);
      rim.translate(x, 1.55, -4.40);
      rims.push(rim as never);
      const gl = new CylinderGeometry(0.185, 0.185, 0.055, 20);
      gl.rotateX(Math.PI / 2);
      gl.translate(x, 1.55, -4.40);
      glass.push(gl as never);
    }
    return { rims: merged(rims), glass: merged(glass) };
  }, []);
  return (
    <group>
      {/* the cabin front: inner face at z=-4.425 */}
      <mesh material={a.gelcoat} position={[-0.4, Y(1.25), -4.55]} castShadow receiveShadow>
        <boxGeometry args={[9.6, 2.5, 0.25]} />
      </mesh>
      {/* the mahogany toe rail along the cabin base */}
      <mesh material={a.mahogany} position={[-0.4, Y(0.07), -4.40]} castShadow receiveShadow>
        <boxGeometry args={[9.6, 0.14, 0.06]} />
      </mesh>
      {/* the sliding door: dark glass in a mahogany frame */}
      <mesh material={a.mahogany} position={[1.3, Y(1.02), -4.415]} castShadow>
        <boxGeometry args={[1.42, 2.04, 0.05]} />
      </mesh>
      <mesh material={a.glassNavy} position={[1.3, Y(1.04), -4.385]}>
        <boxGeometry args={[1.26, 1.9, 0.03]} />
      </mesh>
      <mesh material={a.chrome} position={[0.78, Y(1.02), -4.36]} castShadow>
        <boxGeometry args={[0.035, 0.5, 0.035]} />
      </mesh>
      {/* portholes: brass rims, dark glass */}
      <mesh geometry={portholes.rims} material={a.brass} position={[0, FLOOR_Y, 0]} castShadow />
      <mesh geometry={portholes.glass} material={a.glassNavy} position={[0, FLOOR_Y, 0]} />
      {/* the name board: blank mahogany — no lettering, ever */}
      <mesh material={a.mahogany} position={[-2.15, Y(2.24), -4.40]} castShadow>
        <boxGeometry args={[2.3, 0.3, 0.04]} />
      </mesh>
      <mesh material={a.brass} position={[-2.15, Y(2.24), -4.375]}>
        <boxGeometry args={[2.34, 0.035, 0.02]} />
      </mesh>
      {/* the life ring on the cabin wall, west end */}
      <mesh material={a.ringWhite} position={[-4.55, Y(1.5), -4.38]} castShadow>
        <torusGeometry args={[0.27, 0.07, 10, 24]} />
      </mesh>
      {([0, Math.PI / 2, Math.PI, -Math.PI / 2] as const).map((rz, i) => (
        <mesh key={i} material={a.ringRed} position={[-4.55 + Math.sin(rz) * 0.27, Y(1.5) + Math.cos(rz) * 0.27, -4.375]} rotation={[0, 0, rz]} castShadow>
          <boxGeometry args={[0.09, 0.15, 0.145]} />
        </mesh>
      ))}
      {/* the flybridge: brow slab + slanted windshield band above */}
      <mesh material={a.gelcoat} position={[-0.4, Y(2.62), -4.62]} castShadow receiveShadow>
        <boxGeometry args={[9.6, 0.2, 0.66]} />
      </mesh>
      <mesh material={a.glassNavy} position={[-0.4, Y(3.0), -4.78]} rotation={[-0.32, 0, 0]}>
        <boxGeometry args={[8.6, 0.62, 0.05]} />
      </mesh>
      <mesh material={a.gelcoat} position={[-0.4, Y(3.34), -4.9]} castShadow>
        <boxGeometry args={[9.2, 0.14, 0.5]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the radar arch — posts at the aft corners, a crossbar with    */
/* a dome and a whip antenna (all behind the far seat)           */
/* ------------------------------------------------------------------ */

function Arch({ a }: { a: DeckAssets }) {
  const frame = useMemo(() => merged([
    tube([-3.3, 0, -3.4], [-3.05, 2.9, -3.55], 0.055),
    tube([3.3, 0, -3.4], [3.05, 2.9, -3.55], 0.055),
    box(6.5, 0.16, 0.34, 0, 2.94, -3.55),
    tube([2.6, 3.0, -3.55], [2.6, 3.85, -3.55], 0.008),
  ]), []);
  return (
    <group position={[0, FLOOR_Y, 0]}>
      <mesh geometry={frame} material={a.gelcoat} castShadow receiveShadow />
      {/* the radar dome on the crossbar */}
      <mesh material={a.gelcoat} position={[0, 3.14, -3.55]} castShadow>
        <sphereGeometry args={[0.21, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <mesh material={a.teakDark} position={[0, 3.03, -3.55]}>
        <cylinderGeometry args={[0.23, 0.25, 0.05, 14]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* aft + side dressing — the transom bench, sun pads, the SE     */
/* settee, the helm console hint west, the stern staff           */
/* ------------------------------------------------------------------ */

function Dressing({ a }: { a: DeckAssets }) {
  const pads = useMemo(() => merged([
    // sun pad bases (gelcoat) + pads (navy) at both forward quarters
    box(1.8, 0.12, 3.5, -4.35, 0.06, -2.2),
    box(1.8, 0.12, 3.5, 4.35, 0.06, -2.2),
  ]), []);
  const padTops = useMemo(() => merged([
    box(1.7, 0.14, 3.4, -4.35, 0.19, -2.2),
    box(1.7, 0.14, 3.4, 4.35, 0.19, -2.2),
    box(1.7, 0.3, 0.14, -4.35, 0.3, -3.82),
    box(1.7, 0.3, 0.14, 4.35, 0.3, -3.82),
  ]), []);
  return (
    <group position={[0, FLOOR_Y, 0]}>
      {/* the transom bench aft: base, seat pad, back pad */}
      <mesh material={a.gelcoat} position={[0, 0.25, 4.72]} castShadow receiveShadow>
        <boxGeometry args={[3.4, 0.5, 0.55]} />
      </mesh>
      <mesh material={a.navy} position={[0, 0.56, 4.7]} castShadow receiveShadow>
        <boxGeometry args={[3.3, 0.12, 0.5]} />
      </mesh>
      <mesh material={a.navy} position={[0, 0.86, 4.95]} castShadow receiveShadow>
        <boxGeometry args={[3.3, 0.48, 0.12]} />
      </mesh>
      <mesh geometry={pads} material={a.gelcoat} castShadow receiveShadow />
      <mesh geometry={padTops} material={a.navy} castShadow receiveShadow />
      {/* the SE settee: base + seat + back along the east rail */}
      <mesh material={a.gelcoat} position={[4.62, 0.21, 1.6]} castShadow receiveShadow>
        <boxGeometry args={[0.62, 0.42, 2.2]} />
      </mesh>
      <mesh material={a.navy} position={[4.6, 0.5, 1.6]} castShadow receiveShadow>
        <boxGeometry args={[0.58, 0.12, 2.1]} />
      </mesh>
      <mesh material={a.navy} position={[4.86, 0.78, 1.6]} castShadow receiveShadow>
        <boxGeometry args={[0.12, 0.5, 2.1]} />
      </mesh>
      {/* the helm hint, west-forward: console, slanted screen, wheel */}
      <group position={[-3.85, 0, -3.45]} rotation={[0, 0.5, 0]}>
        <mesh material={a.gelcoat} castShadow receiveShadow position={[0, 0.475, 0]}>
          <boxGeometry args={[1.15, 0.95, 0.5]} />
        </mesh>
        <mesh material={a.glassNavy} position={[0, 1.0, 0.08]} rotation={[-0.42, 0, 0]}>
          <boxGeometry args={[1.0, 0.05, 0.44]} />
        </mesh>
        <mesh material={a.mahogany} position={[0, 0.86, 0.33]} rotation={[0.5, 0, 0]} castShadow>
          <torusGeometry args={[0.21, 0.02, 8, 24]} />
        </mesh>
        <mesh material={a.chrome} position={[0, 0.72, 0.26]} rotation={[0.5, 0, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 0.22, 8]} />
        </mesh>
      </group>
      {/* the stern staff for the ensign */}
      <mesh material={a.teakDark} position={[0, 1.6, 5.14]} rotation={[0.1, 0, 0]} castShadow>
        <cylinderGeometry args={[0.02, 0.026, 3.2, 8]} />
      </mesh>
      <mesh material={a.brass} position={[0, 3.22, 5.3]}>
        <sphereGeometry args={[0.035, 8, 8]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */

export default function YachtDeckRoom({ fxOn }: { fxOn: boolean }) {
  const a = assets();
  useEffect(() => {
    (window as unknown as { __bwmVenue?: unknown }).__bwmVenue = { id: 'yacht', fx: fxOn, studio: true, room: 'yacht-deck', props: false };
  }, [fxOn]);
  return (
    <group>
      <DeckLights fxOn={fxOn} />
      <SeaDrift a={a} fxOn={fxOn} />
      <DeckChairs a={a} />
      <Shell a={a} />
      <Cabin a={a} />
      <Arch a={a} />
      <Dressing a={a} />
      <Ensign a={a} fxOn={fxOn} />
      {/* NO table here — the shared game table is the anchor. */}
    </group>
  );
}
