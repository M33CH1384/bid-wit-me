import { useEffect, useMemo } from 'react';
import {
  BoxGeometry, CanvasTexture, CylinderGeometry, Fog, MeshStandardMaterial,
  Quaternion, RepeatWrapping, SRGBColorSpace, SphereGeometry, TubeGeometry, Vector3,
} from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHAIR_SPOTS } from './classicStudioLayout';

/** The shared table's floor plane (sibling rooms keep their own). */
const FLOOR_Y = -0.9;

/**
 * THE LEGENDS' TABLE — story Stop 10's 3D room (Queenie & Ace).
 *
 * Mounted by Scene only for a story table carrying stop
 * `legends` at High quality; every other vegas table — and Low
 * quality everywhere — keeps the shipped VegasRoom (the cube
 * room), untouched (pinned in test/legends-room.test.ts).
 * Sandbox-certified (LegendsCodeRoom in the immersive sandbox,
 * Batch 6b): a wood-panelled private room — walls dense with
 * framed black-and-white sports photographs (LEG-03), trophy
 * cups on a built-in shelf (LEG-05), a mahogany bookshelf of
 * cloth-bound books (LEG-06), aged-brass chandeliers (LEG-04)
 * and wall sconces (LEG-07), deep-green velvet curtains
 * (LEG-08), a parquet-block walnut floor, and the brown
 * leather dining chairs (LEG-02) — four at the seat spots,
 * four more dressing the rail: two at the LEG-01 oval display
 * table in the NW corner, two flanking the trophy shelf.
 * LEG-01 stands as a SIDE DISPLAY piece per its manifest
 * classification — never under or around the shared game
 * table, which remains the only gameplay surface. The
 * register is the stop's own: warm wood, brass and baize,
 * hushed and honoured — glamour as this room's identity, NOT
 * the ESPN broadcast chrome of the professional chapter.
 *
 * Route: ALL CODE, zero downloads — panelled walls, frames,
 * trophies, books and brasswork are frame-and-panel / lathe /
 * tube construction; nothing here is a proven code-fails
 * class.
 *
 * Named deviation: the floor is parquet-block, not the
 * manifest's herringbone — a canvas herringbone at this scale
 * read as a woven maze in the certification frames; parquet
 * block is the same traditional warm-wood register and reads
 * true (see makeParquetTexture).
 *
 * Standing-camera discipline (gate added 2026-10-28): the
 * ceiling is ONE single-sided plane at floor + 3.20 facing
 * down only (culled from the standing camera above it); the
 * chandeliers hang at (±2.60, −3.80) — behind the far seat,
 * off the table axis, over NO part of the felt (half-extents
 * 1.50 × 1.78) — so nothing the room adds crosses the
 * player's cards or the table view (production standing
 * frames: felt visible edge to edge); sconces and frames
 * dress the walls at the frame's edges.
 *
 * Seat back-clearances (LEG-02 chair back = 0.30 m behind
 * the CHAIR_SPOTS origin): far seat (0, −2.45) back at
 * z −2.75 → gallery frame front −4.84 (wall −4.90) = 2.09 m;
 * player (0, +2.80) back at z +3.10 → south wall +5.20 =
 * 2.10 m; west (−2.30, 0) back at x −2.60 → curtain face
 * −5.15 = 2.55 m; east (+2.30, 0) back at x +2.60 →
 * bookshelf front +5.02 = 2.42 m. The display table's
 * nearest edge point ≈ (−3.76, −2.75) stands ≈ 2.98 m from
 * the west seat's back point. All ≥ 0.6 m, open parquet
 * floor behind every chair back.
 *
 * HARD EXCLUSIONS (manifest): no casino chrome — no slot
 * machines, no neon, no chips as room dressing; no readable
 * photo captions or trophy engravings (prints are indistinct
 * B&W figure studies, plaques blank); no text anywhere.
 *
 * Effects: `fxOn` (= !reduceFx at this table) gates the
 * chandelier bulb shimmer and the directional's shadows.
 * Effects off = the same room, one static frame. The room
 * renders no table of its own: the shared game table is the
 * anchor.
 */

/* ------------------------------------------------------------------ */
/* Layout constants — the standing + clearance discipline lives here.  */
/* ------------------------------------------------------------------ */

