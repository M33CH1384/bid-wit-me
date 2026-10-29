import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Box3, CanvasTexture, CylinderGeometry, DoubleSide, Fog, type Group, Mesh, MeshStandardMaterial,
  type Object3D, RepeatWrapping, SRGBColorSpace, TextureLoader,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { CHAIR_SPOTS, STUDIO } from './classicStudioLayout';

/**
 * THE KING'S LOUNGE — story Stop 11's 3D room (The King & The Ringer).
 *
 * Mounted by Venue3D only for a table whose venue is
 * `blockAfterDark`, carrying story stop `king`, at High quality;
 * every other blockAfterDark table — Stop 9 (The Pj's) included —
 * keeps the shipped street path (PjsStreetRoom at High,
 * backdrop + PjsLife at Low), untouched (pinned in
 * test/king-lounge-room.test.ts). The King used to inherit the
 * Pj's street; the manifest gives him his own room: the Classic
 * Studio cube dressed as a plum-and-gold lounge — the route's
 * climax room, the "made it out" threshold. Warm cinematic
 * story register; no ESPN chrome (that belongs to the
 * professional chapter outside story mode).
 *
 * The shell is a self-contained port of ClassicStudio's form
 * (the sibling-room discipline: every room carries its own
 * copy), locked to the same shared constants in
 * classicStudioLayout.ts — one cube, walls that can never
 * lean: plum far wall (#55314d), darker sides (#3f1e38), dark
 * ceiling (#1c1024), cream baseboards and far-wall wainscot
 * (KIN-08), herringbone PBR floor, Poly Haven chair + pendant
 * GLBs (KIN-06 / KIN-07, the shipped CLA-01 / CLA-02 assets)
 * grounded by Box3 with cords to the ceiling beam. Dressing
 * per the manifest's staging (immersive/main.tsx
 * LoungeDressing): the BWM wall sign (KIN-01 — canvas texture,
 * the one sanctioned lettering in the pipeline: gold "B W M"
 * over lavender "SPADES LOUNGE"), the dark-wood credenza with
 * gold trim and six unlabelled bottles (KIN-02 / KIN-03), the
 * shaded floor lamp (KIN-04), and the deep-plum round rug
 * with its gold ring under the table (KIN-05).
 *
 * Route: code + EXISTING shipped assets only — no new Forge
 * generation, no new downloads beyond the classic venue's own
 * GLB/texture files the game already ships.
 *
 * Named deviations from the manifest's letter, following its
 * own staged proof (immersive/main.tsx): KIN-05's figures are
 * the staging's RADII (rug disc r 3.10, ring r 2.92–3.02) —
 * read as diameters the rug could not fit under the 3.96 m
 * table at all; KIN-04's shade follows the staging's
 * proportions (Ø 0.32 top / 0.44 bottom).
 *
 * Standing-camera discipline (gate added 2026-10-28): the
 * ceiling is ONE single-sided plane at floor + 5.00 facing
 * down only (culled from the standing camera above it); the
 * beam and pendant cords hug the ceiling; the sign tops out
 * at studio 3.93 on the far wall, behind the far seat; nothing
 * the room adds crosses the felt or the player's cards
 * (production standing frames: felt visible edge to edge).
 *
 * Seat back-clearances (studio chair back = 0.331 m behind
 * the CHAIR_SPOTS origin — measured from the shipped GLB's
 * own bounds): far seat (0, −2.45) back at z −2.78 → far
 * trim face −4.165 = 1.38 m (credenza front −3.65 stands
 * off-axis west, 0.87 m from the back point's line, behind
 * no seat); player (0, +2.80) back at z +3.13 → open camera
 * side, floor edge +4.20 = 1.07 m, no wall behind; west
 * (−2.30, 0) back at x −2.63 → baseboard face −3.565 =
 * 0.93 m; east (+2.30, 0) back at x +2.63 → +3.565 = 0.93 m.
 * All ≥ 0.6 m, open floor behind every chair back.
 *
 * HARD EXCLUSIONS (manifest): the King's revolver is a story
 * table prop (three/KingGun.tsx, leg-2 staging) — NOT a room
 * item; this room neither builds nor touches it. No
 * throne/crown clichés; no second sign or any other
 * lettering; rail figures are the cast program's, not room
 * dressing — the room itself never crowds the table.
 *
 * Effects: `fxOn` (= !reduceFx at this table) gates the lamp
 * shade's gentle breathing. Effects off = the same room, one
 * static frame. The room renders no table of its own: the
 * shared game table is the anchor. This room deliberately
 * does not touch the loader asset gate (assetGate.ts) — its
 * composition is a separate lane; the room's GLBs stream in
 * behind the synchronous shell exactly as the shipped
 * ClassicStudio's do.
 */

const BASE = '/assets/venues/classic';
const WALL = '#55314d'; // plum plaster (far) — ClassicStudio's own
const WALL_DARK = '#3f1e38'; // sides
const CEIL = '#1c1024';
const CREAM = '#d8c9b8'; // baseboards + wainscot rail
const PANEL = '#542848'; // far-wall wainscot panels
const GOLD = '#c9a227';
const SIGN_GOLD = '#e8c35a';
const SIGN_LILAC = '#b18ae0';
const RUG_PLUM = '#2a1140';

