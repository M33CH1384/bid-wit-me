import { useEffect, useMemo } from 'react';
import {
  BoxGeometry, CanvasTexture, ColorManagement, CylinderGeometry,
  MeshStandardMaterial, Quaternion, RepeatWrapping, SphereGeometry, SRGBColorSpace,
  TorusGeometry, Vector3,
} from 'three';
import { Fog } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHAIR_SPOTS } from './classicStudioLayout';

/** The shared table's floor plane (sibling rooms keep their own). */
const FLOOR_Y = -0.9;

/**
 * THE REC CENTER — story Stop 3's 3D room (Lil' Man & Trey).
 *
 * Mounted by Scene only for a story table carrying stop
 * `rec-center` at High quality on the classic venue; every
 * other classic table — and Low quality everywhere — keeps the
 * shipped ClassicStudio, untouched. The room is sandbox-
 * certified (RecCenterCodeRoom in the immersive sandbox): a
 * full indoor basketball court — the game table at centre
 * court on the centre circle; a polished maple floor with
 * painted court lines (canvas texture, scene work per the
 * manifest); blue/grey block walls with a high clerestory band;
 * a folding BLUE bleacher bank (REC-02, 7.0 × 1.6, H 1.50,
 * 4 rows, centre stair) centred on the FAR (north) wall under
 * a plain mustard-yellow BLANK banner (REC-03, no lettering);
 * ceiling-suspended hoop assemblies at BOTH court ends
 * (REC-01: backboard 1.80 × 1.05, top ≈ 3.90 over the floor,
 * rim Ø 0.45 at 3.05, clear acrylic board, orange rim, white
 * net, truss mount — at x = ±9.3, ~9 m from the table, never
 * overhanging it); a blue vinyl wall-padding run (REC-04,
 * 6 panels H 2.00) on the south wall; a gym mat stack
 * (REC-05), a basketball rack with balls (REC-06), a stacked-
 * folding-chairs lean (REC-07) and blue double exit doors
 * (REC-08, no signs). Atmosphere: bright flat fluorescent —
 * the loudest, emptiest room on the route.
 *
 * Route: ALL CODE, zero downloads — hoops / bleachers / mats
 * are frame-and-panel / tube construction; no Forge mixes.
 *
 * Standing-camera discipline: the ceiling is a SINGLE-SIDED
 * plane at floor + 7.00 facing DOWN only — invisible from the
 * standing camera above it; there are NO beams over the table
 * and the fluorescent fixtures run in two rows at z = ±3.4,
 * around the table, never crossing over the felt in the
 * standing sightline. The hoop trusses stand at the court
 * ends, ±9 m out.
 *
 * Seat back-clearances (chair back rearmost point = the
 * CHAIR_SPOTS origin + 0.25 m — the back-leg tube at local
 * z −0.235 with r 0.0135 → 0.2485, rounded 0.25):
 *   far (N, 0,−2.45): back z=−2.70 → bleacher front face
 *     z=−5.90 = 3.20 m;
 *   player (S, 0,+2.80): back z=+3.05 → wall-padding front
 *     face z=+7.39 = 4.34 m;
 *   west (−2.30,0): back x=−2.55 → west wall face −11.0 =
 *     8.45 m (doors/mat stack on that wall are off-axis, at
 *     z −3.5 / +3.6);
 *   east (+2.30,0): back x=+2.55 → east wall face +11.0 =
 *     8.45 m (ball rack / chair stack off-axis at z ±2.8).
 * All ≥ 0.6 m ✓ with wide margins — this is the biggest room.
 *
 * HARD EXCLUSIONS (manifest): no score display, no text /
 * lettering anywhere (the banner is deliberately BLANK), no
 * people, no balls in motion. The room renders no table: the
 * shared game table is the anchor.
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

/** Polished maple court floor: ONE canvas for the whole
 *  22 × 15 m court at 100 px per metre — plank strips running
 *  the court's length, painted lines (boundary, centre line +
 *  centre circle, keys, free-throw circles, 3-pt arcs at BOTH
 *  ends). No lettering, no logos. */
