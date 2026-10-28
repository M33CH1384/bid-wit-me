import { useFrame, useThree } from '@react-three/fiber';
import { Bloom, ChromaticAberration, EffectComposer, Vignette } from '@react-three/postprocessing';
import { BlendFunction, type BloomEffect, type ChromaticAberrationEffect } from 'postprocessing';
import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DoubleSide, type Group, MeshBasicMaterial, type Mesh, type PerspectiveCamera,
  PlaneGeometry, type PointLight, RingGeometry, ShaderMaterial, SphereGeometry, TorusGeometry, Vector2, Vector3,
} from 'three';
import { fx } from '../fx';
import {
  ARMED_GLOW_RADIUS, DEBRIS_RAIN_Y, NUKE_MEGA_STAGE2_S, armedEmberPulse, capCoverRadius, cloudCardCount, cloudCardPose,
  currentNukeDevice, nukeChoreography, nukeClockStalled, nukeProfile, particleBudget,
} from './nukeVisual';

/**
 * Cinematic Big-over-Little-Joker nuke, in the 3D scene (~3.6 s, tap to skip):
 *   0.00 hot pin-point of light at the trick (silent beat)
 *   0.30 white-out flash + bloom overexposure, chromatic aberration, vignette pulse, camera punch-in + decaying shake
 *   0.30 fireball (noise-displaced emissive shells, white → yellow → orange → deep red), shockwave ring across the felt,
 *        dust skirt, every card on the felt swept off and held out (Full Nuke also kicks the hand + HUD)
 *   0.90 it rises into a mushroom cloud: stem + cap assembly (rolling torus edge + noise dome +
 *        opaque underlay disc + cloud wall dropping to the felt) that spreads until, at 2.15 s,
 *        the cap reaches FULL table coverage (radius sampled from the live camera — no felt visible),
 *        card silhouettes tumbling inside the wall; the cloud holds, then settles and thins to reveal the table
 *   1.80 embers and ash drift down; the scene light is tinted orange throughout, then everything clears
 *   iOS (no post, no screen pass): the engulf is geometry — the fire shader on dome / wall / stem,
 *        the opaque underlay disc (0.88) so shader-alpha dips can never reopen a window onto the
 *        felt, and a DoubleSide white-out ball mesh instead of bloom.
 * Table setting "Nuke intensity": full / classic / off (+ Reduce effects forces off locally). Low graphics, and
 * iPhone / iPad Safari: fewer particles, no post-processing, and no fullscreen fire pass (the half-float bloom
 * composer and the screen-sized noise shader wedge those GPUs on the white flash — the fireball, shockwave,
 * and particles still play). "off" = no 3D effect at all (Hype shows the banner, audio plays the boom).
 */
export const NUKE_LEN = 3.6;
const FLASH = 0.3;
/**
 * ☢☢ MEGA (a Run it! with both Jokers, Demetrius 2026-10-23): the same blast one tier up —
 * 4.4 s, a bigger fireball and cap, a wider first ring, hotter light, and a SECOND detonation
 * MEGA_STAGE2 seconds after the first flash. Wave A (§E.2 (a)): the mega escalates on the
 * frame / room axes, not felt coverage (the nuke already saturates that) — at stage 2 the cap
 * grows ×1.36 PAST the cover radius, the first ring runs to 7.5 and a second to 9.5 world
 * units, the white-out ball spikes to 0.95, the camera takes an added FOV kick, and a debris
 * field rains past the viewport. Particle counts scale by the same profile detail, ×1.4 — on
 * iOS (detail 0.45) that is 0.63 of the desktop nuke's counts, so the phone still spends less
 * than a desktop nuke. Mode handling mirrors the nuke exactly.
 */
export const MEGA_LEN = 4.4;
const MEGA_STAGE2 = NUKE_MEGA_STAGE2_S;

