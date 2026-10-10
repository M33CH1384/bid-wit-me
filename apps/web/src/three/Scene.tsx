import { Environment, Html, useTexture } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { type ReactNode, type RefObject, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type Camera, type Group, type Mesh, type Object3D, type Texture, ACESFilmicToneMapping, AdditiveBlending, CanvasTexture, Matrix4, Quaternion, MeshPhysicalMaterial, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Vector3 } from 'three';
import type { Card, Play, Trick } from '@spades/rules';
import Card3D from './Card3D';
import { isShortLandscape } from '../viewport';
import { type DealTimeline, dealTimeline } from './dealTimeline';
import { type Sfx, sound } from '../audio';
import { fx } from '../fx';
import { backTexture, faceTexture, logoTexture } from './cardTextures';
import { bodyGeometry, cardGeometry, feltGeometry, railGeometry } from './geometry';
import {
  CH, CW, type FanOpts, type SeatPos, type Xform, badgeSpot, cameraFor, deckSpot, fanLayout, handFan, makeCamera, jitterOf, opponentFan, pileSpot, ringSpot, trickSpot,
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
  /** Phone landscape layout (see viewport.ts): own camera, smaller trick, hand between the HUD corners. */
  short?: boolean;
  /** Safe-area insets in CSS px. */
  safe?: { l: number; r: number; t: number; b: number };
  /** Highlight playable cards (tips mode). */
  hintLegal?: boolean;
}

function CameraRig() {
  const { camera, size, invalidate } = useThree();
  const short = isShortLandscape(size.width, size.height);
  useLayoutEffect(() => {
    const a = size.width / size.height;
    const s = cameraFor(a, short);
    const cam = camera as import('three').PerspectiveCamera;
    cam.fov = s.fov;
    cam.aspect = a;
    cam.position.set(...s.pos);
    cam.lookAt(new Vector3(...s.look));
    cam.updateProjectionMatrix();
    invalidate();
  }, [camera, size, short, invalidate]);
  return null;
}

/**
 * Hype-effect camera shake + table vibration (fx.shake, set by joker rumbles / the nuke). The offsets are added on top
 * of whatever CameraRig set and removed again every frame, so the layout camera never drifts.
 */