function makeCourtFloorTexture() {
  const S = 100; // px per metre
  return canvasTex(2200, 1500, (ctx, w, h) => {
    const rnd = mulberry32(30303);
    const MX = (x: number) => (x + 11) * S;
    const MZ = (z: number) => (z + 7.5) * S;
    ctx.fillStyle = '#a9742f'; ctx.fillRect(0, 0, w, h);
    const strip = 12;
    for (let y = 0; y < h; y += strip) {
      const j = (rnd() - 0.5) * 30;
      ctx.fillStyle = `rgb(${Math.round(178 + j)},${Math.round(122 + j * 0.75)},${Math.round(58 + j * 0.5)})`;
      ctx.fillRect(0, y, w, strip - 1);
      ctx.fillStyle = 'rgba(90,55,20,0.5)';
      let x = ((y / strip) % 3) * 340 + rnd() * 120;
      for (; x < w; x += 620 + rnd() * 260) ctx.fillRect(x, y, 2, strip - 1);
      ctx.strokeStyle = 'rgba(120,72,26,0.20)';
      ctx.lineWidth = 1;
      for (let gLine = 0; gLine < 5; gLine++) {
        const gy = y + 2 + rnd() * (strip - 4);
        ctx.beginPath(); ctx.moveTo(0, gy);
        ctx.bezierCurveTo(w * 0.3, gy + (rnd() - 0.5) * 3, w * 0.7, gy - (rnd() - 0.5) * 3, w, gy);
        ctx.stroke();
      }
    }
    speckle(ctx, w, h, 9000, rnd, 0.05, false);
    const sheen = ctx.createLinearGradient(0, 0, 0, h);
    sheen.addColorStop(0, 'rgba(255,240,210,0)');
    sheen.addColorStop(0.5, 'rgba(255,240,210,0.10)');
    sheen.addColorStop(1, 'rgba(255,240,210,0)');
    ctx.fillStyle = sheen; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#f3eee0';
    ctx.lineWidth = 5;
    ctx.strokeRect(MX(-9.5), MZ(-6.0), 19 * S, 12 * S);
    ctx.beginPath(); ctx.moveTo(MX(0), MZ(-6.0)); ctx.lineTo(MX(0), MZ(6.0)); ctx.stroke();
    ctx.beginPath(); ctx.arc(MX(0), MZ(0), 1.8 * S, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(140,60,30,0.10)';
    ctx.beginPath(); ctx.arc(MX(0), MZ(0), 1.8 * S, 0, Math.PI * 2); ctx.fill();
    for (const s of [-1, 1]) {
      const bx = s < 0 ? -9.5 : 9.5 - 5.8;
      ctx.strokeRect(MX(bx), MZ(-2.45), 5.8 * S, 4.9 * S);
      ctx.beginPath(); ctx.arc(MX(s * (9.5 - 5.8)), MZ(0), 1.8 * S, 0, Math.PI * 2); ctx.stroke();
      const hx = MX(s * 8.92), hz = MZ(0);
      const ang = Math.asin(5.6 / 6.25);
      ctx.beginPath();
      if (s < 0) ctx.arc(hx, hz, 6.25 * S, -ang, ang);
      else ctx.arc(hx, hz, 6.25 * S, Math.PI - ang, Math.PI + ang);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(MX(s * 9.5), MZ(-5.6)); ctx.lineTo(MX(s * 6.145), MZ(-5.6));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(MX(s * 9.5), MZ(5.6)); ctx.lineTo(MX(s * 6.145), MZ(5.6));
      ctx.stroke();
    }
  });
}

/** Painted concrete-block wall texture in a base tone. */
function makeBlockWallTexture(base: [number, number, number], seed: number) {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(seed);
    ctx.fillStyle = '#6d7278'; ctx.fillRect(0, 0, w, h);
    const bw = 512 / 5, bh = 512 / 10, gap = 3;
    for (let row = 0; row < 10; row++) {
      const off = row % 2 === 0 ? 0 : bw / 2;
      for (let col = -1; col < 6; col++) {
        const j = (rnd() - 0.5) * 12;
        ctx.fillStyle = `rgb(${Math.round(base[0] + j)},${Math.round(base[1] + j)},${Math.round(base[2] + j * 0.9)})`;
        ctx.fillRect(col * bw + off + gap / 2, row * bh + gap / 2, bw - gap, bh - gap);
      }
    }
    speckle(ctx, w, h, 2600, rnd, 0.05, false);
  }, [6, 2]);
}

/** Light-grey acoustic ceiling tile with a faint grid. */
function makeGymCeilingTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const rnd = mulberry32(70707);
    ctx.fillStyle = '#cfd2d4'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 2000, rnd, 0.05, false);
    ctx.strokeStyle = 'rgba(105,110,115,0.65)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, w, h);
  }, [11, 7.5]);
}

/* ------------------------------------------------------------------ */
/* cached assets                                                        */
/* ------------------------------------------------------------------ */