const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy; i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx; vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_); vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw); vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3))); p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){ return snoise(p)*0.6 + snoise(p*2.1+7.3)*0.3 + snoise(p*4.3+1.7)*0.1; }
`;

/** Fire / cloud shell: noise-displaced, heat-graded (white → yellow → orange → red → smoke), soft fresnel edge. */
function fireMaterial(seed: number, flow = 1.4) {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false, side: DoubleSide,
    uniforms: { uTime: { value: 0 }, uHeat: { value: 1 }, uAlpha: { value: 1 }, uDisp: { value: 0.18 }, uSeed: { value: seed }, uFlow: { value: flow }, uGlow: { value: 3 } },
    vertexShader: NOISE + /* glsl */ `
      uniform float uTime, uDisp, uSeed, uFlow; varying float vN; varying vec3 vNormalV; varying vec3 vViewDir;
      void main(){
        vec3 p = position;
        float n = fbm(p * 2.4 + vec3(uSeed, -uTime * uFlow, uSeed * 0.5));
        vN = n;
        p += normal * n * uDisp;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vNormalV = normalize(normalMatrix * normal); vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uHeat, uAlpha, uGlow; varying float vN; varying vec3 vNormalV; varying vec3 vViewDir;
      vec3 ramp(float h){
        vec3 smoke = vec3(0.16, 0.13, 0.14), red = vec3(0.55, 0.05, 0.01), orange = vec3(1.0, 0.36, 0.04), yellow = vec3(1.0, 0.82, 0.32), white = vec3(1.0, 0.98, 0.9);
        if (h < 0.25) return mix(smoke, red, h / 0.25);
        if (h < 0.5) return mix(red, orange, (h - 0.25) / 0.25);
        if (h < 0.75) return mix(orange, yellow, (h - 0.5) / 0.25);
        return mix(yellow, white, (h - 0.75) / 0.25);
      }
      void main(){
        float facing = abs(dot(normalize(vNormalV), normalize(vViewDir)));
        // hot core facing you, cooler sooty rims; noise breaks it into churning billows
        float h = clamp(uHeat + vN * 0.5 + (facing - 0.55) * 0.5, 0.0, 1.0);
        vec3 c = ramp(h) * mix(1.0, uGlow, h * h);
        float a = uAlpha * smoothstep(0.0, 0.45, facing) * (0.65 + 0.35 * h);
        gl_FragColor = vec4(c, a);
      }`,
  });
}

/**
 * Screen-space fire + smoke (a full-viewport quad drawn over the 3D scene) so the blast reaches every edge on any
 * aspect ratio: a fire front races out from the blast to past the farthest corner, churns as rolling orange/red
 * billows (thinner in the middle so the 3D mushroom cloud reads through), cools to dark smoke, then clears.
 */
function screenFireMaterial() {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uAspect: { value: 1 }, uCenter: { value: new Vector2(0.5, 0.45) }, uOct: { value: 1 }, uMega: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: NOISE + /* glsl */ `
      uniform float uTime, uAspect, uOct, uMega; uniform vec2 uCenter; varying vec2 vUv;
      vec3 ramp(float h){
        vec3 smoke = vec3(0.09, 0.075, 0.08), red = vec3(0.6, 0.06, 0.01), orange = vec3(1.2, 0.42, 0.05), yellow = vec3(1.6, 1.15, 0.45), white = vec3(2.2, 2.1, 1.9);
        if (h < 0.25) return mix(smoke, red, h / 0.25);
        if (h < 0.5) return mix(red, orange, (h - 0.25) / 0.25);
        if (h < 0.75) return mix(orange, yellow, (h - 0.5) / 0.25);
        return mix(yellow, white, (h - 0.75) / 0.25);
      }
      void main(){
        float t = uTime - ${FLASH.toFixed(2)};
        if (t <= 0.0) discard;
        vec2 q = (vUv - uCenter) * vec2(uAspect, 1.0);
        // distance to the farthest corner, so the front always clears every edge
        vec2 far = max(abs(vec2(0.0, 0.0) - uCenter), abs(vec2(1.0, 1.0) - uCenter)) * vec2(uAspect, 1.0);
        float d = length(q) / length(far);
        float ang = atan(q.y, q.x);
        float n = fbm(vec3(q * 2.2, t * 0.9));
        float n2 = uOct > 0.5 ? fbm(vec3(q * 5.0 + 3.1, t * 1.6)) : n;
        // fire front: reaches past the corners by ~0.5 s after the flash
        float front = 1.25 * (1.0 - pow(1.0 - clamp(t / 0.5, 0.0, 1.0), 3.0)) + 0.12 * snoise(vec3(cos(ang) * 2.0, sin(ang) * 2.0, t));
        float inside = smoothstep(front + 0.06, front - 0.08, d + n * 0.08);
        // heat: white-hot early, cooling to orange/red billows, then sooty smoke
        float heat = clamp(1.05 - t * 0.55 + n * 0.35 + n2 * 0.15 - d * 0.25, 0.0, 1.0);
        float cool = smoothstep(1.4, 2.6, t);
        heat *= 1.0 - 0.85 * cool;
        // thinner over the middle (where the 3D mushroom is), thick at the edges; clears out by ~3.4 s
        float edge = mix(0.38, 1.0, smoothstep(0.15, 0.75, d));
        float billow = 0.62 + 0.38 * smoothstep(-0.4, 0.5, n + n2 * 0.5);
        float life = 1.0 - smoothstep(2.4, 3.3, t + n * 0.25);
        float a = inside * edge * billow * life * (0.85 + 0.15 * smoothstep(0.0, 0.3, heat));
        vec3 col = ramp(heat);
        // ☢☢ mega second stage: a second, faster fire front races out behind the first and
        // re-heats the frame; its own life runs past the first front's clear (~4.1 s)
        if (uMega > 0.5) {
          float t2 = t - ${MEGA_STAGE2.toFixed(2)};
          if (t2 > 0.0) {
            float front2 = 1.4 * (1.0 - pow(1.0 - clamp(t2 / 0.55, 0.0, 1.0), 3.0)) + 0.12 * snoise(vec3(cos(ang) * 2.0, sin(ang) * 2.0, t2 + 4.7));
            float inside2 = smoothstep(front2 + 0.06, front2 - 0.08, d + n * 0.08);
            float heat2 = clamp(1.1 - t2 * 0.6 + n * 0.3 - d * 0.2, 0.0, 1.0);
            float life2 = 1.0 - smoothstep(3.2, 4.1, t + n * 0.25);
            float a2 = inside2 * edge * billow * life2;
            col = mix(col, ramp(heat2), clamp(a2 * 1.2, 0.0, 1.0));
            a = max(a, a2 * 0.95);
          }
        }
        if (a < 0.003) discard;
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }`,
  });
}
interface PSys { geo: BufferGeometry; mat: ShaderMaterial }
/** Soft-particle system (points): kind 0 smoke, 1 dust, 2 ember, 3 ash, 4 debris chunks. Positions are analytic in the shader. */
function particles(kind: number, count: number, spawn: (i: number) => { p: [number, number, number]; v: [number, number, number]; birth: number; life: number; size: number }): PSys {
  const geo = new BufferGeometry();
  const P = new Float32Array(count * 3), V = new Float32Array(count * 3), B = new Float32Array(count), L = new Float32Array(count), S = new Float32Array(count), R = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const s = spawn(i);
    P.set(s.p, i * 3); V.set(s.v, i * 3); B[i] = s.birth; L[i] = s.life; S[i] = s.size; R[i] = Math.random();
  }
  geo.setAttribute('position', new BufferAttribute(P, 3));
  geo.setAttribute('aVel', new BufferAttribute(V, 3));
  geo.setAttribute('aBirth', new BufferAttribute(B, 1));
  geo.setAttribute('aLife', new BufferAttribute(L, 1));
  geo.setAttribute('aSize', new BufferAttribute(S, 1));
  geo.setAttribute('aRnd', new BufferAttribute(R, 1));
  const mat = new ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false, blending: kind === 2 ? AdditiveBlending : undefined,
    uniforms: { uTime: { value: 0 }, uScale: { value: 400 }, uKind: { value: kind }, uFade: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uTime, uScale, uKind; attribute vec3 aVel; attribute float aBirth, aLife, aSize, aRnd;
      varying float vK; varying float vR;
      void main(){
        float age = uTime - aBirth;
        vK = age / aLife; vR = aRnd;
        if (age < 0.0 || age > aLife) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
        vec3 p = position;
        if (uKind < 0.5) { p += aVel * age; p.y += 0.08 * age * age; p.x += sin(age * 1.7 + aRnd * 6.0) * 0.05; }      // smoke: rises, churns
        else if (uKind < 1.5) { p += aVel * (1.0 - exp(-age * 2.4)) / 2.4; p.y += 0.05 * age; }                          // dust skirt: blasts out, drags
        else if (uKind < 2.5) { p += aVel * age; p.y -= 0.45 * age * age; p.x += sin(age * 5.0 + aRnd * 9.0) * 0.03; }   // embers: fall, flicker
        else if (uKind < 3.5) { p += aVel * age; p.y -= 0.12 * age * age; p.x += sin(age * 2.0 + aRnd * 9.0) * 0.08; }   // ash: drifts down
        else { p += aVel * age; p.y -= 0.9 * age * age; p.x += sin(age * 3.0 + aRnd * 9.0) * 0.02; }                     // debris: rains under gravity
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float grow = uKind < 1.5 ? (0.6 + vK * 1.6) : 1.0;
        gl_PointSize = aSize * grow * uScale / max(0.2, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uKind, uFade; varying float vK; varying float vR;
      void main(){
        vec2 d = gl_PointCoord - 0.5; float r = length(d);
        if (r > 0.5) discard;
        float soft = smoothstep(0.5, 0.0, r);
        vec3 c; float a;
        if (uKind < 0.5) { c = mix(vec3(1.0, 0.45, 0.12), vec3(0.2, 0.17, 0.18) + vR * 0.06, smoothstep(0.0, 0.35, vK)); a = soft * 0.42 * (1.0 - vK) * smoothstep(0.0, 0.08, vK); }
        else if (uKind < 1.5) { c = vec3(0.42, 0.33, 0.27); a = soft * 0.38 * (1.0 - vK); }
        else if (uKind < 2.5) { c = vec3(3.0, 1.2, 0.3) * (1.0 - vK * 0.6); a = soft * soft * (1.0 - vK); }
        else if (uKind < 3.5) { c = vec3(0.32, 0.3, 0.3); a = soft * 0.7 * (1.0 - vK); }
        else { c = vR < 0.4 ? vec3(2.4, 0.8, 0.2) * (1.0 - vK * 0.5) : vec3(0.12, 0.1, 0.1); a = soft * 0.95 * (1.0 - vK); } // debris: some chunks still glowing
        gl_FragColor = vec4(c, a * uFade);
      }`,
  });
  return { geo, mat };
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Set by Nuke3D; called when the WebGL context dies so the white flash can't pin the canvas. */
let bailNuke: (() => void) | null = null;