function FxShake({ table }: { table: RefObject<Group | null> }) {
  const { camera, invalidate } = useThree();
  const applied = useRef({ x: 0, y: 0, z: 0, roll: 0, ty: 0 });
  const last = useRef<object | null>(null);
  useEffect(() => fx.on(() => invalidate()), [invalidate]);
  useFrame(() => {
    const a = applied.current;
    camera.position.x -= a.x; camera.position.y -= a.y; camera.position.z -= a.z; camera.rotateZ(-a.roll);
    if (table.current) table.current.position.y -= a.ty;
    a.x = a.y = a.z = a.roll = a.ty = 0;
    const s = fx.shake;
    if (!s) return;
    const t = (performance.now() - s.start) / 1000;
    if (t < 0) { invalidate(); return; }
    if (t > s.dur) { if (last.current === s) fx.shake = null; invalidate(); return; }
    last.current = s;
    const k = s.amp * Math.pow(1 - t / s.dur, 2);
    const w = 2 * Math.PI * t;
    a.x = k * (Math.sin(w * 23) * 0.6 + Math.sin(w * 37 + 1) * 0.4);
    a.y = k * (Math.sin(w * 29 + 2) * 0.6 + Math.sin(w * 41) * 0.4);
    a.z = k * 0.5 * Math.sin(w * 31 + 0.5);
    a.roll = k * 0.25 * Math.sin(w * 19 + 1.3);
    a.ty = k * 0.18 * Math.sin(w * 53);
    camera.position.x += a.x; camera.position.y += a.y; camera.position.z += a.z; camera.rotateZ(a.roll);
    if (table.current) table.current.position.y += a.ty;
    invalidate();
  });
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

/** The same spot, turned face-down (180° about the card's own long axis) — the start pose of a flip-in-place. */
const FLIP_Q = new Quaternion(0, 1, 0, 0);
function flipped(t: Xform): Xform {
  const q = new Quaternion(...t.q).multiply(FLIP_Q);
  return { p: [t.p[0], t.p[1], t.p[2]], q: [q.x, q.y, q.z, q.w], s: t.s };
}

function Cards(props: SceneProps & { aspect: number; fontsReady: boolean; safeFrac: number }) {
  const { safeFrac, quality, n, handNo, dealer, positions, human, myHand, handCounts, shownTrick, piles, legal, selected, promoted, onCardTap } = props;
  const gl = useThree((s) => s.gl);
  const aniso = Math.min(quality === 'high' ? 8 : 2, gl.capabilities.getMaxAnisotropy());
  const res = quality;
  const back = useMemo(() => backTexture(res, aniso), [res, aniso]);
  const face = (c: Card) => faceTexture(c, res, promoted(c), aniso);
  const deck = deckSpot(positions[dealer]!, n);
  const intro = props.introHand === handNo;
  // Blind Nil: cards that were dealt face-down flip over in place on reveal — never re-dealt from the deck
  const hiddenHand = useRef<number | null>(null);
  if (myHand === null) hiddenHand.current = handNo;
  const flipIn = myHand !== null && hiddenHand.current === handNo;
  const flippedHand = useRef<number | null>(null);
  useEffect(() => {
    if (!flipIn || flippedHand.current === handNo) return;
    flippedHand.current = handNo;
    sound.play('flip');
    const w = window as unknown as { __bwmFlips?: Record<number, number> };
    (w.__bwmFlips ??= {})[handNo] = (w.__bwmFlips[handNo] ?? 0) + 1;
  }, [flipIn, handNo]);
  const tl = dealTimeline(props.animK, n, handCounts.reduce((a, b) => a + b, 0) + piles.length * n + shownTrick.length);
  const size = useThree((s) => s.size);
  const short = isShortLandscape(size.width, size.height); // from the canvas size, like the camera — never out of step with it
  // same source as CameraRig, so the hand is always laid out for the camera that renders it (no stale aspect after a rotate)
  const aspect = size.width / size.height;
  const safe = props.safe ?? { l: 0, r: 0, t: 0, b: 0 };
  // landscape: the bottom corners hold your plate (left) and last trick + controls (right); the hand fans between
  // desktop / wide: a bigger hand (≈35% over the 0.16 default), kept between your plate (left) and last trick (right)
  const wide = !short && size.width >= 1024 && aspect >= 1.3;
  const fanOpts = short
    ? { short, reserveFrac: (Math.max(safe.l, safe.r) + 186) / size.width, bottomFrac: safe.b / size.height, heightFrac: 0.2 }
    : wide ? { reserveFrac: (size.width < 1400 ? 250 : 205) / size.width, bottomFrac: 0.012, heightFrac: 0.205 }
    : {};
  const trickScale = short ? 1.85 : undefined;

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
    items.push({ key: `${handNo}-${pl.card}`, card: pl.card, target: trickSpot(positions[pl.seat]!, n, order, jitterOf(pl.card), trickScale), from: fanFrom, duration: 0.5, arc: 0.35, sfxLand: props.landCue(pl.card) });
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
    const lift = c && selected === c ? 0.24 : isLegal ? (props.hintLegal ? 0.12 : wide && legal.length < mine.length ? 0.09 : 0.07) : 0;
    const target = handFan(aspect, mine.length, i, lift, safeFrac, fanOpts);
    const flip = flipIn && !!c;
    items.push({
      key: c ? `${handNo}-${c}` : `${handNo}-hb-${i}`,
      card: c,
      target,
      from: flip ? flipped(target) : intro ? deck : undefined,
      delay: flip ? i * 0.022 : intro ? dealDelay(i, human) : 0,
      sfxStart: flip ? undefined : 'deal',
      dim: !!c && legal.length > 0 && !isLegal,
      glow: !!c && (selected === c || ((!!props.hintLegal || wide) && isLegal && legal.length < mine.length)),
      tap: c && isLegal ? () => onCardTap(c) : undefined,
      shadow: false,
      duration: flip ? 0.34 : intro ? tl.fly : 0.32,
      arc: flip ? 0 : 0.05,
    });
  });

  // test probe: every key that was ever dealt from the deck, per hand (a re-deal would add new keys)
  useEffect(() => {
    const w = window as unknown as { __bwmDealt?: Record<number, string[]> };
    const log = (w.__bwmDealt ??= {});
    const set = new Set(log[handNo] ?? []);
    for (const it of items) if (it.from === deck) set.add(it.key);
    log[handNo] = [...set];
  });

  if (!props.fontsReady) return null;
  return (
    <group>
      <LayoutProbe items={items} trickKeys={shownTrick.map((pl) => `${handNo}-${pl.card}`)} handKeys={mine.map((c, i) => (c ? `${handNo}-${c}` : `${handNo}-hb-${i}`))} />
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
      {wide && mine.length > 0 && <HandGlow aspect={aspect} count={mine.length} safeFrac={safeFrac} opts={fanOpts} />}
      {intro && <ShuffleDeck key={`shuffle-${handNo}`} at={deck} back={back} tl={tl} quality={quality} />}
    </group>
  );
}

