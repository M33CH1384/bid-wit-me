import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, NormalBlending, type Points, ShaderMaterial } from 'three';
import { fx } from '../fx';

/**
 * 'Run it!' funnel over the table centre: swirling dust / wind streaks (grey-violet, normal blend) plus brighter
 * debris flecks (additive), rising and widening up the cone; it spins up, then bursts outward and fades with the fling.
 * Reads fx.tornado every frame (no React state), hidden otherwise. Not drawn under Reduce effects.
 */
const vert = /* glsl */ `
  attribute vec3 aSeed;
  uniform float uTime, uScale, uSize, uFling, uGrow;
  varying float vA; varying float vTint;
  void main() {
    float speed = 0.35 + 0.5 * aSeed.z;
    float h = fract(aSeed.x + uTime * speed);
    float y = h * 1.9 * uGrow;
    float r = (0.07 + 0.62 * h * h + 0.08 * h + aSeed.z * 0.06) * (1.0 + uFling * 4.0);
    float ang = aSeed.y * 6.2832 + uTime * (8.5 - 4.5 * h) + h * 3.0;
    vec3 p = vec3(cos(ang) * r, y + uFling * 0.6 * h, sin(ang) * r);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.5 + h) * (0.6 + aSeed.z) * uScale / -mv.z;
    vA = smoothstep(0.0, 0.12, h) * (1.0 - h) * (1.0 - uFling);
    vTint = aSeed.z;
  }`;
const frag = /* glsl */ `
  uniform vec3 uColA, uColB; uniform float uAlpha;
  varying float vA; varying float vTint;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d) * vA * uAlpha;
    gl_FragColor = vec4(mix(uColA, uColB, vTint), a);
  }`;

function cloud(n: number) {
  const g = new BufferGeometry();
  const seed = new Float32Array(n * 3);
  for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
  g.setAttribute('aSeed', new BufferAttribute(seed, 3));
  g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
  return g;
}

function mat(opts: { size: number; alpha: number; a: [number, number, number]; b: [number, number, number]; additive: boolean }) {
  return new ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false,
    blending: opts.additive ? AdditiveBlending : NormalBlending,
    uniforms: {
      uTime: { value: 0 }, uScale: { value: 600 }, uSize: { value: opts.size }, uFling: { value: 0 }, uGrow: { value: 0 }, uAlpha: { value: opts.alpha },
      uColA: { value: opts.a }, uColB: { value: opts.b },
    },
  });
}

export function Tornado3D({ quality }: { quality: 'high' | 'low' }) {
  const hi = quality === 'high';
  const parts = useMemo(() => ({
    dust: cloud(hi ? 1400 : 450),
    debris: cloud(hi ? 260 : 90),
    dustMat: mat({ size: 0.26, alpha: 0.72, a: [0.5, 0.48, 0.58], b: [0.36, 0.26, 0.55], additive: false }),
    debrisMat: mat({ size: 0.06, alpha: 1.0, a: [0.95, 0.85, 1.0], b: [0.6, 0.95, 0.7], additive: true }),
  }), [hi]);
  const dust = useRef<Points>(null), debris = useRef<Points>(null);
  const size = useThree((s) => s.size);
  useFrame(({ invalidate }) => {
    const T = fx.tornado;
    const show = !!T && !T.reduced;
    if (dust.current) dust.current.visible = show;
    if (debris.current) debris.current.visible = show;
    if (!show) return;
    // starts winding up ~0.4 s before the pull, flings at 1.25 s, gone by ~1.9 s
    const u = (fx.warp !== null ? fx.warp : (performance.now() - T.start) / 1000) + 0.4;
    for (const m of [parts.dustMat, parts.debrisMat]) {
      m.uniforms.uTime!.value = u;
      m.uniforms.uScale!.value = size.height * 0.9;
      m.uniforms.uGrow!.value = Math.min(1, Math.max(0, u / 0.7));
      m.uniforms.uFling!.value = Math.min(1, Math.max(0, (u - 1.65) / 0.6));
    }
    invalidate();
  });
  return (
    <group position={[0, 0.02, 0]}>
      <points ref={dust} geometry={parts.dust} material={parts.dustMat} frustumCulled={false} visible={false} renderOrder={5} />
      <points ref={debris} geometry={parts.debris} material={parts.debrisMat} frustumCulled={false} visible={false} renderOrder={6} />
    </group>
  );
}