export function Nuke3D({ quality }: { quality: 'high' | 'low' }) {
  const [run, setRun] = useState<{ id: number; start: number; full: boolean; mega: boolean; len: number } | null>(null);
  const profile = useMemo(() => nukeProfile(quality, currentNukeDevice()), [quality]);
  useEffect(() => {
    bailNuke = () => setRun(null);
    return () => { bailNuke = null; };
  }, []);
  useEffect(() => fx.on((e) => {
    if (e.kind !== 'nuke' && e.kind !== 'mega') return;
    const mode = fx.nukeMode;
    if (mode === 'off') return;
    const mega = e.kind === 'mega';
    setRun({ id: e.id, start: performance.now(), full: mode === 'full', mega, len: mega ? MEGA_LEN : NUKE_LEN });
  }), []);
  // tap anywhere to skip
  useEffect(() => {
    if (!run) return;
    const skip = () => setRun(null);
    const t = window.setTimeout(() => window.addEventListener('pointerdown', skip, { once: true }), 400);
    const end = fx.warp === null ? window.setTimeout(() => setRun(null), run.len * 1000 + 100) : 0;
    const w = window as unknown as { __bwmNuke?: unknown; __bwmNukeT?: number | null };
    w.__bwmNuke = { active: true, start: run.start };
    w.__bwmNukeT = null; // a previous blast's clock must not look like this one is advancing
    return () => { clearTimeout(t); clearTimeout(end); window.removeEventListener('pointerdown', skip); w.__bwmNuke = { active: false }; };
  }, [run]);
  // Demand-mode safety: if frames stop while the clock is still in the blast, tear the point light down
  // so the table can paint and the hand can finish. A backgrounded tab is not a stall.
  useEffect(() => {
    if (!run || fx.warp !== null) return;
    let prev: number | null = null;
    let last = performance.now();
    const id = window.setInterval(() => {
      if (document.hidden) { prev = null; last = performance.now(); return; }
      const now = performance.now();
      const rendered = (window as unknown as { __bwmNukeT?: number | null }).__bwmNukeT ?? null;
      const dt = now - last;
      if (nukeClockStalled(prev, rendered, dt, run.len)) {
        (window as unknown as { __bwmNukeStall?: boolean }).__bwmNukeStall = true;
        fx.blast = null;
        setRun(null);
        return;
      }
      prev = rendered;
      last = now;
    }, 800);
    return () => clearInterval(id);
  }, [run]);
  if (!run) return null;
  return (
    <NukeRun
      key={run.id}
      start={run.start}
      full={run.full}
      mega={run.mega}
      len={run.len}
      detail={profile.detail}
      post={profile.post}
      octaves={profile.octaves}
      screen={profile.screen}
      onBail={() => setRun(null)}
    />
  );
}