/** Studio chair back extent behind the seat-spot origin (m),
 *  measured from the shipped chair GLB's transformed bounds. */
const CHAIR_BACK = 0.331;

/** Lounge dressing anchors (studio space; the manifest's staging). */
const SIGN_POS: [number, number, number] = [0, 3.5, STUDIO.zFar + 0.02];
const RUG_R = 3.1;
const RING_IN = 2.92;
const RING_OUT = 3.02;
const CREDENZA_POS: [number, number, number] = [-2.5, 0, -3.9];
const LAMP_POS: [number, number, number] = [2.6, 0, -3.85];
const BOTTLE_X = [-0.7, -0.45, -0.2, 0.15, 0.42, 0.68] as const;

/* ------------------------------------------------------------------ */
/* Canvas textures (runtime-painted; zero downloads)                   */
/* ------------------------------------------------------------------ */

/** KIN-01 — the BWM sign: gold "B W M" over lavender "SPADES
 *  LOUNGE" on a transparent ground, the pipeline's one
 *  sanctioned lettering (canvas because generated text garbles). */
function makeSignTexture(): CanvasTexture {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 1024, 256);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 150px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  g.shadowColor = GOLD; g.shadowBlur = 34;
  g.fillStyle = SIGN_GOLD; g.fillText('B W M', 512, 118);
  g.shadowBlur = 0;
  g.font = '700 44px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  g.fillStyle = SIGN_LILAC; g.fillText('S P A D E S   L O U N G E', 512, 208);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Dark-wood planks for the credenza (KIN-02): horizontal
 *  boards with grain streaks, painted — the production
 *  pattern in place of the sandbox's downloaded wood photo. */
function makeWoodTexture(): CanvasTexture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2e1a12'; g.fillRect(0, 0, 512, 256);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let plank = 0; plank < 4; plank++) {
    const y0 = plank * 64;
    g.fillStyle = `rgba(${58 + rnd() * 14},${34 + rnd() * 8},${20 + rnd() * 6},0.55)`;
    g.fillRect(0, y0, 512, 64);
    for (let i = 0; i < 46; i++) {
      const y = y0 + 4 + rnd() * 56;
      g.strokeStyle = `rgba(${12 + rnd() * 30},${8 + rnd() * 16},${4 + rnd() * 8},${0.16 + rnd() * 0.22})`;
      g.lineWidth = 0.8 + rnd() * 1.6;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 512; x += 64) g.lineTo(x, y + (rnd() - 0.5) * 3);
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, y0, 512, 2);
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(2, 1);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* ------------------------------------------------------------------ */
/* Fog + lights                                                        */
/* ------------------------------------------------------------------ */

function EnvFog() {
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const prev = scene.fog;
    scene.fog = new Fog('#1a0b26', 10, 26);
    invalidate();
    return () => { scene.fog = prev; invalidate(); };
  }, [scene, invalidate]);
  return null;
}

function LoungeLights({ fxOn, shadeRef }: { fxOn: boolean; shadeRef: RefObject<MeshStandardMaterial | null> }) {
  useFrame(({ clock }) => {
    if (!fxOn || !shadeRef.current) return;
    // the shaded lamp breathes, barely — a lit room, not a show
    shadeRef.current.emissiveIntensity = 0.9 + Math.sin(clock.elapsedTime * 0.7) * 0.07;
  });
  return (
    <>
      <hemisphereLight args={['#ffd9b0', '#3a1a4d', 0.95]} />
      {/* a low warm key from the lamp corner — the room's own rig, so the
          lounge never depends on the street venue's night lighting */}
      <directionalLight position={[3.4, STUDIO.floorY + 3.4, -2.2]} color="#ffbe78" intensity={1.1} />
      {/* the pendants' practical warmth over the felt */}
      <pointLight position={[0, STUDIO.floorY + 2.6, 0.4]} color="#ffc98a" intensity={9} distance={10} decay={1.8} />
      {/* a wash on the far wall so the sign, credenza and wainscot read */}
      <pointLight position={[0, STUDIO.floorY + 2.4, -2.4]} color="#ffb066" intensity={8} distance={9} decay={1.8} />
      {/* KIN-04 — the shaded lamp's own warm pool, east corner */}
      <pointLight position={[LAMP_POS[0], STUDIO.floorY + 1.1, LAMP_POS[2] + 0.15]} color="#ffb066" intensity={8} distance={6} decay={2} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* GLB props (KIN-06 chairs / KIN-07 pendants): the shipped            */
/* ClassicStudio pattern — meshopt + KTX2, Box3-grounded, cords to     */
/* the beam; a failed GLB leaves the shell, never a broken table.      */
/* ------------------------------------------------------------------ */

function ground(obj: Group, floorWorldY: number): void {
  obj.updateMatrixWorld(true);
  const box = new Box3().setFromObject(obj);
  obj.position.y += floorWorldY - box.min.y;
}

function useStudioProps(propsRef: RefObject<Group | null>, fxOn: boolean) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!propsRef.current) return;
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
          l.traverse((o) => { const mesh = o as Mesh; if (mesh.isMesh) { mesh.castShadow = false; mesh.receiveShadow = true; } });
          host.add(l);
          l.updateMatrixWorld(true);
          const box = new Box3().setFromObject(l);
          l.position.y += STUDIO.floorY + STUDIO.lampShadeBottom - box.min.y;
          l.updateMatrixWorld(true);
          const top = new Box3().setFromObject(l).max.y;
          const beamY = STUDIO.floorY + STUDIO.beamBottom;
          if (beamY > top) {
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
        (window as unknown as { __bwmVenue?: unknown }).__bwmVenue = { id: 'blockAfterDark', fx: fxOn, env3d: true, studio: true, room: 'king-lounge', props: true };
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
  }, [gl, invalidate, propsRef, fxOn]);
}

