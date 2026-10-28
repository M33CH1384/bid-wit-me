/**
 * THE WHEELS CAR, IN THE SCENE — the 3D rebuild (owner verdict on the 2D sprite
 * show, 2026-10-28: "That car animation looks terrible honestly" → "Rebuild it as
 * a real 3D car"). The glossy purple-and-gold supercar is a real Forge body
 * (TRELLIS, three.ws — vehicle bodywork is the proven Forge-mix class: code can't
 * carry bodywork, the Pj's sedan precedent) driving ON the felt at High quality:
 * it swings in under the revs, lays ~1¾ powerslide doughnuts around the trick
 * centre trailing tyre smoke from its rear wheels and dark arcs on the cloth,
 * then peels off the right edge. Pure poses live in wheelsCar3d.ts.
 *
 * The summons is unchanged (`wheelsCar` on the fx bus — a side took all 10
 * books); the DOM celebration (WheelsCar.tsx) keeps the banner, the timing and
 * the hand-end hold in every quality path. This component is purely the visual:
 * at Low quality there is no 3D show (banner + audio only, the venue-room
 * precedent — 3D lives at High), and under Reduce effects or OS reduce-motion
 * it likewise stays parked. If a nuke/mega detonates mid-show the blast takes
 * the car in 3D too (wheelsCarBlastPoseAt, hooked on the same fx event — the
 * nuke system itself is untouched). Tap the car (or the banner) to skip.
 *
 * Mounted by Scene's AfterTable from the lazy three chunk beside Nuke3D, so it
 * loads after the felt is up: mounting IS the preload — the GLB parses quietly
 * behind Suspense while the table plays, and the summon never hitches. The
 * model is one fused TRELLIS mesh (no separate wheel meshes), so the wheels
 * cannot steer or spin independently — the powerslide is read from the body's
 * yaw, slip and lean instead.
 */
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import {
  AdditiveBlending, Box3, BufferGeometry, CanvasTexture, Float32BufferAttribute, Group, MeshBasicMaterial,
  NormalBlending, ShaderMaterial, Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { fx } from '../fx';
import { wheelsBlastReaction } from '../wheelsDonuts';
import {
  WHEELS3D_DONUT_END_S, WHEELS3D_FLASH_S, WHEELS3D_SHOW_S, WHEELS_CAR_LEN,
  wheelPoints3d, wheelsCarBlastLen, wheelsCarBlastPoseAt, wheelsPose3dAt, type WheelsPose3d,
} from './wheelsCar3d';

export const WHEELS_CAR_URL = '/assets/cars/wheels-supercar.glb';
/** Baked from look-at renders of the raw Forge mesh: its nose is local +Z, so a
 *  quarter turn puts it on this scene's forward (+X). */
const MODEL_YAW = Math.PI / 2;
/** Car footprint after normalization (from the raw bbox proportions). */
const CAR_DIMS = { len: WHEELS_CAR_LEN, wid: WHEELS_CAR_LEN * (0.487 / 0.999) };

interface WheelsProbe {
  loaded: boolean;
  phase: string;
  x: number; y: number; z: number; yaw: number;
  blasted: boolean;
  smoke: number;
  debugBlast: (mega: boolean) => void;
}

function probe(): WheelsProbe {
  const w = window as unknown as { __bwmWheels3D?: WheelsProbe };
  if (!w.__bwmWheels3D) {
    w.__bwmWheels3D = { loaded: false, phase: 'idle', x: 0, y: 0, z: 0, yaw: 0, blasted: false, smoke: 0, debugBlast: () => {} };
  }
  return w.__bwmWheels3D;
}

/* A failed car must never take the table down with it: fail closed, banner only. */
class WheelsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() { return this.state.failed ? null : this.props.children; }
}

/** Soft radial sprite (smoke puffs + headlight glow share it). */
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

