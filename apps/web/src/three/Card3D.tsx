import { useFrame, useThree } from '@react-three/fiber';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { Color, type Group, type Material, type Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, NoToneMapping, Quaternion, type Texture, Vector3, type WebGLRenderer } from 'three';
import { cardFaceFragment } from './cardSat';
import { cardGeometry, cardOutlineGeometry } from './geometry';
import { raiseSeconds, applyFaceDepthBias, cardMeshPaint, cardTapHandlers, faceLook, liftEase, screenRaise } from './handLift';
import { type Xform } from './layout';
import { type Sfx, sound } from '../audio';
import { blastPose } from './blastSweep';
import { releaseTornadoCard, tornadoCardLeft } from './tornadoSweep';
import { fireCue, fx } from '../fx';
import { restingFlightWait } from '../trickTiming';
import { dealHoldReleased, openingFlight } from './dealFlight';
import { retainFrontTexture } from './cardFace';
import { restingFacing, trickFacingArrived } from './trickFacing';
import { gatherPose } from './gather';
import { impactFraction } from '../landTiming';
import { PILE_THUMP, slamThump } from './shake';

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
  /** glide: tossed, then slides along the felt and slows with friction (physics landing) */
  motion?: 'lift' | 'flight' | 'slide' | 'glide' | 'gather';
  arc?: number;
  /** Card-local raise distance. Never folded into `target`, so a select does not retarget the fan.
   *  Applied along screen-up (see `roll`), not along the rolled card, so the end card stays in the fan. */
  raise?: number;
  /** Fan roll in radians. The raise is counter-rotated by this so it stays vertical on screen. */
  roll?: number;
  /** Painter's order. Legal cards use a higher band than illegal cards; index order is kept inside each band. */
  order?: number;
  dim?: boolean;
  glow?: boolean;
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
  /** Phase 3: seat this card's sounds come from (spatialised play/slam/deal/collect). */
  spatialSeat?: import('./layout').SeatPos; spatialN?: number;
  /** how the nuke's blast treats this card: table cards are blown outward; hand cards only in Full Nuke */
  blast?: 'table' | 'hand';
  /** Deal flight: stay invisible until this card leaves the deck, so the fan does not show up early. */
  holdUntilMove?: boolean;
  /** False until the physical shader has been linked off the draw. The card stays a basic textured quad, then becomes the lit card. */
  lit?: boolean;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
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

