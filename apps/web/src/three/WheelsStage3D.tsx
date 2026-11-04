/**
 * THE WHEELS CAR ON THE RESULTS PAGE — a small stage of its own.
 *
 * Why this exists: the car's only render home used to be the table Scene's
 * canvas, and the results surfaces (the online victory screen, the offline
 * game-over sheet) are fixed overlays that paint OVER that canvas — so when
 * the game-ending hand earned Wheels, the peel-out played (the fx bus plays
 * the sound itself) and the car did its doughnuts invisibly underneath.
 * The owner heard it and never saw it (2026-11-04). The house rule from
 * the victory-confetti fix applies: a result celebration is mounted on the
 * PRESENTING surface and starts its clock at presentation.
 *
 * Same car (the shared GLB, normalised by wheelsCarModel), same pure
 * poses (wheelsCar3d.ts), same smoke and felt-arc recipe as the table
 * rig — minus the blast path: nothing detonates on a results page.
 * Mounted lazily by WheelsResults (three.js stays out of the entry
 * graph, the AfterTable pattern), at High quality only; the banner +
 * sound are the calm path everywhere else.
 */
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import {
  BufferGeometry, CanvasTexture, Float32BufferAttribute, Group, MeshBasicMaterial,
  NormalBlending, ShaderMaterial, Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  WHEELS3D_DONUT_END_S, WHEELS3D_SHOW_S,
  wheelPoints3d, wheelsPose3dAt, type WheelsPose3d,
} from './wheelsCar3d';
import { WHEELS_CAR_DIMS, WHEELS_CAR_URL, normalizeWheelsCar } from './wheelsCarModel';

interface StageProbe { t: number; phase: string; smoke: number }
function probe(): StageProbe {
  const w = window as unknown as { __bwmWheelsStage?: StageProbe };
  if (!w.__bwmWheelsStage) w.__bwmWheelsStage = { t: 0, phase: 'idle', smoke: 0 };
  return w.__bwmWheelsStage;
}

function radialTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.38)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

const SMOKE_MAX = 96;
interface Puff { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number }

const SMOKE_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const SMOKE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(uColor, tex.a * vAlpha);
  }
