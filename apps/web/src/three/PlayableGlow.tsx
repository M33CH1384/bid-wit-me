import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, CanvasTexture, ClampToEdgeWrapping, DoubleSide, LinearFilter, Matrix4, MeshBasicMaterial, Quaternion, SRGBColorSpace, Vector3, type Mesh, type Object3D } from 'three';
import { GLOW_ALPHA, LIFT_S, OUTLINE_COLOR, glowFalloff, glowRadiusPx, liftEase, outlineRadiusPx } from './handLift';
import { HALO_SX, HALO_SY, haloLocal, smoothContour, strokeContour, strokeRibbon, unionContours, type Pt } from './playableOutline';

export interface GlowAnchor { name: string; x: number; y: number }

interface Props {
  /** Contiguous runs of playable cards, in fan order. Empty fades the highlight out. */
  runs: GlowAnchor[][];
  /** Every face-up card in the hand, so the rail sits behind the whole fan (16-bit depth on iPhone Safari). */
  handNames: string[];
  quality: 'high' | 'low';
}

const HALO = haloLocal(HALO_SX, HALO_SY);
/** Plane-space distance past which a card is still in flight (deal / play) and the rail stays hidden. */
const FLIGHT = 0.22;
/**
 * Camera-space gap in front of the nearest hand card. The rim is a stroke, not a fill behind the faces, so it has to
 * clear the 16-bit depth buffer (iPhone Safari z-fights around 0.0003; the fan itself uses 0.006).
 */
const IN_FRONT = 0.02;
/** White mask of the 16px gaussian, sampled across the ribbon (u = 0 inside, 1 outside). The material tints it gold. */
function glowAlphaMap(): CanvasTexture {
  const w = 64, h = 4;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(w, h);
  for (let x = 0; x < w; x++) {
    // u = 0 is the inside edge and u = 1 the outside; the outline (and the blur's peak) is the centre of the ribbon.
    const fromCenter = Math.abs(x / (w - 1) - 0.5) * 2;
    const a = Math.round(255 * glowFalloff(fromCenter));
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

/** Project card-local halo points onto the depth-1 camera plane. False if the card isn't in front of the camera. */
function projectHalo(card: Object3D, cameraInverse: Matrix4, local: readonly Pt[], out: Pt[]): boolean {
  out.length = 0;
  for (const p of local) {
    _v.set(p.x, p.y, 0).applyMatrix4(card.matrixWorld).applyMatrix4(cameraInverse);
    if (_v.z >= -0.05) return false;
    out.push({ x: _v.x / -_v.z, y: _v.y / -_v.z });
  }
  return true;
}

function place(mesh: Mesh, cameraWorld: Matrix4, planeZ: number) {
  const D = Math.max(0.05, -planeZ);
  _local.compose(_v.set(0, 0, -D), _q.identity(), _s.set(D, D, 1));
  _world.copy(cameraWorld).multiply(_local);
  _world.decompose(mesh.position, mesh.quaternion, mesh.scale);
}

function writeUv(geo: BufferGeometry, src: Float32Array) {
  const attr = geo.getAttribute('uv') as BufferAttribute | undefined;
  if (!attr || (attr.array as Float32Array).length < src.length) {
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(src), 2));
  } else {
    (attr.array as Float32Array).set(src);
    attr.needsUpdate = true;
  }
}

