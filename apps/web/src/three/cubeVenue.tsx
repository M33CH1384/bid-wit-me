/**
 * Shared production cube-room shell for venue ports after Classic Studio
 * (#228) and Barbershop (#232). Synchronous geometry (never a black void),
 * floor y=0 in room space, Box3-grounded Classic chair/pendant GLBs on High
 * (chairs 9,904 tris <=10k, KTX2; see CREDITS.md), golden poster on Low.
 * TOD is the PER-PLAYER LOCAL clock (founder approved on #232, superseding
 * the host-clock line in VENUES.md): state locks at hand start, never
 * mid-hand; sky video keeps playing from the same local clock.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Box3, type Group, Mesh, MeshStandardMaterial, type Object3D, type PointLight, RepeatWrapping, SRGBColorSpace, TextureLoader, VideoTexture } from 'three';
import { flickerAt, glowAt, venueLifeFor } from '../venueLife';
import { fx } from '../fx';
import type { VenueId } from '../venues';
import { noteRoomAssets } from '../assetGate';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { STUDIO, CHAIR_SPOTS } from './classicStudioLayout';
import { BARBER_ASSETS, skySeekFraction, todFromDate, todLighting, type TodState } from './barbershopLayout';

export { STUDIO, CHAIR_SPOTS };
export type { TodState };
export { todFromDate, todLighting, skySeekFraction };

const CLASSIC = '/assets/venues/classic';
export interface CubeBox { p: [number, number, number]; s: [number, number, number]; c: string; r?: number; m?: number; e?: string; ei?: number; ry?: number; rz?: number }
export interface CubeCyl { p: [number, number, number]; a: [number, number, number, number]; c: string; r?: number; m?: number; e?: string; ei?: number; rz?: number }
export interface CubePlane { p: [number, number, number]; s: [number, number]; rot?: [number, number, number]; c?: string; sky?: boolean; sea?: boolean }
export interface CubeTorus { p: [number, number, number]; a: [number, number, number, number]; c: string; ry?: number }
export interface CubeWindow { x: number; y: number; w: number; h: number }
export interface CubeVenueConfig {
  id: string; slug: string;
  floorUrl: string | null; floorRepeat: [number, number]; floorTint: string; floorRough?: number;
  wall: string; wallDark: string; ceiling: string | null; open?: boolean;
  windows?: CubeWindow[]; sky?: boolean; pendants?: boolean;
  boxes?: CubeBox[]; cyls?: CubeCyl[]; planes?: CubePlane[]; tori?: CubeTorus[];
  points?: { p: [number, number, number]; c: string; i: number; d: number }[];
}

export function cubeTris(withProps: boolean, cfg: CubeVenueConfig): number {
  const extra = (cfg.boxes?.length ?? 0) * 12 + (cfg.cyls?.length ?? 0) * 96 + (cfg.planes?.length ?? 0) * 2 + (cfg.tori?.length ?? 0) * 288 + (cfg.windows?.length ?? 0) * 60;
  const shell = 120 + extra;
  if (!withProps) return shell;
  return shell + CHAIR_SPOTS.length * STUDIO.chairTris + (cfg.pendants === false ? 0 : 2 * STUDIO.lampTris);
}

function ground(obj: Group, floorWorldY: number): void {
  obj.updateMatrixWorld(true);
  const box = new Box3().setFromObject(obj);
  obj.position.y += floorWorldY - box.min.y;
}

export function useLocalTod(handNo: number) {
  const [lock, setLock] = useState<{ hand: number; tod: TodState; at: Date }>(() => { const at = new Date(); return { hand: handNo, tod: todFromDate(at), at }; });
  useEffect(() => { if (lock.hand === handNo) return; const at = new Date(); setLock({ hand: handNo, tod: todFromDate(at), at }); }, [handNo, lock.hand]);
  return lock;
}

/**
 * Wave D venue life for the cube rooms: the config's point lights
 * breathe on the shared life layer (venueLife glow × flicker for the
 * room) — a pure function of the frame clock, so the pulse is seekable
 * and identical on every client. High quality only, mirroring the
 * Venue3D fxOn gate; on Low the lights hold their shipped intensity
 * (the held frame). Rooms without point lights have nothing to pulse.
 */