function Card3D({ face, back, target, from, origin, delay = 0, duration = 0.45, motion = 'flight', arc = 0.25, raise = 0, roll = 0, order = 0, dim, glow, castShadow = true, quality, onTap, cardId = null, name, sfxStart, sfxLand, spatialSeat, spatialN = 4, blast = 'table', holdUntilMove = false, lit = true, slam }: Props) {
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
    const m = lit ? createLitCardMaterial(map, quality, true) : new MeshBasicMaterial({ map });
    // Face and cap are both opaque, so they share one list. renderOrder can sort them,
    // but a 16-bit depth test still drops the face when the two planes quantize together.
    applyFaceDepthBias(m);
    return m;
  }, [frontTex, back, quality, lit]); // eslint-disable-line react-hooks/exhaustive-deps
  const backMat = useMemo(() => {
    const m = lit ? createLitCardMaterial(back, quality, false) : new MeshBasicMaterial({ map: back });
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
  const edge = useMemo(() => edgeMat.clone(), []);
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
      const onFace = list.includes(frontMat);
      const onBack = list.includes(backMat);
      const onGlow = list.includes(glowMat);
      const paint = cardMeshPaint(order, onGlow ? 'glow' : onFace ? 'face' : onBack ? 'back' : 'edge');
      mesh.renderOrder = paint.renderOrder;
      for (const m of list) m.depthTest = paint.depthTest;
    });
    invalidate();
  }, [order, cardId, face, glow, frontMat, backMat, glowMat, invalidate]);
  const look = useRef({ target: new Color(1, 1, 1), sat: 1 });
  useLayoutEffect(() => {
    const lookAt = faceLook(!!dim);
    look.current.target.setRGB(lookAt.color[0], lookAt.color[1], lookAt.color[2]);
    look.current.sat = lookAt.sat;
    if ('emissive' in frontMat && frontMat.emissive) frontMat.emissive.set('#000000');
    // the clear coat / sheen add white on top of the colour (and ACES squashes the rest), so ease them off too when dimmed
    if (frontMat instanceof MeshPhysicalMaterial) { frontMat.clearcoat = dim ? 0.05 : 0.35; frontMat.sheen = dim ? 0 : 0.2; }
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
  });
  useLayoutEffect(() => {
    const g = ref.current;
    if (g && hideUntilStart.current && !tw.current.started) g.visible = false;
    // A resumed card has no flight. Snap it before the first paint so the hand and the trick
    // are not at the origin for a frame (that frame reads as an empty fan or an empty trick).
    if (!g || tw.current.init || from || origin) return;
    if (!target.p.every(Number.isFinite) || !target.q.every(Number.isFinite) || !Number.isFinite(target.s)) return;
    g.position.set(...target.p);
    g.quaternion.set(...target.q);
    g.scale.setScalar(target.s);
    g.updateMatrixWorld(true);
  });
  const sfx = useRef({ sfxStart, sfxLand });
  sfx.current = { sfxStart, sfxLand };
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
    invalidate();
  }, [motion, poseKey, raise, roll, invalidate, target]);

  /** Nuke blast. Table cards sweep off the felt and stay there. Hand cards kick and spring home. */
  const applyBlast = (g: Group) => {
    const ig = inner.current, B = fx.blast, st = bl.current;
    if (!ig) return;
    if (B && st.stamp !== B.start) { st.stamp = B.start; st.on = false; st.flung = false; }
    const u = B && (blast === 'table' || B.hand) ? (fx.warp !== null ? fx.warp - 0.3 : (performance.now() - B.start) / 1000) : -1;
    const pose = blastPose(u, blast === 'hand' ? 'hand' : 'table');
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
  const tn = useRef({ on: false, gone: false, a0: 0, h0: 0, delay: 0, axis: new Vector3(), q: new Quaternion() });
  const applyTornado = (g: Group): boolean => {
    const ig = inner.current, T = fx.tornado, st = tn.current;
    if (!ig) return false;
    // Already flung. A later frame must not put this mesh back on the trick or in the hand.
    if (st.gone) { ig.visible = false; return true; }
    const u = T ? (fx.warp !== null ? fx.warp : (performance.now() - T.start) / 1000) : -1;
    if (!T || u < 0) {
      const next = releaseTornadoCard({ taken: st.on, gone: st.gone, visible: ig.visible });
      st.gone = next.gone;
      if (next.gone) { ig.visible = false; invalidate(); return true; }
      if (T) invalidate(); // waiting for the funnel to start: keep frames coming (frameloop is on demand)
      return false;
    }
    invalidate();
    if (!st.on) {
      st.on = true;
      // stable per-card randomness from the card's name
      let h = 7; for (const ch of name ?? '') h = (h * 31 + ch.charCodeAt(0)) | 0;
      const r = (k: number) => { const x = Math.sin(h * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
      st.a0 = Math.atan2(g.position.z, g.position.x) + (r(1) - 0.5) * 0.8;
      st.h0 = r(2);
      st.delay = (blast === 'hand' ? 0 : 0.1) + r(3) * 0.2;
      st.axis.set(r(4) - 0.5, r(5) - 0.5, r(6) - 0.5).normalize();
    }
    const tt = Math.max(0, u - st.delay);
    const pull = tt <= 0 ? 0 : 1 - (1 - Math.min(1, tt / 0.5)) ** 3;
    const w = new Vector3();
    let spin = 0, scale = 1;
    if (T.reduced) {
      w.set(0, 0.06, 0);
      scale = Math.max(0.001, 1 - Math.max(0, (tt - 0.35) / 0.4));
    } else {
      const FLING = 1.25;
      const height = 0.12 + 1.35 * Math.min(1, tt / 1.3) * (0.35 + 0.65 * st.h0);
      let radius = 0.1 + 0.3 * (height / 1.5);
      let y = height;
      if (tt > FLING) { const f = tt - FLING; radius += 9 * f * f + 1.5 * f; y += 2.2 * f; }
      const ang = st.a0 + tt * (6.5 + 4 * (1 - st.h0)) + tt * tt * 1.5;
      w.set(Math.cos(ang) * radius, y, Math.sin(ang) * radius);
      spin = tt * 9;
      // everything the same size in the funnel (your hand cards are bigger, near the camera)
      scale = 1 + ((0.85 / (g.scale.x || 1)) - 1) * pull;
    }
    const left = tornadoCardLeft(tt, scale);
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
    // The deal is over but this card never left the deck: the mount-time hold is a ref and
    // the tween wait runs in frame time, which can crawl on a starved canvas long after the
    // wall-clock deal expired. Release it, or the fan can sit at a few cards all hand.
    if (dealHoldReleased({ held: hideUntilStart.current, liveHold: holdUntilMove, started: tw.current.started })) {
      hideUntilStart.current = false;
      tw.current.wait = 0;
      g.visible = true;
    }
    if (hideUntilStart.current && !tw.current.started) g.visible = false;
    // A resume hitch must not fast-forward the fan. One frame advances at most 50ms, same as a slow paint.
    const dt = Math.min(Math.max(rawDt, 0), 0.05);
    // colour easing (~150 ms), also capped so a long frame does not snap it
    const L = look.current, k = Math.min(1, dt / 0.15);
    const c = frontMat.color;
    if (Math.abs(c.r - L.target.r) + Math.abs(c.g - L.target.g) + Math.abs(c.b - L.target.b) > 0.004) { c.lerp(L.target, k); invalidate(); } else c.copy(L.target);
    const sat = frontMat.userData.sat as { value: number } | undefined;
    if (sat && Math.abs(sat.value - L.sat) > 0.01) { sat.value += (L.sat - sat.value) * k; invalidate(); } else if (sat) sat.value = L.sat;
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
    if (finiteTarget && key !== s.key) {
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
          target.q,
          true,
        );
        g.quaternion.set(q[0], q[1], q[2], q[3]);
        s.faced = true;
      }
      return;
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
    s.t = Math.min(1, s.t + dt / duration);
    const dist = s.sp.distanceTo(s.tp);
    const rw0 = window as unknown as { __bwmRestProbe?: boolean; __bwmScale?: Record<string, number[]> };
    if (motion === 'gather') {
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
    const e = motion === 'glide' ? 1 - Math.pow(1 - Math.pow(s.t, 1.4), 3) : (motion === 'flight' ? easeInOut : liftEase)(s.t);
    g.position.lerpVectors(s.sp, s.tp, e);
    const hop = motion === 'slide' ? 0 : arc;
    // glide: the toss is only the first part; the rest is the card sliding flat on the felt
    g.position.y += (motion === 'glide' ? (s.t < 0.35 ? Math.sin((Math.PI * s.t) / 0.35) : 0) : Math.sin(Math.PI * s.t)) * hop * Math.min(1, dist);
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
    if (sl && s.t > 0.75 && dist > 0.02) { const u = (s.t - 0.75) / 0.25; g.position.y += sl.bounce * Math.abs(Math.sin(2 * Math.PI * u)) * (1 - u); }
    g.quaternion.slerpQuaternions(s.sq, s.tq, e);
    g.scale.setScalar(s.ss + (s.ts - s.ss) * e); // every motion eases hand size → table size: no pop
    }
    // Landing sound + thump fire here, on the frame the card visually hits the felt (after its pose is applied):
    // glide cards touch down at t=0.35 and then slide, so waiting for t=1 played the sound ~0.3s late.
    if (!s.landDone && s.t >= impactFraction(motion)) {
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
        const lw = window as unknown as { __bwmLandProbe?: boolean; __bwmLandFx?: { card: string; at: number; t: number }[] };
        if (lw.__bwmLandProbe && cardId) (lw.__bwmLandFx ??= []).push({ card: cardId, at: performance.now(), t: s.t });
      }
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
        <mesh geometry={geo.body} material={edge} castShadow={castShadow} />
        <mesh geometry={geo.front} material={frontMat} />
        <mesh geometry={geo.back} material={backMat} />
        {frontTex && <mesh geometry={cardOutlineGeometry()} material={glowMat} visible={!!glow} renderOrder={-1} />}
      </group>
      </group>
    </group>
  );
}

export default memo(Card3D);
