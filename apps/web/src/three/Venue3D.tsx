/**
 * Venue dressing for the 3D table (Release 7): backdrop, floor, procedural props and light ambient motion.
 * Loading order: the table never waits for any of this. Each piece sits in its own Suspense with a flat-colour
 * fallback, and only the chosen venue's files are fetched (a ~50 KB backdrop jpg, a ~50 KB floor jpg, plus a
 * ~100 KB .hdr for lighting in High quality). Props are procedural (no downloads).
 * Reduce effects / Low quality: no ambient particles or motion (smoke, flames, pole spin, water shimmer).
 * The Pj's (blockAfterDark) at High quality dresses as a real 3D street instead (three/PjsStreetRoom.tsx):
 * the environment replaces this file's backdrop + floor for that venue, and PjsLife below stands down
 * (the room carries its own streetlight, grill and smoke). Low keeps the backdrop + floor + PjsLife.
 */
import { Environment, useTexture } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import {
  type Group, type InstancedMesh, type Mesh, type PointLight, type Texture, AdditiveBlending, CanvasTexture, DoubleSide, EquirectangularReflectionMapping, Object3D,
  RepeatWrapping, SRGBColorSpace,
} from 'three';
import { type VenueDef, type VenueId, venueAssetUrls } from '../venues';
import PjsStreetRoom, { SEDAN_URL } from './PjsStreetRoom';
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

function casinoCarpet(): CanvasTexture {
  const t = canvasTex(256, 256, (g) => {
    g.fillStyle = '#4a0b26'; g.fillRect(0, 0, 256, 256);
    const cols = ['#c9a227', '#1f6f8b', '#d9480f', '#7b2cbf'];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const cx = x * 64 + 32, cy = y * 64 + 32;
      g.strokeStyle = cols[(x + y) % 4]!; g.lineWidth = 4;
      g.beginPath(); for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 22, cy + Math.sin(a) * 22); } g.stroke();
      g.fillStyle = cols[(x + y + 2) % 4]!; g.beginPath(); g.arc(cx, cy, 7, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#2a0614'; g.lineWidth = 2; g.strokeRect(x * 64 + 2, y * 64 + 2, 60, 60);
    }
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

function signTexture(text: string, color: string, sub?: string): CanvasTexture {
  return canvasTex(512, 192, (g) => {
    g.clearRect(0, 0, 512, 192);
    g.font = '900 104px "Barlow Condensed", Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 28; g.fillStyle = color;
    g.fillText(text, 256, sub ? 78 : 96); g.shadowBlur = 10; g.fillStyle = '#fff'; g.globalAlpha = 0.85; g.fillText(text, 256, sub ? 78 : 96);
    if (sub) { g.globalAlpha = 1; g.font = '700 40px "Barlow Condensed", Arial, sans-serif'; g.shadowBlur = 16; g.fillStyle = color; g.fillText(sub, 256, 158); }
  });
}

function windowsTexture(seed: number): CanvasTexture {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return canvasTex(64, 128, (g) => {
    g.fillStyle = '#0b0d16'; g.fillRect(0, 0, 64, 128);
    for (let y = 4; y < 124; y += 8) for (let x = 4; x < 60; x += 8) {
      if (rnd() < 0.42) { g.fillStyle = rnd() < 0.8 ? '#ffd58a' : '#9fd8ff'; g.globalAlpha = 0.5 + rnd() * 0.5; g.fillRect(x, y, 5, 5); }
    }
  });
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
  if (def.id === 'yacht') {
    // the deck: a long teak plank floor, open water past the rails (see YachtProps)
    return (
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, -0.6]} receiveShadow>
        <planeGeometry args={[7.4, 11]} />
        <meshStandardMaterial map={map} {...floorMaterialProps(def)} />
      </mesh>
    );
  }
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
    tex.repeat.set(def.floorRepeat, def.id === 'yacht' ? def.floorRepeat * 1.5 : def.floorRepeat); tex.anisotropy = 4; tex.needsUpdate = true;
  }, [tex, def]);
  return <FloorShape def={def} map={tex} />;
}

