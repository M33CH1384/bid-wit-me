/**
 * Venue dressing for the 3D table (Release 7): backdrop, floor, procedural props and light ambient motion.
 * Loading order: the table never waits for any of this. Each piece sits in its own Suspense with a flat-colour
 * fallback, and only the chosen venue's files are fetched (a ~50 KB backdrop jpg, a ~50 KB floor jpg, plus a
 * ~100 KB .hdr for lighting in High quality). Props are procedural (no downloads).
 * Reduce effects / Low quality: no ambient particles or motion (smoke, flames, pole spin, water shimmer).
 * The Pj's (blockAfterDark) at High quality dresses as a real 3D street instead (three/PjsStreetRoom.tsx):
 * the environment replaces this file's backdrop + floor for that venue, and PjsLife below stands down
 * (the room carries its own streetlight, grill and smoke). Low keeps the backdrop + floor + PjsLife.
 * A story table carrying stop `king` at High dresses as the King's lounge instead
 * (three/KingLoungeRoom.tsx): the lounge replaces backdrop + floor + props for that table only —
 * Stop 9 and non-story blockAfterDark tables keep the street, byte-for-byte.
 *
 * Batch D (venues rollout, 2026-10-29): Scene mounts this component only for
 * blockAfterDark (classic takes the studio branch; the ten cube venues take
 * their Scene branches), so the per-venue prop sets this file used to carry
 * for the nine cube venues were unreachable — Scene never mounted Venue3D
 * for them — and are removed (~380 lines: the Backyard/Mansion/Church/
 * Rooftop/Speakeasy/Vegas/Beach/Grandma/Yacht sets and their exclusive
 * helpers, the casino-carpet and yacht-deck floor branches). What remains
 * is exactly the live path: backdrop + floor disc + PjsLife for the Pj's
 * at Low, the street room at High, the King's Lounge at the king stop.
 */
import { Environment, useTexture } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import {
  type Group, type InstancedMesh, type PointLight, type Texture, CanvasTexture, DoubleSide, EquirectangularReflectionMapping, Object3D,
  RepeatWrapping, SRGBColorSpace,
} from 'three';
import { type VenueDef, type VenueId, venueAssetUrls } from '../venues';
import { noteRoomAssets } from '../assetGate';
import PjsStreetRoom, { SEDAN_URL } from './PjsStreetRoom';
import KingLoungeRoom from './KingLoungeRoom';
import { flickerAt, glowAt, smokePuffAt, venueLifeFor } from '../venueLife';