function CubeLifePulse({ cfg, quality, lights }: { cfg: CubeVenueConfig; quality: 'high' | 'low'; lights: React.RefObject<(PointLight | null)[]> }) {
  const invalidate = useThree((s) => s.invalidate);
  const life = useMemo(() => venueLifeFor(cfg.id as VenueId), [cfg.id]);
  const bases = useMemo(() => (cfg.points ?? []).map((pt) => pt.i), [cfg]);
  useEffect(() => {
    if (quality !== 'high' || !bases.length) return;
    const id = window.setInterval(() => { if (!document.hidden) invalidate(); }, 90);
    return () => window.clearInterval(id);
  }, [quality, bases.length, invalidate]);
  useFrame(({ clock }) => {
    if (quality !== 'high') return;
    const t = clock.elapsedTime;
    // Calm contract (coordinator integration): under Reduce Effects / OS
    // reduce-motion the lights hold their shipped base intensity — the
    // pulse stills to the held frame instead of breathing.
    const k = fx.reduced || fx.osReducedMotion ? 1 : glowAt(life, t) * flickerAt(life, t);
    (lights.current ?? []).forEach((l, i) => { if (l) l.intensity = (bases[i] ?? l.intensity) * k; });
  });
  return null;
}

export default function CubeVenueRoom({ cfg, quality, handNo }: { cfg: CubeVenueConfig; quality: 'high' | 'low'; handNo: number }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const propsRef = useRef<Group>(null);
  const lifeLights = useRef<(PointLight | null)[]>([]);
  const floorMat = useRef<MeshStandardMaterial>(null);
  const lock = useLocalTod(handNo);
  const light = todLighting(lock.tod);
  const [skyTex, setSkyTex] = useState<import('three').Texture | null>(null);

  useEffect(() => {
    if (!cfg.floorUrl) return;
    let dead = false;
    new TextureLoader().load(cfg.floorUrl, (t) => { if (dead) return; t.colorSpace = SRGBColorSpace; t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(cfg.floorRepeat[0], cfg.floorRepeat[1]); t.anisotropy = 4; const m = floorMat.current; if (m) { m.map = t; m.color.set(cfg.floorTint); m.needsUpdate = true; } invalidate(); }, undefined, () => undefined);
    return () => { dead = true; };
  }, [cfg, invalidate]);

  useEffect(() => {
    if (!cfg.sky) { (window as unknown as { __bwmVenue?: unknown }).__bwmVenue = { id: cfg.id, fx: false, studio: true, room: cfg.slug, props: false, tod: lock.tod }; return; }
    let dead = false; const videos: HTMLVideoElement[] = [];
    const loader = new TextureLoader();
    const poster = () => loader.load(BARBER_ASSETS.skyPoster, (t) => { t.colorSpace = SRGBColorSpace; if (!dead) { setSkyTex(t); invalidate(); } }, undefined, () => undefined);
    if (quality !== 'high') { poster(); (window as unknown as { __bwmVenue?: unknown }).__bwmVenue = { id: cfg.id, fx: false, studio: true, room: cfg.slug, props: false, tod: lock.tod, poster: true }; return () => { dead = true; }; }
    poster();
    const v = document.createElement('video'); v.src = light.skySrc === 'night' ? BARBER_ASSETS.skyNight : BARBER_ASSETS.skyDay; v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true; v.preload = 'auto';
    v.addEventListener('loadedmetadata', () => { try { if (Number.isFinite(v.duration) && v.duration > 0) v.currentTime = skySeekFraction(lock.at) * v.duration; } catch { /* best effort */ } void v.play().catch(() => undefined); });
    videos.push(v); const t = new VideoTexture(v); t.colorSpace = SRGBColorSpace; if (!dead) { setSkyTex(t); invalidate(); }
    const id = window.setInterval(() => { if (!document.hidden) invalidate(); }, 120);
    return () => { dead = true; window.clearInterval(id); videos.forEach((x) => { x.pause(); x.removeAttribute('src'); x.load(); }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, quality, lock.tod, invalidate]);

  useEffect(() => {
    if (quality !== 'high' || !propsRef.current) return;
    let dead = false; const added: Object3D[] = [];
    const ktx2 = new KTX2Loader().setTranscoderPath('/assets/basis/').detectSupport(gl);
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); loader.setKTX2Loader(ktx2);
    const load = (url: string) => new Promise<import('three').Group>((res, rej) => loader.load(url, (g) => res(g.scene as Group), undefined, rej));
    void (async () => {
      try {
        const chair = await load(`${CLASSIC}/chair.glb`);
        const lamp = cfg.pendants === false ? null : await load(`${CLASSIC}/lamp.glb`);
        if (dead || !propsRef.current) return; const host = propsRef.current;
        for (const spot of CHAIR_SPOTS) { const c = chair.clone(true) as Group; c.rotation.y = spot.ry; c.position.set(spot.x, 0, spot.z); c.traverse((o) => { const m = o as Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); host.add(c); ground(c, STUDIO.floorY); added.push(c); }
        if (lamp) for (const x of [-STUDIO.lampX, STUDIO.lampX]) { const l = lamp.clone(true) as Group; l.position.set(x, 0, 0); l.traverse((o) => { const m = o as Mesh; if (m.isMesh) { m.castShadow = false; m.receiveShadow = true; } }); host.add(l); l.updateMatrixWorld(true); const box = new Box3().setFromObject(l); l.position.y += STUDIO.floorY + STUDIO.lampShadeBottom - box.min.y; added.push(l); }
        (window as unknown as { __bwmVenue?: unknown }).__bwmVenue = { id: cfg.id, fx: false, studio: true, room: cfg.slug, props: true, tod: lock.tod };
        invalidate();
      } catch { /* shell stays */ }
    })();
    return () => { dead = true; for (const g of added) g.parent?.remove(g); ktx2.dispose(); };
  }, [cfg, quality, gl, invalidate, lock.tod]);

  const w = STUDIO.roomX * 2;
  const wins = cfg.windows ?? [];
  const winBottom = wins.length ? Math.min(...wins.map((x) => x.y - x.h / 2)) : 0;
  const winTop = wins.length ? Math.max(...wins.map((x) => x.y + x.h / 2)) : 0;
  const sorted = [...wins].sort((a, b) => a.x - b.x);
  const wallSegs: CubeBox[] = [];
  if (wins.length && !cfg.open) {
    wallSegs.push({ p: [0, winBottom / 2, STUDIO.zFar], s: [w, winBottom, 0.1], c: cfg.wall });
    wallSegs.push({ p: [0, (winTop + STUDIO.height) / 2, STUDIO.zFar], s: [w, STUDIO.height - winTop, 0.1], c: cfg.wall });
    let edge = -STUDIO.roomX;
    for (const win of sorted) { const x0 = win.x - win.w / 2; if (x0 > edge) wallSegs.push({ p: [(edge + x0) / 2, (winBottom + winTop) / 2, STUDIO.zFar], s: [x0 - edge, winTop - winBottom, 0.1], c: cfg.wall }); edge = win.x + win.w / 2; }
    if (edge < STUDIO.roomX) wallSegs.push({ p: [(edge + STUDIO.roomX) / 2, (winBottom + winTop) / 2, STUDIO.zFar], s: [STUDIO.roomX - edge, winTop - winBottom, 0.1], c: cfg.wall });
  }
  const skyColor = lock.tod === 'night' ? '#5a6a8a' : lock.tod === 'golden' ? '#e8b98a' : '#ffffff';
  return (
    <group>
      <group position={[0, STUDIO.floorY, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow><planeGeometry args={[w, STUDIO.depth]} /><meshStandardMaterial ref={floorMat} color={cfg.floorTint} roughness={cfg.floorRough ?? 0.9} /></mesh>
        {!cfg.open && !wins.length && <mesh position={[0, STUDIO.height / 2, STUDIO.zFar]} receiveShadow><planeGeometry args={[w, STUDIO.height]} /><meshStandardMaterial color={cfg.wall} roughness={0.94} /></mesh>}
        {!cfg.open && wallSegs.map((b, i) => <mesh key={`w${i}`} position={b.p}><boxGeometry args={b.s} /><meshStandardMaterial color={b.c} roughness={0.94} /></mesh>)}
        {!cfg.open && <><mesh rotation={[0, Math.PI / 2, 0]} position={[-STUDIO.roomX, STUDIO.height / 2, 0]} receiveShadow><planeGeometry args={[STUDIO.depth, STUDIO.height]} /><meshStandardMaterial color={cfg.wallDark} roughness={0.95} /></mesh><mesh rotation={[0, -Math.PI / 2, 0]} position={[STUDIO.roomX, STUDIO.height / 2, 0]} receiveShadow><planeGeometry args={[STUDIO.depth, STUDIO.height]} /><meshStandardMaterial color={cfg.wallDark} roughness={0.95} /></mesh></>}
        {!cfg.open && cfg.ceiling && <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, STUDIO.height, 0]}><planeGeometry args={[w, STUDIO.depth]} /><meshStandardMaterial color={cfg.ceiling} roughness={1} /></mesh>}
        {!cfg.open && <><mesh position={[0, STUDIO.baseboardH / 2, STUDIO.zFar + 0.02]}><boxGeometry args={[w, STUDIO.baseboardH, 0.03]} /><meshStandardMaterial color="#efe6d0" roughness={0.6} /></mesh>{[-1, 1].map((s) => <mesh key={s} position={[s * (STUDIO.roomX - 0.02), STUDIO.baseboardH / 2, 0]}><boxGeometry args={[0.03, STUDIO.baseboardH, STUDIO.depth]} /><meshStandardMaterial color="#efe6d0" roughness={0.6} /></mesh>)}</>}
        {cfg.ceiling && cfg.pendants !== false && !cfg.open && <mesh position={[0, STUDIO.height - 0.09, 0]}><boxGeometry args={[w, 0.18, 0.3]} /><meshStandardMaterial color="#2a1a12" roughness={0.8} /></mesh>}
        {wins.map((win, i) => <group key={`win${i}`}><mesh rotation={[0, 0, 0]} position={[win.x, win.y, STUDIO.zFar + 0.04]}><planeGeometry args={[win.w, win.h]} /><meshStandardMaterial color="#cfe2ea" transparent opacity={light.glassOpacity} roughness={0.08} metalness={0.35} /></mesh><mesh position={[win.x, win.y + win.h / 2, STUDIO.zFar + 0.05]}><boxGeometry args={[win.w + 0.12, 0.08, 0.06]} /><meshStandardMaterial color="#efe6d0" roughness={0.5} /></mesh><mesh position={[win.x, win.y - win.h / 2, STUDIO.zFar + 0.05]}><boxGeometry args={[win.w + 0.12, 0.08, 0.06]} /><meshStandardMaterial color="#efe6d0" roughness={0.5} /></mesh><mesh position={[win.x, win.y, STUDIO.zFar + 0.05]}><boxGeometry args={[0.05, win.h, 0.05]} /><meshStandardMaterial color="#efe6d0" roughness={0.5} /></mesh></group>)}
        {wins.length > 0 && skyTex && <mesh position={[0, 2.6, STUDIO.zFar - 0.45]}><planeGeometry args={[8.6, 4.6]} /><meshBasicMaterial map={skyTex} color={skyColor} side={2} /></mesh>}
        {(cfg.boxes ?? []).map((b, i) => <mesh key={`b${i}`} position={b.p} rotation={[0, b.ry ?? 0, b.rz ?? 0]} castShadow receiveShadow><boxGeometry args={b.s} /><meshStandardMaterial color={b.c} roughness={b.r ?? 0.85} metalness={b.m ?? 0} emissive={b.e ?? '#000000'} emissiveIntensity={b.ei ?? 0} /></mesh>)}
        {(cfg.cyls ?? []).map((b, i) => <mesh key={`c${i}`} position={b.p} rotation={[0, 0, b.rz ?? 0]} castShadow receiveShadow><cylinderGeometry args={b.a} /><meshStandardMaterial color={b.c} roughness={b.r ?? 0.8} metalness={b.m ?? 0} emissive={b.e ?? '#000000'} emissiveIntensity={b.ei ?? 0} /></mesh>)}
        {(cfg.tori ?? []).map((b, i) => <mesh key={`t${i}`} position={b.p} rotation={[0, b.ry ?? 0, 0]}><torusGeometry args={b.a} /><meshStandardMaterial color={b.c} roughness={0.6} /></mesh>)}
        {(cfg.planes ?? []).map((b, i) => <mesh key={`p${i}`} position={b.p} rotation={b.rot ?? [0, 0, 0]} receiveShadow>{b.sky && skyTex ? <><planeGeometry args={b.s} /><meshBasicMaterial map={skyTex} color={skyColor} side={2} /></> : b.sea ? <><planeGeometry args={b.s} /><meshStandardMaterial color={b.c ?? '#2a6a8a'} roughness={0.35} metalness={0.1} /></> : <><planeGeometry args={b.s} /><meshStandardMaterial color={b.c ?? '#888888'} roughness={0.9} side={2} /></>}</mesh>)}
        {(cfg.points ?? []).map((pt, i) => <pointLight key={`l${i}`} ref={(el) => { lifeLights.current[i] = el; }} position={pt.p} color={pt.c} intensity={pt.i} distance={pt.d} decay={2} />)}
        <CubeLifePulse cfg={cfg} quality={quality} lights={lifeLights} />
      </group>
      <group ref={propsRef} />
    </group>
  );
}

export function preloadCubeVenue(cfg: CubeVenueConfig, quality: 'high' | 'low' = 'high'): void {
  // The GLB props load at High only (the props effect above stands down
  // at Low), so a Low warm pass neither notes nor fetches them — a Low
  // table's gate and pipe carry only what its room mounts (Batch D).
  const files = [...(quality === 'high' ? [`${CLASSIC}/chair.glb`, ...(cfg.pendants === false ? [] : [`${CLASSIC}/lamp.glb`])] : []), ...(cfg.floorUrl ? [cfg.floorUrl] : []), ...(cfg.sky ? [BARBER_ASSETS.skyPoster] : [])];
  // Asset gate: note the room's files so the table loader can wait on them (assetGate.ts).
  noteRoomAssets(cfg.id, files);
  window.setTimeout(() => files.forEach((url) => { void fetch(url, { priority: 'low' } as RequestInit).catch(() => undefined); }), 1500);
}
