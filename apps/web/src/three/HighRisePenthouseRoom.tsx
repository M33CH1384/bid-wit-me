import { useEffect, useMemo } from 'react';
import {
  BackSide, BoxGeometry, CanvasTexture, CylinderGeometry, DoubleSide, Fog, MeshStandardMaterial,
  Quaternion, RepeatWrapping, SRGBColorSpace, SphereGeometry, TubeGeometry, Vector3,
} from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHAIR_SPOTS } from './classicStudioLayout';

/** The shared table's floor plane (sibling rooms keep their own). */
const FLOOR_Y = -0.9;

/**
 * THE HIGH-RISE — story Stop 8's 3D room (Velvet & The Accountant).
 *
 * Mounted by Scene only for a story table carrying stop
 * `high-rise` at High quality; every other mansion table — and
 * Low quality everywhere — keeps the shipped MansionRoom (the
 * cube room), untouched (pinned in test/high-rise-room.test.ts).
 * Sandbox-certified (HighRiseCodeRoom in the immersive sandbox,
 * Batch 6a): a cold minimalist penthouse at night — floor-to-
 * ceiling glass on the north/east/west with the city glittering
 * far below, brushed-steel columns (HIG-02), grey stone wall
 * panels (HIG-05) on the south wall, a low steel credenza
 * (HIG-04) with crystal tumblers (HIG-06), a minimalist side
 * table (HIG-08), linear ceiling-light strips (HIG-07) as cove
 * bars along the glass head and the stone wall — the room's
 * only warmth — and the designer armchairs (HIG-03) at the
 * four seat spots. The art's square steel-and-glass table is a
 * staging reference only; play stays on the shared game table.
 *
 * Route: ALL CODE, zero downloads — window walls, columns,
 * stone and leather-and-steel chairs are frame-and-panel /
 * tube construction; the city below is environment work (a lit
 * ground plane + far silhouette towers), which the manifest
 * assigns to scene environment, not items. Nothing here is a
 * proven code-fails class.
 *
 * Standing-camera discipline (gate added 2026-10-28): the
 * ceiling is ONE single-sided plane at floor + 3.40 facing
 * down only (culled from the standing camera above it); the
 * light strips hug the two far wall heads (z −5.02 / +5.42),
 * never the table axis; columns stand at the room's corners.
 * Nothing spans the table; the glass and the city below frame
 * at the frame's edges only (production standing frames:
 * felt visible edge to edge).
 *
 * Seat back-clearances (HIG-03 chair back = 0.32 m behind the
 * CHAIR_SPOTS origin): far seat (0, −2.45) back at z −2.77 →
 * glass face −5.20 = 2.43 m; player (0, +2.80) back at
 * z +3.12 → credenza front +5.15 = 2.03 m (stone wall +5.60 =
 * 2.48 m); west (−2.30, 0) back at x −2.62 → glass −5.20 =
 * 2.58 m; east (+2.30, 0) back at +2.62 → glass +5.20 =
 * 2.58 m. Columns at (±3.40, −4.85) and (±3.40, +5.25) stand
 * 3.4 m+ off every seat axis. All ≥ 0.6 m with open polished
 * floor behind every chair back.
 *
 * HARD EXCLUSIONS (manifest): no gold/velvet lounge dressing
 * (that is the King's room), no art-table replacement, no
 * readable screens as props, no text anywhere. The room
 * carries NO people dressing — this stop is empty by design
 * for railbirds (a dialogue rule the build honors by adding
 * no figures of its own).
 *
 * Effects: `fxOn` (= !reduceFx at this table) gates the
 * ceiling-strip shimmer and the directional's shadows.
 * Effects off = the same room, one static frame. The room
 * renders no table: the shared game table is the anchor.
 */

/* ------------------------------------------------------------------ */
/* Layout constants — the standing + clearance discipline lives here.  */
/* ------------------------------------------------------------------ */

/** North glass face; east/west glass faces at ±GLASS_X. */
const GLASS_N = -5.2;
const GLASS_X = 5.2;
/** South stone wall inner face. */
const STONE_S = 5.6;
/** Ceiling height above the floor (single-sided, down-facing). */
const CEIL_H = 3.4;
/** Credenza front face (against the south stone wall). */
const CREDENZA_FRONT = 5.15;
/** HIG-03 chair back extent behind the seat-spot origin. */
const CHAIR_BACK = 0.32;

