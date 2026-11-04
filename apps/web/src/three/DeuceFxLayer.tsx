import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending, BufferGeometry, CircleGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial,
  PlaneGeometry, PointLight, Points, PointsMaterial, RingGeometry,
} from 'three';
import { fx } from '../fx';
import { cutColorFor, DUEL_COLORS } from '../deuceFx';
import { deuceCutPose, deuceFxElapsed, deuceImpactsAfter, lastDeuceImpactId, type DeuceImpact } from './deuceImpact';

/**
 * The Deuce Drop / Cut felt work (deuceFx.ts classifies, deuceImpact.ts
 * carries the beat, Card3D fires it on the landing frame).
 *
 * Vocabulary is gravity, mass and the blade — the nuke owns explosion,
 * Run It owns the funnel, streaks own flame, so none of that appears
 * here:
 *  - DROP: a pressure bloom under the card plus one ivory shockwave ring
 *    rolling out across the felt and dying. No flash, no debris.
 *  - CUT (escalated 2026-11-01): a duelist's strike in the winning
 *    trump's colour. A blade streak — white-hot core, coloured trail —
 *    sweeps across the beaten trump along the cut line while an
 *    afterglow sits on the line itself (the victim's two halves part
 *    along that same line, in Card3D); a coloured shockwave ring and a
 *    flash disc burst from the clash point with sparks and heavier
 *    shards, and one pooled light flares and dies over the pile.
 *  - DUEL (2026-11-04, the 2♦-over-2♠ pairing only): crystal, not steel.
 *    NO blade, no afterglow line — a white flash at the clash point and
 *    a dense shard burst at double density in the diamond palette
 *    (DUEL_COLORS: white core, ice glow), a wider white shockwave ring,
 *    and the pooled light flaring ice-white. The victim is knocked past
 *    (in Card3D), never split. Same envelopes, same pooled geometry —
 *    the duel is a re-dress of the Cut's machinery, not new machinery.
 * Reduced effects (the player's own setting, fx.reduced / the reduceFx
 * prop): one static ring that simply pulses and fades — no expansion,
 * no strike, no debris, no light — the nuke's calm-version treatment.
 * Everything is pooled and transform-cheap: basic-material meshes, two
 * small Points clouds, and a light that is mounted from table load at
 * intensity 0 — the scene's light count never changes, so no shader
 * program ever compiles on the first Cut.
 */

const RING_SLOTS = 6;
const STRIKE_SLOTS = 4;
const SPARKS_PER_CUT = 56;
const CHUNKS_PER_CUT = 16;
const SPARK_SLOTS = 5;
const SPARK_POOL = SPARKS_PER_CUT * SPARK_SLOTS;
const CHUNK_POOL = CHUNKS_PER_CUT * SPARK_SLOTS;

interface RingFx { t0: number; dur: number; maxR: number; peak: number; expand: boolean; flash: boolean; duel: boolean }
interface StrikeFx { t0: number }
interface SparkFx { t0: number; ox: number; oy: number; oz: number; seed: number; gr: number; gg: number; gb: number }

