/**
 * Classic Studio: the founder's cube room (one box, 90° by construction) dressed with the Poly Haven
 * chair + pendants, wrapped around the game's own table. The shell is synchronous geometry — it can
 * never suspend or leave a black void — and the GLB props stream in after (High quality only; on Low
 * the room stays, the props drop, per the scene spec). The classic hall HDRI IBL (HallAttach) is reused
 * for reflections; nothing else about the classic table changes.
 *
 * Placement rule from the test scene: every prop is grounded by its own Box3 (`min.y` onto the floor),
 * never eyeballed. Lamp shades hang at shade-bottom 1.82 with cords to the ceiling beam underside.
 */
import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Box3, CylinderGeometry, type Group, Mesh, MeshStandardMaterial, type Object3D, RepeatWrapping, SRGBColorSpace, TextureLoader } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { CHAIR_SPOTS, STUDIO } from './classicStudioLayout';
import { noteRoomAssets } from '../assetGate';

const BASE = '/assets/venues/classic';
const WALL = '#55314d'; // plum plaster (far)
const WALL_DARK = '#3f1e38'; // sides
const CEIL = '#1c1024';
const CREAM = '#d8c9b8'; // baseboards
const PANEL = '#542848'; // far-wall wainscot panels

/** Fetch-warm the studio files at low priority (splash/wizard warm-up path; never blocks the table). */
export function preloadClassicStudio(): void {
  const files = [`${BASE}/chair.glb`, `${BASE}/lamp.glb`, `${BASE}/floor_diffuse_512.jpg`, `${BASE}/floor_nor_gl_512.jpg`, `${BASE}/floor_rough_512.jpg`];
  // Asset gate: note the room's files so the table loader can wait on them (assetGate.ts).
  noteRoomAssets('classic', files);
  window.setTimeout(() => files.forEach((url) => { void fetch(url, { priority: 'low' } as RequestInit).catch(() => undefined); }), 1500);
}

function ground(obj: Group, floorWorldY: number): void {
  obj.updateMatrixWorld(true);
  const box = new Box3().setFromObject(obj);
  obj.position.y += floorWorldY - box.min.y;
}

