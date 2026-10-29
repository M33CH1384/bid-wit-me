import { useEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry, CanvasTexture, ColorManagement, CylinderGeometry,
  MeshStandardMaterial, Quaternion, RepeatWrapping, SphereGeometry, SRGBColorSpace,
  Vector3, type Group,
} from 'three';
import { useFrame } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The shared table's floor plane (sibling rooms keep their own). */
const FLOOR_Y = -0.9;

/**
 * GRANDMA'S KITCHEN — the grandma venue's own 3D room for
 * REGULAR tables (venues rollout Batch C1, 2026-10-28: "Now
 * all the other venues need to be updated the same way").
 *
 * Mounted by Scene for every NON-STORY grandma table at High
 * quality. The story branch keeps priority: a table carrying
 * stop `porch` mounts the Porch deck (PorchDeckRoom) exactly
 * as before — the porch is a different place, outside. Low
 * quality everywhere keeps the shipped cube-config GrandmaRoom
 * (grandmaLayout), untouched.
 *
 * The room: a warm home kitchen in miniature — 8.8 × 8.8 m of
 * cream wall over sage wainscot, a speckled linoleum checker
 * floor, the kitchen run along the far wall (base cabinets,
 * a four-burner stove with its kettle, a sink under the
 * windows, a pie and a fruit bowl on the counter), wall
 * cabinets with a row of hanging pans on the east wall, the
 * tall cream fridge at the run's west end, a plate hutch on
 * the east wall, and a tick-mark clock over the windows. The
 * identity carries over from the cube dress (VENUES.md +
 * the diner-read design fix: a TALL counter run, protruding
 * wall cabinets, the full 2 m fridge, windows ×2 above the
 * cabinets with red curtains — here gingham — so the far
 * edge reads as a home kitchen, not a diner counter; felt
 * #9e1b24). Daylight through the windows; no ceiling fixture
 * over the table.
 *
 * Route: ALL CODE, zero downloads — every item is box /
 * cylinder / tube work, every texture a seeded canvas.
 *
 * COPLANAR FLOOR (the Rec lesson, 2026-10-28): this room's
 * linoleum sits at FLOOR_Y, the depth every bespoke room
 * owns. Nothing else renders an opaque surface at that depth
 * at this venue: TableModel's 30×30 ground plane is classic-
 * only (Scene.tsx: `def.id === 'classic' && !roomFloor`),
 * and the cube shell — whose floor rides +0.005 over the
 * same depth — never mounts on this branch (same Scene
 * ternary). No two opaque surfaces share a depth in any
 * frame this room renders.
 *
 * Standing-camera discipline: the ceiling is a SINGLE-SIDED
 * plane at floor + 2.95 facing DOWN only — the standing
 * camera above sees through it. Nothing hangs over the
 * table; the daylight is light + emissive glass only.
 *
 * HARD EXCLUSIONS: no text / lettering anywhere (the fridge
 * magnets are plain coloured discs, the clock carries tick
 * marks only — no numerals), no people dressing (the
 * character phase owns figures).
 *
 * Seat back-clearances (kit chair back = CHAIR_SPOTS origin +
 * ~0.25 m): far seat back z=-2.23 → countertop front -3.64 =
 * 1.41 m; player back z=+2.23 → south wall 4.4 = 2.17 m;
 * west back x=-2.39 → west wall 4.4 = 2.01 m (the fridge
 * stands in the far-west corner, z -4.25..-3.45, north of
 * the west seat's centreline); east back x=+2.39 → hutch
 * front 3.99 = 1.60 m. All ≥ 0.6 m.
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
      ? `rgba(255,250,232,${(alpha * rnd()).toFixed(3)})`
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

type G = BoxGeometry | CylinderGeometry | SphereGeometry;
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

/** Linoleum checker: cream + soft-brown squares (canvas tile =
 *  2.2 m at [4,4] over the 8.8 m floor → ~0.55 m checks),
 *  speckled and faintly marbled like real lino. */
function makeLinoleumTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(61055);
    const t = 128;
    for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
      const cream = (tx + ty) % 2 === 0;
      const j = (rnd() - 0.5) * 12;
      ctx.fillStyle = cream
        ? `rgb(${Math.round(221 + j)},${Math.round(210 + j)},${Math.round(184 + j * 0.8)})`
        : `rgb(${Math.round(154 + j)},${Math.round(122 + j * 0.8)},${Math.round(86 + j * 0.6)})`;
      ctx.fillRect(tx * t, ty * t, t, t);
      // marble veining
      ctx.strokeStyle = cream ? 'rgba(150,128,92,0.16)' : 'rgba(70,50,30,0.18)';
      ctx.lineWidth = 1.4;
      for (let vLine = 0; vLine < 3; vLine++) {
        ctx.beginPath();
        const sx = tx * t + rnd() * t, sy = ty * t;
        ctx.moveTo(sx, sy);
        ctx.bezierCurveTo(sx + (rnd() - 0.5) * 30, sy + t * 0.33, sx + (rnd() - 0.5) * 30, sy + t * 0.66, sx + (rnd() - 0.5) * 16, sy + t);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(90,70,44,0.5)'; ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * t, 0); ctx.lineTo(i * t, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * t); ctx.lineTo(w, i * t); ctx.stroke();
    }
    speckle(ctx, w, h, 6000, rnd, 0.09, false);
    speckle(ctx, w, h, 2400, rnd, 0.05, true);
  }, [4, 4]);
}

