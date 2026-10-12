import { useFrame, useThree } from '@react-three/fiber';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { Color, type Group, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Quaternion, type Texture, Vector3 } from 'three';
import { cardGeometry } from './geometry';
import { ILLEGAL_COLOR, RAISE_S, liftEase } from './handLift';
import JokerAura from './JokerAura';
import { CT } from './layout';
import type { Xform } from './layout';
import { type Sfx, sound } from '../audio';
import { fireCue, fx } from '../fx';
import { cardPush, getBurst, jokerPop, SWEEP_MS } from '../jokerFx';
import type { JokerKind } from '../jokerFx';
import { restingFlightWait } from '../trickTiming';

interface Props {
  face: Texture | null; // null = we only ever see the back
  back: Texture;
  target: Xform;
  from?: Xform;
  /** Where this mesh was last sitting in the hand. Applied once, so a play launches from that slot
   *  even if the mesh remounts, and a later sweep does not restart from the hand. */
  origin?: Xform;
  delay?: number;
  duration?: number;
  /** 'lift' is the 200ms group rise. 'slide' closes a gap over 240ms (translate + rotate only, same curve).
   *  'flight' is the deal / table arc. */
  motion?: 'lift' | 'flight' | 'slide';
  arc?: number;
  /** Card-local translateY for a hand raise. Never folded into `target`, so a select does not retarget the fan. */
  raise?: number;
  dim?: boolean;
  glow?: boolean;
  castShadow?: boolean;
  quality: 'high' | 'low';
  /** undefined = not a button (trick cards). null = a hand card you can't play: the tap is swallowed. */
  onTap?: (() => void) | null;
  name?: string;
  /** Sound when this card starts moving toward its current target (e.g. dealt flick, sweep). Fires once per value. */
  sfxStart?: Sfx;
  /** Sounds when this card lands on its current target (e.g. play / cut). Fires once per value. */
  sfxLand?: string; // comma-separated Sfx names, e.g. 'play,cut'
  /** how the nuke's blast treats this card: table cards are blown outward; hand cards only in Full Nuke */
  blast?: 'table' | 'hand';
  /** Joker sitting in an open trick: radioactive rim behind the face (Big = green, Little = purple). */
  jokerAura?: { kind: JokerKind; cardsAfter: number };
  /** This card is in the trick being played, so a detonation can push it or pop the winning joker. */
  inTrick?: boolean;
  /** The card's id when it is face-up ('BJ' / 'LJ' / a rank). */
  played?: string | null;
  reduceMotion?: boolean;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const xKey = (x: Xform) => x.p.map((v) => v.toFixed(4)).join() + x.q.map((v) => v.toFixed(4)).join() + x.s.toFixed(4);
const edgeMat = new MeshStandardMaterial({ color: '#efe9dc', roughness: 0.75 });
/** full colour vs. a card you can't play: 55% brightness on screen, faint cool tint, desaturated */
const FULL = new Color(1, 1, 1);
const DIM = new Color(...ILLEGAL_COLOR);
/** saturation of a not-playable card's face (1 = full colour, 0 = grey) */
const DIM_SAT = 0.3;
/** Adds a saturation control to a card face material (uSat: 1 = untouched); one shader variant shared by every card. */
function withSaturation<M extends MeshStandardMaterial>(m: M): M & { userData: { sat: { value: number } } } {
  const sat = { value: 1 };
  m.userData.sat = sat;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSat = sat;
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform float uSat;\nvoid main() {')
      .replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))), diffuseColor.rgb, uSat);');
  };
  m.customProgramCacheKey = () => 'card-sat';
  return m as M & { userData: { sat: { value: number } } };
}