function VenueFloor({ def, url }: { def: VenueDef; url: string | null }) {
  const carpet = useMemo(() => (def.id === 'vegas' ? casinoCarpet() : null), [def.id]);
  if (carpet) { carpet.repeat.set(def.floorRepeat, def.floorRepeat); return <FloorShape def={def} map={carpet} />; }
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

function Flame({ at, animate }: { at: [number, number, number]; animate: boolean }) {
  const ref = useRef<Mesh>(null);
  const tex = useMemo(() => canvasTex(64, 128, (g) => { const r = g.createRadialGradient(32, 92, 2, 32, 80, 60); r.addColorStop(0, 'rgba(255,250,210,1)'); r.addColorStop(0.35, 'rgba(255,170,40,0.9)'); r.addColorStop(1, 'rgba(255,60,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 128); }), []);
  useFrame(({ clock, camera }) => {
    const m = ref.current; if (!m) return;
    m.quaternion.copy(camera.quaternion);
    // torch flame rides the beach flicker channel (seekable, seeded)
    if (animate) { const f = flickerAt(venueLifeFor('beach'), clock.elapsedTime + at[0]); m.scale.set(0.92 + f * 0.14, 0.82 + f * 0.34, 1); }
  });
  return (
    <group position={at}>
      <mesh ref={ref} position={[0, 0.12, 0]}>
        <planeGeometry args={[0.22, 0.44]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 0.2, 0]} color="#ff9a3d" intensity={2.2} distance={4} decay={2} />
    </group>
  );
}

/* ------------------------------------------------------------------ props */

const Bulb = ({ p, c = '#ffd58a', r = 0.045 }: { p: [number, number, number]; c?: string; r?: number }) => (
  <mesh position={p}><sphereGeometry args={[r, 10, 8]} /><meshBasicMaterial color={c} toneMapped={false} /></mesh>
);

function StringLights({ from, to, sag = 0.35, n = 14, color = '#ffd58a' }: { from: [number, number, number]; to: [number, number, number]; sag?: number; n?: number; color?: string }) {
  const pts = useMemo(() => Array.from({ length: n }, (_, i) => {
    const u = i / (n - 1);
    return [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u - Math.sin(u * Math.PI) * sag, from[2] + (to[2] - from[2]) * u] as [number, number, number];
  }), [from, to, sag, n]);
  return (
    <group>
      {pts.map((p, i) => <Bulb key={i} p={p} c={color} />)}
      {pts.slice(1).map((p, i) => {
        const a = pts[i]!; const mid: [number, number, number] = [(a[0] + p[0]) / 2, (a[1] + p[1]) / 2 + 0.03, (a[2] + p[2]) / 2];
        const len = Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]);
        const o = new Object3D(); o.position.set(...mid); o.lookAt(p[0], p[1] + 0.03, p[2]);
        return <mesh key={`w${i}`} position={mid} quaternion={o.quaternion}><boxGeometry args={[0.008, 0.008, len]} /><meshBasicMaterial color="#222" /></mesh>;
      })}
    </group>
  );
}

function FoldingChair({ p, rotY = 0, color = '#8d939b' }: { p: [number, number, number]; rotY?: number; color?: string }) {
  return (
    <group position={p} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.45, 0]} castShadow><boxGeometry args={[0.42, 0.04, 0.4]} /><meshStandardMaterial color={color} metalness={0.5} roughness={0.45} /></mesh>
      <mesh position={[0, 0.78, -0.2]} castShadow><boxGeometry args={[0.42, 0.3, 0.03]} /><meshStandardMaterial color={color} metalness={0.5} roughness={0.45} /></mesh>
      {[[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]].map(([x, z], i) => (
        <mesh key={i} position={[x!, 0.22, z!]}><cylinderGeometry args={[0.012, 0.012, 0.45, 6]} /><meshStandardMaterial color="#555b63" metalness={0.7} roughness={0.35} /></mesh>
      ))}
    </group>
  );
}

function Neon({ text, color, sub, p, w = 2.2, rotY = 0 }: { text: string; color: string; sub?: string; p: [number, number, number]; w?: number; rotY?: number }) {
  const tex = useMemo(() => signTexture(text, color, sub), [text, color, sub]);
  return (
    <group position={p} rotation={[0, rotY, 0]}>
      <mesh><planeGeometry args={[w, w * 0.375]} /><meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} /></mesh>
      <pointLight position={[0, 0, 0.6]} color={color} intensity={4} distance={6} decay={2} />
    </group>
  );
}