const Y = FLOOR_Y;

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
  side?: MeshStandardMaterial['side']; transparent?: boolean; opacity?: number; fog?: boolean;
};
function std(o: MatOpts) {
  return new MeshStandardMaterial({
    color: o.color ?? '#ffffff', map: o.map ?? null,
    roughness: o.roughness, metalness: o.metalness,
    emissive: o.emissive ?? '#000000', emissiveMap: o.emissiveMap ?? null,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    ...(o.side ? { side: o.side } : {}),
    ...(o.transparent ? { transparent: true, opacity: o.opacity ?? 1 } : {}),
    ...(o.fog === false ? { fog: false } : {}),
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
/* textures                                                            */
/* ------------------------------------------------------------------ */

/** Polished concrete: cool grey body, fine speckle, expansion joints. */
function makeConcreteFloorTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(811);
    ctx.fillStyle = '#565b60'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 5200, rnd, 0.10, true);
    speckle(ctx, w, h, 3800, rnd, 0.12, false);
    ctx.strokeStyle = 'rgba(20,22,26,0.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 1); ctx.lineTo(w, 1); ctx.moveTo(1, 0); ctx.lineTo(1, h); ctx.stroke();
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,255,255,0.04)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, [5, 5]);
}

/** Honed grey stone slabs: fine faint veining + joints (HIG-05). */
function makeStoneTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(823);
    ctx.fillStyle = '#6d6f72'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 2600, rnd, 0.08, true);
    speckle(ctx, w, h, 2000, rnd, 0.09, false);
    ctx.strokeStyle = 'rgba(235,238,240,0.09)'; ctx.lineWidth = 1;
    for (let i = 0; i < 16; i++) {
      ctx.beginPath();
      let x = rnd() * w, y = 0; ctx.moveTo(x, y);
      while (y < h) { y += 18 + rnd() * 22; x += (rnd() - 0.5) * 26; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(24,25,28,0.8)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
  }, [1, 1]);
}

/** Brushed steel: fine vertical grain, low contrast. */
function makeBrushedTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const rnd = mulberry32(839);
    ctx.fillStyle = '#9aa0a4'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2400; i++) {
      const x = rnd() * w; const v = rnd();
      ctx.strokeStyle = v > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(40,44,48,0.05)';
      ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (rnd() - 0.5) * 2, h); ctx.stroke();
    }
  }, [1, 1]);
}

/** The city far below: street grid + lit windows as one lit ground. */
function makeCityTexture() {
  return canvasTex(1024, 1024, (ctx, w, h) => {
    const rnd = mulberry32(853);
    ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i <= 10; i++) {
      const p = (i / 10) * w + (rnd() - 0.5) * 8;
      ctx.fillStyle = 'rgba(255,166,66,0.50)'; ctx.fillRect(p, 0, 3, h);
      ctx.fillStyle = 'rgba(150,190,235,0.34)'; ctx.fillRect(0, p, w, 2);
    }
    for (let i = 0; i < 26000; i++) {
      const x = rnd() * w, y = rnd() * h;
      const warm = rnd() > 0.42;
      ctx.fillStyle = warm ? `rgba(255,${170 + Math.floor(rnd() * 60)},90,${0.35 + rnd() * 0.6})` : `rgba(170,205,255,${0.3 + rnd() * 0.55})`;
      ctx.fillRect(x, y, rnd() > 0.85 ? 2.4 : 1.4, 1.4);
    }
  }, [1, 1]);
}

/** Distant tower silhouettes: dark slab + sparse lit windows. */
function makeTowerTexture() {
  return canvasTex(256, 512, (ctx, w, h) => {
    const rnd = mulberry32(857);
    ctx.fillStyle = '#070a12'; ctx.fillRect(0, 0, w, h);
    for (let gx = 10; gx < w - 8; gx += 15) for (let gy = 12; gy < h - 8; gy += 19) {
      if (rnd() > 0.42) continue;
      ctx.fillStyle = rnd() > 0.4 ? 'rgba(255,190,110,0.85)' : 'rgba(165,205,255,0.8)';
      ctx.fillRect(gx, gy, 6, 8);
    }
  }, [1, 1]);
}

