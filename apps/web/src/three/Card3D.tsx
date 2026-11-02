import { useFrame, useThree } from '@react-three/fiber';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { BufferAttribute, Color, ExtrudeGeometry, type Group, type Material, type Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, NoToneMapping, PlaneGeometry, Quaternion, Shape, ShapeGeometry, type Texture, Vector3, type WebGLRenderer } from 'three';
import { cardFaceFragment } from './cardSat';
import { createBackCardMaterial } from './cardBack';
import { cardFaceOutlinePoints, cardGeometry, cardOutlineGeometry } from './geometry';
import { raiseSeconds, applyFaceDepthBias, cardMeshPaint, cardTapHandlers, faceLook, liftEase, screenRaise } from './handLift';
import { CH, CT, CW, FACE_CAP_GAP, type Xform } from './layout';
import { type Sfx, sound } from '../audio';
import { blastPose } from './blastSweep';
import { releaseTornadoCard, sweepParamsFor, sweepPoseAt, type SweepCardParams } from './tornadoSweep';
import { fireCue, fx, tornadoPresentedT } from '../fx';
import { restingFlightWait } from '../trickTiming';
import { dealHoldStale, openingFlight } from './dealFlight';
import { retainFrontTexture } from './cardFace';
import { restingFacing, trickFacingArrived } from './trickFacing';
import { gatherPose } from './gather';
import { playFlightPose, type FlightVariant, type PlayFlightOpts } from './flightPose';
import { impactFraction } from '../landTiming';
import { PILE_THUMP, slamThump } from './shake';
import { PLAY_FLIGHT_MOTIONS, pendingSweepDue, sweepMustWait, type PendingSweep } from './sweepGate';
import { CUT_FACE_ANGLE, deuceFxElapsed, deuceImpactsAfter, deuceSeed, lastDeuceImpactId, pushDeuceImpact } from './deuceImpact';
import { RUN_SLAM_IMPACT_T, runSlamPose } from './runSlamPose';
import { DISTURBANCE_MS, disturbanceFor, disturbanceOffsetAt, lastSlamDisturbanceId, pushSlamDisturbance, slamDisturbancesAfter, type DisturbanceParams } from './slamDisturbance';
import { cutColorFor } from '../deuceFx';
import type { Card } from '@spades/rules';

interface Props {
  face: Texture | null; // null = we only ever see the back
  back: Texture;
  target: Xform;
  from?: Xform;
  /** Landing feel for a trick card (bounce, shake, slam volume). */
  slam?: import('../slam').SlamFeel;
  /** Where this mesh was last sitting in the hand. Applied once, so a play launches from that slot
   *  even if the mesh remounts, and a later sweep does not restart from the hand. */
  origin?: Xform;
  delay?: number;
  duration?: number;
  /** 'lift' is the 200ms group rise. 'slide' closes a gap over 240ms (translate + rotate only, same curve).
   *  'flight' is the deal / table arc. */
  /** glide: tossed, touches down corner-first and flops flat over a short bite (physics landing) */
  motion?: 'lift' | 'flight' | 'slide' | 'glide' | 'gather' | 'flick' | 'runslam';
  arc?: number;
  /** Toss character for a played card's flight (flightPose.ts): reshapes the path inside the same duration. */
  variant?: FlightVariant;
  /** Card-local raise distance. Never folded into `target`, so a select does not retarget the fan.
   *  Applied along screen-up (see `roll`), not along the rolled card, so the end card stays in the fan. */
  raise?: number;
  /** Fan roll in radians. The raise is counter-rotated by this so it stays vertical on screen. */
  roll?: number;
  /** Painter's order. Legal cards use a higher band than illegal cards; index order is kept inside each band. */
  order?: number;
  dim?: boolean;
  /** Played card lying on the felt (trick / Run It): its face takes the matte rest
   *  finish (createRestCardMaterial) instead of the held card's gloss — flat under
   *  the venue light at the sitting camera, gloss bleaches the pips (2026-11-01). */
  restFace?: boolean;
  glow?: boolean;
  /** ☢ armed nuke: this trick card pulses hot red/orange — the nuke is ready to blow but waits for the last cards. */
  armed?: boolean;
  castShadow?: boolean;
  quality: 'high' | 'low';
  /** undefined = not a button (trick cards). null = a hand card you can't play: the tap is swallowed.
   *  The argument is the card id stamped on the mesh that was hit. */
  onTap?: ((cardId: string) => void) | null;
  /** Card id drawn on this mesh. The tap reads this, not a fan index. */
  cardId?: string | null;
  name?: string;
  /** Sound when this card starts moving toward its current target (e.g. dealt flick, sweep). Fires once per value. */
  sfxStart?: Sfx;
  /** Sounds when this card lands on its current target (e.g. play / cut). Fires once per value. */
  sfxLand?: string; // comma-separated Sfx names, e.g. 'play,cut'
  /** Deuce Drop / Cut impact for this play (deuceFx.ts, classified by Scene from game state):
   *  on the landing frame this card fires the felt ripple event (deuceImpact.ts), takes the
   *  tight thump shake and settles with extra weight. `victim` is the beaten trump of a Cut. */
  impactFx?: { kind: 'drop' | 'cut'; victim?: Card | null } | null;
  /** This trick card is the beaten trump of a later Cut: the knock direction on the felt
   *  (unit x/z, pointing away from the stealer's landing spot). The knock itself starts when
   *  the stealer's impact event lands on the bus (deuceImpact.ts). */
  knock?: { dirX: number; dirZ: number } | null;
  /** Phase 3: seat this card's sounds come from (spatialised play/slam/deal/collect). */
  spatialSeat?: import('./layout').SeatPos; spatialN?: number;
  /** how the nuke's blast treats this card: table cards are blown outward; hand cards only in Full Nuke */
  blast?: 'table' | 'hand';
  /** Deal flight: stay invisible until this card leaves the deck, so the fan does not show up early. */
  holdUntilMove?: boolean;
  /** False until the physical shader has been linked off the draw. The card stays a basic textured quad, then becomes the lit card. */
  lit?: boolean;
}

const xKey = (x: Xform) => x.p.map((v) => v.toFixed(4)).join() + x.q.map((v) => v.toFixed(4)).join() + x.s.toFixed(4);
const edgeMat = new MeshStandardMaterial({ color: '#efe9dc', roughness: 0.75 });
/** full colour vs. a card you can't play: 55% brightness on screen, faint cool tint, desaturated */
/** Adds a saturation control to a card face material (uSat: 1 = untouched); one shader variant shared by every card. */
function withSaturation<M extends MeshStandardMaterial>(m: M): M & { userData: { sat: { value: number } } } {
  const sat = { value: 1 };
  m.userData.sat = sat;
  m.onBeforeCompile = (sh, renderer) => {
    sh.uniforms.uSat = sat;
    // Tone-mapped programs declare uSat above the prefix functions. Otherwise the user shader has to.
    const toneMapped = (renderer as WebGLRenderer).toneMapping !== NoToneMapping;
    sh.fragmentShader = cardFaceFragment(sh.fragmentShader, !toneMapped);
  };
  m.customProgramCacheKey = () => 'card-sat';
  return m as M & { userData: { sat: { value: number } } };
}

function cardMaterial(map: Texture, quality: 'high' | 'low') {
  return quality === 'high'
    ? new MeshPhysicalMaterial({ map, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35, sheen: 0.2, sheenRoughness: 0.6 })
    : new MeshStandardMaterial({ map, roughness: 0.5 });
}

/** The lit card program (clearcoat + sheen on high). Warmed before it is ever drawn. */
export function createLitCardMaterial(map: Texture, quality: 'high' | 'low', saturate: boolean) {
  const m = cardMaterial(map, quality);
  return saturate ? withSaturation(m) : m;
}

/**
 * Played-card face finish — the glare-cut stock for a card lying flat on the felt.
 *
 * The 2026-11-01 round-2 glare report (owner, Grandma's Kitchen, sitting view):
 * the round-1 matte backs read fine, but a played card's FACE bleaches where it
 * lies flat in the trick — the partner's A♥ read almost blank until he stood up.
 * The gloss face stock (clearcoat 0.35, roughness 0.42, env 1) suits a card
 * tilted in a hand; lying flat under the venue's overhead light at the sitting
 * camera it sits in the mirror path, and the specular adds white on white until
 * the pips drown (ACES squashes what is left). A played card is print lying on a
 * table, not a held collectible: matte like the backs, tuned on the felt. Held
 * cards keep createLitCardMaterial and their gloss, untouched.
 */