/** Soft radial falloff for the armed ember pool (a generated texture, no asset). */
function radialGlowTexture(): CanvasTexture | null {
  try {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    if (!g) return null;
    const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.38)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new CanvasTexture(c);
  } catch {
    return null;
  }
}

/**
 * The armed nuke's glow, rebuilt (row 57): ember-light pulsing UNDER the trick cards —
 * an additive radial ember pool (radius ARMED_GLOW_RADIUS = 1.3, covering the whole trick
 * plus layout) plus a low orange point light, driven by `armedEmberPulse` (the old outline's
 * 1 Hz cadence + a flicker harmonic; steady under reduced motion). Mounted by Scene beside
 * <Nuke3D> from the same lazy chunk; replaces Card3D's old on-card outline.
 */
export function NukeArmedGlow({ armed }: { armed: boolean }) {
  const mat = useRef<MeshBasicMaterial>(null);
  const glowLight = useRef<PointLight>(null);
  const { invalidate } = useThree();
  const tex = useMemo(radialGlowTexture, []);
  useEffect(() => () => { tex?.dispose(); }, [tex]);
  useFrame(() => {
    if (!armed) return;
    invalidate();
    const p = armedEmberPulse(performance.now() / 1000, fx.reduced || fx.osReducedMotion);
    if (mat.current) mat.current.opacity = 0.3 + 0.38 * p;
    if (glowLight.current) glowLight.current.intensity = 2.4 * p;
  });
  if (!armed) return null;
  return (
    <group position={[0, 0.02, 0.04]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <circleGeometry args={[ARMED_GLOW_RADIUS, 40]} />
        <meshBasicMaterial ref={mat} map={tex ?? undefined} color="#ff7a26" transparent opacity={0.6} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <pointLight ref={glowLight} position={[0, 0.3, 0]} distance={3.2} decay={1.8} color="#ff8a3a" intensity={1.2} />
    </group>
  );
}

/**
 * Context-loss safety net, mounted for the whole table (not only while the blast is up). iOS kills the
 * WebGL context instead of throwing when the flash overdraws; without preventDefault it never comes back
 * and the trick stays frozen white. Bailing the blast lets the restored context paint the table again.
 */
export function NukeGlRecovery() {
  const { gl, invalidate } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const lost = (e: Event) => {
      e.preventDefault();
      postBroken = true;
      fx.blast = null;
      (window as unknown as { __bwmNukeContextLost?: boolean }).__bwmNukeContextLost = true;
      bailNuke?.();
    };
    const restored = () => { invalidate(); };
    el.addEventListener('webglcontextlost', lost);
    el.addEventListener('webglcontextrestored', restored);
    return () => { el.removeEventListener('webglcontextlost', lost); el.removeEventListener('webglcontextrestored', restored); };
  }, [gl, invalidate]);
  return null;
}