/** Night sky dome gradient: deep blue-black, a cityglow rim low. */
function makeNightSkyTexture() {
  return canvasTex(64, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#02040a'); g.addColorStop(0.55, '#060c18');
    g.addColorStop(0.82, '#0d1a2e'); g.addColorStop(1, '#27405e');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
}

/* ------------------------------------------------------------------ */
/* assets                                                              */
/* ------------------------------------------------------------------ */

type Assets = ReturnType<typeof buildAssets>;
function buildAssets() {
  const concreteTex = makeConcreteFloorTexture();
  const stoneTex = makeStoneTexture();
  const brushedTex = makeBrushedTexture();
  const cityTex = makeCityTexture();
  const towerTex = makeTowerTexture();
  const skyTex = makeNightSkyTexture();
  return {
    concrete: std({ map: concreteTex, roughness: 0.32, metalness: 0.08 }),
    stone: std({ map: stoneTex, roughness: 0.55, metalness: 0.05 }),
    steel: std({ map: brushedTex, roughness: 0.38, metalness: 0.55 }),
    steelDark: std({ color: '#2b2f34', roughness: 0.42, metalness: 0.6 }),
    mullion: std({ color: '#14171b', roughness: 0.5, metalness: 0.6 }),
    glass: std({ color: '#9fc0dd', roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.10, side: DoubleSide }),
    leather: std({ color: '#23242a', roughness: 0.52, metalness: 0.05 }),
    ceil: std({ color: '#23262b', roughness: 0.9, metalness: 0.05 }),
    strip: std({ color: '#fff2dd', emissive: '#ffdfae', emissiveIntensity: 2.4, roughness: 0.4, metalness: 0 }),
    stripHousing: std({ color: '#0c0d10', roughness: 0.6, metalness: 0.5 }),
    city: std({ map: cityTex, emissive: '#ffffff', emissiveMap: cityTex, emissiveIntensity: 1.3, color: '#0a0c10', roughness: 1, metalness: 0 }),
    tower: std({ map: towerTex, emissive: '#ffffff', emissiveMap: towerTex, emissiveIntensity: 0.75, color: '#05070c', roughness: 1, metalness: 0 }),
    sky: std({ map: skyTex, side: BackSide, fog: false, roughness: 1, metalness: 0 }),
    crystal: std({ color: '#dfe9f2', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.38 }),
  };
}

/* ------------------------------------------------------------------ */
/* fog + lights                                                        */
/* ------------------------------------------------------------------ */

function EnvFog() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const prev = scene.fog;
    // cold blue night, pushed long so the city below fades
    // into it instead of vanishing at the cube rooms' range
    scene.fog = new Fog('#0b1424', 16, 90);
    return () => { scene.fog = prev; };
  }, [scene]);
  return null;
}

function HighRiseLights({ fxOn }: { fxOn: boolean }) {
  return (
    <>
      <hemisphereLight args={['#7d9cc0', '#131a24', 1.0]} />
      <directionalLight
        position={[2.5, 6.5, -6]}
        color="#a9c6e8"
        intensity={1.1}
        castShadow={fxOn}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8} shadow-camera-right={8}
        shadow-camera-top={8} shadow-camera-bottom={-8}
      />
      <directionalLight position={[3, 4, 6]} color="#b9cfe4" intensity={0.35} />
      <pointLight position={[0, Y + 2.3, 0]} color="#ffe2b8" intensity={5} distance={10} decay={1.6} />
    </>
  );
}

/** Deterministic micro-shimmer on the ceiling strips, fx-gated. */
function StripShimmer({ a, fxOn }: { a: Assets; fxOn: boolean }) {
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    a.strip.emissiveIntensity = fxOn ? 2.4 + Math.sin(t * 0.7) * 0.06 + Math.sin(t * 2.3) * 0.03 : 2.4;
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* builders                                                            */
/* ------------------------------------------------------------------ */

/** One glass wall run (HIG-01): mullion grid + glass panes, centred at (cx, cz). */
function GlassRun({ a, len, cx, cz, ry }: { a: Assets; len: number; cx: number; cz: number; ry: number }) {
  const frame = useMemo(() => {
    const parts: G[] = [];
    const bays = Math.round(len / 3.0);
    for (let i = 0; i <= bays; i++) {
      const x = -len / 2 + (i * len) / bays;
      parts.push(box(0.09, CEIL_H, 0.15, x, CEIL_H / 2, 0));
    }
    parts.push(box(len, 0.12, 0.15, 0, 0.06, 0));
    parts.push(box(len, 0.10, 0.15, 0, CEIL_H / 2 + 0.85, 0));
    parts.push(box(len, 0.14, 0.16, 0, CEIL_H - 0.07, 0));
    return merged(parts);
  }, [len]);
  return (
    <group position={[cx, Y, cz]} rotation={[0, ry, 0]}>
      <mesh geometry={frame} material={a.mullion} />
      <mesh position={[0, CEIL_H / 2, 0]} material={a.glass}>
        <boxGeometry args={[len, CEIL_H, 0.02]} />
      </mesh>
    </group>
  );
}

/** HIG-02 brushed-steel columns at the four corners of the glass box. */
function Columns({ a }: { a: Assets }) {
  const geo = useMemo(() => merged([
    box(0.6, CEIL_H, 0.6, 0, CEIL_H / 2, 0),
    box(0.7, 0.06, 0.7, 0, 0.03, 0),
    box(0.7, 0.06, 0.7, 0, CEIL_H - 0.03, 0),
  ]), []);
  const spots: [number, number][] = [[-3.4, -4.85], [3.4, -4.85], [-3.4, 5.25], [3.4, 5.25]];
  return (
    <group>
      {spots.map(([x, z], i) => <mesh key={i} geometry={geo} material={a.steel} position={[x, Y, z]} castShadow />)}
    </group>
  );
}

/** HIG-05 stone wall (south) + the two stone returns on the side walls. */
function StoneWalls({ a }: { a: Assets }) {
  return (
    <group>
      <mesh material={a.stone} position={[0, Y + CEIL_H / 2, STONE_S + 0.05]}>
        <boxGeometry args={[11.2, CEIL_H, 0.1]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} material={a.stone} position={[s * (GLASS_X + 0.05), Y + CEIL_H / 2, (1.4 + STONE_S) / 2]}>
          <boxGeometry args={[0.1, CEIL_H, STONE_S - 1.4]} />
        </mesh>
      ))}
    </group>
  );
}