function Card3D({ face, back, target, from, origin, delay = 0, duration = 0.45, motion = 'flight', arc = 0.25, raise = 0, dim, glow, castShadow = true, quality, onTap, name, sfxStart, sfxLand, blast = 'table', jokerAura, inTrick, played, reduceMotion }: Props) {
  const ref = useRef<Group>(null);
  const lift = useRef<Group>(null);
  const inner = useRef<Group>(null);
  const bl = useRef({ dir: new Vector3(), q: new Quaternion(), axis: new Vector3(), on: false });
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const view = useThree((s) => s.size);
  const geo = cardGeometry();
  const mk = (map: Texture) =>
    quality === 'high'
      ? new MeshPhysicalMaterial({ map, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35, sheen: 0.2, sheenRoughness: 0.6 })
      : new MeshStandardMaterial({ map, roughness: 0.5 });
  const frontMat = useMemo(() => withSaturation(face ? mk(face) : mk(back)), [face, back, quality]); // eslint-disable-line react-hooks/exhaustive-deps
  const backMat = useMemo(() => mk(back), [back, quality]); // eslint-disable-line react-hooks/exhaustive-deps

  // Your turn: cards you can't play sit at 55% brightness (still readable); playable cards stay at full colour.
  // Their shared gold outline is PlayableGlow, not a per-card edge. This backing is a tip mark.
  // The joker pulse is JokerAura, behind the face.
  const glowMat = useMemo(() => new MeshBasicMaterial({ color: '#f5c542', transparent: true, opacity: 0, depthWrite: false, toneMapped: false }), []);
  const look = useRef({ target: new Color(1, 1, 1), glow: 0, sat: 1 });
  const burstFx = useRef({ on: false, baseOp: 1 });
  useLayoutEffect(() => {
    look.current.target.copy(dim ? DIM : FULL);
    look.current.glow = glow ? (quality === 'high' ? 1 : 0.9) : 0;
    look.current.sat = dim ? DIM_SAT : 1;
    frontMat.emissive.set('#000000');
    // the clear coat / sheen add white on top of the colour (and ACES squashes the rest), so ease them off too when dimmed
    if (frontMat instanceof MeshPhysicalMaterial) { frontMat.clearcoat = dim ? 0.05 : 0.35; frontMat.sheen = dim ? 0 : 0.2; }
    invalidate();
  }, [dim, glow, frontMat, quality, invalidate]);

  const tw = useRef({
    init: false,
    key: '',
    originKey: '',
    t: 1,
    wait: delay,
    sp: new Vector3(), sq: new Quaternion(), ss: 1,
    tp: new Vector3(), tq: new Quaternion(), ts: 1,
    started: false, firedStart: '' as string, firedLand: '' as string, land: undefined as string | undefined,
  });
  const sfx = useRef({ sfxStart, sfxLand });
  sfx.current = { sfxStart, sfxLand };
  const raiseNow = useRef(raise);
  raiseNow.current = raise;
  const raiseTw = useRef({ y: 0, from: 0, to: 0, t: 1 });

  /** Nuke blast: lift / blow the card outward from the trick (world space), tumble it, then spring back and settle. */
  const applyBlast = (g: Group) => {
    const ig = inner.current, B = fx.blast, st = bl.current;
    if (!ig) return;
    const u = B && (blast === 'table' || B.hand) ? (fx.warp !== null ? fx.warp - 0.3 : (performance.now() - B.start) / 1000) : -1;
    if (u < 0 || u > 2.6) {
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
    // fast kick out, hang, then a damped spring home
    const env = u < 0.22 ? 1 - (1 - u / 0.22) ** 3 : Math.max(0, Math.exp(-(u - 0.22) * 1.9) * Math.cos((u - 0.22) * 2.4));
    const near = blast === 'hand' ? 0.35 : Math.max(0.35, 1.1 - g.position.length() * 0.4);
    const A = (blast === 'hand' ? 0.32 : 0.75) * near;
    const lift = (blast === 'hand' ? 0.12 : 0.55) * near * (u < 1.2 ? Math.sin(Math.PI * Math.min(1, u / 1.2)) : 0);
    const w = new Vector3(st.dir.x * A * env, lift, st.dir.z * A * env + (blast === 'hand' ? 0.08 * env : 0));
    // world offset → this card's local space
    st.q.copy(g.quaternion).invert();
    w.applyQuaternion(st.q).divideScalar(g.scale.x || 1);
    ig.position.copy(w);
    ig.quaternion.setFromAxisAngle(st.axis, env * (blast === 'hand' ? 0.35 : 1.4));
  };

  /**
   * 'Run it!' tornado: pulled off its spot into the funnel over the table centre (hand cards first), spun up the
   * funnel, then flung out and gone. Reduce effects: a plain slide into the centre that shrinks away.
   * Returns true while it owns the inner offset (the nuke blast is skipped then).
   */
  const tn = useRef({ on: false, a0: 0, h0: 0, delay: 0, axis: new Vector3(), q: new Quaternion() });
  const applyTornado = (g: Group): boolean => {
    const ig = inner.current, T = fx.tornado, st = tn.current;
    if (!ig) return false;
    const u = T ? (fx.warp !== null ? fx.warp : (performance.now() - T.start) / 1000) : -1;
    if (!T || u < 0) {
      if (T) invalidate(); // waiting for the funnel to start: keep frames coming (frameloop is on demand)
      if (st.on) { st.on = false; ig.position.set(0, 0, 0); ig.quaternion.identity(); ig.scale.setScalar(1); ig.visible = true; invalidate(); }
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
    ig.visible = scale > 0.002 && tt < 1.9;
    // world funnel spot → this card's local space (offset from its resting spot)
    const off = w.sub(g.position).multiplyScalar(pull);
    st.q.copy(g.quaternion).invert();
    off.applyQuaternion(st.q).divideScalar(g.scale.x || 1);
    ig.position.copy(off);
    ig.quaternion.setFromAxisAngle(st.axis, spin * pull);
    ig.scale.setScalar(scale);
    return true;
  };

  const burstScratch = useRef(new Vector3());
  const projA = useRef(new Vector3());
  const projB = useRef(new Vector3());
  /** Push the other trick cards and pop the winning joker. Opacity only — the face colour is untouched. */
  const applyJokerBurst = (g: Group) => {
    const live = getBurst();
    const B = inTrick ? live : null;
    const st = burstFx.current;
    const setOp = (op: number) => {
      const fading = op < 0.999;
      for (const m of [frontMat, backMat]) {
        if (m.transparent !== fading) { m.transparent = fading; m.needsUpdate = true; }
        m.opacity = op;
      }
    };
    const popNode = () => (jokerAura ? (inner.current?.getObjectByName('joker-beat') as Group | undefined) : inner.current) ?? null;
    const restore = () => {
      setOp(1);
      st.on = false;
      const node = popNode();
      if (node && !jokerAura) node.scale.setScalar(1);
      if (tw.current.t >= 1) g.position.copy(tw.current.tp);
      invalidate();
    };
    // Reduced motion is a static rim and one soft flash: no push, no pop.
    // The sweep clears inTrick while the cloud is still up. Leave the shove and the
    // 0.35 fade in place so the pile flight starts from the push instead of snapping home.
    if (!B || B.reduced) {
      if (st.on && live && !live.reduced) return;
      if (st.on) restore();
      return;
    }
    invalidate();
    st.on = true;
    const t = fx.warp !== null ? fx.warp * 1000 : B.elapsed;
    if (played === B.kind) {
      setOp(1);
      const node = popNode();
      if (node) node.scale.setScalar(jokerPop(t, B.kind));
      return;
    }
    const push = cardPush(t, B.kind);
    setOp(push.opacity);
    if (tw.current.t < 1) return; // still flying in: don't fight the tween
    const dir = burstScratch.current.set(tw.current.tp.x, 0, tw.current.tp.z);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const origin = tw.current.tp;
    const a = projA.current.copy(origin).project(camera);
    const b = projB.current.copy(origin).addScaledVector(dir, 0.05).project(camera);
    const px = Math.max(0.5, Math.hypot((b.x - a.x) * view.width / 2, (b.y - a.y) * view.height / 2));
    let world = (push.px * 0.05) / px;
    const floor = push.px * 0.0035;
    if (world < floor) world = floor;
    g.position.set(origin.x + dir.x * world, origin.y, origin.z + dir.z * world);
  };

  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    // colour / glow easing (~150 ms)
    const L = look.current, k = Math.min(1, dt / 0.05);
    const c = frontMat.color;
    if (Math.abs(c.r - L.target.r) + Math.abs(c.g - L.target.g) + Math.abs(c.b - L.target.b) > 0.004) { c.lerp(L.target, k); invalidate(); } else c.copy(L.target);
    const sat = frontMat.userData.sat;
    if (Math.abs(sat.value - L.sat) > 0.01) { sat.value += (L.sat - sat.value) * k; invalidate(); } else sat.value = L.sat;
    if (Math.abs(glowMat.opacity - L.glow) > 0.01) { glowMat.opacity += (L.glow - glowMat.opacity) * k; invalidate(); } else glowMat.opacity = L.glow;
    // Face stays untinted. A detonation only moves the other trick cards and pops the winning joker.
    applyJokerBurst(g);
    if (!applyTornado(g)) {
      // The short detonation owns trick-card motion (20px push, joker pop, then the pile flight).
      const ig = inner.current;
      if (getBurst()) {
        if (ig && bl.current.on) { ig.position.set(0, 0, 0); ig.quaternion.identity(); bl.current.on = false; }
      } else applyBlast(g);
    }
    const notePos = () => {
      if (!name || (fx.warp === null && !getBurst())) return;
      const bag = ((window as unknown as { __bwmCardPos?: Record<string, { x: number; z: number; op: number; pop: number | null }> }).__bwmCardPos ??= {});
      const beat = inner.current?.getObjectByName('joker-beat');
      const popNode = beat ?? inner.current;
      bag[name] = {
        x: Math.round(g.position.x * 1000) / 1000,
        z: Math.round(g.position.z * 1000) / 1000,
        op: Math.round(frontMat.opacity * 100) / 100,
        pop: popNode ? Math.round(popNode.scale.x * 1000) / 1000 : null,
      };
    };
    const s = tw.current;
    if (!s.init) {
      const f = origin ?? from ?? target;
      g.position.set(...f.p);
      g.quaternion.set(...f.q);
      g.scale.setScalar(f.s);
      s.init = true;
      // consumed on init so this same frame's retarget does not snap a second time
      if (origin) s.originKey = xKey(origin);
    }
    const key = xKey(target);
    if (key !== s.key) {
      // retargeted before it landed (slow frames: the trick was swept while the card was still in flight) — still make its landing sound
      if (s.key && s.started && s.t < 1) {
        const land = s.land;
        if (land && land !== s.firedLand && s.sp.distanceTo(s.tp) > 0.02) { s.firedLand = land; land.split(',').forEach((c, i) => fireCue(c, i ? 0.02 : 0)); }
      }
      const wasResting = !s.key || s.t >= 1;
      s.key = key;
      s.land = sfx.current.sfxLand; // this tween's landing cue
      s.t = 0;
      // last-trick auto-play retargets a card that is already on screen (your last card keeps its hand key).
      // The stagger is a prop; apply it when the card leaves a resting pose, or it never waits.
      const hold = restingFlightWait(delay, wasResting);
      if (hold !== null) s.wait = hold;
      const stamp = origin ? xKey(origin) : '';
      // A play starts at the card's own fan slot (not wherever the mesh was, and not the fan centre).
      // The stamp is consumed once, so the sweep to the pile keeps going from where the card is.
      if (origin && s.originKey !== stamp) {
        g.position.set(...origin.p);
        g.quaternion.set(...origin.q);
        g.scale.setScalar(origin.s);
        s.sp.set(...origin.p); s.sq.set(...origin.q); s.ss = origin.s;
        s.originKey = stamp;
      } else {
        s.sp.copy(g.position); s.sq.copy(g.quaternion); s.ss = g.scale.x;
      }
      s.tp.set(...target.p); s.tq.set(...target.q); s.ts = target.s;
      if (motion === 'slide') s.ss = s.ts; // translate + rotate only
      s.started = false;
    }
    // Raise is translateY on its own wrapper (the CSS `will-change: transform` idea). The outer fan
    // quaternion and position stay put, including when the card is only selected or the legal set changes.
    const liftG = lift.current;
    if (liftG) {
      const rt = raiseTw.current;
      const dest = raiseNow.current;
      if (Math.abs(dest - rt.to) > 1e-5) { rt.from = rt.y; rt.to = dest; rt.t = 0; }
      if (rt.t < 1) {
        rt.t = Math.min(1, rt.t + Math.min(dt, 0.05) / RAISE_S);
        rt.y = rt.from + (rt.to - rt.from) * liftEase(rt.t);
        invalidate();
      } else rt.y = rt.to;
      if (rt.t < 1 || liftG.position.y !== rt.y) {
        liftG.position.set(0, rt.y, 0);
        liftG.quaternion.identity();
        liftG.scale.set(1, 1, 1);
      }
    }
    if (s.t >= 1) { notePos(); return; }
    invalidate();
    if (s.wait > 0) {
      if (!(fx.warp !== null && !inTrick && getBurst())) { s.wait -= dt; return; }
      s.wait = 0;
    }
    const moving = s.sp.distanceTo(s.tp) > 0.02;
    if (!s.started) {
      // the card leaves now — animation-driven sound, so it always matches what you see (any game speed)
      s.started = true;
      const st = sfx.current.sfxStart;
      if (st && st !== s.firedStart) { s.firedStart = st; if (moving) sound.play(st); }
    }
    if (fx.warp !== null && !inTrick && getBurst()) {
      s.t = Math.min(1, Math.max(0, (fx.warp * 1000 - SWEEP_MS) / Math.max(1, duration * 1000)));
    } else {
      s.t = Math.min(1, s.t + Math.min(dt, 0.05) / duration);
    }
    if (s.t >= 1) {
      const land = s.land;
      if (land && land !== s.firedLand) { s.firedLand = land; if (moving) land.split(',').forEach((c, i) => fireCue(c, i ? 0.02 : 0)); }
    }
    const e = (motion === 'flight' ? easeInOut : liftEase)(s.t);
    g.position.lerpVectors(s.sp, s.tp, e);
    const dist = s.sp.distanceTo(s.tp);
    const hop = motion === 'slide' ? 0 : arc;
    g.position.y += Math.sin(Math.PI * s.t) * hop * Math.min(1, dist);
    g.quaternion.slerpQuaternions(s.sq, s.tq, e);
    g.scale.setScalar(motion === 'slide' ? s.ts : s.ss + (s.ts - s.ss) * e);
    notePos();
  });

  return (
    <group
      ref={ref}
      onClick={onTap ? (e) => { e.stopPropagation(); onTap(); } : onTap === null ? (e) => { e.stopPropagation(); } : undefined}
      onPointerOver={onTap ? () => { document.body.style.cursor = 'pointer'; } : undefined}
      onPointerOut={onTap ? () => { document.body.style.cursor = ''; } : undefined}
    >
      <group ref={lift} name={name}>
      <group ref={inner}>
        {jokerAura ? (
          <JokerAura kind={jokerAura.kind} cardsAfter={jokerAura.cardsAfter} reduceMotion={reduceMotion}>
            <mesh geometry={geo.body} material={edgeMat} castShadow={castShadow} />
            <mesh geometry={geo.front} material={frontMat} />
            <mesh geometry={geo.back} material={backMat} />
            {face && <mesh geometry={geo.front} material={glowMat} position={[0, 0, -CT - 0.003]} scale={[1.09, 1.065, 1]} visible={glowMat.opacity > 0.01 || !!glow} renderOrder={-1} />}
          </JokerAura>
        ) : (
          <>
            <mesh geometry={geo.body} material={edgeMat} castShadow={castShadow} />
            <mesh geometry={geo.front} material={frontMat} />
            <mesh geometry={geo.back} material={backMat} />
            {face && <mesh geometry={geo.front} material={glowMat} position={[0, 0, -CT - 0.003]} scale={[1.09, 1.065, 1]} visible={glowMat.opacity > 0.01 || !!glow} renderOrder={-1} />}
          </>
        )}
      </group>
      </group>
    </group>
  );
}

export default memo(Card3D);