function Backyard({ fxOn }: { fxOn: boolean }) {
  return (
    <group>
      {/* string-light poles + two strands across the back */}
      {[[-4.6, -3.6], [4.6, -3.6], [-4.6, 1.2], [4.6, 1.2]].map(([x, z], i) => (
        <mesh key={i} position={[x!, 0.4, z!]} castShadow><cylinderGeometry args={[0.04, 0.05, 2.6, 8]} /><meshStandardMaterial color="#5a4632" roughness={0.9} /></mesh>
      ))}
      <StringLights from={[-4.6, 1.6, -3.6]} to={[4.6, 1.6, -3.6]} sag={0.5} n={18} />
      <StringLights from={[-4.6, 1.6, -3.6]} to={[-4.6, 1.6, 1.2]} sag={0.4} n={10} />
      <StringLights from={[4.6, 1.6, -3.6]} to={[4.6, 1.6, 1.2]} sag={0.4} n={10} />
      <pointLight position={[0, 1.2, -3.4]} color="#ffcf8a" intensity={6} distance={7} decay={2} />
      {/* kettle grill, back left */}
      <group position={[-3.3, FLOOR_Y, -2.4]} scale={0.8}>
        <mesh position={[0, 0.78, 0]} castShadow><sphereGeometry args={[0.32, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} /><meshStandardMaterial color="#111" metalness={0.6} roughness={0.35} side={DoubleSide} /></mesh>
        <mesh position={[0, 0.74, 0]}><cylinderGeometry args={[0.24, 0.24, 0.02, 20]} /><meshBasicMaterial color="#8a2a0a" toneMapped={false} /></mesh>
        <mesh position={[0, 0.78, 0]}><cylinderGeometry args={[0.3, 0.3, 0.006, 20, 1, true]} /><meshStandardMaterial color="#666" metalness={0.8} roughness={0.4} wireframe /></mesh>
        {[0, 2.1, 4.2].map((a, i) => <mesh key={i} position={[Math.cos(a) * 0.22, 0.32, Math.sin(a) * 0.22]}><cylinderGeometry args={[0.015, 0.015, 0.7, 6]} /><meshStandardMaterial color="#333" /></mesh>)}
        <pointLight position={[0, 1.0, 0]} color="#ff7a2a" intensity={2.5} distance={3} decay={2} />
      </group>
      {fxOn && <Smoke at={[-3.3, -0.05, -2.4]} />}
      {/* cooler, back right */}
      <group position={[3.2, FLOOR_Y + 0.22, -2.2]} rotation={[0, -0.4, 0]}>
        <mesh castShadow><boxGeometry args={[0.7, 0.42, 0.42]} /><meshStandardMaterial color="#1e5fbf" roughness={0.5} /></mesh>
        <mesh position={[0, 0.23, 0]}><boxGeometry args={[0.72, 0.06, 0.44]} /><meshStandardMaterial color="#f2f2f2" roughness={0.5} /></mesh>
      </group>
      <FoldingChair p={[3.4, FLOOR_Y, 0.2]} rotY={-1.2} color="#2c6e49" />
      <FoldingChair p={[-3.5, FLOOR_Y, 0.4]} rotY={1.3} color="#2c6e49" />
    </group>
  );
}

function Mansion({ fxOn }: { fxOn: boolean }) {
  return (
    <group>
      {/* marble columns and a chandelier glow at the back */}
      {[-3.8, 3.8].map((x) => [-3.2, 0.6].map((z) => (
        <group key={`${x}${z}`} position={[x, FLOOR_Y, z]}>
          <mesh position={[0, 1.6, 0]} castShadow><cylinderGeometry args={[0.24, 0.26, 3.2, 20]} /><meshStandardMaterial color="#f4f1ea" roughness={0.25} /></mesh>
          <mesh position={[0, 0.08, 0]}><boxGeometry args={[0.66, 0.16, 0.66]} /><meshStandardMaterial color="#e9e3d8" roughness={0.3} /></mesh>
        </group>
      )))}
      <group position={[0, 1.55, -3.0]}>
        {Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2; return <Bulb key={i} p={[Math.cos(a) * 0.55, Math.sin(i * 1.7) * 0.06, Math.sin(a) * 0.55]} c="#fff4d6" r={0.05} />; })}
        {Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2; return <Bulb key={`b${i}`} p={[Math.cos(a) * 0.3, -0.22, Math.sin(a) * 0.3]} c="#e8f4ff" r={0.04} />; })}
        <LifeGlow at={[0, 0, 0]} venue="mansion" base={8} fxOn={fxOn} />
      </group>
      {/* a red runner carpet from the table to the back */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y + 0.004, -4.5]}><planeGeometry args={[1.6, 5]} /><meshStandardMaterial color="#7a0f1c" roughness={0.9} /></mesh>
    </group>
  );
}