/** A soft purple glow on a camera-space plane just behind the hand (desktop): makes your cards the focus. */
function HandGlow({ aspect, count, safeFrac, opts }: { aspect: number; count: number; safeFrac: number; opts: FanOpts }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(128, 128, 4, 128, 128, 128);
    grd.addColorStop(0, 'rgba(185,128,255,0.55)');
    grd.addColorStop(0.45, 'rgba(140,80,230,0.22)');
    grd.addColorStop(1, 'rgba(140,80,230,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 128);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  }, []);
  const xf = useMemo(() => {
    const cam = makeCamera(aspect, opts.short);
    const L = fanLayout(aspect, count, safeFrac, opts);
    const w = (count - 1) * L.step + L.cw * 2.2, h = L.ch * 1.25;
    const D = 1.02;
    const local = new Matrix4().compose(new Vector3(0, (-L.viewH / 2 + h / 2) * D, -D), new Quaternion(), new Vector3(w * D, h * D, 1));
    const m = cam.matrixWorld.clone().multiply(local);
    const p = new Vector3(), q = new Quaternion(), sc = new Vector3();
    m.decompose(p, q, sc);
    return { p, q, sc };
  }, [aspect, count, safeFrac, opts]);
  return (
    <mesh position={xf.p} quaternion={xf.q} scale={xf.sc} renderOrder={-1}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </mesh>
  );
}

/**
 * Publishes the *final* screen rects of the trick cards and the human hand (target transforms projected with the live
 * camera) on window.__bwmLayout, so UI tests can check that HTML overlays never cover them.
 */
function LayoutProbe({ items, trickKeys, handKeys }: { items: { key: string; target: Xform }[]; trickKeys: string[]; handKeys: string[] }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const rect = (t: Xform) => {
      const m = new Matrix4().compose(new Vector3(...t.p), new Quaternion(...t.q), new Vector3(t.s, t.s, t.s));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [cx, cy] of [[-CW / 2, -CH / 2], [CW / 2, -CH / 2], [CW / 2, CH / 2], [-CW / 2, CH / 2]] as const) {
        const v = new Vector3(cx, cy, 0).applyMatrix4(m).project(camera);
        const x = (v.x + 1) * size.width / 2, y = (1 - v.y) * size.height / 2;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    };
    const by = new Map(items.map((it) => [it.key, it.target]));
    const pick = (keys: string[]) => keys.map((k) => by.get(k)).filter((t): t is Xform => !!t).map(rect);
    (window as unknown as { __bwmLayout: unknown }).__bwmLayout = { w: size.width, h: size.height, trick: pick(trickKeys), hand: pick(handKeys) };
  });
  return null;
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

