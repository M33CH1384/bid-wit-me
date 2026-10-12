import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, CanvasTexture, ClampToEdgeWrapping, DoubleSide, LinearFilter, Matrix4, MeshBasicMaterial, NormalBlending, Quaternion, ShaderMaterial, SRGBColorSpace, Vector3, type Mesh, type Object3D } from 'three';
import {
  BREATHE_SCALE, GLOW_RENDER_ORDER, GROUP_PAD_PX, GROUP_RADIUS_PX, LIFT_S, OUTLINE_COLOR, SELECT_GLOW_OP, SHINE_PEAK, SHINE_S, SHINE_WIDTH,
  breatheOpacity, easeOut, glowFalloff, glowRadiusPx, liftEase, outlineRadiusPx, shineAxis,
} from './handLift';
import { contoursToTriangles, groupOutline, haloLocal, planePointOk, strokeContour, strokeOutward, unionContours, type Pt } from './playableOutline';

export interface GlowAnchor { name: string; x: number; y: number; selected?: boolean }

interface Props {
  /** Contiguous runs of playable cards, in fan order. Empty fades the highlight out. */
  runs: GlowAnchor[][];
  /** Every face-up card in the hand, so the underglow sits behind the whole fan (16-bit depth on iPhone Safari). */
  handNames: string[];
  quality: 'high' | 'low';
}

/** Card face, not the old enlarged halo. The group padding is applied once around the run. */
const FACE = haloLocal(1, 1);
/** Plane-space distance past which a card is still in flight (deal / play) and the rail stays hidden. */
const FLIGHT = 0.22;
/**
 * Camera-space gap in front of the nearest hand card. The rim is a stroke, not a fill on the faces, so it has to
 * clear the 16-bit depth buffer (iPhone Safari z-fights around 0.0003; the fan itself uses 0.006).
 */
