import { Environment, Html, useTexture } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { type ReactNode, type RefObject, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type Texture, ACESFilmicToneMapping, MeshPhysicalMaterial, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Vector3 } from 'three';
import type { Card, Play, Trick } from '@spades/rules';
import Card3D from './Card3D';
import { backTexture, faceTexture, logoTexture } from './cardTextures';
import { bodyGeometry, feltGeometry, railGeometry } from './geometry';
import {
  type SeatPos, type Xform, badgeSpot, cameraFor, deckSpot, handFan, jitterOf, opponentFan, pileSpot, ringSpot, trickSpot,
} from './layout';

export interface SceneProps {
  quality: 'high' | 'low';
  n: number;
  handNo: number;
  dealer: number;
  positions: SeatPos[];
  human: number;
  /** null while the human's cards are face down (Blind Nil decision). */
  myHand: Card[] | null;
  handCounts: number[];
  shownTrick: Play[];
  /** Completed tricks of this hand that are already swept to piles. */
  piles: Trick[];
  legal: Card[];
  selected: Card | null;
  turnSeat: number | null;
  winnerSeat: number | null;
  promoted: (c: Card) => boolean;
  onCardTap: (c: Card) => void;
  renderSeat: (seat: number) => ReactNode;
}

function CameraRig() {
  const { camera, size } = useThree();
  useLayoutEffect(() => {
    const a = size.width / size.height;
    const s = cameraFor(a);
    const cam = camera as import('three').PerspectiveCamera;
    cam.fov = s.fov;
    cam.aspect = a;
    cam.position.set(...s.pos);
    cam.lookAt(new Vector3(...s.look));
    cam.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

function TableModel({ quality }: { quality: 'high' | 'low' }) {
  const res = quality === 'high' ? '1k' : '512';
  const [feltN, feltR, woodC, woodN, woodR] = useTexture([
    `/assets/textures/scuba_suede_nor_gl_${res}.jpg`,
    `/assets/textures/scuba_suede_rough_${res}.jpg`,
    `/assets/textures/dark_wood_diff_${res}.jpg`,
    `/assets/textures/dark_wood_nor_gl_${res}.jpg`,
    `/assets/textures/dark_wood_rough_${res}.jpg`,
  ]) as Texture[];
  const invalidate = useThree((s) => s.invalidate);
  const mats = useMemo(() => {
    for (const t of [feltN!, feltR!]) { t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(2.2, 2.2); }
    for (const t of [woodC!, woodN!, woodR!]) { t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(0.9, 0.9); }
    woodC!.colorSpace = SRGBColorSpace;
    const felt = new MeshStandardMaterial({ color: '#0d6a45', roughness: 1, roughnessMap: feltR!, normalMap: feltN!, envMapIntensity: 0.35 });
    felt.normalScale.set(0.9, 0.9);
    const wood = quality === 'high'
      ? new MeshPhysicalMaterial({ map: woodC!, normalMap: woodN!, roughnessMap: woodR!, roughness: 0.8, clearcoat: 0.8, clearcoatRoughness: 0.18, color: '#c98a5a' })
      : new MeshStandardMaterial({ map: woodC!, normalMap: woodN!, roughness: 0.45, color: '#c98a5a' });
    const apron = new MeshStandardMaterial({ map: woodC!, roughness: 0.6, color: '#7a4a2a' });
    return { felt, wood, apron };
  }, [feltN, feltR, woodC, woodN, woodR, quality]);
  const geos = useMemo(() => ({ felt: feltGeometry(), rail: railGeometry(), body: bodyGeometry() }), []);
  const logo = useMemo(() => logoTexture(invalidate), [invalidate]);
  return (
    <group>
      <mesh geometry={geos.felt} material={mats.felt} receiveShadow />
      <mesh geometry={geos.rail} material={mats.wood} castShadow receiveShadow />
      <mesh geometry={geos.body} material={mats.apron} receiveShadow />
      {/* printed logo on the felt */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0015, -0.02]}>
        <planeGeometry args={[1.5, 1.5 * (688 / 2552)]} />
        <meshStandardMaterial map={logo} transparent opacity={0.13} depthWrite={false} roughness={1} />
      </mesh>
      {/* gold pinstripe inset */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <ringGeometry args={[0.95, 0.965, 96]} />
        <meshStandardMaterial color="#d9b04a" transparent opacity={0.35} depthWrite={false} roughness={0.5} metalness={0.6} />
      </mesh>
      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.9, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#120b18" roughness={0.95} />
      </mesh>
    </group>
  );
}

function TurnRing({ pos, n, active }: { pos: SeatPos; n: number; active: boolean }) {
  const p = ringSpot(pos, n);
  if (!active) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[p.x, 0.003, p.z]}>
      <ringGeometry args={[0.16, 0.2, 48]} />
      <meshBasicMaterial color="#b36bff" transparent opacity={0.85} toneMapped={false} />
    </mesh>
  );
}

function Cards(props: SceneProps & { aspect: number; fontsReady: boolean }) {
  const { quality, n, handNo, dealer, positions, human, myHand, handCounts, shownTrick, piles, legal, selected, promoted, onCardTap, aspect } = props;
  const gl = useThree((s) => s.gl);
  const aniso = Math.min(quality === 'high' ? 8 : 2, gl.capabilities.getMaxAnisotropy());
  const res = quality;
  const back = useMemo(() => backTexture(res, aniso), [res, aniso]);
  const face = (c: Card) => faceTexture(c, res, promoted(c), aniso);
  const deck = deckSpot(positions[dealer]!, n);

  type Item = { key: string; card: Card | null; target: Xform; from?: Xform; delay?: number; dim?: boolean; glow?: boolean; tap?: () => void; shadow?: boolean; duration?: number; arc?: number };
  const items: Item[] = [];
  const dealDelay = (slot: number, seat: number) => (slot * n + ((seat - dealer - 1 + n) % n)) * 0.028;

  // completed tricks in piles
  const pileCount = Array(n).fill(0) as number[];
  for (const t of piles) {
    const w = t.winner!;
    const k = pileCount[w]!++;
    t.plays.forEach((pl, j) => {
      items.push({ key: `${handNo}-${pl.card}`, card: pl.card, target: pileSpot(positions[w]!, n, k, j, jitterOf(pl.card)), duration: 0.55, arc: 0.15 });
    });
  }
  // cards on the table this trick
  shownTrick.forEach((pl, order) => {
    const fanFrom = pl.seat === human ? undefined : opponentFan(positions[pl.seat]!, n, Math.max(0, handCounts[pl.seat]! - 1) / 2, handCounts[pl.seat]! + 1);
    items.push({ key: `${handNo}-${pl.card}`, card: pl.card, target: trickSpot(positions[pl.seat]!, n, order, jitterOf(pl.card)), from: fanFrom, duration: 0.5, arc: 0.35 });
  });
  // opponents' fans
  for (let seat = 0; seat < n; seat++) {
    if (seat === human) continue;
    const c = handCounts[seat]!;
    for (let i = 0; i < c; i++) {
      items.push({ key: `${handNo}-b${seat}-${i}`, card: null, target: opponentFan(positions[seat]!, n, i, c), from: deck, delay: dealDelay(i, seat), duration: 0.38, arc: 0.3 });
    }
  }
  // the human hand
  const mine = myHand ?? Array.from({ length: handCounts[human]! }, () => null);
  mine.forEach((c, i) => {
    const isLegal = !!c && legal.includes(c);
    const lift = c && selected === c ? 0.24 : isLegal ? 0.07 : 0;
    items.push({
      key: c ? `${handNo}-${c}` : `${handNo}-hb-${i}`,
      card: c,
      target: handFan(aspect, mine.length, i, lift),
      from: deck,
      delay: dealDelay(i, human),
      dim: !!c && legal.length > 0 && !isLegal,
      glow: !!c && selected === c,
      tap: c && isLegal ? () => onCardTap(c) : undefined,
      shadow: false,
      duration: 0.32,
      arc: 0.05,
    });
  });

  if (!props.fontsReady) return null;
  return (
    <group>
      {items.map((it) => (
        <Card3D
          key={it.key}
          name={it.key}
          face={it.card ? face(it.card) : null}
          back={back}
          target={it.target}
          from={it.from}
          delay={it.delay}
          duration={it.duration}
          arc={it.arc}
          dim={it.dim}
          glow={it.glow}
          castShadow={it.shadow !== false && quality === 'high'}
          quality={quality}
          onTap={it.tap}
        />
      ))}
    </group>
  );
}

function Lights({ quality }: { quality: 'high' | 'low' }) {
  const hi = quality === 'high';
  return (
    <>
      <ambientLight intensity={hi ? 0.15 : 0.55} />
      <hemisphereLight args={['#fff3e0', '#1a0f24', hi ? 0.35 : 0.8]} />
      <spotLight
        position={[0.4, 5.2, 1.2]}
        angle={0.62}
        penumbra={0.85}
        intensity={hi ? 70 : 55}
        decay={2}
        color="#fff1dc"
        castShadow={hi}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00012}
        shadow-normalBias={0.012}
        shadow-radius={6}
      />
      {/* purple rim from behind the table, for the stream-studio vibe */}
      <pointLight position={[0, 1.6, -4.2]} intensity={hi ? 9 : 6} color="#9b5cff" distance={9} />
    </>
  );
}

