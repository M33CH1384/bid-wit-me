import { Environment, Html, useTexture } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { type ReactNode, type RefObject, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type Camera, type Group, type Mesh, type Object3D, type Texture, ACESFilmicToneMapping, Quaternion, MeshPhysicalMaterial, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Vector3 } from 'three';
import type { Card, Play, Trick } from '@spades/rules';
import Card3D from './Card3D';
import { type DealTimeline, dealTimeline } from './dealTimeline';
import { type Sfx, sound } from '../audio';
import { backTexture, faceTexture, logoTexture } from './cardTextures';
import { bodyGeometry, cardGeometry, feltGeometry, railGeometry } from './geometry';
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
  /** Hand number whose shuffle + deal should be animated (null = place cards instantly, e.g. after a refresh). */
  introHand: number | null;
  /** Game-speed factor (1 = normal, 0.5 = fast…): scales the shuffle/deal timeline. */
  animK: number;
  /** Landing sounds for a played card ('play' or 'play,cut' / 'play,broken'). */
  landCue: (card: Card) => string;
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

function Cards(props: SceneProps & { aspect: number; fontsReady: boolean; safeFrac: number }) {
  const { safeFrac, quality, n, handNo, dealer, positions, human, myHand, handCounts, shownTrick, piles, legal, selected, promoted, onCardTap, aspect } = props;
  const gl = useThree((s) => s.gl);
  const aniso = Math.min(quality === 'high' ? 8 : 2, gl.capabilities.getMaxAnisotropy());
  const res = quality;
  const back = useMemo(() => backTexture(res, aniso), [res, aniso]);
  const face = (c: Card) => faceTexture(c, res, promoted(c), aniso);
  const deck = deckSpot(positions[dealer]!, n);
  const intro = props.introHand === handNo;
  const tl = dealTimeline(props.animK, n, handCounts.reduce((a, b) => a + b, 0) + piles.length * n + shownTrick.length);

  type Item = { key: string; card: Card | null; target: Xform; from?: Xform; delay?: number; dim?: boolean; glow?: boolean; tap?: () => void; shadow?: boolean; duration?: number; arc?: number; sfxStart?: Sfx; sfxLand?: string };
  const items: Item[] = [];
  const dealDelay = (slot: number, seat: number) => tl.shuffle + (slot * n + ((seat - dealer - 1 + n) % n)) * tl.step;

  // completed tricks in piles
  const pileCount = Array(n).fill(0) as number[];
  for (const t of piles) {
    const w = t.winner!;
    const k = pileCount[w]!++;
    t.plays.forEach((pl, j) => {
      items.push({ key: `${handNo}-${pl.card}`, card: pl.card, target: pileSpot(positions[w]!, n, k, j, jitterOf(pl.card)), duration: 0.55, arc: 0.15, sfxStart: 'sweep' });
    });
  }
  // cards on the table this trick
  shownTrick.forEach((pl, order) => {
    const fanFrom = pl.seat === human ? undefined : opponentFan(positions[pl.seat]!, n, Math.max(0, handCounts[pl.seat]! - 1) / 2, handCounts[pl.seat]! + 1);
    items.push({ key: `${handNo}-${pl.card}`, card: pl.card, target: trickSpot(positions[pl.seat]!, n, order, jitterOf(pl.card)), from: fanFrom, duration: 0.5, arc: 0.35, sfxLand: props.landCue(pl.card) });
  });
  // opponents' fans
  for (let seat = 0; seat < n; seat++) {
    if (seat === human) continue;
    const c = handCounts[seat]!;
    for (let i = 0; i < c; i++) {
      items.push({ key: `${handNo}-b${seat}-${i}`, card: null, target: opponentFan(positions[seat]!, n, i, c), from: intro ? deck : undefined, delay: intro ? dealDelay(i, seat) : 0, duration: tl.fly, arc: 0.3, sfxStart: 'deal' });
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
      target: handFan(aspect, mine.length, i, lift, safeFrac),
      from: intro ? deck : undefined,
      delay: intro ? dealDelay(i, human) : 0,
      sfxStart: 'deal',
      dim: !!c && legal.length > 0 && !isLegal,
      glow: !!c && selected === c,
      tap: c && isLegal ? () => onCardTap(c) : undefined,
      shadow: false,
      duration: intro ? tl.fly : 0.32,
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
          sfxStart={it.sfxStart}
          sfxLand={it.sfxLand}
        />
      ))}
      {intro && <ShuffleDeck key={`shuffle-${handNo}`} at={deck} back={back} tl={tl} quality={quality} />}
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