/** Warm cream wall with the faintest vertical stripe. */
function makeWallTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const rnd = mulberry32(61212);
    ctx.fillStyle = '#e6d7b8'; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      ctx.fillStyle = 'rgba(190,164,116,0.13)';
      ctx.fillRect(x, 0, 5, h);
      ctx.fillStyle = 'rgba(255,252,240,0.10)';
      ctx.fillRect(x + 8, 0, 3, h);
    }
    speckle(ctx, w, h, 1100, rnd, 0.04, false);
    speckle(ctx, w, h, 500, rnd, 0.03, true);
  }, [6, 2]);
}

/** Red gingham for the curtains — plain checks, no print. */
function makeGinghamTexture() {
  return canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#f6efe2'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(176,48,48,0.55)';
    const t = 32;
    for (let i = 0; i < 4; i += 2) ctx.fillRect(i * t, 0, t, h);
    for (let i = 0; i < 4; i += 2) ctx.fillRect(0, i * t, w, t);
  }, [2, 3]);
}

/** Soft warm-white ceiling. */
function makeCeilingTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const rnd = mulberry32(61313);
    ctx.fillStyle = '#f4ead2'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 1300, rnd, 0.04, false);
    speckle(ctx, w, h, 700, rnd, 0.03, true);
  }, [3, 3]);
}

/* ------------------------------------------------------------------ */
/* cached assets                                                        */
/* ------------------------------------------------------------------ */

type KitchenAssets = {
  lino: MeshStandardMaterial; wall: MeshStandardMaterial; gingham: MeshStandardMaterial;
  ceiling: MeshStandardMaterial; sage: MeshStandardMaterial; cabinet: MeshStandardMaterial;
  cabinetDark: MeshStandardMaterial; counterTop: MeshStandardMaterial; backsplash: MeshStandardMaterial;
  creamEnamel: MeshStandardMaterial; chrome: MeshStandardMaterial; stoveBlack: MeshStandardMaterial;
  burner: MeshStandardMaterial; basinSteel: MeshStandardMaterial; plateWhite: MeshStandardMaterial;
  copper: MeshStandardMaterial; castIron: MeshStandardMaterial; terracotta: MeshStandardMaterial;
  herbGreen: MeshStandardMaterial; oakPanel: MeshStandardMaterial; steelFrame: MeshStandardMaterial;
  windowGlow: MeshStandardMaterial; stripGlow: MeshStandardMaterial; pieGold: MeshStandardMaterial;
  fruitRed: MeshStandardMaterial; fruitOrange: MeshStandardMaterial; bowlDark: MeshStandardMaterial;
  towelCream: MeshStandardMaterial; clockRim: MeshStandardMaterial; handBlack: MeshStandardMaterial;
  handRed: MeshStandardMaterial;
};