function Badges({ positions, n, human, renderSeat, portal, safeFrac, short, safe }: Pick<SceneProps, 'positions' | 'n' | 'human' | 'renderSeat'> & { portal: RefObject<HTMLDivElement>; safeFrac: number; short: boolean; safe: { l: number; r: number; t: number; b: number } }) {
  return (
    <>
      {positions.map((p, seat) => {
        if (seat === human) return null;
        const side = p === 'left' || p === 'right' ? p : p === 'top' ? 'top' : null;
        // phone landscape: plates pinned to the screen edges at mid-height, partner top-centre under the scorebug
        if (short && side) {
          const cls = side === 'top' ? 'side-topc' : `side-${side}`;
          // top seat: left edge just right of the fan (badgeSpot sits beside it), so no card peeks out under the plate
          const calcShort = (el: Object3D, camera: Camera, size: { width: number; height: number }) =>
            side === 'top' ? [Math.min(size.width - 200, (new Vector3().setFromMatrixPosition(el.matrixWorld).project(camera).x + 1) * size.width / 2), 50 + safe.t] : side === 'left' ? [8 + safe.l, size.height * (n === 3 ? 0.36 : 0.43)] : [size.width - 8 - safe.r, size.height * (n === 3 ? 0.36 : 0.43)];
          return (
            <Html key={seat} position={badgeSpot(p, n)} calculatePosition={calcShort} zIndexRange={[5, 0]} className={`seat-anchor ${cls}`} portal={portal}>
              {renderSeat(seat)}
            </Html>
          );
        }
        // side plates are anchored by their outer edge and clamped inside the viewport (+ iOS safe area)
        const calc = side
          ? (el: Object3D, camera: Camera, size: { width: number; height: number }) => {
            const v = new Vector3().setFromMatrixPosition(el.matrixWorld).project(camera);
            const x = (v.x + 1) * size.width / 2, y = (1 - v.y) * size.height / 2;
            const pad = 6 + safeFrac * size.width;
            if (side === 'top') {
              // left-anchored; measured (plate + video bubble) so it stays clear of the right edge and below the trump strip
              const plate = portal.current?.querySelector<HTMLElement>('.seat-anchor.side-top > .plate');
              const pr = plate?.getBoundingClientRect();
              const br = plate?.querySelector('.vbubble')?.getBoundingClientRect();
              const pw = pr ? Math.max(pr.right, br?.right ?? 0) - Math.min(pr.left, br?.left ?? Infinity) : 190;
              const ph = pr ? Math.max(pr.height, br?.height ?? 0) : 56;
              const sr = document.querySelector('.trump-strip')?.getBoundingClientRect();
              const bug = document.querySelector('.scorebug .bug')?.getBoundingClientRect();
              const bar = sr && sr.height > 0 ? sr.bottom : bug ? bug.bottom : size.width >= 900 ? 106 : 122; // the strip folds into the bug on cramped phones
              const left = br && pr ? Math.max(0, pr.left - br.left) : 0;
              const minY = bar + 8 + ph / 2;
              let cy = Math.max(y, minY);
              // and keep clear of the side plates below it (big video bubbles on small phones)
              const sides = [...(portal.current?.querySelectorAll<HTMLElement>('.seat-anchor.side-left > .plate, .seat-anchor.side-right > .plate') ?? [])].map((e) => e.getBoundingClientRect().top).filter((t) => t > 0);
              if (sides.length) cy = Math.max(minY, Math.min(cy, Math.min(...sides) - 6 - ph / 2));
              return [Math.max(pad + left, Math.min(x, size.width - pad - pw + left)), cy];
            }
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
  const tableGroup = useRef<Group>(null);
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
      <FxShake table={tableGroup} />
      <color attach="background" args={['#0c0712']} />
      <fog attach="fog" args={['#0c0712', 7, 16]} />
      <Lights quality={props.quality} />
      <Suspense fallback={null}>
        {hi && <Environment files="/assets/hdri/billiard_hall_1k.hdr" environmentIntensity={0.55} background backgroundBlurriness={0.55} backgroundIntensity={0.22} />}
        <group ref={tableGroup}><TableModel quality={props.quality} /></group>
      </Suspense>
      {props.positions.map((p, seat) => <TurnRing key={seat} pos={p} n={props.n} active={props.turnSeat === seat} />)}
      <Cards {...props} aspect={aspect} fontsReady={fontsReady} safeFrac={safeFrac} />
      {layerReady && <Badges positions={props.positions} n={props.n} human={props.human} renderSeat={props.renderSeat} portal={badgeLayer} safeFrac={safeFrac} short={!!props.short} safe={props.safe ?? { l: 0, r: 0, t: 0, b: 0 }} />}
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