/** Wall inner faces: north −WALL_N, south +WALL_S, sides ±WALL_X. */
const WALL_N = 4.9;
const WALL_S = 5.2;
const WALL_X = 5.4;
/** Photo frames stand proud of the north wall to this face. */
const FRAME_FACE = 4.84;
/** Ceiling height above the floor (single-sided, down-facing). */
const CEIL_H = 3.2;
/** Bookshelf front face (east wall). */
const SHELF_FRONT = 5.02;
/** Curtain face (west wall, pleats included). */
const CURTAIN_FACE = 5.15;
/** LEG-02 chair back extent behind the seat-spot origin. */
const CHAIR_BACK = 0.3;
/** Chandelier positions — behind the far seat, off-axis, over no felt. */
const CHANDELIER_POS: [number, number][] = [[-2.6, -3.8], [2.6, -3.8]];

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

type MatOpts = {
  color?: string; map?: CanvasTexture; roughness: number; metalness: number;
  emissive?: string; emissiveMap?: CanvasTexture; emissiveIntensity?: number;
  side?: MeshStandardMaterial['side'];
};
function std(o: MatOpts) {
  return new MeshStandardMaterial({
    color: o.color ?? '#ffffff', map: o.map ?? null,
    roughness: o.roughness, metalness: o.metalness,
    emissive: o.emissive ?? '#000000', emissiveMap: o.emissiveMap ?? null,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    ...(o.side ? { side: o.side } : {}),
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

/**
 * Parquet-block wood floor: squares of five parallel walnut
 * planks, direction alternating block to block. (Named
 * deviation: the manifest says herringbone, but a canvas
 * herringbone at this scale read as a woven maze in the gate
 * frames; parquet block is the same traditional warm-wood
 * register and reads true. Recorded in the batch report.)
 */
function makeParquetTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(1013);
    ctx.fillStyle = '#241505'; ctx.fillRect(0, 0, w, h);
    const B = 128, P = B / 5;
    for (let by = 0; by < h / B; by++) for (let bx = 0; bx < w / B; bx++) {
      const horiz = (bx + by) % 2 === 0;
      for (let i = 0; i < 5; i++) {
        const tone = 0.78 + rnd() * 0.4;
        ctx.fillStyle = `rgb(${Math.floor(82 * tone)},${Math.floor(52 * tone)},${Math.floor(28 * tone)})`;
        const px = bx * B + (horiz ? 0 : i * P), py = by * B + (horiz ? i * P : 0);
        const pw = horiz ? B : P, ph = horiz ? P : B;
        ctx.fillRect(px + 1, py + 1, pw - 2, ph - 2);
        ctx.strokeStyle = 'rgba(30,16,4,0.35)'; ctx.lineWidth = 1;
        for (let gLine = 0; gLine < 3; gLine++) {
          ctx.beginPath();
          if (horiz) { const gy = py + 5 + rnd() * (P - 10); ctx.moveTo(px + 3, gy); ctx.lineTo(px + pw - 3, gy + (rnd() - 0.5) * 3); }
          else { const gx = px + 5 + rnd() * (P - 10); ctx.moveTo(gx, py + 3); ctx.lineTo(gx + (rnd() - 0.5) * 3, py + ph - 3); }
          ctx.stroke();
        }
      }
      ctx.strokeStyle = 'rgba(10,5,1,0.8)'; ctx.lineWidth = 2; ctx.strokeRect(bx * B + 1, by * B + 1, B - 2, B - 2);
    }
  }, [4, 4]);
}

/** Dark wood wall panelling: stiles, rails, panel mouldings. */
function makePanelTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(1021);
    ctx.fillStyle = '#2e1c0e'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * w;
      ctx.strokeStyle = `rgba(${10 + rnd() * 30},${6 + rnd() * 16},2,0.25)`;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (rnd() - 0.5) * 6, h); ctx.stroke();
    }
    const panel = (x: number, y: number, pw: number, ph: number) => {
      ctx.strokeStyle = 'rgba(214,164,96,0.30)'; ctx.lineWidth = 5; ctx.strokeRect(x, y, pw, ph);
      ctx.strokeStyle = 'rgba(8,4,1,0.75)'; ctx.lineWidth = 2; ctx.strokeRect(x + 6, y + 6, pw - 12, ph - 12);
    };
    panel(28, 30, 200, 300); panel(284, 30, 200, 300);
    panel(28, 368, 200, 114); panel(284, 368, 200, 114);
    ctx.fillStyle = 'rgba(214,164,96,0.20)'; ctx.fillRect(0, 344, w, 5);
  }, [3, 1]);
}