let ASSETS: KitchenAssets | null = null;
function assets(): KitchenAssets {
  if (ASSETS) return ASSETS;
  ColorManagement.enabled = true;
  ASSETS = {
    lino: std({ map: makeLinoleumTexture(), roughness: 0.46, metalness: 0.03 }),
    wall: std({ map: makeWallTexture(), roughness: 0.94, metalness: 0 }),
    gingham: std({ map: makeGinghamTexture(), roughness: 0.92, metalness: 0 }),
    ceiling: std({ map: makeCeilingTexture(), roughness: 0.96, metalness: 0 }),
    sage: std({ color: '#a8b09a', roughness: 0.85, metalness: 0 }),
    cabinet: std({ color: '#9a6a3c', roughness: 0.62, metalness: 0.02 }),
    cabinetDark: std({ color: '#7d5430', roughness: 0.68, metalness: 0.02 }),
    counterTop: std({ color: '#eadfc6', roughness: 0.34, metalness: 0.02 }),
    backsplash: std({ color: '#b8c8bc', roughness: 0.28, metalness: 0.03 }),
    creamEnamel: std({ color: '#e9e1cd', roughness: 0.32, metalness: 0.12 }),
    chrome: std({ color: '#c9ccd1', roughness: 0.24, metalness: 0.92 }),
    stoveBlack: std({ color: '#232326', roughness: 0.42, metalness: 0.35 }),
    burner: std({ color: '#101012', roughness: 0.6, metalness: 0.3 }),
    basinSteel: std({ color: '#9aa0a4', roughness: 0.35, metalness: 0.85 }),
    plateWhite: std({ color: '#f2efe8', roughness: 0.3, metalness: 0.02 }),
    copper: std({ color: '#b06a3a', roughness: 0.34, metalness: 0.85 }),
    castIron: std({ color: '#26262a', roughness: 0.52, metalness: 0.6 }),
    terracotta: std({ color: '#a85f38', roughness: 0.8, metalness: 0 }),
    herbGreen: std({ color: '#4a6a34', roughness: 0.9, metalness: 0 }),
    oakPanel: std({ color: '#9a6a3c', roughness: 0.6, metalness: 0.02 }),
    steelFrame: std({ color: '#3a3a3e', roughness: 0.4, metalness: 0.8 }),
    windowGlow: std({ color: '#fff6e0', emissive: '#ffedb8', emissiveIntensity: 0.9, roughness: 0.6, metalness: 0 }),
    stripGlow: std({ color: '#ffeec4', emissive: '#ffdf9e', emissiveIntensity: 1.1, roughness: 0.6, metalness: 0 }),
    pieGold: std({ color: '#c98a3a', roughness: 0.55, metalness: 0.05 }),
    fruitRed: std({ color: '#a02318', roughness: 0.35, metalness: 0.05 }),
    fruitOrange: std({ color: '#d07a24', roughness: 0.45, metalness: 0.02 }),
    bowlDark: std({ color: '#6d2f22', roughness: 0.5, metalness: 0.05 }),
    towelCream: std({ color: '#efe6ce', roughness: 0.95, metalness: 0 }),
    clockRim: std({ color: '#7d5430', roughness: 0.55, metalness: 0.05 }),
    handBlack: std({ color: '#1d1a16', roughness: 0.5, metalness: 0.2 }),
    handRed: std({ color: '#b03030', roughness: 0.5, metalness: 0.1 }),
  };
  return ASSETS;
}

/** Local height helper: metres above the floor → world y. */
const Y = (h: number) => FLOOR_Y + h;
const WALL_H = 2.95;

/* ------------------------------------------------------------------ */
/* lights — bright daylight: the window side carries the key, a    */
/* warm pool over the table, a soft fill from behind the player.   */
/* The window glow breathes almost imperceptibly when fxOn.        */
/* ------------------------------------------------------------------ */

function DaylightBreath({ a, fxOn }: { a: KitchenAssets; fxOn: boolean }) {
  useFrame(({ clock }) => {
    a.windowGlow.emissiveIntensity = fxOn
      ? 0.9 + Math.sin(clock.elapsedTime * 0.6) * 0.03
      : 0.9;
  });
  return null;
}