export const FACE_REST_ROUGHNESS_HIGH = 0.85;
export const FACE_REST_CLEARCOAT = 0;
export const FACE_REST_ENV_INTENSITY_HIGH = 0.4;
export const FACE_REST_ROUGHNESS_LOW = 0.8;
export const FACE_REST_ENV_INTENSITY_LOW = 0.45;

function restCardMaterial(map: Texture, quality: 'high' | 'low') {
  if (quality === 'high') {
    const m = new MeshPhysicalMaterial({
      map,
      roughness: FACE_REST_ROUGHNESS_HIGH,
      clearcoat: FACE_REST_CLEARCOAT,
      clearcoatRoughness: 0.6,
      sheen: 0,
    });
    m.envMapIntensity = FACE_REST_ENV_INTENSITY_HIGH;
    return m;
  }
  const m = new MeshStandardMaterial({ map, roughness: FACE_REST_ROUGHNESS_LOW });
  m.envMapIntensity = FACE_REST_ENV_INTENSITY_LOW;
  return m;
}

/** The played-card face program (matte rest finish, saturated like every face). Warmed before it is ever drawn. */
export function createRestCardMaterial(map: Texture, quality: 'high' | 'low') {
  const m = withSaturation(restCardMaterial(map, quality));
  (m.userData as { restFace?: boolean }).restFace = true;
  return m;
}

type Pt = { x: number; y: number };
/** Sutherland–Hodgman clip of the face outline by one side of the cut line. */
function clipHalf(pts: Pt[], nx: number, ny: number, side: 1 | -1): Pt[] {
  const out: Pt[] = [];
  if (!pts.length) return out;
  const d = (p: Pt) => (p.x * nx + p.y * ny) * side;
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i]!; const prev = pts[(i + pts.length - 1) % pts.length]!;
    const dc = d(cur); const dp = d(prev);
    const curIn = dc >= -1e-9; const prevIn = dp >= -1e-9;
    if (curIn !== prevIn) {
      const t = dp / (dp - dc);
      out.push({ x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t });
    }
    if (curIn) out.push(cur);
  }
  // Drop a duplicated closing point if present.
  if (out.length > 1) {
    const a = out[0]!; const b = out[out.length - 1]!;
    if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) out.pop();
  }
  return out;
}
function shapeFrom(pts: Pt[]): Shape {
  const s = new Shape();
  if (!pts.length) return s;
  s.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i]!.x, pts[i]!.y);
  s.closePath();
  return s;
}
function remapFaceUV(g: ShapeGeometry): void {
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) + CW / 2) / CW;
    uv[i * 2 + 1] = (pos.getY(i) + CH / 2) / CH;
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
}
/** Build the two half-card geometries (face + extruded core) clipped along CUT_FACE_ANGLE. */
function buildCutHalves(): { face: ShapeGeometry; core: ExtrudeGeometry }[] {
  const outline = cardFaceOutlinePoints(5);
  const nx = -Math.sin(CUT_FACE_ANGLE); const ny = Math.cos(CUT_FACE_ANGLE);
  return ([1, -1] as const).map((side) => {
    const pts = clipHalf(outline, nx, ny, side);
    const shape = shapeFrom(pts);
    const face = new ShapeGeometry(shape, 4);
    remapFaceUV(face);
    face.translate(0, 0, CT / 2 + FACE_CAP_GAP + 0.0006);
    const core = new ExtrudeGeometry(shape, { depth: CT, bevelEnabled: false, curveSegments: 4 });
    core.translate(0, 0, -CT / 2);
    return { face, core };
  });
}