/**
 * A black-and-white sports print: indistinct figure study —
 * tonal masses with photographic blur, NO faces, NO captions.
 */
function makePrintTexture(seed: number) {
  return canvasTex(256, 320, (ctx, w, h) => {
    const rnd = mulberry32(seed);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#98968f'); g.addColorStop(0.55, '#76736c'); g.addColorStop(1, '#55534e');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) {
      const v = 70 + Math.floor(rnd() * 80);
      ctx.fillStyle = `rgba(${v},${v},${v - 4},0.35)`;
      ctx.fillRect(rnd() * w, rnd() * h * 0.42, 2.2, 2.2);
    }
    ctx.fillStyle = 'rgba(230,228,220,0.07)';
    for (let i = 0; i < 7; i++) ctx.fillRect(0, h * (0.3 + rnd() * 0.45), w, 3 + rnd() * 7);
    const cx = w * (0.38 + rnd() * 0.18), cy = h * 0.54, lean = (rnd() - 0.5) * 0.35;
    const drawFigure = (dx: number, dy: number, style: string, blur: number) => {
      ctx.save(); ctx.translate(cx + dx, cy + dy); ctx.rotate(lean);
      ctx.shadowColor = style; ctx.shadowBlur = blur;
      ctx.fillStyle = style; ctx.strokeStyle = style; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.ellipse(0, -30, 17, 27, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(3, -68, 10, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 16;
      ctx.beginPath(); ctx.moveTo(-2, -12); ctx.lineTo(-26, 34); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(2, -12); ctx.lineTo(30, 22); ctx.stroke();
      ctx.lineWidth = 13;
      ctx.beginPath(); ctx.moveTo(-4, -44); ctx.lineTo(-30, -58); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(5, -44); ctx.lineTo(32, -30); ctx.stroke();
      ctx.restore();
    };
    drawFigure(-3, -3, 'rgba(215,212,205,0.30)', 12);
    drawFigure(0, 0, 'rgba(22,22,25,0.92)', 9);
    for (let i = 0; i < 1100; i++) {
      const v = Math.floor(rnd() * 255);
      ctx.fillStyle = `rgba(${v},${v},${v},0.05)`;
      ctx.fillRect(rnd() * w, rnd() * h, 1.4, 1.4);
    }
    const v = ctx.createRadialGradient(w / 2, h / 2, 60, w / 2, h / 2, 240);
    v.addColorStop(0, 'rgba(60,40,16,0)'); v.addColorStop(1, 'rgba(60,40,16,0.38)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
  });
}

/** Cloth book spines: muted colours, NO titles. */
function makeBooksTexture(seed: number) {
  return canvasTex(512, 256, (ctx, w, h) => {
    const rnd = mulberry32(seed);
    const cols = ['#5a2e22', '#31402c', '#26324a', '#57451f', '#402a3c', '#6b3a1e', '#1f3038', '#713f28'];
    let x = 4;
    while (x < w - 12) {
      const bw = 13 + rnd() * 16;
      ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
      ctx.fillRect(x, 8 + rnd() * 10, bw, h - 22);
      ctx.fillStyle = 'rgba(226,196,130,0.55)';
      ctx.fillRect(x + 2, 26, bw - 4, 2); ctx.fillRect(x + 2, h - 34, bw - 4, 2);
      x += bw + 2.5;
    }
  }, [1, 1]);
}

/** Deep-green velvet: vertical fold shading. */
function makeVelvetTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    for (let x = 0; x < w; x++) {
      const s = 0.55 + 0.45 * Math.abs(Math.sin((x / w) * Math.PI * 7));
      ctx.fillStyle = `rgb(${Math.floor(16 * s + 6)},${Math.floor(52 * s + 12)},${Math.floor(34 * s + 8)})`;
      ctx.fillRect(x, 0, 1, h);
    }
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0.25)'); g.addColorStop(0.4, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, [2, 1]);
}

