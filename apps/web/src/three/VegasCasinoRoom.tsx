import { useEffect, useMemo } from 'react';
import {
  BoxGeometry, CanvasTexture, CircleGeometry, ColorManagement, CylinderGeometry,
  MeshStandardMaterial, Quaternion, RepeatWrapping, RingGeometry, SphereGeometry, SRGBColorSpace,
  Vector3,
} from 'three';
import { useFrame } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The shared table's floor plane (sibling rooms keep their own). */
const FLOOR_Y = -0.9;
const WALL_H = 3.3;

/**
 * THE VEGAS CASINO FLOOR — the vegas venue's own 3D room for
 * REGULAR tables (venues rollout Batch C3, 2026-10-28: "Now
 * all the other venues need to be updated the same way").
 *
 * Mounted by Scene for every NON-STORY vegas table at High
 * quality. The story branch keeps priority: a table carrying
 * stop `legends` mounts LegendsTableRoom exactly as before —
 * that is a private legends' room, this is the public floor.
 * Low quality everywhere keeps the shipped cube-config
 * VegasRoom (vegasLayout), untouched.
 *
 * The room: a casino floor in miniature — a bold-patterned
 * carpet (canvas geometry only: diamonds, arcs, dots —
 * no words, no lettering), slot-machine banks along the far
 * wall and both side walls with BLANK glowing screens (plain
 * luminous rectangles — no symbols, no text, no readable
 * glyphs of any kind), gold-trimmed columns in the corners,
 * dark plum wall panels, a drinks cart and a chip table in
 * the south corners, and a warm ceiling-glow medallion
 * overhead. Low warm glamour light throughout. The identity
 * carries over from the cube dress (VENUES.md: windowless,
 * burgundy carpet, gold panels, chip table E; felt #3d060e).
 *
 * Route: ALL CODE, zero downloads — every item is box /
 * cylinder / tube work, every texture a seeded canvas.
 *
 * COPLANAR FLOOR (the Rec lesson, 2026-10-28): the carpet
 * is THE floor at FLOOR_Y — there is deliberately NO
 * sub-floor under it (the classic casino trap: a carpet
 * plane laid over a shell floor at the same depth). The
 * gold inlay ring under the table rides at FLOOR_Y + 0.012
 * and the slot plinths rise from the carpet as boxes (their
 * bottoms buried 0.02 below it, their tops at +0.06) — no
 * two opaque surfaces share a depth here. Nothing else
 * renders at these depths at this venue: TableModel's 30×30
 * ground plane is classic-only (Scene.tsx: `def.id ===
 * 'classic' && !roomFloor`), and the cube shell — whose
 * floor rides +0.005 over FLOOR_Y — never mounts on this
 * branch (same Scene ternary). The surfaces never share a
 * frame, let alone a depth.
 *
 * Standing-camera discipline (indoor room): the ceiling is
 * a SINGLE-SIDED downward plane at floor + 3.30 (the
 * Porch/Speakeasy rule) and the glow medallion is two more
 * single-sided downward planes just below it (+3.285 disc,
 * +3.27 ring — distinct depths, never coplanar with the
 * ceiling or each other). From the standing camera above
 * they are invisible; from the seats they read as a lit
 * ceiling feature. NO chandelier is hung over the table —
 * a solid fixture there would cross the standing camera's
 * sight cone over the felt (the C2 beach-roof lesson); the
 * glow feature gives the glamour with no solid in the cone.
 *
 * HARD EXCLUSIONS: no text / lettering anywhere, and the
 * slot screens stay blank — simple glowing shapes only,
 * never symbols-as-text; no people dressing (the character
 * phase owns figures).
 *
 * Seat back-clearances (kit chair back = CHAIR_SPOTS origin +
 * ~0.25 m): far seat back z=-2.23 → the far bank's button
 * decks (its nearest face) -3.66 = 1.43 m; player back
 * z=+2.23 → south wall 4.4 = 2.17 m; west back x=-2.39 →
 * the west bank's button decks -3.66 = 1.27 m; east back
 * x=+2.39 → the east bank's decks 3.66 = 1.27 m. The corner
 * columns stand diagonal to every seat, never behind one.
 * All ≥ 0.6 m.
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

type G = BoxGeometry | CylinderGeometry | SphereGeometry | CircleGeometry | RingGeometry;
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

/** The casino carpet: a bold repeating medallion pattern —
 *  gold diamonds, teal arcs and magenta dots on deep
 *  burgundy. Pure geometry: no words, no symbols-as-text. */
function makeCarpetTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(62011);
    ctx.fillStyle = '#47101f';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 2600, rnd, 0.06, false);
    const cell = 128;
    for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
      const x = cx * cell + cell / 2, y = cy * cell + cell / 2;
      // gold diamond
      ctx.strokeStyle = 'rgba(201,162,77,0.85)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x, y - 44); ctx.lineTo(x + 44, y); ctx.lineTo(x, y + 44); ctx.lineTo(x - 44, y);
      ctx.closePath(); ctx.stroke();
      ctx.strokeStyle = 'rgba(201,162,77,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 32); ctx.lineTo(x + 32, y); ctx.lineTo(x, y + 32); ctx.lineTo(x - 32, y);
      ctx.closePath(); ctx.stroke();
      // teal arcs at the corners of the cell
      ctx.strokeStyle = 'rgba(38,128,128,0.75)';
      ctx.lineWidth = 6;
      for (const [ax, ay] of [[cx * cell, cy * cell], [(cx + 1) * cell, cy * cell], [cx * cell, (cy + 1) * cell], [(cx + 1) * cell, (cy + 1) * cell]] as const) {
        ctx.beginPath();
        ctx.arc(ax, ay, 26, 0, Math.PI * 2);
        ctx.stroke();
      }
      // magenta centre dot + gold satellites
      ctx.fillStyle = 'rgba(196,52,110,0.8)';
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(232,196,110,0.75)';
      for (const [dx, dy] of [[0, -56], [0, 56], [-56, 0], [56, 0]] as const) {
        ctx.beginPath(); ctx.arc(x + dx, y + dy, 4.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }, [3, 3]);
}

/** Wall panels: deep plum with a faint damask-ish diamond
 *  lattice (pattern only). */
function makePanelTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const rnd = mulberry32(62122);
    ctx.fillStyle = '#241222';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 900, rnd, 0.05, false);
    ctx.strokeStyle = 'rgba(154,118,38,0.20)';
    ctx.lineWidth = 1.5;
    for (let i = -4; i < 9; i++) {
      ctx.beginPath(); ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32 + h, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i * 32 + h, 0); ctx.lineTo(i * 32, h); ctx.stroke();
    }
  }, [4, 1]);
}

/** The ceiling: dark coffered squares with gold pinstripes. */
function makeCeilingTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#170a18';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(201,162,77,0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.strokeStyle = 'rgba(201,162,77,0.25)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(24, 24, w - 48, h - 48);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(28, 28, w - 56, h - 56);
  }, [4, 4]);
}

/* ------------------------------------------------------------------ */
/* cached assets                                                        */
/* ------------------------------------------------------------------ */

type CasinoAssets = {
  carpet: MeshStandardMaterial; panel: MeshStandardMaterial; ceiling: MeshStandardMaterial;
  gold: MeshStandardMaterial; goldDim: MeshStandardMaterial; cabinet: MeshStandardMaterial;
  cabinetAlt: MeshStandardMaterial; plinth: MeshStandardMaterial;
  screenA: MeshStandardMaterial; screenB: MeshStandardMaterial; buttonDark: MeshStandardMaterial;
  burgundy: MeshStandardMaterial; darkWood: MeshStandardMaterial; glassAmber: MeshStandardMaterial;
  glassGreen: MeshStandardMaterial; chipWhite: MeshStandardMaterial; chipRed: MeshStandardMaterial;
  chipBlue: MeshStandardMaterial; glowDisc: MeshStandardMaterial; mirror: MeshStandardMaterial;
};