type RecAssets = {
  court: MeshStandardMaterial; wallBlue: MeshStandardMaterial; wallGrey: MeshStandardMaterial;
  ceiling: MeshStandardMaterial; clerestory: MeshStandardMaterial; frameGrey: MeshStandardMaterial;
  bleacherBlue: MeshStandardMaterial; bleacherSteel: MeshStandardMaterial;
  bannerYellow: MeshStandardMaterial; bannerNavy: MeshStandardMaterial;
  acrylic: MeshStandardMaterial; boardWhite: MeshStandardMaterial; rimOrange: MeshStandardMaterial;
  netWhite: MeshStandardMaterial; trussBlack: MeshStandardMaterial;
  padBlue: MeshStandardMaterial; matBlue: MeshStandardMaterial; matEdge: MeshStandardMaterial;
  ballOrange: MeshStandardMaterial; rackSteel: MeshStandardMaterial;
  chairPanel: MeshStandardMaterial; steelBlack: MeshStandardMaterial;
  doorBlue: MeshStandardMaterial; doorGlass: MeshStandardMaterial;
  housing: MeshStandardMaterial; panelGlow: MeshStandardMaterial;
};

let ASSETS: RecAssets | null = null;
function assets(): RecAssets {
  if (ASSETS) return ASSETS;
  ColorManagement.enabled = true;
  ASSETS = {
    court: std({ map: makeCourtFloorTexture(), roughness: 0.34, metalness: 0.05 }),
    wallBlue: std({ map: makeBlockWallTexture([62, 102, 156], 3101), roughness: 0.92, metalness: 0 }),
    wallGrey: std({ map: makeBlockWallTexture([148, 152, 156], 3102), roughness: 0.94, metalness: 0 }),
    ceiling: std({ map: makeGymCeilingTexture(), roughness: 0.96, metalness: 0 }),
    clerestory: std({ color: '#e6f1f6', emissive: '#cfe4ef', emissiveIntensity: 0.75, roughness: 0.4, metalness: 0 }),
    frameGrey: std({ color: '#5c6165', roughness: 0.55, metalness: 0.5 }),
    bleacherBlue: std({ color: '#2e5f9e', roughness: 0.5, metalness: 0.04 }),
    bleacherSteel: std({ color: '#7d838a', roughness: 0.4, metalness: 0.75 }),
    bannerYellow: std({ color: '#d9a92c', roughness: 0.88, metalness: 0 }),
    bannerNavy: std({ color: '#1d2c4e', roughness: 0.85, metalness: 0 }),
    acrylic: std({ color: '#dfe9ec', roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.38 }),
    boardWhite: std({ color: '#f2f3f0', roughness: 0.5, metalness: 0.05 }),
    rimOrange: std({ color: '#d8541e', roughness: 0.42, metalness: 0.55 }),
    netWhite: std({ color: '#e8e8e4', roughness: 0.8, metalness: 0 }),
    trussBlack: std({ color: '#17181a', roughness: 0.5, metalness: 0.6 }),
    padBlue: std({ color: '#2456a0', roughness: 0.62, metalness: 0.02 }),
    matBlue: std({ color: '#2b5ea6', roughness: 0.58, metalness: 0.02 }),
    matEdge: std({ color: '#7fa3cc', roughness: 0.6, metalness: 0.02 }),
    ballOrange: std({ color: '#c65a1e', roughness: 0.72, metalness: 0 }),
    rackSteel: std({ color: '#8b9096', roughness: 0.35, metalness: 0.85 }),
    chairPanel: std({ color: '#5b6b7d', roughness: 0.58, metalness: 0.08 }),
    steelBlack: std({ color: '#26282c', roughness: 0.34, metalness: 0.8 }),
    doorBlue: std({ color: '#2456a0', roughness: 0.5, metalness: 0.25 }),
    doorGlass: std({ color: '#2c3844', roughness: 0.18, metalness: 0.4 }),
    housing: std({ color: '#d8d9d6', roughness: 0.5, metalness: 0.35 }),
    panelGlow: std({ color: '#f4f8ff', emissive: '#eef4ff', emissiveIntensity: 1.6, roughness: 0.4, metalness: 0 }),
  };
  return ASSETS;
}

/** Local height helper: metres above the floor → world y. */
const Y = (h: number) => FLOOR_Y + h;
const WALL_H = 7.0;
const ROOM_X = 11;
const ROOM_Z = 7.5;

/* ------------------------------------------------------------------ */
/* fog + lights — the classic venue attaches a dark fog in Scene;    */
/* this bright gym fog replaces it while mounted and the previous    */
/* fog is restored on unmount (the BarbershopMirrorRoom pattern).    */
/* ------------------------------------------------------------------ */