/** HIG-07 cove light strips along the glass head (north) and the stone wall head (south). */
function LightStrips({ a }: { a: Assets }) {
  const housing = useMemo(() => merged([
    box(2.4, 0.08, 0.12, -1.8, 0, 0), box(2.4, 0.08, 0.12, 1.8, 0, 0),
  ]), []);
  const stripGeo = useMemo(() => merged([
    box(2.3, 0.02, 0.05, -1.8, -0.05, 0), box(2.3, 0.02, 0.05, 1.8, -0.05, 0),
  ]), []);
  const y = Y + CEIL_H - 0.10;
  return (
    <group>
      {[-5.02, 5.42].map((z, i) => (
        <group key={i} position={[0, y, z]}>
          <mesh geometry={housing} material={a.stripHousing} />
          <mesh geometry={stripGeo} material={a.strip} />
        </group>
      ))}
    </group>
  );
}

/** HIG-04 credenza + HIG-06 tumblers, against the south stone wall. */
function Credenza({ a }: { a: Assets }) {
  const body = useMemo(() => merged([
    box(1.8, 0.5, 0.45, 0, 0.28, 0),
    box(1.86, 0.05, 0.5, 0, 0.555, 0),
    box(0.02, 0.34, 0.02, 0, 0.3, 0.235),
  ]), []);
  const feet = useMemo(() => merged([
    box(0.05, 0.06, 0.05, -0.82, 0.03, -0.17), box(0.05, 0.06, 0.05, 0.82, 0.03, -0.17),
    box(0.05, 0.06, 0.05, -0.82, 0.03, 0.17), box(0.05, 0.06, 0.05, 0.82, 0.03, 0.17),
  ]), []);
  const z = (CREDENZA_FRONT + STONE_S) / 2;
  return (
    <group position={[0, Y, z]}>
      <mesh geometry={body} material={a.steel} castShadow />
      <mesh geometry={feet} material={a.steelDark} />
      {/* HIG-06: two cut-crystal tumblers on the top, never on the felt */}
      {[-0.45, -0.28].map((x, i) => (
        <mesh key={i} material={a.crystal} position={[x, 0.625, -0.05]}>
          <cylinderGeometry args={[0.04, 0.034, 0.09, 12]} />
        </mesh>
      ))}
    </group>
  );
}

/** HIG-08 minimalist side table, west flank off-axis. */
function SideTable({ a }: { a: Assets }) {
  const geo = useMemo(() => merged([
    box(0.45, 0.04, 0.45, 0, 0.53, 0),
    box(0.04, 0.53, 0.04, -0.18, 0.265, -0.18), box(0.04, 0.53, 0.04, 0.18, 0.265, -0.18),
    box(0.04, 0.53, 0.04, -0.18, 0.265, 0.18), box(0.04, 0.53, 0.04, 0.18, 0.265, 0.18),
  ]), []);
  return <mesh geometry={geo} material={a.steelDark} position={[-3.7, Y, -1.9]} castShadow />;
}

