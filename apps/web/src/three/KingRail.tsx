/**
 * The King's rail + seated three, as figures in the 3D scene (owner,
 * 2026-10-26: the face-coin columns "look really [bad] — remember
 * this is a 3d table, they should be standing around the table as
 * human figures not coins with faces"; then: "add all the other
 * characters to the table and animate everyone"; then the seated
 * King / Ringer / Dee join the scene too).
 *
 * Construction: each figure is two crossed billboards sharing one
 * PlaneGeometry — a dark, scene-lit standing/seated silhouette
 * (canvas-painted: night gradient, cool rim from the street side,
 * warm key from the table side) and the character's shipped portrait
 * (512² bust) as head/upper body, its edges dissolved into the body
 * with a canvas alpha mask so nobody reads as a floating head or a
 * coin. Standing figures plant their feet on the venue floor
 * (RAIL_FLOOR_Y) around the table; seated figures rise from behind
 * the apron at their seat's edge.
 *
 * Life: poses are pure functions of (figure, time, cue) from
 * kingRailLayout — seeded idle breathing/sway/head-wander, a stir
 * ripple on real match moments (stamped by the table over the cue
 * channel; the nuke family arrives over the fx bus), a lean for the
 * railbird or seated character whose line is landing, and seated
 * attention toward the current action with per-character amplitude
 * personalities (Dee expressive, Ringer edgy, the King nearly still).
 * The canvas is frameloop="demand": a 50 ms ticker (the venue's own
 * AmbientTicker cadence) keeps frames flowing only while the crowd
 * is animated. Reduced-effects / OS reduced-motion → no ticker, rest
 * pose, zero per-frame cost — the crowd is scenery, still scenery.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdditiveBlending, CanvasTexture, LinearFilter, PlaneGeometry, ShaderMaterial, SRGBColorSpace, TextureLoader, VideoTexture, type Group, type Mesh, type MeshBasicMaterial, type Texture } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { storyPortraitFor } from '@spades/bots';
import { fx } from '../fx';
import { edgePoint, seatDir, type SeatPos } from './layout';
import {
  BODY_H, BODY_W, RAIL_FLOOR_Y, RAIL_VISITORS, VISIT_PEAK,
  attentionYawFor, crowdPoseAt, kingRailFigures, restPose, ringScaleFor, seatedFigureFor, seatedPoseAt, stampStir, visitStateAt,
  type CrowdCue, type RailFigure, type RailVisitorClips, type SeatedFigure,
} from './kingRailLayout';

/* ------------------------------------------------------------------ */
/* Shared art                                                          */
/* ------------------------------------------------------------------ */

const QUAD = new PlaneGeometry(1, 1);

/** Night-figure tint: the venue's key is warm, its rim cool; figures
 *  stand at the edge of the light, so portraits print a touch under. */
const PORTRAIT_DIM = '#c3cede';

const portraitCache = new Map<string, Texture | null>();

/** The portrait with its edges dissolved: a radial-ellipse mask keeps
 *  the face and shoulders, a linear dissolve takes the bottom into
 *  the silhouette. Painted once per character, module-cached. */