function Badges({ positions, n, human, renderSeat, portal }: Pick<SceneProps, 'positions' | 'n' | 'human' | 'renderSeat'> & { portal: RefObject<HTMLDivElement> }) {
  return (
    <>
      {positions.map((p, seat) => (seat === human ? null : (
        <Html key={seat} position={badgeSpot(p, n)} center zIndexRange={[5, 0]} className="seat-anchor" portal={portal}>
          {renderSeat(seat)}
        </Html>
      )))}
    </>
  );
}

export default function Scene(props: SceneProps) {
  const [fontsReady, setFontsReady] = useState(false);
  const [aspect, setAspect] = useState(() => window.innerWidth / window.innerHeight);
  useEffect(() => {
    let alive = true;
    Promise.race([
      Promise.all([document.fonts.load('800 40px "Barlow Condensed"'), document.fonts.load('700 40px "Barlow Condensed"')]),
      new Promise((r) => setTimeout(r, 1500)),
    ]).then(() => alive && setFontsReady(true));
    return () => { alive = false; };
  }, []);
  const hi = props.quality === 'high';
  const badgeLayer = useRef<HTMLDivElement>(null!);
  const [layerReady, setLayerReady] = useState(false);
  useEffect(() => { setLayerReady(true); }, []);
  return (
    <div className="table-canvas-wrap">
    <Canvas
      className="table-canvas"
      frameloop="demand"
      shadows={hi ? 'soft' : false}
      dpr={hi ? [1, 1.75] : 1}
      gl={{ antialias: hi, powerPreference: 'high-performance', toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      camera={{ fov: 50, near: 0.05, far: 60, position: [0, 4, 3.5] }}
      onCreated={({ size }) => setAspect(size.width / size.height)}
      onPointerMissed={() => undefined}
      resize={{ debounce: 50 }}
    >
      <AspectWatcher onAspect={setAspect} />
      <CameraRig />
      <color attach="background" args={['#0c0712']} />
      <fog attach="fog" args={['#0c0712', 7, 16]} />
      <Lights quality={props.quality} />
      <Suspense fallback={null}>
        {hi && <Environment files="/assets/hdri/billiard_hall_1k.hdr" environmentIntensity={0.55} background backgroundBlurriness={0.55} backgroundIntensity={0.22} />}
        <TableModel quality={props.quality} />
      </Suspense>
      {props.positions.map((p, seat) => <TurnRing key={seat} pos={p} n={props.n} active={props.turnSeat === seat} />)}
      <Cards {...props} aspect={aspect} fontsReady={fontsReady} />
      {layerReady && <Badges positions={props.positions} n={props.n} human={props.human} renderSeat={props.renderSeat} portal={badgeLayer} />}
    </Canvas>
    <div ref={badgeLayer} className="badge-layer" />
    </div>
  );
}

function AspectWatcher({ onAspect }: { onAspect: (a: number) => void }) {
  const size = useThree((s) => s.size);
  useEffect(() => { onAspect(size.width / size.height); }, [size, onAspect]);
  return null;
}