export default function ClassicStudio({ quality }: { quality: 'high' | 'low' }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const propsRef = useRef<Group>(null);
  const floorMat = useRef<MeshStandardMaterial>(null);

  // floor PBR set (512 herringbone): finer repeat + a cooler tint than the test scene (its known flaws)
  useEffect(() => {
    let dead = false;
    const loader = new TextureLoader();
    const load = (url: string, srgb = false) => new Promise<import('three').Texture | null>((res) => loader.load(url, (t) => { if (srgb) t.colorSpace = SRGBColorSpace; t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(6, 7); t.anisotropy = 4; res(t); }, undefined, () => res(null)));
    void (async () => {
      const [map, normalMap, roughnessMap] = await Promise.all([
        load(`${BASE}/floor_diffuse_512.jpg`, true), load(`${BASE}/floor_nor_gl_512.jpg`), load(`${BASE}/floor_rough_512.jpg`),
      ]);
      const m = floorMat.current;
      if (dead || !m) return;
      if (map) m.map = map;
      if (normalMap) m.normalMap = normalMap;
      if (roughnessMap) m.roughnessMap = roughnessMap;
      m.color.set('#b7bfc9'); // regrade: cool the warm/orange parquet down
      m.needsUpdate = true;
      invalidate();
    })();
    return () => { dead = true; };
  }, [invalidate]);

  // chairs + pendants (High only): meshopt + KTX2 GLBs, grounded by Box3, cords to the beam
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
        const [chair, lamp] = await Promise.all([load(`${BASE}/chair.glb`), load(`${BASE}/lamp.glb`)]);
        if (dead || !propsRef.current) return;
        const host = propsRef.current;
        for (const spot of CHAIR_SPOTS) {
          const c = chair.clone(true) as Group;
          c.rotation.y = spot.ry;
          c.position.set(spot.x, 0, spot.z);
          c.traverse((o) => { const mesh = o as Mesh; if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; } });
          host.add(c);
          ground(c, STUDIO.floorY);
          added.push(c);
        }
        for (const x of [-STUDIO.lampX, STUDIO.lampX]) {
          const l = lamp.clone(true) as Group;
          l.position.set(x, 0, 0);
          // shades do not cast the key light (the test scene's two dark blobs on the felt)
          l.traverse((o) => { const mesh = o as Mesh; if (mesh.isMesh) { mesh.castShadow = false; mesh.receiveShadow = true; } });
          host.add(l);
          l.updateMatrixWorld(true);
          const box = new Box3().setFromObject(l);
          l.position.y += STUDIO.floorY + STUDIO.lampShadeBottom - box.min.y;
          l.updateMatrixWorld(true);
          const top = new Box3().setFromObject(l).max.y;
          const beamY = STUDIO.floorY + STUDIO.beamBottom;
          if (beamY > top) {
            // cord from the lamp's top to the beam underside (the test scene's construction)
            const cord = new Mesh(
              new CylinderGeometry(0.008, 0.008, beamY - top, 8),
              new MeshStandardMaterial({ color: '#111111', roughness: 0.8 }),
            );
            cord.position.set(x, (top + beamY) / 2, 0);
            host.add(cord);
            added.push(cord);
          }
          added.push(l);
        }
        (window as unknown as { __bwmVenue?: unknown }).__bwmVenue = { id: 'classic', fx: false, studio: true, props: true };
        invalidate();
      } catch { /* props are decoration: a failed GLB leaves the shell, never a broken table */ }
    })();
    return () => {
      dead = true;
      for (const g of added) {
        g.parent?.remove(g);
        g.traverse((o) => { const mesh = o as Mesh; if (mesh.isMesh) { mesh.geometry.dispose(); const m = mesh.material as MeshStandardMaterial; (Array.isArray(m) ? m : [m]).forEach((x) => { x.map?.dispose(); x.dispose(); }); } });
      }
      ktx2.dispose();
    };
  }, [quality, gl, invalidate]);

  const w = STUDIO.roomX * 2;
  return (
    <group>
      {/* shell at the shared floor height; studio y=0 is the floorboards */}
      <group position={[0, STUDIO.floorY, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
          <planeGeometry args={[w, STUDIO.depth]} />
          <meshStandardMaterial ref={floorMat} color="#584a3c" roughness={1} />
        </mesh>
        {/* far + side walls + ceiling: five planes on the cube constants */}
        <mesh position={[0, STUDIO.height / 2, STUDIO.zFar]} receiveShadow>
          <planeGeometry args={[w, STUDIO.height]} />
          <meshStandardMaterial color={WALL} roughness={0.92} />
        </mesh>
        <mesh rotation={[0, Math.PI / 2, 0]} position={[-STUDIO.roomX, STUDIO.height / 2, 0]} receiveShadow>
          <planeGeometry args={[STUDIO.depth, STUDIO.height]} />
          <meshStandardMaterial color={WALL_DARK} roughness={0.95} />
        </mesh>
        <mesh rotation={[0, -Math.PI / 2, 0]} position={[STUDIO.roomX, STUDIO.height / 2, 0]} receiveShadow>
          <planeGeometry args={[STUDIO.depth, STUDIO.height]} />
          <meshStandardMaterial color={WALL_DARK} roughness={0.95} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, STUDIO.height, 0]}>
          <planeGeometry args={[w, STUDIO.depth]} />
          <meshStandardMaterial color={CEIL} roughness={1} />
        </mesh>
        {/* baseboards proud of every floor-wall junction */}
        <mesh position={[0, STUDIO.baseboardH / 2, STUDIO.zFar + 0.02]}>
          <boxGeometry args={[w, STUDIO.baseboardH, 0.03]} />
          <meshStandardMaterial color={CREAM} roughness={0.6} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * (STUDIO.roomX - 0.02), STUDIO.baseboardH / 2, 0]}>
            <boxGeometry args={[0.03, STUDIO.baseboardH, STUDIO.depth]} />
            <meshStandardMaterial color={CREAM} roughness={0.6} />
          </mesh>
        ))}
        {/* far-wall wainscot: rail + panels */}
        <mesh position={[0, 0.98, STUDIO.zFar + 0.015]}>
          <boxGeometry args={[w, 0.06, 0.02]} />
          <meshStandardMaterial color={CREAM} roughness={0.6} />
        </mesh>
        {[-2, -1, 0, 1, 2].map((i) => (
          <mesh key={i} position={[i * 1.35, 0.58, STUDIO.zFar + 0.012]}>
            <boxGeometry args={[0.95, 0.62, 0.015]} />
            <meshStandardMaterial color={PANEL} roughness={0.9} />
          </mesh>
        ))}
        {/* ceiling beam the pendant cords tie into */}
        <mesh position={[0, STUDIO.height - 0.09, 0]}>
          <boxGeometry args={[w, 0.18, 0.3]} />
          <meshStandardMaterial color="#2a1a12" roughness={0.8} />
        </mesh>
      </group>
      <group ref={propsRef} />
    </group>
  );
}