function Church() {
  const banner = useMemo(() => canvasTex(512, 128, (g) => { g.fillStyle = '#f3ead2'; g.fillRect(0, 0, 512, 128); g.fillStyle = '#5b2a86'; g.font = '800 54px "Barlow Condensed", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('FELLOWSHIP HALL', 256, 52); g.font = '600 26px "Barlow Condensed", Arial, sans-serif'; g.fillStyle = '#7a5a2a'; g.fillText('Spades Night · Coffee in the back', 256, 100); }), []);
  return (
    <group>
      <mesh position={[0, 0.6, -4.6]} receiveShadow><planeGeometry args={[14, 3]} /><meshStandardMaterial color="#d9d2bf" roughness={0.9} /></mesh>
      <mesh position={[0, -0.2, -4.55]}><planeGeometry args={[3.2, 0.8]} /><meshStandardMaterial map={banner} roughness={0.9} /></mesh>
      {/* fluorescent panels */}
      {[-2.2, 2.2].map((x) => <mesh key={x} position={[x, 2.4, -2.4]} rotation={[Math.PI / 2, 0, 0]}><planeGeometry args={[1.4, 0.3]} /><meshBasicMaterial color="#eef6ff" toneMapped={false} side={DoubleSide} /></mesh>)}
      {/* rows of folding chairs at the back + the coffee urn table */}
      {[-3.2, -2.4, -1.6, 1.6, 2.4, 3.2].map((x) => <FoldingChair key={x} p={[x, FLOOR_Y, -3.6]} />)}
      {[-3.6, 3.6].map((x) => <FoldingChair key={`s${x}`} p={[x, FLOOR_Y, -0.6]} rotY={x < 0 ? 1.4 : -1.4} />)}
      <group position={[3.4, FLOOR_Y, -2.4]}>
        <mesh position={[0, 0.36, 0]} castShadow><boxGeometry args={[1.0, 0.04, 0.5]} /><meshStandardMaterial color="#cdbf9f" roughness={0.6} /></mesh>
        <mesh position={[0.2, 0.58, 0]} castShadow><cylinderGeometry args={[0.1, 0.11, 0.4, 16]} /><meshStandardMaterial color="#cfd3d8" metalness={0.9} roughness={0.2} /></mesh>
        {[-0.3, -0.18, -0.06].map((x) => <mesh key={x} position={[x, 0.42, 0.05]}><cylinderGeometry args={[0.035, 0.03, 0.09, 10]} /><meshStandardMaterial color="#f4f4f4" /></mesh>)}
        {[[-0.45, -0.2], [0.45, -0.2], [-0.45, 0.2], [0.45, 0.2]].map(([x, z], i) => <mesh key={i} position={[x!, 0.18, z!]}><cylinderGeometry args={[0.012, 0.012, 0.36, 6]} /><meshStandardMaterial color="#555" /></mesh>)}
      </group>
    </group>
  );
}

function Rooftop() {
  const bldgs = useMemo(() => {
    const out: { x: number; z: number; w: number; d: number; h: number; tex: Texture }[] = [];
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const texs = [1, 2, 3, 4].map((k) => { const t = windowsTexture(k * 977); t.wrapS = t.wrapT = RepeatWrapping; return t; });
    for (let i = 0; i < 46; i++) {
      const a = Math.PI * (1.05 + rnd() * 0.9); const r = 9 + rnd() * 9;
      out.push({ x: Math.cos(a) * r, z: Math.sin(a) * r * 0.9 - 1, w: 1 + rnd() * 1.6, d: 1 + rnd() * 1.6, h: 6 + rnd() * 14, tex: texs[i % 4]! });
    }
    for (let i = 0; i < 16; i++) { const side = i % 2 ? 1 : -1; out.push({ x: side * (8 + rnd() * 6), z: -1 + rnd() * 6, w: 1.2 + rnd(), d: 1.2 + rnd(), h: 6 + rnd() * 10, tex: texs[i % 4]! }); }
    return out;
  }, []);
  return (
    <group>
      {/* parapet around the roof, then the city below and around */}
      {[[0, -6.2, 13, 0.3], [-6.4, -0.6, 0.3, 11.5], [6.4, -0.6, 0.3, 11.5]].map(([x, z, w, d], i) => (
        <mesh key={i} position={[x!, FLOOR_Y + 0.35, z!]} castShadow receiveShadow><boxGeometry args={[w!, 0.7, d!]} /><meshStandardMaterial color="#4a4a52" roughness={0.9} /></mesh>
      ))}
      {bldgs.map((b, i) => (
        <mesh key={i} position={[b.x, FLOOR_Y - 12 + b.h / 2, b.z]}>
          <boxGeometry args={[b.w, b.h, b.d]} />
          <meshBasicMaterial map={b.tex} toneMapped={false} color="#c8c8d8" />
        </mesh>
      ))}
      <StringLights from={[-6.2, 1.3, -6.0]} to={[6.2, 1.3, -6.0]} sag={0.5} n={20} color="#ffe2a6" />
      {/* rooftop AC unit + water-tower legs for silhouette */}
      <group position={[-4.4, FLOOR_Y, -3.8]}>
        <mesh position={[0, 0.4, 0]} castShadow><boxGeometry args={[1.2, 0.8, 0.9]} /><meshStandardMaterial color="#8a8f96" metalness={0.4} roughness={0.5} /></mesh>
        <mesh position={[0, 0.81, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.32, 20]} /><meshStandardMaterial color="#222" /></mesh>
      </group>
      <pointLight position={[0, 1.4, -5.6]} color="#ffd9a0" intensity={5} distance={8} decay={2} />
    </group>
  );
}

function Speakeasy({ fxOn }: { fxOn: boolean }) {
  const bottles = useMemo(() => Array.from({ length: 22 }, (_, i) => ({ x: -3 + i * 0.28, h: 0.24 + ((i * 37) % 10) / 60, c: ['#3a7a3a', '#8a5a1a', '#c9a227', '#6a1a1a', '#2a4a7a'][i % 5]! })), []);
  return (
    <group>
      <mesh position={[0, 0.6, -4.4]} receiveShadow><planeGeometry args={[14, 3]} /><meshStandardMaterial color="#3a1712" roughness={0.95} /></mesh>
      {/* back bar: shelf of bottles lit from below */}
      <mesh position={[0, -0.25, -4.25]}><boxGeometry args={[7, 0.05, 0.25]} /><meshStandardMaterial color="#2a140c" roughness={0.6} /></mesh>
      {bottles.map((b, i) => <mesh key={i} position={[b.x + 0.05, -0.22 + b.h / 2, -4.22]}><cylinderGeometry args={[0.045, 0.05, b.h, 10]} /><meshStandardMaterial color={b.c} roughness={0.15} transparent opacity={0.85} emissive={b.c} emissiveIntensity={0.25} /></mesh>)}
      <mesh position={[0, -0.27, -4.15]}><boxGeometry args={[7, 0.015, 0.02]} /><meshBasicMaterial color="#ffb35c" toneMapped={false} /></mesh>
      {[-3.2, 3.2].map((x) => <group key={x} position={[x, 0.2, -4.3]}><Bulb p={[0, 0, 0]} c="#ffb35c" r={0.08} /><pointLight color="#ff9a3d" intensity={4} distance={5} decay={2} /></group>)}
      {/* velvet booths at the sides */}
      {[-3.8, 3.8].map((x) => (
        <group key={x} position={[x, FLOOR_Y, -1.2]} rotation={[0, x < 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
          <mesh position={[0, 0.25, 0]} castShadow><boxGeometry args={[2.4, 0.5, 0.7]} /><meshStandardMaterial color="#5a0e1a" roughness={0.85} /></mesh>
          <mesh position={[0, 0.75, -0.3]} castShadow><boxGeometry args={[2.4, 0.9, 0.18]} /><meshStandardMaterial color="#5a0e1a" roughness={0.85} /></mesh>
        </group>
      ))}
      <Neon text="JAZZ" color="#ffb35c" p={[0, 0.25, -4.3]} w={1.4} />
      {/* lounge life: the amber room glow breathes on the speakeasy channel */}
      <LifeGlow at={[0, 0.7, -3.4]} venue="speakeasy" base={2.4} fxOn={fxOn} />
    </group>
  );
}

function ChipStack({ p, color, n }: { p: [number, number, number]; color: string; n: number }) {
  return (
    <group position={p}>
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} position={[0, i * 0.016, 0]} castShadow><cylinderGeometry args={[0.055, 0.055, 0.014, 18]} /><meshStandardMaterial color={i % 2 ? color : '#f4f4f4'} roughness={0.4} /></mesh>
      ))}
    </group>
  );
}

function Vegas() {
  const slots = [-3.6, -2.6, 2.6, 3.6];
  const screen = useMemo(() => canvasTex(128, 96, (g) => { g.fillStyle = '#120018'; g.fillRect(0, 0, 128, 96); ['🍒', '7', '💎'].forEach((s, i) => { g.fillStyle = '#fff'; g.fillRect(8 + i * 40, 22, 32, 44); g.fillStyle = i === 1 ? '#d01c2a' : '#111'; g.font = 'bold 30px Arial'; g.textAlign = 'center'; g.fillText(s, 24 + i * 40, 56); }); }), []);
  return (
    <group>
      {/* chips on the rail corners */}
      <ChipStack p={[1.45, 0.075, 1.75]} color="#d01c2a" n={9} />
      <ChipStack p={[1.58, 0.075, 1.6]} color="#1d3fbf" n={6} />
      <ChipStack p={[-1.5, 0.075, -1.75]} color="#2a8a3a" n={8} />
      <ChipStack p={[-1.38, 0.075, -1.86]} color="#111111" n={5} />
      {/* slot machines at the back */}
      {slots.map((x) => (
        <group key={x} position={[x, FLOOR_Y, -3.6]}>
          <mesh position={[0, 0.7, 0]} castShadow><boxGeometry args={[0.7, 1.4, 0.6]} /><meshStandardMaterial color="#2a0a3a" metalness={0.5} roughness={0.35} /></mesh>
          <mesh position={[0, 0.95, 0.31]}><planeGeometry args={[0.5, 0.36]} /><meshBasicMaterial map={screen} toneMapped={false} /></mesh>
          <mesh position={[0, 1.45, 0]}><boxGeometry args={[0.72, 0.12, 0.62]} /><meshBasicMaterial color={x < 0 ? '#ffcc33' : '#ff3d7f'} toneMapped={false} /></mesh>
        </group>
      ))}
      <Neon text="JACKPOT" color="#ffcc33" p={[0, 0.35, -4.4]} w={2.4} />
      <mesh position={[0, 0.6, -4.5]}><planeGeometry args={[14, 3]} /><meshStandardMaterial color="#1a0612" roughness={0.9} /></mesh>
      <pointLight position={[-3, 0.8, -3]} color="#ff3d7f" intensity={3} distance={5} decay={2} />
      <pointLight position={[3, 0.8, -3]} color="#ffcc33" intensity={3} distance={5} decay={2} />
    </group>
  );
}

function Palm({ p, lean = 0.15 }: { p: [number, number, number]; lean?: number }) {
  return (
    <group position={p} rotation={[0, 0, lean]}>
      {Array.from({ length: 7 }, (_, i) => <mesh key={i} position={[i * 0.04, 0.25 + i * 0.5, 0]} castShadow><cylinderGeometry args={[0.1 - i * 0.006, 0.12 - i * 0.006, 0.5, 10]} /><meshStandardMaterial color="#7a5a3a" roughness={0.95} /></mesh>)}
      {Array.from({ length: 7 }, (_, i) => { const a = (i / 7) * Math.PI * 2; return (
        <mesh key={`f${i}`} position={[0.28 + Math.cos(a) * 0.6, 3.6, Math.sin(a) * 0.6]} rotation={[Math.sin(a) * 0.5, -a, -Math.cos(a) * 0.5 + 0.3]} castShadow>
          <boxGeometry args={[1.4, 0.02, 0.32]} /><meshStandardMaterial color="#2f6b2a" roughness={0.8} side={DoubleSide} />
        </mesh>
      ); })}
    </group>
  );
}

function Beach({ fxOn }: { fxOn: boolean }) {
  return (
    <group>
      {/* sea past the sand */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y - 0.05, -14]}><planeGeometry args={[80, 20]} /><meshStandardMaterial color="#1f4f6a" roughness={0.15} metalness={0.3} /></mesh>
      {[[-3.8, -2.6], [3.8, -2.6], [-3.9, 0.9], [3.9, 0.9]].map(([x, z], i) => (
        <group key={i} position={[x!, FLOOR_Y, z!]}>
          <mesh position={[0, 0.7, 0]} castShadow><cylinderGeometry args={[0.035, 0.045, 1.4, 8]} /><meshStandardMaterial color="#8a6a3a" roughness={0.9} /></mesh>
          <mesh position={[0, 1.45, 0]}><cylinderGeometry args={[0.07, 0.05, 0.14, 10]} /><meshStandardMaterial color="#3a2a1a" /></mesh>
          <Flame at={[0, 1.52, 0]} animate={fxOn} />
        </group>
      ))}
      <Palm p={[-5.2, FLOOR_Y, -4.2]} lean={0.18} />
      <Palm p={[5.4, FLOOR_Y, -3.4]} lean={-0.22} />
      {/* cabana: four bamboo posts + a thatch roof edge at the back */}
      <mesh position={[0, 1.6, -3.6]} rotation={[0.25, 0, 0]} castShadow><boxGeometry args={[6, 0.08, 1.4]} /><meshStandardMaterial color="#c9a46a" roughness={1} /></mesh>
      {[-2.8, 2.8].map((x) => <mesh key={x} position={[x, 0.35, -3.6]} castShadow><cylinderGeometry args={[0.06, 0.06, 2.5, 8]} /><meshStandardMaterial color="#e0b878" roughness={0.8} /></mesh>)}
    </group>
  );
}