/**
 * HIG-03 designer armchairs at the seat spots: black leather
 * cushions on a brushed-steel tube frame. Local space: floor
 * y = 0, chair faces +z; seat top 0.45, back top 0.85, back
 * rearmost −0.32 (the CHAIR_BACK constant the gate measures).
 */
function Armchairs({ a }: { a: Assets }) {
  const frame = useMemo(() => {
    const parts: G[] = [];
    for (const sx of [-1, 1]) {
      const x = 0.27 * sx;
      parts.push(tube([x, 0.01, 0.26], [x, 0.01, -0.28], 0.016));
      parts.push(tube([x, 0.01, 0.24], [x, 0.44, 0.20], 0.014));
      parts.push(tube([x, 0.01, -0.26], [x, 0.85, -0.30], 0.014));
      parts.push(tube([x, 0.62, 0.22], [x, 0.62, -0.24], 0.013));
      parts.push(tube([x, 0.44, 0.16], [x, 0.62, 0.10], 0.012));
    }
    parts.push(tube([-0.27, 0.845, -0.298], [0.27, 0.845, -0.298], 0.014));
    return merged(parts);
  }, []);
  const cushions = useMemo(() => merged([
    box(0.56, 0.10, 0.52, 0, 0.40, 0.0),
    box(0.56, 0.52, 0.11, 0, 0.66, -0.265, -0.10),
  ]), []);
  return (
    <group>
      {CHAIR_SPOTS.map((s, i) => (
        <group key={i} position={[s.x, Y, s.z]} rotation={[0, s.ry, 0]}>
          <mesh geometry={frame} material={a.steel} castShadow />
          <mesh geometry={cushions} material={a.leather} castShadow />
        </group>
      ))}
    </group>
  );
}

/** The city far below + its tower silhouettes — environment, not items. */
function CityBelow({ a }: { a: Assets }) {
  const towers = useMemo(() => {
    const rnd = mulberry32(887);
    const list: { x: number; z: number; w: number; h: number; ry: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2 + rnd() * 0.3;
      const r = 22 + rnd() * 18;
      // heights stay well under the penthouse floor line: from the
      // seats they read as rooftops BELOW, never slabs at eye level
      list.push({ x: Math.cos(ang) * r, z: Math.sin(ang) * r, w: 5 + rnd() * 5, h: 8 + rnd() * 9, ry: rnd() * Math.PI });
    }
    return list;
  }, []);
  const dome = useMemo(() => new SphereGeometry(55, 24, 16), []);
  return (
    <group>
      <mesh material={a.city} rotation={[-Math.PI / 2, 0, 0]} position={[0, Y - 22, 0]}>
        <planeGeometry args={[190, 190]} />
      </mesh>
      {towers.map((t, i) => (
        <mesh key={i} material={a.tower} position={[t.x, Y - 22 + t.h / 2, t.z]} rotation={[0, t.ry, 0]}>
          <boxGeometry args={[t.w, t.h, t.w]} />
        </mesh>
      ))}
      <mesh geometry={dome} material={a.sky} position={[0, Y, 0]} />
    </group>
  );
}

/* ------------------------------------------------------------------ */

export default function HighRisePenthouseRoom({ fxOn }: { fxOn: boolean }) {
  const a = useMemo(buildAssets, []);
  return (
    <group>
      <EnvFog />
      <HighRiseLights fxOn={fxOn} />
      <StripShimmer a={a} fxOn={fxOn} />
      {/* polished concrete floor */}
      <mesh material={a.concrete} rotation={[-Math.PI / 2, 0, 0]} position={[0, Y, 0]} receiveShadow>
        <planeGeometry args={[11.4, 11.4]} />
      </mesh>
      {/* ceiling: single-sided, down-facing only */}
      <mesh material={a.ceil} rotation={[Math.PI / 2, 0, 0]} position={[0, Y + CEIL_H, 0]}>
        <planeGeometry args={[11.4, 11.4]} />
      </mesh>
      <GlassRun a={a} len={10.4} cx={0} cz={GLASS_N} ry={0} />
      <GlassRun a={a} len={6.6} cx={-GLASS_X} cz={-1.9} ry={Math.PI / 2} />
      <GlassRun a={a} len={6.6} cx={GLASS_X} cz={-1.9} ry={-Math.PI / 2} />
      <StoneWalls a={a} />
      <Columns a={a} />
      <LightStrips a={a} />
      <Credenza a={a} />
      <SideTable a={a} />
      <Armchairs a={a} />
      <CityBelow a={a} />
      {/* NO table here — the shared game table is the anchor. */}
    </group>
  );
}