function NukeRun({ start, full, mega, len, detail, post, octaves, screen, onBail }: { start: number; full: boolean; mega: boolean; len: number; detail: number; post: boolean; octaves: 0 | 1; screen: boolean; onBail: () => void }) {
  const { camera, invalidate, size } = useThree();
  const cam = camera as PerspectiveCamera;
  const baseFov = useRef(cam.fov);
  const root = useRef<Group>(null);
  const pin = useRef<Mesh>(null);
  const ball = useRef<Group>(null);
  const capG = useRef<Group>(null);
  const capTorus = useRef<Mesh>(null);
  const capDome = useRef<Mesh>(null);
  const capWall = useRef<Mesh>(null);
  const capDisc = useRef<Mesh>(null);
  const flashBall = useRef<Mesh>(null);
  const silG = useRef<Group>(null);
  const stem = useRef<Mesh>(null);
  const ring = useRef<Mesh>(null);
  const ring2 = useRef<Mesh>(null);
  const light = useRef<PointLight>(null);
  const ca = useRef<ChromaticAberrationEffect>(null);
  const bloomFx = useRef<BloomEffect>(null);
  const bailRef = useRef(onBail);
  bailRef.current = onBail;
  const bailed = useRef(false);
  const stage2Shaken = useRef(false);
  const low = detail < 1;
  // particle budget from nukeVisual: base sum 640 for the nuke, the mega exactly ×1.4 at
  // equal detail (iOS mega: 0.45 × 1.4 = 0.63 of a desktop nuke)
  const budget = particleBudget(detail, mega);
  const silCount = cloudCardCount(detail);

  const parts = useMemo(() => {
    const fire = [fireMaterial(0.3, 1.6), fireMaterial(3.1, 1.2)];
    fire[1]!.uniforms.uDisp!.value = 0.28;
    const capMat = fireMaterial(5.7, 0.9); capMat.uniforms.uDisp!.value = 0.22;
    const stemMat = fireMaterial(8.2, 2.2); stemMat.uniforms.uDisp!.value = 0.12;
    const screenMat = screenFireMaterial(); screenMat.uniforms.uOct!.value = octaves; screenMat.uniforms.uMega!.value = mega ? 1 : 0;
    const ringShader = () => new ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false, blending: AdditiveBlending, side: DoubleSide,
      uniforms: { uA: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uA; varying vec2 vUv; void main(){ float r = length(vUv - 0.5) * 2.0; float band = smoothstep(0.78, 0.93, r) * smoothstep(1.0, 0.94, r); gl_FragColor = vec4(vec3(1.0, 0.85, 0.55) * 2.2, band * uA); }',
    });
    const ringMat = ringShader();
    const ring2Mat = ringShader();
    const counts = budget.counts;
    const smoke = particles(0, counts.smoke, () => {
      const a = rnd(0, Math.PI * 2), rr = rnd(0, 0.35), up = Math.random() < 0.55;
      return { p: [Math.cos(a) * rr, up ? rnd(0.5, 1.2) : rnd(0.05, 0.5), Math.sin(a) * rr], v: [Math.cos(a) * rnd(0.05, 0.22), rnd(0.12, 0.4), Math.sin(a) * rnd(0.05, 0.22)], birth: rnd(0.4, 2.4), life: rnd(1.2, 2.2), size: rnd(0.22, 0.42) };
    });
    const dust = particles(1, counts.dust, () => {
      const a = rnd(0, Math.PI * 2), sp = rnd(1.6, 3.2);
      return { p: [Math.cos(a) * 0.12, 0.03, Math.sin(a) * 0.12], v: [Math.cos(a) * sp, rnd(0, 0.12), Math.sin(a) * sp], birth: rnd(FLASH, FLASH + 0.25), life: rnd(1.1, 1.8), size: rnd(0.12, 0.24) };
    });
    const embers = particles(2, counts.embers, () => {
      const a = rnd(0, Math.PI * 2), rr = rnd(0, 0.9);
      return { p: [Math.cos(a) * rr, rnd(0.9, 1.6), Math.sin(a) * rr], v: [rnd(-0.15, 0.15), rnd(0.0, 0.25), rnd(-0.15, 0.15)], birth: rnd(1.5, 2.7), life: rnd(0.9, 1.5), size: rnd(0.02, 0.045) };
    });
    const ash = particles(3, counts.ash, () => {
      const a = rnd(0, Math.PI * 2), rr = rnd(0, 1.4);
      return { p: [Math.cos(a) * rr, rnd(1.2, 2.0), Math.sin(a) * rr], v: [rnd(-0.08, 0.08), rnd(-0.1, 0.0), rnd(-0.08, 0.08)], birth: rnd(1.9, 2.9), life: rnd(1.0, 1.6), size: rnd(0.025, 0.05) };
    });
    // debris chunks (kind 4): the mega's stage-2 field rains from DEBRIS_RAIN_Y down past the
    // viewport; the plain nuke tosses a modest local chunk spray off the fireball instead
    const debris = particles(4, counts.debris, () => {
      const a = rnd(0, Math.PI * 2);
      if (mega) {
        const rr = rnd(0, 2.6);
        return { p: [Math.cos(a) * rr, rnd(DEBRIS_RAIN_Y.min, DEBRIS_RAIN_Y.max), Math.sin(a) * rr], v: [Math.cos(a) * rnd(0.1, 0.5), rnd(-0.2, 0), Math.sin(a) * rnd(0.1, 0.5)], birth: rnd(FLASH + MEGA_STAGE2, FLASH + MEGA_STAGE2 + 1.2), life: rnd(0.9, 1.6), size: rnd(0.05, 0.11) };
      }
      const rr = rnd(0, 0.4);
      return { p: [Math.cos(a) * rr, rnd(0.3, 1.0), Math.sin(a) * rr], v: [Math.cos(a) * rnd(0.3, 0.9), rnd(0.4, 1.0), Math.sin(a) * rnd(0.3, 0.9)], birth: rnd(FLASH, FLASH + 0.3), life: rnd(0.7, 1.2), size: rnd(0.04, 0.08) };
    });
    // hot core that does not depend on the noise shaders: if those fail to compile (iOS), the blast is still a fireball
    const core = new MeshBasicMaterial({ color: '#ffb15a', transparent: true, depthWrite: false, toneMapped: false, opacity: 0 });
    // the engulf's massing pieces — MeshBasicMaterial, no shader-compile risk on iOS:
    // an opaque underlay disc under the dome (hot early → sooty late) so shader-alpha dips can
    // never reopen a window onto the felt, and the white-out ball (DoubleSide: a low sitting
    // camera can sit inside its ellipsoid)
    const discMat = new MeshBasicMaterial({ color: '#ff9a3c', transparent: true, depthWrite: false, toneMapped: false, opacity: 0 });
    const flashMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, toneMapped: false, opacity: 0, side: DoubleSide });
    const silMat = new MeshBasicMaterial({ color: '#140b06', transparent: true, depthWrite: false, toneMapped: false, opacity: 0, side: DoubleSide });
    return {
      fire, capMat, stemMat, ringMat, ring2Mat, smoke, dust, embers, ash, debris, core, discMat, flashMat, silMat,
      sphere: new SphereGeometry(1, low ? 32 : 64, low ? 24 : 48),
      torus: new TorusGeometry(1, 0.2, low ? 14 : 24, low ? 40 : 72),
      dome: new SphereGeometry(1, low ? 32 : 48, low ? 16 : 24, 0, Math.PI * 2, 0, Math.PI / 2),
      wall: new CylinderGeometry(1, 1, 1, low ? 32 : 48, 1, true),
      disc: new CircleGeometry(1, low ? 32 : 48),
      silGeo: new PlaneGeometry(0.5625, 0.7875), // a trick-scale card (CW × CH at TRICK_SCALE 2.25)
      cyl: new CylinderGeometry(0.11, 0.22, 1, low ? 16 : 28, low ? 8 : 16, true),
      ringGeo: new RingGeometry(0.01, 1, 96, 1),
      screenMat, quad: new PlaneGeometry(2, 2),
    };
  }, [budget, low, octaves, mega]);
  useEffect(() => () => {
    const p = parts;
    [...p.fire, p.capMat, p.stemMat, p.ringMat, p.ring2Mat, p.screenMat, p.core, p.discMat, p.flashMat, p.silMat, p.smoke.mat, p.dust.mat, p.embers.mat, p.ash.mat, p.debris.mat].forEach((m) => m.dispose());
    [p.sphere, p.torus, p.dome, p.wall, p.disc, p.silGeo, p.cyl, p.ringGeo, p.quad, p.smoke.geo, p.dust.geo, p.embers.geo, p.ash.geo, p.debris.geo].forEach((g) => g.dispose());
  }, [parts]);

  // blast impulse for the cards + Full Nuke HUD blow-away
  useEffect(() => {
    const t = window.setTimeout(() => {
      fx.blast = { start: performance.now(), hand: full, ...(mega ? { mega: true as const } : {}) };
      if (full) blowHud();
    }, FLASH * 1000);
    const fov0 = baseFov.current;
    return () => { clearTimeout(t); cam.fov = fov0; cam.updateProjectionMatrix(); fx.blast = null; document.querySelector('.table-screen')?.classList.remove('nuke-blow'); invalidate(); };
  }, [full, mega, cam, invalidate]);

  // frameloop is 'demand'. Keep asking for frames from a timer, not only from useFrame: a setState
  // or a thrown post pass can swallow the in-frame invalidate and leave the white flash on screen.
  useEffect(() => {
    if (fx.warp !== null) return;
    let id = 0;
    const pump = () => { invalidate(); id = window.setTimeout(pump, 48); };
    id = window.setTimeout(pump, 48);
    return () => clearTimeout(id);
  }, [invalidate]);

  const orange = useMemo(() => new Color(), []);
  const scratch = useMemo(() => new Vector3(), []);
  const fail = () => {
    if (bailed.current) return;
    bailed.current = true;
    // unmount on the next turn — tearing the tree down inside the subscriber loop wedges the demand loop
    window.setTimeout(() => bailRef.current(), 0);
  };
  useFrame(() => {
   try {
    const T = fx.warp ?? (performance.now() - start) / 1000;
    (window as unknown as { __bwmNukeT?: number }).__bwmNukeT = T;
    invalidate();
    const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
    // the fade window rides the run's length: (len − 1.05) → len (3.6 s nuke: the shipped 2.55/0.95)
    const fade = 1 - Math.min(1, Math.max(0, (T - (len - 1.05)) / 0.95));
    // ☢☢ mega second stage: tb2 = seconds since the second detonation (negative before it)
    const tb2 = T - FLASH - MEGA_STAGE2;
    // the engulf choreography, sampled from the LIVE camera (coverage is a camera-position fact)
    const choreo = nukeChoreography(T, { mega, len, coverRadius: capCoverRadius(cam.position) });
    const flash2Env = choreo.burst.env;
    if (mega && tb2 > 0 && !stage2Shaken.current) {
      stage2Shaken.current = true;
      // the second hit re-shakes the camera (fx.emit's shake covered the first flash)
      if (!fx.reduced && !fx.osReducedMotion && fx.nukeMode !== 'off') fx.shake = { start: performance.now(), dur: 1.5, amp: 0.17 };
    }
    // pin-point of light
    if (pin.current) { pin.current.visible = T < FLASH + 0.08; pin.current.scale.setScalar(0.02 + 0.05 * Math.min(1, T / FLASH)); }
    // fireball → rising dome
    const tb = T - FLASH;
    const heat = Math.max(0.04, 1 - Math.max(0, tb) / 1.4);
    if (ball.current) {
      // drawn from the first frame (tiny) so the fire shaders compile during the pin-point, not at the white flash
      ball.current.visible = true;
      // mega: a third again as wide, and the second detonation re-inflates it
      const bs = mega ? 1.35 : 1;
      const pulse2 = mega && tb2 > 0 ? 0.22 * Math.exp(-tb2 * 2.2) : 0;
      const s = (tb > 0 ? 0.12 + 0.62 * ease(tb / 0.45) - 0.08 * ease((tb - 0.6) / 1.2) : 0.001) * bs + pulse2;
      const flat = 1 - 0.38 * ease((tb - 0.6) / 1.0);
      ball.current.scale.set(s * (1 + 0.25 * (1 - flat)), Math.max(0.01, s * flat), s * (1 + 0.25 * (1 - flat)));
      ball.current.position.y = 0.14 + 0.9 * ease((tb - 0.25) / 1.8);
    }
    parts.core.opacity = tb > 0 ? 0.9 * fade : 0;
    parts.fire.forEach((m, i) => { m.uniforms.uTime!.value = T; m.uniforms.uHeat!.value = Math.min(1, heat + (i === 0 ? 0.15 : -0.05)); m.uniforms.uAlpha!.value = (i === 0 ? 1 : 0.75) * fade; });
    // mushroom cap assembly + stem: torus edge + noise dome + opaque underlay disc + cloud
    // wall, spreading to full table coverage at 2.15 s (mega: ×1.36 past it after stage 2)
    const tc = T - 0.9;
    const capY = choreo.capY;
    if (capG.current) {
      capG.current.visible = tc > 0;
      capG.current.position.y = capY;
      capG.current.rotation.y = T * 0.35;
      const R = Math.max(0.001, choreo.capRadius);
      if (capTorus.current) capTorus.current.scale.setScalar(R);
      if (capDome.current) capDome.current.scale.set(R, R * 0.55, R);
      if (capWall.current) {
        capWall.current.scale.set(R, Math.max(0.01, capY), R);
        capWall.current.position.y = -capY / 2; // the wall drops from the cap edge to the felt
      }
      if (capDisc.current) capDisc.current.scale.setScalar(R);
    }
    parts.capMat.uniforms.uTime!.value = T * 1.3; parts.capMat.uniforms.uHeat!.value = 0.08 + heat * 0.8; parts.capMat.uniforms.uAlpha!.value = 0.9 * choreo.capAlpha;
    // underlay disc: 0.88 at full spread, hot-toned early → sooty late
    parts.discMat.opacity = 0.88 * choreo.capAlpha;
    const dk = Math.min(1, Math.max(0, (T - FLASH) / 2.2));
    parts.discMat.color.setRGB(1 + (0.16 - 1) * dk, 0.6 + (0.13 - 0.6) * dk, 0.24 + (0.14 - 0.24) * dk);
    // white-out ball: iOS's bloom (and a desktop stack at the flash peak / the mega spike)
    if (flashBall.current) {
      flashBall.current.visible = choreo.whiteout > 0.01;
      const ws = 2.3 + 1.5 * choreo.whiteout;
      flashBall.current.scale.set(ws, ws * 0.72, ws);
      parts.flashMat.opacity = choreo.whiteout;
    }
    // card silhouettes tumbling inside the cloud wall (pure poses from nukeVisual)
    if (silG.current) {
      silG.current.visible = tc > 0 && choreo.capAlpha > 0;
      parts.silMat.opacity = 0.85 * (silCount > 0 ? cloudCardPose(0, T, choreo.capRadius).opacity : 0) * choreo.fade;
      silG.current.children.forEach((child, i) => {
        const pose = cloudCardPose(i, T, choreo.capRadius);
        child.position.set(pose.x, pose.y, pose.z - 0.04);
        child.rotation.set(pose.rx, pose.ry, pose.rz);
      });
    }
    if (stem.current) {
      stem.current.visible = tc > 0;
      const h = Math.max(0.01, capY);
      stem.current.scale.set(0.9 + 0.5 * ease(tc), h, 0.9 + 0.5 * ease(tc));
      stem.current.position.y = h / 2;
    }
    parts.stemMat.uniforms.uTime!.value = T; parts.stemMat.uniforms.uHeat!.value = 0.12 + heat * 0.55; parts.stemMat.uniforms.uAlpha!.value = 0.85 * fade * Math.min(1, Math.max(0, tc) * 2.5);
    // shockwave ring across the felt (mega's first ring runs to 7.5 and exits the frame edges)
    if (ring.current) {
      ring.current.visible = choreo.ringRadius > 0;
      if (ring.current.visible) {
        ring.current.scale.setScalar(choreo.ringRadius);
        parts.ringMat.uniforms.uA!.value = choreo.ringAlpha;
      }
    }
    // ☢☢ mega's second shockwave: the ring the nuke doesn't have, out to 9.5 world units
    if (ring2.current) {
      ring2.current.visible = choreo.burst.ring2Radius > 0;
      if (ring2.current.visible) {
        ring2.current.scale.setScalar(choreo.burst.ring2Radius);
        parts.ring2Mat.uniforms.uA!.value = choreo.burst.ring2Alpha;
      }
    }
    // screen-space fire / smoke: centred on the blast's on-screen position
    parts.screenMat.uniforms.uTime!.value = T;
    parts.screenMat.uniforms.uAspect!.value = size.width / Math.max(1, size.height);
    if (root.current) { const v = root.current.getWorldPosition(scratch).project(cam); parts.screenMat.uniforms.uCenter!.value.set(Math.min(0.9, Math.max(0.1, (v.x + 1) / 2)), Math.min(0.9, Math.max(0.1, (v.y + 1) / 2))); }
    // particles
    const scale = size.height * 0.55;
    for (const p of [parts.smoke, parts.dust, parts.embers, parts.ash, parts.debris]) { p.mat.uniforms.uTime!.value = T; p.mat.uniforms.uScale!.value = scale; p.mat.uniforms.uFade!.value = Math.min(1, (len - T) / 0.5); }
    // light: white pin → orange glow, decaying (mega: hotter peak, and the second stage re-spikes it)
    if (light.current) {
      const flashK = T < FLASH ? T / FLASH : Math.exp(-(T - FLASH) * 1.6);
      const flash2K = choreo.burst.lightEnv;
      light.current.intensity = (T < FLASH ? 6 * flashK : (mega ? 64 : 40) * flashK + 58 * flash2K + 6 * heat * fade) * (low ? 0.7 : 1);
      orange.setRGB(1, 0.45 + 0.55 * Math.max(0, 1 - Math.max(0, T - FLASH) * 2), 0.15 + 0.85 * Math.max(0, 1 - Math.max(0, T - FLASH) * 3));
      light.current.color.copy(orange);
      light.current.position.y = 0.3 + capY * 0.5;
    }
    // camera punch-in (nuke 0.10; mega punches 0.22 deep, plus the −0.10 × burst FOV kick)
    cam.fov = baseFov.current * (1 - choreo.fovPunch);
    cam.updateProjectionMatrix();
    // post: bloom overexposure at the flash, chromatic aberration pulse (the second stage re-pulses both)
    const flashEnv = T < FLASH ? 0 : Math.exp(-(T - FLASH) * 4);
    // mutate the effect — a React state update here rebuilds the composer's passes mid-flash and, on iOS, stops the present
    const b = 1.1 + 6 * flashEnv + 5 * flash2Env;
    if (bloomFx.current && Math.abs(bloomFx.current.intensity - b) > 0.05) bloomFx.current.intensity = b;
    if (ca.current) ca.current.offset.set(0.0004 + 0.01 * flashEnv + 0.008 * flash2Env, 0.0003 + 0.007 * flashEnv + 0.006 * flash2Env);
   } catch (e) {
    (window as unknown as { __bwmNukeError?: string }).__bwmNukeError = String(e);
    fail();
   }
  });

  return (
    <>
      <group ref={root} position={[0, 0.03, 0.04]}>
        <mesh ref={pin} geometry={parts.sphere}><meshBasicMaterial color={[6, 6, 5]} toneMapped={false} /></mesh>
        <pointLight ref={light} distance={mega ? 9 : 7} decay={1.6} intensity={0} />
        <group ref={ball} visible={false}>
          {!post && <mesh geometry={parts.sphere} material={parts.core} />}
          <mesh geometry={parts.sphere} material={parts.fire[0]} />
          <mesh geometry={parts.sphere} material={parts.fire[1]} scale={1.18} />
        </group>
        <mesh ref={flashBall} geometry={parts.sphere} material={parts.flashMat} position={[0, 0.5, 0]} visible={false} />
        <group ref={capG} visible={false}>
          <mesh ref={capTorus} geometry={parts.torus} material={parts.capMat} rotation={[Math.PI / 2, 0, 0]} />
          <mesh ref={capDome} geometry={parts.dome} material={parts.capMat} />
          <mesh ref={capWall} geometry={parts.wall} material={parts.capMat} />
          <mesh ref={capDisc} geometry={parts.disc} material={parts.discMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]} />
        </group>
        <group ref={silG} visible={false}>
          {Array.from({ length: silCount }, (_, i) => (
            <mesh key={i} geometry={parts.silGeo} material={parts.silMat} />
          ))}
        </group>
        <mesh ref={stem} geometry={parts.cyl} material={parts.stemMat} visible={false} />
        <mesh ref={ring} geometry={parts.ringGeo} material={parts.ringMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} visible={false} />
        {mega && <mesh ref={ring2} geometry={parts.ringGeo} material={parts.ring2Mat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} visible={false} />}
        <points geometry={parts.dust.geo} material={parts.dust.mat} frustumCulled={false} />
        <points geometry={parts.smoke.geo} material={parts.smoke.mat} frustumCulled={false} />
        <points geometry={parts.embers.geo} material={parts.embers.mat} frustumCulled={false} />
        <points geometry={parts.ash.geo} material={parts.ash.mat} frustumCulled={false} />
        <points geometry={parts.debris.geo} material={parts.debris.mat} frustumCulled={false} />
      </group>
      {screen && <mesh geometry={parts.quad} material={parts.screenMat} frustumCulled={false} renderOrder={1000} />}
      {post && !postBroken && (
        <PostGuard>
        <EffectComposer multisampling={0}>
          <Bloom ref={bloomFx} intensity={1.1} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur />
          <ChromaticAberration ref={ca} offset={new Vector2(0.002, 0.001)} radialModulation={false} modulationOffset={0} blendFunction={BlendFunction.NORMAL} />
          <Vignette eskil={false} offset={0.25} darkness={0.75} />
        </EffectComposer>
        </PostGuard>
      )}
    </>
  );
}

