import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending, BufferGeometry, CircleGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial,
  PlaneGeometry, Points, PointsMaterial, RingGeometry,
} from 'three';
import { fx } from '../fx';
import { deuceCutPose, deuceFxElapsed, deuceImpactsAfter, lastDeuceImpactId, type DeuceImpact } from './deuceImpact';

/**
 * The Deuce Drop / Cut felt work (deuceFx.ts classifies, deuceImpact.ts
 * carries the beat, Card3D fires it on the landing frame).
 *
 * Vocabulary is gravity and mass only — the nuke owns explosion, Run It
 * owns the funnel, streaks own flame, so none of that appears here:
 *  - DROP: a pressure bloom under the card plus one ivory shockwave ring
 *    rolling out across the felt and dying. No flash, no debris.
 *  - CUT: a faster, tighter ring; a short burst of pale-gold sparks at
 *    the clash point between the two cards; and a crack of light laid
 *    diagonally across the beaten trump (its knock + dim live in Card3D).
 * Reduced effects (the player's own setting, fx.reduced / the reduceFx
 * prop): one static ring that simply pulses and fades — no expansion,
 * no sparks, no slash — the nuke's calm-version treatment.
 * Everything is pooled and transform-cheap: a handful of basic-material
 * meshes and one small Points cloud, nothing allocated per frame.
 */

const RING_SLOTS = 6;
const SLASH_SLOTS = 4;
const SPARKS_PER_CUT = 34;
const SPARK_SLOTS = 5;
const SPARK_POOL = SPARKS_PER_CUT * SPARK_SLOTS;

interface RingFx { t0: number; dur: number; maxR: number; peak: number; expand: boolean }
interface SlashFx { t0: number }
interface SparkFx { t0: number; ox: number; oy: number; oz: number; seed: number }

const RING_DUR = 0.55;
const CUT_RING_DUR = 0.4;
const REDUCED_DUR = 0.5;
const SLASH_DUR = 0.26;
const SPARK_DUR = 0.34;