const RING_DUR = 0.55;
const CUT_RING_DUR = 0.5;
const REDUCED_DUR = 0.5;
const FLASH_DUR_MS = 220;
const STRIKE_DUR = 0.3;
const GLOW_DUR = 0.55;
const SPARK_DUR = 0.42;
const CHUNK_DUR = 0.5;
const LIGHT_DUR_MS = 300;

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
  const strikeIdx = useRef(0);
  const sparkIdx = useRef(0);
  const rings = useRef<(RingFx | null)[]>(Array(RING_SLOTS).fill(null));
  const strikes = useRef<(StrikeFx | null)[]>(Array(STRIKE_SLOTS).fill(null));
  const sparks = useRef<(SparkFx | null)[]>(Array(SPARK_SLOTS).fill(null));
  const lightAt = useRef(0);

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
    // The strike: a group aligned to the cut line (its +X runs along the
    // line, +Z is the line's normal in the felt plane). Core blade sweeps
    // along +Z, the wider trail lags it, and the afterglow line stays put
    // on the line while the victim's halves part beneath it.
    const coreGeo = new PlaneGeometry(1.04, 0.034);
    const trailGeo = new PlaneGeometry(1.04, 0.13);
    const glowGeo = new PlaneGeometry(0.8, 0.02);
    interface StrikeParts { group: Group; core: Mesh; trail: Mesh; glow: Mesh }
    const strikeParts: StrikeParts[] = [];
    for (let i = 0; i < STRIKE_SLOTS; i++) {
      const mk = (geo: PlaneGeometry, y: number) => {
        const m = new Mesh(geo, new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, toneMapped: false }));
        m.rotation.x = -Math.PI / 2;
        m.position.y = y;
        m.visible = false;
        m.renderOrder = 4;
        return m;
      };
      const group = new Group();
      const trail = mk(trailGeo, 0.002);
      const glow = mk(glowGeo, 0.003);
      const core = mk(coreGeo, 0.005);
      group.add(trail, glow, core);
      group.visible = false;
      strikeParts.push({ group, core, trail, glow });
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
    // Shards: fewer, bigger, heavier — the card's own substance coming off
    // the cut, tinted with the winner's colour (no vertex colours needed).
    const cGeo = new BufferGeometry();
    const cPos = new Float32Array(CHUNK_POOL * 3);
    for (let i = 0; i < CHUNK_POOL; i++) cPos[i * 3 + 1] = -10;
    cGeo.setAttribute('position', new Float32BufferAttribute(cPos, 3));
    const cMat = new PointsMaterial({ size: 0.08, color: '#ffffff', transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
    const chunks = new Points(cGeo, cMat);
    chunks.frustumCulled = false;
    chunks.renderOrder = 4;
    // One burst light, mounted for the table's whole life at intensity 0:
    // the light count is constant, so every lit program compiles with it
    // at load and the first Cut never pays a shader compile.
    const light = new PointLight('#ffffff', 0, 2.6, 2);
    light.visible = true;
    return { ringMeshes, discMeshes, strikeParts, points, sGeo, chunks, cGeo, light };
  }, []);

  const spawn = (e: DeuceImpact, reduced: boolean) => {
    const now = performance.now();
    const pal = e.duel ? DUEL_COLORS : e.kind === 'cut' && e.winner ? cutColorFor(e.winner) : null;
    // Ring (+ pressure bloom for a full Drop, flash disc for a Cut).
    const ri = ringIdx.current++ % RING_SLOTS;
    rings.current[ri] = {
      t0: now,
      dur: reduced ? REDUCED_DUR : e.kind === 'cut' ? CUT_RING_DUR : RING_DUR,
      maxR: e.duel ? 2.1 : e.kind === 'cut' ? 1.85 : 1.35,
      peak: e.duel ? 0.9 : e.kind === 'cut' ? 0.8 : 0.55,
      expand: !reduced,
      flash: e.kind === 'cut' && !reduced,
      duel: e.duel,
    };
    const ring = built.ringMeshes[ri]!;
    (ring.material as MeshBasicMaterial).color.set(pal ? pal.glow : '#f7efdb');
    ring.position.set(e.x, e.y + 0.004, e.z);
    ring.visible = true;
    const disc = built.discMeshes[ri]!;
    (disc.material as MeshBasicMaterial).color.set(e.duel ? DUEL_COLORS.core : pal ? pal.glow : '#fff8e7');
    disc.position.set(e.x, e.y + 0.003, e.z);
    disc.visible = !reduced && (e.kind === 'drop' || e.kind === 'cut');
    if (e.kind !== 'cut' || reduced) return;
    const vp = e.victim ? deuceCutPose(e.victim) : undefined;
    if (!vp) return;
    if (e.duel) {
      // The Duel: no blade crosses the victim — crystal bursts at the clash
      // point instead. The spark/shard burst runs at double density (two
      // pool slots, the second seeded apart and nudged off-centre) in the
      // diamond palette, and the pooled light flares ice-white.
      const ox = (e.x + vp.x) / 2, oy = Math.max(e.y, vp.y) + 0.03, oz = (e.z + vp.z) / 2;
      const ice = new Color(DUEL_COLORS.glow);
      for (let b = 0; b < 2; b++) {
        const ki = sparkIdx.current++ % SPARK_SLOTS;
        sparks.current[ki] = {
          t0: now,
          ox: ox + (b ? (draw(e.seed, 31) - 0.5) * 0.07 : 0), oy,
          oz: oz + (b ? (draw(e.seed, 37) - 0.5) * 0.07 : 0),
          seed: b ? (e.seed + 7919) >>> 0 : e.seed,
          gr: ice.r, gg: ice.g, gb: ice.b,
        };
      }
      (built.chunks.material as PointsMaterial).color.set(DUEL_COLORS.core);
      built.light.position.set(ox, Math.max(e.y, vp.y) + 0.17, oz);
      built.light.color.set(DUEL_COLORS.glow);
      lightAt.current = now;
      return;
    }
    // The blade streak, laid along the cut line across the beaten trump.
    const si = strikeIdx.current++ % STRIKE_SLOTS;
    strikes.current[si] = { t0: now };
    const parts = built.strikeParts[si]!;
    parts.group.position.set(vp.x, vp.y + 0.02, vp.z);
    parts.group.rotation.y = -vp.ang;
    (parts.core.material as MeshBasicMaterial).color.set(pal?.core ?? '#ffffff');
    (parts.trail.material as MeshBasicMaterial).color.set(pal?.glow ?? '#ffedbe');
    (parts.glow.material as MeshBasicMaterial).color.set(pal?.glow ?? '#ffedbe');
    parts.group.visible = true;
    parts.core.visible = true;
    parts.trail.visible = true;
    parts.glow.visible = true;
    // Spark + shard burst at the clash point, halfway between the two cards.
    const ki = sparkIdx.current++ % SPARK_SLOTS;
    const glowCol = new Color(pal?.glow ?? '#ffcf7a');
    sparks.current[ki] = {
      t0: now, ox: (e.x + vp.x) / 2, oy: Math.max(e.y, vp.y) + 0.03, oz: (e.z + vp.z) / 2, seed: e.seed,
      gr: glowCol.r, gg: glowCol.g, gb: glowCol.b,
    };
    (built.chunks.material as PointsMaterial).color.set(pal?.glow ?? '#ffcf7a');
    // The light burst rides the same clash point.
    built.light.position.set((e.x + vp.x) / 2, Math.max(e.y, vp.y) + 0.17, (e.z + vp.z) / 2);
    built.light.color.set(pal?.glow ?? '#ffdf9e');
    lightAt.current = now;
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
    // Rings + blooms / flashes.
    for (let i = 0; i < RING_SLOTS; i++) {
      const r = rings.current[i];
      const ring = built.ringMeshes[i]!;
      const disc = built.discMeshes[i]!;
      if (!r) continue;
      const el = deuceFxElapsed(now - r.t0);
      const u = el / (r.dur * 1000);
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
        if (r.flash) {
          // The Duel's flash is the crystal strike itself: faster and
          // brighter than the Cut's clash flash, and a touch wider.
          const fu = el / (r.duel ? FLASH_DUR_MS * 0.7 : FLASH_DUR_MS);
          if (fu >= 1) disc.visible = false;
          else {
            disc.scale.setScalar(((r.duel ? 0.3 : 0.25) + (r.duel ? 1.05 : 0.85) * (1 - Math.pow(1 - fu, 2))) / 0.5);
            (disc.material as MeshBasicMaterial).opacity = (r.duel ? 0.55 : 0.3) * (1 - fu);
          }
        } else {
          disc.scale.setScalar((0.2 + 0.55 * (1 - Math.pow(1 - u, 2))) / 0.5);
          (disc.material as MeshBasicMaterial).opacity = 0.16 * (1 - u);
        }
      }
    }
    // Strikes: the core sweeps the line's normal in the first half of the
    // beat, the trail lags a phase behind, the afterglow dies slowly.
    for (let i = 0; i < STRIKE_SLOTS; i++) {
      const s = strikes.current[i];
      const parts = built.strikeParts[i]!;
      if (!s) continue;
      const el = deuceFxElapsed(now - s.t0);
      const u = el / (STRIKE_DUR * 1000);
      const v = el / (GLOW_DUR * 1000);
      if (u >= 1 && v >= 1) {
        strikes.current[i] = null;
        parts.group.visible = false;
        continue;
      }
      active = true;
      const sweep = (ph: number) => -0.14 + 0.28 * (1 - Math.pow(1 - Math.min(1, Math.max(0, ph)), 3));
      if (u < 1) {
        parts.core.visible = true;
        parts.trail.visible = true;
        parts.core.position.z = sweep(u / 0.55);
        parts.trail.position.z = sweep((u - 0.14) / 0.55);
        (parts.core.material as MeshBasicMaterial).opacity = Math.sin(Math.PI * Math.min(1, u * 1.06));
        (parts.trail.material as MeshBasicMaterial).opacity = 0.4 * Math.sin(Math.PI * Math.min(1, Math.max(0, u * 1.1)));
      } else {
        parts.core.visible = false;
        parts.trail.visible = false;
      }
      if (v < 1) {
        parts.glow.visible = true;
        (parts.glow.material as MeshBasicMaterial).opacity = 0.6 * Math.pow(1 - v, 1.5);
      } else parts.glow.visible = false;
    }
    // Light burst.
    if (lightAt.current) {
      const lu = deuceFxElapsed(now - lightAt.current) / LIGHT_DUR_MS;
      if (lu >= 1) { built.light.intensity = 0; lightAt.current = 0; }
      else {
        active = true;
        built.light.intensity = 3.4 * (lu < 0.13 ? lu / 0.13 : Math.pow(1 - (lu - 0.13) / 0.87, 2));
      }
    }
    // Sparks + shards.
    const posAttr = built.sGeo.getAttribute('position') as Float32BufferAttribute;
    const colAttr = built.sGeo.getAttribute('color') as Float32BufferAttribute;
    const cPosAttr = built.cGeo.getAttribute('position') as Float32BufferAttribute;
    let sparksDirty = false;
    let chunksDirty = false;
    for (let k = 0; k < SPARK_SLOTS; k++) {
      const s = sparks.current[k];
      const base = k * SPARKS_PER_CUT;
      const cBase = k * CHUNKS_PER_CUT;
      if (!s) continue;
      const t = deuceFxElapsed(now - s.t0) / 1000;
      if (t >= CHUNK_DUR) {
        sparks.current[k] = null;
        for (let j = 0; j < SPARKS_PER_CUT; j++) posAttr.setY(base + j, -10);
        for (let j = 0; j < CHUNKS_PER_CUT; j++) cPosAttr.setY(cBase + j, -10);
        sparksDirty = true;
        chunksDirty = true;
        continue;
      }
      active = true;
      if (t < SPARK_DUR) {
        sparksDirty = true;
        const fade = Math.pow(1 - t / SPARK_DUR, 1.8);
        for (let j = 0; j < SPARKS_PER_CUT; j++) {
          const a = draw(s.seed, j * 3) * Math.PI * 2;
          const sp = 0.7 + draw(s.seed, j * 3 + 1) * 1.5;
          const up = 0.9 + draw(s.seed, j * 3 + 2) * 1.3;
          const x = s.ox + Math.cos(a) * sp * t;
          const z = s.oz + Math.sin(a) * sp * t;
          const y = s.oy + up * t - 2.6 * t * t;
          posAttr.setXYZ(base + j, x, Math.max(0.012, y), z);
          const m = draw(s.seed, j * 7 + 5);
          colAttr.setXYZ(base + j,
            fade * (1 - m * (1 - s.gr)), fade * (1 - m * (1 - s.gg)), fade * (1 - m * (1 - s.gb)));
        }
      } else if (t >= SPARK_DUR && t < CHUNK_DUR) {
        // sparks die on their own clock; park them once
        if (posAttr.getY(base) > -5) {
          for (let j = 0; j < SPARKS_PER_CUT; j++) posAttr.setY(base + j, -10);
          sparksDirty = true;
        }
      }
      chunksDirty = true;
      const cFade = Math.pow(1 - t / CHUNK_DUR, 1.4);
      (built.chunks.material as PointsMaterial).opacity = Math.max(0.15, cFade);
      for (let j = 0; j < CHUNKS_PER_CUT; j++) {
        const a = draw(s.seed + 977, j * 3) * Math.PI * 2;
        const sp = 0.3 + draw(s.seed + 977, j * 3 + 1) * 0.7;
        const up = 0.55 + draw(s.seed + 977, j * 3 + 2) * 0.8;
        const x = s.ox + Math.cos(a) * sp * t;
        const z = s.oz + Math.sin(a) * sp * t;
        const y = s.oy + up * t - 3.6 * t * t;
        cPosAttr.setXYZ(cBase + j, x, Math.max(0.014, y), z);
      }
    }
    if (sparksDirty) { posAttr.needsUpdate = true; colAttr.needsUpdate = true; }
    if (chunksDirty) cPosAttr.needsUpdate = true;
    if (active) invalidate();
  });

  return (
    <group>
      {built.ringMeshes.map((m, i) => <primitive key={`r${i}`} object={m} />)}
      {built.discMeshes.map((m, i) => <primitive key={`d${i}`} object={m} />)}
      {built.strikeParts.map((p, i) => <primitive key={`k${i}`} object={p.group} />)}
      <primitive object={built.points} />
      <primitive object={built.chunks} />
      <primitive object={built.light} />
    </group>
  );
}