function writeTriangles(geo: BufferGeometry, src: Float32Array) {
  const verts = src.length / 3;
  const attr = geo.getAttribute('position') as BufferAttribute | undefined;
  if (!attr || (attr.array as Float32Array).length < src.length) {
    geo.setAttribute('position', new BufferAttribute(new Float32Array(src), 3));
  } else {
    (attr.array as Float32Array).set(src);
    attr.needsUpdate = true;
  }
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

/**
 * One gold outline around each contiguous run of playable cards: a 2px #F2C14E stroke plus a 16px glow at 45%.
 * No per-card border. A gap (a card you can't play) is a separate run, so the glow never bridges it.
 * The mesh reads the live card matrices, so the lift, a selection, and a rotation drag the outline with the cards.
 * While cards are still flying in from the deal, the rail stays hidden. It fades with the same 200ms ease as the lift.
 */
export default function PlayableGlow({ runs, handNames, quality }: Props) {
  void quality; // the 2px #F2C14E stroke and the 0.45 glow are the same at every quality
  const { camera, scene, invalidate, size } = useThree();
  const crispRef = useRef<Mesh>(null);
  const bloomRef = useRef<Mesh>(null);
  const cache = useRef(new Map<string, Object3D>());
  const op = useRef(0);
  const fade = useRef({ t: 1, from: 0, goal: 0 });
  const boot = useRef(0);
  const sig = useRef('');
  const stamp = useRef('');
  const shaped = useRef(false);
  const crispGeo = useMemo(() => new BufferGeometry(), []);
  const bloomGeo = useMemo(() => new BufferGeometry(), []);
  const glowMap = useMemo(() => glowAlphaMap(), []);
  const crispMat = useMemo(() => new MeshBasicMaterial({ color: OUTLINE_COLOR, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: DoubleSide }), []);
  const bloomMat = useMemo(() => new MeshBasicMaterial({ color: OUTLINE_COLOR, map: glowMap, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: DoubleSide }), [glowMap]);
  useEffect(() => () => { crispGeo.dispose(); bloomGeo.dispose(); crispMat.dispose(); bloomMat.dispose(); glowMap.dispose(); }, [crispGeo, bloomGeo, crispMat, bloomMat, glowMap]);

  const latest = useRef({ runs, handNames });
  latest.current = { runs, handNames };

  useFrame((_, dt) => {
    const { runs: rs, handNames: names } = latest.current;
    const key = rs.map((r) => r.map((c) => `${c.name}@${c.x.toFixed(3)},${c.y.toFixed(3)}`).join(',')).join('|');
    if (key !== sig.current) { sig.current = key; boot.current = 0; }
    boot.current++;
    camera.updateMatrixWorld();
    const inv = camera.matrixWorldInverse;

    let settled = rs.length > 0;
    let near = -Infinity;
    let stampNow = '';
    for (const name of names) {
      const card = findCard(scene, cache.current, name);
      if (!card) continue;
      card.updateWorldMatrix(true, false);
      _v.set(0, 0, 0).applyMatrix4(card.matrixWorld).applyMatrix4(inv);
      if (_v.z > near) near = _v.z;
    }
    const cam = camera as import('three').PerspectiveCamera;
    const viewH = 2 * Math.tan(((cam.fov ?? 50) * Math.PI) / 360);
    const px = viewH / Math.max(1, size.height);
    const crispParts: Float32Array[] = [];
    const bloomPos: Float32Array[] = [];
    const bloomUv: Float32Array[] = [];
    for (const run of rs) {
      const runPolys: Pt[][] = [];
      for (const anchor of run) {
        const card = findCard(scene, cache.current, anchor.name);
        if (!card) { settled = false; continue; }
        card.updateWorldMatrix(true, false);
        _v.set(0, 0, 0).applyMatrix4(card.matrixWorld).applyMatrix4(inv);
        stampNow += `${_v.x.toFixed(3)},${_v.y.toFixed(3)},${_v.z.toFixed(3)};`;
        if (_v.z >= -0.05 || Math.hypot(_v.x / -_v.z - anchor.x, _v.y / -_v.z - anchor.y) > FLIGHT) settled = false;
        const halo: Pt[] = [];
        if (!projectHalo(card, inv, HALO, halo)) { settled = false; continue; }
        runPolys.push(halo);
      }
      // Per run, so a gap card is never bridged when two groups sit near each other.
      for (const contour of unionContours(runPolys)) {
        const smooth = smoothContour(contour);
        crispParts.push(strokeContour(smooth, outlineRadiusPx() * px));
        const ribbon = strokeRibbon(smooth, glowRadiusPx() * px);
        bloomPos.push(ribbon.pos);
        bloomUv.push(ribbon.uv);
      }
    }
    const crispTris = concatTris(crispParts);
    const bloomTris = concatTris(bloomPos);
    const bloomUvs = concatTris(bloomUv);
    if (crispTris.length) {
      writeTriangles(crispGeo, crispTris);
      writeTriangles(bloomGeo, bloomTris);
      writeUv(bloomGeo, bloomUvs);
      shaped.current = true;
      // in front of every hand card (camera looks down -Z, so a greater z is closer)
      const planeZ = (Number.isFinite(near) ? near : -1) + IN_FRONT;
      const crisp = crispRef.current, bloom = bloomRef.current;
      if (crisp) place(crisp, camera.matrixWorld, planeZ);
      if (bloom) place(bloom, camera.matrixWorld, planeZ - 0.004);
    }

    const goal = settled && crispTris.length ? 1 : 0;
    const f = fade.current;
    if (goal !== f.goal) { f.from = op.current; f.goal = goal; f.t = 0; }
    if (f.t < 1) {
      f.t = Math.min(1, f.t + dt / LIFT_S);
      op.current = f.from + (f.goal - f.from) * liftEase(f.t);
    } else op.current = f.goal;
    crispMat.opacity = op.current;
    // Peak of the gaussian is GLOW_ALPHA; the texture carries the 16px falloff.
    bloomMat.opacity = op.current * GLOW_ALPHA;
    const show = shaped.current && op.current > 0.01;
    if (crispRef.current) crispRef.current.visible = show;
    if (bloomRef.current) bloomRef.current.visible = show;
    (window as unknown as { __bwmGlow?: { opacity: number; runs: number; settled: boolean } }).__bwmGlow = {
      opacity: op.current, runs: rs.length, settled,
    };
    const moved = stampNow !== stamp.current;
    stamp.current = stampNow;
    if (Math.abs(op.current - goal) > 0.01 || boot.current < 6 || moved) invalidate();
  });

  return (
    <>
      <mesh ref={bloomRef} geometry={bloomGeo} material={bloomMat} renderOrder={1} frustumCulled={false} visible={false} />
      <mesh ref={crispRef} geometry={crispGeo} material={crispMat} renderOrder={2} frustumCulled={false} visible={false} />
    </>
  );
}
