import { useEffect, useMemo } from 'react';
import {
  BoxGeometry, CanvasTexture, ColorManagement, ConeGeometry, CylinderGeometry,
  MeshStandardMaterial, Quaternion, RepeatWrapping, SphereGeometry, SRGBColorSpace,
  Vector3,
} from 'three';
import { useFrame } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { todLighting, type TodState } from './barbershopLayout';
import { useLocalTod } from './cubeVenue';

/** The shared table's floor plane (sibling rooms keep their own). */
const FLOOR_Y = -0.9;

/**
 * THE ROOFTOP SKYLINE — the rooftop venue's own 3D room for
 * REGULAR tables (venues rollout Batch C3, 2026-10-28: "Now
 * all the other venues need to be updated the same way").
 *
 * Mounted by Scene for every NON-STORY rooftop table at High
 * quality. The story branch keeps priority: a table carrying
 * stop `rooftop` mounts RooftopDuskRoom exactly as before —
 * that room is pinned to dusk, this one is not. Low quality
 * everywhere keeps the shipped cube-config RooftopRoom
 * (rooftopLayout), untouched.
 *
 * The room: the venue's own rooftop — a brushed-concrete deck
 * inside a low parapet, the stair bulkhead in the NW corner
 * with its door and lamp, a water tower on legs in the NE
 * corner, a vent stack west, string lights sagging between
 * corner poles, planters and a bench along the south parapet,
 * and a lit skyline standing beyond the far parapet. The
 * identity carries over from the cube dress (VENUES.md:
 * open-air, parapet in frame, skyline close and tall with lit
 * windows, vent W, water tank E; felt #14365e in the cube
 * dress's family).
 *
 * LOCAL-CLOCK TIME OF DAY (preserved from the cube room):
 * the cube RooftopRoom follows the player's local clock via
 * cubeVenue's useLocalTod — the TOD state locks at hand
 * start (never mid-hand) and todLighting scales the light.
 * This room carries the same behaviour: it reads the same
 * useLocalTod(handNo) lock and the same todLighting(tod)
 * table, and drives its sky gradient, sun/moon light,
 * skyline-window glow and string-light glow from them —
 * dawn / day / golden / night variants of the same roof.
 * RooftopDuskRoom's pinned dusk is untouched and never
 * reads this state, and this room never reads the story
 * room's: the two TODs cannot leak into each other because
 * the Scene seam mounts exactly one of them per table.
 *
 * Route: ALL CODE, zero downloads — every item is box /
 * cylinder / cone / tube work, every texture a seeded canvas.
 *
 * COPLANAR FLOOR (the Rec lesson, 2026-10-28): this room's
 * concrete deck sits at FLOOR_Y, the depth every bespoke
 * room owns. The skyline towers stand BEYOND the parapet on
 * their own ground far below (their boxes rise from
 * FLOOR_Y - 6, a different depth, and read as neighbouring
 * roofs, not floor). Nothing else renders at FLOOR_Y at
 * this venue: TableModel's 30×30 ground plane is
 * classic-only (Scene.tsx: `def.id === 'classic' &&
 * !roomFloor`), and the cube shell — whose floor rides
 * +0.005 over the same depth — never mounts on this branch
 * (same Scene ternary). The surfaces never share a frame,
 * let alone a depth.
 *
 * Standing-camera discipline: open-air — no ceiling at all.
 * The only overhead dressing is the string-light runs along
 * the deck's EDGES (x=±4.15 and z=-4.15, sagging to floor +
 * 2.32 at mid-span) and the water tower in the NE corner;
 * nothing crosses the sight cone over the felt.
 *
 * HARD EXCLUSIONS: no text / lettering anywhere (the
 * skyline windows are plain lit rectangles — pattern, not
 * signage; the bulkhead door is blank), no people dressing
 * (the character phase owns figures).
 *
 * Seat back-clearances (kit chair back = CHAIR_SPOTS origin +
 * ~0.25 m): far seat back z=-2.23 → parapet inner face
 * -4.42 = 2.19 m; player back z=+2.23 → the south bench's
 * front face 3.94 = 1.71 m (the parapet behind it is 2.19 m);
 * west back x=-2.39 → west parapet -4.42 = 2.03 m (the vent
 * at z=-2.3 and the bulkhead at z≤-2.75 stand north of the
 * west seat's centreline, never behind it); east back
 * x=+2.39 → east parapet 4.42 = 2.03 m (the water-tower legs
 * at z≤-2.7 are likewise off-axis). All ≥ 0.6 m.
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
      ? `rgba(255,244,220,${(alpha * rnd()).toFixed(3)})`
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

/** Brushed concrete: grey field, expansion joints, speckle. */
function makeConcreteTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(61011);
    ctx.fillStyle = '#83878f';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 5200, rnd, 0.10, false);
    speckle(ctx, w, h, 2400, rnd, 0.07, true);
    ctx.fillStyle = 'rgba(52,56,64,0.55)';
    ctx.fillRect(0, 0, w, 3); ctx.fillRect(0, 0, 3, h);
    ctx.fillRect(w / 2, 0, 2, h); ctx.fillRect(0, h / 2, w, 2);
    // weather streaks
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(60,64,72,${(0.04 + rnd() * 0.05).toFixed(3)})`;
      const x = rnd() * w;
      ctx.fillRect(x, rnd() * h * 0.4, 2 + rnd() * 5, 30 + rnd() * 90);
    }
  }, [3, 3]);
}

/** Sky dome gradient per TOD state: zenith → mid → horizon. */
const SKY_STOPS: Record<TodState, [string, string, string]> = {
  dawn: ['#5d6fa8', '#b08bb0', '#f6bd8a'],
  day: ['#5f97d6', '#8fb9e4', '#eef6fc'],
  golden: ['#565a9e', '#c97a6a', '#ffab5e'],
  night: ['#0a142e', '#1c2c52', '#3a4a74'],
};
function makeSkyTexture(tod: TodState) {
  const [top, mid, hor] = SKY_STOPS[tod];
  return canvasTex(64, 512, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, top);
    grad.addColorStop(0.5, mid);
    grad.addColorStop(0.8, hor);
    grad.addColorStop(1, hor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    if (tod === 'night') { // sparse stars in the upper dome
      const rnd = mulberry32(61099);
      for (let i = 0; i < 190; i++) {
        ctx.fillStyle = `rgba(255,255,255,${(0.25 + rnd() * 0.6).toFixed(2)})`;
        ctx.fillRect(rnd() * w, rnd() * h * 0.42, 1.3, 1.3);
      }
    }
  });
}

/** Shrub foliage: clustered leaf blobs in deep greens. */
function makeFoliageTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const rnd = mulberry32(61122);
    ctx.fillStyle = '#24401e';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      const g = 60 + Math.floor(rnd() * 70);
      ctx.fillStyle = `rgba(${Math.round(g * 0.55)},${g},${Math.round(g * 0.42)},${(0.35 + rnd() * 0.4).toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(rnd() * w, rnd() * h, 4 + rnd() * 9, 3 + rnd() * 6, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [2, 1]);
}

/* ------------------------------------------------------------------ */
/* cached assets                                                        */
/* ------------------------------------------------------------------ */

type RoofAssets = {
  concrete: MeshStandardMaterial; parapet: MeshStandardMaterial; cap: MeshStandardMaterial;
  bulkhead: MeshStandardMaterial; doorDark: MeshStandardMaterial; metal: MeshStandardMaterial;
  tankWood: MeshStandardMaterial; towerDark: MeshStandardMaterial; foliage: MeshStandardMaterial;
  planter: MeshStandardMaterial; slatWood: MeshStandardMaterial; frameDark: MeshStandardMaterial;
  bulbGlow: MeshStandardMaterial; lampGlow: MeshStandardMaterial;
  skyMats: Record<TodState, MeshStandardMaterial>;
  windowMats: Record<TodState, MeshStandardMaterial>;
};

let ASSETS: RoofAssets | null = null;
function assets(): RoofAssets {
  if (ASSETS) return ASSETS;
  ColorManagement.enabled = true;
  const skyMats = {} as Record<TodState, MeshStandardMaterial>;
  const windowMats = {} as Record<TodState, MeshStandardMaterial>;
  for (const tod of ['dawn', 'day', 'golden', 'night'] as TodState[]) {
    skyMats[tod] = std({ map: makeSkyTexture(tod), roughness: 1, metalness: 0, side: 2 /* BackSide */ });
    // lit windows: todLighting's lampEmissive drives how hard they burn
    windowMats[tod] = std({
      color: '#2a2418', emissive: '#ffd98a', emissiveIntensity: 0.35 + todLighting(tod).lampEmissive * 0.62,
      roughness: 0.6, metalness: 0.1,
    });
  }
  ASSETS = {
    concrete: std({ map: makeConcreteTexture(), roughness: 0.92, metalness: 0.02 }),
    parapet: std({ color: '#4a4f5c', roughness: 0.9, metalness: 0.02 }),
    cap: std({ color: '#5f6572', roughness: 0.8, metalness: 0.05 }),
    bulkhead: std({ color: '#565b47', roughness: 0.88, metalness: 0.02 }),
    doorDark: std({ color: '#23262c', roughness: 0.6, metalness: 0.4 }),
    metal: std({ color: '#7d838f', roughness: 0.45, metalness: 0.7 }),
    tankWood: std({ color: '#4c4238', roughness: 0.85, metalness: 0.02 }),
    towerDark: std({ color: '#27334f', roughness: 0.95, metalness: 0 }),
    foliage: std({ map: makeFoliageTexture(), roughness: 1, metalness: 0 }),
    planter: std({ color: '#3d3a34', roughness: 0.9, metalness: 0.02 }),
    slatWood: std({ color: '#8a6238', roughness: 0.62, metalness: 0.02 }),
    frameDark: std({ color: '#26262a', roughness: 0.5, metalness: 0.6 }),
    bulbGlow: std({ color: '#ffd9a0', emissive: '#ffb45c', emissiveIntensity: 1.2, roughness: 0.5, metalness: 0 }),
    lampGlow: std({ color: '#ffe2b0', emissive: '#ffc978', emissiveIntensity: 1.6, roughness: 0.5, metalness: 0 }),
    skyMats, windowMats,
  };
  return ASSETS;
}

/** Local height helper: metres above the deck → world y. */
const Y = (h: number) => FLOOR_Y + h;

/* ------------------------------------------------------------------ */
/* TOD light rig — the cube room's todLighting table, applied:  */
/* hemiK scales the sky fill, spotK the sun/moon key,           */
/* lampEmissive the warm pool over the felt (the string        */
/* lights' pool). Sun position/colour follow the state.        */
/* ------------------------------------------------------------------ */

const SUN: Record<TodState, { pos: [number, number, number]; color: string }> = {
  dawn: { pos: [7, 3.2, -2.5], color: '#ffb98a' },
  day: { pos: [5, 9, 3], color: '#fff1d6' },
  golden: { pos: [-7, 2.8, -2], color: '#ff9a50' },
  night: { pos: [-4, 7.5, -3], color: '#9db8ff' },
};

function RoofLights({ fxOn, tod }: { fxOn: boolean; tod: TodState }) {
  const light = todLighting(tod);
  const sun = SUN[tod];
  return (
    <>
      <hemisphereLight args={[tod === 'night' ? '#33477a' : '#cfe0f4', '#3c3a34', 0.66 * light.hemiK + 0.12]} />
      <directionalLight
        position={sun.pos}
        target-position={[0, -0.6, -0.5]}
        color={sun.color}
        intensity={1.18 * light.spotK}
        castShadow={fxOn}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8} shadow-camera-right={8}
        shadow-camera-top={8} shadow-camera-bottom={-8}
        shadow-bias={-0.0004}
      />
      {/* the string lights' warm pool over the felt */}
      <pointLight position={[0, Y(2.5), 0]} intensity={1.6 + light.lampEmissive * 1.5} distance={9} decay={2} color="#ffdcb0" />
      {/* the cube dress's magenta rim, kept as a low neon kiss SE */}
      <pointLight position={[3.4, Y(1.1), 3.2]} intensity={tod === 'day' ? 0.7 : 2.2} distance={6} decay={2} color="#ff4fd8" />
    </>
  );
}