/** Deterministic 0..1 draw (LCG on the play seed — the same jitter on every client). */
const draw = (seed: number, i: number): number => {
  let h = (seed ^ Math.imul(i + 1, 2654435761)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  h ^= h >>> 13;
  return ((h >>> 0) % 10000) / 10000;
};

export default function DeuceFxLayer({ reducedProp = false }: { reducedProp?: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const seen = useRef(lastDeuceImpactId());
  const ringIdx = useRef(0);
  const slashIdx = useRef(0);
  const sparkIdx = useRef(0);
  const rings = useRef<(RingFx | null)[]>(Array(RING_SLOTS).fill(null));
  const slashes = useRef<(SlashFx | null)[]>(Array(SLASH_SLOTS).fill(null));
  const sparks = useRef<(SparkFx | null)[]>(Array(SPARK_SLOTS).fill(null));

  const built = useMemo(() => {
    const ringGeo = new RingGeometry(0.44, 0.5, 56);
    const discGeo = new CircleGeometry(0.5, 40);
    const ringMeshes: Mesh[] = [];
    const discMeshes: Mesh[] = [];
    for (let i = 0; i < RING_SLOTS; i++) {
      const rm = new MeshBasicMaterial({ color: '#f7efdb', transparent: true, opacity: 0, depthWrite: false });
      const ring = new Mesh(ringGeo, rm);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.renderOrder = 3;
      ringMeshes.push(ring);
      const dm = new MeshBasicMaterial({ color: '#fff8e7', transparent: true, opacity: 0, depthWrite: false });
      const disc = new Mesh(discGeo, dm);
      disc.rotation.x = -Math.PI / 2;
      disc.visible = false;
      disc.renderOrder = 2;
      discMeshes.push(disc);
    }
    const slashGeo = new PlaneGeometry(0.68, 0.05);
    const slashMeshes: Mesh[] = [];
    for (let i = 0; i < SLASH_SLOTS; i++) {
      const sm = new MeshBasicMaterial({ color: '#ffedbe', transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
      const slash = new Mesh(slashGeo, sm);
      slash.rotation.x = -Math.PI / 2;
      slash.visible = false;
      slash.renderOrder = 4;
      slashMeshes.push(slash);
    }
    const sGeo = new BufferGeometry();
    const pos = new Float32Array(SPARK_POOL * 3);
    const col = new Float32Array(SPARK_POOL * 3);
    for (let i = 0; i < SPARK_POOL; i++) pos[i * 3 + 1] = -10; // parked under the felt
    sGeo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    sGeo.setAttribute('color', new Float32BufferAttribute(col, 3));
    const sMat = new PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
    const points = new Points(sGeo, sMat);
    points.frustumCulled = false;
    points.renderOrder = 4;
    return { ringMeshes, discMeshes, slashMeshes, points, sGeo };
  }, []);

  const spawn = (e: DeuceImpact, reduced: boolean) => {
    const now = performance.now();
    // Ring (+ pressure bloom for a full Drop).
    const ri = ringIdx.current++ % RING_SLOTS;
    rings.current[ri] = {
      t0: now,
      dur: reduced ? REDUCED_DUR : e.kind === 'cut' ? CUT_RING_DUR : RING_DUR,
      maxR: e.kind === 'cut' ? 0.85 : 1.35,
      peak: e.kind === 'cut' ? 0.5 : 0.55,
      expand: !reduced,
    };
    const ring = built.ringMeshes[ri]!;
    ring.position.set(e.x, e.y + 0.004, e.z);
    ring.visible = true;
    const disc = built.discMeshes[ri]!;
    disc.position.set(e.x, e.y + 0.003, e.z);
    disc.visible = !reduced && e.kind === 'drop';
    if (e.kind !== 'cut' || reduced) return;
    const vp = e.victim ? deuceCutPose(e.victim) : undefined;
    if (!vp) return;
    // Crack of light across the beaten trump, diagonal to the knock.
    const si = slashIdx.current++ % SLASH_SLOTS;
    slashes.current[si] = { t0: now };
    const slash = built.slashMeshes[si]!;
    slash.position.set(vp.x, vp.y + 0.02, vp.z);
    slash.rotation.z = Math.atan2(vp.dirX, vp.dirZ) + 0.85;
    slash.visible = true;
    // Spark burst at the clash point, halfway between the two cards.
    const ki = sparkIdx.current++ % SPARK_SLOTS;
    sparks.current[ki] = { t0: now, ox: (e.x + vp.x) / 2, oy: Math.max(e.y, vp.y) + 0.03, oz: (e.z + vp.z) / 2, seed: e.seed };
  };

  useFrame(() => {
    const fresh = deuceImpactsAfter(seen.current);
    if (fresh.length) {
      seen.current = fresh[fresh.length - 1]!.id;
      const reduced = reducedProp || fx.reduced;
      for (const e of fresh) spawn(e, reduced);
    }
    const now = performance.now();
    let active = fresh.length > 0;
    // Rings + blooms.
    for (let i = 0; i < RING_SLOTS; i++) {
      const r = rings.current[i];
      const ring = built.ringMeshes[i]!;
      const disc = built.discMeshes[i]!;
      if (!r) continue;
      const u = deuceFxElapsed(now - r.t0) / (r.dur * 1000);
      if (u >= 1) {
        rings.current[i] = null;
        ring.visible = false;
        disc.visible = false;
        continue;
      }
      active = true;
      const rad = r.expand ? 0.16 + (r.maxR - 0.16) * (1 - Math.pow(1 - u, 2.2)) : 0.8;
      ring.scale.setScalar(rad / 0.5);
      (ring.material as MeshBasicMaterial).opacity = r.peak * Math.pow(1 - u, 1.6);
      if (disc.visible) {
        disc.scale.setScalar((0.2 + 0.55 * (1 - Math.pow(1 - u, 2))) / 0.5);
        (disc.material as MeshBasicMaterial).opacity = 0.16 * (1 - u);
      }
    }
    // Slashes.
    for (let i = 0; i < SLASH_SLOTS; i++) {
      const s = slashes.current[i];
      const mesh = built.slashMeshes[i]!;
      if (!s) continue;
      const u = deuceFxElapsed(now - s.t0) / (SLASH_DUR * 1000);
      if (u >= 1) { slashes.current[i] = null; mesh.visible = false; continue; }
      active = true;
      mesh.scale.set(0.35 + 0.75 * Math.min(1, u * 2.4), 1, 1);
      (mesh.material as MeshBasicMaterial).opacity = 0.95 * Math.sin(Math.PI * Math.min(1, u));
    }
    // Sparks.
    const posAttr = built.sGeo.getAttribute('position') as Float32BufferAttribute;
    const colAttr = built.sGeo.getAttribute('color') as Float32BufferAttribute;
    let sparksDirty = false;
    for (let k = 0; k < SPARK_SLOTS; k++) {
      const s = sparks.current[k];
      const base = k * SPARKS_PER_CUT;
      if (!s) continue;
      const t = deuceFxElapsed(now - s.t0) / 1000;
      if (t >= SPARK_DUR) {
        sparks.current[k] = null;
        for (let j = 0; j < SPARKS_PER_CUT; j++) posAttr.setY(base + j, -10);
        sparksDirty = true;
        continue;
      }
      active = true;
      sparksDirty = true;
      const fade = Math.pow(1 - t / SPARK_DUR, 1.8);
      for (let j = 0; j < SPARKS_PER_CUT; j++) {
        const a = draw(s.seed, j * 3) * Math.PI * 2;
        const sp = 0.55 + draw(s.seed, j * 3 + 1) * 1.15;
        const up = 0.7 + draw(s.seed, j * 3 + 2) * 1.1;
        const x = s.ox + Math.cos(a) * sp * t;
        const z = s.oz + Math.sin(a) * sp * t;
        const y = s.oy + up * t - 2.3 * t * t;
        posAttr.setXYZ(base + j, x, Math.max(0.012, y), z);
        colAttr.setXYZ(base + j, fade, fade * 0.82, fade * 0.55);
      }
    }
    if (sparksDirty) { posAttr.needsUpdate = true; colAttr.needsUpdate = true; }
    if (active) invalidate();
  });

  return (
    <group>
      {built.ringMeshes.map((m, i) => <primitive key={`r${i}`} object={m} />)}
      {built.discMeshes.map((m, i) => <primitive key={`d${i}`} object={m} />)}
      {built.slashMeshes.map((m, i) => <primitive key={`s${i}`} object={m} />)}
      <primitive object={built.points} />
    </group>
  );
}