function KitchenLights({ fxOn }: { fxOn: boolean }) {
  return (
    <>
      <hemisphereLight args={['#fff8ec', '#8a7a5c', 0.9]} />
      <directionalLight
        position={[-2.5, 6, -2.5]}
        target-position={[0, -0.6, 0.5]}
        color="#fff2dc"
        intensity={0.65}
        castShadow={fxOn}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-6} shadow-camera-right={6}
        shadow-camera-top={6} shadow-camera-bottom={-6}
        shadow-bias={-0.0004}
      />
      {/* warm pool over the table */}
      <pointLight position={[0, Y(2.3), 0]} intensity={6} distance={8} decay={2} color="#ffe6b8" />
      {/* soft fill from behind the player so the far run reads */}
      <pointLight position={[0, Y(1.8), 3.2]} intensity={1.6} distance={7} decay={2} color="#fff4e0" />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* the four seats — the kit chair at owner scale, honey-oak        */
/* panels on a dark steel frame: kitchen chairs                    */
/* ------------------------------------------------------------------ */

const CHAIR_SPOTS: { pos: [number, number, number]; ry: number }[] = [
  { pos: [0, FLOOR_Y, 1.98], ry: Math.PI },
  { pos: [2.14, FLOOR_Y, 0], ry: -Math.PI / 2 },
  { pos: [0, FLOOR_Y, -1.98], ry: 0 },
  { pos: [-2.14, FLOOR_Y, 0], ry: Math.PI / 2 },
];

function kitchenChairGeo() {
  const seatParts: G[] = [], backParts: G[] = [], legParts: G[] = [], backLegParts: G[] = [];
  seatParts.push(box(0.42, 0.03, 0.40, 0, 0.485, 0.02));
  // a two-slat back, kitchen-style
  backParts.push(box(0.42, 0.09, 0.026, 0, 0.86, -0.20, -0.10));
  backParts.push(box(0.42, 0.09, 0.026, 0, 0.68, -0.183, -0.10));
  for (const sx of [-1, 1]) {
    const x = 0.20 * sx;
    legParts.push(tube([x, 0.02, 0.24], [x, 0.48, -0.10], 0.0135));
    backLegParts.push(tube([x, 0.02, -0.235], [x, 0.90, -0.225], 0.0135));
    legParts.push(box(0.026, 0.022, 0.36, x, 0.27, 0.005));
  }
  return {
    seat: merged(seatParts), back: merged(backParts),
    legs: merged(legParts), backLegs: merged(backLegParts),
  };
}

function KitchenChairs({ a }: { a: KitchenAssets }) {
  const geos = useMemo(kitchenChairGeo, []);
  return (
    <group>
      {CHAIR_SPOTS.map(({ pos, ry }, i) => (
        <group key={i} position={pos} rotation={[0, ry, 0]}>
          <mesh geometry={geos.seat} material={a.oakPanel} castShadow receiveShadow />
          <mesh geometry={geos.back} material={a.oakPanel} castShadow receiveShadow />
          <mesh geometry={geos.legs} material={a.steelFrame} castShadow />
          <mesh geometry={geos.backLegs} material={a.steelFrame} castShadow />
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the shell — cream walls over sage wainscot, the warm ceiling    */
/* ------------------------------------------------------------------ */

function Shell({ a }: { a: KitchenAssets }) {
  const wainscot = useMemo(() => merged([
    box(8.8, 1.02, 0.03, 0, 0.51, -4.385),
    box(8.8, 1.02, 0.03, 0, 0.51, 4.385),
    box(0.03, 1.02, 8.8, -4.385, 0.51, 0),
    box(0.03, 1.02, 8.8, 4.385, 0.51, 0),
    box(8.8, 0.04, 0.055, 0, 1.04, -4.375),
    box(8.8, 0.04, 0.055, 0, 1.04, 4.375),
    box(0.055, 0.04, 8.8, -4.375, 1.04, 0),
    box(0.055, 0.04, 8.8, 4.375, 1.04, 0),
  ]), []);
  return (
    <group>
      {/* speckled linoleum — THE floor at FLOOR_Y (see header) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} material={a.lino} receiveShadow>
        <planeGeometry args={[8.8, 8.8]} />
      </mesh>
      {/* far + south walls, inner faces at z=∓4.4 */}
      <mesh material={a.wall} position={[0, Y(WALL_H / 2), -4.475]} receiveShadow castShadow>
        <boxGeometry args={[9.1, WALL_H, 0.15]} />
      </mesh>
      <mesh material={a.wall} position={[0, Y(WALL_H / 2), 4.475]} receiveShadow castShadow>
        <boxGeometry args={[9.1, WALL_H, 0.15]} />
      </mesh>
      {/* west + east walls, inner faces at x=∓4.4 */}
      <mesh material={a.wall} position={[-4.475, Y(WALL_H / 2), 0]} receiveShadow castShadow>
        <boxGeometry args={[0.15, WALL_H, 8.8]} />
      </mesh>
      <mesh material={a.wall} position={[4.475, Y(WALL_H / 2), 0]} receiveShadow castShadow>
        <boxGeometry args={[0.15, WALL_H, 8.8]} />
      </mesh>
      {/* sage wainscot + chair rail */}
      <mesh geometry={wainscot} material={a.sage} position={[0, FLOOR_Y, 0]} receiveShadow />
      {/* the warm ceiling: SINGLE-SIDED, facing DOWN only — the
          standing camera above floor+2.95 sees through it. */}
      <mesh material={a.ceiling} rotation={[Math.PI / 2, 0, 0]} position={[0, Y(WALL_H), 0]} receiveShadow>
        <planeGeometry args={[8.8, 8.8]} />
      </mesh>
      {/* the plain south door, behind the player */}
      <group position={[1.6, FLOOR_Y, 4.39]}>
        <mesh material={a.cabinetDark} position={[0, 1.08, 0.01]}>
          <boxGeometry args={[1.03, 2.2, 0.05]} />
        </mesh>
        <mesh material={a.creamEnamel} position={[0, 1.06, -0.015]} castShadow receiveShadow>
          <boxGeometry args={[0.92, 2.08, 0.05]} />
        </mesh>
        <mesh material={a.chrome} position={[-0.34, 1.02, -0.05]}>
          <sphereGeometry args={[0.032, 10, 8]} />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the windows ×2 — far wall above the counter at x=±1.1, centre   */
/* h 2.2: daylight glass, muntin cross, gingham curtains +         */
/* valance, herb pots on the sill                                  */
/* ------------------------------------------------------------------ */

function KitchenWindow({ x, a }: { x: number; a: KitchenAssets }) {
  const frame = useMemo(() => merged([
    box(1.33, 0.06, 0.07, 0, 0.53, 0),
    box(1.33, 0.06, 0.07, 0, -0.53, 0),
    box(0.06, 1.12, 0.07, -0.635, 0, 0),
    box(0.06, 1.12, 0.07, 0.635, 0, 0),
    box(0.045, 1.0, 0.04, 0, 0, 0.01),
    box(1.25, 0.045, 0.04, 0, 0, 0.01),
    // the sill
    box(1.45, 0.05, 0.14, 0, -0.585, 0.03),
  ]), []);
  return (
    <group position={[x, Y(2.2), -4.40]}>
      {/* daylight glass */}
      <mesh material={a.windowGlow} position={[0, 0, -0.015]}>
        <planeGeometry args={[1.25, 1.0]} />
      </mesh>
      <mesh geometry={frame} material={a.plateWhite} position={[0, 0, 0.02]} castShadow receiveShadow />
      {/* gingham side curtains + valance */}
      {([-0.74, 0.74] as const).map((cx) => (
        <mesh key={cx} material={a.gingham} position={[cx, 0.02, 0.055]} castShadow>
          <boxGeometry args={[0.26, 1.18, 0.03]} />
        </mesh>
      ))}
      <mesh material={a.gingham} position={[0, 0.60, 0.055]} castShadow>
        <boxGeometry args={[1.72, 0.24, 0.03]} />
      </mesh>
      {/* the curtain rod */}
      <mesh material={a.chrome} position={[0, 0.74, 0.06]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.014, 0.014, 1.8, 8]} />
      </mesh>
      {/* two herb pots on the sill */}
      {([-0.38, 0.34] as const).map((px) => (
        <group key={px} position={[px, -0.545, 0.05]}>
          <mesh material={a.terracotta} castShadow>
            <cylinderGeometry args={[0.045, 0.034, 0.08, 10]} />
          </mesh>
          <mesh material={a.herbGreen} position={[0, 0.075, 0]} castShadow>
            <sphereGeometry args={[0.052, 8, 6]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the kitchen run — far wall: base cabinets (doors + knobs), the  */
/* countertop, the stove with its kettle + towel, the sink with    */
/* its faucet, the pie, the fruit bowl. Counter front at z=-3.72.  */
/* ------------------------------------------------------------------ */

function KitchenRun({ a }: { a: KitchenAssets }) {
  const carcass = useMemo(() => merged([
    box(5.2, 0.78, 0.65, 0, 0.47, 0),
    // toe kick, recessed and dark
    box(5.2, 0.10, 0.55, 0, 0.05, -0.04),
  ]), []);
  const doors = useMemo(() => {
    const parts: G[] = [];
    for (const dx of [-2.28, -1.38, 0.62, 1.52]) {
      parts.push(box(0.78, 0.58, 0.024, dx, 0.5, 0.335));
      parts.push(box(0.62, 0.42, 0.012, dx, 0.5, 0.35));
    }
    // drawer fronts over the door bays
    for (const dx of [-2.28, -1.38, 0.62, 1.52]) parts.push(box(0.78, 0.13, 0.024, dx, 0.795, 0.335));
    return merged(parts);
  }, []);
  const knobs = useMemo(() => {
    const parts: G[] = [];
    for (const dx of [-1.95, -1.05, 0.95, 1.85]) {
      const s = new SphereGeometry(0.021, 8, 6);
      s.translate(dx, 0.72, 0.36);
      parts.push(s);
    }
    return merged(parts);
  }, []);
  const faucet = useMemo(() => merged([
    tube([-0.95, 0.94, -4.18], [-0.95, 1.24, -4.18], 0.016),
    tube([-0.95, 1.24, -4.18], [-0.95, 1.26, -3.94], 0.014),
    tube([-0.95, 1.26, -3.94], [-0.95, 1.14, -3.94], 0.013),
    cyl(0.05, 0.055, 0.03, -0.95, 0.935, -4.18, 12),
  ]), []);
  return (
    <group position={[0, FLOOR_Y, 0]}>
      {/* backsplash band between counter and cabinets */}
      <mesh material={a.backsplash} position={[0, 1.22, -4.385]} receiveShadow>
        <boxGeometry args={[5.4, 0.52, 0.03]} />
      </mesh>
      {/* the cabinet carcass: front face at z=-3.72 */}
      <mesh geometry={carcass} material={a.cabinet} position={[0, 0, -4.045]} castShadow receiveShadow />
      <mesh geometry={doors} material={a.cabinetDark} position={[0, 0, -4.045]} castShadow receiveShadow />
      <mesh geometry={knobs} material={a.chrome} position={[0, 0, -4.045]} castShadow />
      {/* the countertop: top at h 0.92 */}
      <mesh material={a.counterTop} position={[0, 0.895, -4.02]} castShadow receiveShadow>
        <boxGeometry args={[5.4, 0.05, 0.76]} />
      </mesh>

      {/* the stove — east end of the run (x≈2.32): black cooktop,
          four burners, the oven front below with its towel */}
      <group position={[2.32, 0, -4.02]}>
        <mesh material={a.stoveBlack} position={[0, 0.925, 0]}>
          <boxGeometry args={[0.98, 0.015, 0.62]} />
        </mesh>
        {([[-0.24, -0.14, 0.105], [0.24, -0.14, 0.085], [-0.24, 0.15, 0.085], [0.24, 0.15, 0.105]] as const).map(([bx, bz, br], i) => (
          <mesh key={i} material={a.burner} position={[bx, 0.938, bz]}>
            <cylinderGeometry args={[br, br, 0.012, 16]} />
          </mesh>
        ))}
        {/* the oven front + handle */}
        <mesh material={a.stoveBlack} position={[0, 0.48, 0.335]} castShadow receiveShadow>
          <boxGeometry args={[0.9, 0.72, 0.024]} />
        </mesh>
        <mesh material={a.basinSteel} position={[0, 0.62, 0.352]}>
          <boxGeometry args={[0.7, 0.09, 0.012]} />
        </mesh>
        <mesh material={a.chrome} position={[0, 0.80, 0.375]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.016, 0.016, 0.8, 10]} />
        </mesh>
        {/* the towel on the oven handle */}
        <mesh material={a.towelCream} position={[-0.18, 0.665, 0.385]} castShadow>
          <boxGeometry args={[0.24, 0.30, 0.015]} />
        </mesh>
        {/* the kettle on the back-left burner */}
        <group position={[-0.24, 0.945, -0.14]}>
          <mesh material={a.castIron} castShadow>
            <cylinderGeometry args={[0.085, 0.10, 0.15, 14]} />
          </mesh>
          <mesh material={a.castIron} position={[0, 0.085, 0]}>
            <cylinderGeometry args={[0.03, 0.05, 0.03, 10]} />
          </mesh>
          <mesh material={a.castIron} position={[0.105, 0.05, 0]} rotation={[0, 0, -0.7]}>
            <cylinderGeometry args={[0.014, 0.02, 0.09, 8]} />
          </mesh>
        </group>
      </group>

      {/* the sink — under the west window (x≈-0.95) */}
      <group>
        <mesh material={a.basinSteel} position={[-0.95, 0.918, -4.02]}>
          <boxGeometry args={[0.84, 0.018, 0.52]} />
        </mesh>
        <mesh material={a.burner} position={[-0.95, 0.922, -4.02]}>
          <boxGeometry args={[0.72, 0.012, 0.42]} />
        </mesh>
        <mesh geometry={faucet} material={a.chrome} castShadow />
        {/* two plates standing in the drainer beside the sink */}
        {([-0.28, -0.19] as const).map((px) => (
          <mesh key={px} material={a.plateWhite} position={[px, 1.0, -4.1]} rotation={[0.22, 0, 0]} castShadow>
            <cylinderGeometry args={[0.105, 0.105, 0.014, 18]} />
          </mesh>
        ))}
      </group>

      {/* the pie, cooling mid-counter (x≈0.55) */}
      <group position={[0.55, 0.92, -3.95]}>
        <mesh material={a.basinSteel} castShadow>
          <cylinderGeometry args={[0.165, 0.13, 0.032, 18]} />
        </mesh>
        <mesh material={a.pieGold} position={[0, 0.026, 0]} castShadow>
          <cylinderGeometry args={[0.148, 0.148, 0.03, 18]} />
        </mesh>
        {([-0.07, 0, 0.07] as const).map((off) => (
          <mesh key={`a${off}`} material={a.pieGold} position={[off, 0.045, 0]} rotation={[0, Math.PI / 4, 0]}>
            <boxGeometry args={[0.026, 0.008, 0.26]} />
          </mesh>
        ))}
        {([-0.07, 0, 0.07] as const).map((off) => (
          <mesh key={`b${off}`} material={a.pieGold} position={[off, 0.045, 0]} rotation={[0, -Math.PI / 4, 0]}>
            <boxGeometry args={[0.026, 0.008, 0.26]} />
          </mesh>
        ))}
      </group>

      {/* the fruit bowl, west end of the counter (x≈-1.95) */}
      <group position={[-1.95, 0.92, -3.98]}>
        <mesh material={a.bowlDark} castShadow>
          <sphereGeometry args={[0.14, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
        </mesh>
        <mesh material={a.bowlDark} position={[0, 0.005, 0]}>
          <cylinderGeometry args={[0.145, 0.145, 0.012, 16]} />
        </mesh>
        {([[0, 0.075, 0, 'r'], [-0.075, 0.06, 0.03, 'o'], [0.07, 0.06, -0.03, 'r'], [0.01, 0.06, 0.08, 'o']] as const).map(([fx, fy, fz, kind], i) => (
          <mesh key={i} material={kind === 'r' ? a.fruitRed : a.fruitOrange} position={[fx, fy, fz]} castShadow>
            <sphereGeometry args={[0.044, 10, 8]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the wall cabinets ×2 — x=±2.15, h 1.62..2.92, fronts at         */
/* z=-4.0, with under-cabinet light strips                         */
/* ------------------------------------------------------------------ */

function WallCabinet({ x, a }: { x: number; a: KitchenAssets }) {
  const doors = useMemo(() => merged([
    box(0.66, 1.14, 0.024, -0.36, 0, 0.21),
    box(0.52, 1.0, 0.012, -0.36, 0, 0.225),
    box(0.66, 1.14, 0.024, 0.36, 0, 0.21),
    box(0.52, 1.0, 0.012, 0.36, 0, 0.225),
  ]), []);
  return (
    <group position={[x, Y(2.27), -4.2]}>
      <mesh material={a.cabinet} castShadow receiveShadow>
        <boxGeometry args={[1.5, 1.3, 0.4]} />
      </mesh>
      <mesh geometry={doors} material={a.cabinetDark} castShadow receiveShadow />
      {([-0.06, 0.06] as const).map((kx) => (
        <mesh key={kx} material={a.chrome} position={[kx, -0.42, 0.235]}>
          <sphereGeometry args={[0.02, 8, 6]} />
        </mesh>
      ))}
      {/* under-cabinet light strip */}
      <mesh material={a.stripGlow} position={[0, -0.66, 0.05]}>
        <boxGeometry args={[1.3, 0.018, 0.05]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the fridge — west end of the far wall: 2.0 m of cream enamel,   */
/* chrome handles, three plain coloured magnets (no letters)       */
/* ------------------------------------------------------------------ */

function Fridge({ a }: { a: KitchenAssets }) {
  return (
    <group position={[-3.35, FLOOR_Y, -3.85]}>
      <mesh material={a.creamEnamel} position={[0, 1.0, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.95, 2.0, 0.8]} />
      </mesh>
      {/* the freezer split line */}
      <mesh material={a.basinSteel} position={[0, 1.38, 0.405]}>
        <boxGeometry args={[0.95, 0.018, 0.006]} />
      </mesh>
      {/* chrome handles on the front's east edge */}
      <mesh material={a.chrome} position={[0.38, 1.62, 0.43]} castShadow>
        <cylinderGeometry args={[0.016, 0.016, 0.34, 8]} />
      </mesh>
      <mesh material={a.chrome} position={[0.38, 1.05, 0.43]} castShadow>
        <cylinderGeometry args={[0.016, 0.016, 0.44, 8]} />
      </mesh>
      {/* three plain magnets — coloured discs, no lettering */}
      {([[0.18, 1.72, '#b03030'], [-0.08, 1.60, '#d8a023'], [0.05, 1.80, '#3a6a9a']] as const).map(([mx, my, c], i) => (
        <mesh key={i} position={[mx, my, 0.404]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.021, 0.021, 0.008, 12]} />
          <meshStandardMaterial color={c} roughness={0.4} metalness={0.1} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the hutch — EAST wall: shelves of blank plates, cups, a teapot  */
/* ------------------------------------------------------------------ */

function Hutch({ a }: { a: KitchenAssets }) {
  const frame = useMemo(() => merged([
    box(0.06, 1.95, 0.38, -0.77, 0.975, 0),
    box(0.06, 1.95, 0.38, 0.77, 0.975, 0),
    box(1.6, 0.07, 0.38, 0, 1.915, 0),
    box(1.6, 0.05, 0.36, 0, 0.55, 0),
    box(1.6, 0.05, 0.36, 0, 1.12, 0),
    box(1.6, 0.06, 0.38, 0, 0.03, 0),
    // the back panel (wall side: local -z after the group's turn)
    box(1.6, 1.95, 0.03, 0, 0.975, -0.17),
  ]), []);
  return (
    <group position={[4.19, FLOOR_Y, -0.6]} rotation={[0, -Math.PI / 2, 0]}>
      <mesh geometry={frame} material={a.cabinet} castShadow receiveShadow />
      {/* standing plates on the top shelf */}
      {([-0.5, -0.18, 0.14] as const).map((px) => (
        <mesh key={px} material={a.plateWhite} position={[px, 1.245, -0.02]} rotation={[Math.PI / 2 - 0.16, 0, 0]} castShadow>
          <cylinderGeometry args={[0.105, 0.085, 0.016, 18]} />
        </mesh>
      ))}
      {/* cups on the top shelf */}
      {([0.42, 0.58] as const).map((px) => (
        <mesh key={px} material={a.plateWhite} position={[px, 1.185, 0]} castShadow>
          <cylinderGeometry args={[0.038, 0.03, 0.075, 12]} />
        </mesh>
      ))}
      {/* the teapot on the middle shelf */}
      <group position={[-0.35, 0.66, 0]}>
        <mesh material={a.copper} castShadow>
          <sphereGeometry args={[0.085, 14, 10]} />
        </mesh>
        <mesh material={a.copper} position={[0.095, 0.02, 0]} rotation={[0, 0, -0.8]}>
          <cylinderGeometry args={[0.012, 0.02, 0.07, 8]} />
        </mesh>
        <mesh material={a.copper} position={[0, 0.095, 0]}>
          <sphereGeometry args={[0.02, 8, 6]} />
        </mesh>
      </group>
      {/* stacked bowls on the bottom shelf */}
      {([0.088, 0.138] as const).map((hy, i) => (
        <mesh key={hy} material={a.plateWhite} position={[0.3, hy, 0]} castShadow>
          <cylinderGeometry args={[0.085 - i * 0.008, 0.05, 0.05, 14]} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the pan rail — EAST wall by the stove end: a chrome bar with    */
/* three hanging pans (copper, cast iron, copper)                  */
/* ------------------------------------------------------------------ */

function PanRail({ a }: { a: KitchenAssets }) {
  const pans: { z: number; r: number; mat: MeshStandardMaterial }[] = [
    { z: -2.95, r: 0.115, mat: a.copper },
    { z: -2.58, r: 0.135, mat: a.castIron },
    { z: -2.22, r: 0.10, mat: a.copper },
  ];
  return (
    <group position={[4.38, FLOOR_Y, 0]}>
      <mesh material={a.chrome} position={[0, 1.92, -2.58]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.014, 0.014, 1.15, 8]} />
      </mesh>
      {pans.map(({ z, r, mat }) => (
        <group key={z} position={[0, 0, z]}>
          {/* a hook arm reaching from the bar out over the room */}
          <mesh material={a.castIron} position={[-0.05, 1.905, 0]}>
            <boxGeometry args={[0.11, 0.014, 0.03]} />
          </mesh>
          {/* the handle dropping from the arm */}
          <mesh material={a.castIron} position={[-0.098, 1.79, 0]}>
            <boxGeometry args={[0.012, 0.22, 0.032]} />
          </mesh>
          {/* the pan: disc facing the room (−x) */}
          <mesh material={mat} position={[-0.098, 1.79 - r - 0.09, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[r, r * 0.82, 0.035, 18]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the clock — far wall centre above the windows: rim, tick        */
/* marks only (no numerals), hands at half past five; the red      */
/* second hand sweeps when fxOn, parked at twelve when not         */
/* ------------------------------------------------------------------ */

function KitchenClock({ a, fxOn }: { a: KitchenAssets; fxOn: boolean }) {
  const secondHand = useRef<Group>(null);
  const ticks = useMemo(() => {
    const parts: G[] = [];
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const long = i % 3 === 0;
      parts.push(box(0.014, long ? 0.045 : 0.028, 0.006, Math.sin(ang) * 0.175, Math.cos(ang) * 0.175, 0));
    }
    return merged(parts);
  }, []);
  useFrame(({ clock }) => {
    if (!secondHand.current) return;
    secondHand.current.rotation.z = fxOn ? -clock.elapsedTime * (Math.PI / 30) : 0;
  });
  return (
    <group position={[0, Y(2.62), -4.385]}>
      <mesh material={a.clockRim} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.235, 0.235, 0.035, 24]} />
      </mesh>
      <mesh material={a.plateWhite} position={[0, 0, 0.012]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.215, 0.215, 0.012, 24]} />
      </mesh>
      <mesh geometry={ticks} material={a.handBlack} position={[0, 0, 0.02]} />
      {/* hour hand → 5, minute hand → 6 (half past five, dinner time) */}
      <mesh material={a.handBlack} position={[Math.sin(5 * Math.PI / 6) * 0.05, Math.cos(5 * Math.PI / 6) * 0.05, 0.024]} rotation={[0, 0, -5 * Math.PI / 6]}>
        <boxGeometry args={[0.02, 0.105, 0.008]} />
      </mesh>
      <mesh material={a.handBlack} position={[0, -0.07, 0.024]} rotation={[0, 0, Math.PI]}>
        <boxGeometry args={[0.015, 0.15, 0.008]} />
      </mesh>
      <group ref={secondHand} position={[0, 0, 0.028]}>
        <mesh material={a.handRed} position={[0, 0.055, 0]}>
          <boxGeometry args={[0.006, 0.17, 0.004]} />
        </mesh>
      </group>
      <mesh material={a.handBlack} position={[0, 0, 0.03]}>
        <sphereGeometry args={[0.014, 8, 6]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */

export default function GrandmasKitchenRoom({ fxOn }: { fxOn: boolean }) {
  const a = assets();
  useEffect(() => {
    (window as unknown as { __bwmVenue?: unknown }).__bwmVenue = { id: 'grandma', fx: fxOn, studio: true, room: 'grandmas-kitchen', props: false };
  }, [fxOn]);
  return (
    <group>
      <KitchenLights fxOn={fxOn} />
      <DaylightBreath a={a} fxOn={fxOn} />
      <KitchenChairs a={a} />
      <Shell a={a} />
      <KitchenWindow x={-1.1} a={a} />
      <KitchenWindow x={1.1} a={a} />
      <KitchenRun a={a} />
      <WallCabinet x={-2.15} a={a} />
      <WallCabinet x={2.15} a={a} />
      <Fridge a={a} />
      <Hutch a={a} />
      <PanRail a={a} />
      <KitchenClock a={a} fxOn={fxOn} />
      {/* NO table here — the shared game table is the anchor. */}
    </group>
  );
}