/* ------------------------------------------------------------------ */
/* assets                                                              */
/* ------------------------------------------------------------------ */

type Assets = ReturnType<typeof buildAssets>;
function buildAssets() {
  const prints = [101, 202, 303, 404, 505, 606, 707, 808, 909].map((s) => std({ map: makePrintTexture(s), roughness: 0.85, metalness: 0 }));
  return {
    floor: std({ map: makeParquetTexture(), roughness: 0.5, metalness: 0.04 }),
    panel: std({ map: makePanelTexture(), roughness: 0.72, metalness: 0.03 }),
    ceil: std({ color: '#1d1108', roughness: 0.95, metalness: 0 }),
    darkWood: std({ color: '#33200f', roughness: 0.6, metalness: 0.05 }),
    frameWood: std({ color: '#241505', roughness: 0.5, metalness: 0.08 }),
    brass: std({ color: '#a87f36', emissive: '#3a2708', emissiveIntensity: 0.35, roughness: 0.32, metalness: 0.9 }),
    brassDim: std({ color: '#7d5f2a', roughness: 0.45, metalness: 0.85 }),
    leather: std({ color: '#4c2c15', roughness: 0.62, metalness: 0.04 }),
    mahogany: std({ color: '#2c1708', roughness: 0.55, metalness: 0.05 }),
    booksA: std({ map: makeBooksTexture(111), roughness: 0.85, metalness: 0 }),
    booksB: std({ map: makeBooksTexture(222), roughness: 0.85, metalness: 0 }),
    velvet: std({ map: makeVelvetTexture(), roughness: 0.94, metalness: 0 }),
    bulb: std({ color: '#ffd9a0', emissive: '#ffc978', emissiveIntensity: 2.6, roughness: 0.35, metalness: 0 }),
    shade: std({ color: '#f3e2c2', emissive: '#ffce8a', emissiveIntensity: 0.85, roughness: 0.6, metalness: 0 }),
    feltGreen: std({ color: '#1d4030', roughness: 0.95, metalness: 0 }),
    mat: std({ color: '#ddd6c4', roughness: 0.9, metalness: 0 }),
    prints,
  };
}

/* ------------------------------------------------------------------ */
/* fog + lights                                                        */
/* ------------------------------------------------------------------ */

function EnvFog() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const prev = scene.fog;
    scene.fog = new Fog('#160d0a', 12, 30);
    return () => { scene.fog = prev; };
  }, [scene]);
  return null;
}

function LegendsLights({ fxOn }: { fxOn: boolean }) {
  return (
    <>
      <hemisphereLight args={['#e8c9a0', '#2a180b', 0.85]} />
      <directionalLight
        position={[1.5, 5.5, -3]}
        color="#ffd9a8"
        intensity={0.85}
        castShadow={fxOn}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8} shadow-camera-right={8}
        shadow-camera-top={8} shadow-camera-bottom={-8}
      />
      {CHANDELIER_POS.map(([x, z], i) => (
        <pointLight key={i} position={[x, Y + 2.35, z]} color="#ffc98a" intensity={9} distance={9} decay={1.7} />
      ))}
      <pointLight position={[0, Y + 2.2, 0.6]} color="#ffbe78" intensity={5} distance={8} decay={1.8} />
      {/* a low warm kiss on the trophy shelf + bookshelf */}
      <pointLight position={[4.5, Y + 2.0, -2.6]} color="#ffc98a" intensity={3.5} distance={5.5} decay={1.8} />
    </>
  );
}