let ASSETS: CasinoAssets | null = null;
function assets(): CasinoAssets {
  if (ASSETS) return ASSETS;
  ColorManagement.enabled = true;
  ASSETS = {
    carpet: std({ map: makeCarpetTexture(), roughness: 0.96, metalness: 0 }),
    panel: std({ map: makePanelTexture(), roughness: 0.9, metalness: 0.02 }),
    ceiling: std({ map: makeCeilingTexture(), roughness: 0.95, metalness: 0.02 }),
    gold: std({ color: '#c9a24d', roughness: 0.3, metalness: 0.9, emissive: '#ffcc33', emissiveIntensity: 0.10 }),
    goldDim: std({ color: '#8a6a20', roughness: 0.42, metalness: 0.8 }),
    cabinet: std({ color: '#3b2d47', roughness: 0.38, metalness: 0.55 }),
    cabinetAlt: std({ color: '#52293a', roughness: 0.38, metalness: 0.55 }),
    plinth: std({ color: '#2a1e30', roughness: 0.7, metalness: 0.1 }),
    // BLANK screens: plain luminous fields, no symbols ever
    screenA: std({ color: '#6fa8a0', emissive: '#2fae9e', emissiveIntensity: 0.95, roughness: 0.4, metalness: 0 }),
    screenB: std({ color: '#a87a90', emissive: '#d84f92', emissiveIntensity: 0.9, roughness: 0.4, metalness: 0 }),
    buttonDark: std({ color: '#14101a', roughness: 0.35, metalness: 0.4 }),
    burgundy: std({ color: '#6e1428', roughness: 0.85, metalness: 0.02 }),
    darkWood: std({ color: '#332014', roughness: 0.7, metalness: 0.05 }),
    glassAmber: std({ color: '#c98a2e', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 }),
    glassGreen: std({ color: '#2e7a4a', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 }),
    chipWhite: std({ color: '#e8e4da', roughness: 0.5, metalness: 0.02 }),
    chipRed: std({ color: '#b03030', roughness: 0.5, metalness: 0.02 }),
    chipBlue: std({ color: '#2a4a8a', roughness: 0.5, metalness: 0.02 }),
    glowDisc: std({ color: '#ffe9bb', emissive: '#ffc978', emissiveIntensity: 1.5, roughness: 0.6, metalness: 0 }),
    mirror: std({ color: '#8a97a5', roughness: 0.08, metalness: 0.9 }),
  };
  return ASSETS;
}

/** Local height helper: metres above the carpet → world y. */
const Y = (h: number) => FLOOR_Y + h;

/* ------------------------------------------------------------------ */
/* lights + fx life — low warm glamour: a gold pool over the   */
/* felt, slot-glow spill at the far corners, the screens and   */
/* the ceiling glow breathing almost imperceptibly under fxOn  */
/* ------------------------------------------------------------------ */

function CasinoLights({ fxOn }: { fxOn: boolean }) {
  return (
    <>
      <hemisphereLight args={['#ffe2b8', '#2a1420', 0.55]} />
      <directionalLight
        position={[3.5, 6.5, 2.5]}
        target-position={[0, -0.6, -0.5]}
        color="#ffd9a3"
        intensity={0.55}
        castShadow={fxOn}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-7} shadow-camera-right={7}
        shadow-camera-top={7} shadow-camera-bottom={-7}
        shadow-bias={-0.0004}
      />
      {/* the glamour pool over the felt */}
      <pointLight position={[0, Y(2.7), 0]} intensity={7} distance={10} decay={2} color="#ffcf8f" />
      {/* a warm wash over the far bank so the cabinets read */}
      <pointLight position={[0, Y(1.9), -2.4]} intensity={3} distance={7.5} decay={2} color="#ffd9a3" />
      {/* slot-glow spill, far corners */}
      <pointLight position={[-3.4, Y(1.4), -3.4]} intensity={2.2} distance={5.5} decay={2} color="#e86aa8" />
      <pointLight position={[3.4, Y(1.4), -3.4]} intensity={2.2} distance={5.5} decay={2} color="#4fd8c8" />
    </>
  );
}

