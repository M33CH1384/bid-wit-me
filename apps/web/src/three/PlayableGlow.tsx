import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Matrix4, MeshBasicMaterial, Quaternion, Vector3, type Mesh, type Object3D } from 'three';
import { HALO_SX, HALO_SY, haloLocal, smoothContour, strokeContour, unionContours, type Pt } from './playableOutline';

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
/** Crisp stroke and the softer bloom around it, in CSS pixels. */
const STROKE_PX = 3.25;
const BLOOM_PX = 9;

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
 * One gold outline around each contiguous run of playable cards. The mesh is the union of those cards' halos, drawn
 * behind the fan, so the faces cover the middle and only the shared rim shows — no gold seam between neighbours.
 * It reads the live card matrices, so a reflow (a card played, a selection lifting, a phone rotating) drags the
 * outline with the cards. While cards are still flying in from the deal, the rail stays hidden.
 */
export default function PlayableGlow({ runs, handNames, quality }: Props) {
  const { camera, scene, invalidate, size } = useThree();
  const crispRef = useRef<Mesh>(null);
  const bloomRef = useRef<Mesh>(null);
  const cache = useRef(new Map<string, Object3D>());
  const op = useRef(0);
  const boot = useRef(0);
  const sig = useRef('');
  const stamp = useRef('');
  const shaped = useRef(false);
  const crispGeo = useMemo(() => new BufferGeometry(), []);
  const bloomGeo = useMemo(() => new BufferGeometry(), []);
  const crispMat = useMemo(() => new MeshBasicMaterial({ color: '#f5c542', transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: DoubleSide }), []);
  const bloomMat = useMemo(() => new MeshBasicMaterial({ color: '#f5c542', transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: DoubleSide, blending: AdditiveBlending }), []);
  useEffect(() => () => { crispGeo.dispose(); bloomGeo.dispose(); crispMat.dispose(); bloomMat.dispose(); }, [crispGeo, bloomGeo, crispMat, bloomMat]);

  const latest = useRef({ runs, handNames, quality });
  latest.current = { runs, handNames, quality };

  useFrame((_, dt) => {
    const { runs: rs, handNames: names, quality: q } = latest.current;
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
    const bloomParts: Float32Array[] = [];
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
        crispParts.push(strokeContour(smooth, STROKE_PX * px));
        bloomParts.push(strokeContour(smooth, BLOOM_PX * px));
      }
    }
    const crispTris = concatTris(crispParts);
    const bloomTris = concatTris(bloomParts);
    if (crispTris.length) {
      writeTriangles(crispGeo, crispTris);
      writeTriangles(bloomGeo, bloomTris);
      shaped.current = true;
      // in front of every hand card (camera looks down -Z, so a greater z is closer)
      const planeZ = (Number.isFinite(near) ? near : -1) + IN_FRONT;
      const crisp = crispRef.current, bloom = bloomRef.current;
      if (crisp) place(crisp, camera.matrixWorld, planeZ);
      if (bloom) place(bloom, camera.matrixWorld, planeZ - 0.004);
    }

    const goal = settled && crispTris.length ? (q === 'high' ? 1 : 0.9) : 0;
    const ease = Math.min(1, dt / 0.05);
    op.current += (goal - op.current) * ease;
    if (Math.abs(op.current - goal) < 0.01) op.current = goal;
    crispMat.opacity = op.current;
    bloomMat.opacity = op.current * 0.28;
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