/** Warm shimmer on the chandelier bulbs, fx-gated. */
function BulbShimmer({ a, fxOn }: { a: Assets; fxOn: boolean }) {
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    a.bulb.emissiveIntensity = fxOn ? 2.6 + Math.sin(t * 0.9) * 0.10 + Math.sin(t * 2.7) * 0.05 : 2.6;
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* builders                                                            */
/* ------------------------------------------------------------------ */

/** Panelled walls on all four sides + the single-sided ceiling. */
function Shell({ a }: { a: Assets }) {
  return (
    <group>
      <mesh material={a.panel} position={[0, Y + CEIL_H / 2, -WALL_N - 0.04]}>
        <boxGeometry args={[WALL_X * 2 + 0.3, CEIL_H, 0.08]} />
      </mesh>
      <mesh material={a.panel} position={[0, Y + CEIL_H / 2, WALL_S + 0.04]}>
        <boxGeometry args={[WALL_X * 2 + 0.3, CEIL_H, 0.08]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} material={a.panel} position={[s * (WALL_X + 0.04), Y + CEIL_H / 2, (WALL_S - WALL_N) / 2]}>
          <boxGeometry args={[0.08, CEIL_H, WALL_S + WALL_N]} />
        </mesh>
      ))}
      <mesh material={a.ceil} rotation={[Math.PI / 2, 0, 0]} position={[0, Y + CEIL_H, 0]}>
        <planeGeometry args={[WALL_X * 2 + 0.3, WALL_S + WALL_N + 0.3]} />
      </mesh>
      {[[0, -WALL_N + 0.03], [0, WALL_S - 0.03]].map(([x, z], i) => (
        <mesh key={i} material={a.darkWood} position={[x, Y + 0.09, z]}>
          <boxGeometry args={[WALL_X * 2, 0.18, 0.05]} />
        </mesh>
      ))}
    </group>
  );
}