const IN_FRONT = 0.02;
/** White mask of the 18px gaussian. u = 0 is the outline (the peak) and u = 1 is the outer edge. */
function glowAlphaMap(): CanvasTexture {
  const w = 64, h = 4;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(w, h);
  for (let x = 0; x < w; x++) {
    const a = Math.round(255 * glowFalloff(x / (w - 1)));
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = a;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.premultiplyAlpha = false;
  tex.wrapS = ClampToEdgeWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const _v = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _local = new Matrix4();
const _world = new Matrix4();

function findCard(scene: Object3D, cache: Map<string, Object3D>, name: string): Object3D | undefined {
  const hit = cache.get(name);
  if (hit?.parent) return hit;
  const found = scene.getObjectByName(name);
  if (found) cache.set(name, found);
  else cache.delete(name);
  return found ?? undefined;
}

/** Project card-local points onto the depth-1 camera plane. False if the card isn't in front of the camera. */
function projectHalo(card: Object3D, cameraInverse: Matrix4, local: readonly Pt[], out: Pt[]): boolean {
  out.length = 0;
  for (const p of local) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    _v.set(p.x, p.y, 0).applyMatrix4(card.matrixWorld).applyMatrix4(cameraInverse);
    // NaN fails the comparison and used to be divided through, which stretched the stroke over the view.
    if (!Number.isFinite(_v.x) || !Number.isFinite(_v.y) || !Number.isFinite(_v.z) || _v.z >= -0.05) return false;
    const x = _v.x / -_v.z;
    const y = _v.y / -_v.z;
    if (!planePointOk(x, y)) return false;
    out.push({ x, y });
  }
  return true;
}

function place(mesh: Mesh, cameraWorld: Matrix4, planeZ: number) {
  const D = Math.max(0.05, -planeZ);
  _local.compose(_v.set(0, 0, -D), _q.identity(), _s.set(D, D, 1));
  _world.copy(cameraWorld).multiply(_local);
  _world.decompose(mesh.position, mesh.quaternion, mesh.scale);
  // The idle glow breathes in opacity only. BREATHE_SCALE stays 1, so the outline does not pulse.
  mesh.scale.multiplyScalar(BREATHE_SCALE);
}

function writeAttr(geo: BufferGeometry, name: string, src: Float32Array, itemSize: number) {
  const attr = geo.getAttribute(name) as BufferAttribute | undefined;
  if (!attr || attr.itemSize !== itemSize || (attr.array as Float32Array).length < src.length) {
    geo.setAttribute(name, new BufferAttribute(new Float32Array(src), itemSize));
  } else {
    (attr.array as Float32Array).set(src);
    attr.needsUpdate = true;
  }
}

function writeTriangles(geo: BufferGeometry, src: Float32Array) {
  const verts = src.length / 3;
  writeAttr(geo, 'position', src, 3);
  geo.setDrawRange(0, verts);
  geo.computeBoundingSphere();
}

function concatTris(parts: Float32Array[]): Float32Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function emptyGeo(attrs: [string, number][]): BufferGeometry {
  const g = new BufferGeometry();
  for (const [name, itemSize] of attrs) g.setAttribute(name, new BufferAttribute(new Float32Array(itemSize), itemSize));
  g.setDrawRange(0, 0);
  return g;
}

/**
 * One gold rounded rectangle around each contiguous run of playable cards.
 * 2px #F2C14E, 10px corners, 4px outside the faces, and an underglow of
 * `0 0 18px 4px rgba(242,193,78,.4)` that ends about 16px from the cards.
 * Card faces stay at full colour — the glow is behind the fan, and there is no per-card border.
 * A gap (a card you can't play) is its own run, so the outline never bridges it.
 * When the highlight appears, one 650ms shine sweeps the card shapes and does not repeat.
 * Idle, the underglow breathes between 0.3 and 0.5; a selected card's run goes to 0.8. No scale pulse.
 */
export default function PlayableGlow({ runs, handNames, quality }: Props) {
  void quality;
  const { camera, scene, invalidate, size } = useThree();
  const crispRef = useRef<Mesh>(null);
  const bloomRef = useRef<Mesh>(null);
  const shineRef = useRef<Mesh>(null);
  const cache = useRef(new Map<string, Object3D>());
  const op = useRef(0);
  const fade = useRef({ t: 1, from: 0, goal: 0 });
  const boot = useRef(0);
  const sig = useRef('');
  const stamp = useRef('');
  const shaped = useRef(false);
  const breath = useRef(0);
  const shine = useRef<{ phase: 'wait' | 'play' | 'done'; elapsed: number }>({ phase: 'wait', elapsed: 0 });
  const crispGeo = useMemo(() => emptyGeo([['position', 3]]), []);
  const bloomGeo = useMemo(() => emptyGeo([['position', 3], ['uv', 2], ['color', 4]]), []);
  const shineGeo = useMemo(() => emptyGeo([['position', 3], ['aAlong', 1], ['aSpan', 1]]), []);
  const glowMap = useMemo(() => glowAlphaMap(), []);
  const crispMat = useMemo(() => new MeshBasicMaterial({ color: OUTLINE_COLOR, transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false, side: DoubleSide }), []);
  const bloomMat = useMemo(() => new MeshBasicMaterial({
    color: OUTLINE_COLOR, map: glowMap, vertexColors: true, transparent: true, opacity: 0,
    depthWrite: false, depthTest: false, toneMapped: false, side: DoubleSide,
  }), [glowMap]);
  const shineMat = useMemo(() => new ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, toneMapped: false, side: DoubleSide, blending: NormalBlending,
    uniforms: {
      uT: { value: 0 },
      uPeak: { value: SHINE_PEAK },
      uWidth: { value: SHINE_WIDTH },
      uFade: { value: 0 },
    },
    vertexShader: `
      attribute float aAlong;
      attribute float aSpan;
      varying float vAlong;
      varying float vSpan;
      void main() {
        vAlong = aAlong;
        vSpan = aSpan;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uT, uPeak, uWidth, uFade;
      varying float vAlong;
      varying float vSpan;
      void main() {
        if (uFade < 0.001 || vSpan < 1e-5) discard;
        float width = uWidth * vSpan;
        float center = -width + uT * (vSpan + width * 2.0);
        float d = abs(vAlong - center) / max(width * 0.5, 1e-5);
        float a = (d >= 1.0 ? 0.0 : (1.0 - d)) * uPeak * uFade;
        if (a < 0.004) discard;
        gl_FragColor = vec4(1.0, 1.0, 1.0, a);
      }
    `,
  }), []);
  useEffect(() => () => {
    crispGeo.dispose(); bloomGeo.dispose(); shineGeo.dispose();
    crispMat.dispose(); bloomMat.dispose(); shineMat.dispose(); glowMap.dispose();
  }, [crispGeo, bloomGeo, shineGeo, crispMat, bloomMat, shineMat, glowMap]);

  const latest = useRef({ runs, handNames });
  latest.current = { runs, handNames };

  useFrame((_, dt) => {
    const { runs: rs, handNames: names } = latest.current;
    const key = rs.map((r) => r.map((c) => `${c.name}@${c.x.toFixed(3)},${c.y.toFixed(3)}:${c.selected ? 1 : 0}`).join(',')).join('|');
    if (key !== sig.current) { sig.current = key; boot.current = 0; }
    boot.current++;
    const step = Math.min(Math.max(0, dt), 0.05);
    breath.current += step;
    camera.updateMatrixWorld();
    const inv = camera.matrixWorldInverse;
    const axis = shineAxis();

    let settled = rs.length > 0;
    let near = -Infinity;
    let stampNow = '';
    const cam = camera as import('three').PerspectiveCamera;
    const viewH = 2 * Math.tan(((cam.fov ?? 50) * Math.PI) / 360);
    const px = viewH / Math.max(1, size.height);
    const crispParts: Float32Array[] = [];
    const bloomPos: Float32Array[] = [];
    const bloomUv: Float32Array[] = [];
    const bloomColor: Float32Array[] = [];
    const shinePos: Float32Array[] = [];
    const shineAlong: Float32Array[] = [];
    const shineSpan: Float32Array[] = [];
    let glowPeak = 0;
    for (const run of rs) {
      const faces: Pt[][] = [];
      let runSelected = false;
      for (const anchor of run) {
        if (anchor.selected) runSelected = true;
        const card = findCard(scene, cache.current, anchor.name);
        if (!card) { settled = false; continue; }
        card.updateWorldMatrix(true, false);
        _v.set(0, 0, 0).applyMatrix4(card.matrixWorld).applyMatrix4(inv);
        stampNow += `${_v.x.toFixed(3)},${_v.y.toFixed(3)},${_v.z.toFixed(3)};`;
        if (Number.isFinite(_v.z) && _v.z > near) near = _v.z;
        if (!Number.isFinite(_v.z) || _v.z >= -0.05 || !planePointOk(_v.x / -_v.z, _v.y / -_v.z) || Math.hypot(_v.x / -_v.z - anchor.x, _v.y / -_v.z - anchor.y) > FLIGHT) settled = false;
        const face: Pt[] = [];
        if (!projectHalo(card, inv, FACE, face)) { settled = false; continue; }
        faces.push(face);
      }
      const rect = groupOutline(faces, GROUP_PAD_PX * px, GROUP_RADIUS_PX * px);
      if (!rect) continue;
      const glow = runSelected ? SELECT_GLOW_OP : breatheOpacity(breath.current);
      if (glow > glowPeak) glowPeak = glow;
      // One convex outline per run. The scalloped per-card halo is what threw the rays.
      for (const contour of unionContours([rect], 80)) {
        crispParts.push(strokeContour(contour, outlineRadiusPx() * px));
        // Outside the path only, so drawing above the neighbours does not tint the faces.
        const ribbon = strokeOutward(contour, glowRadiusPx() * px);
        bloomPos.push(ribbon.pos);
        bloomUv.push(ribbon.uv);
        const colors = new Float32Array((ribbon.pos.length / 3) * 4);
        for (let i = 0; i < colors.length; i += 4) {
          colors[i] = 1; colors[i + 1] = 1; colors[i + 2] = 1; colors[i + 3] = glow;
        }
        bloomColor.push(colors);
      }
      // Shine is the card faces only, so it never paints the padding or a gap.
      let minA = Infinity, maxA = -Infinity;
      for (const poly of faces) for (const p of poly) {
        const d = p.x * axis.x + p.y * axis.y;
        if (d < minA) minA = d;
        if (d > maxA) maxA = d;
      }
      const span = Math.max(0, maxA - minA);
      const filled = contoursToTriangles(unionContours(faces, 28));
      if (!filled.length || !(span > 0)) continue;
      shinePos.push(filled);
      const n = filled.length / 3;
      const along = new Float32Array(n);
      const spans = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        along[i] = filled[i * 3]! * axis.x + filled[i * 3 + 1]! * axis.y - minA;
        spans[i] = span;
      }
      shineAlong.push(along);
      shineSpan.push(spans);
    }
    for (const name of names) {
      const card = findCard(scene, cache.current, name);
      if (!card) continue;
      card.updateWorldMatrix(true, false);
      _v.set(0, 0, 0).applyMatrix4(card.matrixWorld).applyMatrix4(inv);
      if (_v.z > near) near = _v.z;
    }
    const crispTris = concatTris(crispParts);
    const bloomTris = concatTris(bloomPos);
    const bloomUvs = concatTris(bloomUv);
    const bloomCols = concatTris(bloomColor);
    const shineTris = concatTris(shinePos);
    const alongAttr = concatTris(shineAlong);
    const spanAttr = concatTris(shineSpan);
    if (crispTris.length) {
      writeTriangles(crispGeo, crispTris);
      writeTriangles(bloomGeo, bloomTris);
      writeAttr(bloomGeo, 'uv', bloomUvs, 2);
      writeAttr(bloomGeo, 'color', bloomCols, 4);
      shaped.current = true;
      const planeZ = (Number.isFinite(near) ? near : -1) + IN_FRONT;
      const crisp = crispRef.current, bloom = bloomRef.current;
      if (crisp) place(crisp, camera.matrixWorld, planeZ);
      // Just under the stroke, and above the neighbouring cards (depthTest is off; the ribbon stays outside the faces).
      if (bloom) place(bloom, camera.matrixWorld, planeZ - 0.004);
    }
    if (shineTris.length) {
      writeTriangles(shineGeo, shineTris);
      writeAttr(shineGeo, 'aAlong', alongAttr, 1);
      writeAttr(shineGeo, 'aSpan', spanAttr, 1);
      const shineMesh = shineRef.current;
      if (shineMesh && Number.isFinite(near)) place(shineMesh, camera.matrixWorld, near + IN_FRONT - 0.002);
    }

    const sh = shine.current;
    if (rs.length === 0) {
      sh.phase = 'wait';
      sh.elapsed = 0;
    } else if (sh.phase === 'wait' && settled && crispTris.length > 0) {
      sh.phase = 'play';
      sh.elapsed = 0;
    } else if (sh.phase === 'play') {
      sh.elapsed += step;
      if (sh.elapsed >= SHINE_S) sh.phase = 'done';
    }
    const playing = sh.phase === 'play';
    const shineT = playing ? easeOut(Math.min(1, sh.elapsed / SHINE_S)) : 0;
    shineMat.uniforms.uT!.value = shineT;
    shineMat.uniforms.uFade!.value = playing ? 1 : 0;

    const goal = settled && crispTris.length ? 1 : 0;
    const f = fade.current;
    if (goal !== f.goal) { f.from = op.current; f.goal = goal; f.t = 0; }
    if (f.t < 1) {
      f.t = Math.min(1, f.t + step / LIFT_S);
      op.current = f.from + (f.goal - f.from) * liftEase(f.t);
    } else op.current = f.goal;
    crispMat.opacity = op.current;
    // Vertex alpha carries the breath (0.3–0.5) or the selected 0.8. This fade is only the turn-in.
    bloomMat.opacity = op.current;
    const show = shaped.current && op.current > 0.01;
    if (crispRef.current) crispRef.current.visible = show;
    if (bloomRef.current) bloomRef.current.visible = show;
    if (shineRef.current) shineRef.current.visible = show && playing && shineTris.length > 0;
    (window as unknown as { __bwmGlow?: { opacity: number; runs: number; settled: boolean; shine: string; glow: number } }).__bwmGlow = {
      opacity: op.current, runs: rs.length, settled, shine: sh.phase, glow: glowPeak,
    };
    const moved = stampNow !== stamp.current;
    stamp.current = stampNow;
    if (show || playing || (sh.phase === 'wait' && rs.length > 0) || Math.abs(op.current - goal) > 0.01 || boot.current < 6 || moved) invalidate();
  });

  return (
    <>
      {/* The ribbon and the shine sit in front of the faces. They must not take the tap. */}
      <mesh ref={bloomRef} geometry={bloomGeo} material={bloomMat} renderOrder={GLOW_RENDER_ORDER} frustumCulled={false} visible={false} raycast={() => null} />
      <mesh ref={shineRef} geometry={shineGeo} material={shineMat} renderOrder={GLOW_RENDER_ORDER + 1} frustumCulled={false} visible={false} raycast={() => null} />
      <mesh ref={crispRef} geometry={crispGeo} material={crispMat} renderOrder={GLOW_RENDER_ORDER + 2} frustumCulled={false} visible={false} raycast={() => null} />
    </>
  );
}