/** fx life: the string bulbs breathe, scaled by the TOD lamp
 *  level so the day roof stays calm and the night roof glows. */
function RoofLife({ a, fxOn, tod }: { a: RoofAssets; fxOn: boolean; tod: TodState }) {
  useFrame(({ clock }) => {
    const base = 0.3 + todLighting(tod).lampEmissive * 0.5;
    a.bulbGlow.emissiveIntensity = fxOn ? base + Math.sin(clock.elapsedTime * 1.9) * 0.08 : base;
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* the four seats — the kit chair at owner scale, dressed as a   */
/* rooftop lounge chair: charcoal frame, warm wood slats         */
/* ------------------------------------------------------------------ */

const CHAIR_SPOTS: { pos: [number, number, number]; ry: number }[] = [
  { pos: [0, FLOOR_Y, 1.98], ry: Math.PI },
  { pos: [2.14, FLOOR_Y, 0], ry: -Math.PI / 2 },
  { pos: [0, FLOOR_Y, -1.98], ry: 0 },
  { pos: [-2.14, FLOOR_Y, 0], ry: Math.PI / 2 },
];

function roofChairGeo() {
  const frameParts: G[] = [], slatParts: G[] = [], legParts: G[] = [];
  frameParts.push(box(0.44, 0.04, 0.42, 0, 0.47, 0.01));
  for (const fz of [-0.14, 0, 0.14]) slatParts.push(box(0.40, 0.018, 0.09, 0, 0.50, 0.01 + fz));
  slatParts.push(box(0.42, 0.09, 0.028, 0, 0.94, -0.205, -0.10));
  slatParts.push(box(0.42, 0.07, 0.028, 0, 0.68, -0.18, -0.10));
  slatParts.push(box(0.42, 0.07, 0.028, 0, 0.80, -0.192, -0.10));
  for (const sx of [-1, 1]) {
    const x = 0.20 * sx;
    legParts.push(tube([x, 0.02, 0.24], [x, 0.47, -0.10], 0.015));
    legParts.push(tube([x, 0.02, -0.235], [x, 0.97, -0.225], 0.015));
    legParts.push(box(0.028, 0.022, 0.36, x, 0.27, 0.005));
  }
  return { frame: merged(frameParts), slats: merged(slatParts), legs: merged(legParts) };
}

function RoofChairs({ a }: { a: RoofAssets }) {
  const geos = useMemo(roofChairGeo, []);
  return (
    <group>
      {CHAIR_SPOTS.map(({ pos, ry }, i) => (
        <group key={i} position={pos} rotation={[0, ry, 0]}>
          <mesh geometry={geos.frame} material={a.frameDark} castShadow receiveShadow />
          <mesh geometry={geos.slats} material={a.slatWood} castShadow receiveShadow />
          <mesh geometry={geos.legs} material={a.frameDark} castShadow />
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the shell — TOD sky dome, the concrete deck, the parapet      */
/* ------------------------------------------------------------------ */

function Shell({ a, tod }: { a: RoofAssets; tod: TodState }) {
  const parapet = useMemo(() => merged([
    box(9.02, 1.02, 0.18, 0, 0.51, -4.51),
    box(9.02, 1.02, 0.18, 0, 0.51, 4.51),
    box(0.18, 1.02, 8.84, -4.51, 0.51, 0),
    box(0.18, 1.02, 8.84, 4.51, 0.51, 0),
  ]), []);
  const caps = useMemo(() => merged([
    box(9.14, 0.07, 0.27, 0, 1.055, -4.51),
    box(9.14, 0.07, 0.27, 0, 1.055, 4.51),
    box(0.27, 0.07, 8.95, -4.51, 1.055, 0),
    box(0.27, 0.07, 8.95, 4.51, 1.055, 0),
  ]), []);
  return (
    <group>
      {/* the sky dome — BackSide TOD gradient, horizon at deck level */}
      <mesh material={a.skyMats[tod]} position={[0, FLOOR_Y + 0.4, 0]}>
        <sphereGeometry args={[44, 24, 16]} />
      </mesh>
      {/* the concrete deck — THE floor at FLOOR_Y (see header) */}
      <mesh material={a.concrete} rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} receiveShadow>
        <planeGeometry args={[9.7, 9.7]} />
      </mesh>
      <mesh geometry={parapet} material={a.parapet} position={[0, FLOOR_Y, 0]} castShadow receiveShadow />
      <mesh geometry={caps} material={a.cap} position={[0, FLOOR_Y, 0]} castShadow receiveShadow />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the skyline — towers beyond the far parapet, standing on      */
/* their own roofs far below deck level, lit windows, antennas   */
/* ------------------------------------------------------------------ */

const TOWERS: { x: number; z: number; w: number; h: number; d: number }[] = [
  { x: -3.4, z: -5.9, w: 1.5, h: 11.2, d: 0.8 },
  { x: -1.7, z: -5.7, w: 1.1, h: 9.8, d: 0.8 },
  { x: -0.2, z: -6.0, w: 1.4, h: 12.5, d: 0.8 },
  { x: 1.3, z: -5.7, w: 1.0, h: 9.1, d: 0.8 },
  { x: 2.7, z: -5.9, w: 1.3, h: 10.7, d: 0.8 },
  { x: 4.1, z: -5.7, w: 0.9, h: 8.6, d: 0.8 },
  { x: -6.6, z: -2.6, w: 0.8, h: 10.4, d: 1.6 },
  { x: 6.6, z: -3.2, w: 0.8, h: 9.4, d: 1.4 },
];

function Skyline({ a, tod }: { a: RoofAssets; tod: TodState }) {
  const towers = useMemo(() => merged(TOWERS.map((t) => box(t.w, t.h, t.d, t.x, t.h / 2 - 6, t.z))), []);
  const windows = useMemo(() => {
    const rnd = mulberry32(61233);
    const parts: G[] = [];
    for (const t of TOWERS) {
      const front = t.z + (t.z < -5 ? t.d / 2 + 0.026 : 0);
      const side = t.x + (t.x < 0 ? t.w / 2 + 0.026 : -t.w / 2 - 0.026);
      const rows = Math.floor(t.h / 1.15);
      for (let r = 0; r < rows; r++) {
        const y = -4.6 + r * 1.15;
        if (y > t.h - 6.4) continue;
        if (rnd() < 0.42) continue; // dark windows stay unbuilt
        if (t.z < -5) parts.push(box(0.30, 0.22, 0.04, t.x + (rnd() - 0.5) * t.w * 0.5, y, front));
        else parts.push(box(0.04, 0.22, 0.30, side, y, t.z + (rnd() - 0.5) * t.d * 0.4));
      }
    }
    // antennas on the two tallest far towers
    parts.push(cyl(0.02, 0.02, 0.9, -0.2, 12.5 - 6 + 0.45, -6.0, 6));
    parts.push(cyl(0.02, 0.02, 0.8, 2.7, 10.7 - 6 + 0.4, -5.9, 6));
    return merged(parts);
  }, []);
  return (
    <group position={[0, FLOOR_Y, 0]}>
      <mesh geometry={towers} material={a.towerDark} />
      <mesh geometry={windows} material={a.windowMats[tod]} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* roof furniture — the bulkhead NW, the water tower NE, the     */
/* vent west, planters + bench south, string lights on the edges */
/* ------------------------------------------------------------------ */

function Bulkhead({ a }: { a: RoofAssets }) {
  return (
    <group position={[0, FLOOR_Y, 0]}>
      {/* the stair bulkhead: east face -2.70, south face -2.75 */}
      <mesh material={a.bulkhead} position={[-3.55, 1.15, -3.55]} castShadow receiveShadow>
        <boxGeometry args={[1.7, 2.3, 1.6]} />
      </mesh>
      <mesh material={a.cap} position={[-3.55, 2.36, -3.55]} castShadow>
        <boxGeometry args={[1.86, 0.12, 1.76]} />
      </mesh>
      {/* the blank bulkhead door on its south face + its lamp */}
      <mesh material={a.doorDark} position={[-3.55, 0.95, -2.735]} castShadow>
        <boxGeometry args={[0.84, 1.9, 0.05]} />
      </mesh>
      <mesh material={a.metal} position={[-3.22, 0.95, -2.70]}>
        <sphereGeometry args={[0.035, 8, 8]} />
      </mesh>
      <mesh material={a.lampGlow} position={[-3.55, 2.08, -2.71]}>
        <boxGeometry args={[0.16, 0.09, 0.05]} />
      </mesh>
      {/* a vent pipe + crate stack beside the bulkhead */}
      <mesh material={a.metal} position={[-2.95, 2.62, -3.9]} castShadow>
        <cylinderGeometry args={[0.09, 0.09, 0.55, 10]} />
      </mesh>
      <mesh material={a.slatWood} position={[-2.82, 0.26, -2.95]} castShadow receiveShadow>
        <boxGeometry args={[0.52, 0.52, 0.52]} />
      </mesh>
      <mesh material={a.slatWood} position={[-2.82, 0.74, -2.95]} rotation={[0, 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.44, 0.44, 0.44]} />
      </mesh>
    </group>
  );
}

function WaterTower({ a }: { a: RoofAssets }) {
  const legs = useMemo(() => merged([
    tube([2.88, 0, -3.42], [3.02, 1.55, -3.28], 0.045),
    tube([3.62, 0, -3.42], [3.48, 1.55, -3.28], 0.045),
    tube([2.88, 0, -2.78], [3.02, 1.55, -2.92], 0.045),
    tube([3.62, 0, -2.78], [3.48, 1.55, -2.92], 0.045),
    tube([2.88, 0.75, -3.42], [3.62, 0.75, -2.78], 0.025),
    tube([3.62, 0.75, -3.42], [2.88, 0.75, -2.78], 0.025),
    box(0.95, 0.07, 0.95, 3.25, 1.58, -3.1),
  ]), []);
  return (
    <group position={[0, FLOOR_Y, 0]}>
      <mesh geometry={legs} material={a.tankWood} castShadow />
      {/* the tank: stave cylinder + cone roof */}
      <mesh material={a.tankWood} position={[3.25, 2.16, -3.1]} castShadow receiveShadow>
        <cylinderGeometry args={[0.62, 0.68, 1.1, 14]} />
      </mesh>
      <mesh material={a.doorDark} position={[3.25, 2.78, -3.1]} castShadow>
        <coneGeometry args={[0.78, 0.5, 14]} />
      </mesh>
      <mesh material={a.metal} position={[3.25, 1.66, -3.1]}>
        <torusGeometry args={[0.665, 0.018, 6, 24]} />
      </mesh>
    </group>
  );
}

function VentAndPlanters({ a }: { a: RoofAssets }) {
  const shrubs = useMemo(() => merged([
    new SphereGeometry(0.34, 10, 8).translate(-3.72, 0.62, 3.58),
    new SphereGeometry(0.28, 10, 8).translate(-3.38, 0.56, 3.72),
    new SphereGeometry(0.34, 10, 8).translate(3.72, 0.62, 3.58),
    new SphereGeometry(0.28, 10, 8).translate(3.38, 0.56, 3.72),
  ]), []);
  return (
    <group position={[0, FLOOR_Y, 0]}>
      {/* the vent stack west, north of the west seat's centreline */}
      <mesh material={a.metal} position={[-3.05, 0.55, -2.3]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 1.1, 0.9]} />
      </mesh>
      <mesh material={a.metal} position={[-3.05, 1.32, -2.3]} castShadow>
        <cylinderGeometry args={[0.27, 0.33, 0.46, 12]} />
      </mesh>
      {/* planters in the south corners + the bench between them */}
      {([-3.55, 3.55] as const).map((x) => (
        <mesh key={x} material={a.planter} position={[x, 0.24, 3.62]} castShadow receiveShadow>
          <boxGeometry args={[1.15, 0.48, 0.62]} />
        </mesh>
      ))}
      <mesh geometry={shrubs} material={a.foliage} castShadow />
      {/* the south bench: front face z=3.94 */}
      <mesh material={a.slatWood} position={[0, 0.46, 4.17]} castShadow receiveShadow>
        <boxGeometry args={[2.6, 0.07, 0.46]} />
      </mesh>
      <mesh material={a.frameDark} position={[-1.1, 0.21, 4.17]} castShadow>
        <boxGeometry args={[0.07, 0.42, 0.4]} />
      </mesh>
      <mesh material={a.frameDark} position={[1.1, 0.21, 4.17]} castShadow>
        <boxGeometry args={[0.07, 0.42, 0.4]} />
      </mesh>
      <mesh material={a.slatWood} position={[0, 0.78, 4.36]} castShadow receiveShadow>
        <boxGeometry args={[2.6, 0.34, 0.06]} />
      </mesh>
    </group>
  );
}

function StringRun({ a, from, to }: { a: RoofAssets; from: [number, number]; to: [number, number] }) {
  const geos = useMemo(() => {
    const wire: G[] = [], bulbs: G[] = [];
    const [x0, z0] = from, [x1, z1] = to;
    const mid: [number, number, number] = [(x0 + x1) / 2, 2.42, (z0 + z1) / 2];
    wire.push(tube([x0, 2.72, z0], mid, 0.008));
    wire.push(tube(mid, [x1, 2.72, z1], 0.008));
    for (const f of [0.16, 0.32, 0.5, 0.68, 0.84]) {
      // the sag curve between the two half-spans
      const t = f < 0.5 ? f * 2 : (f - 0.5) * 2;
      const ax = f < 0.5 ? x0 : mid[0], az = f < 0.5 ? z0 : mid[2];
      const bx = f < 0.5 ? mid[0] : x1, bz = f < 0.5 ? mid[2] : z1;
      bulbs.push(new SphereGeometry(0.034, 8, 8).translate(ax + (bx - ax) * t, (f < 0.5 ? 2.72 + (2.42 - 2.72) * t : 2.42 + (2.72 - 2.42) * t) - 0.055, az + (bz - az) * t));
    }
    return { wire: merged(wire), bulbs: merged(bulbs) };
  }, [from, to]);
  return (
    <group position={[0, FLOOR_Y, 0]}>
      <mesh geometry={geos.wire} material={a.frameDark} />
      <mesh geometry={geos.bulbs} material={a.bulbGlow} />
    </group>
  );
}

function StringLights({ a }: { a: RoofAssets }) {
  const poles = useMemo(() => merged([
    cyl(0.028, 0.034, 2.78, -4.15, 1.39, -4.15, 8),
    cyl(0.028, 0.034, 2.78, 4.15, 1.39, -4.15, 8),
    cyl(0.028, 0.034, 2.78, -4.15, 1.39, 4.15, 8),
    cyl(0.028, 0.034, 2.78, 4.15, 1.39, 4.15, 8),
  ]), []);
  return (
    <group>
      <mesh geometry={poles} material={a.frameDark} position={[0, FLOOR_Y, 0]} castShadow />
      <StringRun a={a} from={[-4.15, -4.15]} to={[4.15, -4.15]} />
      <StringRun a={a} from={[-4.15, -4.15]} to={[-4.15, 4.15]} />
      <StringRun a={a} from={[4.15, -4.15]} to={[4.15, 4.15]} />
    </group>
  );
}

/* ------------------------------------------------------------------ */

export default function RooftopSkylineRoom({ fxOn, handNo }: { fxOn: boolean; handNo: number }) {
  const a = assets();
  // The cube room's local-clock lock: TOD locks at hand start,
  // never mid-hand — the same hook, the same hand number.
  const lock = useLocalTod(handNo);
  const tod = lock.tod;
  useEffect(() => {
    (window as unknown as { __bwmVenue?: unknown }).__bwmVenue = { id: 'rooftop', fx: fxOn, studio: true, room: 'rooftop-skyline', props: false, tod };
  }, [fxOn, tod]);
  return (
    <group>
      <RoofLights fxOn={fxOn} tod={tod} />
      <RoofLife a={a} fxOn={fxOn} tod={tod} />
      <RoofChairs a={a} />
      <Shell a={a} tod={tod} />
      <Skyline a={a} tod={tod} />
      <Bulkhead a={a} />
      <WaterTower a={a} />
      <VentAndPlanters a={a} />
      <StringLights a={a} />
      {/* NO table here — the shared game table is the anchor. */}
    </group>
  );
}