`;

function StageRig({ neon, onDone }: { neon: boolean; onDone: () => void }) {
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera);
  const outer = useRef<Group>(null);
  const inner = useRef<Group>(null);
  const startRef = useRef<number | null>(null);
  const doneRef = useRef(false);
  const skipRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  /* The same GLB the table rig mounts — by results time it sits in the
   * loader and HTTP caches, so the stage adds no fetch of consequence. */
  const gltf = useLoader(GLTFLoader, WHEELS_CAR_URL);
  const model = useMemo(() => normalizeWheelsCar(gltf.scene), [gltf]);

  const smoke = useMemo(() => {
    const geo = new BufferGeometry();
    const pos = new Float32Array(SMOKE_MAX * 3);
    const aSize = new Float32Array(SMOKE_MAX);
    const aAlpha = new Float32Array(SMOKE_MAX);
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new Float32BufferAttribute(aSize, 1));
    geo.setAttribute('aAlpha', new Float32BufferAttribute(aAlpha, 1));
    geo.setDrawRange(0, 0);
    const tex = radialTexture();
    const mat = new ShaderMaterial({
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      uniforms: { uMap: { value: tex }, uColor: { value: new Vector3(0.87, 0.84, 0.93) }, uScale: { value: 600 } },
      transparent: true, depthWrite: false, blending: NormalBlending,
    });
    return { geo, mat, tex, pos, aSize, aAlpha, puffs: [] as Puff[], acc: 0 };
  }, []);
  useEffect(() => () => { smoke.tex.dispose(); smoke.geo.dispose(); smoke.mat.dispose(); }, [smoke]);

  const arcs = useMemo(() => {
    const geo = new BufferGeometry();
    const maxVerts = 220 * 2 * 6;
    const pos = new Float32Array(maxVerts * 3);
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setDrawRange(0, 0);
    const mat = new MeshBasicMaterial({ color: 0x0a0612, transparent: true, opacity: 0.52, depthWrite: false });
    return { geo, mat, pos, pathL: [] as [number, number][], pathR: [] as [number, number][] };
  }, []);
  useEffect(() => () => { arcs.geo.dispose(); arcs.mat.dispose(); }, [arcs]);

  /* The clock starts at presentation (mount). The banner's tap-to-skip
   * calls the same window seam the table rig registers — take it while
   * the stage is up, hand it back on the way out. */
  useEffect(() => {
    const w = window as unknown as { __bwmWheelsSkip?: () => void };
    const prev = w.__bwmWheelsSkip;
    w.__bwmWheelsSkip = () => { skipRef.current = true; invalidate(); };
    const id = window.setInterval(() => invalidate(), 1000 / 30);
    return () => {
      window.clearInterval(id);
      if (w.__bwmWheelsSkip && prev) w.__bwmWheelsSkip = prev;
      else delete w.__bwmWheelsSkip;
    };
  }, [invalidate]);

  useFrame((_, delta) => {
    const grp = outer.current;
    if (!grp) return;
    if (startRef.current === null) startRef.current = performance.now();
    const seek = (window as unknown as { __bwmWheelsSeek?: number | null }).__bwmWheelsSeek;
    const t = typeof seek === 'number' ? seek : (performance.now() - startRef.current) / 1000;
    const p = probe();
    p.t = t;
    if (skipRef.current || t > WHEELS3D_SHOW_S + 0.9) {
      grp.visible = false;
      p.phase = 'gone';
      if (!doneRef.current) { doneRef.current = true; onDoneRef.current(); }
      return;
    }
    const pose: WheelsPose3d = wheelsPose3dAt(Math.min(t, WHEELS3D_SHOW_S));
    grp.position.set(pose.x, pose.y, pose.z);
    grp.rotation.order = 'XYZ';
    grp.rotation.set(0, pose.yaw, 0);
    grp.visible = pose.phase !== 'gone';
    if (inner.current) inner.current.rotation.set(pose.roll, 0, pose.pitch);
    p.phase = pose.phase;

    const dt = Math.min(0.05, delta || 0.016);
    const wheels = wheelPoints3d(pose, WHEELS_CAR_DIMS);
    const driving = pose.phase === 'donuts' || pose.phase === 'exit';
    if (pose.phase === 'enter' && Math.sin(t * 18) > 0.6) smoke.acc += dt * 26;
    else if (driving) smoke.acc += dt * 95;
    while (smoke.acc >= 1) {
      smoke.acc -= 1;
      if (smoke.puffs.length >= SMOKE_MAX) break;
      const rear = Math.random() < 0.5 ? wheels.rearL : wheels.rearR;
      const ox = pose.x - 0, oz = pose.z - (-0.15);
      const ol = Math.hypot(ox, oz) || 1;
      if (pose.phase === 'enter') {
        smoke.puffs.push({ x: rear[0], y: 0.06, z: rear[1], vx: -Math.cos(pose.yaw) * 0.3, vy: 0.22 + Math.random() * 0.2, vz: Math.sin(pose.yaw) * 0.3, life: 0, max: 0.7 + Math.random() * 0.5, size: 0.07 });
      } else if (driving) {
        smoke.puffs.push({
          x: rear[0] + (Math.random() - 0.5) * 0.05, y: 0.05, z: rear[1] + (Math.random() - 0.5) * 0.05,
          vx: (ox / ol) * (0.3 + Math.random() * 0.45) + (Math.random() - 0.5) * 0.15, vy: 0.28 + Math.random() * 0.3, vz: (oz / ol) * (0.3 + Math.random() * 0.45) + (Math.random() - 0.5) * 0.15,
          life: 0, max: 0.9 + Math.random() * 0.8, size: 0.09 + Math.random() * 0.05,
        });
      }
    }
    for (let i = smoke.puffs.length - 1; i >= 0; i--) {
      const pf = smoke.puffs[i]!;
      pf.life += dt;
      if (pf.life > pf.max) { smoke.puffs.splice(i, 1); continue; }
      pf.x += pf.vx * dt; pf.y += pf.vy * dt; pf.z += pf.vz * dt;
      pf.vx *= 0.97; pf.vz *= 0.97; pf.vy *= 0.98;
    }
    const n = smoke.puffs.length;
    for (let i = 0; i < n; i++) {
      const pf = smoke.puffs[i]!;
      smoke.pos[i * 3] = pf.x; smoke.pos[i * 3 + 1] = pf.y; smoke.pos[i * 3 + 2] = pf.z;
      const k = pf.life / pf.max;
      smoke.aSize[i] = pf.size + k * 0.5;
      smoke.aAlpha[i] = 0.4 * (1 - k) * Math.min(1, pf.life * 9);
    }
    smoke.geo.setDrawRange(0, n);
    (smoke.geo.getAttribute('position') as { needsUpdate: boolean }).needsUpdate = true;
    (smoke.geo.getAttribute('aSize') as { needsUpdate: boolean }).needsUpdate = true;
    (smoke.geo.getAttribute('aAlpha') as { needsUpdate: boolean }).needsUpdate = true;
    const fov = (camera as { fov?: number }).fov ?? 38;
    smoke.mat.uniforms.uScale!.value = ((size.height * (window.devicePixelRatio || 1)) / (2 * Math.tan((fov * Math.PI) / 360)));
    p.smoke = n;

    if (driving) {
      const push = (path: [number, number][], pt: [number, number]) => {
        const last = path[path.length - 1];
        if (!last || Math.hypot(pt[0] - last[0], pt[1] - last[1]) > 0.012) path.push(pt);
        if (path.length > 220) path.shift();
      };
      push(arcs.pathL, wheels.rearL);
      push(arcs.pathR, wheels.rearR);
    }
    let vi = 0;
    const strip = (path: [number, number][]) => {
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!, b = path[i]!;
        let dx = b[0] - a[0], dz = b[1] - a[1];
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl; dz /= dl;
        const px = -dz * 0.034, pz = dx * 0.034;
        const quadPts: [number, number][] = [
          [a[0] + px, a[1] + pz], [a[0] - px, a[1] - pz], [b[0] + px, b[1] + pz],
          [a[0] - px, a[1] - pz], [b[0] - px, b[1] - pz], [b[0] + px, b[1] + pz],
        ];
        for (const q of quadPts) {
          if (vi * 3 + 2 >= arcs.pos.length) break;
          arcs.pos[vi * 3] = q[0]; arcs.pos[vi * 3 + 1] = 0.004; arcs.pos[vi * 3 + 2] = q[1];
          vi++;
        }
      }
    };
    strip(arcs.pathL);
    strip(arcs.pathR);
    arcs.geo.setDrawRange(0, vi);
    (arcs.geo.getAttribute('position') as { needsUpdate: boolean }).needsUpdate = true;
    arcs.mat.opacity = t > WHEELS3D_DONUT_END_S
      ? Math.max(0, 0.52 - Math.max(0, t - WHEELS3D_SHOW_S) * 0.45)
      : 0.52;
  });

  const felt = neon ? '#2a1a44' : '#1e6b41';
  const rim = neon ? '#17102a' : '#3a2417';
  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[2.5, 4, 2]} intensity={1.7} castShadow shadow-mapSize={[512, 512]} shadow-camera-left={-2} shadow-camera-right={2} shadow-camera-top={2} shadow-camera-bottom={-2} />
      <directionalLight position={[-3, 2, -2]} intensity={0.5} color={neon ? 0xb9a7ff : 0xffd9a8} />
      {/* the mini-table: a felt disc with a rim ring, sized to the doughnut */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.012, 0]} scale={[1.3, 1.41, 1]} receiveShadow>
        <circleGeometry args={[1, 48]} />
        <meshStandardMaterial color={rim} roughness={0.85} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} scale={[1.24, 1.34, 1]} receiveShadow>
        <circleGeometry args={[1, 48]} />
        <meshStandardMaterial color={felt} roughness={0.95} />
      </mesh>
      <group ref={outer} visible={false} onClick={() => { skipRef.current = true; }}>
        <group ref={inner}>
          <primitive object={model} />
        </group>
      </group>
      <points geometry={smoke.geo} material={smoke.mat} frustumCulled={false} />
      <mesh geometry={arcs.geo} material={arcs.mat} frustumCulled={false} />
    </>
  );
}

export function WheelsStage3D({ neon, onDone }: { neon: boolean; onDone: () => void }) {
  return (
    <Canvas
      frameloop="demand"
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', toneMappingExposure: 1.05 }}
      camera={{ fov: 38, near: 0.05, far: 30, position: [0, 2.2, 3.0] }}
      onCreated={({ camera }) => camera.lookAt(0, 0, -0.05)}
    >
      <Suspense fallback={null}>
        <StageRig neon={neon} onDone={onDone} />
      </Suspense>
    </Canvas>
  );
}