/** LEG-03: the framed photo gallery — six prints in two rows on the north wall, two large flanks, one south accent. */
function Gallery({ a }: { a: Assets }) {
  const spots: { x: number; y: number; w: number; h: number; p: number }[] = [];
  const rnd = mulberry32(4242);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
    spots.push({ x: -1.55 + c * 1.55, y: 1.98 - r * 1.06, w: 0.78, h: 0.94, p: Math.floor(rnd() * 9) });
  }
  spots.push({ x: -3.6, y: 1.55, w: 0.95, h: 1.18, p: 3 });
  spots.push({ x: 3.6, y: 1.55, w: 0.95, h: 1.18, p: 6 });
  spots.push({ x: 0, y: 1.62, w: 0.7, h: 0.86, p: 1 });
  return (
    <group>
      {spots.map((s, i) => {
        const south = i === spots.length - 1;
        const z = south ? WALL_S - 0.035 : -4.865;
        return (
          <group key={i} position={[s.x, Y + s.y, z]} rotation={[0, south ? Math.PI : 0, 0]}>
            <mesh material={a.frameWood}>
              <boxGeometry args={[s.w + 0.09, s.h + 0.09, 0.05]} />
            </mesh>
            <mesh material={a.mat} position={[0, 0, 0.028]}>
              <boxGeometry args={[s.w + 0.02, s.h + 0.02, 0.012]} />
            </mesh>
            <mesh material={a.prints[s.p]} position={[0, 0, 0.036]}>
              <boxGeometry args={[s.w - 0.08, s.h - 0.08, 0.006]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** LEG-04 chandeliers at CHANDELIER_POS — brass ring, six candle bulbs each. */
function Chandeliers({ a }: { a: Assets }) {
  const parts = useMemo(() => {
    const arr: G[] = [];
    arr.push(cyl(0.016, 0.016, 0.5, 0, 0.25, 0, 8));
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const x = Math.cos(ang) * 0.34, z = Math.sin(ang) * 0.34;
      arr.push(tube([0, 0, 0], [x, -0.10, z], 0.012));
      arr.push(cyl(0.014, 0.02, 0.10, x, -0.04, z, 8));
    }
    return merged(arr);
  }, []);
  const ring = useMemo(() => cyl(0.40, 0.40, 0.035, 0, -0.13, 0, 28), []);
  return (
    <group>
      {CHANDELIER_POS.map(([x, z], i) => (
        <group key={i} position={[x, Y + CEIL_H - 0.52, z]}>
          <mesh geometry={parts} material={a.brassDim} />
          <mesh geometry={ring} material={a.brass} />
          {Array.from({ length: 6 }, (_, k) => {
            const ang = (k / 6) * Math.PI * 2;
            return (
              <mesh key={k} material={a.bulb} position={[Math.cos(ang) * 0.34, 0.03, Math.sin(ang) * 0.34]}>
                <sphereGeometry args={[0.026, 10, 8]} />
              </mesh>
            );
          })}
        </group>
      ))}
    </group>
  );
}

/** LEG-07 sconces: brass arm + frosted shade, on the side and south walls. */
function Sconces({ a }: { a: Assets }) {
  const spots: { x: number; z: number; ry: number }[] = [
    { x: -WALL_X + 0.07, z: -3.3, ry: Math.PI / 2 }, { x: -WALL_X + 0.07, z: 1.8, ry: Math.PI / 2 },
    { x: WALL_X - 0.07, z: -2.2, ry: -Math.PI / 2 }, { x: WALL_X - 0.07, z: 1.8, ry: -Math.PI / 2 },
    { x: -3.4, z: WALL_S - 0.07, ry: Math.PI }, { x: 3.4, z: WALL_S - 0.07, ry: Math.PI },
  ];
  return (
    <group>
      {spots.map((s, i) => (
        <group key={i} position={[s.x, Y + 1.95, s.z]} rotation={[0, s.ry, 0]}>
          <mesh material={a.brassDim}>
            <boxGeometry args={[0.05, 0.2, 0.04]} />
          </mesh>
          <mesh material={a.brass} position={[0, 0.02, 0.07]}>
            <cylinderGeometry args={[0.012, 0.012, 0.14, 8]} />
          </mesh>
          <mesh material={a.shade} position={[0, 0.10, 0.13]}>
            <sphereGeometry args={[0.055, 12, 10]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** LEG-06 bookshelf (east wall) with cloth-bound books, no titles. */
function Bookshelf({ a }: { a: Assets }) {
  const frame = useMemo(() => merged([
    box(0.32, 1.9, 0.06, 0, 0.95, -0.57), box(0.32, 1.9, 0.06, 0, 0.95, 0.57),
    box(0.32, 0.06, 1.2, 0, 1.87, 0), box(0.32, 0.06, 1.2, 0, 0.05, 0),
    box(0.32, 0.05, 1.2, 0, 0.68, 0), box(0.32, 0.05, 1.2, 0, 1.28, 0),
    box(0.03, 1.9, 1.2, -0.155, 0.95, 0),
  ]), []);
  return (
    <group position={[SHELF_FRONT + 0.19, Y, -1.1]} rotation={[0, Math.PI, 0]}>
      <mesh geometry={frame} material={a.mahogany} castShadow />
      {[0.36, 0.99, 1.58].map((y, i) => (
        <mesh key={i} material={i % 2 ? a.booksA : a.booksB} position={[0.01, y, 0]}>
          <boxGeometry args={[0.24, 0.52, 1.08]} />
        </mesh>
      ))}
    </group>
  );
}

/** LEG-05 trophy cups ×3 on their shelf (east wall, north end), blank plaques. */
function TrophyShelf({ a }: { a: Assets }) {
  const cup = useMemo(() => {
    const parts: G[] = [];
    parts.push(cyl(0.085, 0.05, 0.16, 0, 0.20, 0, 16));
    parts.push(cyl(0.018, 0.018, 0.09, 0, 0.075, 0, 10));
    parts.push(box(0.15, 0.045, 0.15, 0, 0.022, 0));
    parts.push(tube([-0.085, 0.22, 0], [-0.125, 0.13, 0], 0.011));
    parts.push(tube([0.085, 0.22, 0], [0.125, 0.13, 0], 0.011));
    return merged(parts);
  }, []);
  const scales = [1.15, 1.5, 0.95];
  return (
    <group position={[WALL_X - 0.16, Y, -3.55]}>
      <mesh material={a.mahogany} position={[0, 1.32, 0]}>
        <boxGeometry args={[0.3, 0.05, 1.1]} />
      </mesh>
      {scales.map((s, i) => (
        <mesh key={i} geometry={cup} material={a.brass} scale={[s, s, s]} position={[0, 1.345, -0.34 + i * 0.34]} castShadow />
      ))}
    </group>
  );
}

/** LEG-08 velvet curtain pair on the west wall (pleated half-rounds + texture). */
function Curtains({ a }: { a: Assets }) {
  const pleats = useMemo(() => {
    const parts: G[] = [];
    for (let i = 0; i < 9; i++) {
      parts.push(cyl(0.085, 0.095, 2.4, 0, 1.2, -0.68 + i * 0.17, 10));
    }
    parts.push(box(0.1, 0.14, 1.65, -0.03, 2.46, 0));
    return merged(parts);
  }, []);
  return (
    <group>
      {[-1.55, 2.6].map((z, i) => (
        <mesh key={i} geometry={pleats} material={a.velvet} position={[-5.24, Y, z]} />
      ))}
    </group>
  );
}

/**
 * LEG-02 leather dining chairs. Local: floor y = 0, faces +z;
 * seat top ≈ 0.50, back top 0.95, back rearmost −0.30
 * (CHAIR_BACK). Four at the seat spots; four rail chairs
 * dress the room.
 */
function LeatherChairs({ a }: { a: Assets }) {
  const wood = useMemo(() => {
    const parts: G[] = [];
    for (const sx of [-1, 1]) {
      parts.push(box(0.045, 0.46, 0.045, 0.235 * sx, 0.23, 0.235));
      parts.push(box(0.045, 0.95, 0.045, 0.235 * sx, 0.475, -0.255));
    }
    parts.push(box(0.52, 0.05, 0.05, 0, 0.925, -0.255));
    parts.push(box(0.52, 0.04, 0.52, 0, 0.435, 0));
    parts.push(box(0.47, 0.03, 0.04, 0, 0.14, 0.235));
    return merged(parts);
  }, []);
  const leather = useMemo(() => merged([
    box(0.48, 0.055, 0.48, 0, 0.475, 0),
    box(0.47, 0.44, 0.05, 0, 0.72, -0.238, -0.06),
  ]), []);
  const studs = useMemo(() => {
    const parts: G[] = [];
    for (let i = 0; i < 7; i++) parts.push(cyl(0.008, 0.008, 0.006, -0.20 + i * 0.066, 0.90, -0.208, 6));
    return merged(parts);
  }, []);
  const rail: { x: number; z: number; ry: number }[] = [
    { x: -4.15, z: -2.55, ry: 2.5 }, { x: -3.35, z: -4.15, ry: 0.7 },
    { x: 4.55, z: -2.45, ry: -Math.PI / 2 }, { x: 4.55, z: -4.6, ry: -Math.PI / 2 },
  ];
  return (
    <group>
      {[...CHAIR_SPOTS, ...rail].map((s, i) => (
        <group key={i} position={[s.x, Y, s.z]} rotation={[0, s.ry, 0]}>
          <mesh geometry={wood} material={a.darkWood} castShadow />
          <mesh geometry={leather} material={a.leather} />
          <mesh geometry={studs} material={a.brass} />
        </group>
      ))}
    </group>
  );
}

/** LEG-01 as a side display piece: small oval table, NW corner. */
function DisplayTable({ a }: { a: Assets }) {
  const top = useMemo(() => cyl(0.92, 0.92, 0.05, 0, 0.74, 0, 28), []);
  const base = useMemo(() => merged([
    cyl(0.09, 0.13, 0.62, 0, 0.36, 0, 12),
    cyl(0.34, 0.38, 0.06, 0, 0.03, 0, 20),
    box(1.78, 0.07, 0.98, 0, 0.70, 0),
  ]), []);
  return (
    <group position={[-4.05, Y, -3.45]} rotation={[0, 0.5, 0]}>
      <mesh geometry={top} material={a.feltGreen} scale={[1, 1, 0.55]} castShadow />
      <mesh geometry={base} material={a.darkWood} />
      <mesh material={a.darkWood} position={[0, 0.775, 0]} scale={[1, 1, 0.55]}>
        <cylinderGeometry args={[0.97, 0.97, 0.045, 28]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */

export default function LegendsTableRoom({ fxOn }: { fxOn: boolean }) {
  const a = useMemo(buildAssets, []);
  return (
    <group>
      <EnvFog />
      <LegendsLights fxOn={fxOn} />
      <BulbShimmer a={a} fxOn={fxOn} />
      <mesh material={a.floor} rotation={[-Math.PI / 2, 0, 0]} position={[0.25, Y, 0.15]} receiveShadow>
        <planeGeometry args={[WALL_X * 2 + 0.2, WALL_S + WALL_N + 0.2]} />
      </mesh>
      <Shell a={a} />
      <Gallery a={a} />
      <Chandeliers a={a} />
      <Sconces a={a} />
      <Bookshelf a={a} />
      <TrophyShelf a={a} />
      <Curtains a={a} />
      <DisplayTable a={a} />
      <LeatherChairs a={a} />
      {/* NO table of its own here — the shared game table is the anchor. */}
    </group>
  );
}