function Card3D({ face, back, target, from, origin, delay = 0, duration = 0.45, motion = 'flight', arc = 0.25, variant, raise = 0, roll = 0, order = 0, dim, restFace, glow, armed, castShadow = true, quality, onTap, cardId = null, name, sfxStart, sfxLand, impactFx, knock, spatialSeat, spatialN = 4, blast = 'table', holdUntilMove = false, lit = true, slam }: Props) {
  const slamNow = useRef(slam);
  const postLand = useRef(0);
  slamNow.current = slam;
  const ref = useRef<Group>(null);
  // First mount only. A follow-up render drops the deal props before useFrame runs.
  const mountedFlight = useRef({ from, delay });
  const hideUntilStart = useRef(holdUntilMove);
  const lift = useRef<Group>(null);
  const inner = useRef<Group>(null);
  const bl = useRef({ dir: new Vector3(), q: new Quaternion(), axis: new Vector3(), on: false, flung: false, stamp: -1 });
  const invalidate = useThree((s) => s.invalidate);
  const cam = useThree((s) => s.camera);
  const viewSize = useThree((s) => s.size);
  const geo = cardGeometry();
  // A null face means "not painted yet" and the front shows the back. Once the pips have
  // been on screen, a later null (painter restart, selection rerender) keeps them.
  const shownFace = useRef<Texture | null>(null);
  const frontTex = retainFrontTexture(face, shownFace.current);
  if (frontTex) shownFace.current = frontTex;
  const frontMat = useMemo(() => {
    const map = frontTex ?? back;
    // Unlit until the physical program is linked. MeshBasic with a map is one small shader shared by every card.
    // A played card lying on the felt takes the matte rest finish, never the held card's gloss (2026-11-01 glare round 2).
    const m = lit ? (restFace ? createRestCardMaterial(map, quality) : createLitCardMaterial(map, quality, true)) : new MeshBasicMaterial({ map });
    // Face and cap are both opaque, so they share one list. renderOrder can sort them,
    // but a 16-bit depth test still drops the face when the two planes quantize together.
    applyFaceDepthBias(m);
    return m;
  }, [frontTex, back, quality, lit, restFace]); // eslint-disable-line react-hooks/exhaustive-deps
  const backMat = useMemo(() => {
    // Backs are matte print (cardBack.ts) — the face's glossy stock mirrors the
    // table lights into a white slab off the tilted opponent fans (2026-11-01 glare).
    const m = lit ? createBackCardMaterial(back, quality) : new MeshBasicMaterial({ map: back });
    // The face bias pulls toward the camera. The same bias on the back plane drew a second
    // copy of the pips just behind the card (the ghost queen behind the queen of spades).
    m.polygonOffset = false;
    return m;
  }, [back, quality, lit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Your turn: cards you can't play sit at 55% brightness (still readable); playable cards stay at full colour
  // and get a gold ring on their own rounded edge. The face eases in ~150 ms. The ring is also a tip mark.
  // The ring is opaque, does not write depth, and is drawn after every peer face.
  // Drawn under the face, the card beside it covers the shared edge and a run of legal
  // cards becomes one outline. The hole in the ring leaves the pips showing. A selected
  // card's face still draws after those peer rings, and its own ring draws after that.
  const glowMat = useMemo(() => new MeshBasicMaterial({ color: '#f5c542', transparent: false, opacity: 1, depthWrite: false, toneMapped: false }), []);
  // Armed nuke outline: hot red/orange, opacity pulsed every frame while armed (see useFrame).
  const armedMat = useMemo(() => new MeshBasicMaterial({ color: '#ff7a1a', transparent: true, opacity: 0, depthWrite: false, toneMapped: false }), []);
  const edge = useMemo(() => edgeMat.clone(), []);
  // Cut wound + hero beat meshes (imperative, inside the inner group).
  const bodyMesh = useRef<Mesh>(null);
  const frontMesh = useRef<Mesh>(null);
  const backMesh = useRef<Mesh>(null);
  const glowMesh = useRef<Mesh>(null);
  const armedMesh = useRef<Mesh>(null);
  const halfGroups = useRef<(Group | null)[]>([null, null]);
  const gashMesh = useRef<Mesh>(null);
  const glowNow = useRef({ glow: !!glow, armed: !!armed });
  glowNow.current = { glow: !!glow, armed: !!armed };
  const cutHalves = useMemo(() => {
    const geos = buildCutHalves();
    const mkFace = () => {
      const map = frontTex ?? back;
      const m = lit ? (restFace ? createRestCardMaterial(map, quality) : createLitCardMaterial(map, quality, true)) : new MeshBasicMaterial({ map });
      (m as unknown as { userData: Record<string, unknown> }).userData.cutHalf = true;
      applyFaceDepthBias(m as MeshBasicMaterial);
      return m;
    };
    return geos.map((g) => ({ faceGeo: g.face, coreGeo: g.core, faceMat: mkFace(), coreMat: edgeMat.clone() }));
  }, [frontTex, back, quality, lit, restFace]); // eslint-disable-line react-hooks/exhaustive-deps
  const gashGeo = useMemo(() => {
    const g = new PlaneGeometry(0.43, 0.014);
    g.translate(0, 0, CT / 2 + FACE_CAP_GAP + 0.0008);
    return g;
  }, []);
  const gashMat = useMemo(() => new MeshBasicMaterial({ color: '#140d08', transparent: true, opacity: 0.92, depthWrite: false }), []);
  // The root group keeps `order` for taps. Child groups reset Three.js groupOrder, so each mesh
  // carries its own: body at `order`, face and back half a step later, the gold ring after
  // every peer face. A selected card's face stays above those rings.
  // The face keeps the depth test: it is FACE_CAP_GAP ahead of the cap and biased in window
  // depth, so a 16-bit buffer cannot paint the cream cap over the pips. The ring does not.
  // The card on the right is closer, and a depth test would hide this stroke even after the
  // later paint. OUTLINE_AHEAD still lifts the ring off its own face plane.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.renderOrder = order;
    if (cardId) root.userData.cardId = cardId;
    root.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as Material | Material[] | undefined;
      const list = mat ? (Array.isArray(mat) ? mat : [mat]) : [];
      const onFace = list.includes(frontMat) || list.some((m) => (m as Material & { userData?: { cutHalf?: boolean } }).userData?.cutHalf);
      const onBack = list.includes(backMat);
      const onGlow = list.includes(glowMat) || list.includes(armedMat);
      const paint = cardMeshPaint(order, onGlow ? 'glow' : onFace ? 'face' : onBack ? 'back' : 'edge');
      mesh.renderOrder = paint.renderOrder;
      for (const m of list) m.depthTest = paint.depthTest;
    });
    invalidate();
  }, [order, cardId, face, glow, armed, frontMat, backMat, glowMat, armedMat, invalidate]);
  const look = useRef({ target: new Color(1, 1, 1), sat: 1 });
  useLayoutEffect(() => {
    const lookAt = faceLook(!!dim);
    look.current.target.setRGB(lookAt.color[0], lookAt.color[1], lookAt.color[2]);
    look.current.sat = lookAt.sat;
    if ('emissive' in frontMat && frontMat.emissive) frontMat.emissive.set('#000000');
    // the clear coat / sheen add white on top of the colour (and ACES squashes the rest), so ease them off too when dimmed
    // (a rest-finish face has no gloss to restore — its matte values are its home values)
    if (frontMat instanceof MeshPhysicalMaterial && !(frontMat.userData as { restFace?: boolean }).restFace) { frontMat.clearcoat = dim ? 0.05 : 0.35; frontMat.sheen = dim ? 0 : 0.2; }
    invalidate();
  }, [dim, frontMat, invalidate]);

  const tw = useRef({
    init: false,
    key: '',
    originKey: '',
    t: 1,
    wait: delay,
    sp: new Vector3(), sq: new Quaternion(), ss: 1,
    tp: new Vector3(), tq: new Quaternion(), ts: 1,
    started: false, firedStart: '' as string, firedLand: '' as string, landDone: false, land: undefined as string | undefined,
    faced: false,
    // The running tween's own motion / arc / variant / duration, snapshotted at
    // adoption. A collection retarget changes the live props the moment it is
    // requested; the flight already in the air must keep flying on ITS OWN
    // parameters until it rests (see sweepGate.ts).
    motionSnap: 'flight' as string, arcSnap: 0.25, variantSnap: undefined as FlightVariant | undefined, durSnap: 0,
    isSweep: false,
    // A collection move held by the gate until this card's play flight rests.
    pending: null as PendingSweep<Xform> | null,
  });
  useLayoutEffect(() => {
    const g = ref.current;
    if (!g) return;
    // A deal hold lives only while the live prop holds it. The commit that observes the
    // deal window closing releases the card HERE — before paint, with no dependence on a
    // frame ever running — and the lift settle below cannot poison the release, because
    // this runs first in the same commit and the predicate never consults the tween
    // (2026-10-24: the settle marked the card started while it was still hidden, and
    // the frame-loop release's started-gate then refused for the rest of the hand).
    if (dealHoldStale({ held: hideUntilStart.current, liveHold: holdUntilMove })) {
      hideUntilStart.current = false;
      tw.current.wait = 0;
      g.visible = true;
    }
    if (hideUntilStart.current && !tw.current.started) g.visible = false;
    // Field/test probe: this card's visibility as of this commit (companion to __bwmHandVis).
    if (cardId && typeof window !== 'undefined') {
      const w = window as unknown as { __bwmCardVis?: Record<string, boolean> };
      (w.__bwmCardVis ??= {})[cardId] = g.visible;
    }
    // A resumed card has no flight. Snap it before the first paint so the hand and the trick
    // are not at the origin for a frame (that frame reads as an empty fan or an empty trick).
    if (tw.current.init || from || origin) return;
    if (!target.p.every(Number.isFinite) || !target.q.every(Number.isFinite) || !Number.isFinite(target.s)) return;
    g.position.set(...target.p);
    g.quaternion.set(...target.q);
    g.scale.setScalar(target.s);
    g.updateMatrixWorld(true);
  });
  const sfx = useRef({ sfxStart, sfxLand });
  sfx.current = { sfxStart, sfxLand };
  const fxNow = useRef({ impactFx, knock });
  fxNow.current = { impactFx, knock };
  // Deuce Drop / Cut runtime (deuceFx.ts / deuceImpact.ts): `impact` is the running
  // tween's classified landing, snapshotted at adoption like the cue; `dipAt` starts
  // the heavy settle on the landing frame; `knockAt`/`knockDir` run the beaten
  // trump's shove + tilt + dim when the stealer's impact names this card.
  const dk = useRef({
    impact: null as { kind: 'drop' | 'cut'; victim: Card | null } | null,
    dipAt: 0, dipDepth: 0, knockAt: 0, knockDir: { x: 0, z: 1 }, innerActive: false,
    cutAt: 0, heroAt: 0, heroAxis: new Vector3(1, 0, 0), splitShown: false,
    seen: lastDeuceImpactId(), q: new Quaternion(), w: new Vector3(), axis: new Vector3(), dimCol: new Color(),
    // Run It slam disturbance (slamDisturbance.ts): the felt strike this card
    // last drained, its seeded bounce/slide, and the frame's live offset —
    // composed on the inner group beside the knock by composeDeuceInner.
    distSeen: lastSlamDisturbanceId(), distAt: 0, distParams: null as DisturbanceParams | null,
    distOff: null as { x: number; y: number; z: number; tilt: number } | null, dq: new Quaternion(),
  });
  const raiseNow = useRef(raise);
  raiseNow.current = raise;
  const rollNow = useRef(roll);
  rollNow.current = roll;
  const raiseTw = useRef({ y: 0, from: 0, to: 0, t: 1 });
  // A highlight used to tween for 160ms. The hit quad is the destination, so the mesh has to
  // be there before paint. Otherwise a reload tap lands on the un-raised slot underneath.
  const poseKey = xKey(target);
  useLayoutEffect(() => {
    if (motion !== 'lift') return;
    const g = ref.current;
    if (!g) return;
    if (!target.p.every(Number.isFinite) || !target.q.every(Number.isFinite) || !Number.isFinite(target.s)) return;
    g.position.set(...target.p);
    g.quaternion.set(...target.q);
    g.scale.setScalar(target.s);
    const s = tw.current;
    s.init = true;
    s.key = poseKey;
    s.t = 1;
    s.started = true;
    s.sp.set(...target.p); s.sq.set(...target.q); s.ss = target.s;
    s.tp.set(...target.p); s.tq.set(...target.q); s.ts = target.s;
    const dest = Number.isFinite(raise) ? raise : 0;
    raiseTw.current.y = dest;
    raiseTw.current.from = dest;
    raiseTw.current.to = dest;
    raiseTw.current.t = 1;
    const liftG = lift.current;
    if (liftG) {
      const off = screenRaise(roll, dest);
      liftG.position.set(off.x, off.y, 0);
    }
    g.updateMatrixWorld(true);
    // Settled in the fan means shown. If the deal still held this card when the settle
    // ran, the hold dies with the settle — a card must never sit invisible at its own
    // slot because its tween was marked started before it was ever visible.
    if (hideUntilStart.current) { hideUntilStart.current = false; g.visible = true; }
    invalidate();
  }, [motion, poseKey, raise, roll, invalidate, target]);

  /** Restore the whole card (undo a split / gash) — respects the glow/armed props. */
  const restoreWholeCard = () => {
    const dkS = dk.current;
    if (!dkS.splitShown) return;
    dkS.splitShown = false;
    if (bodyMesh.current) bodyMesh.current.visible = true;
    if (frontMesh.current) frontMesh.current.visible = true;
    if (backMesh.current) backMesh.current.visible = true;
    if (glowMesh.current) glowMesh.current.visible = glowNow.current.glow && !glowNow.current.armed;
    if (armedMesh.current) armedMesh.current.visible = glowNow.current.armed;
    for (const hg of halfGroups.current) if (hg) hg.visible = false;
    if (gashMesh.current) gashMesh.current.visible = false;
  };
  const showSplit = (reduced: boolean) => {
    const dkS = dk.current;
    if (dkS.splitShown) return;
    dkS.splitShown = true;
    if (reduced) {
      if (gashMesh.current) gashMesh.current.visible = true;
      return;
    }
    if (bodyMesh.current) bodyMesh.current.visible = false;
    if (frontMesh.current) frontMesh.current.visible = false;
    if (backMesh.current) backMesh.current.visible = false;
    if (glowMesh.current) glowMesh.current.visible = false;
    if (armedMesh.current) armedMesh.current.visible = false;
    for (const hg of halfGroups.current) if (hg) hg.visible = true;
  };

  /** Compose dip + knock + hero on the inner group (world offset → local).
   *  Called both before the resting-card early return (a beaten trump is
   *  already at rest when the Cut lands — its shove must still run) and at
   *  the frame's end for flying cards. Blast/tornado own the group while
   *  they run and are never fought. */
  const composeDeuceInner = (g: Group, dipEnv: number, knockEnv: number, heroEnv: number) => {
    const dkS = dk.current;
    const ig = inner.current;
    if (!ig) return;
    const owned = bl.current.on || bl.current.flung || tn.current.on || tn.current.gone;
    if (owned) return;
    const distOff = dkS.distOff;
    if (dipEnv > 0 || knockEnv > 0 || heroEnv > 0 || distOff) {
      const calm = fx.reduced;
      const kx = calm ? 0 : dkS.knockDir.x * 0.055 * knockEnv + (distOff ? distOff.x : 0);
      const kz = calm ? 0 : dkS.knockDir.z * 0.055 * knockEnv + (distOff ? distOff.z : 0);
      const heroLift = calm ? 0 : 0.085 * heroEnv;
      const w = dkS.w.set(kx, -dkS.dipDepth * dipEnv + heroLift + (calm || !distOff ? 0 : distOff.y), kz);
      dkS.q.copy(g.quaternion).invert();
      w.applyQuaternion(dkS.q).divideScalar(g.scale.x || 1);
      ig.position.copy(w);
      if (!calm && knockEnv > 0) {
        dkS.axis.set(dkS.knockDir.z, 0, -dkS.knockDir.x).normalize().applyQuaternion(dkS.q);
        ig.quaternion.setFromAxisAngle(dkS.axis, 0.3 * knockEnv);
      } else if (!calm && heroEnv > 0) {
        dkS.axis.copy(dkS.heroAxis).normalize().applyQuaternion(dkS.q);
        ig.quaternion.setFromAxisAngle(dkS.axis, 0.34 * heroEnv);
      } else ig.quaternion.identity();
      // The slam disturbance's own tilt rides on top (tipping away from the strike).
      if (!calm && distOff && distOff.tilt > 0.0005 && dkS.distParams) {
        dkS.axis.set(dkS.distParams.dirZ, 0, -dkS.distParams.dirX).normalize().applyQuaternion(dkS.q);
        dkS.dq.setFromAxisAngle(dkS.axis, distOff.tilt);
        ig.quaternion.multiply(dkS.dq);
      }
      ig.scale.setScalar(calm ? 1 : 1 + 0.15 * heroEnv);
      dkS.innerActive = true;
      invalidate();
    } else if (dkS.innerActive) {
      ig.position.set(0, 0, 0);
      ig.quaternion.identity();
      ig.scale.setScalar(1);
      dkS.innerActive = false;
      invalidate();
    }
  };

  /** Nuke blast. Table cards sweep off the felt and stay there. Hand cards kick and spring home. */
  const applyBlast = (g: Group) => {
    const ig = inner.current, B = fx.blast, st = bl.current;
    if (!ig) return;
    if (B && st.stamp !== B.start) { st.stamp = B.start; st.on = false; st.flung = false; }
    // the cards ride the blast's PRESENTED clock (fx.nukeT, published by Nuke3D
    // every frame): a mid-show stall stretches the blow-away with the fireball
    // instead of the cards leaping on wall time. The wall read remains only as
    // a fallback for a blast whose run has not published yet (its first frame).
    const u = B && (blast === 'table' || B.hand) ? (fx.warp !== null ? fx.warp - 0.3 : fx.nukeT !== null ? fx.nukeT - 0.3 : (performance.now() - B.start) / 1000) : -1;
    const pose = blastPose(u, blast === 'hand' ? 'hand' : 'table', B?.mega === true);
    // A table card that has left stays off the cloth when the cloud ends. Coming back reads as a miss.
    if (!pose) {
      if (blast === 'table' && st.flung) return;
      if (st.on) { ig.position.set(0, 0, 0); ig.quaternion.identity(); st.on = false; invalidate(); }
      return;
    }
    invalidate();
    if (!st.on) {
      st.on = true;
      st.dir.set(g.position.x, 0, g.position.z);
      if (st.dir.lengthSq() < 1e-4) st.dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      st.dir.normalize();
      st.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    }
    if (blast === 'table' && pose.out > 3) st.flung = true;
    const w = new Vector3(st.dir.x * pose.out, pose.lift, st.dir.z * pose.out + (pose.z ?? 0));
    // world offset → this card's local space
    st.q.copy(g.quaternion).invert();
    w.applyQuaternion(st.q).divideScalar(g.scale.x || 1);
    ig.position.copy(w);
    ig.quaternion.setFromAxisAngle(st.axis, pose.tumble);
  };

  /**
   * 'Run it!' tornado: pulled off its spot into the funnel over the table centre (hand cards first), spun up the
   * funnel, then flung out and gone. Reduce effects: a plain slide into the centre that shrinks away.
   * Returns true while it owns the inner offset (the nuke blast is skipped then).
   */
  const tn = useRef({ on: false, gone: false, params: null as SweepCardParams | null, axis: new Vector3(), q: new Quaternion() });
  const applyTornado = (g: Group): boolean => {
    const ig = inner.current, T = fx.tornado, st = tn.current;
    if (!ig) return false;
    // Already flung. A later frame must not put this mesh back on the trick or in the hand.
    if (st.gone) { ig.visible = false; return true; }
    // the cards ride the funnel's presented clock (fx.tornadoPresentedT: stamped
    // at the first frame at/after the scheduled start by whoever renders first,
    // then integrated from presented frames — a stall stretches the sweep
    // instead of skipping it)
    const u = T ? (fx.warp !== null ? fx.warp : tornadoPresentedT(T, performance.now())) : -1;
    if (!T || u < 0) {
      const next = releaseTornadoCard({ taken: st.on, gone: st.gone, visible: ig.visible });
      st.gone = next.gone;
      if (next.gone) { ig.visible = false; invalidate(); return true; }
      if (T) invalidate(); // waiting for the funnel to start: keep frames coming (frameloop is on demand)
      return false;
    }
    // ☢☢ Mega composition: the blast already blew this table card off the felt before the funnel
    // started (the mega tornado is deliberately late). It stays gone — snapping it back to its
    // resting spot to join the funnel would read as a glitch, not a show. The funnel takes the hands.
    if (blast === 'table' && bl.current.flung) { st.gone = true; ig.visible = false; invalidate(); return true; }
    invalidate();
    if (!st.on) {
      st.on = true;
      // Sweep geometry is parametric now (tornadoSweep.ts, Wave B): the pose is
      // a pure function of these per-card params + local sweep time. The params
      // reproduce the shipped per-card hash/angles/delay exactly.
      st.params = sweepParamsFor(name ?? '', g.position.x, g.position.z, blast === 'hand');
      st.axis.set(st.params.axis[0], st.params.axis[1], st.params.axis[2]);
    }
    const params = st.params!;
    const pose = sweepPoseAt(params, Math.max(0, u - params.delay), T.reduced);
    const pull = pose.pull;
    const w = new Vector3(pose.x, pose.y, pose.z);
    const spin = pose.spin;
    // everything the same size in the funnel (your hand cards are bigger, near the camera);
    // the reduced path's shrink is the pose's own scale.
    const scale = T.reduced ? pose.scale : 1 + ((0.85 / (g.scale.x || 1)) - 1) * pull;
    const left = pose.left;
    ig.visible = !left;
    if (left) st.gone = true;
    // world funnel spot → this card's local space (offset from its resting spot)
    const off = w.sub(g.position).multiplyScalar(pull);
    st.q.copy(g.quaternion).invert();
    off.applyQuaternion(st.q).divideScalar(g.scale.x || 1);
    ig.position.copy(off);
    ig.quaternion.setFromAxisAngle(st.axis, spin * pull);
    ig.scale.setScalar(scale);
    return true;
  };

  useFrame((_, rawDt) => {
    const g = ref.current;
    if (!g) return;
    // ☢ Armed nuke: the trick cards pulse hot — "ready to blow" — until the last card lands and
    // the trick detonates (the outline hides again then). demand loop: keep frames coming.
    const am = armedMat;
    if (armed) {
      if (fx.reduced || fx.osReducedMotion) {
        am.opacity = 0.8;
        am.color.set('#ff7a1a');
      } else {
        const u = (performance.now() % 1000) / 1000; // 1 Hz breathing pulse, building heat
        const pulse = 0.5 + 0.5 * Math.sin(u * Math.PI * 2);
        am.opacity = 0.3 + 0.65 * pulse;
        am.color.setHSL(0.055 + 0.035 * pulse, 1, 0.48 + 0.14 * pulse);
      }
      invalidate();
    } else if (am.opacity !== 0) am.opacity = 0;
    // Backstop for the commit-time release in the layout effect above: the deal is over
    // but this card never left the deck — the mount-time hold is a ref and the tween wait
    // runs in frame time, which can crawl on a starved canvas long after the wall-clock
    // deal expired. Release it, or the fan can sit at a few cards all hand. The tween's
    // `started` flag is deliberately NOT consulted (see dealHoldStale): the lift settle
    // sets it while a card is still hidden, which is how this release was poisoned in
    // the 2026-10-24 recurrence.
    if (dealHoldStale({ held: hideUntilStart.current, liveHold: holdUntilMove })) {
      hideUntilStart.current = false;
      tw.current.wait = 0;
      g.visible = true;
    }
    if (hideUntilStart.current && !tw.current.started) g.visible = false;
    // A resume hitch must not fast-forward the fan. One frame advances at most 50ms, same as a slow paint.
    const dt = Math.min(Math.max(rawDt, 0), 0.05);
    // Deuce Cut knock — this card is a beaten trump: drain the impact bus for a
    // fresh event naming it, while it rests on the felt from its own play flight
    // (a hand card, a pile card or a card still in the air can never be knocked).
    // The envelope drives the face dim here and the shove/tilt at the frame's end.
    const dkS = dk.current;
    if (lastDeuceImpactId() > dkS.seen) {
      const freshImpacts = deuceImpactsAfter(dkS.seen);
      if (freshImpacts.length) {
        dkS.seen = freshImpacts[freshImpacts.length - 1]!.id;
        const s0 = tw.current;
        for (const e of freshImpacts) {
          if (e.kind === 'cut' && e.victim && e.victim === cardId && fxNow.current.knock
            && s0.t >= 1 && !s0.isSweep && PLAY_FLIGHT_MOTIONS.has(s0.motionSnap) && g.position.y < 0.35) {
            dkS.knockAt = e.at;
            dkS.cutAt = e.at;
            dkS.knockDir.x = fxNow.current.knock.dirX;
            dkS.knockDir.z = fxNow.current.knock.dirZ;
          }
        }
      }
    }
    // Run It slam disturbance — drain the felt-strike bus like the impact bus
    // above. Only a card AT REST on the felt can be disturbed: not a hand card
    // (blast 'hand' / a fan back with no id), not the striking card itself, not
    // a card still in the air. Under Reduce effects the event is drained and
    // dropped (the knock's calm, one step earlier). Seeded per card, so every
    // viewer disturbs the same cards the same way.
    if (lastSlamDisturbanceId() > dkS.distSeen) {
      const freshSlams = slamDisturbancesAfter(dkS.distSeen);
      if (freshSlams.length) {
        dkS.distSeen = freshSlams[freshSlams.length - 1]!.id;
        const s0 = tw.current;
        for (const e of freshSlams) {
          if (!fx.reduced && cardId && e.source !== cardId && blast !== 'hand'
            && s0.t >= 1 && g.position.y < 0.35) {
            const params = disturbanceFor(g.position.x - e.x, g.position.z - e.z, (e.seed ^ deuceSeed(cardId)) >>> 0);
            if (params) { dkS.distAt = e.at; dkS.distParams = params; }
          }
        }
      }
    }
    {
      const elapsed = dkS.distAt ? deuceFxElapsed(performance.now() - dkS.distAt) : Number.POSITIVE_INFINITY;
      dkS.distOff = dkS.distParams && elapsed < DISTURBANCE_MS ? disturbanceOffsetAt(dkS.distParams, elapsed) : null;
      if (dkS.distAt && elapsed >= DISTURBANCE_MS) { dkS.distAt = 0; dkS.distParams = null; }
    }
    const knockU = dkS.knockAt ? deuceFxElapsed(performance.now() - dkS.knockAt) / 450 : 1;
    const knockEnv = knockU < 1 ? Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, knockU))), 1.4) : 0;
    if (knockU >= 1) dkS.knockAt = 0;
    // The wound: 620 ms split envelope, set with the knock. The halves ease
    // apart over the first 45%, hold, then close as the envelope ends and
    // the whole card restores — all inside the trick hold.
    const cutU = dkS.cutAt ? deuceFxElapsed(performance.now() - dkS.cutAt) / 620 : 1;
    if (dkS.cutAt && cutU < 1) {
      showSplit(fx.reduced);
      const sepT = Math.min(1, cutU / 0.45);
      const sep = 1 - Math.pow(1 - sepT, 3);
      const holdFade = cutU > 0.82 ? Math.max(0, 1 - (cutU - 0.82) / 0.18) : 1;
      const gap = 0.10 * CW * sep * holdFade;
      const nx = -Math.sin(CUT_FACE_ANGLE); const ny = Math.cos(CUT_FACE_ANGLE);
      halfGroups.current.forEach((hg, idx) => {
        if (!hg) return;
        const side = idx === 0 ? 1 : -1;
        hg.position.set(nx * gap * side, ny * gap * side, 0);
        hg.rotation.set(0, 0, side * 0.07 * sep * holdFade);
      });
      invalidate();
    } else {
      if (dkS.cutAt) dkS.cutAt = 0;
      if (dkS.splitShown) { restoreWholeCard(); invalidate(); }
    }
    // The hero beat: 600 ms envelope for the stealer (set at its landing).
    const heroU = dkS.heroAt ? deuceFxElapsed(performance.now() - dkS.heroAt) / 600 : 1;
    const heroEnv = heroU < 1 ? Math.sin(Math.PI * Math.min(1, Math.max(0, heroU))) : 0;
    if (heroU >= 1 && dkS.heroAt) {
      dkS.heroAt = 0;
      if ('emissive' in frontMat) (frontMat as MeshStandardMaterial).emissiveIntensity = 0;
    }
    // colour easing (~150 ms), also capped so a long frame does not snap it
    const L = look.current, k = Math.min(1, dt / 0.15);
    const c = frontMat.color;
    // A knocked trump dims toward 55% at the envelope's peak (also under reduced
    // effects, where the dim is the victim's whole treatment).
    const tgt = knockEnv > 0 ? dkS.dimCol.copy(L.target).multiplyScalar(1 - 0.45 * knockEnv) : L.target;
    if (Math.abs(c.r - tgt.r) + Math.abs(c.g - tgt.g) + Math.abs(c.b - tgt.b) > 0.004) { c.lerp(tgt, k); invalidate(); } else c.copy(tgt);
    const sat = frontMat.userData.sat as { value: number } | undefined;
    if (sat && Math.abs(sat.value - L.sat) > 0.01) { sat.value += (L.sat - sat.value) * k; invalidate(); } else if (sat) sat.value = L.sat;
    // The split halves wear the same dim/saturation as the whole face.
    for (const h of cutHalves) {
      const hm = h.faceMat as MeshStandardMaterial;
      if (hm.color) hm.color.copy(c);
      const hs = (hm as unknown as { userData?: { sat?: { value: number } } }).userData?.sat;
      if (hs) hs.value = L.sat;
    }
    // Hero caught light: the winner's colour on the stealer's face.
    if (heroEnv > 0 && cardId && 'emissive' in frontMat) {
      const pal = cutColorFor(cardId as Card);
      if (pal) {
        const fm = frontMat as MeshStandardMaterial;
        fm.emissive.set(pal.glow);
        fm.emissiveIntensity = (fx.reduced ? 0.35 : 0.55) * heroEnv;
      }
    } else if (dkS.heroAt === 0 && 'emissive' in frontMat) {
      (frontMat as MeshStandardMaterial).emissiveIntensity = 0;
    }
    if (heroEnv > 0) invalidate();
    // Early compose: a resting card returns before the frame-end block
    // below, so its knock/hero must be applied here as well.
    {
      const dipUE = dkS.dipAt ? deuceFxElapsed(performance.now() - dkS.dipAt) / 300 : 1;
      const dipEnvE = dipUE < 1 ? Math.sin(Math.PI * Math.pow(Math.min(1, Math.max(0, dipUE)), 0.8)) : 0;
      if (dipUE >= 1) dkS.dipAt = 0;
      composeDeuceInner(g, dipEnvE, knockEnv, heroEnv);
    }
    if (!applyTornado(g)) applyBlast(g);
    const s = tw.current;
    const poseOk = (x: Xform) => x.p.every(Number.isFinite) && x.q.every(Number.isFinite) && Number.isFinite(x.s);
    // A 0-height canvas produces NaN targets. Adopting one sticks: lerp(NaN, good, t) is NaN,
    // so the hand leaves on that frame and the next trick is an empty outline.
    const finiteTarget = poseOk(target);
    const firstTween = !s.key;
    const liveFrom = from && poseOk(from) ? from : undefined;
    const mountedFrom = mountedFlight.current.from && poseOk(mountedFlight.current.from) ? mountedFlight.current.from : undefined;
    const open = openingFlight({ from: liveFrom, delay }, { from: mountedFrom, delay: mountedFlight.current.delay }, firstTween);
    if (!s.init) {
      const f = (origin && poseOk(origin) ? origin : undefined) ?? open.from ?? (finiteTarget ? target : undefined);
      // No pose yet (0-size canvas): stay hidden. A mesh left at the origin is a stray card mid-felt.
      if (!f) { g.visible = false; return; }
      if (!hideUntilStart.current) g.visible = true;
      g.position.set(...f.p);
      g.quaternion.set(...f.q);
      g.scale.setScalar(f.s);
      s.init = true;
      // consumed on init so this same frame's retarget does not snap a second time
      if (origin && poseOk(origin)) s.originKey = xKey(origin);
    }
    if (finiteTarget && (!Number.isFinite(g.position.x) || !Number.isFinite(g.scale.x))) {
      g.position.set(...target.p);
      g.quaternion.set(...target.q);
      g.scale.setScalar(target.s);
      s.sp.set(...target.p); s.sq.set(...target.q); s.ss = target.s;
      s.tp.set(...target.p); s.tq.set(...target.q); s.ts = target.s;
      s.t = 1;
      s.key = xKey(target);
    }
    const key = finiteTarget ? xKey(target) : s.key;
    // Collection gate (sweepGate.ts): a sweep requested while this card is still
    // flying its play flight is HELD, not adopted — the card lands first, and the
    // held sweep is adopted on the frame it rests (see the t >= 1 branch below).
    // The held copy refreshes every render, so a newer sweep (the dealer
    // collection after the pile gather) replaces an older held one.
    const gated = finiteTarget && key !== s.key && sweepMustWait({
      incomingSfxStart: sfx.current.sfxStart, currentKey: s.key, currentT: s.t, currentMotion: s.motionSnap, currentIsSweep: s.isSweep,
    });
    if (gated) {
      s.pending = {
        key, target, wait: restingFlightWait(open.delay, true) ?? 0, land: sfx.current.sfxLand,
        motion, arc, variant, duration,
      };
    } else if (finiteTarget && key !== s.key) {
      s.pending = null;
      // A new spot (the book pile) starts from the card, not from the flung offset.
      if (bl.current.on || bl.current.flung) {
        bl.current.on = false;
        bl.current.flung = false;
        const ig = inner.current;
        if (ig) { ig.position.set(0, 0, 0); ig.quaternion.identity(); }
      }
      // retargeted before it landed (slow frames: the trick was swept while the card was still in flight) — still make its landing sound
      if (s.key && s.started && s.t < 1) {
        const land = s.land;
        if (land && land !== s.firedLand && s.sp.distanceTo(s.tp) > 0.02) { s.firedLand = land; land.split(',').forEach((c, i) => fireCue(c, i ? 0.02 : 0)); }
      }
      const wasResting = !s.key || s.t >= 1;
      s.key = key;
      s.faced = false;
      s.landDone = false;
      s.land = sfx.current.sfxLand; // this tween's landing cue
      // The adopted tween's deuce classification rides with its cue; a fresh
      // flight also ends any knock/dip the previous pose was still playing.
      dk.current.impact = fxNow.current.impactFx ? { kind: fxNow.current.impactFx.kind, victim: fxNow.current.impactFx.victim ?? null } : null;
      dk.current.knockAt = 0;
      dk.current.cutAt = 0;
      dk.current.heroAt = 0;
      restoreWholeCard();
      dk.current.dipAt = 0;
      s.t = 0;
      // last-trick auto-play retargets a card that is already on screen (your last card keeps its hand key).
      // The stagger is a prop; apply it when the card leaves a resting pose, or it never waits.
      // The opening tween keeps the deal delay the card was mounted with, even if this render already cleared it.
      const hold = restingFlightWait(open.delay, wasResting);
      if (hold !== null) s.wait = hold;
      const stamp = origin ? xKey(origin) : '';
      // A play starts at the card's own fan slot (not wherever the mesh was, and not the fan centre).
      // The stamp is consumed once, so the sweep to the pile keeps going from where the card is.
      if (origin && poseOk(origin) && s.originKey !== stamp) {
        g.position.set(...origin.p);
        g.quaternion.set(...origin.q);
        g.scale.setScalar(origin.s);
        s.sp.set(...origin.p); s.sq.set(...origin.q); s.ss = origin.s;
        s.originKey = stamp;
      } else {
        s.sp.copy(g.position); s.sq.copy(g.quaternion); s.ss = g.scale.x;
        if (!Number.isFinite(s.sp.x) || !Number.isFinite(s.ss)) {
          s.sp.set(...target.p); s.sq.set(...target.q); s.ss = target.s;
          g.position.copy(s.sp); g.quaternion.copy(s.sq); g.scale.setScalar(s.ss);
        }
      }
      s.tp.set(...target.p); s.tq.set(...target.q); s.ts = target.s;
      // Hand cards never inherit a table/flight scale from a reused mesh: they start exactly at fan scale.
      if (motion === 'slide' || blast === 'hand') s.ss = s.ts;
      // Snapshot the adopted tween's own parameters: a later collection request
      // changes the live props at once, but this flight keeps its own until it rests.
      s.motionSnap = motion; s.arcSnap = arc; s.variantSnap = variant; s.durSnap = duration;
      s.isSweep = sfx.current.sfxStart === 'sweep';
      s.started = false;
    }
    // Raise is translateY on its own wrapper (the CSS `will-change: transform` idea). The outer fan
    // quaternion and position stay put, including when the card is only selected or the legal set changes.
    const liftG = lift.current;
    if (liftG) {
      const rt = raiseTw.current;
      const dest = Number.isFinite(raiseNow.current) ? raiseNow.current : 0;
      if (!Number.isFinite(rt.y)) { rt.y = dest; rt.from = dest; rt.to = dest; rt.t = 1; }
      if (Math.abs(dest - rt.to) > 1e-5) { rt.from = rt.y; rt.to = dest; rt.t = 0; }
      if (rt.t < 1) {
        const rs = raiseSeconds();
        rt.t = rs <= 0 ? 1 : Math.min(1, rt.t + dt / rs);
        rt.y = rt.from + (rt.to - rt.from) * liftEase(rt.t);
        invalidate();
      } else rt.y = rt.to;
      const off = screenRaise(rollNow.current, rt.y);
      if (rt.t < 1 || liftG.position.x !== off.x || liftG.position.y !== off.y) {
        liftG.position.set(off.x, off.y, 0);
        liftG.quaternion.identity();
        liftG.scale.set(1, 1, 1);
      }
    }
    // A held sweep's wait is a schedule offset on the shared frame clock —
    // Scene computes it against the same capped-dt accumulation (the
    // review anchor, sweepGate.ts) — so it elapses while this flight
    // finishes, and adoption below waits only the remainder. On the set
    // frame the pending is written by the gate block above with the item's
    // full delay; from the next frame on, this keeps the held wait in
    // lockstep with the flight it is waiting out.
    if (s.pending && s.t < 1) s.pending.wait = Math.max(0, s.pending.wait - dt);
    if (s.t >= 1) {
      // Test probe: keep sampling a slammed card's screen position for a few frames after it lands.
      if (slamNow.current && cardId && postLand.current < 30) {
        postLand.current++;
        const w = window as unknown as { __bwmFly?: Record<string, { now?: number; t: number; x: number; y: number }[]> };
        cam.updateMatrixWorld();
        const v = g.getWorldPosition(new Vector3()).project(cam);
        // relative to the table centre, so a camera shake (which moves everything) does not read as the card moving
        const o = new Vector3(0, 0, 0).project(cam); v.x -= o.x; v.y -= o.y;
        ((w.__bwmFly ??= {})[cardId] ??= []).push({ t: 1, x: ((v.x + 1) / 2) * viewSize.width + 0, y: ((1 - v.y) / 2) * viewSize.height });
        invalidate();
      }
      // A play that reached the trick must not keep the face-down fan quaternion.
      if (!s.faced && finiteTarget) {
        const q = restingFacing(
          [g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w],
          // A held sweep's live target is the pile, not this flight's rest:
          // face against the tween's own target, never the collection's.
          s.pending ? [s.tq.x, s.tq.y, s.tq.z, s.tq.w] : target.q,
          true,
        );
        g.quaternion.set(q[0], q[1], q[2], q[3]);
        s.faced = true;
      }
      const pend = s.pending;
      if (!pend || !pendingSweepDue(pend, s.t)) return;
      // The play flight has rested: the held collection starts now, from the
      // rested pose, on this same frame clock (sweepGate.ts) — so a collection
      // can never begin before the last card rests, at any frame rate.
      s.pending = null;
      if (bl.current.on || bl.current.flung) {
        bl.current.on = false;
        bl.current.flung = false;
        const ig = inner.current;
        if (ig) { ig.position.set(0, 0, 0); ig.quaternion.identity(); }
      }
      s.sp.copy(g.position); s.sq.copy(g.quaternion); s.ss = g.scale.x;
      s.tp.set(...pend.target.p); s.tq.set(...pend.target.q); s.ts = pend.target.s;
      s.key = pend.key;
      s.faced = false;
      s.landDone = false;
      s.land = pend.land;
      dk.current.impact = null;
      dk.current.knockAt = 0;
      dk.current.cutAt = 0;
      dk.current.heroAt = 0;
      restoreWholeCard();
      dk.current.dipAt = 0;
      s.t = 0;
      s.wait = pend.wait;
      s.motionSnap = pend.motion; s.arcSnap = pend.arc; s.variantSnap = pend.variant; s.durSnap = pend.duration;
      s.isSweep = true;
      s.started = false;
      // fall through: the held sweep's tween advances below, on this same frame
    }
    invalidate();
    if (s.wait > 0) { s.wait -= dt; invalidate(); return; }
    const moving = s.sp.distanceTo(s.tp) > 0.02;
    if (!s.started) {
      // the card leaves now — animation-driven sound, so it always matches what you see (any game speed)
      s.started = true;
      if (hideUntilStart.current) { hideUntilStart.current = false; g.visible = true; }
      // Test probe: the pose the flight leaves from (before the first frame moves it)
      if (slamNow.current && cardId) {
        const w = window as unknown as { __bwmFly?: Record<string, { now?: number; t: number; x: number; y: number }[]> };
        cam.updateMatrixWorld();
        const v = g.getWorldPosition(new Vector3()).project(cam);
        const o = new Vector3(0, 0, 0).project(cam); v.x -= o.x; v.y -= o.y;
        ((w.__bwmFly ??= {})[cardId] ??= []).push({ t: 0, x: ((v.x + 1) / 2) * viewSize.width, y: ((1 - v.y) / 2) * viewSize.height });
      }
      const st = sfx.current.sfxStart;
      if (st && st !== s.firedStart) { s.firedStart = st; if (moving) sound.play(st, spatialSeat ? { seat: spatialSeat, playerCount: spatialN } : {}); }
    }
    s.t = Math.min(1, s.t + dt / (s.durSnap || duration));
    const dist = s.sp.distanceTo(s.tp);
    const rw0 = window as unknown as { __bwmRestProbe?: boolean; __bwmScale?: Record<string, number[]> };
    if (s.motionSnap === 'gather') {
      // Won-trick gather: same eased flip to the face-down pile, plus the
      // corner-clearance lift from gather.ts so no corner dips into the felt.
      const pose = gatherPose(
        { p: [s.sp.x, s.sp.y, s.sp.z], q: [s.sq.x, s.sq.y, s.sq.z, s.sq.w], s: s.ss },
        { p: [s.tp.x, s.tp.y, s.tp.z], q: [s.tq.x, s.tq.y, s.tq.z, s.tq.w], s: s.ts },
        s.t,
        arc,
      );
      g.position.set(...pose.p);
      g.quaternion.set(...pose.q);
      g.scale.setScalar(pose.s);
    } else {
    // Played-card flights (flight / glide / slide) follow playFlightPose: a ballistic
    // toss with pitch travel — the card tips in, meets the felt corner-first and
    // lands flat, its lowest corner kept off the felt by the clearance lift, so it
    // neither stabs a corner through the table (owner 2026-10-29) nor skates flat
    // into its spot like a puck (owner 2026-10-31).
    // 'lift' is hand-internal and keeps its original single-ease path below.
    // 'runslam' is the Run It show flight (runSlamPose.ts): slow raise, arc, slam.
    const pose = s.motionSnap === 'lift' ? null : s.motionSnap === 'runslam' ? runSlamPose(
      { p: [s.sp.x, s.sp.y, s.sp.z], q: [s.sq.x, s.sq.y, s.sq.z, s.sq.w], s: s.ss },
      { p: [s.tp.x, s.tp.y, s.tp.z], q: [s.tq.x, s.tq.y, s.tq.z, s.tq.w], s: s.ts },
      s.t,
      { arc: s.arcSnap },
    ) : playFlightPose(
      { p: [s.sp.x, s.sp.y, s.sp.z], q: [s.sq.x, s.sq.y, s.sq.z, s.sq.w], s: s.ss },
      { p: [s.tp.x, s.tp.y, s.tp.z], q: [s.tq.x, s.tq.y, s.tq.z, s.tq.w], s: s.ts },
      s.t,
      { motion: s.motionSnap as PlayFlightOpts['motion'], arc: s.arcSnap, variant: s.variantSnap },
    );
    if (pose) {
      g.position.set(...pose.p);
      g.quaternion.set(...pose.q);
      g.scale.setScalar(pose.s);
    } else {
      const e = liftEase(s.t);
      g.position.lerpVectors(s.sp, s.tp, e);
      g.position.y += Math.sin(Math.PI * s.t) * arc * Math.min(1, dist);
      g.quaternion.slerpQuaternions(s.sq, s.tq, e);
      g.scale.setScalar(s.ss + (s.ts - s.ss) * e); // every motion eases hand size → table size: no pop
    }
    // Landing bounce: a quick rebound off the felt over the last quarter, scaled by the slam.
    const sl = slamNow.current;
    // Test probe: screen position of a trick card in flight, per frame (CSS px).
    if (sl && cardId) {
      const w = window as unknown as { __bwmFly?: Record<string, { now?: number; t: number; x: number; y: number }[]> };
      cam.updateMatrixWorld();
      const v = g.getWorldPosition(new Vector3()).project(cam);
        // relative to the table centre, so a camera shake (which moves everything) does not read as the card moving
        const o = new Vector3(0, 0, 0).project(cam); v.x -= o.x; v.y -= o.y;
      ((w.__bwmFly ??= {})[cardId] ??= []).push({ now: performance.now(), t: s.t, x: ((v.x + 1) / 2) * viewSize.width + 0, y: ((1 - v.y) / 2) * viewSize.height });
    }
    if (sl && dist > 0.02) {
      if (s.motionSnap === 'runslam') {
        // Run It strike (retune 2026-11-01 — "come down fast and HARD";
        // aggression retune 2026-11-02 — the rebound grows with the harder
        // fall, 2.0 → 2.5× the slam's bounce): NO rebound before the slap,
        // so the fall stays clean, then ONE tight hop off the felt that
        // peaks at once and dies inside the settle — not the generic
        // double-wobble below, which starts mid-fall.
        if (s.t > RUN_SLAM_IMPACT_T) { const u = (s.t - RUN_SLAM_IMPACT_T) / (1 - RUN_SLAM_IMPACT_T); g.position.y += sl.bounce * 2.5 * Math.sin(Math.PI * Math.pow(u, 0.7)) * Math.pow(1 - u, 2); }
      } else if (s.t > 0.75) { const u = (s.t - 0.75) / 0.25; g.position.y += sl.bounce * Math.abs(Math.sin(2 * Math.PI * u)) * (1 - u); }
    }
    }
    // Landing sound + thump fire here, on the frame the card visually hits the felt (after its pose is applied):
    // glide cards touch down at t=0.35 and then flop flat, so waiting for t=1 played the sound ~0.3s late.
    if (!s.landDone && s.t >= impactFraction(s.motionSnap)) {
      s.landDone = true;
      const land = s.land;
      if (land && moving) {
        s.firedLand = land;
        const sl2 = slamNow.current;
        land.split(',').forEach((c, i) => {
          if (c === 'play' && sl2 && sl2.intensity >= 0) { sound.cardSmack(sl2.intensity, spatialSeat, spatialN); return; }
          fireCue(c, i ? 0.02 : 0, spatialSeat, spatialN);
        });
        if (!fx.reduced && !fx.osReducedMotion) {
          if (land.includes('runSlam')) fx.shake = { start: performance.now(), ...PILE_THUMP };
          else if (sl2 && sl2.shake > 0) fx.shake = { start: performance.now(), ...slamThump(sl2.intensity) };
        }
        // The Run It slam's strike disturbs the felt (slamDisturbance.ts):
        // every card resting on the table drains this and bounces or slides on
        // its inner group. Only the full show's striking card fires it — the
        // reduced-motion slide path never does (its motion is 'slide'), and
        // Reduce effects drains it unplayed.
        if (land.includes('runSlam') && s.motionSnap === 'runslam' && !fx.reduced) {
          pushSlamDisturbance({ at: performance.now(), x: g.position.x, z: g.position.z, source: cardId, seed: deuceSeed(`${cardId ?? ''}|${s.key}`) });
        }
        // Deuce Drop / Cut (deuceFx.ts): a classified landing fires its felt
        // event on this same frame (DeuceFxLayer ripples from the touchdown
        // point; a Cut's victim knocks), takes its own tight shake — a deep
        // single beat for the Drop, a short snap for the Cut, never the
        // nuke's rumble — and starts the heavy settle dip at the frame's end.
        // Reduced effects keep the event (the layer draws its calm ring) and
        // the sounds; the shake and the dip stay home.
        if (dkS.impact) {
          const impact = dkS.impact;
          pushDeuceImpact({ at: performance.now(), kind: impact.kind, x: g.position.x, y: g.position.y, z: g.position.z, victim: impact.victim, winner: impact.kind === 'cut' ? (cardId as Card | null) : null, seed: deuceSeed(`${cardId ?? ''}|${s.key}`) });
          if (!fx.reduced && !fx.osReducedMotion) {
            fx.shake = impact.kind === 'cut'
              ? { start: performance.now(), dur: 0.32, amp: 0.115, thump: true }
              : { start: performance.now(), dur: 0.5, amp: 0.085, thump: true };
          }
          if (impact.kind === 'cut') {
            // The hero beat replaces the cut's small settle dip.
            dkS.heroAt = performance.now();
            const e = cam.matrixWorld.elements;
            const rx = e[0] ?? 1; const rz = e[2] ?? 0;
            const len = Math.hypot(rx, rz) || 1;
            dkS.heroAxis.set(rx / len, 0, rz / len);
            if (cardId && 'emissive' in frontMat) {
              const pal = cutColorFor(cardId as Card);
              if (pal) (frontMat as MeshStandardMaterial).emissive.set(pal.glow);
            }
          } else if (!fx.reduced) { dkS.dipAt = performance.now(); dkS.dipDepth = 0.014; }
        }
        const lw = window as unknown as { __bwmLandProbe?: boolean; __bwmLandFx?: { card: string; at: number; t: number }[] };
        if (lw.__bwmLandProbe && cardId) (lw.__bwmLandFx ??= []).push({ card: cardId, at: performance.now(), t: s.t });
      }
    }
    // Deuce settle dip + Cut knock + hero on the inner group.
    {
      const dipU = dkS.dipAt ? deuceFxElapsed(performance.now() - dkS.dipAt) / 300 : 1;
      const dipEnv = dipU < 1 ? Math.sin(Math.PI * Math.pow(Math.min(1, Math.max(0, dipU)), 0.8)) : 0;
      if (dipU >= 1) dkS.dipAt = 0;
      composeDeuceInner(g, dipEnv, knockEnv, heroEnv);
    }
    if (rw0.__bwmRestProbe && cardId && slamNow.current) ((rw0.__bwmScale ??= {})[cardId] ??= []).push(g.scale.x);
    if (finiteTarget && trickFacingArrived(s.t, g.position.distanceTo(s.tp))) {
      const q = restingFacing(
        [g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w],
        target.q,
        true,
      );
      g.quaternion.set(q[0], q[1], q[2], q[3]);
      s.faced = true;
    }
    // Test probe (opt-in): a settled card's height and its tilt off the felt (degrees between its face normal and straight up).
    const rw = window as unknown as { __bwmRestProbe?: boolean; __bwmRest?: Record<string, { s: number; y: number; tilt: number; spin: number }> };
    if (rw.__bwmRestProbe && cardId && s.t >= 1) {
      const nrm = new Vector3(0, 0, 1).applyQuaternion(g.quaternion);
      const up = new Vector3(0, 1, 0).applyQuaternion(g.quaternion);
      (rw.__bwmRest ??= {})[cardId] = { s: g.scale.x, y: g.position.y, tilt: (Math.acos(Math.min(1, Math.abs(nrm.y))) * 180) / Math.PI, spin: (Math.atan2(-up.x, -up.z) * 180) / Math.PI };
    }
  });

  return (
    <group
      ref={ref}
      userData={cardId ? { cardId } : undefined}
      {...cardTapHandlers(onTap, cardId ?? '')}
      onPointerOver={onTap ? () => { document.body.style.cursor = 'pointer'; } : undefined}
      onPointerOut={onTap ? () => { document.body.style.cursor = ''; } : undefined}
    >
      <group ref={lift} name={name}>
      <group ref={inner}>
        <mesh ref={bodyMesh} geometry={geo.body} material={edge} castShadow={castShadow} />
        <mesh ref={frontMesh} geometry={geo.front} material={frontMat} />
        <mesh ref={backMesh} geometry={geo.back} material={backMat} />
        {frontTex && <mesh ref={glowMesh} geometry={cardOutlineGeometry()} material={glowMat} visible={!!glow && !armed} renderOrder={-1} />}
        {frontTex && <mesh ref={armedMesh} geometry={cardOutlineGeometry()} material={armedMat} visible={!!armed} renderOrder={-1} />}
        {cutHalves.map((h, i) => (
          <group key={i} ref={(el) => { halfGroups.current[i] = el; }} visible={false}>
            <mesh geometry={h.coreGeo} material={h.coreMat} castShadow={castShadow} />
            <mesh geometry={h.faceGeo} material={h.faceMat} />
          </group>
        ))}
        <mesh ref={gashMesh} geometry={gashGeo} material={gashMat} rotation={[0, 0, CUT_FACE_ANGLE]} visible={false} />
      </group>
      </group>
    </group>
  );
}

export default memo(Card3D);
