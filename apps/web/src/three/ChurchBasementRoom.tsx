import { useMemo } from 'react';
import {
  BoxGeometry, CanvasTexture, ColorManagement, CylinderGeometry,
  MeshStandardMaterial, Quaternion, RepeatWrapping, SRGBColorSpace, SphereGeometry,
  Vector3,
} from 'three';
import { useFrame } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The shared table's floor plane (sibling rooms keep their own). */
const FLOOR_Y = -0.9;

/**
 * THE CHURCH BASEMENT — story Stop 6's 3D room (Deacon Ford &
 * Sister Mae).
 *
 * Mounted by Scene for every High-quality church table (the
 * venues rollout un-scoped it from story stop `church-basement`,
 * 2026-10-28 — the room is the venue's own fellowship hall, no
 * story-specific dressing); Low quality everywhere keeps the
 * shipped cube-config ChurchRoom (churchLayout), untouched.
 * The room is
 * sandbox-certified (ChurchCodeRoom in the immersive sandbox):
 * a fellowship hall in miniature — 8.8 × 8.8 m of painted
 * cinderblock, brown tile floor, a LOW ceiling (floor + 2.95,
 * the cosiest room on the route), four fluorescent panels
 * AROUND the table (none overhead-centre; a barely-there hum
 * when fxOn), high frosted windows on the far and west walls,
 * two beige fellowship tables as dressing (CHU-01), the kit
 * folding chairs in sage-green enamel as the play seats
 * (CHU-02), the kitchen pass-through hatch on the east wall
 * with the coffee urn on its stainless counter (CHU-03/06), a
 * folded-chair stack on the west wall (CHU-04), a water cooler
 * in the SE corner (CHU-07) and blank storage boxes in the SW
 * (CHU-08).
 *
 * Route: ALL CODE, zero downloads — every item is box /
 * cylinder / tube work.
 *
 * Standing-camera discipline: the ceiling is a SINGLE-SIDED
 * plane at floor + 2.95 facing DOWN only — the standing camera
 * above sees through it; there are NO beams, and the
 * fluorescent housings sit at (±1.9, ±1.9), around the table,
 * never spanning or banding across the felt. The room renders
 * no table: the shared game table is the anchor.
 *
 * HARD EXCLUSIONS (manifest): no crosses or religious props of
 * any kind, no text / lettering anywhere, no food spreads, no
 * piano / organ. The room stays humble and sparse — the route's
 * slow-beat room.
 *
 * Seat back-clearances (kit chair back = CHAIR_SPOTS origin +
 * 0.25 m): far seat back z=-2.23 → far wall -4.4 = 2.17 m;
 * player back z=+2.23 → south wall 4.4 = 2.17 m; west back
 * x=-2.39 → west fellowship table inner face -3.525 = 1.14 m;
 * east back x=+2.39 → hatch counter front 3.95 = 1.56 m (the
 * counter's z-span 0.4–2.8 sits 0.4 m north of the east seat's
 * centreline; on-axis the east wall gives 2.01 m). All ≥ 0.6 m.
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

/** Brown tile: ~0.31 m tiles (canvas tile = 1.257 m at [7,7]). */
function makeTileTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(60211);
    ctx.fillStyle = '#4a3826'; ctx.fillRect(0, 0, w, h); // grout
    const t = 128, g = 5;
    for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
      const j = (rnd() - 0.5) * 26;
      ctx.fillStyle = `rgb(${Math.round(116 + j)},${Math.round(86 + j * 0.7)},${Math.round(54 + j * 0.5)})`;
      ctx.fillRect(tx * t + g / 2, ty * t + g / 2, t - g, t - g);
      const sx = tx * t + 20 + rnd() * 70, sy = ty * t + 20 + rnd() * 70;
      const sheen = ctx.createRadialGradient(sx, sy, 2, sx, sy, 42);
      sheen.addColorStop(0, `rgba(255,235,200,${(0.04 + rnd() * 0.05).toFixed(2)})`);
      sheen.addColorStop(1, 'rgba(255,235,200,0)');
      ctx.fillStyle = sheen; ctx.fillRect(tx * t, ty * t, t, t);
    }
    speckle(ctx, w, h, 5200, rnd, 0.10, false);
    speckle(ctx, w, h, 2200, rnd, 0.05, true);
    for (let i = 0; i < 6; i++) { // scuff arcs
      ctx.strokeStyle = `rgba(30,20,12,${(0.10 + rnd() * 0.10).toFixed(2)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(rnd() * w, rnd() * h, 14 + rnd() * 40, rnd() * 3, rnd() * 2 + 0.6);
      ctx.stroke();
    }
  }, [7, 7]);
}

/** Painted cinderblock: 0.4 × 0.2 m courses, cream #d9d5c9. */
function makeCinderTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(60606);
    ctx.fillStyle = '#a39c8d'; ctx.fillRect(0, 0, w, h); // mortar
    const bw = 512 / 5, bh = 512 / 10, gap = 3;
    for (let row = 0; row < 10; row++) {
      const off = row % 2 === 0 ? 0 : bw / 2;
      for (let col = -1; col < 6; col++) {
        const j = (rnd() - 0.5) * 10;
        ctx.fillStyle = `rgb(${Math.round(217 + j)},${Math.round(213 + j)},${Math.round(201 + j * 0.9)})`;
        ctx.fillRect(col * bw + off + gap / 2, row * bh + gap / 2, bw - gap, bh - gap);
      }
    }
    speckle(ctx, w, h, 3800, rnd, 0.06, false);
    speckle(ctx, w, h, 1500, rnd, 0.04, true);
  }, [4.4, 1.475]);
}

/** Off-white ceiling, faint stain blooms. */
function makeCeilingTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const rnd = mulberry32(777);
    ctx.fillStyle = '#e7e4db'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 1600, rnd, 0.05, false);
    for (let i = 0; i < 2; i++) {
      const x = rnd() * w, y = rnd() * h, r = 34 + rnd() * 46;
      const st = ctx.createRadialGradient(x, y, 2, x, y, r);
      st.addColorStop(0, 'rgba(168,142,96,0.13)');
      st.addColorStop(0.75, 'rgba(168,142,96,0.05)');
      st.addColorStop(1, 'rgba(168,142,96,0)');
      ctx.fillStyle = st; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, [3, 3]);
}

/* ------------------------------------------------------------------ */
/* cached assets                                                        */
/* ------------------------------------------------------------------ */

type ChurchAssets = {
  tile: MeshStandardMaterial; cinder: MeshStandardMaterial; ceiling: MeshStandardMaterial;
  scuffBand: MeshStandardMaterial; frosted: MeshStandardMaterial; framePaint: MeshStandardMaterial;
  sagePanel: MeshStandardMaterial; steelBlack: MeshStandardMaterial;
  beigeTop: MeshStandardMaterial; edgeBand: MeshStandardMaterial; legSteel: MeshStandardMaterial;
  tray: MeshStandardMaterial; pitcher: MeshStandardMaterial; trimWood: MeshStandardMaterial;
  stainless: MeshStandardMaterial; hatchDark: MeshStandardMaterial; hatchGlow: MeshStandardMaterial;
  panelGlow: MeshStandardMaterial; housing: MeshStandardMaterial; urnSteel: MeshStandardMaterial;
  blackPlastic: MeshStandardMaterial; plateWhite: MeshStandardMaterial; coolerBody: MeshStandardMaterial;
  bottle: MeshStandardMaterial; cardboard: MeshStandardMaterial; tape: MeshStandardMaterial;
  binGrey: MeshStandardMaterial; doorCream: MeshStandardMaterial;
};

let ASSETS: ChurchAssets | null = null;
function assets(): ChurchAssets {
  if (ASSETS) return ASSETS;
  ColorManagement.enabled = true;
  ASSETS = {
    tile: std({ map: makeTileTexture(), roughness: 0.55, metalness: 0.04 }),
    cinder: std({ map: makeCinderTexture(), roughness: 0.94, metalness: 0 }),
    ceiling: std({ map: makeCeilingTexture(), roughness: 0.96, metalness: 0 }),
    scuffBand: std({ color: '#b3ac9c', roughness: 0.97, metalness: 0 }),
    frosted: std({ color: '#f4f7ff', emissive: '#e8efff', emissiveIntensity: 0.55, roughness: 0.55, metalness: 0 }),
    framePaint: std({ color: '#8f8a7d', roughness: 0.8, metalness: 0.05 }),
    sagePanel: std({ color: '#71806a', roughness: 0.58, metalness: 0.10 }),
    steelBlack: std({ color: '#26282c', roughness: 0.34, metalness: 0.8 }),
    beigeTop: std({ color: '#cfc3a5', roughness: 0.5, metalness: 0.03 }),
    edgeBand: std({ color: '#8a7a5c', roughness: 0.6, metalness: 0.02 }),
    legSteel: std({ color: '#8d9094', roughness: 0.38, metalness: 0.8 }),
    tray: std({ color: '#b9b4a6', roughness: 0.55, metalness: 0.05 }),
    pitcher: std({ color: '#e3ded2', roughness: 0.35, metalness: 0.05 }),
    trimWood: std({ color: '#6d4c2c', roughness: 0.72, metalness: 0 }),
    stainless: std({ color: '#c9ccd1', roughness: 0.28, metalness: 0.9 }),
    hatchDark: std({ color: '#17100b', roughness: 1, metalness: 0 }),
    hatchGlow: std({ color: '#2a1608', emissive: '#ff9a3c', emissiveIntensity: 0.38, roughness: 1, metalness: 0 }),
    panelGlow: std({ color: '#f2f7ff', emissive: '#eef6ff', emissiveIntensity: 1.5, roughness: 0.4, metalness: 0 }),
    housing: std({ color: '#d8d5cc', roughness: 0.5, metalness: 0.35 }),
    urnSteel: std({ color: '#b9bcbe', roughness: 0.3, metalness: 0.9 }),
    blackPlastic: std({ color: '#17181a', roughness: 0.55, metalness: 0.1 }),
    plateWhite: std({ color: '#f2efe8', roughness: 0.32, metalness: 0.02 }),
    coolerBody: std({ color: '#e8e6df', roughness: 0.45, metalness: 0.03 }),
    bottle: std({ color: '#7fb2d9', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.75 }),
    cardboard: std({ color: '#9a7b52', roughness: 0.92, metalness: 0 }),
    tape: std({ color: '#c8b28a', roughness: 0.7, metalness: 0 }),
    binGrey: std({ color: '#7d7f82', roughness: 0.6, metalness: 0.05 }),
    doorCream: std({ color: '#cfc9b8', roughness: 0.75, metalness: 0.02 }),
  };
  return ASSETS;
}

/** Local height helper: metres above the floor → world y. */
const Y = (h: number) => FLOOR_Y + h;
const WALL_H = 2.95;

/* ------------------------------------------------------------------ */
/* lights — warm-white and low: the panel emissives carry the        */
/* fluorescent read, a soft warm pool over the table, the hatch's    */
/* warm point. The hum: panel emissive ±0.04 on a slow sine, fxOn    */
/* only (fxOn off holds the panels dead steady).                     */
/* ------------------------------------------------------------------ */

function PanelHum({ a, fxOn }: { a: ChurchAssets; fxOn: boolean }) {
  useFrame(({ clock }) => {
    a.panelGlow.emissiveIntensity = fxOn
      ? 1.5 + Math.sin(clock.elapsedTime * 2.3) * 0.04
      : 1.5;
  });
  return null;
}

function ChurchLights({ fxOn }: { fxOn: boolean }) {
  return (
    <>
      <hemisphereLight args={['#fff3df', '#57493a', 0.8]} />
      <directionalLight
        position={[3.5, 6, 2.5]}
        target-position={[0, -0.6, -0.5]}
        color="#ffedd6"
        intensity={0.5}
        castShadow={fxOn}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-6} shadow-camera-right={6}
        shadow-camera-top={6} shadow-camera-bottom={-6}
        shadow-bias={-0.0004}
      />
      {/* warm-white pool over the table */}
      <pointLight position={[0, Y(2.35), 0]} intensity={8} distance={9} decay={2} color="#ffe9c4" />
      {/* a low fill from the hatch side so the east seats read */}
      <pointLight position={[2.8, Y(1.6), 1.2]} intensity={2.2} distance={6} decay={2} color="#ffe2b8" />
      {/* the hatch's warm spill */}
      <pointLight position={[4.05, Y(1.55), 1.6]} intensity={2.6} distance={3.2} decay={2} color="#ff9e45" />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* the four seats — the kit folding chair at owner scale (H 0.90,    */
/* seat ~0.49), SAGE-GREEN enamel panels (CHU-02: in this room the   */
/* green folding chairs ARE the play seats)                          */
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

function FoldingChairs({ a }: { a: ChurchAssets }) {
  const geos = useMemo(foldingChairGeo, []);
  return (
    <group>
      {CHAIR_SPOTS.map(({ pos, ry }, i) => (
        <group key={i} position={pos} rotation={[0, ry, 0]}>
          <mesh geometry={geos.seat} material={a.sagePanel} castShadow receiveShadow />
          <mesh geometry={geos.back} material={a.sagePanel} castShadow receiveShadow />
          <mesh geometry={geos.legs} material={a.steelBlack} castShadow />
          <mesh geometry={geos.backLegs} material={a.steelBlack} castShadow />
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* CHU-05 — the shell + high frosted windows + the plain south door  */
/* ------------------------------------------------------------------ */

function FrostedWindow({ position, ry, a }: { position: [number, number, number]; ry: number; a: ChurchAssets }) {
  const parts = useMemo(() => merged([
    box(1.05, 0.65, 0.05, 0, 0, 0),
    box(0.05, 0.55, 0.02, 0, 0, 0.035),
    box(0.95, 0.05, 0.02, 0, 0, 0.035),
    box(1.12, 0.05, 0.07, 0, -0.35, 0.01),
  ]), []);
  return (
    <group position={position} rotation={[0, ry, 0]}>
      <mesh geometry={parts} material={a.framePaint} castShadow receiveShadow />
      <mesh material={a.frosted} position={[0, 0, 0.028]}>
        <planeGeometry args={[0.95, 0.55]} />
      </mesh>
    </group>
  );
}

function Shell({ a }: { a: ChurchAssets }) {
  // East wall segments around the hatch (opening z 0.4–2.8,
  // h 0.95–2.10, inner face x=+4.4, wall centre x=4.475).
  const eastSegs = useMemo(() => merged([
    box(0.15, WALL_H, 4.8, 0, WALL_H / 2, -2.0),
    box(0.15, WALL_H, 1.6, 0, WALL_H / 2, 3.6),
    box(0.15, 0.95, 2.4, 0, 0.475, 1.6),
    box(0.15, WALL_H - 2.10, 2.4, 0, (WALL_H + 2.10) / 2, 1.6),
  ]), []);
  const scuff = useMemo(() => merged([
    box(8.8, 0.45, 0.012, 0, 0.225, -4.394),
    box(8.8, 0.45, 0.012, 0, 0.225, 4.394),
    box(0.012, 0.45, 8.8, -4.394, 0.225, 0),
    box(0.012, 0.45, 8.8, 4.394, 0.225, 0),
  ]), []);
  return (
    <group>
      {/* brown tile floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} material={a.tile} receiveShadow>
        <planeGeometry args={[8.8, 8.8]} />
      </mesh>
      {/* far + south walls, inner faces at z=∓4.4 */}
      <mesh material={a.cinder} position={[0, Y(WALL_H / 2), -4.475]} receiveShadow castShadow>
        <boxGeometry args={[9.1, WALL_H, 0.15]} />
      </mesh>
      <mesh material={a.cinder} position={[0, Y(WALL_H / 2), 4.475]} receiveShadow castShadow>
        <boxGeometry args={[9.1, WALL_H, 0.15]} />
      </mesh>
      {/* west wall, inner face x=-4.4 */}
      <mesh material={a.cinder} position={[-4.475, Y(WALL_H / 2), 0]} receiveShadow castShadow>
        <boxGeometry args={[0.15, WALL_H, 8.8]} />
      </mesh>
      {/* east wall, segmented for the hatch */}
      <mesh geometry={eastSegs} material={a.cinder} position={[4.475, FLOOR_Y, 0]} receiveShadow castShadow />
      {/* low scuff band where chairs and shoes have lived */}
      <mesh geometry={scuff} material={a.scuffBand} position={[0, FLOOR_Y, 0]} receiveShadow />
      {/* the LOW ceiling: SINGLE-SIDED, facing DOWN only (FrontSide
          is the material default; the plane is rotated so its one
          face points at the floor) — the standing camera above
          floor+2.95 sees through it. No beams anywhere. */}
      <mesh material={a.ceiling} rotation={[Math.PI / 2, 0, 0]} position={[0, Y(WALL_H), 0]} receiveShadow>
        <planeGeometry args={[8.8, 8.8]} />
      </mesh>
      {/* high frosted windows: far wall ×3 + west wall ×2, sill 2.05 */}
      {[-2.7, 0, 2.7].map((x) => (
        <FrostedWindow key={`far-${x}`} position={[x, Y(2.325), -4.385]} ry={0} a={a} />
      ))}
      {[-2.2, -0.2].map((z) => (
        <FrostedWindow key={`west-${z}`} position={[-4.385, Y(2.325), z]} ry={Math.PI / 2} a={a} />
      ))}
      {/* the plain south door, behind the player */}
      <group position={[1.4, FLOOR_Y, 4.39]}>
        <mesh material={a.framePaint} position={[0, 1.08, 0.01]}>
          <boxGeometry args={[1.03, 2.2, 0.05]} />
        </mesh>
        <mesh material={a.doorCream} position={[0, 1.06, -0.015]} castShadow receiveShadow>
          <boxGeometry args={[0.92, 2.08, 0.05]} />
        </mesh>
        <mesh material={a.legSteel} position={[0, 1.0, -0.055]}>
          <boxGeometry args={[0.68, 0.045, 0.045]} />
        </mesh>
        <mesh material={a.legSteel} position={[0, 0.16, -0.048]}>
          <boxGeometry args={[0.8, 0.28, 0.012]} />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* fluorescent panels ×4 — AROUND the table at (±1.9, ±1.9),         */
/* housings at h 2.90, emissive faces down. None overhead-centre.    */
/* ------------------------------------------------------------------ */

function FluoroPanels({ a }: { a: ChurchAssets }) {
  const housing = useMemo(() => merged([box(1.33, 0.055, 0.38, 0, 0, 0)]), []);
  return (
    <group>
      {([[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]] as const).map(([x, z]) => (
        <group key={`${x}-${z}`} position={[x, Y(2.90), z]}>
          <mesh geometry={housing} material={a.housing} castShadow />
          <mesh material={a.panelGlow} position={[0, -0.034, 0]}>
            <boxGeometry args={[1.25, 0.012, 0.30]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* CHU-01 — fellowship table (dressing): beige laminate top          */
/* 1.85 × 0.75 at h 0.74, darker edge band, grey steel X-legs.       */
/* Local: floor y=0, long axis along z.                              */
/* ------------------------------------------------------------------ */

function FellowshipTable({ position, withItems, a }: {
  position: [number, number, number]; withItems?: boolean; a: ChurchAssets;
}) {
  const legs = useMemo(() => {
    const parts: G[] = [];
    for (const sx of [-1, 1]) {
      const x = 0.27 * sx;
      parts.push(tube([x, 0.02, -0.82], [x, 0.70, 0.52], 0.014));
      parts.push(tube([x, 0.02, 0.82], [x, 0.70, -0.52], 0.014));
    }
    parts.push(box(0.56, 0.03, 1.45, 0, 0.685, 0));
    parts.push(tube([-0.27, 0.06, -0.80], [0.27, 0.06, -0.80], 0.011));
    parts.push(tube([-0.27, 0.06, 0.80], [0.27, 0.06, 0.80], 0.011));
    return merged(parts);
  }, []);
  return (
    <group position={position}>
      <mesh geometry={legs} material={a.legSteel} castShadow />
      <mesh material={a.edgeBand} position={[0, 0.707, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.77, 0.026, 1.87]} />
      </mesh>
      <mesh material={a.beigeTop} position={[0, 0.727, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.75, 0.03, 1.85]} />
      </mesh>
      {withItems && (
        <group>
          {/* a stack of two plain serving trays */}
          <mesh material={a.tray} position={[0, 0.755, -0.42]} castShadow receiveShadow>
            <boxGeometry args={[0.50, 0.025, 0.35]} />
          </mesh>
          <mesh material={a.tray} position={[0.012, 0.78, -0.40]} rotation={[0, 0.05, 0]} castShadow>
            <boxGeometry args={[0.50, 0.025, 0.35]} />
          </mesh>
          {/* a plain pitcher — blank shape, no lettering */}
          <mesh material={a.pitcher} position={[0.05, 0.825, 0.42]} castShadow>
            <cylinderGeometry args={[0.052, 0.062, 0.165, 14]} />
          </mesh>
          <mesh material={a.pitcher} position={[0.05, 0.915, 0.42]}>
            <cylinderGeometry args={[0.058, 0.052, 0.02, 14]} />
          </mesh>
        </group>
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* CHU-04 — the folded-chair stack: ~8 sage-green folded chairs as   */
/* thin leaning panels nested against the west wall (x=-4.05,       */
/* z=+2.6). Panel 0.50 across × 0.95 tall × 0.07 thick.              */
/* ------------------------------------------------------------------ */

function ChairStack({ a }: { a: ChurchAssets }) {
  const geo = useMemo(() => {
    const parts: G[] = [];
    for (let i = 0; i < 8; i++) {
      const lean = 0.19;
      const px = -4.24 + i * 0.052;
      const pz = 2.6 + (i % 2 === 0 ? -0.006 : 0.006);
      parts.push(box(0.07, 0.95, 0.50, px, 0.465, pz, 0, 0, lean));
      parts.push(box(0.03, 0.88, 0.44, px + 0.035, 0.44, pz, 0, 0, lean));
    }
    return merged(parts);
  }, []);
  return <mesh geometry={geo} material={a.sagePanel} position={[0, FLOOR_Y, 0]} castShadow receiveShadow />;
}

/* ------------------------------------------------------------------ */
/* CHU-03 — the pass-through hatch, EAST wall, centred z=+1.6        */
/* (span 0.4–2.8), opening h 0.95–2.10: wood trim, stainless         */
/* counter out to x=3.95 at h 0.92, dim warm void + back shelf +     */
/* faint warm glow plane. CHU-06 — coffee urn at z≈0.9, plates at    */
/* z≈1.7, three cups at z≈2.2, all on the counter.                   */
/* ------------------------------------------------------------------ */

function Hatch({ a }: { a: ChurchAssets }) {
  const trim = useMemo(() => merged([
    box(0.07, 0.09, 2.58, 0, 2.145, 0),
    box(0.07, 0.09, 2.58, 0, 0.905, 0),
    box(0.07, 1.33, 0.09, 0, 1.525, -1.245),
    box(0.07, 1.33, 0.09, 0, 1.525, 1.245),
    box(0.05, 0.30, 0.05, -0.18, 0.76, -1.05),
    box(0.05, 0.30, 0.05, -0.18, 0.76, 1.05),
  ]), []);
  const plates = useMemo(() => {
    const parts: G[] = [];
    for (let i = 0; i < 8; i++) parts.push(cyl(0.12, 0.095, 0.016, 0, 0.008 + i * 0.017, 0, 18));
    return merged(parts);
  }, []);
  return (
    <group>
      {/* the dark opening itself, just inside the wall plane */}
      <mesh material={a.hatchDark} position={[4.44, Y(1.525), 1.6]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[2.4, 1.15]} />
      </mesh>
      {/* faint warm glow at the back of the void */}
      <mesh material={a.hatchGlow} position={[4.82, Y(1.5), 1.6]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[2.2, 1.05]} />
      </mesh>
      {/* a back shelf silhouette + two blank shapes resting on it */}
      <mesh material={a.hatchDark} position={[4.66, Y(1.32), 1.6]}>
        <boxGeometry args={[0.30, 0.035, 2.0]} />
      </mesh>
      <mesh material={a.hatchDark} position={[4.66, Y(1.47), 1.05]}>
        <boxGeometry args={[0.20, 0.26, 0.30]} />
      </mesh>
      <mesh material={a.hatchDark} position={[4.66, Y(1.44), 2.15]}>
        <boxGeometry args={[0.18, 0.20, 0.24]} />
      </mesh>
      {/* wood trim frame on the room side */}
      <mesh geometry={trim} material={a.trimWood} position={[4.385, FLOOR_Y, 1.6]} castShadow receiveShadow />
      {/* the stainless counter shelf: x 3.95 → 4.40, top h 0.92 */}
      <mesh material={a.stainless} position={[4.175, Y(0.9025), 1.6]} castShadow receiveShadow>
        <boxGeometry args={[0.45, 0.035, 2.4]} />
      </mesh>
      {/* CHU-06: the coffee urn — brushed steel, domed lid, black
          handles + spigot. Blank: no lettering, no gauges. */}
      <group position={[4.14, Y(0.92), 0.9]}>
        <mesh material={a.urnSteel} position={[0, 0.25, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.14, 0.145, 0.50, 20]} />
        </mesh>
        <mesh material={a.urnSteel} position={[0, 0.53, 0]}>
          <sphereGeometry args={[0.135, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
        <mesh material={a.blackPlastic} position={[0, 0.635, 0]}>
          <sphereGeometry args={[0.028, 10, 8]} />
        </mesh>
        <mesh material={a.blackPlastic} position={[0, 0.03, 0]}>
          <cylinderGeometry args={[0.15, 0.155, 0.05, 20]} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} material={a.blackPlastic} position={[0.155 * s, 0.38, 0]}>
            <boxGeometry args={[0.03, 0.16, 0.045]} />
          </mesh>
        ))}
        {/* spigot facing the room (−x) */}
        <mesh material={a.blackPlastic} position={[-0.155, 0.13, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.016, 0.016, 0.07, 8]} />
        </mesh>
        <mesh material={a.blackPlastic} position={[-0.185, 0.175, 0]}>
          <boxGeometry args={[0.05, 0.02, 0.03]} />
        </mesh>
      </group>
      {/* a stack of white plates on the counter */}
      <mesh geometry={plates} material={a.plateWhite} position={[4.16, Y(0.92), 1.7]} castShadow />
      {/* three plain cups */}
      {([2.12, 2.24, 2.33] as const).map((z, i) => (
        <mesh key={z} material={a.plateWhite} position={[4.18 - (i % 2) * 0.09, Y(0.955), z]} castShadow>
          <cylinderGeometry args={[0.035, 0.028, 0.07, 12]} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* CHU-07 — the water cooler, SE corner                              */
/* ------------------------------------------------------------------ */

function WaterCooler({ a }: { a: ChurchAssets }) {
  const parts = useMemo(() => merged([
    box(0.32, 1.0, 0.32, 0, 0.5, 0),
    box(0.26, 0.05, 0.26, 0, 1.015, 0),
    box(0.20, 0.03, 0.06, 0, 0.70, -0.175),
    cyl(0.045, 0.065, 0.10, 0, 1.06, 0, 12),
  ]), []);
  return (
    <group position={[3.85, FLOOR_Y, 3.75]}>
      <mesh geometry={parts} material={a.coolerBody} castShadow receiveShadow />
      <mesh material={a.bottle} position={[0, 1.30, 0]} castShadow>
        <cylinderGeometry args={[0.135, 0.135, 0.42, 16]} />
      </mesh>
      {[-0.07, 0.07].map((x) => (
        <group key={x}>
          <mesh material={a.blackPlastic} position={[x, 0.86, -0.175]}>
            <boxGeometry args={[0.045, 0.05, 0.035]} />
          </mesh>
          <mesh material={a.legSteel} position={[x, 0.815, -0.175]}>
            <boxGeometry args={[0.02, 0.045, 0.02]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* CHU-08 — storage, SW corner: three blank cardboard boxes with a   */
/* tape stripe + one grey plastic bin beside them. No lettering.     */
/* ------------------------------------------------------------------ */

function StorageStack({ a }: { a: ChurchAssets }) {
  const boxWithTape = (wdt: number, hgt: number, dep: number) => (
    <group>
      <mesh material={a.cardboard} position={[0, hgt / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[wdt, hgt, dep]} />
      </mesh>
      <mesh material={a.tape} position={[0, hgt + 0.002, 0]}>
        <boxGeometry args={[0.11, 0.006, dep]} />
      </mesh>
    </group>
  );
  return (
    <group>
      <group position={[-3.8, FLOOR_Y, 3.78]} rotation={[0, 0.04, 0]}>{boxWithTape(0.60, 0.38, 0.45)}</group>
      <group position={[-3.76, FLOOR_Y + 0.38, 3.74]} rotation={[0, -0.07, 0]}>{boxWithTape(0.52, 0.30, 0.40)}</group>
      <group position={[-3.08, FLOOR_Y, 3.82]} rotation={[0, -0.03, 0]}>{boxWithTape(0.58, 0.34, 0.44)}</group>
      {/* the grey plastic bin beside the boxes */}
      <group position={[-3.5, FLOOR_Y, 3.05]}>
        <mesh material={a.binGrey} position={[0, 0.25, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.55, 0.50, 0.40]} />
        </mesh>
        <mesh material={a.binGrey} position={[0, 0.515, 0]}>
          <boxGeometry args={[0.59, 0.04, 0.44]} />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */

export default function ChurchBasementRoom({ fxOn }: { fxOn: boolean }) {
  const a = assets();
  return (
    <group>
      <ChurchLights fxOn={fxOn} />
      <PanelHum a={a} fxOn={fxOn} />
      <FoldingChairs a={a} />
      <Shell a={a} />
      <FluoroPanels a={a} />
      <FellowshipTable position={[-3.9, FLOOR_Y, -0.9]} withItems a={a} />
      <FellowshipTable position={[3.95, FLOOR_Y, -2.4]} a={a} />
      <ChairStack a={a} />
      <Hatch a={a} />
      <WaterCooler a={a} />
      <StorageStack a={a} />
      {/* NO table here — the shared game table is the anchor. */}
    </group>
  );
}