/**
 * Post-processing is the most fragile part on Safari / older iPhones (half-float render targets, shader limits). If it
 * throws, drop just the bloom / aberration for the rest of the session — the fireball, cloud, shockwave and screen fire
 * keep playing (it used to take the whole blast down with it).
 */
let postBroken = false;
class PostGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(e: unknown) { postBroken = true; (window as unknown as { __bwmNukePostError?: string }).__bwmNukePostError = String(e); }
  override render() { return this.state.failed ? null : this.props.children; }
}

/** The whole blast is guarded too: a shader/GPU failure must never unmount the table scene. */
export class NukeGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(e: unknown) { (window as unknown as { __bwmNukeError?: string }).__bwmNukeError = String(e); }
  override render() { return this.state.failed ? null : this.props.children; }
}

/** Full Nuke: the HUD (scorebug, plates, chat, last trick, controls) is blown outward from the blast, then springs back. */
function blowHud() {
  const screen = document.querySelector('.table-screen');
  if (!screen) return;
  const L = (window as unknown as { __bwmLayout?: { trick: { x: number; y: number; w: number; h: number }[] } }).__bwmLayout;
  const tr = L?.trick ?? [];
  const cx = tr.length ? tr.reduce((s, t) => s + t.x + t.w / 2, 0) / tr.length : innerWidth / 2;
  const cy = tr.length ? tr.reduce((s, t) => s + t.y + t.h / 2, 0) / tr.length : innerHeight * 0.45;
  for (const el of screen.querySelectorAll<HTMLElement>('.scorebug, .trump-strip, .badge-layer .plate, .me-plate, .last-trick, .chat, .chat-toggle, .ctl-cluster, .dock-btn')) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy, d = Math.max(60, Math.hypot(dx, dy));
    const push = 90 + 140 * Math.min(1, 300 / d);
    el.style.setProperty('--bx', `${(dx / d) * push}px`);
    el.style.setProperty('--by', `${(dy / d) * push}px`);
    el.style.setProperty('--br', `${(Math.random() - 0.5) * 30}deg`);
  }
  screen.classList.remove('nuke-blow');
  void (screen as HTMLElement).offsetWidth;
  screen.classList.add('nuke-blow');
  // (frame-exact captures drive time through fx.warp: the run's cleanup removes the class instead of a wall-clock timer)
  if (fx.warp === null) window.setTimeout(() => screen.classList.remove('nuke-blow'), 2600);
}