function WheelsCarRig() {
  const gltf = useLoader(GLTFLoader, WHEELS_CAR_URL);
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera);
  const outer = useRef<Group>(null);
  const inner = useRef<Group>(null);
  const [show, setShow] = useState<{ id: number; at: number } | null>(null);
  const showRef = useRef<{ id: number; at: number } | null>(null);
  const blastRef = useRef<{ atShowT: number; mega: boolean; calm: boolean } | null>(null);

  const model = useMemo(() => {
    const o = gltf.scene.clone(true) as Group;
    o.updateMatrixWorld(true);
    const box0 = new Box3().setFromObject(o);
    const size0 = box0.getSize(new Vector3());
    const longest = Math.max(size0.x, size0.z);
    if (longest > 0) o.scale.setScalar(WHEELS_CAR_LEN / longest);
    o.rotation.y = MODEL_YAW;
    o.updateMatrixWorld(true);
    const box = new Box3().setFromObject(o);
    const c = box.getCenter(new Vector3());
    o.position.set(-c.x, -box.min.y, -c.z);
    o.traverse((n) => {
      const mesh = n as { isMesh?: boolean; castShadow?: boolean };
      if (mesh.isMesh) mesh.castShadow = true;
    });
    return o;
  }, [gltf]);

  /* ---- smoke pool (one Points draw) ---- */
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

  /* ---- donut arcs (ribbon strips on the felt, rebuilt from the path) ---- */
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

  /* ---- the summons + the blast seam (the same fx events everything else keys off) ---- */
  useEffect(() => {
    const p = probe();
    p.loaded = true;
    p.debugBlast = (mega: boolean) => {
      const s = showRef.current;
      if (!s) return;
      const seek = (window as unknown as { __bwmWheelsSeek?: number | null }).__bwmWheelsSeek;
      const t = typeof seek === 'number' ? seek : (performance.now() - s.at) / 1000;
      blastRef.current = { atShowT: t, mega, calm: fx.osReducedMotion };
    };
    (window as unknown as { __bwmWheelsSkip?: () => void }).__bwmWheelsSkip = () => {
      showRef.current = null;
      blastRef.current = null;
      setShow(null);
    };
    const off = fx.on((e) => {
      if (e.kind === 'wheelsCar') {
        // Reduce effects / OS reduce-motion: banner + audio only, the car stays parked.
        if (fx.reduced || fx.osReducedMotion) return;
        blastRef.current = null;
        arcs.pathL.length = 0;
        arcs.pathR.length = 0;
        showRef.current = { id: e.id, at: performance.now() };
        setShow(showRef.current);
        invalidate();
      } else if (e.kind === 'nuke' || e.kind === 'mega') {
        const s = showRef.current;
        if (!s || blastRef.current) return;
        if (wheelsBlastReaction(e.kind, fx.nukeMode) === 'none') return;
        blastRef.current = { atShowT: (performance.now() - s.at) / 1000, mega: e.kind === 'mega', calm: fx.osReducedMotion };
        invalidate();
      }
    });
    return () => { off(); p.loaded = false; };
  }, [arcs, invalidate]);

  /* frameloop is 'demand': keep frames coming while the show runs */
  useEffect(() => {
    if (!show) return;
    const id = window.setInterval(() => invalidate(), 40);
    return () => clearInterval(id);
  }, [show, invalidate]);

  useFrame((_, delta) => {
    const grp = outer.current;
    const p = probe();
    const s = showRef.current;
    if (!grp) return;
    if (!s) {
      grp.visible = false;
      p.phase = 'idle';
      return;
    }
    const seek = (window as unknown as { __bwmWheelsSeek?: number | null }).__bwmWheelsSeek;
    const t = typeof seek === 'number' ? seek : (performance.now() - s.at) / 1000;
    const blast = blastRef.current;
    let pose: WheelsPose3d = wheelsPose3dAt(Math.min(t, WHEELS3D_SHOW_S));
    let swept = false;
    let done = false;
    if (blast) {
      const u = t - blast.atShowT - WHEELS3D_FLASH_S;
      if (u >= 0) {
        swept = true;
        const flashPose = wheelsPose3dAt(Math.min(blast.atShowT + WHEELS3D_FLASH_S, WHEELS3D_SHOW_S));
        const bp = wheelsCarBlastPoseAt(u, flashPose, blast);
        if (bp) {
          grp.position.set(flashPose.x + bp.off[0], bp.off[1], flashPose.z + bp.off[2]);
          grp.rotation.order = 'YXZ';
          grp.rotation.set(bp.rot[0], bp.rot[1], bp.rot[2]);
          grp.visible = bp.visible;
          if (inner.current) inner.current.rotation.set(0, 0, 0);
          p.phase = 'swept';
          p.x = grp.position.x; p.y = grp.position.y; p.z = grp.position.z; p.yaw = bp.rot[1];
          p.blasted = true;
          if (u > wheelsCarBlastLen(blast.mega, blast.calm) + 0.05) done = true;
        }
      }
    }
    if (!swept) {
      grp.position.set(pose.x, pose.y, pose.z);
      grp.rotation.order = 'XYZ';
      grp.rotation.set(0, pose.yaw, 0);
      grp.visible = pose.phase !== 'gone';
      if (inner.current) inner.current.rotation.set(pose.roll, 0, pose.pitch);
      p.phase = pose.phase;
      p.x = pose.x; p.y = pose.y; p.z = pose.z; p.yaw = pose.yaw;
      p.blasted = false;
      if (t > WHEELS3D_SHOW_S && !blast) {
        // the car has left; the arcs linger a beat, then everything clears
        if (t > WHEELS3D_SHOW_S + 0.9) done = true;
      }
      if (t > WHEELS3D_SHOW_S && blast) {
        // a blast stamped after the car left still counts down from its flash
        if (t - blast.atShowT - WHEELS3D_FLASH_S > wheelsCarBlastLen(blast.mega, blast.calm) + 0.05) done = true;
      }
    }

    /* ---- smoke + arcs, keyed off the rear wheels ---- */
    const dt = Math.min(0.05, delta || 0.016);
    const wheels = wheelPoints3d(pose, CAR_DIMS);
    const driving = !swept && (pose.phase === 'donuts' || pose.phase === 'exit');
    if (!swept && pose.phase === 'enter' && Math.sin(t * 18) > 0.6) {
      // exhaust puffs pulsing with the revs, off the rear bumper
      smoke.acc += dt * 26;
    } else if (driving) {
      smoke.acc += dt * 95;
    } else if (swept) {
      smoke.acc += dt * 30; // a thinning airborne trail
    }
    while (smoke.acc >= 1) {
      smoke.acc -= 1;
      if (smoke.puffs.length >= SMOKE_MAX) break;
      const rear = Math.random() < 0.5 ? wheels.rearL : wheels.rearR;
      const ox = pose.x - 0, oz = pose.z - (-0.15);
      const ol = Math.hypot(ox, oz) || 1;
      if (!swept && pose.phase === 'enter') {
        smoke.puffs.push({ x: rear[0], y: 0.06, z: rear[1], vx: -Math.cos(pose.yaw) * 0.3, vy: 0.22 + Math.random() * 0.2, vz: Math.sin(pose.yaw) * 0.3, life: 0, max: 0.7 + Math.random() * 0.5, size: 0.07 });
      } else if (driving) {
        smoke.puffs.push({
          x: rear[0] + (Math.random() - 0.5) * 0.05, y: 0.05, z: rear[1] + (Math.random() - 0.5) * 0.05,
          vx: (ox / ol) * (0.3 + Math.random() * 0.45) + (Math.random() - 0.5) * 0.15, vy: 0.28 + Math.random() * 0.3, vz: (oz / ol) * (0.3 + Math.random() * 0.45) + (Math.random() - 0.5) * 0.15,
          life: 0, max: 0.9 + Math.random() * 0.8, size: 0.09 + Math.random() * 0.05,
        });
      } else if (swept) {
        smoke.puffs.push({ x: grp.position.x + (Math.random() - 0.5) * 0.5, y: grp.position.y + 0.1, z: grp.position.z + (Math.random() - 0.5) * 0.3, vx: (Math.random() - 0.5) * 0.2, vy: 0.1, vz: (Math.random() - 0.5) * 0.2, life: 0, max: 0.7, size: 0.1 });
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
    const fov = (camera as { fov?: number }).fov ?? 55;
    smoke.mat.uniforms.uScale!.value = ((size.height * (window.devicePixelRatio || 1)) / (2 * Math.tan((fov * Math.PI) / 360)));
    p.smoke = n;

    /* arcs: append the rear-wheel path while driving, fade after the show */
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
    arcs.mat.opacity = blast || t > WHEELS3D_DONUT_END_S
      ? Math.max(0, 0.52 - Math.max(0, t - (blast ? blast.atShowT + WHEELS3D_FLASH_S : WHEELS3D_SHOW_S)) * 0.45)
      : 0.52;

    if (done) {
      showRef.current = null;
      blastRef.current = null;
      arcs.pathL.length = 0;
      arcs.pathR.length = 0;
      grp.visible = false;
      p.phase = 'gone';
      setShow(null);
    }
  });

  return (
    <>
      <group ref={outer} visible={false} onClick={() => { showRef.current = null; blastRef.current = null; setShow(null); }}>
        <group ref={inner}>
          <primitive object={model} />
          {/* headlights: lit discs + glow at the nose (the model's own lamps are texture) */}
          {([-1, 1] as const).map((s) => (
            <group key={s} position={[CAR_DIMS.len / 2 + 0.002, 0.095, s * CAR_DIMS.wid * 0.31]} rotation={[0, Math.PI / 2, 0]}>
              <mesh>
                <circleGeometry args={[0.02, 12]} />
                <meshBasicMaterial color={0xffedb5} />
              </mesh>
              <mesh position={[0, 0, 0.012]}>
                <planeGeometry args={[0.13, 0.13]} />
                <meshBasicMaterial map={smoke.tex} color={0xffdf94} transparent opacity={0.5} blending={AdditiveBlending} depthWrite={false} />
              </mesh>
            </group>
          ))}
        </group>
      </group>
      <points geometry={smoke.geo} material={smoke.mat} frustumCulled={false} />
      <mesh geometry={arcs.geo} material={arcs.mat} frustumCulled={false} />
    </>
  );
}

export default function WheelsCar3D({ quality }: { quality: 'high' | 'low' }) {
  if (quality !== 'high') return null;
  return (
    <WheelsBoundary>
      <Suspense fallback={null}>
        <WheelsCarRig />
      </Suspense>
    </WheelsBoundary>
  );
}