function EnvFog() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const prev = scene.fog;
    scene.fog = new Fog('#dfe8ee', 16, 42);
    return () => { scene.fog = prev; };
  }, [scene]);
  return null;
}

/** A barely-there fluorescent shimmer on the fixture panels,
 *  fxOn only (fxOn off holds the panels dead steady). */
function FluoroShimmer({ a, fxOn }: { a: RecAssets; fxOn: boolean }) {
  useFrame(({ clock }) => {
    a.panelGlow.emissiveIntensity = fxOn
      ? 1.6 + Math.sin(clock.elapsedTime * 2.1) * 0.05
      : 1.6;
  });
  return null;
}

function GymLights({ fxOn }: { fxOn: boolean }) {
  return (
    <>
      <hemisphereLight args={['#ffffff', '#7d8894', 1.25]} />
      <directionalLight
        position={[4, 8, 3]}
        target-position={[0, -0.6, -0.5]}
        color="#f4f7ff"
        intensity={0.85}
        castShadow={fxOn}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-9} shadow-camera-right={9}
        shadow-camera-top={9} shadow-camera-bottom={-9}
        shadow-bias={-0.0004}
      />
      {/* flat fluorescent pool over the table */}
      <pointLight position={[0, Y(4.6), 0]} intensity={14} distance={16} decay={2} color="#eef3ff" />
      {/* even fills toward both court ends so the hoops read */}
      <pointLight position={[-7.5, Y(3.4), 0]} intensity={7} distance={11} decay={2} color="#e8efff" />
      <pointLight position={[7.5, Y(3.4), 0]} intensity={7} distance={11} decay={2} color="#e8efff" />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* the four seats — the folding chair at owner scale (H 0.90, seat    */
/* ~0.49) with BLUE-GREY moulded panels, at the shared anchors       */
/* imported from classicStudioLayout (CHAIR_SPOTS).                  */
/* ------------------------------------------------------------------ */

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

function FoldingChairs({ a }: { a: RecAssets }) {
  const geos = useMemo(foldingChairGeo, []);
  return (
    <group>
      {CHAIR_SPOTS.map((s, i) => (
        <group key={i} position={[s.x, FLOOR_Y, s.z]} rotation={[0, s.ry, 0]}>
          <mesh geometry={geos.seat} material={a.chairPanel} castShadow receiveShadow />
          <mesh geometry={geos.back} material={a.chairPanel} castShadow receiveShadow />
          <mesh geometry={geos.legs} material={a.steelBlack} castShadow />
          <mesh geometry={geos.backLegs} material={a.steelBlack} castShadow />
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the shell: court floor, blue-over-grey block walls, clerestory    */
/* band high on every wall, single-sided gym-high ceiling            */
/* ------------------------------------------------------------------ */

function ClerestoryWindow({ position, ry, wide = 1.9, a }: {
  position: [number, number, number]; ry: number; wide?: number; a: RecAssets;
}) {
  const parts = useMemo(() => merged([
    box(wide + 0.1, 1.4, 0.06, 0, 0, 0),
    box(0.05, 1.3, 0.02, 0, 0, 0.04),
    box(wide - 0.1, 0.05, 0.02, 0, 0, 0.04),
  ]), [wide]);
  return (
    <group position={position} rotation={[0, ry, 0]}>
      <mesh geometry={parts} material={a.frameGrey} castShadow receiveShadow />
      <mesh material={a.clerestory} position={[0, 0, 0.032]}>
        <planeGeometry args={[wide, 1.3]} />
      </mesh>
    </group>
  );
}

function Shell({ a }: { a: RecAssets }) {
  const walls = useMemo(() => ({
    lowerLong: merged([box(22.3, 2.7, 0.15, 0, 1.35, 0)]),
    upperLong: merged([box(22.3, WALL_H - 2.7, 0.15, 0, 2.7 + (WALL_H - 2.7) / 2, 0)]),
    lowerSide: merged([box(15.3, 2.7, 0.15, 0, 1.35, 0)]),
    upperSide: merged([box(15.3, WALL_H - 2.7, 0.15, 0, 2.7 + (WALL_H - 2.7) / 2, 0)]),
  }), []);
  return (
    <group>
      {/* polished maple court, 22 × 15, lines painted in the texture */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} material={a.court} receiveShadow>
        <planeGeometry args={[22, 15]} />
      </mesh>
      {/* far (north) wall — bleachers + banner stand against it */}
      <mesh geometry={walls.lowerLong} material={a.wallGrey} position={[0, FLOOR_Y, -ROOM_Z - 0.075]} receiveShadow castShadow />
      <mesh geometry={walls.upperLong} material={a.wallBlue} position={[0, FLOOR_Y, -ROOM_Z - 0.075]} receiveShadow castShadow />
      {/* south wall — the padding run stands against it */}
      <mesh geometry={walls.lowerLong} material={a.wallGrey} position={[0, FLOOR_Y, ROOM_Z + 0.075]} receiveShadow castShadow />
      <mesh geometry={walls.upperLong} material={a.wallBlue} position={[0, FLOOR_Y, ROOM_Z + 0.075]} receiveShadow castShadow />
      {/* west + east walls */}
      <mesh geometry={walls.lowerSide} material={a.wallGrey} position={[-ROOM_X - 0.075, FLOOR_Y, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow castShadow />
      <mesh geometry={walls.upperSide} material={a.wallBlue} position={[-ROOM_X - 0.075, FLOOR_Y, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow castShadow />
      <mesh geometry={walls.lowerSide} material={a.wallGrey} position={[ROOM_X + 0.075, FLOOR_Y, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow castShadow />
      <mesh geometry={walls.upperSide} material={a.wallBlue} position={[ROOM_X + 0.075, FLOOR_Y, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow castShadow />
      {/* the gym-high ceiling: SINGLE-SIDED, facing DOWN only (the
          material default side; the plane is rotated so its one
          face points at the floor) — the standing camera above
          floor+7.00 sees through it. No beams over the table. */}
      <mesh material={a.ceiling} rotation={[Math.PI / 2, 0, 0]} position={[0, Y(WALL_H), 0]} receiveShadow>
        <planeGeometry args={[22, 15]} />
      </mesh>
      {/* clerestory band, sill at h 5.05, head at 6.35 */}
      {[-8.75, -6.25, -3.75, -1.25, 1.25, 3.75, 6.25, 8.75].map((x) => (
        <ClerestoryWindow key={`n-${x}`} position={[x, Y(5.7), -ROOM_Z + 0.015]} ry={0} wide={2.3} a={a} />
      ))}
      {[-8.75, -6.25, -3.75, -1.25, 1.25, 3.75, 6.25, 8.75].map((x) => (
        <ClerestoryWindow key={`s-${x}`} position={[x, Y(5.7), ROOM_Z - 0.015]} ry={Math.PI} wide={2.3} a={a} />
      ))}
      {[-5.4, -1.8, 1.8, 5.4].map((z) => (
        <ClerestoryWindow key={`w-${z}`} position={[-ROOM_X + 0.015, Y(5.7), z]} ry={Math.PI / 2} wide={2.6} a={a} />
      ))}
      {[-5.4, -1.8, 1.8, 5.4].map((z) => (
        <ClerestoryWindow key={`e-${z}`} position={[ROOM_X - 0.015, Y(5.7), z]} ry={-Math.PI / 2} wide={2.6} a={a} />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* fluorescent fixtures ×6 — two runs at z = ±3.4 (AROUND the        */
/* table, never over it), three housings per run at h 6.82           */
/* ------------------------------------------------------------------ */

function FluoroFixtures({ a }: { a: RecAssets }) {
  const housing = useMemo(() => merged([box(3.4, 0.07, 0.32, 0, 0, 0)]), []);
  return (
    <group>
      {([-3.4, 3.4] as const).flatMap((z) =>
        ([-6.2, 0, 6.2] as const).map((x) => (
          <group key={`${x}-${z}`} position={[x, Y(6.82), z]}>
            <mesh geometry={housing} material={a.housing} castShadow />
            <mesh material={a.panelGlow} position={[0, -0.045, 0]}>
              <boxGeometry args={[3.3, 0.015, 0.24]} />
            </mesh>
          </group>
        )),
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* REC-02 — the bleacher bank: 7.0 × 1.6, H 1.50, 4 rows of          */
/* moulded blue seats, grey steel frame, centre stair. Front face    */
/* z=−5.90 (bank spans z −7.5 … −5.9 against the far wall).          */
/* ------------------------------------------------------------------ */

function Bleachers({ a }: { a: RecAssets }) {
  const { blue, steel } = useMemo(() => {
    const blueParts: G[] = [], steelParts: G[] = [];
    for (let row = 0; row < 4; row++) {
      const seatY = 0.42 + row * 0.30;
      const rowZ = 0.58 - row * 0.40;
      steelParts.push(box(7.0, 0.04, 0.34, 0, seatY - 0.16, rowZ + 0.06));
      steelParts.push(box(7.0, 0.26, 0.04, 0, seatY - 0.28, rowZ - 0.16));
      for (let sx = -3.25; sx <= 3.25; sx += 0.5) {
        if (Math.abs(sx) < 0.55) continue; // the centre stair gap
        blueParts.push(box(0.44, 0.05, 0.36, sx, seatY, rowZ));
        blueParts.push(box(0.44, 0.26, 0.045, sx, seatY + 0.16, rowZ - 0.185, -0.10));
      }
      steelParts.push(box(0.9, 0.05, 0.38, 0, seatY - 0.145, rowZ + 0.05));
    }
    for (const lx of [-3.4, -1.15, 1.15, 3.4]) {
      steelParts.push(box(0.07, 1.32, 0.07, lx, 0.66, -0.62));
      steelParts.push(box(0.07, 0.30, 0.07, lx, 0.15, 0.68));
    }
    steelParts.push(box(7.0, 0.07, 0.07, 0, 1.46, -0.68));
    steelParts.push(box(0.07, 0.07, 1.5, -3.46, 1.46, 0));
    steelParts.push(box(0.07, 0.07, 1.5, 3.46, 1.46, 0));
    steelParts.push(tube([-0.48, 0.55, 0.75], [-0.48, 1.55, -0.62], 0.02));
    steelParts.push(tube([0.48, 0.55, 0.75], [0.48, 1.55, -0.62], 0.02));
    return { blue: merged(blueParts), steel: merged(steelParts) };
  }, []);
  return (
    <group position={[0, FLOOR_Y, -6.7]}>
      <mesh geometry={blue} material={a.bleacherBlue} castShadow receiveShadow />
      <mesh geometry={steel} material={a.bleacherSteel} castShadow receiveShadow />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* REC-03 — the banner: plain mustard-yellow fabric 1.20 × 1.80,     */
/* navy border, top at h 5.20 on the far wall. BLANK face.           */
/* ------------------------------------------------------------------ */

function Banner({ a }: { a: RecAssets }) {
  const parts = useMemo(() => merged([
    box(1.24, 0.06, 0.05, 0, 0.93, 0),
    cyl(0.016, 0.016, 0.5, -0.45, 1.2, 0, 8),
    cyl(0.016, 0.016, 0.5, 0.45, 1.2, 0, 8),
  ]), []);
  return (
    <group position={[0, Y(4.3), -ROOM_Z + 0.13]}>
      <mesh material={a.bannerYellow} position={[0, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 1.8, 0.03]} />
      </mesh>
      <mesh material={a.bannerNavy} position={[0, 0.84, 0.02]}><boxGeometry args={[1.2, 0.09, 0.012]} /></mesh>
      <mesh material={a.bannerNavy} position={[0, -0.84, 0.02]}><boxGeometry args={[1.2, 0.09, 0.012]} /></mesh>
      <mesh material={a.bannerNavy} position={[-0.555, 0, 0.02]}><boxGeometry args={[0.09, 1.8, 0.012]} /></mesh>
      <mesh material={a.bannerNavy} position={[0.555, 0, 0.02]}><boxGeometry args={[0.09, 1.8, 0.012]} /></mesh>
      <mesh geometry={parts} material={a.trussBlack} castShadow />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* REC-01 — hoop assembly at ONE court end. Local: +z faces the      */
/* court centre, board face at z=0, board 1.80 × 1.05 centred at     */
/* h 3.45, rim Ø 0.45 at h 3.05 (centre 0.38 in front of the         */
/* board), white net, black truss tubes up to the ceiling.           */
/* Placed at x=±9.30 — ~9 m from the table, never overhanging it.    */
/* ------------------------------------------------------------------ */

function HoopAssembly({ side, a }: { side: 1 | -1; a: RecAssets }) {
  const { frame, net } = useMemo(() => {
    const frameParts: G[] = [];
    frameParts.push(box(1.84, 0.06, 0.03, 0, 3.45 + 0.525, 0.012));
    frameParts.push(box(1.84, 0.06, 0.03, 0, 3.45 - 0.525, 0.012));
    frameParts.push(box(0.06, 1.11, 0.03, -0.90, 3.45, 0.012));
    frameParts.push(box(0.06, 1.11, 0.03, 0.90, 3.45, 0.012));
    frameParts.push(box(0.59, 0.045, 0.02, 0, 3.45 - 0.15, 0.016));
    frameParts.push(box(0.59, 0.045, 0.02, 0, 3.45 + 0.30, 0.016));
    frameParts.push(box(0.045, 0.49, 0.02, -0.272, 3.45 + 0.075, 0.016));
    frameParts.push(box(0.045, 0.49, 0.02, 0.272, 3.45 + 0.075, 0.016));
    const netParts: G[] = [];
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2;
      const top: [number, number, number] = [Math.cos(a0) * 0.21, 3.03, 0.38 + Math.sin(a0) * 0.21];
      const bot: [number, number, number] = [Math.cos(a1) * 0.14, 2.66, 0.38 + Math.sin(a1) * 0.14];
      netParts.push(tube(top, bot, 0.006));
      netParts.push(tube(bot, [Math.cos(a1 + 0.5) * 0.15, 2.84, 0.38 + Math.sin(a1 + 0.5) * 0.15], 0.005));
    }
    return { frame: merged(frameParts), net: merged(netParts) };
  }, []);
  const truss = useMemo(() => merged([
    tube([0, 3.85, -0.06], [0, 6.95, -1.15], 0.045),
    tube([-0.7, 3.95, -0.06], [0, 6.6, -1.05], 0.032),
    tube([0.7, 3.95, -0.06], [0, 6.6, -1.05], 0.032),
    tube([0, 6.95, -1.15], [0, 6.95, 0.35], 0.045),
    box(0.5, 0.35, 0.10, 0, 3.55, -0.10),
    box(0.16, 0.09, 0.34, 0, 3.02, 0.20),
  ]), []);
  return (
    <group position={[side * 9.3, FLOOR_Y, 0]} rotation={[0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}>
      {/* clear acrylic board */}
      <mesh material={a.acrylic} position={[0, 3.45, 0]} castShadow>
        <boxGeometry args={[1.8, 1.05, 0.04]} />
      </mesh>
      <mesh geometry={frame} material={a.boardWhite} castShadow />
      {/* orange rim Ø 0.45 at h 3.05 */}
      <mesh material={a.rimOrange} position={[0, 3.05, 0.38]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.225, 0.02, 10, 28]} />
      </mesh>
      <mesh geometry={net} material={a.netWhite} />
      <mesh geometry={truss} material={a.trussBlack} castShadow />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* REC-04 — wall padding run: 6 blue vinyl panels H 2.00 on the      */
/* SOUTH wall (front face z=+7.39 — the player seat's datum)         */
/* ------------------------------------------------------------------ */

function WallPadding({ a }: { a: RecAssets }) {
  const geo = useMemo(() => {
    const parts: G[] = [];
    for (let i = 0; i < 6; i++) {
      const x = -2.5 + i * 1.0;
      parts.push(box(0.96, 2.0, 0.10, x, 1.0, 0));
      parts.push(box(0.96, 0.035, 0.012, x, 1.45, 0.052));
    }
    return merged(parts);
  }, []);
  return <mesh geometry={geo} material={a.padBlue} position={[0, FLOOR_Y, ROOM_Z - 0.06]} receiveShadow castShadow />;
}

/* ------------------------------------------------------------------ */
/* REC-05 — gym mat stack: 5 blue vinyl mats 1.80 × 1.00, stack      */
/* H 0.60, against the west wall at z=+3.6                           */
/* ------------------------------------------------------------------ */

function MatStack({ a }: { a: RecAssets }) {
  return (
    <group position={[-ROOM_X + 0.62, FLOOR_Y, 3.6]} rotation={[0, Math.PI / 2, 0]}>
      {[0, 1, 2, 3, 4].map((i) => (
        <group key={i} position={[(i % 2 === 0 ? -1 : 1) * 0.012 * i, 0.06 + i * 0.12, (i % 2 === 0 ? 1 : -1) * 0.008 * i]} rotation={[0, (i - 2) * 0.012, 0]}>
          <mesh material={a.matBlue} castShadow receiveShadow>
            <boxGeometry args={[1.8, 0.115, 1.0]} />
          </mesh>
          <mesh material={a.matEdge} position={[0, 0.045, 0]}>
            <boxGeometry args={[1.82, 0.02, 1.02]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* REC-06 — basketball rack with balls, east wall at z=+2.8          */
/* ------------------------------------------------------------------ */

function BallRack({ a }: { a: RecAssets }) {
  const frame = useMemo(() => {
    const parts: G[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      parts.push(tube([0.26 * sx, 0.03, 0.48 * sz], [0.26 * sx, 0.95, 0.48 * sz], 0.014));
    }
    for (const hy of [0.10, 0.52, 0.93]) {
      parts.push(box(0.55, 0.025, 0.99, 0, hy, 0));
    }
    for (let i = -2; i <= 2; i++) {
      parts.push(tube([i * 0.11, 0.10, 0.49], [i * 0.11, 0.93, 0.49], 0.005));
      parts.push(tube([i * 0.11, 0.10, -0.49], [i * 0.11, 0.93, -0.49], 0.005));
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      parts.push(cyl(0.045, 0.045, 0.03, 0.24 * sx, 0.015, 0.44 * sz, 10));
    }
    return merged(parts);
  }, []);
  const ballSpots: [number, number, number][] = [
    [0, 0.245, -0.33], [0, 0.245, 0.0], [0, 0.245, 0.33],
    [0, 0.665, -0.22], [0, 0.665, 0.18],
  ];
  return (
    <group position={[ROOM_X - 0.45, FLOOR_Y, 2.8]}>
      <mesh geometry={frame} material={a.rackSteel} castShadow receiveShadow />
      {ballSpots.map(([x, y, z], i) => (
        <mesh key={i} material={a.ballOrange} position={[x, y, z]} castShadow receiveShadow>
          <sphereGeometry args={[0.12, 18, 14]} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* REC-07 — stacked folding chairs: 6 blue-grey folded chairs as     */
/* thin leaning panels against the east wall at z=−2.8               */
/* ------------------------------------------------------------------ */

function FoldingChairStack({ a }: { a: RecAssets }) {
  const geo = useMemo(() => {
    const parts: G[] = [];
    for (let i = 0; i < 6; i++) {
      const lean = 0.17;
      const px = 10.78 - i * 0.05;
      const pz = -2.8 + (i % 2 === 0 ? -0.005 : 0.005);
      parts.push(box(0.07, 1.08, 0.50, px, 0.52, pz, 0, 0, -lean));
      parts.push(box(0.03, 0.98, 0.44, px - 0.033, 0.49, pz, 0, 0, -lean));
    }
    return merged(parts);
  }, []);
  return <mesh geometry={geo} material={a.chairPanel} position={[0, FLOOR_Y, 0]} castShadow receiveShadow />;
}

/* ------------------------------------------------------------------ */
/* REC-08 — blue double exit doors on the WEST wall at z=−3.5:       */
/* push bars, small wired-glass windows. NO signs.                   */
/* ------------------------------------------------------------------ */

function ExitDoors({ a }: { a: RecAssets }) {
  return (
    <group position={[-ROOM_X + 0.02, FLOOR_Y, -3.5]} rotation={[0, Math.PI / 2, 0]}>
      <mesh material={a.frameGrey} position={[0, 1.08, 0]}>
        <boxGeometry args={[1.94, 2.2, 0.06]} />
      </mesh>
      {[-0.46, 0.46].map((x) => (
        <group key={x} position={[x, 0, 0.045]}>
          <mesh material={a.doorBlue} position={[0, 1.05, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.88, 2.08, 0.055]} />
          </mesh>
          <mesh material={a.doorGlass} position={[0, 1.58, 0.033]}>
            <boxGeometry args={[0.26, 0.38, 0.012]} />
          </mesh>
          <mesh material={a.frameGrey} position={[0, 1.58, 0.042]}>
            <boxGeometry args={[0.28, 0.03, 0.006]} />
          </mesh>
          <mesh material={a.rackSteel} position={[0, 1.0, 0.055]} castShadow>
            <boxGeometry args={[0.7, 0.05, 0.045]} />
          </mesh>
          <mesh material={a.rackSteel} position={[0, 0.16, 0.032]}>
            <boxGeometry args={[0.78, 0.28, 0.01]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */

export default function RecCenterGymRoom({ fxOn }: { fxOn: boolean }) {
  const a = assets();
  return (
    <group>
      <EnvFog />
      <GymLights fxOn={fxOn} />
      <FluoroShimmer a={a} fxOn={fxOn} />
      <FoldingChairs a={a} />
      <Shell a={a} />
      <FluoroFixtures a={a} />
      <Bleachers a={a} />
      <Banner a={a} />
      <HoopAssembly side={-1} a={a} />
      <HoopAssembly side={1} a={a} />
      <WallPadding a={a} />
      <MatStack a={a} />
      <BallRack a={a} />
      <FoldingChairStack a={a} />
      <ExitDoors a={a} />
      {/* NO table here — the shared game table is the anchor. */}
    </group>
  );
}