/* ------------------------------------------------------------------ */
/* The room                                                            */
/* ------------------------------------------------------------------ */

export default function KingLoungeRoom({ fxOn }: { fxOn: boolean }) {
  const propsRef = useRef<Group>(null);
  const floorMat = useRef<MeshStandardMaterial>(null);
  const shadeMat = useRef<MeshStandardMaterial>(null);
  const signTex = useMemo(makeSignTexture, []);
  const woodTex = useMemo(makeWoodTexture, []);
  const invalidate = useThree((s) => s.invalidate);

  useStudioProps(propsRef, fxOn);

  // rig probe (capture/verification): the lounge mounted here
  useEffect(() => {
    (window as unknown as { __kingLounge?: unknown }).__kingLounge = { mounted: true, fx: fxOn };
    return () => { (window as unknown as { __kingLounge?: unknown }).__kingLounge = { mounted: false }; };
  }, [fxOn]);

  // floor PBR set — ClassicStudio's own treatment (cool regrade)
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
      m.color.set('#b7bfc9');
      m.needsUpdate = true;
      invalidate();
    })();
    return () => { dead = true; };
  }, [invalidate]);

  const w = STUDIO.roomX * 2;
  return (
    <group>
      <EnvFog />
      <LoungeLights fxOn={fxOn} shadeRef={shadeMat} />
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
        {/* KIN-08 — far-wall wainscot: rail + panels */}
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

        {/* KIN-01 — the BWM sign on the far wall, behind the far seat */}
        <mesh position={SIGN_POS}>
          <planeGeometry args={[3.4, 0.85]} />
          <meshBasicMaterial map={signTex} transparent toneMapped={false} />
        </mesh>

        {/* KIN-05 — the round lounge rug, centred under the table */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} receiveShadow>
          <circleGeometry args={[RUG_R, 48]} />
          <meshStandardMaterial color={RUG_PLUM} roughness={0.96} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]} receiveShadow>
          <ringGeometry args={[RING_IN, RING_OUT, 48]} />
          <meshStandardMaterial color={GOLD} roughness={0.5} metalness={0.6} />
        </mesh>

        {/* KIN-02 / KIN-03 — credenza along the far wall, offset west */}
        <group position={CREDENZA_POS}>
          <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.9, 0.9, 0.5]} />
            <meshStandardMaterial map={woodTex} roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.92, 0]}>
            <boxGeometry args={[1.94, 0.04, 0.54]} />
            <meshStandardMaterial color={GOLD} roughness={0.35} metalness={0.7} />
          </mesh>
          {BOTTLE_X.map((x, i) => (
            <group key={i} position={[x, 0.94, 0]}>
              <mesh position={[0, 0.16, 0]} castShadow>
                <cylinderGeometry args={[0.045, 0.05, 0.32, 12]} />
                <meshStandardMaterial color={i % 2 ? '#3d2b16' : '#1e3a24'} roughness={0.15} metalness={0.1} />
              </mesh>
              <mesh position={[0, 0.38, 0]}>
                <cylinderGeometry args={[0.014, 0.02, 0.12, 8]} />
                <meshStandardMaterial color={i % 2 ? '#3d2b16' : '#1e3a24'} roughness={0.15} />
              </mesh>
            </group>
          ))}
        </group>

        {/* KIN-04 — the shaded floor lamp, east corner of the far wall */}
        <group position={LAMP_POS}>
          <mesh position={[0, 0.5, 0]} castShadow>
            <cylinderGeometry args={[0.03, 0.16, 1.0, 12]} />
            <meshStandardMaterial color="#241228" roughness={0.6} metalness={0.3} />
          </mesh>
          <mesh position={[0, 1.12, 0]}>
            <cylinderGeometry args={[0.16, 0.22, 0.26, 16, 1, true]} />
            <meshStandardMaterial ref={shadeMat} color={SIGN_GOLD} emissive="#ff9c3a" emissiveIntensity={0.9} roughness={0.8} side={DoubleSide} />
          </mesh>
        </group>
      </group>
      <group ref={propsRef} />
    </group>
  );
}
