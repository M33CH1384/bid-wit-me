/**
 * Barbershop: production cube room (mirror of ClassicStudio #228 pattern).
 * Shell is synchronous geometry (never a black void); GLB chairs/pendants are
 * Classic's decimated+KTX2 files, High only; Low keeps the shell + golden
 * poster plates. East glass storefront looks onto sidewalk + silhouettes +
 * street/sky video plates. STREET VIDEO IS HEAVILY BLURRED at encode time
 * (raw clip rejected: legible plates/signs) — traffic reads as motion, no
 * plate/sign/text is legible. See CREDITS.md + barbershopLayout.ts.
 * TOD: host-clock state locked at hand start (handNo change re-locks);
 * video keeps playing, lighting/glass/practicals follow the locked state.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Box3, CanvasTexture, type Group, Mesh, MeshStandardMaterial, type Object3D, RepeatWrapping, SRGBColorSpace, TextureLoader, VideoTexture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { BARBER, BARBER_ASSETS, CHAIR_SPOTS, skySeekFraction, todFromDate, todLighting, type TodState } from './barbershopLayout';

const CLASSIC = '/assets/venues/classic';

export function preloadBarbershopRoom(): void {
  const files = [`${CLASSIC}/chair.glb`, `${CLASSIC}/lamp.glb`, BARBER_ASSETS.skyPoster, BARBER_ASSETS.streetPoster, BARBER_ASSETS.skyDay, BARBER_ASSETS.street];
  window.setTimeout(() => files.forEach((url) => { void fetch(url, { priority: 'low' } as RequestInit).catch(() => undefined); }), 1500);
}

function ground(obj: Group, floorWorldY: number): void {
  obj.updateMatrixWorld(true);
  const box = new Box3().setFromObject(obj);
  obj.position.y += floorWorldY - box.min.y;
}

function checkerTexture(): CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? BARBER.checkerDark : BARBER.checkerLight; g.fillRect(x * 32, y * 32, 32, 32); }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(BARBER.checkerRepeat[0], BARBER.checkerRepeat[1]); t.colorSpace = SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function stripesTexture(): CanvasTexture {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8e4da'; g.fillRect(0, 0, 64, 128);
  const cols = ['#b03030', '#2a4a8a'];
  cols.forEach((col, k) => { g.fillStyle = col; for (let i = -2; i < 8; i++) { g.save(); g.translate(0, i * 32 + k * 16); g.transform(1, 0.5, 0, 1, 0, 0); g.fillRect(0, 0, 64, 10); g.restore(); } });
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace;
  return t;
}

export default function BarbershopRoom({ quality, handNo }: { quality: 'high' | 'low'; handNo: number }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const propsRef = useRef<Group>(null);
  const checker = useMemo(checkerTexture, []);
  const stripes = useMemo(stripesTexture, []);
  // hand-start lighting lock: recompute only when handNo changes
  const [lock, setLock] = useState<{ hand: number; tod: TodState; at: Date }>(() => ({ hand: handNo, tod: todFromDate(new Date()), at: new Date() }));
  useEffect(() => {
    if (lock.hand === handNo) return;
    const at = new Date();
    setLock({ hand: handNo, tod: todFromDate(at), at });
  }, [handNo, lock.hand]);
  const light = todLighting(lock.tod);
  const [skyTex, setSkyTex] = useState<import('three').Texture | null>(null);
  const [streetTex, setStreetTex] = useState<import('three').Texture | null>(null);

  // exterior plates: High = clock-seeked video; Low = golden posters (never black)
  useEffect(() => {
    let dead = false;
    const videos: HTMLVideoElement[] = [];
    const loader = new TextureLoader();
    const poster = (url: string, set: (t: import('three').Texture) => void) => loader.load(url, (t) => { t.colorSpace = SRGBColorSpace; if (!dead) { set(t); invalidate(); } }, undefined, () => undefined);
    if (quality !== 'high') {
      poster(BARBER_ASSETS.skyPoster, setSkyTex);
      poster(BARBER_ASSETS.streetPoster, setStreetTex);
      (window as unknown as { __bwmVenue?: unknown }).__bwmVenue = { id: 'barbershop', fx: false, studio: true, room: 'barbershop', props: false, tod: lock.tod, poster: true };
      return () => { dead = true; };
    }
    poster(BARBER_ASSETS.skyPoster, setSkyTex);
    poster(BARBER_ASSETS.streetPoster, setStreetTex);
    const make = (src: string, set: (t: import('three').Texture) => void, seek: number) => {
      const v = document.createElement('video');
      v.src = src; v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true; v.preload = 'auto';
      v.addEventListener('loadedmetadata', () => { try { if (Number.isFinite(v.duration) && v.duration > 0) v.currentTime = seek * v.duration; } catch { /* seek is best-effort */ } void v.play().catch(() => undefined); });
      videos.push(v);
      const t = new VideoTexture(v); t.colorSpace = SRGBColorSpace;
      if (!dead) { set(t); invalidate(); }
    };
    make(light.skySrc === 'night' ? BARBER_ASSETS.skyNight : BARBER_ASSETS.skyDay, setSkyTex, skySeekFraction(lock.at));
    make(BARBER_ASSETS.street, setStreetTex, 0);
    const id = window.setInterval(() => { if (!document.hidden) invalidate(); }, 120);
    return () => { dead = true; window.clearInterval(id); videos.forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, lock.tod, invalidate]);

  // chairs + pendants (High only): Classic decimated GLBs, Box3 grounded
  useEffect(() => {
    if (quality !== 'high' || !propsRef.current) return;
    let dead = false;
    const added: Object3D[] = [];
    const ktx2 = new KTX2Loader().setTranscoderPath('/assets/basis/').detectSupport(gl);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.setKTX2Loader(ktx2);
    const load = (url: string) => new Promise<import('three').Group>((res, rej) => loader.load(url, (g) => res(g.scene as Group), undefined, rej));
    void (async () => {
      try {
        const [chair, lamp] = await Promise.all([load(`${CLASSIC}/chair.glb`), load(`${CLASSIC}/lamp.glb`)]);
        if (dead || !propsRef.current) return;
        const host = propsRef.current;
        for (const spot of CHAIR_SPOTS) {
          const c = chair.clone(true) as Group;
          c.rotation.y = spot.ry; c.position.set(spot.x, 0, spot.z);
          c.traverse((o) => { const m = o as Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
          host.add(c); ground(c, BARBER.floorY); added.push(c);
        }
        for (const x of [-BARBER.lampX, BARBER.lampX]) {
          const l = lamp.clone(true) as Group;
          l.position.set(x, 0, 0);
          l.traverse((o) => { const m = o as Mesh; if (m.isMesh) { m.castShadow = false; m.receiveShadow = true; } });
          host.add(l); l.updateMatrixWorld(true);
          const box = new Box3().setFromObject(l);
          l.position.y += BARBER.floorY + BARBER.lampShadeBottom - box.min.y;
          added.push(l);
        }
        (window as unknown as { __bwmVenue?: unknown }).__bwmVenue = { id: 'barbershop', fx: false, studio: true, room: 'barbershop', props: true, tod: lock.tod };
        invalidate();
      } catch { /* shell stays */ }
    })();
    return () => { dead = true; for (const g of added) { g.parent?.remove(g); } ktx2.dispose(); };
  }, [quality, gl, invalidate, lock.tod]);

  const w = BARBER.roomX * 2;
  const frame = '#241a20';
  return (
    <group>
      <group position={[0, BARBER.floorY, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
          <planeGeometry args={[w, BARBER.depth]} />
          <meshStandardMaterial map={checker} roughness={0.45} />
        </mesh>
        {/* far + west walls + ceiling (east wall is the storefront) */}
        <mesh position={[0, BARBER.height / 2, BARBER.zFar]} receiveShadow><planeGeometry args={[w, BARBER.height]} /><meshStandardMaterial color={BARBER.wall} roughness={0.94} /></mesh>
        <mesh rotation={[0, Math.PI / 2, 0]} position={[-BARBER.roomX, BARBER.height / 2, 0]} receiveShadow><planeGeometry args={[BARBER.depth, BARBER.height]} /><meshStandardMaterial color={BARBER.wallDark} roughness={0.95} /></mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, BARBER.height, 0]}><planeGeometry args={[w, BARBER.depth]} /><meshStandardMaterial color={BARBER.ceiling} roughness={1} /></mesh>
        <mesh position={[0, BARBER.baseboardH / 2, BARBER.zFar + 0.02]}><boxGeometry args={[w, BARBER.baseboardH, 0.03]} /><meshStandardMaterial color={BARBER.baseboard} roughness={0.6} /></mesh>
        <mesh position={[-(BARBER.roomX - 0.02), BARBER.baseboardH / 2, 0]}><boxGeometry args={[0.03, BARBER.baseboardH, BARBER.depth]} /><meshStandardMaterial color={BARBER.baseboard} roughness={0.6} /></mesh>
        <mesh position={[0, BARBER.height - 0.09, 0]}><boxGeometry args={[w, 0.18, 0.3]} /><meshStandardMaterial color="#2a1a12" roughness={0.8} /></mesh>

        {/* WEST: mirrors + stations counter (grounded) */}
        <group position={[-3.15, 0, -0.4]} rotation={[0, Math.PI / 2, 0]}>
          <mesh position={[0, 0.425, 0]} castShadow receiveShadow><boxGeometry args={[2.8, 0.85, 0.55]} /><meshStandardMaterial color="#2b211c" roughness={0.7} /></mesh>
          {[-1, 0, 1].map((i) => (
            <mesh key={i} position={[i * 1.0, 1.85, 0.28]}><boxGeometry args={[0.8, 1.1, 0.03]} /><meshStandardMaterial color="#bcd6de" metalness={0.85} roughness={0.12} /></mesh>
          ))}
        </group>
        {/* EAST interior: barber chair silhouette */}
        <group position={[2.95, 0, -0.5]} rotation={[0, -1.1, 0]}>
          <mesh position={[0, 0.45, 0]} castShadow><boxGeometry args={[0.62, 0.5, 0.6]} /><meshStandardMaterial color="#3a2320" roughness={0.5} /></mesh>
          <mesh position={[0, 0.85, -0.28]} castShadow><boxGeometry args={[0.62, 0.55, 0.08]} /><meshStandardMaterial color="#3a2320" roughness={0.5} /></mesh>
          <mesh position={[0, 0.22, 0]}><cylinderGeometry args={[0.05, 0.05, 0.45, 10]} /><meshStandardMaterial color="#d8dde2" metalness={0.9} roughness={0.25} /></mesh>
        </group>
        {/* SOUTH: blank shelves (behind the game camera; no signage/text) */}
        <group position={[0.4, 0, 4.05]}>
          {[0.6, 1.15, 1.7].map((y) => <mesh key={y} position={[0, y, 0]}><boxGeometry args={[1.1, 0.05, 0.28]} /><meshStandardMaterial color="#2b211c" roughness={0.7} /></mesh>)}
        </group>

        {/* EAST storefront: base on floor, mullions, 5 glass bays + door */}
        <mesh position={[BARBER.roomX, 0.07, -0.2]} castShadow><boxGeometry args={[0.1, 0.14, 7.6]} /><meshStandardMaterial color={frame} roughness={0.5} metalness={0.3} /></mesh>
        {[0, 1, 2, 3, 4, 5].map((i) => <mesh key={i} position={[BARBER.roomX, 1.79, -3.9 + i * 1.48]}><boxGeometry args={[0.09, 3.3, 0.09]} /><meshStandardMaterial color={frame} roughness={0.5} metalness={0.3} /></mesh>)}
        <mesh position={[BARBER.roomX, 3.48, -0.2]}><boxGeometry args={[0.1, 0.12, 7.6]} /><meshStandardMaterial color={frame} roughness={0.5} metalness={0.3} /></mesh>
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh key={`g${i}`} rotation={[0, -Math.PI / 2, 0]} position={[BARBER.roomX, BARBER.glassY, -3.16 + i * 1.48]}>
            <planeGeometry args={[1.38, BARBER.glassH]} />
            <meshStandardMaterial color="#cfe2ea" transparent opacity={light.glassOpacity} roughness={0.08} metalness={0.35} />
          </mesh>
        ))}
        <mesh position={[BARBER.roomX, 1.76, 2.95]}><boxGeometry args={[0.06, 3.24, 0.95]} /><meshStandardMaterial color="#2c3438" roughness={0.3} metalness={0.4} transparent opacity={0.75} /></mesh>

        {/* exterior: sidewalk, silhouettes, street + sky plates, lamp, pole outside door */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[5.1, 0.01, 0]} receiveShadow><planeGeometry args={[8.4, 3.2]} /><meshStandardMaterial color="#6a6a70" roughness={0.95} /></mesh>
        {[0, 1, 2, 3, 4].map((i) => <mesh key={`s${i}`} position={[6.4, (1.6 + ((i * 31) % 10) / 8) / 2, -3.2 + i * 1.6]} castShadow><boxGeometry args={[0.3, 1.6 + ((i * 31) % 10) / 8, 0.9]} /><meshStandardMaterial color={lock.tod === 'night' ? '#060a14' : '#2c3428'} roughness={1} /></mesh>)}
        {streetTex && <mesh rotation={[0, -Math.PI / 2, 0]} position={[7.6, 1.55, 0]}><planeGeometry args={[8.2, 2.6]} /><meshBasicMaterial map={streetTex} color={lock.tod === 'night' ? '#6a7285' : lock.tod === 'golden' ? '#e8b98a' : '#ffffff'} side={2} /></mesh>}
        {skyTex && <mesh rotation={[0, -Math.PI / 2, 0]} position={[7.65, 3.9, 0]}><planeGeometry args={[8.2, 2.2]} /><meshBasicMaterial map={skyTex} side={2} /></mesh>}
        <group position={[6.0, 0, 1.8]}>
          <mesh position={[0, 1.5, 0]}><cylinderGeometry args={[0.035, 0.045, 3.0, 10]} /><meshStandardMaterial color="#17151a" roughness={0.6} metalness={0.3} /></mesh>
          <mesh position={[0, 3.02, 0]}><sphereGeometry args={[0.09, 10, 8]} /><meshStandardMaterial color="#221108" emissive="#ffb45c" emissiveIntensity={light.lampEmissive} /></mesh>
        </group>
        {/* barber pole OUTSIDE the door, on an exterior post (no text) */}
        <group position={[3.95, 0, 2.9]}>
          <mesh position={[0, 1.65, 0]}><boxGeometry args={[0.07, 3.3, 0.07]} /><meshStandardMaterial color={frame} roughness={0.5} /></mesh>
          <mesh position={[0.14, 1.28, 0]}><cylinderGeometry args={[0.085, 0.085, 1.26, 14]} /><meshStandardMaterial map={stripes} roughness={0.4} /></mesh>
        </group>
        <pointLight position={[5.8, 2.8, 1.8]} color="#ffb45c" intensity={lock.tod === 'night' ? 6 : 1} distance={7} decay={2} />
      </group>
      <group ref={propsRef} />
    </group>
  );
}