function CasinoLife({ a, fxOn }: { a: CasinoAssets; fxOn: boolean }) {
  useFrame(({ clock }) => {
    if (!fxOn) return;
    const t = clock.elapsedTime;
    a.screenA.emissiveIntensity = 0.95 + Math.sin(t * 1.7) * 0.13;
    a.screenB.emissiveIntensity = 0.9 + Math.sin(t * 1.7 + Math.PI) * 0.13;
    a.glowDisc.emissiveIntensity = 1.5 + Math.sin(t * 0.9) * 0.07;
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* the four seats — the kit chair at owner scale, dressed as a   */
/* casino chair: burgundy pads, gold frame, a blank gold disc    */
/* on the back (a medallion shape — no lettering, ever)          */
/* ------------------------------------------------------------------ */

const CHAIR_SPOTS: { pos: [number, number, number]; ry: number }[] = [
  { pos: [0, FLOOR_Y, 1.98], ry: Math.PI },
  { pos: [2.14, FLOOR_Y, 0], ry: -Math.PI / 2 },
  { pos: [0, FLOOR_Y, -1.98], ry: 0 },
  { pos: [-2.14, FLOOR_Y, 0], ry: Math.PI / 2 },
];

function casinoChairGeo() {
  const frameParts: G[] = [], padParts: G[] = [], legParts: G[] = [];
  frameParts.push(box(0.46, 0.045, 0.44, 0, 0.47, 0.01));
  padParts.push(box(0.42, 0.05, 0.40, 0, 0.505, 0.01));
  padParts.push(box(0.40, 0.36, 0.05, 0, 0.84, -0.195, -0.10));
  frameParts.push(box(0.44, 0.05, 0.03, 0, 1.04, -0.222, -0.10));
  for (const sx of [-1, 1]) {
    const x = 0.20 * sx;
    legParts.push(tube([x, 0.02, 0.24], [x, 0.47, -0.10], 0.014));
    legParts.push(tube([x, 0.02, -0.235], [x, 1.0, -0.235], 0.014));
    legParts.push(box(0.027, 0.022, 0.36, x, 0.27, 0.005));
  }
  return { frame: merged(frameParts), pads: merged(padParts), legs: merged(legParts) };
}

function CasinoChairs({ a }: { a: CasinoAssets }) {
  const geos = useMemo(casinoChairGeo, []);
  return (
    <group>
      {CHAIR_SPOTS.map(({ pos, ry }, i) => (
        <group key={i} position={pos} rotation={[0, ry, 0]}>
          <mesh geometry={geos.frame} material={a.darkWood} castShadow receiveShadow />
          <mesh geometry={geos.pads} material={a.burgundy} castShadow receiveShadow />
          <mesh geometry={geos.legs} material={a.goldDim} castShadow />
          {/* the blank medallion disc on the chair back */}
          <mesh material={a.gold} position={[0, 0.88, -0.228]} rotation={[Math.PI / 2 - 0.10, 0, 0]}>
            <cylinderGeometry args={[0.075, 0.075, 0.016, 18]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the shell — carpet + inlay, plum walls with gold trim, the    */
/* corner columns, the single-sided ceiling + glow medallion     */
/* ------------------------------------------------------------------ */

function Shell({ a }: { a: CasinoAssets }) {
  const trim = useMemo(() => merged([
    // gold picture-rail strips + wainscot caps on all four walls
    box(8.8, 0.05, 0.03, 0, 2.62, -4.385), box(8.8, 0.05, 0.03, 0, 2.62, 4.385),
    box(0.03, 0.05, 8.8, -4.385, 2.62, 0), box(0.03, 0.05, 8.8, 4.385, 2.62, 0),
    box(8.8, 0.045, 0.04, 0, 1.02, -4.38), box(8.8, 0.045, 0.04, 0, 1.02, 4.38),
    box(0.04, 0.045, 8.8, -4.38, 1.02, 0), box(0.04, 0.045, 8.8, 4.38, 1.02, 0),
  ]), []);
  const columns = useMemo(() => merged([
    box(0.52, WALL_H, 0.52, -3.98, WALL_H / 2, -3.98),
    box(0.52, WALL_H, 0.52, 3.98, WALL_H / 2, -3.98),
    box(0.52, WALL_H, 0.52, -3.98, WALL_H / 2, 3.98),
    box(0.52, WALL_H, 0.52, 3.98, WALL_H / 2, 3.98),
    // capitals + bases in gold-dim (rendered with the column mesh's gold trim pass below)
  ]), []);
  const columnTrim = useMemo(() => merged([
    box(0.62, 0.14, 0.62, -3.98, WALL_H - 0.12, -3.98), box(0.62, 0.14, 0.62, 3.98, WALL_H - 0.12, -3.98),
    box(0.62, 0.14, 0.62, -3.98, WALL_H - 0.12, 3.98), box(0.62, 0.14, 0.62, 3.98, WALL_H - 0.12, 3.98),
    box(0.62, 0.16, 0.62, -3.98, 0.08, -3.98), box(0.62, 0.16, 0.62, 3.98, 0.08, -3.98),
    box(0.62, 0.16, 0.62, -3.98, 0.08, 3.98), box(0.62, 0.16, 0.62, 3.98, 0.08, 3.98),
  ]), []);
  // The ceiling glow medallion: single-sided DOWNWARD planes
  // (rotateX(+PI/2) turns the plane normal to -y), at depths
  // distinct from the ceiling and from each other.
  const glowDisc = useMemo(() => {
    const g = new CircleGeometry(1.30, 36);
    g.rotateX(Math.PI / 2);
    g.translate(0, WALL_H - 0.015, 0);
    return g;
  }, []);
  const glowRing = useMemo(() => {
    const g = new RingGeometry(1.48, 1.66, 36);
    g.rotateX(Math.PI / 2);
    g.translate(0, WALL_H - 0.03, 0);
    return g;
  }, []);
  return (
    <group>
      {/* the carpet — THE floor at FLOOR_Y (see header: no sub-floor) */}
      <mesh material={a.carpet} rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} receiveShadow>
        <planeGeometry args={[8.8, 8.8]} />
      </mesh>
      {/* the gold inlay ring under the table, offset +0.012 */}
      <mesh material={a.goldDim} rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y + 0.012, 0]} receiveShadow>
        <ringGeometry args={[2.92, 3.06, 40]} />
      </mesh>
      {/* walls: inner faces at ±4.4 */}
      <mesh material={a.panel} position={[0, Y(WALL_H / 2), -4.475]} receiveShadow castShadow>
        <boxGeometry args={[9.1, WALL_H, 0.15]} />
      </mesh>
      <mesh material={a.panel} position={[0, Y(WALL_H / 2), 4.475]} receiveShadow castShadow>
        <boxGeometry args={[9.1, WALL_H, 0.15]} />
      </mesh>
      <mesh material={a.panel} position={[-4.475, Y(WALL_H / 2), 0]} receiveShadow castShadow>
        <boxGeometry args={[0.15, WALL_H, 8.8]} />
      </mesh>
      <mesh material={a.panel} position={[4.475, Y(WALL_H / 2), 0]} receiveShadow castShadow>
        <boxGeometry args={[0.15, WALL_H, 8.8]} />
      </mesh>
      <mesh geometry={trim} material={a.goldDim} position={[0, FLOOR_Y, 0]} receiveShadow />
      <mesh geometry={columns} material={a.panel} position={[0, FLOOR_Y, 0]} castShadow receiveShadow />
      <mesh geometry={columnTrim} material={a.goldDim} position={[0, FLOOR_Y, 0]} castShadow receiveShadow />
      {/* a gold-framed blank mirror on the south wall (behind the
          player; a plain reflective plate, no image, no words) */}
      <mesh material={a.goldDim} position={[0, Y(1.95), 4.385]}>
        <boxGeometry args={[2.3, 1.25, 0.04]} />
      </mesh>
      <mesh material={a.mirror} position={[0, Y(1.95), 4.36]}>
        <boxGeometry args={[2.14, 1.09, 0.03]} />
      </mesh>
      {/* the ceiling: SINGLE-SIDED, facing DOWN only — the
          standing camera above floor+3.3 sees through it */}
      <mesh material={a.ceiling} rotation={[Math.PI / 2, 0, 0]} position={[0, Y(WALL_H), 0]}>
        <planeGeometry args={[8.8, 8.8]} />
      </mesh>
      {/* the glow medallion: single-sided downward planes just
          below the ceiling (see header) — light, not a fixture */}
      <mesh geometry={glowDisc} material={a.glowDisc} position={[0, FLOOR_Y, 0]} />
      <mesh geometry={glowRing} material={a.gold} position={[0, FLOOR_Y, 0]} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the slot banks — cabinets with BLANK glowing screens, a       */
/* button deck and a lever. Far wall ×5, each side wall ×3.      */
/* Screens are plain luminous rectangles: no symbols, no text.   */
/* ------------------------------------------------------------------ */

function SlotBank({ a, origin, ry, count, phase }: {
  a: CasinoAssets; origin: [number, number]; ry: number; count: number; phase: number;
}) {
  const { cabinets, screens, frames, decks, levers } = useMemo(() => {
    const cab: G[] = [], scr: G[] = [], frm: G[] = [], dek: G[] = [], lev: G[] = [];
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * 1.18;
      // local frame: bank runs along local x, faces local +z
      cab.push(box(0.86, 0.10, 0.56, off, 0.05, 0));            // plinth (top at +0.10, base buried)
      cab.push(box(0.78, 1.52, 0.48, off, 0.86, -0.02));        // cabinet body
      cab.push(box(0.82, 0.10, 0.52, off, 1.67, -0.02));        // crown
      frm.push(box(0.64, 0.54, 0.03, off, 1.30, 0.222, -0.16)); // the screen's gold frame
      scr.push(box(0.56, 0.46, 0.04, off, 1.30, 0.235, -0.16)); // the BLANK screen, tilted back
      dek.push(box(0.62, 0.05, 0.20, off, 0.86, 0.26, 0.28));   // button deck
      lev.push(tube([off + 0.44, 1.52, 0.05], [off + 0.52, 1.78, 0.05], 0.016)); // lever
      lev.push(new SphereGeometry(0.045, 10, 8).translate(off + 0.52, 1.80, 0.05));
    }
    return { cabinets: merged(cab), screens: merged(scr), frames: merged(frm), decks: merged(dek), levers: merged(lev) };
  }, [count]);
  const [ox, oz] = origin;
  return (
    <group position={[ox, FLOOR_Y, oz]} rotation={[0, ry, 0]}>
      <mesh geometry={cabinets} material={phase ? a.cabinetAlt : a.cabinet} castShadow receiveShadow />
      <mesh geometry={frames} material={a.goldDim} castShadow />
      <mesh geometry={screens} material={phase ? a.screenB : a.screenA} />
      <mesh geometry={decks} material={a.buttonDark} castShadow />
      <mesh geometry={levers} material={a.goldDim} castShadow />
      {/* a gold glow strip along the bank's crown */}
      <mesh material={a.gold} position={[0, 1.735, 0.10]}>
        <boxGeometry args={[count * 1.18 - 0.28, 0.035, 0.03]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* south-corner dressing — the drinks cart SW (blank bottles),   */
/* the chip table SE (plain chip stacks, pattern not words)      */
/* ------------------------------------------------------------------ */

function Corners({ a }: { a: CasinoAssets }) {
  const bottles = useMemo(() => {
    const amber: G[] = [], green: G[] = [];
    const spots: [number, number][] = [[-0.22, 0], [0.02, 0.05], [0.24, -0.03], [-0.08, -0.12], [0.14, 0.13]];
    spots.forEach(([x, z], i) => {
      const hgt = 0.26 + (i % 3) * 0.03;
      const parts = i % 2 ? green : amber;
      parts.push(cyl(0.035, 0.037, hgt * 0.72, x, 0.86 + (hgt * 0.72) / 2, z, 10));
      parts.push(cyl(0.012, 0.023, hgt * 0.28, x, 0.86 + hgt * 0.72 + (hgt * 0.28) / 2, z, 8));
    });
    return { amber: merged(amber), green: merged(green) };
  }, []);
  const chips = useMemo(() => {
    const white: G[] = [], red: G[] = [], blue: G[] = [];
    const stack = (parts: G[], x: number, z: number, n: number) => {
      for (let i = 0; i < n; i++) parts.push(cyl(0.085, 0.085, 0.028, x, 0.80 + i * 0.03, z, 16));
    };
    stack(white, -0.12, 0.05, 5); stack(red, 0.10, -0.08, 7); stack(blue, 0.13, 0.14, 4); stack(white, -0.14, -0.13, 3);
    return { white: merged(white), red: merged(red), blue: merged(blue) };
  }, []);
  return (
    <group position={[0, FLOOR_Y, 0]}>
      {/* the drinks cart, SW corner */}
      <group position={[-3.55, 0, 3.45]} rotation={[0, 0.6, 0]}>
        <mesh material={a.darkWood} position={[0, 0.80, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.95, 0.05, 0.55]} />
        </mesh>
        <mesh material={a.darkWood} position={[0, 0.32, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.9, 0.05, 0.5]} />
        </mesh>
        <mesh geometry={bottles.amber} material={a.glassAmber} castShadow />
        <mesh geometry={bottles.green} material={a.glassGreen} castShadow />
        {([-0.4, 0.4] as const).map((x) => (
          <mesh key={x} material={a.goldDim} position={[x, 0.16, 0.22]}>
            <torusGeometry args={[0.13, 0.018, 8, 20]} />
          </mesh>
        ))}
        <mesh material={a.goldDim} position={[0, 0.56, 0]}>
          <boxGeometry args={[0.85, 0.03, 0.45]} />
        </mesh>
      </group>
      {/* the chip table, SE corner: a small round side table */}
      <group position={[3.5, 0, 3.4]} rotation={[0, -0.4, 0]}>
        <mesh material={a.darkWood} position={[0, 0.76, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.46, 0.46, 0.05, 22]} />
        </mesh>
        <mesh material={a.burgundy} position={[0, 0.745, 0]}>
          <cylinderGeometry args={[0.40, 0.40, 0.02, 22]} />
        </mesh>
        <mesh material={a.goldDim} position={[0, 0.38, 0]} castShadow>
          <cylinderGeometry args={[0.05, 0.07, 0.72, 10]} />
        </mesh>
        <mesh geometry={chips.white} material={a.chipWhite} castShadow />
        <mesh geometry={chips.red} material={a.chipRed} castShadow />
        <mesh geometry={chips.blue} material={a.chipBlue} castShadow />
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */

export default function VegasCasinoRoom({ fxOn }: { fxOn: boolean }) {
  const a = assets();
  useEffect(() => {
    (window as unknown as { __bwmVenue?: unknown }).__bwmVenue = { id: 'vegas', fx: fxOn, studio: true, room: 'vegas-casino', props: false };
  }, [fxOn]);
  return (
    <group>
      <CasinoLights fxOn={fxOn} />
      <CasinoLife a={a} fxOn={fxOn} />
      <CasinoChairs a={a} />
      <Shell a={a} />
      {/* far bank: button decks (nearest face) at z=-3.66; side banks at x=∓3.66 */}
      <SlotBank a={a} origin={[0, -4.02]} ry={0} count={5} phase={0} />
      <SlotBank a={a} origin={[-4.02, 0]} ry={Math.PI / 2} count={3} phase={1} />
      <SlotBank a={a} origin={[4.02, 0]} ry={-Math.PI / 2} count={3} phase={0} />
      <Corners a={a} />
      {/* NO table here — the shared game table is the anchor. */}
    </group>
  );
}
