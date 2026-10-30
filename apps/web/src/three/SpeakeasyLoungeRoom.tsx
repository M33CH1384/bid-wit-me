import { useEffect, useMemo } from 'react';
import {
  AdditiveBlending, BoxGeometry, CanvasTexture, ColorManagement, CylinderGeometry,
  MeshStandardMaterial, Quaternion, RepeatWrapping, SphereGeometry, SRGBColorSpace,
  Vector3,
} from 'three';
import { useFrame } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The shared table's floor plane (sibling rooms keep their own). */
const FLOOR_Y = -0.9;

/**
 * THE SPEAKEASY LOUNGE — the speakeasy venue's own 3D room for
 * REGULAR tables (venues rollout Batch C1, 2026-10-28: "Now all
 * the other venues need to be updated the same way").
 *
 * Mounted by Scene for every NON-STORY speakeasy table at High
 * quality. The story branch keeps priority: a table carrying
 * stop `corner` mounts the Corner street (CornerStreetRoom)
 * exactly as before — the Corner is a different place, outdoors.
 * Low quality everywhere keeps the shipped cube-config
 * SpeakeasyRoom (speakeasyLayout), untouched.
 *
 * The room: an indoor speakeasy in miniature — 8.8 × 8.8 m of
 * dark brick, a herringbone parquet floor, a pressed-tin ceiling
 * at floor + 3.3, the back-bar along the far wall (two bottle
 * shelves over a mirror, a wood bar counter with a brass foot
 * rail), three burgundy booths along the west wall, a low stage
 * in the NE corner with its curtain and mic stand, and the
 * speakeasy door (brass-rimmed peep hole) on the east wall. The
 * identity carries over from the cube dress (VENUES.md: window-
 * less by design, herringbone dark/fine, back-bar far, booths
 * WEST only, door EAST, low amber pools; felt #5c0d1a).
 *
 * Route: ALL CODE, zero downloads — every item is box /
 * cylinder / tube work, every texture a seeded canvas.
 *
 * COPLANAR FLOOR (the Rec lesson, 2026-10-28): this room's
 * parquet sits at FLOOR_Y, the depth every bespoke room owns.
 * Nothing else renders an opaque surface at that depth at this
 * venue: TableModel's 30×30 ground plane is classic-only
 * (Scene.tsx: `def.id === 'classic' && !roomFloor`), and the
 * cube shell — whose floor rides +0.005 over the same depth —
 * never mounts on this branch (same Scene ternary). The two
 * surfaces therefore never share a frame, let alone a depth.
 *
 * Standing-camera discipline: the tin ceiling is a SINGLE-
 * SIDED plane at floor + 3.3 facing DOWN only — the standing
 * camera above sees through it. No fixture hangs over the
 * table: pendants live over the booths (x=-3.8) and the bar
 * (z=-3.7); the amber pool over the felt is light only.
 *
 * HARD EXCLUSIONS: no text / lettering anywhere (the bottles
 * are blank glass, no labels, no signage), no people dressing
 * (the character phase owns figures).
 *
 * Seat back-clearances (kit chair back = CHAIR_SPOTS origin +
 * ~0.25 m): far seat back z=-2.23 → bar front -3.55 = 1.32 m;
 * player back z=+2.23 → south wall 4.4 = 2.17 m; west back
 * x=-2.39 → booth inner face -3.30 = 0.91 m; east back
 * x=+2.39 → east wall 4.4 = 2.01 m (the stage platform spans
 * z -4.4..-2.6, north of the east seat's centreline, never
 * behind it). All ≥ 0.6 m.
 *
 * SCENARIO PASS (owner, 2026-10-30: "If we can improve the
 * venue let's do it" — the Pj's-bar pass): the base build read
 * as a dark void from the seat, so the room's story is now
 * carried the Pj's way — emissive + spill + halo sprites, not
 * new fixtures over the felt. The back-bar bottles are backlit
 * glass (a low self-emissive in each hue, a bloom wash on the
 * mirror, a glow strip under EACH shelf, two brass pendants
 * over the counter). The stage earns the band the audio puts
 * through its wall: an upright piano in black lacquer, foot-
 * lights along the platform front, a valanced curtain. Booths
 * get a candle and a light pool on each table; warm haze hangs
 * high over the bar, the stage and the booths; the speakeasy
 * door leaks a seam of light at its base with a spill streak
 * on the parquet; dark beams cross under the tin. The table's
 * own amber point is UNTOUCHED — nothing new competes with
 * the cards. All of it is still boxes, canvas and sprites:
 * no downloads, no lettering, no people dressing.
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
      ? `rgba(255,226,178,${(alpha * rnd()).toFixed(3)})`
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

/** Herringbone parquet: dark walnut planks (canvas tile = 2.2 m
 *  at [4,4] over the 8.8 m floor) — the cube dress's herringbone,
 *  drawn in code: planks laid at 90° in the classic weave. */
function makeHerringboneTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(51077);
    ctx.fillStyle = '#2e1a10'; ctx.fillRect(0, 0, w, h); // shadow gaps
    const L = 128, Wd = 32; // plank length / width in px
    const tone = () => {
      const j = (rnd() - 0.5) * 22;
      return `rgb(${Math.round(96 + j)},${Math.round(60 + j * 0.7)},${Math.round(34 + j * 0.5)})`;
    };
    const plank = (x: number, y: number, horiz: boolean) => {
      ctx.save();
      ctx.translate(x, y);
      if (!horiz) ctx.rotate(Math.PI / 2);
      ctx.fillStyle = tone();
      ctx.fillRect(1, 1, L - 2, Wd - 2);
      ctx.strokeStyle = 'rgba(30,16,8,0.35)';
      ctx.lineWidth = 1;
      for (let gLine = 1; gLine < 4; gLine++) { // grain
        ctx.beginPath();
        ctx.moveTo(4, (Wd / 4) * gLine + (rnd() - 0.5) * 3);
        ctx.bezierCurveTo(L * 0.3, (Wd / 4) * gLine - 2, L * 0.6, (Wd / 4) * gLine + 2, L - 4, (Wd / 4) * gLine + (rnd() - 0.5) * 3);
        ctx.stroke();
      }
      ctx.restore();
    };
    // the weave: blocks of four planks, alternating orientation
    for (let by = 0; by < 4; by++) for (let bx = 0; bx < 4; bx++) {
      const ox = bx * L, oy = by * L;
      if ((bx + by) % 2 === 0) {
        plank(ox, oy, true); plank(ox, oy + Wd * 3, true);
        plank(ox + Wd, oy + Wd, false); plank(ox + Wd * 2, oy + Wd * 2, false);
      } else {
        plank(ox, oy, false); plank(ox + Wd * 3, oy, false);
        plank(ox + Wd, oy + Wd, true); plank(ox + Wd * 2, oy + Wd * 2, true);
      }
    }
    speckle(ctx, w, h, 2600, rnd, 0.07, false);
    speckle(ctx, w, h, 900, rnd, 0.04, true);
  }, [4, 4]);
}

/** Dark lounge brick: deep red-brown courses, near-black mortar. */
function makeBrickTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(51212);
    ctx.fillStyle = '#1f130f'; ctx.fillRect(0, 0, w, h); // mortar
    const bw = 512 / 4, bh = 512 / 12, gap = 4;
    for (let row = 0; row < 12; row++) {
      const off = row % 2 === 0 ? 0 : bw / 2;
      for (let col = -1; col < 5; col++) {
        const j = (rnd() - 0.5) * 18;
        ctx.fillStyle = `rgb(${Math.round(88 + j)},${Math.round(46 + j * 0.6)},${Math.round(34 + j * 0.5)})`;
        ctx.fillRect(col * bw + off + gap / 2, row * bh + gap / 2, bw - gap, bh - gap);
        if (rnd() > 0.72) { // a scorched or paler brick here and there
          ctx.fillStyle = `rgba(${rnd() > 0.5 ? '20,12,10' : '150,110,80'},${(0.10 + rnd() * 0.12).toFixed(2)})`;
          ctx.fillRect(col * bw + off + gap / 2, row * bh + gap / 2, bw - gap, bh - gap);
        }
      }
    }
    speckle(ctx, w, h, 3200, rnd, 0.08, false);
    speckle(ctx, w, h, 700, rnd, 0.03, true);
  }, [4.4, 1.65]);
}

/** Pressed tin: a grid of stamped squares with a centre medallion
 *  ring — drawn as shading only, no lettering. */
function makeTinTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const rnd = mulberry32(51313);
    ctx.fillStyle = '#4a3421'; ctx.fillRect(0, 0, w, h);
    const cell = 128;
    for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) {
      const x = cx * cell, y = cy * cell;
      ctx.strokeStyle = 'rgba(16,9,4,0.55)'; ctx.lineWidth = 5;
      ctx.strokeRect(x + 4, y + 4, cell - 8, cell - 8);
      ctx.strokeStyle = 'rgba(226,186,120,0.28)'; ctx.lineWidth = 2;
      ctx.strokeRect(x + 10, y + 10, cell - 20, cell - 20);
      const ring = ctx.createRadialGradient(x + cell / 2, y + cell / 2, 4, x + cell / 2, y + cell / 2, 40);
      ring.addColorStop(0, 'rgba(235,200,130,0.20)');
      ring.addColorStop(0.7, 'rgba(120,86,44,0.10)');
      ring.addColorStop(1, 'rgba(0,0,0,0.12)');
      ctx.fillStyle = ring;
      ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, 40, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(16,9,4,0.4)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, 26, 0, Math.PI * 2); ctx.stroke();
    }
    speckle(ctx, w, h, 900, rnd, 0.06, false);
  }, [4, 4]);
}

/** Stage curtain pleats: deep green velvet folds. */
function makeCurtainTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const rnd = mulberry32(51414);
    for (let x = 0; x < w; x++) {
      const fold = Math.sin((x / w) * Math.PI * 10) * 0.5 + Math.sin((x / w) * Math.PI * 23) * 0.18;
      const v = 0.55 + fold * 0.45;
      ctx.fillStyle = `rgb(${Math.round(24 * v)},${Math.round(42 * v)},${Math.round(30 * v)})`;
      ctx.fillRect(x, 0, 1, h);
    }
    speckle(ctx, w, h, 500, rnd, 0.05, false);
  });
}

/** Soft radial glow (halo sprites, light pools, haze) — the
 *  Pj's rooms' shared idiom: one radial falloff, tinted per use. */
