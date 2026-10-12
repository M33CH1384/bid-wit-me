import { useFrame, useThree } from '@react-three/fiber';
import { type ReactNode, useMemo, useRef } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, type Group, type Mesh, ShaderMaterial, Vector3 } from 'three';
import { CH, CR, CW } from './layout';
import { sound } from '../audio';
import { fx } from '../fx';
import { HAPTIC, haptic } from '../haptics';
import { BEAT_MARKS, type JokerKind, JOKER_PALETTE, cycleMs, getBurst, heartbeat, jitterPx, ripplePose } from '../jokerFx';

/**
 * Radioactive joker, drawn behind and around the card. The children (the card meshes) sit in the
 * beat group so the face scales with the double-beat and is never tinted — no emissive, opacity 1.
 */
export default function JokerAura({ kind, cardsAfter, reduceMotion, children }: {
  kind: JokerKind;
  cardsAfter: number;
  reduceMotion?: boolean;
  children?: ReactNode;
}) {
  const pal = JOKER_PALETTE[kind];
  const beat = useRef<Group>(null);
  const rim = useRef<ShaderMaterial>(null);
  const halo = useRef<ShaderMaterial>(null);
  const ripA = useRef<Mesh>(null);
  const ripB = useRef<Mesh>(null);
  const born = useRef<number[]>([]);
  const phase0 = useRef(performance.now());
  const prevPhase = useRef(0);
  const { invalidate } = useThree();
  const reduced = () => !!reduceMotion || fx.osReducedMotion;

  const rimMat = useMemo(() => new ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    uniforms: {
      uCore: { value: new Color(pal.core.hex) },
      uGlow: { value: 0.8 },
      uPx: { value: 0.004 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uCore; uniform float uGlow, uPx; varying vec2 vUv;
      float sdRound(vec2 p, vec2 b, float r){
        vec2 q = abs(p) - b + r;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }
      void main(){
        vec2 p = (vUv - 0.5) * vec2(${(CW * 2.4).toFixed(4)}, ${(CH * 2.2).toFixed(4)});
        float d = sdRound(p, vec2(${(CW / 2).toFixed(4)}, ${(CH / 2).toFixed(4)}), ${CR.toFixed(4)});
        float aa = max(uPx * 0.75, fwidth(d));
        float rim = smoothstep(-aa, aa, d) * (1.0 - smoothstep(2.0 * uPx - aa, 2.0 * uPx + aa, d));
        // 0 0 12px 2px and 0 0 36px 10px. uGlow breathes .35 → .9; the near shadow tracks it.
        float near = exp(-pow(max(d - 2.0 * uPx, 0.0) / max(12.0 * uPx, 1e-4), 2.0));
        float far = exp(-pow(max(d - 10.0 * uPx, 0.0) / max(36.0 * uPx, 1e-4), 2.0));
        float a = max(rim, max(near * uGlow, far * (0.35 * uGlow / 0.9)));
        if (a < 0.02) discard;
        gl_FragColor = vec4(uCore, a);
      }`,
  }), [pal.core.hex]);

  const haloMat = useMemo(() => new ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    uniforms: { uColor: { value: new Color(pal.core.hex) }, uAlpha: { value: 0.25 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
      void main(){
        float r = length(vUv - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.05, 1.0, r)) * uAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
  }), [pal.core.hex]);

  const ripMat = useMemo(() => new ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    uniforms: { uColor: { value: new Color(pal.hot.hex) }, uOp: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOp; varying vec2 vUv;
      void main(){
        float r = length(vUv - 0.5) * 2.0;
        float band = smoothstep(0.78, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r));
        float a = band * uOp;
        if (a < 0.02) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
  }), [pal.hot.hex]);
  const ripMatB = useMemo(() => ripMat.clone(), [ripMat]);

  const particles = useMemo(() => {
    const n = pal.particles;
    const geo = new BufferGeometry();
    const P = new Float32Array(n * 3);
    const R = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const side = i % 4;
      const u = (i / n) - 0.5;
      const x = side < 2 ? (side === 0 ? -1 : 1) * (CW / 2 + 0.012) : u * CW * 0.7;
      const y = side < 2 ? u * CH * 0.7 : (side === 2 ? 1 : -1) * (CH / 2 + 0.012);
      P.set([x, y, 0.01], i * 3);
      R[i] = (Math.sin(i * 12.9898 + kind.length) * 43758.5453) % 1;
      if (R[i]! < 0) R[i] = -R[i]!;
    }
    geo.setAttribute('position', new BufferAttribute(P, 3));
    geo.setAttribute('aRnd', new BufferAttribute(R, 1));
    const mat = new ShaderMaterial({
      transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new Color(pal.core.hex) },
        uScale: { value: 200 },
        uAlpha: { value: 1 },
      },
      vertexShader: `
        uniform float uTime, uScale; attribute float aRnd; varying float vA;
        void main(){
          float k = fract(uTime * (0.28 + aRnd * 0.35) + aRnd);
          vec3 p = position;
          p.y += k * 0.09;
          p.x += sin(uTime * 2.2 + aRnd * 20.0) * 0.008;
          vA = sin(k * 3.14159) * (0.45 + 0.55 * aRnd);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (0.012 + 0.01 * aRnd) * uScale / max(0.25, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uAlpha; varying float vA;
        void main(){
          float r = length(gl_PointCoord - 0.5);
          if (r > 0.5) discard;
          gl_FragColor = vec4(uColor, smoothstep(0.5, 0.05, r) * vA * uAlpha);
        }`,
    });
    return { geo, mat };
  }, [kind, pal.core.hex, pal.particles]);

  const size = useThree((s) => s.size);
  const cam = useThree((s) => s.camera);
  const scratch = useMemo(() => new Vector3(), []);
  const scratchB = useMemo(() => new Vector3(), []);
  const ndcA = useMemo(() => new Vector3(), []);
  const ndcB = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const g = beat.current;
    if (!g) return;
    const calm = reduced();
    invalidate();
    g.updateWorldMatrix(true, false);
    scratch.set(0, 0, 0).applyMatrix4(g.matrixWorld);
    scratchB.set(0.02, 0, 0).applyMatrix4(g.matrixWorld);
    const a = ndcA.copy(scratch).project(cam);
    const b = ndcB.copy(scratchB).project(cam);
    const px = Math.max(0.5, Math.hypot((b.x - a.x) * size.width / 2, (b.y - a.y) * size.height / 2));
    const localPerPx = 0.02 / px;
    rimMat.uniforms.uPx!.value = localPerPx;
    const popping = getBurst()?.kind === kind;
    if (calm) {
      if (!popping) { g.scale.setScalar(1); g.position.set(0, 0, 0); }
      rimMat.uniforms.uGlow!.value = 0.8;
      if (ripA.current) ripA.current.visible = false;
      if (ripB.current) ripB.current.visible = false;
      particles.mat.uniforms.uAlpha!.value = 0;
      return;
    }
    const now = performance.now();
    const cycle = cycleMs(cardsAfter);
    const phase = ((now - phase0.current) % cycle) / cycle;
    const pose = heartbeat(phase, kind);
    const j = jitterPx(now, cardsAfter, false);
    // During this joker's detonation the pop owns the scale (Card3D). Don't overwrite it.
    if (getBurst()?.kind !== kind) {
      g.scale.setScalar(pose.scale);
      g.position.set(j.x * localPerPx, j.y * localPerPx, 0);
    }
    rimMat.uniforms.uGlow!.value = pose.glow;
    // Beat marks: ripple + one haptic + an optional Geiger tick, from the phase itself.
    const prev = prevPhase.current;
    if (phase + 0.5 < prev) {
      // wrapped
      for (const m of BEAT_MARKS) if (prev < m || phase >= m) onBeat(now);
    } else {
      for (const m of BEAT_MARKS) if (prev < m && phase >= m) onBeat(now);
    }
    prevPhase.current = phase;
    const rings = [ripA.current, ripB.current];
    const mats = [ripMat, ripMatB];
    born.current = born.current.filter((t0) => now - t0 < 700);
    rings.forEach((mesh, i) => {
      const t0 = born.current[i];
      if (!mesh || t0 === undefined) { if (mesh) mesh.visible = false; return; }
      const rp = ripplePose(now - t0, kind);
      mesh.visible = !!rp;
      if (!rp) return;
      mesh.scale.setScalar(rp.scale);
      mats[i]!.uniforms.uOp!.value = rp.opacity;
    });
    particles.mat.uniforms.uAlpha!.value = 1;
    particles.mat.uniforms.uTime!.value = now / 1000;
    particles.mat.uniforms.uScale!.value = size.height * 0.55;
  });

  function onBeat(now: number) {
    born.current = [now, ...born.current].slice(0, 2);
    haptic(HAPTIC.beat, 'beat');
    sound.geigerTick();
  }

  return (
    <>
      <mesh position={[0, 0, -0.02]} scale={[pal.halo, pal.halo, 1]} renderOrder={-2}>
        <planeGeometry args={[CW, CH]} />
        <primitive object={haloMat} ref={halo} attach="material" />
      </mesh>
      <mesh ref={ripA} position={[0, 0, -0.012]} renderOrder={-2} visible={false}>
        <planeGeometry args={[CW * 1.7, CH * 1.7]} />
        <primitive object={ripMat} attach="material" />
      </mesh>
      <mesh ref={ripB} position={[0, 0, -0.011]} renderOrder={-2} visible={false}>
        <planeGeometry args={[CW * 1.7, CH * 1.7]} />
        <primitive object={ripMatB} attach="material" />
      </mesh>
      <points geometry={particles.geo} material={particles.mat} frustumCulled={false} />
      <group ref={beat} name="joker-beat">
        <mesh position={[0, 0, -0.004]} renderOrder={-1}>
          <planeGeometry args={[CW * 2.4, CH * 2.2]} />
          <primitive object={rimMat} ref={rim} attach="material" />
        </mesh>
        {children}
      </group>
    </>
  );
}