function Badges({ positions, n, human, renderSeat, portal, safeFrac }: Pick<SceneProps, 'positions' | 'n' | 'human' | 'renderSeat'> & { portal: RefObject<HTMLDivElement>; safeFrac: number }) {
  return (
    <>
      {positions.map((p, seat) => {
        if (seat === human) return null;
        const side = p === 'left' || p === 'right' ? p : p === 'top' ? 'top' : null;
        // side plates are anchored by their outer edge and clamped inside the viewport (+ iOS safe area)
        const calc = side
          ? (el: Object3D, camera: Camera, size: { width: number; height: number }) => {
            const v = new Vector3().setFromMatrixPosition(el.matrixWorld).project(camera);
            const x = (v.x + 1) * size.width / 2, y = (1 - v.y) * size.height / 2;
            const pad = 6 + safeFrac * size.width;
            if (side === 'top') return [Math.min(x, size.width - pad - 190), Math.max(y, size.width >= 900 ? 134 : 150)]; // stay below the scorebug/trump strip // left-anchored, kept clear of the right edge
            return side === 'left' ? [Math.max(pad, x - 72), y] : [Math.min(size.width - pad, x + 72), y];
          }
          : undefined;
        return (
          <Html key={seat} position={badgeSpot(p, n)} center={!side} calculatePosition={calc} zIndexRange={[5, 0]} className={`seat-anchor${side ? ` side-${side}` : ''}`} portal={portal}>
            {renderSeat(seat)}
          </Html>
        );
      })}
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
  const safeFrac = useSafeFrac();
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
      <Cards {...props} aspect={aspect} fontsReady={fontsReady} safeFrac={safeFrac} />
      {layerReady && <Badges positions={props.positions} n={props.n} human={props.human} renderSeat={props.renderSeat} portal={badgeLayer} safeFrac={safeFrac} />}
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

/** Largest horizontal iOS safe-area inset (notch / home indicator in landscape) as a fraction of the viewport width. */
function useSafeFrac(): number {
  const [frac, setFrac] = useState(0);
  useEffect(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)';
    document.body.appendChild(probe);
    const read = () => {
      const cs = getComputedStyle(probe);
      const inset = Math.max(parseFloat(cs.paddingLeft) || 0, parseFloat(cs.paddingRight) || 0);
      setFrac(window.innerWidth > 0 ? inset / window.innerWidth : 0);
    };
    read();
    window.addEventListener('resize', read);
    window.addEventListener('orientationchange', read);
    return () => { window.removeEventListener('resize', read); window.removeEventListener('orientationchange', read); probe.remove(); };
  }, []);
  return frac;
}

/**
 * The dealer's deck: splits into two halves and riffles together while the shuffle sound plays, squares up,
 * then shrinks as the cards fly out (each dealt card makes its own flick sound as it leaves — see Card3D sfxStart).
 */
function ShuffleDeck({ at, back, tl, quality }: { at: Xform; back: Texture; tl: DealTimeline; quality: 'high' | 'low' }) {
  const N = 14;
  const group = useRef<Group>(null);
  const cards = useRef<(Mesh | null)[]>([]);
  const t0 = useRef<number | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  const geo = useMemo(() => cardGeometry(), []);
  const mat = useMemo(() => (quality === 'high' ? new MeshPhysicalMaterial({ map: back, roughness: 0.45, clearcoat: 0.3 }) : new MeshStandardMaterial({ map: back, roughness: 0.5 })), [back, quality]);
  const edge = useMemo(() => new MeshStandardMaterial({ color: '#efe9dc', roughness: 0.75 }), []);
  useFrame(({ clock }) => {
    const now = clock.getElapsedTime();
    if (t0.current === null) {
      t0.current = now;
      sound.play('shuffle', { dur: tl.shuffle }); // starts exactly with the riffle
    }
    const e = now - t0.current;
    const end = tl.shuffle + tl.dealSpan;
    if (e > end + 0.1) { if (group.current) group.current.visible = false; return; }
    invalidate();
    const u = Math.min(1, e / tl.shuffle); // 0..1 shuffle progress
    const split = u < 0.25 ? u / 0.25 : u < 0.85 ? 1 : 1 - (u - 0.85) / 0.15; // halves apart → riffle → square up
    const dealt = e <= tl.shuffle ? 0 : Math.min(1, (e - tl.shuffle) / Math.max(0.001, tl.dealSpan));
    const left = Math.round(N * (1 - dealt));
    cards.current.forEach((m, j) => {
      if (!m) return;
      const half = j % 2 === 0 ? -1 : 1;
      // riffle: card j drops from its half into the centre stack at its own moment
      const dropAt = 0.25 + 0.6 * (j / N);
      const inCentre = u >= dropAt + 0.06 ? 1 : u <= dropAt ? 0 : (u - dropAt) / 0.06;
      const off = half * 0.16 * split * (1 - inCentre);
      const bend = half * 0.35 * split * (1 - inCentre);
      m.position.set(off, 0, -(j * 0.0042 + (1 - inCentre) * 0.02 * split)); // local -z is 'up' for a face-down card
      m.rotation.set(0, 0, 0);
      m.rotation.y = bend * 0.25;
      m.visible = j < left;
    });
  });
  return (
    <group ref={group} position={at.p} quaternion={new Quaternion(...at.q)} scale={at.s}>
      {Array.from({ length: N }, (_, j) => (
        <group key={j} ref={(el) => { cards.current[j] = el as unknown as Mesh; }}>
          <mesh geometry={geo.body} material={edge} castShadow={quality === 'high'} />
          <mesh geometry={geo.front} material={mat} />
          <mesh geometry={geo.back} material={mat} />
        </group>
      ))}
    </group>
  );
}