const FLOOR_Y = -0.9;

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** felt replacements: gingham vinyl (Grandma) and a plain laminate top (folding / fellowship tables) */
export function feltPatternTexture(kind: 'gingham' | 'laminate', color: string): CanvasTexture {
  const t = canvasTex(256, 256, (g) => {
    if (kind === 'gingham') {
      g.fillStyle = '#c4bdb0'; g.fillRect(0, 0, 256, 256);
      g.fillStyle = color; g.globalAlpha = 0.6;
      for (let i = 0; i < 8; i += 2) { g.fillRect(i * 32, 0, 32, 256); g.fillRect(0, i * 32, 256, 32); }
      g.globalAlpha = 0.35;
      for (let i = 0; i < 8; i += 2) for (let j = 0; j < 8; j += 2) g.fillRect(i * 32, j * 32, 32, 32);
    } else {
      g.fillStyle = color; g.fillRect(0, 0, 256, 256);
      // faint speckle, like a laminate / plastic table top
      for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + Math.random() * 0.04})`; g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5); }
    }
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(kind === 'gingham' ? 2.2 : 1, kind === 'gingham' ? 2.6 : 1);
  return t;
}

/** radial fade so a floor disc melts into the backdrop */
function discAlpha(): CanvasTexture {
  return canvasTex(256, 256, (g) => {
    const r = g.createRadialGradient(128, 128, 60, 128, 128, 128);
    r.addColorStop(0, '#fff'); r.addColorStop(0.72, '#fff'); r.addColorStop(1, '#000');
    g.fillStyle = r; g.fillRect(0, 0, 256, 256);
  }, false);
}

/* ------------------------------------------------------------------ backdrop + lighting env */

function Backdrop({ url, blur, intensity }: { url: string; blur: number; intensity: number }) {
  const tex = useTexture(url) as Texture;
  const { scene, invalidate } = useThree();
  useEffect(() => {
    tex.mapping = EquirectangularReflectionMapping; tex.colorSpace = SRGBColorSpace; tex.needsUpdate = true;
    const prev = { bg: scene.background, blur: scene.backgroundBlurriness, k: scene.backgroundIntensity, fog: scene.fog };
    scene.background = tex; scene.backgroundBlurriness = blur; scene.backgroundIntensity = intensity;
    invalidate();
    // load checks: when the venue backdrop first showed
    const w = window as unknown as { __bwmVenueAt?: number };
    requestAnimationFrame(() => requestAnimationFrame(() => { w.__bwmVenueAt ??= performance.now(); }));
    return () => { scene.background = prev.bg; scene.backgroundBlurriness = prev.blur; scene.backgroundIntensity = prev.k; invalidate(); };
  }, [tex, scene, blur, intensity, invalidate]);
  return null;
}

/* ------------------------------------------------------------------ floor */

function floorMaterialProps(def: VenueDef) {
  return { color: def.floorTint, roughness: def.floorRough, metalness: 0 };
}

function FloorShape({ def, map }: { def: VenueDef; map: Texture | null }) {
  const alpha = useMemo(() => (def.floorRadius ? discAlpha() : null), [def.floorRadius]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} receiveShadow>
      <circleGeometry args={[def.floorRadius ?? 15, 64]} />
      <meshStandardMaterial map={map} alphaMap={alpha} transparent={!!alpha} depthWrite={!alpha} {...floorMaterialProps(def)} />
    </mesh>
  );
}

function TexturedFloor({ def, url }: { def: VenueDef; url: string }) {
  const tex = useTexture(url) as Texture;
  useMemo(() => {
    tex.wrapS = tex.wrapT = RepeatWrapping; tex.colorSpace = SRGBColorSpace;
    tex.repeat.set(def.floorRepeat, def.floorRepeat); tex.anisotropy = 4; tex.needsUpdate = true;
  }, [tex, def]);
  return <FloorShape def={def} map={tex} />;
}

function VenueFloor({ def, url }: { def: VenueDef; url: string | null }) {
  if (!url) return <FloorShape def={def} map={null} />;
  return (
    <Suspense fallback={<FloorShape def={def} map={null} />}>
      <TexturedFloor def={def} url={url} />
    </Suspense>
  );
}

/* ------------------------------------------------------------------ ambient motion (throttled redraws) */

/** frameloop is 'demand': ambient motion asks for ~20 redraws a second, only while something moves */
function AmbientTicker() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const id = window.setInterval(() => { if (!document.hidden) invalidate(); }, 50);
    return () => window.clearInterval(id);
  }, [invalidate]);
  return null;
}

/**
 * Drifting smoke — Wave D: the puffs are the shared life layer's
 * seekable model (venueLife.smokePuffAt): seeded offsets, a looping
 * rise on the venue's own period, no Math.random anywhere — every
 * client sees the same puff at the same t, and the loop cannot drift.
 */
function Smoke({ at, venue = 'backyard', rise = 1.6 }: { at: [number, number, number]; venue?: VenueId; rise?: number }) {
  const life = venueLifeFor(venue);
  const count = life.smoke?.count ?? 0;
  const ref = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const tex = useMemo(() => canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }), []);
  useFrame(({ clock, camera }) => {
    const m = ref.current; if (!m || !life.smoke) return;
    const t = clock.elapsedTime;
    for (let i = 0; i < count; i++) {
      const puff = smokePuffAt(life, i, t, rise);
      dummy.position.set(at[0] + puff.x, at[1] + puff.y, at[2]);
      dummy.quaternion.copy(camera.quaternion);
      // per-puff fade rides the scale (one shared material opacity)
      const k = puff.scale * (0.3 + puff.opacity);
      dummy.scale.set(k, k, k);
      dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  if (!life.smoke) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={tex} color={life.smoke.tint} transparent depthWrite={false} opacity={0.85} />
    </instancedMesh>
  );
}

/** A point light breathing on the venue's life channels (glow × flicker).
 *  fxOn false = the held frame: steady at the glow's midpoint, no motion. */
function LifeGlow({ at, venue, base, fxOn, flicker = false }: { at: [number, number, number]; venue: VenueId; base: number; fxOn: boolean; flicker?: boolean }) {
  const ref = useRef<PointLight>(null);
  const life = venueLifeFor(venue);
  useFrame(({ clock }) => {
    const l = ref.current; if (!l) return;
    if (!fxOn) { l.intensity = base * (life.glow.lo + life.glow.hi) / 2; return; }
    const t = clock.elapsedTime;
    l.intensity = base * glowAt(life, t) * (flicker ? flickerAt(life, t) : 1);
  });
  return <pointLight ref={ref} position={at} color={life.glow.tint} intensity={base} distance={7} decay={2} />;
}

/* ------------------------------------------------------------------ props */

/**
 * The Pj's streetlife (Wave D) — the one venue still dressed by this
 * module, and it shipped with NO life at all: a sodium streetlight that
 * buzzes on the blockAfterDark flicker channel (dips, never a cut —
 * the cut is the set cover's), a kettle grill with drifting smoke, and
 * one lit window across the street breathing on the glow channel.
 * fxOn false = held frame: lamp steady, window lit, no smoke.
 */
function PjsLife({ fxOn }: { fxOn: boolean }) {
  return (
    <group>
      {/* streetlight, back left over the table */}
      <group position={[-3.4, FLOOR_Y, -3.1]}>
        <mesh position={[0, 1.5, 0]} castShadow><cylinderGeometry args={[0.045, 0.06, 3.0, 8]} /><meshStandardMaterial color="#2c2f33" metalness={0.6} roughness={0.5} /></mesh>
        <mesh position={[0.35, 2.98, 0]}><boxGeometry args={[0.8, 0.07, 0.07]} /><meshStandardMaterial color="#2c2f33" metalness={0.6} roughness={0.5} /></mesh>
        <mesh position={[0.72, 2.9, 0]}><sphereGeometry args={[0.11, 12, 10]} /><meshBasicMaterial color="#ffb45c" toneMapped={false} /></mesh>
        <LifeGlow at={[0.72, 2.82, 0]} venue="blockAfterDark" base={7} fxOn={fxOn} flicker />
      </group>
      {/* kettle grill, back right, smoke on the street channel */}
      <group position={[3.2, FLOOR_Y, -2.5]} scale={0.8}>
        <mesh position={[0, 0.78, 0]} castShadow><sphereGeometry args={[0.32, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} /><meshStandardMaterial color="#111" metalness={0.6} roughness={0.35} side={DoubleSide} /></mesh>
        <mesh position={[0, 0.74, 0]}><cylinderGeometry args={[0.24, 0.24, 0.02, 20]} /><meshBasicMaterial color="#8a2a0a" toneMapped={false} /></mesh>
        {[0, 2.1, 4.2].map((a, i) => <mesh key={i} position={[Math.cos(a) * 0.22, 0.32, Math.sin(a) * 0.22]}><cylinderGeometry args={[0.015, 0.015, 0.7, 6]} /><meshStandardMaterial color="#333" /></mesh>)}
      </group>
      {fxOn && <Smoke at={[3.2, -0.02, -2.5]} venue="blockAfterDark" />}
      {/* one lit window across the street */}
      <group position={[4.6, FLOOR_Y, -4.4]}>
        <mesh position={[0, 1.5, 0]}><planeGeometry args={[0.7, 0.95]} /><meshBasicMaterial color="#ffcf8a" toneMapped={false} /></mesh>
        <mesh position={[0, 1.5, 0.01]}><boxGeometry args={[0.05, 0.95, 0.02]} /><meshStandardMaterial color="#1a140d" /></mesh>
        <mesh position={[0, 1.5, 0.01]}><boxGeometry args={[0.7, 0.05, 0.02]} /><meshStandardMaterial color="#1a140d" /></mesh>
        <LifeGlow at={[0, 1.5, 0.5]} venue="blockAfterDark" base={1.6} fxOn={fxOn} />
      </group>
    </group>
  );
}

export function VenueProps({ id, fxOn, env3d = false, handKey, king = false }: { id: VenueId; fxOn: boolean; env3d?: boolean; handKey?: number; king?: boolean }) {
  switch (id) {
    case 'blockAfterDark': return king ? <KingLoungeRoom fxOn={fxOn} /> : env3d ? <PjsStreetRoom fxOn={fxOn} handKey={handKey} /> : <PjsLife fxOn={fxOn} />;
    default: return null;
  }
}

/** venues with ambient motion (only animated when effects are on) */
const MOVES: Partial<Record<VenueId, true>> = { blockAfterDark: true };

/** Everything around the table for one venue. Mounted inside the Canvas; never suspends the table. */
export default function Venue3D({ def, quality, reduceFx, handKey, storyStopId }: { def: VenueDef; quality: 'high' | 'low'; reduceFx: boolean; handKey?: number; storyStopId?: string | null }) {
  const urls = venueAssetUrls(def.id, quality);
  const fxOn = !reduceFx && quality === 'high';
  // The King's lounge (story Stop 11) at High: the plum-and-gold lounge
  // (three/KingLoungeRoom.tsx) replaces the backdrop + floor + props for a
  // table carrying story stop `king` — the King no longer inherits the Pj's
  // street. Stop 9 (The Pj's) and every non-story blockAfterDark table keep
  // the street path below exactly; Low keeps backdrop + floor + PjsLife.
  const kingActive = def.id === 'blockAfterDark' && storyStopId === 'king' && quality === 'high';
  // The Pj's at High: the 3D street environment replaces the static backdrop + floor disc
  // (it brings its own ground) and stands the backdrop-level PjsLife dressing down. Low
  // quality keeps the shipped backdrop + floor + PjsLife exactly — the fallback is the
  // current behaviour, not a new invention.
  const envActive = def.id === 'blockAfterDark' && quality === 'high' && !kingActive;
  const env3d = envActive || kingActive;
  const g = useRef<Group>(null);
  // for checks: which venue is dressed and whether its ambient motion runs
  useEffect(() => { (window as unknown as { __bwmVenue?: { id: string; fx: boolean; env3d?: boolean } }).__bwmVenue = { id: def.id, fx: fxOn && !!MOVES[def.id], ...(def.id === 'blockAfterDark' ? { env3d } : {}) }; }, [def.id, fxOn, env3d]);
  return (
    <group ref={g}>
      <Suspense fallback={null}>{urls.bg && !env3d && <Backdrop url={urls.bg} blur={def.bgBlur} intensity={def.bgIntensity} />}</Suspense>
      <Suspense fallback={null}>{urls.env && <Environment files={urls.env} environmentIntensity={def.envIntensity} />}</Suspense>
      {!env3d && <VenueFloor def={def} url={urls.floor} />}
      <VenueProps id={def.id} fxOn={fxOn} env3d={envActive} handKey={handKey} king={kingActive} />
      {fxOn && MOVES[def.id] && <AmbientTicker />}
    </group>
  );
}

/**
 * Loader warm-up (three/preload.ts): only this venue's files, fetched at LOW priority into the HTTP cache a beat after
 * the table's own textures, so they never compete with the table. (The rail texture rides with the table.)
 */
export function preloadVenueAssets(id: VenueId, quality: 'high' | 'low'): void {
  const u = venueAssetUrls(id, quality);
  if (u.rail) useTexture.preload(u.rail);
  const rest = [u.bg, u.floor, u.env].filter((x): x is string => !!x);
  // The Pj's street environment (High only): warm the sedan GLB with the same low-priority pass.
  if (id === 'blockAfterDark' && quality === 'high') rest.push(SEDAN_URL);
  // Asset gate: note the venue's files so the table loader can wait on them (assetGate.ts).
  noteRoomAssets(id, [...rest, ...(u.rail ? [u.rail] : [])]);
  window.setTimeout(() => rest.forEach((url) => { void fetch(url, { priority: 'low' } as RequestInit).catch(() => undefined); }), 1500);
}