function makeGlowTexture() {
  return canvasTex(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.32)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

/** The upright piano's key strip: ivory keys with the black-key
 *  pattern drawn as plain rectangles — geometry, not lettering. */
function makePianoKeyTexture() {
  return canvasTex(512, 64, (ctx, w, h) => {
    ctx.fillStyle = '#e8e0cc'; ctx.fillRect(0, 0, w, h);
    const whites = 29, kw = w / whites;
    ctx.fillStyle = 'rgba(120,100,70,0.5)';
    for (let i = 1; i < whites; i++) ctx.fillRect(i * kw - 0.5, 0, 1, h);
    // black keys in the 2-3 grouping of a real keyboard
    ctx.fillStyle = '#14100c';
    const groups = [2, 3, 2, 3, 2, 3, 2, 3];
    let wi = 0;
    for (const gsz of groups) {
      for (let k = 1; k <= gsz; k++) ctx.fillRect((wi + k) * kw - kw * 0.30, 0, kw * 0.6, h * 0.62);
      wi += gsz + 2;
      if (wi >= whites - 1) break;
    }
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(60,40,16,0.20)');
    grad.addColorStop(1, 'rgba(60,40,16,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  });
}

/* ------------------------------------------------------------------ */
/* cached assets                                                        */
/* ------------------------------------------------------------------ */

type LoungeAssets = {
  parquet: MeshStandardMaterial; brick: MeshStandardMaterial; tin: MeshStandardMaterial;
  curtain: MeshStandardMaterial; darkWood: MeshStandardMaterial; barTop: MeshStandardMaterial;
  woodPanel: MeshStandardMaterial; brass: MeshStandardMaterial; burgundy: MeshStandardMaterial;
  frameBronze: MeshStandardMaterial; glassGreen: MeshStandardMaterial; glassAmber: MeshStandardMaterial;
  glassBrown: MeshStandardMaterial; mirror: MeshStandardMaterial; shadeGlow: MeshStandardMaterial;
  shelfGlow: MeshStandardMaterial; blackSteel: MeshStandardMaterial; stageWood: MeshStandardMaterial;
  pianoBlack: MeshStandardMaterial; pianoKey: MeshStandardMaterial;
  glowTex: CanvasTexture;
};

let ASSETS: LoungeAssets | null = null;
function assets(): LoungeAssets {
  if (ASSETS) return ASSETS;
  ColorManagement.enabled = true;
  ASSETS = {
    parquet: std({ map: makeHerringboneTexture(), roughness: 0.5, metalness: 0.05 }),
    brick: std({ map: makeBrickTexture(), roughness: 0.94, metalness: 0 }),
    tin: std({ map: makeTinTexture(), roughness: 0.55, metalness: 0.45 }),
    curtain: std({ map: makeCurtainTexture(), roughness: 0.96, metalness: 0 }),
    darkWood: std({ color: '#2a1408', roughness: 0.62, metalness: 0.02 }),
    barTop: std({ color: '#3d2110', roughness: 0.24, metalness: 0.08 }),
    woodPanel: std({ color: '#41220f', roughness: 0.7, metalness: 0 }),
    brass: std({ color: '#c9a24d', roughness: 0.3, metalness: 0.9 }),
    burgundy: std({ color: '#5c1420', roughness: 0.82, metalness: 0.02 }),
    frameBronze: std({ color: '#4a3520', roughness: 0.45, metalness: 0.7 }),
    // the bottle glass carries a low self-emissive in its own
    // hue — backlit by the shelf glow, it reads as lit glass
    // in the dark instead of opaque silhouette
    glassGreen: std({ color: '#24381e', roughness: 0.16, metalness: 0.1, emissive: '#16280d', emissiveIntensity: 0.85 }),
    glassAmber: std({ color: '#7a4d16', roughness: 0.16, metalness: 0.1, emissive: '#3d2708', emissiveIntensity: 0.9 }),
    glassBrown: std({ color: '#38242e', roughness: 0.16, metalness: 0.1, emissive: '#221016', emissiveIntensity: 0.85 }),
    mirror: std({ color: '#5d6f66', roughness: 0.1, metalness: 0.92 }),
    shadeGlow: std({ color: '#ffca7a', emissive: '#ffab3d', emissiveIntensity: 1.35, roughness: 0.5, metalness: 0 }),
    shelfGlow: std({ color: '#ffd9a0', emissive: '#ff9e45', emissiveIntensity: 0.95, roughness: 0.8, metalness: 0 }),
    blackSteel: std({ color: '#1d1d20', roughness: 0.42, metalness: 0.8 }),
    stageWood: std({ color: '#33200f', roughness: 0.8, metalness: 0 }),
    pianoBlack: std({ color: '#0d0d10', roughness: 0.3, metalness: 0.25 }),
    pianoKey: std({ map: makePianoKeyTexture(), roughness: 0.42, metalness: 0.02 }),
    glowTex: makeGlowTexture(),
  };
  return ASSETS;
}

/** Local height helper: metres above the floor → world y. */
const Y = (h: number) => FLOOR_Y + h;
const WALL_H = 3.3;

/* ------------------------------------------------------------------ */
/* lights — low and warm: amber pools over the table and the bar,  */
/* the shelf glow breathing almost imperceptibly when fxOn (the    */
/* lounge haze; fxOn off holds it dead steady).                    */
/* ------------------------------------------------------------------ */

function GlowBreath({ a, fxOn }: { a: LoungeAssets; fxOn: boolean }) {
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    a.shelfGlow.emissiveIntensity = fxOn
      ? 0.95 + Math.sin(t * 7.3) * Math.sin(t * 3.17) * 0.08
      : 0.95;
    a.shadeGlow.emissiveIntensity = fxOn
      ? 1.35 + Math.sin(t * 1.7) * 0.05
      : 1.35;
  });
  return null;
}

function LoungeLights({ fxOn }: { fxOn: boolean }) {
  return (
    <>
      <hemisphereLight args={['#ffd9a8', '#2a1408', 0.5]} />
      <directionalLight
        position={[3.5, 6, 2.5]}
        target-position={[0, -0.6, -0.5]}
        color="#ffd2a0"
        intensity={0.44}
        castShadow={fxOn}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-6} shadow-camera-right={6}
        shadow-camera-top={6} shadow-camera-bottom={-6}
        shadow-bias={-0.0004}
      />
      {/* the amber pool over the table — light only, no fixture */}
      <pointLight position={[0, Y(2.3), 0]} intensity={7.5} distance={8.5} decay={2} color="#ffb45c" />
      {/* the bar's warm spill */}
      <pointLight position={[0, Y(2.1), -3.3]} intensity={5.2} distance={6} decay={2} color="#ff9e45" />
      {/* a low fill so the west booths read */}
      <pointLight position={[-3.4, Y(1.7), 0.2]} intensity={2.0} distance={5.5} decay={2} color="#ffc98a" />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* the four seats — the kit chair at owner scale, dressed as a     */
/* bistro chair: burgundy padded panels, bronze frame              */
/* ------------------------------------------------------------------ */

const CHAIR_SPOTS: { pos: [number, number, number]; ry: number }[] = [
  { pos: [0, FLOOR_Y, 1.98], ry: Math.PI },
  { pos: [2.14, FLOOR_Y, 0], ry: -Math.PI / 2 },
  { pos: [0, FLOOR_Y, -1.98], ry: 0 },
  { pos: [-2.14, FLOOR_Y, 0], ry: Math.PI / 2 },
];

function bistroChairGeo() {
  const seatParts: G[] = [], backParts: G[] = [], legParts: G[] = [], backLegParts: G[] = [];
  seatParts.push(box(0.42, 0.05, 0.40, 0, 0.485, 0.02));
  backParts.push(box(0.42, 0.32, 0.045, 0, 0.80, -0.185, -0.10));
  for (const sx of [-1, 1]) {
    const x = 0.20 * sx;
    legParts.push(tube([x, 0.02, 0.24], [x, 0.47, -0.10], 0.0135));
    backLegParts.push(tube([x, 0.02, -0.235], [x, 0.90, -0.225], 0.0135));
    legParts.push(box(0.026, 0.022, 0.36, x, 0.27, 0.005));
  }
  return {
    seat: merged(seatParts), back: merged(backParts),
    legs: merged(legParts), backLegs: merged(backLegParts),
  };
}

function BistroChairs({ a }: { a: LoungeAssets }) {
  const geos = useMemo(bistroChairGeo, []);
  return (
    <group>
      {CHAIR_SPOTS.map(({ pos, ry }, i) => (
        <group key={i} position={pos} rotation={[0, ry, 0]}>
          <mesh geometry={geos.seat} material={a.burgundy} castShadow receiveShadow />
          <mesh geometry={geos.back} material={a.burgundy} castShadow receiveShadow />
          <mesh geometry={geos.legs} material={a.frameBronze} castShadow />
          <mesh geometry={geos.backLegs} material={a.frameBronze} castShadow />
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the shell — brick walls, dark-wood wainscot, the tin ceiling    */
/* ------------------------------------------------------------------ */

function Shell({ a }: { a: LoungeAssets }) {
  const wainscot = useMemo(() => merged([
    box(8.8, 1.05, 0.03, 0, 0.525, -4.385),
    box(8.8, 1.05, 0.03, 0, 0.525, 4.385),
    box(0.03, 1.05, 8.8, -4.385, 0.525, 0),
    box(0.03, 1.05, 8.8, 4.385, 0.525, 0),
    // the chair rail cap along the top of the wainscot
    box(8.8, 0.045, 0.055, 0, 1.07, -4.375),
    box(8.8, 0.045, 0.055, 0, 1.07, 4.375),
    box(0.055, 0.045, 8.8, -4.375, 1.07, 0),
    box(0.055, 0.045, 8.8, 4.375, 1.07, 0),
    // three dark beams crossing under the tin — depth in the
    // standing view, clear of every fixture's hang line
    box(8.8, 0.16, 0.22, 0, WALL_H - 0.08, -2.6),
    box(8.8, 0.16, 0.22, 0, WALL_H - 0.08, 0),
    box(8.8, 0.16, 0.22, 0, WALL_H - 0.08, 2.6),
  ]), []);
  return (
    <group>
      {/* herringbone parquet — THE floor at FLOOR_Y (see header) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} material={a.parquet} receiveShadow>
        <planeGeometry args={[8.8, 8.8]} />
      </mesh>
      {/* far + south walls, inner faces at z=∓4.4 */}
      <mesh material={a.brick} position={[0, Y(WALL_H / 2), -4.475]} receiveShadow castShadow>
        <boxGeometry args={[9.1, WALL_H, 0.15]} />
      </mesh>
      <mesh material={a.brick} position={[0, Y(WALL_H / 2), 4.475]} receiveShadow castShadow>
        <boxGeometry args={[9.1, WALL_H, 0.15]} />
      </mesh>
      {/* west + east walls, inner faces at x=∓4.4 */}
      <mesh material={a.brick} position={[-4.475, Y(WALL_H / 2), 0]} receiveShadow castShadow>
        <boxGeometry args={[0.15, WALL_H, 8.8]} />
      </mesh>
      <mesh material={a.brick} position={[4.475, Y(WALL_H / 2), 0]} receiveShadow castShadow>
        <boxGeometry args={[0.15, WALL_H, 8.8]} />
      </mesh>
      {/* dark-wood wainscot + chair rail */}
      <mesh geometry={wainscot} material={a.darkWood} position={[0, FLOOR_Y, 0]} receiveShadow />
      {/* the pressed-tin ceiling: SINGLE-SIDED, facing DOWN only —
          the standing camera above floor+3.3 sees through it. */}
      <mesh material={a.tin} rotation={[Math.PI / 2, 0, 0]} position={[0, Y(WALL_H), 0]} receiveShadow>
        <planeGeometry args={[8.8, 8.8]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the bar — far wall: counter with a brass foot rail, two bottle  */
/* shelves over a mirror, a warm glow strip under the top shelf.   */
/* Bottles are blank glass: no labels, no lettering.               */
/* ------------------------------------------------------------------ */

function bottleRow(count: number, seed: number, shelfTopY: number, mats: MeshStandardMaterial[]) {
  const rnd = mulberry32(seed);
  const byMat = new Map<MeshStandardMaterial, G[]>();
  let x = -2.45;
  for (let i = 0; i < count; i++) {
    const hgt = 0.24 + rnd() * 0.09;
    const mat = mats[i % mats.length]!;
    const parts = byMat.get(mat) ?? [];
    parts.push(cyl(0.036, 0.038, hgt * 0.72, x, shelfTopY + (hgt * 0.72) / 2, -4.22, 10));
    parts.push(cyl(0.013, 0.024, hgt * 0.28, x, shelfTopY + hgt * 0.72 + (hgt * 0.28) / 2, -4.22, 8));
    byMat.set(mat, parts);
    x += 0.155 + rnd() * 0.09;
  }
  return [...byMat.entries()].map(([mat, parts]) => ({ mat, geo: merged(parts) }));
}

function Bar({ a }: { a: LoungeAssets }) {
  const front = useMemo(() => merged([
    box(5.6, 1.06, 0.6, 0, 0.53, 0),
    // three recessed panel mouldings on the bar front
    box(1.5, 0.72, 0.03, -1.8, 0.52, 0.31),
    box(1.5, 0.72, 0.03, 0, 0.52, 0.31),
    box(1.5, 0.72, 0.03, 1.8, 0.52, 0.31),
  ]), []);
  const shelves = useMemo(() => merged([
    box(5.2, 0.05, 0.34, 0, 1.52, -4.21),
    box(5.2, 0.05, 0.34, 0, 2.12, -4.21),
    box(0.05, 1.5, 0.3, -2.62, 1.35, -4.21),
    box(0.05, 1.5, 0.3, 2.62, 1.35, -4.21),
  ]), []);
  const lower = useMemo(() => bottleRow(15, 51501, 1.545, [a.glassGreen, a.glassAmber, a.glassBrown]), [a]);
  const upper = useMemo(() => bottleRow(13, 51502, 2.145, [a.glassAmber, a.glassBrown, a.glassGreen]), [a]);
  const rail = useMemo(() => merged([
    tube([-2.7, 0.24, -3.42], [2.7, 0.24, -3.42], 0.021),
    tube([-2.2, 0.02, -3.52], [-2.2, 0.24, -3.42], 0.014),
    tube([0, 0.02, -3.52], [0, 0.24, -3.42], 0.014),
    tube([2.2, 0.02, -3.52], [2.2, 0.24, -3.42], 0.014),
  ]), []);
  // two pendants over the counter (the booths' idiom): cords,
  // brass shades, lit bulbs — merged per material
  const pendantCord = useMemo(() => merged([
    cyl(0.012, 0.012, 1.12, -1.6, 2.74, -3.72, 6),
    cyl(0.012, 0.012, 1.12, 1.6, 2.74, -3.72, 6),
  ]), []);
  const pendantShade = useMemo(() => merged([
    cyl(0.035, 0.17, 0.15, -1.6, 2.10, -3.72, 14),
    cyl(0.035, 0.17, 0.15, 1.6, 2.10, -3.72, 14),
  ]), []);
  const pendantBulb = useMemo(() => merged([
    (() => { const s = new SphereGeometry(0.055, 10, 8); s.translate(-1.6, 2.05, -3.72); return s; })(),
    (() => { const s = new SphereGeometry(0.055, 10, 8); s.translate(1.6, 2.05, -3.72); return s; })(),
  ]), []);
  return (
    <group>
      {/* the bar counter: front face at z=-3.55, top at h 1.10 */}
      <mesh geometry={front} material={a.darkWood} position={[0, FLOOR_Y, -3.85]} castShadow receiveShadow />
      <mesh material={a.barTop} position={[0, Y(1.095), -3.82]} castShadow receiveShadow>
        <boxGeometry args={[5.9, 0.05, 0.85]} />
      </mesh>
      <mesh geometry={rail} material={a.brass} position={[0, FLOOR_Y, 0]} castShadow />
      {/* two glasses + a bottle resting on the bar top */}
      <mesh material={a.glassAmber} position={[-1.15, Y(1.19), -3.8]} castShadow>
        <cylinderGeometry args={[0.035, 0.04, 0.14, 10]} />
      </mesh>
      {([-0.55, -0.42] as const).map((x) => (
        <mesh key={x} material={a.glassAmber} position={[x, Y(1.165), -3.75]} castShadow>
          <cylinderGeometry args={[0.032, 0.026, 0.09, 10]} />
        </mesh>
      ))}
      {/* the mirror behind the shelves */}
      <mesh material={a.mirror} position={[0, Y(1.86), -4.385]}>
        <planeGeometry args={[5.24, 1.44]} />
      </mesh>
      {/* a warm bloom wash on the mirror, behind the bottles —
          their silhouettes sit in the bar's own light */}
      <mesh position={[0, Y(1.86), -4.335]}>
        <planeGeometry args={[4.9, 1.34]} />
        <meshBasicMaterial map={a.glowTex} color="#ff9e45" transparent opacity={0.15} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* the bar's light pooling on the parquet in front of it —
          the floor is what the seat cameras actually see */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y + 0.004, -2.72]}>
        <planeGeometry args={[5.4, 1.7]} />
        <meshBasicMaterial map={a.glowTex} color="#ff9e45" transparent opacity={0.11} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* shelf boards + their posts */}
      <mesh geometry={shelves} material={a.darkWood} position={[0, FLOOR_Y, 0]} castShadow receiveShadow />
      {/* the warm glow strip under EACH shelf — the flicker target */}
      <mesh material={a.shelfGlow} position={[0, Y(2.08), -4.06]}>
        <boxGeometry args={[5.1, 0.025, 0.02]} />
      </mesh>
      <mesh material={a.shelfGlow} position={[0, Y(1.485), -4.06]}>
        <boxGeometry args={[5.1, 0.025, 0.02]} />
      </mesh>
      {/* the counter pendants + their halos */}
      <mesh geometry={pendantCord} material={a.blackSteel} position={[0, FLOOR_Y, 0]} />
      <mesh geometry={pendantShade} material={a.brass} position={[0, FLOOR_Y, 0]} castShadow />
      <mesh geometry={pendantBulb} material={a.shadeGlow} position={[0, FLOOR_Y, 0]} />
      {([-1.6, 1.6] as const).map((x) => (
        <sprite key={x} position={[x, Y(2.05), -3.72]} scale={[1.15, 1.15, 1]}>
          <spriteMaterial map={a.glowTex} color="#ff9e45" transparent opacity={0.30} blending={AdditiveBlending} depthWrite={false} />
        </sprite>
      ))}
      {lower.map(({ mat, geo }, i) => (
        <mesh key={`l${i}`} geometry={geo} material={mat} position={[0, FLOOR_Y, 0]} castShadow />
      ))}
      {upper.map(({ mat, geo }, i) => (
        <mesh key={`u${i}`} geometry={geo} material={mat} position={[0, FLOOR_Y, 0]} castShadow />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the booths — WEST wall ×3: facing burgundy benches, a small     */
/* table between, a pendant over each table (x=-3.8, well outside  */
/* the standing sight cone over the felt)                          */
/* ------------------------------------------------------------------ */

function Booth({ z, a }: { z: number; a: LoungeAssets }) {
  const frame = useMemo(() => merged([
    // wall-side bench: seat + high back against the wall
    box(0.55, 0.14, 1.3, -4.08, 0.45, 0),
    box(0.13, 0.78, 1.3, -4.32, 0.92, 0),
    box(0.5, 0.42, 1.24, -4.1, 0.21, 0),
    // room-side bench: seat + back facing the wall bench
    box(0.55, 0.14, 1.3, -3.58, 0.45, 0),
    box(0.13, 0.78, 1.3, -3.34, 0.92, 0),
    box(0.5, 0.42, 1.24, -3.56, 0.21, 0),
    // the table between: top + pedestal
    box(0.62, 0.04, 0.95, -3.83, 0.73, 0),
    box(0.09, 0.68, 0.09, -3.83, 0.37, 0),
    box(0.4, 0.04, 0.6, -3.83, 0.03, 0),
  ]), []);
  return (
    <group position={[0, FLOOR_Y, z]}>
      <mesh geometry={frame} material={a.darkWood} castShadow receiveShadow />
      {/* bench cushions in burgundy */}
      <mesh material={a.burgundy} position={[-4.08, 0.545, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.52, 0.06, 1.26]} />
      </mesh>
      <mesh material={a.burgundy} position={[-3.58, 0.545, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.52, 0.06, 1.26]} />
      </mesh>
      {/* the pendant over the booth table */}
      <mesh material={a.blackSteel} position={[-3.83, 2.62, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 1.35, 6]} />
      </mesh>
      <mesh material={a.brass} position={[-3.83, 1.92, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.17, 0.15, 14, 1, true]} />
      </mesh>
      <mesh material={a.shadeGlow} position={[-3.83, 1.875, 0]}>
        <sphereGeometry args={[0.055, 10, 8]} />
      </mesh>
      {/* its halo + the pool it throws on the booth table */}
      <sprite position={[-3.83, 1.875, 0]} scale={[1.05, 1.05, 1]}>
        <spriteMaterial map={a.glowTex} color="#ffab3d" transparent opacity={0.34} blending={AdditiveBlending} depthWrite={false} />
      </sprite>
      {/* and the spill pooling on the parquet under the booth */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-3.3, 0.004, 0]}>
        <planeGeometry args={[1.9, 1.5]} />
        <meshBasicMaterial map={a.glowTex} color="#ffab3d" transparent opacity={0.08} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-3.83, 0.756, 0]}>
        <planeGeometry args={[0.58, 0.9]} />
        <meshBasicMaterial map={a.glowTex} color="#ffab3d" transparent opacity={0.15} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* a candle on the booth table: dark-red glass + a glow dot */}
      <mesh material={a.burgundy} position={[-3.98, 0.778, 0.22]} castShadow>
        <cylinderGeometry args={[0.017, 0.019, 0.055, 10]} />
      </mesh>
      <sprite position={[-3.98, 0.832, 0.22]} scale={[0.2, 0.2, 1]}>
        <spriteMaterial map={a.glowTex} color="#ffc46b" transparent opacity={0.55} blending={AdditiveBlending} depthWrite={false} />
      </sprite>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the stage — NE corner: a low platform, the curtain on the far   */
/* wall behind it, a mic stand and a stool                         */
/* ------------------------------------------------------------------ */

function Stage({ a }: { a: LoungeAssets }) {
  const mic = useMemo(() => merged([
    tube([3.28, 0.18, -3.3], [3.28, 1.46, -3.3], 0.014),
    tube([3.28, 1.46, -3.3], [3.13, 1.58, -3.22], 0.011),
    tube([3.02, 0.18, -3.42], [3.28, 0.18, -3.3], 0.009),
    tube([3.54, 0.18, -3.42], [3.28, 0.18, -3.3], 0.009),
    tube([3.28, 0.18, -3.06], [3.28, 0.18, -3.3], 0.009),
  ]), []);
  const stool = useMemo(() => merged([
    cyl(0.17, 0.17, 0.045, 3.85, 0.62, -3.85, 16),
    tube([3.72, 0.02, -3.98], [3.8, 0.6, -3.9], 0.013),
    tube([3.98, 0.02, -3.98], [3.9, 0.6, -3.9], 0.013),
    tube([3.72, 0.02, -3.72], [3.8, 0.6, -3.8], 0.013),
    tube([3.98, 0.02, -3.72], [3.9, 0.6, -3.8], 0.013),
  ]), []);
  // the upright piano, stage left against the curtain — plain
  // boxes in black lacquer: cabinet, lid, keybed, fallboard,
  // plinth. The key strip is its own textured plane on top.
  const piano = useMemo(() => merged([
    box(1.15, 1.22, 0.55, 2.98, 0.79, -4.06),
    box(1.19, 0.04, 0.58, 2.98, 1.42, -4.06),
    box(1.05, 0.06, 0.48, 2.98, 0.21, -4.06),
    box(1.05, 0.05, 0.20, 2.98, 0.80, -3.72),
    box(1.05, 0.16, 0.03, 2.98, 0.93, -3.775, -0.15),
  ]), []);
  // footlights along the platform's front edge: brass bases
  const footBases = useMemo(() => merged(
    [2.70, 3.03, 3.37, 3.70, 4.03].map((x) => cyl(0.038, 0.044, 0.028, x, 0.194, -2.57, 10)),
  ), []);
  const footBulbs = useMemo(() => merged(
    [2.70, 3.03, 3.37, 3.70, 4.03].map((x) => {
      const s = new SphereGeometry(0.021, 8, 6); s.translate(x, 0.222, -2.57); return s;
    }),
  ), []);
  return (
    <group>
      {/* the platform: x 2.55..4.35, z -4.35..-2.6, top h 0.18 */}
      <mesh material={a.stageWood} position={[3.45, Y(0.09), -3.475]} castShadow receiveShadow>
        <boxGeometry args={[1.8, 0.18, 1.75]} />
      </mesh>
      {/* the curtain on the far wall behind the stage */}
      <mesh material={a.curtain} position={[3.42, Y(1.78), -4.385]} receiveShadow>
        <planeGeometry args={[1.95, 2.75]} />
      </mesh>
      {/* the stage wash on the curtain — the piano and the mic
          read as dark shapes against their own light */}
      <mesh position={[3.42, Y(1.55), -4.372]}>
        <planeGeometry args={[1.9, 2.2]} />
        <meshBasicMaterial map={a.glowTex} color="#ff9e45" transparent opacity={0.13} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh material={a.darkWood} position={[3.42, Y(3.2), -4.36]} castShadow>
        <boxGeometry args={[2.05, 0.16, 0.06]} />
      </mesh>
      {/* the valance + its brass fringe, and the curtain legs
          framing the stage picture */}
      <mesh material={a.curtain} position={[3.42, Y(2.98), -4.345]} castShadow>
        <boxGeometry args={[2.05, 0.36, 0.06]} />
      </mesh>
      <mesh material={a.brass} position={[3.42, Y(2.79), -4.345]}>
        <boxGeometry args={[2.05, 0.035, 0.065]} />
      </mesh>
      <mesh material={a.curtain} position={[2.47, Y(1.60), -4.345]} rotation={[0, 0.10, 0]} receiveShadow>
        <boxGeometry args={[0.24, 2.75, 0.05]} />
      </mesh>
      <mesh material={a.curtain} position={[4.37, Y(1.60), -4.345]} rotation={[0, -0.10, 0]} receiveShadow>
        <boxGeometry args={[0.24, 2.75, 0.05]} />
      </mesh>
      {/* the upright piano + its key strip */}
      <mesh geometry={piano} material={a.pianoBlack} position={[0, FLOOR_Y, 0]} castShadow receiveShadow />
      <mesh material={a.pianoKey} rotation={[-Math.PI / 2, 0, 0]} position={[2.98, Y(0.829), -3.715]}>
        <planeGeometry args={[1.0, 0.13]} />
      </mesh>
      <mesh geometry={mic} material={a.blackSteel} position={[0, FLOOR_Y, 0]} castShadow />
      {/* the mic head + its small halo in the stage wash */}
      <mesh material={a.blackSteel} position={[3.10, Y(1.60), -3.20]} rotation={[0, 0, 0.9]} castShadow>
        <cylinderGeometry args={[0.028, 0.032, 0.11, 10]} />
      </mesh>
      <sprite position={[3.10, Y(1.60), -3.20]} scale={[0.5, 0.5, 1]}>
        <spriteMaterial map={a.glowTex} color="#ffb45c" transparent opacity={0.20} blending={AdditiveBlending} depthWrite={false} />
      </sprite>
      <mesh geometry={stool} material={a.darkWood} position={[0, FLOOR_Y, 0]} castShadow />
      {/* footlights: bases + bulbs, their wash on the platform
          front, and the spill pooling on the parquet below */}
      <mesh geometry={footBases} material={a.brass} position={[0, FLOOR_Y, 0]} />
      <mesh geometry={footBulbs} material={a.shadeGlow} position={[0, FLOOR_Y, 0]} />
      <mesh position={[3.45, Y(0.09), -2.585]}>
        <planeGeometry args={[1.8, 0.16]} />
        <meshBasicMaterial map={a.glowTex} color="#ffb45c" transparent opacity={0.16} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[3.45, Y(0.004), -2.02]}>
        <planeGeometry args={[1.9, 1.05]} />
        <meshBasicMaterial map={a.glowTex} color="#ffb45c" transparent opacity={0.10} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* a warm stage spot from the curtain side (light only) */}
      <pointLight position={[3.4, Y(2.6), -3.2]} intensity={2.8} distance={4.5} decay={2} color="#ffb45c" />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the speakeasy door — EAST wall: dark slab, a brass-rimmed peep  */
/* hole, a push bar. Flat on the wall (east clearance is the wall) */
/* ------------------------------------------------------------------ */

function Door({ a }: { a: LoungeAssets }) {
  return (
    <group position={[4.39, FLOOR_Y, 1.4]} rotation={[0, -Math.PI / 2, 0]}>
      {/* after the turn, local +z faces the room (-x world) and
          local -z the wall: the frame straddles the wall face,
          the panel and hardware sit proud on the room side */}
      <mesh material={a.darkWood} position={[0, 1.1, -0.01]}>
        <boxGeometry args={[1.06, 2.26, 0.05]} />
      </mesh>
      <mesh material={a.woodPanel} position={[0, 1.08, 0.015]} castShadow receiveShadow>
        <boxGeometry args={[0.94, 2.14, 0.05]} />
      </mesh>
      {/* the peep hole: brass rim + dark glass */}
      <mesh material={a.brass} position={[0, 1.58, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.075, 0.075, 0.02, 18]} />
      </mesh>
      <mesh material={a.blackSteel} position={[0, 1.58, 0.058]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.02, 18]} />
      </mesh>
      {/* the push bar */}
      <mesh material={a.brass} position={[0, 1.02, 0.065]} castShadow>
        <boxGeometry args={[0.7, 0.045, 0.045]} />
      </mesh>
      {/* the hidden door leaks light: a warm seam at its base
          and the spill streaking across the parquet */}
      <mesh material={a.shelfGlow} position={[0, 0.014, 0.045]}>
        <boxGeometry args={[0.94, 0.016, 0.018]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0.85]}>
        <planeGeometry args={[0.95, 1.6]} />
        <meshBasicMaterial map={a.glowTex} color="#ffb45c" transparent opacity={0.10} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* wall sconces — amber half-globes on the east + south walls      */
/* ------------------------------------------------------------------ */

function Sconces({ a }: { a: LoungeAssets }) {
  const spots: { pos: [number, number, number]; ry: number }[] = [
    { pos: [4.36, Y(2.25), -1.6], ry: -Math.PI / 2 },
    { pos: [4.36, Y(2.25), 3.2], ry: -Math.PI / 2 },
    { pos: [-1.8, Y(2.25), 4.36], ry: Math.PI },
    { pos: [2.2, Y(2.25), 4.36], ry: Math.PI },
  ];
  return (
    <group>
      {spots.map(({ pos, ry }, i) => (
        <group key={i} position={pos} rotation={[0, ry, 0]}>
          <mesh material={a.brass} position={[0, -0.07, 0.02]}>
            <boxGeometry args={[0.09, 0.16, 0.04]} />
          </mesh>
          <mesh material={a.shadeGlow} position={[0, 0.03, 0.06]}>
            <sphereGeometry args={[0.075, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the haze — big soft warm veils hanging high over the bar,     */
/* the stage and the booths (the Pj's night-haze idiom): they    */
/* catch the amber light in the air and keep well clear of the   */
/* felt, so the cards never sit in the murk                      */
/* ------------------------------------------------------------------ */

function Haze({ a }: { a: LoungeAssets }) {
  const veils: { pos: [number, number, number]; scale: [number, number, number]; opacity: number }[] = [
    { pos: [0, Y(2.55), -3.35], scale: [6.4, 2.1, 1], opacity: 0.05 },
    { pos: [3.4, Y(2.35), -3.15], scale: [3.4, 1.8, 1], opacity: 0.06 },
    { pos: [-3.55, Y(2.45), 0.2], scale: [3.1, 1.7, 1], opacity: 0.045 },
    { pos: [0.7, Y(2.65), 1.6], scale: [5.4, 1.9, 1], opacity: 0.032 },
  ];
  return (
    <group>
      {veils.map(({ pos, scale, opacity }, i) => (
        <sprite key={i} position={pos} scale={scale}>
          <spriteMaterial map={a.glowTex} color="#ffca7a" transparent opacity={opacity} blending={AdditiveBlending} depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */

export default function SpeakeasyLoungeRoom({ fxOn }: { fxOn: boolean }) {
  const a = assets();
  useEffect(() => {
    (window as unknown as { __bwmVenue?: unknown }).__bwmVenue = { id: 'speakeasy', fx: fxOn, studio: true, room: 'speakeasy-lounge', props: false };
  }, [fxOn]);
  return (
    <group>
      <LoungeLights fxOn={fxOn} />
      <GlowBreath a={a} fxOn={fxOn} />
      <BistroChairs a={a} />
      <Shell a={a} />
      <Bar a={a} />
      {([-1.7, 0.15, 2.0] as const).map((z) => (
        <Booth key={z} z={z} a={a} />
      ))}
      <Stage a={a} />
      <Door a={a} />
      <Sconces a={a} />
      <Haze a={a} />
      {/* NO table here — the shared game table is the anchor. */}
    </group>
  );
}