function Grandma({ fxOn }: { fxOn: boolean }) {
  const wallpaper = useMemo(() => {
    const t = canvasTex(128, 128, (g) => { g.fillStyle = '#efe0b8'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#c98a6a'; for (let y = 0; y < 128; y += 32) for (let x = (y / 32) % 2 ? 16 : 0; x < 128; x += 32) { g.beginPath(); g.arc(x + 8, y + 8, 5, 0, Math.PI * 2); g.fill(); } g.fillStyle = '#7a9a6a'; g.fillRect(0, 0, 3, 128); g.fillRect(64, 0, 3, 128); });
    t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(10, 2.5); return t;
  }, []);
  const clock = useMemo(() => canvasTex(128, 128, (g) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#7a1a1a'; g.lineWidth = 6; g.stroke(); g.fillStyle = '#222'; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.fillRect(64 + Math.cos(a) * 48 - 2, 64 + Math.sin(a) * 48 - 2, 4, 4); } g.strokeStyle = '#222'; g.lineWidth = 4; g.beginPath(); g.moveTo(64, 64); g.lineTo(64, 28); g.moveTo(64, 64); g.lineTo(90, 70); g.stroke(); }), []);
  return (
    <group>
      <mesh position={[0, 0.6, -4.4]} receiveShadow><planeGeometry args={[14, 3]} /><meshStandardMaterial map={wallpaper} roughness={0.9} /></mesh>
      <mesh position={[0, 0.6, -4.38]}><circleGeometry args={[0.32, 32]} /><meshStandardMaterial map={clock} roughness={0.5} /></mesh>
      {/* the good couch, still in its plastic */}
      <group position={[-2.8, FLOOR_Y, -3.7]}>
        <mesh position={[0, 0.3, 0]} castShadow><boxGeometry args={[2.0, 0.42, 0.8]} /><meshPhysicalMaterial color="#b3874a" roughness={0.75} clearcoat={1} clearcoatRoughness={0.05} /></mesh>
        <mesh position={[0, 0.75, -0.32]} castShadow><boxGeometry args={[2.0, 0.6, 0.18]} /><meshPhysicalMaterial color="#b3874a" roughness={0.75} clearcoat={1} clearcoatRoughness={0.05} /></mesh>
        {[-0.95, 0.95].map((x) => <mesh key={x} position={[x, 0.5, 0]} castShadow><boxGeometry args={[0.18, 0.5, 0.8]} /><meshPhysicalMaterial color="#9a6e3a" roughness={0.75} clearcoat={1} clearcoatRoughness={0.05} /></mesh>)}
      </group>
      {/* fridge + counter on the right */}
      <mesh position={[3.6, FLOOR_Y + 0.9, -3.8]} castShadow><boxGeometry args={[0.9, 1.8, 0.75]} /><meshStandardMaterial color="#e8e2c8" roughness={0.35} /></mesh>
      <mesh position={[2.3, FLOOR_Y + 0.45, -4.0]} castShadow><boxGeometry args={[1.6, 0.9, 0.6]} /><meshStandardMaterial color="#8a5a3a" roughness={0.6} /></mesh>
      <mesh position={[2.3, FLOOR_Y + 0.92, -4.0]}><boxGeometry args={[1.64, 0.04, 0.64]} /><meshStandardMaterial color="#d8c8a0" roughness={0.4} /></mesh>
      {/* a sweet potato pie cooling — Wave D kitchen life: steam wisps
          off the pie on the grandma channel (6 puffs, slow, warm) */}
      <mesh position={[2.1, FLOOR_Y + 0.97, -3.95]}><cylinderGeometry args={[0.16, 0.13, 0.05, 20]} /><meshStandardMaterial color="#c8642a" roughness={0.7} /></mesh>
      {fxOn && <Smoke at={[2.1, FLOOR_Y + 1.0, -3.95]} venue="grandma" rise={0.5} />}
      <LifeGlow at={[0, 1.6, -2]} venue="grandma" base={5} fxOn={fxOn} />
    </group>
  );
}

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

function Yacht({ fxOn }: { fxOn: boolean }) {
  const water = useRef<Mesh>(null);
  const ripple = useMemo(() => {
    const t = canvasTex(256, 256, (g) => { g.fillStyle = '#1b4e78'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '160,210,255' : '10,40,70'},${0.08 + Math.random() * 0.12})`; g.fillRect(Math.random() * 256, Math.random() * 256, 6 + Math.random() * 14, 1.5); } });
    t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(14, 14); return t;
  }, []);
  // water drift is a pure function of the frame clock (seekable) — the
  // old dt-accumulation drifted with frame rate and could never be held
  useFrame(({ clock }) => { if (fxOn) { const t = clock.elapsedTime; ripple.offset.set((t * 0.006) % 1, (t * 0.012) % 1); } });
  const posts = useMemo(() => {
    const out: [number, number][] = [];
    for (let z = -5.8; z <= 4.6; z += 0.9) { out.push([-3.6, z], [3.6, z]); }
    for (let x = -3.6; x <= 3.6; x += 0.9) out.push([x, -6.0]);
    return out;
  }, []);
  return (
    <group>
      <mesh ref={water} rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y - 1.2, 0]}><planeGeometry args={[120, 120]} /><meshStandardMaterial map={ripple} roughness={0.2} metalness={0.2} /></mesh>
      {/* hull sides under the deck */}
      {[-3.72, 3.72].map((x) => <mesh key={x} position={[x, FLOOR_Y - 0.6, -0.6]}><boxGeometry args={[0.12, 1.2, 11]} /><meshStandardMaterial color="#f4f6f8" roughness={0.3} /></mesh>)}
      <mesh position={[0, FLOOR_Y - 0.6, -6.1]}><boxGeometry args={[7.5, 1.2, 0.12]} /><meshStandardMaterial color="#f4f6f8" roughness={0.3} /></mesh>
      {/* chrome rail posts + top rail */}
      {posts.map(([x, z], i) => <mesh key={i} position={[x, FLOOR_Y + 0.45, z]}><cylinderGeometry args={[0.02, 0.02, 0.9, 6]} /><meshStandardMaterial color="#dfe5ea" metalness={0.9} roughness={0.15} /></mesh>)}
      {[-3.6, 3.6].map((x) => <mesh key={`r${x}`} position={[x, FLOOR_Y + 0.9, -0.6]}><boxGeometry args={[0.04, 0.04, 10.8]} /><meshStandardMaterial color="#dfe5ea" metalness={0.9} roughness={0.15} /></mesh>)}
      <mesh position={[0, FLOOR_Y + 0.9, -6.0]}><boxGeometry args={[7.2, 0.04, 0.04]} /><meshStandardMaterial color="#dfe5ea" metalness={0.9} roughness={0.15} /></mesh>
      {/* life ring on the back rail */}
      <mesh position={[2.4, FLOOR_Y + 0.55, -5.95]}><torusGeometry args={[0.22, 0.06, 10, 24]} /><meshStandardMaterial color="#e8541e" roughness={0.6} /></mesh>
      {/* coiled rope */}
      <mesh position={[-2.6, FLOOR_Y + 0.03, -4.6]} rotation={[-Math.PI / 2, 0, 0]}><torusGeometry args={[0.25, 0.04, 8, 24]} /><meshStandardMaterial color="#d8c8a0" roughness={0.9} /></mesh>
    </group>
  );
}

export function VenueProps({ id, fxOn, env3d = false, handKey }: { id: VenueId; fxOn: boolean; env3d?: boolean; handKey?: number }) {
  switch (id) {
    case 'backyard': return <Backyard fxOn={fxOn} />;
    case 'mansion': return <Mansion fxOn={fxOn} />;
    case 'barbershop': return null; // production cube room: three/BarbershopRoom.tsx (mounted by Scene)
    case 'church': return <Church />;
    case 'rooftop': return <Rooftop />;
    case 'speakeasy': return <Speakeasy fxOn={fxOn} />;
    case 'vegas': return <Vegas />;
    case 'beach': return <Beach fxOn={fxOn} />;
    case 'grandma': return <Grandma fxOn={fxOn} />;
    case 'yacht': return <Yacht fxOn={fxOn} />;
    case 'blockAfterDark': return env3d ? <PjsStreetRoom fxOn={fxOn} handKey={handKey} /> : <PjsLife fxOn={fxOn} />;
    default: return null;
  }
}

/** venues with ambient motion (only animated when effects are on) */
const MOVES: Partial<Record<VenueId, true>> = { backyard: true, beach: true, yacht: true, blockAfterDark: true, grandma: true, speakeasy: true, mansion: true };

/** Everything around the table for one venue. Mounted inside the Canvas; never suspends the table. */
export default function Venue3D({ def, quality, reduceFx, handKey }: { def: VenueDef; quality: 'high' | 'low'; reduceFx: boolean; handKey?: number }) {
  const urls = venueAssetUrls(def.id, quality);
  const fxOn = !reduceFx && quality === 'high';
  // The Pj's at High: the 3D street environment replaces the static backdrop + floor disc
  // (it brings its own ground) and stands the backdrop-level PjsLife dressing down. Low
  // quality keeps the shipped backdrop + floor + PjsLife exactly — the fallback is the
  // current behaviour, not a new invention.
  const envActive = def.id === 'blockAfterDark' && quality === 'high';
  const g = useRef<Group>(null);
  // for checks: which venue is dressed and whether its ambient motion runs
  useEffect(() => { (window as unknown as { __bwmVenue?: { id: string; fx: boolean; env3d?: boolean } }).__bwmVenue = { id: def.id, fx: fxOn && !!MOVES[def.id], ...(def.id === 'blockAfterDark' ? { env3d: envActive } : {}) }; }, [def.id, fxOn, envActive]);
  return (
    <group ref={g}>
      <Suspense fallback={null}>{urls.bg && !envActive && <Backdrop url={urls.bg} blur={def.bgBlur} intensity={def.bgIntensity} />}</Suspense>
      <Suspense fallback={null}>{urls.env && <Environment files={urls.env} environmentIntensity={def.envIntensity} />}</Suspense>
      {!envActive && <VenueFloor def={def} url={urls.floor} />}
      <VenueProps id={def.id} fxOn={fxOn} env3d={envActive} handKey={handKey} />
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
  window.setTimeout(() => rest.forEach((url) => { void fetch(url, { priority: 'low' } as RequestInit).catch(() => undefined); }), 1500);
}