function fadedPortrait(id: string, onReady: () => void): Texture | null {
  const hit = portraitCache.get(id);
  if (hit !== undefined) return hit;
  portraitCache.set(id, null);
  new TextureLoader().load(storyPortraitFor(id), (tex) => {
    const img = tex.image as HTMLImageElement;
    const S = 384;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const g = cv.getContext('2d');
    if (!g) { portraitCache.set(id, tex); onReady(); return; }
    g.drawImage(img, 0, 0, S, S);
    g.globalCompositeOperation = 'destination-in';
    const rg = g.createRadialGradient(S * 0.5, S * 0.42, S * 0.18, S * 0.5, S * 0.46, S * 0.52);
    rg.addColorStop(0, 'rgba(0,0,0,1)');
    rg.addColorStop(0.75, 'rgba(0,0,0,1)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
    const lg = g.createLinearGradient(0, S * 0.55, 0, S * 0.98);
    lg.addColorStop(0, 'rgba(0,0,0,0)');
    lg.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = lg;
    g.fillRect(0, S * 0.5, S, S * 0.5);
    const out = new CanvasTexture(cv);
    out.colorSpace = SRGBColorSpace;
    portraitCache.set(id, out);
    onReady();
  });
  return null;
}

function usePortrait(id: string): Texture | null {
  const [tex, setTex] = useState<Texture | null>(() => portraitCache.get(id) ?? null);
  useEffect(() => {
    const t = fadedPortrait(id, () => setTex(portraitCache.get(id) ?? null));
    if (t) setTex(t);
  }, [id]);
  return tex;
}

/** Standing silhouettes: three stance variants (shoulder width / line),
 *  near-black with the venue's light on the edges — cool rim left
 *  (street side), warm key right (table side), a sheen at the crown
 *  of the shoulders where the portrait dissolves in. */
const silhouetteCache: (Texture | null)[] = [null, null, null];
function silhouette(variant: number): Texture {
  const hit = silhouetteCache[variant];
  if (hit) return hit;
  const W = 256, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const sw = [0.86, 0.98, 0.74][variant]!; // shoulder half-width factor
  const neck = 0.16 + variant * 0.02;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#181a24');
  grad.addColorStop(0.35, '#10121a');
  grad.addColorStop(1, '#05060a');
  g.fillStyle = grad;
  g.beginPath();
  const cx = W / 2, top = H * 0.04, shY = H * 0.16, shX = (W / 2) * sw;
  g.moveTo(cx - W * neck, top);
  g.bezierCurveTo(cx - shX, shY - H * 0.05, cx - shX * 1.04, shY + H * 0.1, cx - shX * 0.92, H * 0.55);
  g.bezierCurveTo(cx - shX * 0.86, H * 0.8, cx - shX * 0.9, H * 0.96, cx - shX * 0.88, H);
  g.lineTo(cx + shX * 0.88, H);
  g.bezierCurveTo(cx + shX * 0.9, H * 0.96, cx + shX * 0.86, H * 0.8, cx + shX * 0.92, H * 0.55);
  g.bezierCurveTo(cx + shX * 1.04, shY + H * 0.1, cx + shX, shY - H * 0.05, cx + W * neck, top);
  g.closePath();
  g.fill();
  // rim + key edge light, clipped to the body
  g.save();
  g.clip();
  const rim = g.createLinearGradient(0, 0, W * 0.3, 0);
  rim.addColorStop(0, 'rgba(127,168,255,0.5)');
  rim.addColorStop(1, 'rgba(127,168,255,0)');
  g.fillStyle = rim; g.fillRect(0, 0, W * 0.3, H);
  const key = g.createLinearGradient(W, 0, W * 0.72, 0);
  key.addColorStop(0, 'rgba(255,180,92,0.34)');
  key.addColorStop(1, 'rgba(255,180,92,0)');
  g.fillStyle = key; g.fillRect(W * 0.7, 0, W * 0.3, H);
  const sheen = g.createLinearGradient(0, 0, 0, H * 0.3);
  sheen.addColorStop(0, 'rgba(245,244,255,0.13)');
  sheen.addColorStop(1, 'rgba(245,244,255,0)');
  g.fillStyle = sheen; g.fillRect(0, 0, W, H * 0.3);
  g.restore();
  const out = new CanvasTexture(cv);
  out.colorSpace = SRGBColorSpace;
  silhouetteCache[variant] = out;
  return out;
}

/** Seated torso: the same family, cropped at the waist by the table —
 *  shoulders and chest only, wider and shorter. */
let torsoTex: Texture | null = null;
function torsoTexture(): Texture {
  if (torsoTex) return torsoTex;
  const W = 256, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#171924');
  grad.addColorStop(1, '#07080d');
  g.fillStyle = grad;
  g.beginPath();
  const cx = W / 2;
  g.moveTo(cx - W * 0.14, 0);
  g.bezierCurveTo(cx - W * 0.48, H * 0.1, cx - W * 0.5, H * 0.45, cx - W * 0.47, H);
  g.lineTo(cx + W * 0.47, H);
  g.bezierCurveTo(cx + W * 0.5, H * 0.45, cx + W * 0.48, H * 0.1, cx + W * 0.14, 0);
  g.closePath();
  g.fill();
  g.save();
  g.clip();
  const rim = g.createLinearGradient(0, 0, W * 0.28, 0);
  rim.addColorStop(0, 'rgba(127,168,255,0.45)');
  rim.addColorStop(1, 'rgba(127,168,255,0)');
  g.fillStyle = rim; g.fillRect(0, 0, W * 0.28, H);
  const key = g.createLinearGradient(W, 0, W * 0.74, 0);
  key.addColorStop(0, 'rgba(255,180,92,0.4)');
  key.addColorStop(1, 'rgba(255,180,92,0)');
  g.fillStyle = key; g.fillRect(W * 0.72, 0, W * 0.28, H);
  g.restore();
  const out = new CanvasTexture(cv);
  out.colorSpace = SRGBColorSpace;
  torsoTex = out;
  return out;
}

/** Soft contact shadow (grounds a billboard on the floor). */
let shadowTex: Texture | null = null;
function contactShadow(): Texture {
  if (shadowTex) return shadowTex;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d')!;
  const rg = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  rg.addColorStop(0, 'rgba(0,0,0,0.62)');
  rg.addColorStop(0.7, 'rgba(0,0,0,0.28)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, S, S);
  shadowTex = new CanvasTexture(cv);
  return shadowTex;
}

/* ------------------------------------------------------------------ */
/* Figures                                                             */
/* ------------------------------------------------------------------ */

function CrowdFigure({ fig, cue, animate }: { fig: RailFigure; cue: CrowdCue; animate: boolean }) {
  const root = useRef<Group>(null);
  const hip = useRef<Group>(null);
  const head = useRef<Group>(null);
  const portraitMesh = useRef<Mesh>(null);
  const tex = usePortrait(fig.id);
  const body = useMemo(() => silhouette(fig.variant), [fig.variant]);
  const shadow = useMemo(() => contactShadow(), []);
  const H = fig.height;
  const pw = (0.8 * H) / 1.74;
  const bw = (BODY_W * H) / 1.74;
  const bh = (BODY_H * H) / 1.74;
  const hipY = H * 0.53;

  const apply = (t: number) => {
    const pose = animate ? crowdPoseAt(fig, t, cue) : restPose();
    const r = root.current, h = hip.current, hd = head.current;
    if (!r || !h || !hd) return;
    r.position.z = fig.z + Math.cos(fig.yaw) * pose.stepIn;
    r.position.x = fig.x + Math.sin(fig.yaw) * pose.stepIn;
    h.position.y = hipY + pose.bobY;
    h.rotation.z = pose.swayRad;
    h.rotation.x = pose.leanRad;
    hd.rotation.y = pose.headYawRad;
    hd.rotation.x = pose.headPitchRad;
    portraitMesh.current?.scale.set(pw * pose.breathK, pw * pose.breathK, 1);
  };
  useEffect(() => { if (!animate) apply(0); }, [animate]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(() => { if (animate) apply(performance.now()); });

  return (
    <group ref={root} position={[fig.x, RAIL_FLOOR_Y, fig.z]} rotation={[0, fig.yaw, 0]} renderOrder={fig.row === 0 ? 2 : 1}>
      <mesh geometry={QUAD} position={[0, 0.012, 0.02]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.15, 0.55, 1]} renderOrder={0}>
        <meshBasicMaterial map={shadow} transparent depthWrite={false} />
      </mesh>
      <group ref={hip} position={[0, hipY, 0]}>
        <group position={[0, -hipY, 0]}>
          <mesh geometry={QUAD} position={[0, bh / 2, -0.015]} scale={[bw, bh, 1]}>
            <meshBasicMaterial map={body} transparent depthWrite={false} />
          </mesh>
          <group ref={head} position={[0, H - pw, 0]}>
            {tex && (
              <mesh
                ref={portraitMesh}
                geometry={QUAD}
                position={[0, pw / 2, 0.012]}
                scale={[pw, pw, 1]}
              >
                <meshBasicMaterial map={tex} transparent depthWrite={false} color={PORTRAIT_DIM} />
              </mesh>
            )}
          </group>
        </group>
      </group>
    </group>
  );
}

function SeatedFigure3D({ fig, cue, animate, target }: {
  fig: SeatedFigure; cue: CrowdCue; animate: boolean; target: { x: number; z: number };
}) {
  const leanG = useRef<Group>(null);
  const head = useRef<Group>(null);
  const attn = useRef(0);
  const tex = usePortrait(fig.characterId);
  const torso = useMemo(() => torsoTexture(), []);
  const pw = fig.portraitW;
  const torsoBot = -0.55;
  const torsoH = fig.torsoTop - torsoBot;

  const apply = (t: number, dt: number) => {
    const want = attentionYawFor(fig, target.x, target.z);
    attn.current += (want - attn.current) * Math.min(1, dt * 3.2);
    const pose = animate ? seatedPoseAt(fig, t, cue, attn.current) : restPose();
    const lg = leanG.current, hd = head.current;
    if (!lg || !hd) return;
    lg.rotation.x = pose.leanRad;
    lg.rotation.z = pose.swayRad;
    lg.position.y = pose.bobY;
    hd.rotation.y = pose.headYawRad;
    hd.rotation.x = pose.headPitchRad;
  };
  useEffect(() => { if (!animate) apply(0, 1); }, [animate]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, dt) => { if (animate) apply(performance.now(), Math.min(dt, 0.05)); });

  return (
    <group position={[fig.x, 0, fig.z]} rotation={[0, fig.yaw, 0]} renderOrder={3}>
      <group ref={leanG}>
        <mesh geometry={QUAD} position={[0, torsoBot + torsoH / 2, -0.012]} scale={[fig.torsoW, torsoH, 1]}>
          <meshBasicMaterial map={torso} transparent depthWrite={false} />
        </mesh>
        <group ref={head} position={[0, fig.crown - pw, 0]}>
          {tex && (
            <mesh geometry={QUAD} position={[0, pw / 2, 0.012]} scale={[pw, pw, 1]}>
              <meshBasicMaterial map={tex} transparent depthWrite={false} color={PORTRAIT_DIM} />
            </mesh>
          )}
        </group>
      </group>
    </group>
  );
}

/** Keeps demand-loop frames flowing at the venue's ambient cadence —
 *  mounted only while the crowd is animated. */
function CrowdTicker() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const id = window.setInterval(() => { if (!document.hidden) invalidate(); }, 50);
    return () => window.clearInterval(id);
  }, [invalidate]);
  return null;
}

