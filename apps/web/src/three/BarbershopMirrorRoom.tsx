import { useMemo, useRef } from 'react';
import {
  BoxGeometry, CanvasTexture, ColorManagement, CylinderGeometry, DoubleSide, Fog,
  MeshStandardMaterial, Quaternion, RepeatWrapping, SRGBColorSpace, SphereGeometry,
  TorusGeometry, Vector3, type Group,
} from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The shared table's floor plane (sibling rooms keep their own). */
const FLOOR_Y = -0.9;

/**
 * THE BARBERSHOP — story Stop 2's 3D room (Mr. Coleman & June).
 *
 * The mirror-wall barbershop, distinct from the non-story venue
 * BarbershopRoom (which stays untouched): three mirror stations
 * with dark-wood cabinets on the FAR wall (z=-4.6, behind the far
 * seat), three enamel-and-chrome barber chairs as dressing in
 * front of them, a street storefront of three window bays + a
 * glass door on the EAST wall (x=+4.6) with the barber pole
 * beside the door, a waiting bench and a brass wall fan on the
 * WEST wall (x=-4.6), and a dark door + jar shelf on the SOUTH
 * wall (z=+4.4, behind the player). Teal walls (#2f5f5a), dark
 * wainscot, worn plank floor, black leather + chrome. Warm
 * late-afternoon register. Sandbox-certified as
 * BarbershopCodeRoom (immersive code rooms, Batch 4).
 *
 * Route: ALL CODE, zero downloads, no GLB — cabinets and chairs
 * are box/cylinder/tube work, the pole is a canvas-striped
 * cylinder, the photos are sepia canvas prints (indistinct
 * shapes only — NO faces, NO text), the mirrors are aged-glass
 * material (#bcd6de, metalness .85), NOT real reflectors.
 *
 * Standing-camera discipline: the pressed-tin ceiling at
 * floor+3.55 is a SINGLE-SIDED plane facing DOWN only, so the
 * standing camera above it sees through (the Porch discipline).
 * No beams, no pendants over the table; the tallest dressing
 * hugs the walls. The room renders no table: the shared game
 * table is the anchor.
 *
 * Seat back-clearance (kit chair back = spot −0.25): far seat
 * back z=-2.23 → barber-chair footrest front z=-2.95 = 0.72 m;
 * west back x=-2.39 → bench front x=-4.05 = 1.66 m; east back
 * x=+2.39 → window wall x=4.6 = 2.21 m; player back z=+2.23 →
 * south wall z=4.4 = 2.17 m. All ≥ 0.6 m.
 *
 * Life (fxOn): the barber-pole stripes scroll slowly and the
 * wall-fan blades turn; fxOn off holds both static.
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

type G = BoxGeometry | CylinderGeometry | SphereGeometry | TorusGeometry;
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

function makeFloorTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(2211);
    ctx.fillStyle = '#503722'; ctx.fillRect(0, 0, w, h);
    const rows = 6, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      const j = (rnd() - 0.5) * 30;
      ctx.fillStyle = `rgb(${Math.round(96 + j)},${Math.round(66 + j * 0.7)},${Math.round(38 + j * 0.5)})`;
      ctx.fillRect(0, r * rh + 2, w, rh - 4);
      ctx.strokeStyle = 'rgba(40,26,14,0.5)'; ctx.lineWidth = 1.3;
      for (let gl = 0; gl < 8; gl++) {
        const gy = r * rh + 6 + rnd() * (rh - 12);
        ctx.beginPath(); ctx.moveTo(0, gy);
        ctx.bezierCurveTo(w * 0.3, gy + (rnd() - 0.5) * 6, w * 0.7, gy + (rnd() - 0.5) * 6, w, gy);
        ctx.stroke();
      }
      const jx = rnd() * w;
      ctx.fillStyle = 'rgba(24,15,8,0.8)'; ctx.fillRect(jx, r * rh + 2, 3, rh - 4);
    }
    speckle(ctx, w, h, 3200, rnd, 0.09, false);
    speckle(ctx, w, h, 1400, rnd, 0.05, true);
  }, [4, 4]);
}

function makeTealTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const rnd = mulberry32(6102);
    ctx.fillStyle = '#2f5f5a'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const x = rnd() * w;
      ctx.fillStyle = `rgba(16,34,32,${(0.04 + rnd() * 0.06).toFixed(2)})`;
      ctx.fillRect(x, rnd() * h * 0.3, 2 + rnd() * 5, 40 + rnd() * 120);
    }
    speckle(ctx, w, h, 1500, rnd, 0.06, false);
    speckle(ctx, w, h, 700, rnd, 0.04, true);
  }, [4, 2]);
}

function makePlankDarkTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(5150);
    ctx.fillStyle = '#6d4c2c'; ctx.fillRect(0, 0, w, h);
    const rows = 4, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      const j = (rnd() - 0.5) * 26;
      ctx.fillStyle = `rgb(${109 + j},${76 + j * 0.7},${44 + j * 0.5})`;
      ctx.fillRect(0, r * rh + 2, w, rh - 4);
      ctx.strokeStyle = 'rgba(46,30,16,0.55)';
      for (let gl = 0; gl < 7; gl++) {
        ctx.beginPath();
        const gy = r * rh + 6 + rnd() * (rh - 12);
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(w * 0.3, gy + (rnd() - 0.5) * 7, w * 0.7, gy + (rnd() - 0.5) * 7, w, gy);
        ctx.stroke();
      }
    }
  });
}

function makeTinTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#ece3cd'; ctx.fillRect(0, 0, w, h);
    const cell = 64;
    for (let y = 0; y < h; y += cell) for (let x = 0; x < w; x += cell) {
      ctx.strokeStyle = 'rgba(120,104,72,0.65)'; ctx.lineWidth = 3;
      ctx.strokeRect(x + 3, y + 3, cell - 6, cell - 6);
      ctx.strokeStyle = 'rgba(255,252,240,0.8)'; ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 6, y + 6, cell - 12, cell - 12);
      ctx.strokeStyle = 'rgba(120,104,72,0.45)'; ctx.lineWidth = 2;
      ctx.strokeRect(x + 13, y + 13, cell - 26, cell - 26);
      ctx.fillStyle = 'rgba(140,122,84,0.55)';
      ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,252,240,0.5)';
      ctx.beginPath(); ctx.arc(x + cell / 2 - 1.5, y + cell / 2 - 1.5, 2, 0, Math.PI * 2); ctx.fill();
    }
  }, [6, 6]);
}

function makeLeatherTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const rnd = mulberry32(8811);
    ctx.fillStyle = '#1d1a1a'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 5200, rnd, 0.10, true);
    speckle(ctx, w, h, 3800, rnd, 0.14, false);
    ctx.strokeStyle = 'rgba(210,200,190,0.06)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 9; i++) {
      const y = rnd() * h;
      ctx.beginPath(); ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * 0.3, y + 8, w * 0.6, y - 8, w, y + 3);
      ctx.stroke();
    }
  }, [2, 2]);
}

/** Sepia photo print: soft shapes only — NO faces, NO text. */
function makeSepiaTexture(seed: number) {
  return canvasTex(128, 160, (ctx, w, h) => {
    const rnd = mulberry32(seed);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#c8a068'); grad.addColorStop(0.6, '#a97c46'); grad.addColorStop(1, '#7d5830');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(70,44,20,0.5)';
    ctx.fillRect(0, h * (0.55 + rnd() * 0.1), w, h * 0.45);
    ctx.beginPath();
    const ax = w * (0.25 + rnd() * 0.4);
    ctx.ellipse(ax, h * 0.52, 16 + rnd() * 8, 30 + rnd() * 10, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(ax - 16, h * 0.52, 32, h * 0.3);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = `rgba(52,32,14,${(0.35 + rnd() * 0.25).toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(rnd() * w, h * (0.62 + rnd() * 0.2), 5 + rnd() * 6, 11 + rnd() * 8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const vig = ctx.createRadialGradient(w / 2, h / 2, 30, w / 2, h / 2, 110);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(40,22,6,0.45)');
    ctx.fillStyle = vig; ctx.fillRect(0, 0, w, h);
  });
}

/** Barber-pole stripes: diagonal red / white / blue helical bands. */
function makeStripeTexture() {
  return canvasTex(64, 128, (ctx, w, h) => {
    ctx.fillStyle = '#e8e4da'; ctx.fillRect(0, 0, w, h);
    const cols = ['#b03030', '#2a4a8a'];
    cols.forEach((col, k) => {
      ctx.fillStyle = col;
      for (let i = -2; i < 8; i++) {
        ctx.save(); ctx.translate(0, i * 32 + k * 16); ctx.transform(1, 0.5, 0, 1, 0, 0);
        ctx.fillRect(-8, 0, w + 16, 10); ctx.restore();
      }
    });
  }, [1, 2]);
}

function makeGlowSkyTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#fff3d0'); grad.addColorStop(0.55, '#ffc978'); grad.addColorStop(1, '#e88f3e');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    const sun = ctx.createRadialGradient(w * 0.62, h * 0.4, 6, w * 0.62, h * 0.4, 130);
    sun.addColorStop(0, 'rgba(255,252,235,0.9)'); sun.addColorStop(1, 'rgba(255,252,235,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h);
  });
}

/* ------------------------------------------------------------------ */
/* cached assets                                                        */
/* ------------------------------------------------------------------ */

type BarberAssets = {
  floor: MeshStandardMaterial; teal: MeshStandardMaterial; wainscot: MeshStandardMaterial;
  tin: MeshStandardMaterial; crown: MeshStandardMaterial; cabinet: MeshStandardMaterial;
  drawer: MeshStandardMaterial; counterTop: MeshStandardMaterial; mirror: MeshStandardMaterial;
  chrome: MeshStandardMaterial; enamel: MeshStandardMaterial; leather: MeshStandardMaterial;
  steelBlack: MeshStandardMaterial; frameDark: MeshStandardMaterial; winGlass: MeshStandardMaterial;
  amber: MeshStandardMaterial; greenGlass: MeshStandardMaterial; clearGlass: MeshStandardMaterial;
  ceramic: MeshStandardMaterial; brass: MeshStandardMaterial; fanDark: MeshStandardMaterial;
  towel: MeshStandardMaterial; doorMat: MeshStandardMaterial; photoFrame: MeshStandardMaterial;
  sepia: MeshStandardMaterial; sepia2: MeshStandardMaterial; silhouette: MeshStandardMaterial;
  outsideGround: MeshStandardMaterial; glowSky: MeshStandardMaterial;
};

let ASSETS: BarberAssets | null = null;
function assets(): BarberAssets {
  if (ASSETS) return ASSETS;
  ColorManagement.enabled = true;
  ASSETS = {
    floor: std({ map: makeFloorTexture(), roughness: 0.82, metalness: 0.02 }),
    teal: std({ map: makeTealTexture(), roughness: 0.94, metalness: 0 }),
    wainscot: std({ map: makePlankDarkTexture(), color: '#6e5136', roughness: 0.82, metalness: 0 }),
    tin: std({ map: makeTinTexture(), color: '#f2ead6', roughness: 0.55, metalness: 0.18 }),
    crown: std({ color: '#ddd2b8', roughness: 0.7, metalness: 0 }),
    cabinet: std({ color: '#33241a', roughness: 0.68, metalness: 0.02 }),
    drawer: std({ color: '#4c3823', roughness: 0.62, metalness: 0.02 }),
    counterTop: std({ color: '#211b16', roughness: 0.34, metalness: 0.08 }),
    mirror: std({ color: '#bcd6de', metalness: 0.85, roughness: 0.18 }),
    chrome: std({ color: '#d8dde2', metalness: 0.9, roughness: 0.25 }),
    enamel: std({ color: '#e9e6df', roughness: 0.32, metalness: 0.06 }),
    leather: std({ map: makeLeatherTexture(), roughness: 0.55, metalness: 0.02 }),
    steelBlack: std({ color: '#26282c', roughness: 0.34, metalness: 0.8 }),
    frameDark: std({ color: '#241a20', roughness: 0.5, metalness: 0.3 }),
    winGlass: std({ color: '#ffca7a', emissive: '#ff9e45', emissiveIntensity: 0.5, roughness: 0.12, metalness: 0.1, side: DoubleSide }),
    amber: std({ color: '#a8641c', roughness: 0.18, metalness: 0.05 }),
    greenGlass: std({ color: '#2e5d33', roughness: 0.18, metalness: 0.05 }),
    clearGlass: std({ color: '#cfd8d4', roughness: 0.1, metalness: 0.15 }),
    ceramic: std({ color: '#e6e1d5', roughness: 0.38, metalness: 0 }),
    brass: std({ color: '#8a6a2f', metalness: 0.85, roughness: 0.35 }),
    fanDark: std({ color: '#1c1c1e', metalness: 0.6, roughness: 0.5 }),
    towel: std({ color: '#efe9dc', roughness: 0.95, metalness: 0 }),
    doorMat: std({ color: '#26332b', roughness: 0.62, metalness: 0.04 }),
    photoFrame: std({ color: '#2a1c12', roughness: 0.6, metalness: 0.05 }),
    sepia: std({ map: makeSepiaTexture(4101), roughness: 0.85, metalness: 0 }),
    sepia2: std({ map: makeSepiaTexture(4102), roughness: 0.85, metalness: 0 }),
    silhouette: std({ color: '#3d2a1c', roughness: 1, metalness: 0 }),
    outsideGround: std({ color: '#6b5a48', roughness: 0.95, metalness: 0 }),
    glowSky: (() => { const t = makeGlowSkyTexture(); return new MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.85, roughness: 1, metalness: 0, fog: false }); })(),
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
    scene.fog = new Fog('#241a12', 14, 34);
    return () => { scene.fog = prev; };
  }, [scene]);
  return null;
}

function BarberLights({ fxOn }: { fxOn: boolean }) {
  return (
    <>
      <hemisphereLight args={['#ffdfba', '#33231a', 0.55]} />
      <directionalLight
        position={[6, 5, 2]}
        target-position={[0, -0.6, -0.5]}
        color="#ffc98a"
        intensity={1.05}
        castShadow={fxOn}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8} shadow-camera-right={8}
        shadow-camera-top={8} shadow-camera-bottom={-8}
        shadow-bias={-0.0004}
      />
      {/* afternoon key raking in from the storefront */}
      <pointLight position={[3.4, FLOOR_Y + 2.3, 0.3]} intensity={16} distance={13} decay={2} color="#ffb45e" />
      {/* soft warm fill over the table */}
      <pointLight position={[0, FLOOR_Y + 2.7, 0]} intensity={9} distance={10} decay={2} color="#ffdca8" />
      {/* a wash along the mirror wall */}
      <pointLight position={[0, FLOOR_Y + 2.0, -3.1]} intensity={5} distance={6.5} decay={2} color="#ffe9c9" />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* the four seats — the kit folding chair at owner scale (H 0.90,      */
/* seat ~0.49), at the shared table's anchors, dark panels             */
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

function FoldingChairs({ a }: { a: BarberAssets }) {
  const geos = useMemo(foldingChairGeo, []);
  const seatBack = std({ color: '#2a2724', roughness: 0.6, metalness: 0.05 });
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
/* the shell — floor, teal walls + wainscot, single-sided tin ceiling, */
/* the east storefront and the warm street beyond it. Local: floor 0.  */
/* ------------------------------------------------------------------ */

const ROOM = { x: 4.6, zFar: -4.6, zNear: 4.4, h: 3.55 };

function Shell({ a }: { a: BarberAssets }) {
  const east = useMemo(() => {
    const segs: [number, number][] = [
      [-3.925, 1.35], [-1.6, 0.7], [0.4, 0.7], [2.4375, 0.775], [4.0875, 0.625],
    ];
    const pillars = merged(segs.map(([cz, wdt]) => box(0.07, 2.3, wdt, 0, 1.6, cz)));
    const frames: G[] = [];
    for (const bz of [-2.6, -0.6, 1.4]) {
      frames.push(box(0.09, 2.3, 0.07, 0, 1.6, bz - 0.65));
      frames.push(box(0.09, 2.3, 0.07, 0, 1.6, bz + 0.65));
      frames.push(box(0.09, 0.07, 1.37, 0, 2.75, bz));
      frames.push(box(0.09, 0.07, 1.37, 0, 0.45, bz));
      frames.push(box(0.05, 2.3, 0.035, 0, 1.6, bz));
      frames.push(box(0.05, 0.035, 1.3, 0, 1.6, bz));
    }
    frames.push(box(0.09, 2.6, 0.07, 0, 1.3, 3.3 - 0.51));
    frames.push(box(0.09, 2.6, 0.07, 0, 1.3, 3.3 + 0.51));
    frames.push(box(0.09, 0.07, 1.09, 0, 2.6, 3.3));
    return { pillars, frames: merged(frames) };
  }, []);
  return (
    <group position={[0, FLOOR_Y, 0]}>
      {/* worn plank floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -0.1]} material={a.floor} receiveShadow>
        <planeGeometry args={[9.2, 9.0]} />
      </mesh>

      {/* FAR wall (mirror wall) */}
      <mesh position={[0, ROOM.h / 2, ROOM.zFar]} material={a.teal} receiveShadow>
        <planeGeometry args={[9.2, ROOM.h]} />
      </mesh>
      <mesh position={[0, 0.475, ROOM.zFar + 0.02]} material={a.wainscot} receiveShadow>
        <boxGeometry args={[9.2, 0.95, 0.04]} />
      </mesh>
      <mesh position={[0, 0.99, ROOM.zFar + 0.025]} material={a.cabinet}>
        <boxGeometry args={[9.2, 0.06, 0.05]} />
      </mesh>
      <mesh position={[0, 0.07, ROOM.zFar + 0.015]} material={a.cabinet}>
        <boxGeometry args={[9.2, 0.14, 0.03]} />
      </mesh>

      {/* WEST wall (bench wall) */}
      <mesh rotation={[0, Math.PI / 2, 0]} position={[-ROOM.x, ROOM.h / 2, -0.1]} material={a.teal} receiveShadow>
        <planeGeometry args={[9.0, ROOM.h]} />
      </mesh>
      <mesh position={[-ROOM.x + 0.02, 0.475, -0.1]} material={a.wainscot} receiveShadow>
        <boxGeometry args={[0.04, 0.95, 9.0]} />
      </mesh>
      <mesh position={[-ROOM.x + 0.025, 0.99, -0.1]} material={a.cabinet}>
        <boxGeometry args={[0.05, 0.06, 9.0]} />
      </mesh>
      <mesh position={[-ROOM.x + 0.015, 0.07, -0.1]} material={a.cabinet}>
        <boxGeometry args={[0.03, 0.14, 9.0]} />
      </mesh>

      {/* SOUTH wall (behind the player) */}
      <mesh rotation={[0, Math.PI, 0]} position={[0, ROOM.h / 2, ROOM.zNear]} material={a.teal} receiveShadow>
        <planeGeometry args={[9.2, ROOM.h]} />
      </mesh>
      <mesh position={[0, 0.475, ROOM.zNear - 0.02]} material={a.wainscot} receiveShadow>
        <boxGeometry args={[9.2, 0.95, 0.04]} />
      </mesh>
      <mesh position={[0, 0.99, ROOM.zNear - 0.025]} material={a.cabinet}>
        <boxGeometry args={[9.2, 0.06, 0.05]} />
      </mesh>
      <mesh position={[0, 0.07, ROOM.zNear - 0.015]} material={a.cabinet}>
        <boxGeometry args={[9.2, 0.14, 0.03]} />
      </mesh>

      {/* EAST wall (storefront) */}
      <mesh position={[ROOM.x - 0.03, 0.225, -0.1]} material={a.wainscot} receiveShadow>
        <boxGeometry args={[0.06, 0.45, 9.0]} />
      </mesh>
      <mesh position={[ROOM.x - 0.03, 3.15, -0.1]} material={a.teal} receiveShadow>
        <boxGeometry args={[0.06, 0.8, 9.0]} />
      </mesh>
      <mesh geometry={east.pillars} material={a.teal} position={[ROOM.x - 0.035, 0, 0]} receiveShadow />
      <mesh geometry={east.frames} material={a.frameDark} position={[ROOM.x, 0, 0]} castShadow />
      {[-2.6, -0.6, 1.4].map((bz) => (
        <mesh key={bz} rotation={[0, -Math.PI / 2, 0]} position={[ROOM.x, 1.6, bz]} material={a.winGlass}>
          <planeGeometry args={[1.3, 2.3]} />
        </mesh>
      ))}
      {/* the glass door */}
      <mesh position={[ROOM.x - 0.02, 1.3, 3.3]} material={a.frameDark} castShadow>
        <boxGeometry args={[0.05, 2.6, 0.95]} />
      </mesh>
      <mesh rotation={[0, -Math.PI / 2, 0]} position={[ROOM.x - 0.05, 1.62, 3.3]} material={a.winGlass}>
        <planeGeometry args={[0.62, 1.55]} />
      </mesh>
      <mesh position={[ROOM.x - 0.07, 1.02, 3.72]} material={a.chrome}>
        <sphereGeometry args={[0.032, 10, 8]} />
      </mesh>

      {/* outside: sidewalk, silhouettes, the afternoon glow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[7.3, -0.005, -0.1]} material={a.outsideGround} receiveShadow>
        <planeGeometry args={[5.4, 11]} />
      </mesh>
      <mesh position={[6.6, 1.6, -2.5]} material={a.silhouette}>
        <boxGeometry args={[0.9, 3.2, 1.8]} />
      </mesh>
      <mesh position={[7.5, 1.2, 0.8]} material={a.silhouette}>
        <boxGeometry args={[1.0, 2.4, 1.4]} />
      </mesh>
      <mesh position={[6.8, 1.4, 3.6]} material={a.silhouette}>
        <boxGeometry args={[0.8, 2.8, 1.2]} />
      </mesh>
      <mesh rotation={[0, -Math.PI / 2, 0]} position={[8.2, 1.9, -0.1]} material={a.glowSky}>
        <planeGeometry args={[11, 4.6]} />
      </mesh>

      {/* pressed-tin ceiling — SINGLE-SIDED, facing DOWN only.
          No beams, no pendants over the table. */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, ROOM.h, -0.1]} material={a.tin}>
        <planeGeometry args={[9.2, 9.0]} />
      </mesh>
      {/* perimeter crown ring at 3.4 */}
      <mesh position={[0, 3.42, ROOM.zFar + 0.04]} material={a.crown}>
        <boxGeometry args={[9.2, 0.15, 0.07]} />
      </mesh>
      <mesh position={[0, 3.42, ROOM.zNear - 0.04]} material={a.crown}>
        <boxGeometry args={[9.2, 0.15, 0.07]} />
      </mesh>
      <mesh position={[-ROOM.x + 0.04, 3.42, -0.1]} material={a.crown}>
        <boxGeometry args={[0.07, 0.15, 9.0]} />
      </mesh>
      <mesh position={[ROOM.x - 0.04, 3.42, -0.1]} material={a.crown}>
        <boxGeometry args={[0.07, 0.15, 9.0]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* BAR-02 — mirror stations ×3. BAR-05 dressing merged per material.   */
/* ------------------------------------------------------------------ */

const STATION_X = [-2.2, 0, 2.2];

function MirrorStations({ a }: { a: BarberAssets }) {
  const dressing = useMemo(() => {
    const amber: G[] = [], green: G[] = [], clear: G[] = [], ceramic: G[] = [], chrome: G[] = [], dark: G[] = [];
    const topY = 0.9225;
    STATION_X.forEach((sx, si) => {
      const rnd = mulberry32(7300 + si * 17);
      const bx = sx - 0.68 + rnd() * 0.1, bz = -4.38 + rnd() * 0.08;
      amber.push(cyl(0.035, 0.037, 0.14, bx, topY + 0.07, bz, 10));
      amber.push(cyl(0.012, 0.016, 0.05, bx, topY + 0.165, bz, 8));
      chrome.push(cyl(0.014, 0.014, 0.022, bx, topY + 0.20, bz, 8));
      const gx = sx - 0.42 + rnd() * 0.08, gz = -4.22 + rnd() * 0.08;
      green.push(cyl(0.030, 0.032, 0.11, gx, topY + 0.055, gz, 10));
      green.push(cyl(0.011, 0.014, 0.04, gx, topY + 0.13, gz, 8));
      chrome.push(cyl(0.013, 0.013, 0.02, gx, topY + 0.16, gz, 8));
      const cx = sx + 0.38 + rnd() * 0.08, cz = -4.36 + rnd() * 0.08;
      clear.push(cyl(0.028, 0.030, 0.09, cx, topY + 0.045, cz, 10));
      chrome.push(cyl(0.012, 0.012, 0.018, cx, topY + 0.10, cz, 8));
      const jx = sx + 0.64, jz = -4.24;
      ceramic.push(cyl(0.045, 0.04, 0.09, jx, topY + 0.045, jz, 12));
      ceramic.push(cyl(0.047, 0.047, 0.016, jx, topY + 0.098, jz, 12));
      const kx = sx + 0.05, kz = -4.30;
      dark.push(box(0.05, 0.032, 0.115, kx, topY + 0.016, kz));
      chrome.push(box(0.046, 0.014, 0.032, kx + 0.018, topY + 0.02, kz - 0.048));
    });
    return {
      amber: merged(amber), green: merged(green), clear: merged(clear),
      ceramic: merged(ceramic), chrome: merged(chrome), dark: merged(dark),
    };
  }, []);
  const cabinetGeo = useMemo(() => merged([
    box(1.9, 0.88, 0.55, 0, 0.44, 0),
    box(0.10, 0.60, 0.06, -0.99, 0.30, 0.1), box(0.10, 0.60, 0.06, 0.99, 0.30, 0.1),
  ]), []);
  const drawerGeo = useMemo(() => merged([
    box(0.56, 0.20, 0.02, -0.60, 0.64, 0.283), box(0.56, 0.20, 0.02, 0, 0.64, 0.283), box(0.56, 0.20, 0.02, 0.60, 0.64, 0.283),
    box(0.56, 0.16, 0.02, -0.60, 0.36, 0.283), box(0.56, 0.16, 0.02, 0, 0.36, 0.283), box(0.56, 0.16, 0.02, 0.60, 0.36, 0.283),
    cyl(0.016, 0.016, 0.03, -0.60, 0.64, 0.30, 8), cyl(0.016, 0.016, 0.03, 0, 0.64, 0.30, 8), cyl(0.016, 0.016, 0.03, 0.60, 0.64, 0.30, 8),
  ]), []);
  return (
    <group position={[0, FLOOR_Y, 0]}>
      {STATION_X.map((sx) => (
        <group key={sx} position={[sx, 0, -4.28]}>
          <mesh geometry={cabinetGeo} material={a.cabinet} castShadow receiveShadow />
          <mesh geometry={drawerGeo} material={a.drawer} />
          <mesh position={[0, 0.90, 0]} material={a.counterTop} castShadow receiveShadow>
            <boxGeometry args={[2.0, 0.045, 0.65]} />
          </mesh>
          <mesh position={[0, 1.675, -0.285]} material={a.cabinet}>
            <boxGeometry args={[1.62, 1.37, 0.05]} />
          </mesh>
          <mesh position={[0, 1.675, -0.255]} material={a.mirror}>
            <planeGeometry args={[1.5, 1.25]} />
          </mesh>
        </group>
      ))}
      <mesh geometry={dressing.amber} material={a.amber} castShadow />
      <mesh geometry={dressing.green} material={a.greenGlass} castShadow />
      <mesh geometry={dressing.clear} material={a.clearGlass} castShadow />
      <mesh geometry={dressing.ceramic} material={a.ceramic} castShadow />
      <mesh geometry={dressing.chrome} material={a.chrome} />
      <mesh geometry={dressing.dark} material={a.fanDark} castShadow />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* BAR-01 — barber chairs ×3 (DRESSING, not play seats). Local: floor  */
/* 0, faces +z. Footrest front edge local z +0.50 → world −2.95.       */
/* ------------------------------------------------------------------ */

function BarberChairs({ a }: { a: BarberAssets }) {
  const geos = useMemo(() => {
    const enamel = merged([
      cyl(0.275, 0.29, 0.045, 0, 0.022, 0, 22),
      cyl(0.13, 0.22, 0.09, 0, 0.085, 0, 18),
      box(0.56, 0.06, 0.52, 0, 0.465, 0),
    ]);
    const chromeParts: G[] = [
      cyl(0.045, 0.045, 0.34, 0, 0.29, 0, 14),
      tube([0, 0.34, 0.08], [0, 0.185, 0.35], 0.014),
      box(0.44, 0.025, 0.26, 0, 0.17, 0.37),
    ];
    for (const sx of [-1, 1]) {
      chromeParts.push(tube([0.33 * sx, 0.50, -0.18], [0.33 * sx, 0.72, -0.18], 0.013));
      chromeParts.push(tube([0.33 * sx, 0.72, -0.20], [0.33 * sx, 0.72, 0.22], 0.013));
    }
    const leather = merged([
      box(0.62, 0.14, 0.58, 0, 0.55, 0),
      box(0.60, 0.65, 0.13, 0, 0.99, -0.315, -0.10),
      box(0.30, 0.16, 0.08, 0, 1.40, -0.365, -0.10),
      box(0.09, 0.04, 0.40, -0.33, 0.745, 0), box(0.09, 0.04, 0.40, 0.33, 0.745, 0),
    ]);
    return { enamel, chrome: merged(chromeParts), leather };
  }, []);
  return (
    <group position={[0, FLOOR_Y, 0]}>
      {STATION_X.map((sx) => (
        <group key={sx} position={[sx, 0, -3.45]}>
          <mesh geometry={geos.enamel} material={a.enamel} castShadow receiveShadow />
          <mesh geometry={geos.chrome} material={a.chrome} castShadow />
          <mesh geometry={geos.leather} material={a.leather} castShadow receiveShadow />
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* BAR-04 — photo prints: row of 5 over the mirrors + bench cluster.   */
/* ------------------------------------------------------------------ */

function PhotoRow({ a }: { a: BarberAssets }) {
  return (
    <group position={[0, FLOOR_Y, 0]}>
      {[-3.3, -1.65, 0, 1.65, 3.3].map((px, i) => (
        <group key={px} position={[px, 2.7 + (i % 2) * 0.05 - 0.025, -4.575]}>
          <mesh material={a.photoFrame}>
            <boxGeometry args={[0.38, 0.46, 0.03]} />
          </mesh>
          <mesh position={[0, 0, 0.017]} material={i % 2 ? a.sepia2 : a.sepia}>
            <planeGeometry args={[0.34, 0.42]} />
          </mesh>
        </group>
      ))}
      <group position={[-4.575, 0, 0.6]} rotation={[0, Math.PI / 2, 0]}>
        {[[0.2, 2.02], [0.6, 2.18], [1.0, 1.98]].map(([pz, py], i) => (
          <group key={i} position={[pz! - 0.6, py!, 0]}>
            <mesh material={a.photoFrame}>
              <boxGeometry args={[0.32, 0.40, 0.03]} />
            </mesh>
            <mesh position={[0, 0, 0.017]} material={i % 2 ? a.sepia : a.sepia2}>
              <planeGeometry args={[0.28, 0.36]} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* BAR-03 — the barber pole: scrolling helical stripes when fxOn.      */
/* ------------------------------------------------------------------ */

function BarberPole({ a, fxOn }: { a: BarberAssets; fxOn: boolean }) {
  const stripeTex = useMemo(makeStripeTexture, []);
  useFrame((state) => {
    stripeTex.offset.y = fxOn ? -((state.clock.elapsedTime * 0.09) % 1) : 0;
  });
  const bracket = useMemo(() => merged([
    tube([0.155, 1.86, 0], [0, 1.86, 0], 0.014),
    tube([0.155, 1.64, 0], [0, 1.64, 0], 0.014),
    box(0.03, 0.34, 0.10, 0.155, 1.75, 0),
  ]), []);
  return (
    <group position={[4.45, FLOOR_Y, 2.55]}>
      <mesh geometry={bracket} material={a.chrome} castShadow />
      <mesh position={[0, 1.75 + 0.385, 0]} material={a.chrome}>
        <cylinderGeometry args={[0.105, 0.105, 0.07, 16]} />
      </mesh>
      <mesh position={[0, 1.75 - 0.385, 0]} material={a.chrome}>
        <cylinderGeometry args={[0.105, 0.105, 0.07, 16]} />
      </mesh>
      <mesh position={[0, 1.75 + 0.46, 0]} material={a.chrome}>
        <sphereGeometry args={[0.035, 10, 8]} />
      </mesh>
      <mesh position={[0, 1.75 - 0.46, 0]} material={a.chrome}>
        <sphereGeometry args={[0.035, 10, 8]} />
      </mesh>
      <mesh position={[0, 1.75, 0]}>
        <cylinderGeometry args={[0.085, 0.085, 0.70, 20]} />
        <meshStandardMaterial map={stripeTex} roughness={0.25} metalness={0.05} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* BAR-06 — waiting bench. BAR-07 — wall fan, blades turn when fxOn.   */
/* ------------------------------------------------------------------ */

function Bench({ a }: { a: BarberAssets }) {
  const wood = useMemo(() => merged([
    box(0.06, 0.40, 0.08, -0.18, 0.20, -0.72), box(0.06, 0.40, 0.08, -0.18, 0.20, 0.72),
    box(0.06, 0.40, 0.08, 0.18, 0.20, -0.72), box(0.06, 0.40, 0.08, 0.18, 0.20, 0.72),
    box(0.42, 0.07, 1.52, 0, 0.375, 0),
    box(0.06, 0.06, 1.64, -0.245, 1.06, 0),
    box(0.05, 0.05, 0.05, -0.245, 0.80, -0.78), box(0.05, 0.05, 0.05, -0.245, 0.80, 0.78),
  ]), []);
  return (
    <group position={[-4.3, FLOOR_Y, 0.6]}>
      <mesh geometry={wood} material={a.cabinet} castShadow receiveShadow />
      <mesh position={[0, 0.45, 0]} material={a.leather} castShadow receiveShadow>
        <boxGeometry args={[0.5, 0.09, 1.6]} />
      </mesh>
      <mesh position={[-0.245, 0.78, 0]} material={a.leather} castShadow>
        <boxGeometry args={[0.05, 0.5, 1.6]} />
      </mesh>
    </group>
  );
}

function WallFan({ a, fxOn }: { a: BarberAssets; fxOn: boolean }) {
  const blades = useRef<Group>(null);
  useFrame((state) => {
    if (blades.current) blades.current.rotation.z = fxOn ? state.clock.elapsedTime * 1.6 : 0.6;
  });
  const cage = useMemo(() => {
    const parts: G[] = [];
    const ring1 = new TorusGeometry(0.225, 0.010, 8, 28); ring1.translate(0, 0, 0.24); parts.push(ring1);
    const ring2 = new TorusGeometry(0.13, 0.007, 8, 22); ring2.translate(0, 0, 0.245); parts.push(ring2);
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      parts.push(tube([0, 0, 0.24], [Math.cos(ang) * 0.222, Math.sin(ang) * 0.222, 0.24], 0.0035));
    }
    parts.push(box(0.09, 0.13, 0.10, 0, 0, -0.03));
    return merged(parts);
  }, []);
  return (
    <group position={[-4.52, FLOOR_Y + 2.5, -1.6]} rotation={[0, Math.PI / 2, 0]}>
      <mesh geometry={cage} material={a.fanDark} castShadow />
      <mesh position={[0, 0, 0.08]} rotation={[Math.PI / 2, 0, 0]} material={a.brass}>
        <cylinderGeometry args={[0.05, 0.055, 0.17, 14]} />
      </mesh>
      <mesh position={[0, 0, 0.185]} material={a.brass}>
        <sphereGeometry args={[0.032, 10, 8]} />
      </mesh>
      <group ref={blades} position={[0, 0, 0.20]}>
        {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((ang) => (
          <group key={ang} rotation={[0, 0, ang]}>
            <mesh position={[0.115, 0, 0]} rotation={[0.5, 0, 0]} material={a.fanDark} castShadow>
              <boxGeometry args={[0.16, 0.095, 0.012]} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* BAR-08 — towel shelf + folded towels. South door + jar shelf.       */
/* ------------------------------------------------------------------ */

function TowelShelf({ a }: { a: BarberAssets }) {
  const towels = useMemo(() => {
    const parts: G[] = [];
    for (const [cx, cz, n] of [[-3.82, -4.42, 3], [-3.42, -4.42, 2]] as [number, number, number][]) {
      for (let i = 0; i < n; i++) {
        parts.push(box(0.30 - i * 0.012, 0.05, 0.24, cx + (i % 2) * 0.006, 1.945 + i * 0.052, cz));
      }
    }
    return merged(parts);
  }, []);
  const shelfWood = useMemo(() => merged([
    box(0.9, 0.04, 0.35, -3.6, 1.90, -4.42),
    box(0.04, 0.14, 0.26, -3.95, 1.81, -4.44), box(0.04, 0.14, 0.26, -3.25, 1.81, -4.44),
  ]), []);
  return (
    <group position={[0, FLOOR_Y, 0]}>
      <mesh geometry={shelfWood} material={a.cabinet} castShadow />
      <mesh geometry={towels} material={a.towel} castShadow receiveShadow />
    </group>
  );
}

function SouthDressing({ a }: { a: BarberAssets }) {
  const jars = useMemo(() => {
    const ceramicP: G[] = [], amberP: G[] = [], clearP: G[] = [];
    const tops = 1.545;
    ceramicP.push(cyl(0.042, 0.038, 0.11, 1.52, tops + 0.055, 4.24, 10));
    amberP.push(cyl(0.036, 0.038, 0.13, 1.78, tops + 0.065, 4.26, 10));
    clearP.push(cyl(0.033, 0.035, 0.10, 2.02, tops + 0.05, 4.22, 10));
    ceramicP.push(cyl(0.046, 0.042, 0.09, 2.24, tops + 0.045, 4.25, 10));
    return { ceramic: merged(ceramicP), amber: merged(amberP), clear: merged(clearP) };
  }, []);
  return (
    <group position={[0, FLOOR_Y, 0]}>
      {/* the dark back door */}
      <mesh position={[-1.6, 1.10, 4.385]} material={a.cabinet}>
        <boxGeometry args={[1.03, 2.24, 0.05]} />
      </mesh>
      <mesh position={[-1.6, 1.075, 4.355]} material={a.doorMat} castShadow>
        <boxGeometry args={[0.95, 2.15, 0.05]} />
      </mesh>
      <mesh position={[-1.6, 1.55, 4.325]} material={a.doorMat}>
        <boxGeometry args={[0.68, 0.78, 0.02]} />
      </mesh>
      <mesh position={[-1.6, 0.62, 4.325]} material={a.doorMat}>
        <boxGeometry args={[0.68, 0.62, 0.02]} />
      </mesh>
      <mesh position={[-1.22, 1.02, 4.31]} material={a.chrome}>
        <sphereGeometry args={[0.033, 10, 8]} />
      </mesh>
      {/* the jar shelf */}
      <mesh position={[1.8, 1.50, 4.24]} material={a.cabinet} castShadow>
        <boxGeometry args={[1.1, 0.04, 0.28]} />
      </mesh>
      <mesh position={[1.42, 1.42, 4.28]} material={a.cabinet}>
        <boxGeometry args={[0.04, 0.12, 0.2]} />
      </mesh>
      <mesh position={[2.18, 1.42, 4.28]} material={a.cabinet}>
        <boxGeometry args={[0.04, 0.12, 0.2]} />
      </mesh>
      <mesh geometry={jars.ceramic} material={a.ceramic} castShadow />
      <mesh geometry={jars.amber} material={a.amber} castShadow />
      <mesh geometry={jars.clear} material={a.clearGlass} castShadow />
    </group>
  );
}

/* ------------------------------------------------------------------ */

export default function BarbershopMirrorRoom({ fxOn }: { fxOn: boolean }) {
  const a = assets();
  return (
    <group>
      <EnvFog />
      <BarberLights fxOn={fxOn} />
      <FoldingChairs a={a} />
      <Shell a={a} />
      <MirrorStations a={a} />
      <BarberChairs a={a} />
      <PhotoRow a={a} />
      <BarberPole a={a} fxOn={fxOn} />
      <Bench a={a} />
      <WallFan a={a} fxOn={fxOn} />
      <TowelShelf a={a} />
      <SouthDressing a={a} />
    </group>
  );
}