/* ------------------------------------------------------------------ */
/* The filmed visit (owner, 2026-10-26, late): a character with      */
/* clips in RAIL_VISITORS no longer stands in the ring — he VISITS.   */
/* Full-body silent film (arrive / idle / depart) on a floor-anchored */
/* plane at his rail slot, black-keyed by shader so the figure        */
/* composites into the venue's night, warm gold over the whole body,  */
/* a contact shadow tracking him across the walk. The clip set and    */
/* the phase machine live in kingRailLayout; the windows are stamped  */
/* on the cue by the table. Pure decoration — no raycast, no input,   */
/* ever; he stands on the ring slot the layout already guarantees.    */
/* ------------------------------------------------------------------ */

let visitGlowCache: Texture | null = null;
/** A soft warm halo — the visit lights its own little patch of
 *  night air. */
function visitGlowTexture(): Texture {
  if (visitGlowCache) return visitGlowCache;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d')!;
  const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  rg.addColorStop(0, 'rgba(255,255,255,0.85)');
  rg.addColorStop(0.45, 'rgba(255,255,255,0.32)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, S, S);
  visitGlowCache = new CanvasTexture(cv);
  return visitGlowCache;
}

const posterCache = new Map<string, Texture | null>();
/** A visitor's full-body poster — the reduced-effects still frame,
 *  and the stand-in until the arrive clip can play. */
function visitPoster(clips: RailVisitorClips, onReady: () => void): Texture | null {
  const hit = posterCache.get(clips.poster);
  if (hit !== undefined) return hit;
  posterCache.set(clips.poster, null);
  new TextureLoader().load(clips.poster, (tex) => {
    tex.colorSpace = SRGBColorSpace;
    // NPOT frame, sampled on a plane: no mip chain (an incomplete
    // texture samples black on some drivers — the video-plane recipe).
    tex.generateMipmaps = false;
    tex.minFilter = LinearFilter;
    posterCache.set(clips.poster, tex);
    onReady();
  }, undefined, () => { /* stays null — the visit simply doesn't render */ });
  return null;
}

/** The black-key composite: the footage is a man lit warm against
 *  pure black, so the frame composites additively (black adds
 *  nothing) with a soft rectangular feather at the frame's edges and
 *  a hard-ish cut just under the shoe line (feetFrac) so the floor
 *  spill in the footage never prints as a rectangle on the venue
 *  floor — the contact shadow grounds him instead. The warm grade is
 *  one golden multiplier over the whole figure. */
function visitMaterial(feetFrac: number): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTex: { value: null as Texture | null },
      uOpacity: { value: 0 },
      uFeet: { value: feetFrac },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uTex;
      uniform float uOpacity;
      uniform float uFeet;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(uTex, vUv).rgb;
        float ex = smoothstep(0.0, 0.05, vUv.x) * (1.0 - smoothstep(0.95, 1.0, vUv.x));
        float ey = 1.0 - smoothstep(0.96, 1.0, vUv.y);
        float below = smoothstep(0.0, 0.025, vUv.y - (1.0 - uFeet) + 0.012);
        float a = uOpacity * ex * ey * below;
        gl_FragColor = vec4(c * vec3(1.0, 0.9, 0.74) * a, a);
      }`,
  });
}

interface VisitVideos { arrive: HTMLVideoElement; idle: HTMLVideoElement; depart: HTMLVideoElement }

function makeVisitVideo(srcPath: string, loop: boolean): HTMLVideoElement {
  const v = document.createElement('video');
  v.src = srcPath;
  v.muted = true;
  v.loop = loop;
  v.playsInline = true;
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  return v;
}

/**
 * One visitor's film at his ring slot. Animated: the three clips on
 * one floor-anchored plane, the texture + opacity driven by
 * visitStateAt (walk in → settled presence → walk out), the contact
 * shadow tracking his in-frame centre. Reduced: the full-body poster
 * still on the same plane, opacity envelope only — same windows,
 * same caps, no video motion.
 */
function VisitFigure({ fig, clips, cue, animate }: { fig: RailFigure; clips: RailVisitorClips; cue: CrowdCue; animate: boolean }) {
  const group = useRef<Group>(null);
  const plane = useRef<Mesh>(null);
  const glowMat = useRef<MeshBasicMaterial>(null);
  const shadow = useRef<Mesh>(null);
  const shadowMat = useRef<MeshBasicMaterial>(null);
  const [, setArt] = useState(0);
  const poster = visitPoster(clips, () => setArt((x) => x + 1));
  const videos = useMemo<VisitVideos | null>(() => {
    if (!animate || typeof document === 'undefined') return null;
    return {
      arrive: makeVisitVideo(clips.arrive, false),
      idle: makeVisitVideo(clips.idle, true),
      depart: makeVisitVideo(clips.depart, false),
    };
  }, [animate, clips]);
  const textures = useMemo(() => {
    if (!videos) return null;
    const mk = (v: HTMLVideoElement): VideoTexture => {
      const t = new VideoTexture(v);
      t.colorSpace = SRGBColorSpace;
      // NPOT frame, sampled on a plane: no mip chain (an incomplete
      // texture samples black on some drivers — the video-plane recipe).
      t.generateMipmaps = false;
      t.minFilter = LinearFilter;
      return t;
    };
    return { arrive: mk(videos.arrive), idle: mk(videos.idle), depart: mk(videos.depart) };
  }, [videos]);
  useEffect(() => () => {
    if (!textures) return;
    textures.arrive.dispose(); textures.idle.dispose(); textures.depart.dispose();
  }, [textures]);
  const [dead, setDead] = useState<Partial<Record<keyof VisitVideos, boolean>>>({});
  useEffect(() => {
    if (!videos) return;
    const onErr = (k: keyof VisitVideos) => () => setDead((d) => ({ ...d, [k]: true }));
    const handlers = (Object.keys(videos) as (keyof VisitVideos)[]).map((k) => {
      const h = onErr(k);
      videos[k].addEventListener('error', h);
      return [videos[k], h] as const;
    });
    // Pre-roll the arrival so the first materialize never waits on it.
    void videos.arrive.play().then(() => videos.arrive.pause()).catch(() => { /* the poster carries the visit */ });
    return () => { handlers.forEach(([v, h]) => { v.removeEventListener('error', h); v.pause(); }); };
  }, [videos]);
  const mat = useMemo(() => visitMaterial(clips.feetFrac), [clips]);
  useEffect(() => () => { mat.dispose(); }, [mat]);
  const glowTex = useMemo(() => visitGlowTexture(), []);
  const shadowTex = useMemo(() => contactShadow(), []);

  // LIFE SIZE, floor-anchored: his height inside the frame is
  // feetFrac of the frame; size the plane so that span equals the
  // height his standing figure held, with the frame's shoe line
  // (feetFrac down) planted exactly on the venue floor.
  const ph = fig.height / clips.feetFrac;
  const pw = ph * 0.75;

  // A visit steps UP to the rail — across the table, on his own
  // side, at the front ring's depth, facing the table. (In the full
  // conversion every character visits this way: far side, own side,
  // stepped up — far-side standers simply keep their own depth.)
  const r0 = Math.hypot(fig.x, fig.z);
  const aspectNow = useThree((s) => s.size.width / Math.max(1, s.size.height));
  let gx: number; let gz: number; let gyaw: number;
  if (aspectNow < 1) {
    // Portrait: the narrow frustum crops the side arcs entirely —
    // clamp into the far arc (34°) at the stepped-up radius.
    const rStep = (fig.row === 0 ? r0 : r0 * (2.55 / 3.1)) * 0.92;
    const k = r0 > 0 ? rStep / r0 : 1;
    const VISIT_ARC = (34 * Math.PI) / 180;
    const rawAng = Math.atan2(fig.x * k, Math.abs(fig.z) * k);
    const ang = Math.max(-VISIT_ARC, Math.min(VISIT_ARC, rawAng));
    gx = Math.sin(ang) * rStep;
    gz = -Math.cos(ang) * rStep;
    gyaw = -ang;
  } else {
    // Landscape: measured at the real table — a far-arc visit
    // (his own slot mirrors to -66°) lands behind the scorebug and
    // the partner's plate, head clipped by the frame top. The far
    // FLANK is the visible stage (the ring's own flank figures read
    // there): beyond 40° he snaps to the flank on his own side, at
    // the front ring's depth. A visit exists to be seen.
    const rStep = r0 * (2.55 / (fig.row === 0 ? 2.55 : 3.1)) * 0.98;
    const rawAng = Math.atan2(fig.x, Math.abs(fig.z));
    const FLANK = (82 * Math.PI) / 180;
    const ang = Math.abs(rawAng) > (40 * Math.PI) / 180 ? Math.sign(rawAng) * FLANK : rawAng;
    gx = Math.sin(ang) * rStep;
    gz = -Math.cos(ang) * rStep;
    gyaw = -ang;
  }

  const phaseRef = useRef<string>('gone');
  useFrame(() => {
    const st = visitStateAt(performance.now(), cue, clips);
    const vis = st.opacity > 0.004 && st.phase !== 'gone';
    if (group.current) group.current.visible = vis;
    if (!vis) { phaseRef.current = 'gone'; return; }
    // texture: the current phase's clip (a dead clip falls back to
    // the poster, and the poster covers the beats before a clip can
    // play); the reduced-effects path is the poster throughout.
    const key: keyof VisitVideos | null = st.phase === 'settled' ? 'idle' : st.phase === 'arrive' || st.phase === 'depart' ? st.phase : null;
    let tex: Texture | null = poster;
    if (videos && textures && key && !dead[key]) tex = textures[key];
    mat.uniforms.uTex.value = tex;
    mat.uniforms.uOpacity.value = st.opacity;
    if (plane.current) plane.current.visible = !!tex;
    if (videos && key) {
      const v = videos[key];
      const want = st.clipMs / 1000;
      if (phaseRef.current !== st.phase) {
        phaseRef.current = st.phase;
        if (Math.abs(v.currentTime - want) > 0.05) { try { v.currentTime = want; } catch { /* not ready */ } }
        void v.play().catch(() => { /* the poster carries the visit */ });
        (Object.keys(videos) as (keyof VisitVideos)[]).forEach((key) => { if (videos[key] !== v) videos[key].pause(); });
      } else if (st.phase !== 'settled' && Math.abs(v.currentTime - want) > 0.3) {
        try { v.currentTime = want; } catch { /* not ready */ }
      }
    }
    if (glowMat.current) glowMat.current.opacity = st.opacity * 0.26;
    if (shadowMat.current) shadowMat.current.opacity = 0.55 * Math.min(1, st.opacity / VISIT_PEAK);
    if (shadow.current) shadow.current.position.x = (st.figureX - 0.5) * pw;
  });

  return (
    <group ref={group} name="rail-visit" position={[gx, 0, gz]} rotation={[0, gyaw, 0]} renderOrder={fig.row === 0 ? 2 : 1} visible={false}>
      <mesh ref={shadow} geometry={QUAD} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[pw * 0.85, pw * 0.5, 1]} renderOrder={0}>
        <meshBasicMaterial ref={shadowMat} map={shadowTex} transparent opacity={0} depthWrite={false} color="#000000" />
      </mesh>
      <mesh geometry={QUAD} position={[0, RAIL_FLOOR_Y + ph * 0.52, -0.06]} scale={[pw * 1.7, ph * 1.15, 1]}>
        <meshBasicMaterial ref={glowMat} map={glowTex} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} color="#c07f2e" />
      </mesh>
      <mesh ref={plane} geometry={QUAD} position={[0, RAIL_FLOOR_Y + ph / 2, 0]} scale={[pw, ph, 1]}>
        <primitive object={mat} attach="material" />
      </mesh>
    </group>
  );
}

/** Reduced-effects frame source for visit windows: the crowd ticker
 *  is unmounted then, but a still-frame visit still needs its fade
 *  frames — flow only while a window is pending or live. */
function VisitTicker({ cue }: { cue: CrowdCue }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden) return;
      const now = performance.now();
      if (cue.visitUntil > now - 400 && cue.visitAt < now + 20000) invalidate();
    }, 100);
    return () => window.clearInterval(id);
  }, [invalidate, cue]);
  return null;
}

/* ------------------------------------------------------------------ */

export interface KingRailProps {
  /** the rail cast (character ids) — empty off the King */
  cast: readonly string[];
  /** per-seat seated figures: character id or null, by LOCAL seat */
  seated: readonly (string | null)[];
  positions: readonly SeatPos[];
  n: number;
  turnSeat: number;
  cue: CrowdCue;
  animate: boolean;
  /** stage shape: wide/short stages push the ring out (ringScaleFor) */
  aspect: number;
  short: boolean;
  /** the filmed-visit system is live (the solo King sample):
   *  characters with clips in RAIL_VISITORS leave the standing ring
   *  and only visit. Off (co-op, every other surface) the ring
   *  renders exactly as it always has. */
  visit?: boolean;
}

export default function KingRail({ cast, seated, positions, n, turnSeat, cue, animate, aspect, short, visit = false }: KingRailProps) {
  const ringScale = ringScaleFor(aspect, short);
  const figures = useMemo(() => kingRailFigures(cast, ringScale), [cast, ringScale]);
  const seatedFigs = useMemo(
    () => seated.map((id, seat) => (id ? seatedFigureFor(id, seat, positions[seat] ?? 'top', n, ringScale) : null)),
    [seated, positions, n, ringScale],
  );
  // The nuke family stirs the room over the fx bus — the same moments
  // the table's own effects key on, no new coupling.
  useEffect(() => fx.on((e) => {
    if (e.kind === 'nuke') stampStir(cue, performance.now(), 1);
    else if (e.kind === 'mega') stampStir(cue, performance.now(), 1.3);
    else if (e.kind === 'ranIt') stampStir(cue, performance.now(), 0.8);
  }), [cue]);

  const turnPos = positions[turnSeat];
  const target = useMemo(() => {
    if (!turnPos) return { x: 0, z: 0 };
    const p = edgePoint(seatDir(turnPos, n));
    return { x: p.x, z: p.z };
  }, [turnPos, n]);

  // The visit split: with the system live, a visitor's slot is
  // computed with everyone else's (positions stay stable) but their
  // STANDING figure is not rendered — they only visit it.
  const standing = visit ? figures.filter((f) => !RAIL_VISITORS[f.id]) : figures;
  const visitFigs = visit ? figures.filter((f) => RAIL_VISITORS[f.id]) : [];

  return (
    <group name="king-rail-crowd">
      {animate && <CrowdTicker />}
      {!animate && visitFigs.length > 0 && <VisitTicker cue={cue} />}
      {standing.map((f) => <CrowdFigure key={f.id} fig={f} cue={cue} animate={animate} />)}
      {visitFigs.map((f) => <VisitFigure key={f.id} fig={f} clips={RAIL_VISITORS[f.id]!} cue={cue} animate={animate} />)}
      {seatedFigs.map((f) => (f ? <SeatedFigure3D key={f.seat} fig={f} cue={cue} animate={animate} target={target} /> : null))}
    </group>
  );
}
