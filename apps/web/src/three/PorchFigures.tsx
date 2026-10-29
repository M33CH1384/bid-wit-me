/**
 * THE PORCH PILOT — real rigged 3D figures at the story Porch table
 * (character phase, step 2; owner go 2026-10-28).
 *
 * Solo story tables at stop `porch`, High quality ONLY: the three bot
 * seats get the cast's actual rigged bodies — Dee (partner seat,
 * grafted hands), Uncle Ray and Pat (stop pair) — seated in the Porch
 * room's own folding chairs, holding their fans. The player's seat
 * stays first-person. Everywhere else (Low, non-story, other stops,
 * co-op) nothing in this module mounts and the seats keep today's
 * treatment exactly (DOM portrait plates + the card fans).
 *
 * What was at those seats before: nothing in the scene — the opponent
 * fan and the room's chair, with the character's portrait living in
 * the DOM plate. (The golden "cages" in the owner's 2026-10-28 Rec
 * screenshot were the opponent fans themselves in pinched rest pose,
 * gold-spade card backs — there is no placeholder-figure system in
 * production; the King table's KingRail portrait planes are King-only
 * and untouched by this pilot.)
 *
 * The seated solve is the immersive sandbox's, ported (UniRig role
 * detection from the bind hierarchy, world-space bone aims, two-bone
 * leg IK to flat-foot ankle targets, two-bone arm IK onto the REAL
 * fan's grip points every frame, grafted-finger curl drive, breath /
 * sway / gaze life — no blink: the rigs carry no morphs and a fake
 * blink is worse than none). One porting correction the sandbox
 * never exercised: role detection sorts chains by +x, which is only
 * figure-local at the unrotated top seat (Dee, the sandbox's only
 * UniRig). Ray and Pat sit at rotated side seats, so detection and
 * bind measurement here run on a detached, unrotated holder first;
 * only placement and the world-space aims see the seat rotation.
 *
 * Chair reconciliation: the sandbox solved against its ClassicStudio
 * chair (seat top −0.447) and flagged that the owner-scale chairs sat
 * ≈ −0.406. The pilot solves against the PRODUCTION Porch room's own
 * folding chairs: PorchDeckRoom builds its seat box top at
 * FLOOR_Y + 0.49 = −0.41 (PORCH_SEAT_TOP below, pinned against the
 * room's source by porch-figures.test.ts).
 *
 * Loading: declarative useLoader + Suspense + a per-figure error
 * boundary (the sedan lesson — imperative loading dropped assets
 * intermittently). A figure that fails renders NOTHING: the seat
 * falls back to today's treatment (portrait plate + fan, both of
 * which render independently of this module), and the failure names
 * itself on window.__bwmPorchFigures. The three GLBs are in the
 * loader's asset gate at this seam (assetGate.ts roomGlbUrls), so
 * the loader's promise covers them like any other room asset.
 *
 * Deliberately NOT in the pilot: played-card travel IK. The sandbox
 * ran a fixed 24 s master cycle; production plays are real game
 * events on no fixed clock, so the arms hold the fan (grip eases
 * with the fan's rest pose) and stay honest. Hands rest on the lap
 * when a seat holds no cards.
 */
import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import {
  Box3, Euler, Group, Mesh, Object3D, Quaternion, Vector3, type Material,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { PORCH_FIGURE_GLBS } from '../assetGate';
import { CHAIR_SPOTS } from './classicStudioLayout';
import { opponentFan, seatDir, type SeatPos } from './layout';
import { fanRestTarget } from './fanRest';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const FLOOR_Y = -0.9;
/** The production Porch room's folding-chair seat top: PorchDeckRoom
 *  builds `ySeat = FLOOR_Y + 0.49` (its seat box top). The sandbox's
 *  −0.447 was its own studio chair and does NOT apply here. */
export const PORCH_SEAT_TOP = -0.41;
const HIP_OFF = 0.05;      // hip-joint centre above the seat surface
const HIP_BACK = -0.02;    // hip-joint offset from chair centre, away from the table (seat frame)
const ANKLE_FWD = 0.38;    // ankle target forward of the hip joint (seat frame)

/* Grip calibration against the production opponent fan (opponentFan's
 * middle card): the hands close on the fan's lower edge from behind —
 * GRIP_OUT along the seat direction from the fan centre, GRIP_DOWN
 * below it, GRIP_HALF the lateral half-spread of the two hands. */
const GRIP_OUT = 0.26;
const GRIP_DOWN = 0.13;
const GRIP_HALF = 0.085;

/* Reach settle bounds (placement): the cast rigs' arms run short
 * (TRELLIS proportions — a 1.8 m figure's shoulder-to-wrist ≈ 0.45 m)
 * and the production side-seat fans sit ~0.93 m from their chair
 * centres, so an upright sit cannot reach the grips. Real players
 * scoot forward on the seat and lean in; the placement does the same,
 * in that order, capped so the figure never perches off the seat or
 * hunches: at most REACH_SCOOT of forward shift on the chair (the
 * seat is 0.40 deep; the hip joint stays over it) and at most
 * REACH_LEAN of extra spine lean. */
const REACH_SCOOT = 0.25;
const REACH_LEAN = 0.20;

/** CHAIR_SPOTS index per seat position (classicStudioLayout order). */
const SPOT_INDEX: Record<SeatPos, number> = { top: 0, bottom: 1, left: 2, right: 3 };

/* ------------------------------------------------------------------ */
/* Per-character registers (sandbox values; Ray/Pat statures are the   */
/* pilot's first solve, judged from the seat captures).                */
/* ------------------------------------------------------------------ */

interface FigureRegister {
  stature: number;
  spine: [number, number, number];
  breathPeriod: number; breathAmp: number; swayAmp: number;
  gazeDwell: number;
  /** gaze cycle keys: 'fan' | 'trick' | 'human' | a character id */
  gaze: readonly string[];
}

const FIGURE_REGISTERS: Record<string, FigureRegister> = {
  dee: {
    stature: 1.86, spine: [0.10, 0.08, 0.06],
    breathPeriod: 4.2, breathAmp: 1.0, swayAmp: 1.0, gazeDwell: 3.6,
    gaze: ['fan', 'trick', 'human', 'uncleRay', 'fan'],
  },
  uncleRay: {
    stature: 1.80, spine: [0.06, 0.05, 0.04],
    breathPeriod: 5.6, breathAmp: 0.6, swayAmp: 0.5, gazeDwell: 4.6,
    gaze: ['trick', 'dee', 'fan', 'human', 'trick'],
  },
  pat: {
    stature: 1.68, spine: [0.13, 0.10, 0.07],
    breathPeriod: 3.9, breathAmp: 1.1, swayAmp: 1.2, gazeDwell: 2.9,
    gaze: ['fan', 'trick', 'dee', 'trick', 'uncleRay'],
  },
};

const FIGURE_URLS: Record<string, string> = Object.fromEntries(
  PORCH_FIGURE_GLBS.map((f) => [f.id, f.url]),
);

/* ------------------------------------------------------------------ */
/* UniRig adapter (sandbox port): roles are DETECTED from the bind     */
/* hierarchy — hips = root bone; leg chains by downward reach; spine   */
/* chain upward; arm chains sorted +x-first = Left (the figure faces   */
/* +Z in bind, so +x is its Left). Detection MUST run with the figure  */
/* unrotated (see the header note), on the detached holder.            */
/* ------------------------------------------------------------------ */

const isBone = (o: Object3D) => !!(o as Object3D & { isBone?: boolean }).isBone;

function detectUniRoles(root: Object3D): Record<string, string> {
  const bones: Object3D[] = [];
  root.traverse((o) => { if (isBone(o)) bones.push(o); });
  const wp = (o: Object3D) => o.getWorldPosition(new Vector3());
  const childrenOf = (b: Object3D) => b.children.filter(isBone);
  const chain = (start: Object3D, dirY: number, max = 8): Object3D[] => {
    const out: Object3D[] = [];
    let cur: Object3D | undefined = start;
    for (let i = 0; i < max && cur; i++) {
      out.push(cur);
      const kids = childrenOf(cur);
      if (!kids.length) break;
      const p = wp(cur);
      kids.sort((a, b2) => dirY * (wp(b2).y - p.y) - dirY * (wp(a).y - p.y));
      cur = kids[0];
    }
    return out;
  };
  root.updateMatrixWorld(true);
  const hips = bones.find((b) => !isBone(b.parent as Object3D)) ?? bones[0]!;
  const legChains: Object3D[][] = [];
  const spineStarts: Object3D[] = [];
  for (const k of childrenOf(hips)) {
    const ch = chain(k, -1);
    if (wp(ch[ch.length - 1]!).y < wp(hips).y - 0.25) legChains.push(ch); else spineStarts.push(k);
  }
  legChains.sort((a, b) => wp(b[0]!).x - wp(a[0]!).x); // +x first = Left
  const spine = spineStarts.length ? chain(spineStarts[0]!, +1) : [];
  const spineSet = new Set(spine.map((b) => b.name));
  const armChains: Object3D[][] = [];
  for (const sb of spine) {
    for (const k of childrenOf(sb)) {
      if (spineSet.has(k.name)) continue;
      armChains.push(chain(k, -1));
    }
  }
  armChains.sort((a, b) => wp(b[0]!).x - wp(a[0]!).x); // +x first = Left
  const legL = legChains[0] ?? [], legR = legChains[1] ?? [];
  const armL = armChains[0] ?? [], armR = armChains[1] ?? [];
  const n = (b?: Object3D) => b?.name ?? '';
  return {
    Hips: hips.name,
    Spine: n(spine[0]), Spine1: n(spine[1]), Spine2: n(spine[2]),
    Neck: n(spine[3]), Head: n(spine[spine.length - 1]),
    LeftShoulder: n(armL[0]), LeftArm: n(armL[1]), LeftForeArm: n(armL[2]), LeftHand: n(armL[3]),
    RightShoulder: n(armR[0]), RightArm: n(armR[1]), RightForeArm: n(armR[2]), RightHand: n(armR[3]),
    LeftUpLeg: n(legL[0]), LeftLeg: n(legL[1]), LeftFoot: n(legL[2]), LeftToeBase: n(legL[3]),
    RightUpLeg: n(legR[0]), RightLeg: n(legR[1]), RightFoot: n(legR[2]), RightToeBase: n(legR[3]),
  };
}

/** Auto-upright guards for FBX-derived rigs (sandbox port). The cast
 *  GLBs trigger none of these — they are guards, not corrections. */
function orientUniRig(root: Object3D) {
  const span = (axis: 'y' | 'z') => {
    root.updateMatrixWorld(true);
    let mn = Infinity, mx = -Infinity;
    root.traverse((o) => {
      if (isBone(o)) { const p = o.getWorldPosition(new Vector3()); mn = Math.min(mn, p[axis]); mx = Math.max(mx, p[axis]); }
    });
    return mx - mn;
  };
  if (span('z') > span('y')) { root.rotateX(Math.PI / 2); root.updateMatrixWorld(true); }
  const roles = detectUniRoles(root);
  const byName = (name: string) => { let hit: Object3D | undefined; root.traverse((o) => { if (o.name === name) hit = o; }); return hit; };
  const head = byName(roles.Head!), hips = byName(roles.Hips!);
  if (head && hips && head.getWorldPosition(new Vector3()).y < hips.getWorldPosition(new Vector3()).y) {
    root.rotateX(Math.PI); root.updateMatrixWorld(true);
  }
  const toe = byName(roles.LeftToeBase!), ankle = byName(roles.LeftFoot!);
  if (toe && ankle && toe.getWorldPosition(new Vector3()).z < ankle.getWorldPosition(new Vector3()).z - 0.01) {
    root.rotateY(Math.PI); root.updateMatrixWorld(true);
  }
}

/** Rotate a bone by angle around a WORLD axis through the bone
 *  (sandbox port) — the torso lean is applied in world space, never
 *  as a bone-local Euler guess (the Phase A twisted-legs root cause). */
function rotateBoneWorld(root: Object3D, bone: Object3D, axis: Vector3, angle: number) {
  root.updateMatrixWorld(true);
  const parent = bone.parent!;
  const parentQ = parent.getWorldQuaternion(new Quaternion());
  const boneQ = bone.getWorldQuaternion(new Quaternion());
  const rot = new Quaternion().setFromAxisAngle(axis.clone().normalize(), angle);
  const newWorld = rot.multiply(boneQ);
  bone.quaternion.copy(parentQ.invert().multiply(newWorld));
  bone.updateMatrixWorld(true);
}

/* ------------------------------------------------------------------ */
/* Grafted-finger drive (sandbox port): full-grip curl per segment    */
/* (root->tip, rad) from the graft prototype's baked table; the local  */
/* delta per joint is precomputed ONCE from the bind pose (the        */
/* knuckle axis expressed in the joint's PARENT frame — conjugating   */
/* the world-space curl into the parent frame cancels the parent's    */
/* own rotation), so the per-frame driver only scales the angle.      */
/* ------------------------------------------------------------------ */

const FINGER_CURL: Record<string, number[]> = {
  Thumb: [0.35, 0.45, 0.35, 0.2],
  Index: [0.62, 0.85, 0.65, 0.3],
  Middle: [0.66, 0.9, 0.68, 0.3],
  Ring: [0.7, 0.95, 0.7, 0.3],
  Pinky: [0.75, 1.0, 0.72, 0.3],
};
const FINGER_GRIP_SCALE: Record<string, number> = {
  Thumb: 1.0, Index: 1.0, Middle: 1.0, Ring: 0.95, Pinky: 0.88,
};
const FINGER_NAMES = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const;

interface FingerJoint { bone: Object3D; rest: Quaternion; axis: Vector3; angle: number }

/** Anatomical frame at the wrist (the graft prototype's basis):
 *  z along the hand's bones (wrist -> chain end), y the palm
 *  direction, x = y x z the knuckle (flexion) axis. */
function knuckleBasis(wrist: Vector3, tip: Vector3, palmExpected: Vector3) {
  const z = tip.clone().sub(wrist).normalize();
  const xHint = new Vector3(0, 0, 1);
  let x = xHint.clone().addScaledVector(z, -xHint.dot(z)).normalize();
  if (x.dot(xHint) < 0) x = x.negate();
  let y = new Vector3().crossVectors(z, x);
  if (y.dot(palmExpected) < 0) { x = x.negate(); y = y.negate(); }
  x = new Vector3().crossVectors(y, z).normalize();
  return { x, y, z };
}

/* ------------------------------------------------------------------ */
/* Bind preparation (detached + unrotated): clone, orient, detect      */
/* roles, resolve bones, measure the rig from its own bind pose,       */
/* scale to the register's stature, precompute the finger drives.      */
/* Runs in useMemo on a FRESH clone of the cached GLTF scene, so a     */
/* re-run starts from the pristine bind every time.                    */
/* ------------------------------------------------------------------ */

const BONE_NAMES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
  'LeftShoulder', 'RightShoulder'] as const;

interface PreparedFigure {
  root: Object3D;
  bones: Record<string, Object3D | undefined>;
  base: Record<string, Quaternion>;
  fingers: { Left: FingerJoint[]; Right: FingerJoint[] };
  ankleFlat: number;
  thigh: number;
  shin: number;
}

function prepareFigure(scene: Object3D, reg: FigureRegister): PreparedFigure {
  const root = skeletonClone(scene);
  /* Materials: clone per figure (the GLB scene is cache-shared) and
     take shadows; nothing about the cast art itself changes. */
  root.traverse((o) => {
    const m = o as Mesh;
    if (!(m.isMesh || (m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh)) return;
    m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as Material[];
    const cloned = mats.map((mt) => mt.clone());
    m.material = Array.isArray(m.material) ? cloned : cloned[0]!;
  });
  /* Detached, unrotated holder: world == figure-local for everything
     measured below, whatever seat the figure will sit at. */
  const holder = new Group();
  holder.add(root);
  root.scale.setScalar(1);
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  holder.updateMatrixWorld(true);
  orientUniRig(root);
  holder.updateMatrixWorld(true);
  const roleMap = detectUniRoles(root);
  const byExact = (name: string) => {
    let hit: Object3D | undefined;
    root.traverse((o) => { if (o.name === name) hit = o; });
    return hit;
  };
  const bones: Record<string, Object3D | undefined> = {};
  const base: Record<string, Quaternion> = {};
  for (const n of BONE_NAMES) {
    const b = roleMap[n] ? byExact(roleMap[n]!) : undefined;
    bones[n] = b;
    if (b) base[n] = b.quaternion.clone();
  }
  const jp = (n: string) => bones[n]!.getWorldPosition(new Vector3());
  const bindPos: Record<string, Vector3> = {};
  for (const n of BONE_NAMES) if (bones[n]) bindPos[n] = jp(n);
  const bindBox = new Box3().setFromObject(root);
  /* Grafted fingers: resolve the graft chains hanging off each hand
     bone and precompute each joint's constant local curl delta (the
     sign settled per chain by the prototype's test — rotate the next
     joint +0.3 rad about the axis, keep the sign that moves it
     toward the palm). Rigs without graft joints (Ray's 2-chain
     partial) resolve empty drives and keep their bind fingers. */
  const graftByName = new Map<string, Object3D>();
  root.traverse((o) => { if (o.name.startsWith('graft_')) graftByName.set(o.name, o); });
  const chainEnd = (start: Object3D) => {
    let cur = start;
    for (;;) {
      const kids = cur.children.filter((c) => isBone(c) && !c.name.startsWith('graft_'));
      if (!kids.length) return cur;
      cur = kids[0]!;
    }
  };
  const fingers: { Left: FingerJoint[]; Right: FingerJoint[] } = { Left: [], Right: [] };
  for (const S of ['L', 'R'] as const) {
    const side = S === 'L' ? 'Left' : 'Right';
    const hand = bones[`${side}Hand`];
    if (!hand) continue;
    const wrist = bindPos[`${side}Hand`]!;
    const tip = chainEnd(hand).getWorldPosition(new Vector3());
    const palm = new Vector3(S === 'L' ? -1 : 1, 0, 0);
    const basis = knuckleBasis(wrist, tip, palm);
    for (const F of FINGER_NAMES) {
      const chain: Object3D[] = [];
      for (let k = 1; k <= 4; k++) {
        const j = graftByName.get(`graft_${S}_${F}${k}`);
        if (j) chain.push(j);
      }
      if (chain.length < 2) continue;
      let sign = 1;
      {
        const o = chain[0]!.getWorldPosition(new Vector3());
        const c0 = chain[1]!.getWorldPosition(new Vector3());
        const rot = new Quaternion().setFromAxisAngle(basis.x, 0.3);
        const moved = c0.clone().sub(o).applyQuaternion(rot).add(o);
        sign = moved.sub(c0).dot(palm) > 0 ? 1 : -1;
      }
      chain.forEach((j, k) => {
        const pq = j.parent!.getWorldQuaternion(new Quaternion());
        const axis = basis.x.clone().applyQuaternion(pq.invert()).normalize();
        fingers[side].push({
          bone: j, rest: j.quaternion.clone(), axis,
          angle: sign * FINGER_CURL[F]![k]! * FINGER_GRIP_SCALE[F]!,
        });
      });
    }
  }
  const segLen = (a: string, b: string) => bindPos[a]!.distanceTo(bindPos[b]!);
  const height = bindBox.max.y - bindBox.min.y;
  const s = reg.stature / height;
  root.scale.setScalar(s);
  holder.updateMatrixWorld(true);
  return {
    root, bones, base, fingers,
    ankleFlat: (bindPos.LeftFoot!.y - bindBox.min.y) * s,
    thigh: segLen('LeftUpLeg', 'LeftLeg') * s,
    shin: segLen('LeftLeg', 'LeftFoot') * s,
  };
}

/* ------------------------------------------------------------------ */
/* One seated figure                                                   */
/* ------------------------------------------------------------------ */

interface FigureProps {
  id: string;
  url: string;
  reg: FigureRegister;
  seatPos: SeatPos;
  n: number;
  count: number;
  active: boolean;
  aspect: number;
  view: 'standing' | 'sitting';
  animate: boolean;
  anchors: { trick: Vector3; human: Vector3; heads: Record<string, Vector3> };
}

function Figure({ id, url, reg, seatPos, n, count, active, aspect, view, animate, anchors }: FigureProps) {
  const gltf = useLoader(GLTFLoader, url);
  const prep = useMemo(() => prepareFigure(gltf.scene, reg), [gltf, reg]);
  const groupRef = useRef<Group>(null!);
  const headState = useRef({ yaw: 0, pitch: 0, next: 0, idx: 0 });
  const restCur = useRef<{ drop: number; pinch: number } | null>(null);
  const fanRef = useRef(new Vector3());
  const solvedFrames = useRef(0);

  useEffect(() => {
    const w = window as unknown as { __bwmPorchFigures?: { mounted: string[]; failed: string[] } };
    w.__bwmPorchFigures ??= { mounted: [], failed: [] };
    if (!w.__bwmPorchFigures.mounted.includes(id)) w.__bwmPorchFigures.mounted.push(id);
  }, [id]);

  /* Pose-gate probe (the sandbox's MeasureDump discipline): once the
     pose has settled, publish the measured facts the gates judge —
     hip height over the floor, ankle height, toe-vs-ankle drop (foot
     flatness), and each hand joint's distance to its grip target.
     Samples twice (1.5 s and 5 s): on a starved canvas the first
     sample can land before the solve's first frames, so the second
     overwrites it with the settled pose. */
  useEffect(() => {
    const sample = () => {
      const { root, bones: b } = prep;
      root.updateMatrixWorld(true);
      const wp = (nm: string) => b[nm]?.getWorldPosition(new Vector3());
      const target = fanRestTarget({ aspect, view, seatIsActive: active });
      const fanC = count > 0
        ? new Vector3(...opponentFan(seatPos, n, (count - 1) / 2, count, target.drop, target.pinch).p)
        : null;
      const d = seatDir(seatPos, n);
      const right = new Vector3(-d.z, 0, d.x);
      const gripFor = (side: 'Left' | 'Right') => fanC
        ? fanC.clone().addScaledVector(right, side === 'Left' ? -GRIP_HALF : GRIP_HALF).addScaledVector(d, GRIP_OUT).add(new Vector3(0, -GRIP_DOWN, 0))
        : null;
      const dist = (nm: string, tgt: Vector3 | null) => {
        const p = wp(nm);
        return p && tgt ? Math.round(p.distanceTo(tgt) * 1000) / 1000 : null;
      };
      const v3 = (p?: Vector3) => (p ? [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100] : null);
      const armInfo = (side: 'Left' | 'Right') => {
        const S = wp(`${side}Arm`); const E = wp(`${side}ForeArm`); const H = wp(`${side}Hand`);
        const grip = gripFor(side);
        if (!S || !E || !H) return null;
        return {
          L1: Math.round(S.distanceTo(E) * 1000) / 1000,
          L2: Math.round(E.distanceTo(H) * 1000) / 1000,
          delta: grip ? Math.round(S.distanceTo(grip) * 1000) / 1000 : null,
          grip: v3(grip ?? undefined), hand: v3(H), shoulder: v3(S),
        };
      };
      const y = (nm: string) => { const p = wp(nm); return p ? Math.round(p.y * 1000) / 1000 : null; };
      const w = window as unknown as { __bwmPorchFigures?: { gates?: Record<string, unknown> } };
      w.__bwmPorchFigures ??= { mounted: [], failed: [] } as never;
      (w.__bwmPorchFigures as { gates?: Record<string, unknown> }).gates ??= {};
      (w.__bwmPorchFigures as { gates?: Record<string, unknown> }).gates![id] = {
        hipY: y('Hips'), ankleYL: y('LeftFoot'), ankleYR: y('RightFoot'),
        toeYL: y('LeftToeBase'), toeYR: y('RightToeBase'),
        gripErrL: dist('LeftHand', gripFor('Left')), gripErrR: dist('RightHand', gripFor('Right')),
        ankleFlat: Math.round(prep.ankleFlat * 1000) / 1000,
        armL: armInfo('Left'), armR: armInfo('Right'), fanC: v3(fanC ?? undefined),
      };
    };
    const t1 = window.setTimeout(sample, 1500);
    const t2 = window.setTimeout(sample, 5000);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [prep, id, aspect, view, active, count, seatPos, n]);

  /* Placement + static pose (once, at mount): torso lean in world
     space, hip onto the production chair's seat, legs by two-bone IK
     to flat-foot ankle targets — the sandbox solve, with the Porch
     chair's own seat top in place of the studio's. */
  useLayoutEffect(() => {
    const group = groupRef.current;
    const { root, bones, base } = prep;
    const jp = (nm: string) => bones[nm]!.getWorldPosition(new Vector3());
    const aim = (boneName: string, childName: string, target: Vector3) => {
      const bone = bones[boneName]; const child = bones[childName];
      if (!bone || !child || !bone.parent) return;
      root.updateMatrixWorld(true);
      const pb = bone.getWorldPosition(new Vector3());
      const pc = child.getWorldPosition(new Vector3());
      const cur = pc.sub(pb).normalize();
      const des = target.clone().sub(pb).normalize();
      const R = new Quaternion().setFromUnitVectors(cur, des);
      const qb = bone.getWorldQuaternion(new Quaternion());
      const qp = bone.parent.getWorldQuaternion(new Quaternion());
      bone.quaternion.copy(qp.invert().multiply(R).multiply(qb));
      base[boneName] = bone.quaternion.clone();
      root.updateMatrixWorld(true);
    };
    /* Torso lean: world-space rotation about the seat's right axis,
       verified closed-loop — if the head did not move toward the
       table, the lean is flipped and re-applied. */
    const spot = CHAIR_SPOTS[SPOT_INDEX[seatPos]]!;
    const faceW = seatDir(seatPos, n).negate();
    const leanAxis = new Vector3(0, 1, 0).cross(faceW).normalize();
    const headBefore = jp('Head').clone();
    const lean = (nm: string, a: number) => {
      const b = bones[nm]; if (!b) return;
      rotateBoneWorld(root, b, leanAxis, a);
      base[nm] = b.quaternion.clone();
    };
    lean('Spine', reg.spine[0]); lean('Spine1', reg.spine[1]); lean('Spine2', reg.spine[2]);
    root.updateMatrixWorld(true);
    if (jp('Head').sub(headBefore).dot(faceW) < 0) {
      lean('Spine', -2 * reg.spine[0]); lean('Spine1', -2 * reg.spine[1]); lean('Spine2', -2 * reg.spine[2]);
    }
    /* Hip joints onto the seat: joint world positions converted into
       seat-group space analytically (group = chair spot + ry), the
       root offset so the PELVIS midpoint lands at (centred x,
       PORCH_SEAT_TOP + HIP_OFF, HIP_BACK) in that space. (The sandbox
       centred on the left hip joint alone; the midpoint keeps the
       shoulders symmetric over the chair, which the side seats' grip
       geometry needs.) */
    group.updateMatrixWorld(true);
    root.updateMatrixWorld(true);
    const invQ = new Quaternion().setFromEuler(new Euler(0, -spot.ry, 0));
    const toLocal = (w: Vector3) => w.sub(new Vector3(spot.x, 0, spot.z)).applyQuaternion(invQ);
    const ulL = toLocal(jp('LeftUpLeg'));
    const ulR = toLocal(jp('RightUpLeg'));
    root.position.set(-(ulL.x + ulR.x) / 2, (PORCH_SEAT_TOP + HIP_OFF) - ulL.y, HIP_BACK - (ulL.z + ulR.z) / 2);
    root.updateMatrixWorld(true);
    /* Reach settle (REACH_SCOOT / REACH_LEAN above): measure each
       shoulder's distance to its grip on the OPEN fan (the rested fan
       sits closer, so the open pose is the binding case) and close
       the gap — scoot first, then extra lean — until both grips are
       inside the arms' reach or the caps run out. Runs BEFORE the
       leg solve so the feet plant for the final seat position. */
    if (count > 0) {
      const fanC0 = new Vector3(...opponentFan(seatPos, n, (count - 1) / 2, count, 0, 0).p);
      const d0 = seatDir(seatPos, n);
      const right0 = new Vector3(-d0.z, 0, d0.x);
      const gripOf = (side: 'Left' | 'Right') => fanC0.clone()
        .addScaledVector(right0, side === 'Left' ? -GRIP_HALF : GRIP_HALF)
        .addScaledVector(d0, GRIP_OUT).add(new Vector3(0, -GRIP_DOWN, 0));
      let scoot = 0; let extraLean = 0;
      for (let iter = 0; iter < 6; iter++) {
        root.updateMatrixWorld(true);
        let worst = 0;
        for (const side of ['Left', 'Right'] as const) {
          const S = jp(`${side}Arm`); const E = jp(`${side}ForeArm`); const H = jp(`${side}Hand`);
          const reach = (S.distanceTo(E) + E.distanceTo(H)) * 0.96;
          worst = Math.max(worst, S.distanceTo(gripOf(side)) - reach);
        }
        if (worst <= 0.005) break;
        if (scoot < REACH_SCOOT) {
          const s = Math.min(worst * 0.8, REACH_SCOOT - scoot);
          root.position.z += s; scoot += s;
        } else if (extraLean < REACH_LEAN) {
          const a = Math.min(0.05, REACH_LEAN - extraLean);
          lean('Spine', a * 0.4); lean('Spine1', a * 0.35); lean('Spine2', a * 0.25);
          extraLean += a;
        } else break;
        root.updateMatrixWorld(true);
      }
    }
    /* Legs: two-bone IK to a flat-foot ankle target, then world aim.
       Targets built in seat-group space, converted to world. */
    const sideVec = new Vector3(1, 0, 0).applyQuaternion(new Quaternion().setFromEuler(new Euler(0, spot.ry, 0)));
    for (const side of ['Left', 'Right'] as const) {
      const hipW = jp(`${side}UpLeg`);
      const hipLocal = group.worldToLocal(hipW.clone());
      const ankleLocal = new Vector3(hipLocal.x, FLOOR_Y + prep.ankleFlat, hipLocal.z + ANKLE_FWD);
      const ankle = group.localToWorld(ankleLocal.clone());
      const D = ankle.distanceTo(hipW);
      const a = (prep.thigh * prep.thigh + D * D - prep.shin * prep.shin) / (2 * D);
      const h = Math.sqrt(Math.max(0, prep.thigh * prep.thigh - a * a));
      const axis = ankle.clone().sub(hipW).normalize();
      // Knee bulge: perpendicular to the hip->ankle axis in the seat's
      // sagittal plane, flipped to face the table.
      const perp = new Vector3().crossVectors(axis, sideVec);
      if (perp.dot(faceW) < 0) perp.negate();
      const knee = hipW.clone().addScaledVector(axis, a).addScaledVector(perp, h);
      aim(`${side}UpLeg`, `${side}Leg`, knee);
      aim(`${side}Leg`, `${side}Foot`, ankle);
      const foot = jp(`${side}Foot`);
      aim(`${side}Foot`, `${side}ToeBase`, foot.clone().add(new Vector3(faceW.x, -0.02, faceW.z)));
    }
  }, [prep, seatPos, n, reg]);

  const headWorld = useMemo(() => new Vector3(), []);

  useFrame(({ clock }, dt) => {
    const { root, bones: b, base, fingers } = prep;
    const group = groupRef.current;
    if (!group) return;
    /* Under reduced life the pose still solves (the fan moves with
       the game), but only until the grips settle; breath/gaze/finger
       phase stay frozen — the King figures' animate contract. */
    const settle = !animate && solvedFrames.current > 120;
    /* Fan rest pose for THIS seat, eased toward its target so the
       hands ride the fan down and up with the game's own rest. */
    const target = fanRestTarget({ aspect, view, seatIsActive: active });
    if (!restCur.current || !animate) restCur.current = { ...target };
    else {
      const k = Math.min(1, Math.max(0, dt) * 4.5);
      restCur.current.drop += (target.drop - restCur.current.drop) * k;
      restCur.current.pinch += (target.pinch - restCur.current.pinch) * k;
    }
    const rest = restCur.current;
    /* The fan's centre card, from the same solver the cards use. */
    const hasCards = count > 0;
    const fanC = hasCards
      ? new Vector3(...opponentFan(seatPos, n, (count - 1) / 2, count, rest.drop, rest.pinch).p)
      : group.localToWorld(new Vector3(0, PORCH_SEAT_TOP + 0.3, 0.55));
    fanRef.current.copy(fanC);
    if (settle) return;
    solvedFrames.current++;
    const t = clock.elapsedTime;
    /* Reset the animated bones to the seated base pose, then layer
       procedural life on top (the sandbox contract). */
    for (const nm of ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
      'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand']) {
      if (b[nm] && base[nm]) b[nm]!.quaternion.copy(base[nm]!);
    }
    if (animate) {
      const breath = Math.sin(t * (Math.PI * 2 / reg.breathPeriod)) * reg.breathAmp;
      if (b.Spine1 && base.Spine1) {
        b.Spine1.quaternion.copy(base.Spine1)
          .multiply(new Quaternion().setFromEuler(new Euler(breath * 0.018, 0, 0)));
      }
      if (b.Spine2 && base.Spine2) {
        b.Spine2.quaternion.copy(base.Spine2)
          .multiply(new Quaternion().setFromEuler(new Euler(breath * 0.012, Math.sin(t * 0.23) * 0.01 * reg.swayAmp, Math.sin(t * 0.31) * 0.008 * reg.swayAmp)));
      }
      if (b.Hips && base.Hips) {
        b.Hips.quaternion.copy(base.Hips)
          .multiply(new Quaternion().setFromEuler(new Euler(0, Math.sin(t * 0.17) * 0.02 * reg.swayAmp, Math.sin(t * 0.13) * 0.012 * reg.swayAmp)));
      }
      /* Gaze: a new target every dwell; the head eases toward it by a
         clamped world-space delta (seat-agnostic). */
      const st = headState.current;
      if (t > st.next) { st.idx = (st.idx + 1) % reg.gaze.length; st.next = t + reg.gazeDwell; }
      const key = reg.gaze[st.idx]!;
      const gazeTarget = key === 'fan' ? fanC
        : key === 'trick' ? anchors.trick
        : key === 'human' ? anchors.human
        : (anchors.heads[key] ?? anchors.trick);
      root.updateMatrixWorld(true);
      const aimHead = (boneName: string, factor: number) => {
        const bone = b[boneName]; if (!bone || !bone.parent) return;
        bone.getWorldPosition(headWorld);
        const wq = bone.getWorldQuaternion(new Quaternion());
        const fwd = new Vector3(0, 0, 1).applyQuaternion(wq);
        const des = gazeTarget.clone().sub(headWorld).normalize();
        const delta = new Quaternion().setFromUnitVectors(fwd, des);
        const ang = 2 * Math.acos(Math.max(-1, Math.min(1, delta.w)));
        const clamped = ang > 0.65 ? new Quaternion().slerp(new Quaternion().setFromUnitVectors(fwd, des), 0.65 / ang) : delta;
        const qw = clamped.multiply(wq);
        const qp = bone.parent.getWorldQuaternion(new Quaternion());
        bone.quaternion.slerp(qp.invert().multiply(qw), factor);
      };
      aimHead('Neck', 0.03);
      aimHead('Head', 0.05);
      if (b.Head && base.Head) {
        b.Head.quaternion.multiply(new Quaternion().setFromEuler(new Euler(breath * 0.006, 0, 0)));
      }
    }
    /* Arms: BOTH hands are two-bone-IK'd onto their targets every
       frame — the fan's grip points while the seat holds cards
       (hands behind the fan's lower edge, backs of the cards to the
       table: a bot's faces are never shown), the lap when it holds
       none. The grip must be solved, not guessed (Phase A lesson). */
    const d = seatDir(seatPos, n);
    const right = new Vector3(-d.z, 0, d.x);
    const solveArm = (side: 'Left' | 'Right') => {
      const arm = b[`${side}Arm`], fore = b[`${side}ForeArm`], hand = b[`${side}Hand`];
      if (!arm || !fore || !hand || !arm.parent || !fore.parent) return;
      root.updateMatrixWorld(true);
      const targetPos = hasCards
        ? fanC.clone().addScaledVector(right, side === 'Left' ? -GRIP_HALF : GRIP_HALF).addScaledVector(d, GRIP_OUT).add(new Vector3(0, -GRIP_DOWN, 0))
        : group.localToWorld(new Vector3(side === 'Left' ? 0.18 : -0.18, PORCH_SEAT_TOP + 0.12, 0.25));
      const S = arm.getWorldPosition(new Vector3());
      const E0 = fore.getWorldPosition(new Vector3());
      const H0 = hand.getWorldPosition(new Vector3());
      const L1 = E0.distanceTo(S), L2 = H0.distanceTo(E0);
      const delta = targetPos.clone().sub(S);
      const dist = Math.max(0.05, Math.min(delta.length(), (L1 + L2) * 0.97));
      const axis = delta.normalize();
      const a = (L1 * L1 + dist * dist - L2 * L2) / (2 * dist);
      const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      let pole = E0.clone().sub(S.clone().addScaledVector(axis, E0.clone().sub(S).dot(axis)));
      if (pole.lengthSq() < 1e-6) pole = new Vector3(0, -1, 0); else pole.normalize();
      const E = S.clone().addScaledVector(axis, a).addScaledVector(pole, h);
      const T = S.clone().addScaledVector(axis, dist);
      const aimFull = (bone: Object3D, child: Object3D, tgt: Vector3) => {
        const pb = bone.getWorldPosition(new Vector3());
        const pc = child.getWorldPosition(new Vector3());
        const cur = pc.sub(pb).normalize();
        const des2 = tgt.clone().sub(pb).normalize();
        const R = new Quaternion().setFromUnitVectors(cur, des2);
        const qb = bone.getWorldQuaternion(new Quaternion());
        const qp = bone.parent!.getWorldQuaternion(new Quaternion());
        bone.quaternion.copy(qp.invert().multiply(R).multiply(qb));
      };
      aimFull(arm, fore, E);
      root.updateMatrixWorld(true);
      aimFull(fore, hand, T);
    };
    solveArm('Left');
    solveArm('Right');
    /* Grafted fingers: the curl follows the grip — full while the
       seat is the one to act, a shade softer while its fan rests,
       loose on the lap; a breath of per-hand phase sway keeps it
       from looking machined. Rigs without grafts skip entirely. */
    if (fingers.Left.length || fingers.Right.length) {
      const factor = !hasCards ? 0.45 : active ? 1.0 : 0.8;
      const applyHand = (list: FingerJoint[], phase: number) => {
        const f = animate ? Math.min(1.05, Math.max(0, factor * (1 + 0.03 * Math.sin(t * 1.3 + phase)))) : factor;
        for (const j of list) j.bone.quaternion.setFromAxisAngle(j.axis, j.angle * f).multiply(j.rest);
      };
      applyHand(fingers.Left, 0.7);
      applyHand(fingers.Right, 2.1);
    }
  });

  const spot = CHAIR_SPOTS[SPOT_INDEX[seatPos]]!;
  return (
    <group ref={groupRef} position={[spot.x, 0, spot.z]} rotation={[0, spot.ry, 0]}>
      <primitive object={prep.root} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Failure fallback: a figure that fails to load renders nothing —     */
/* the seat keeps today's portrait plate + fan — and names itself on   */
/* the probe (the Corner sedan's discipline).                          */
/* ------------------------------------------------------------------ */

class FigureBoundary extends Component<{ id: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch() {
    const w = window as unknown as { __bwmPorchFigures?: { mounted: string[]; failed: string[] } };
    w.__bwmPorchFigures ??= { mounted: [], failed: [] };
    if (!w.__bwmPorchFigures.failed.includes(this.props.id)) w.__bwmPorchFigures.failed.push(this.props.id);
  }
  override render() { return this.state.failed ? null : this.props.children; }
}

/* ------------------------------------------------------------------ */
/* The pilot layer: one Figure per occupied bot seat.                  */
/* ------------------------------------------------------------------ */

export interface PorchFiguresProps {
  /** per-seat character ids (null = no figure at that seat) */
  seats: readonly (string | null)[];
  positions: readonly SeatPos[];
  n: number;
  handCounts: readonly number[];
  activeSeat: number | null;
  view: 'standing' | 'sitting';
  /** false under reduced effects: figures seat at rest, static (the
   *  King figures' crowdAnimate contract). */
  animate: boolean;
}

export default function PorchFigures({ seats, positions, n, handCounts, activeSeat, view, animate }: PorchFiguresProps) {
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const aspect = size.width >= 32 && size.height >= 32 ? size.width / size.height : 390 / 844;
  useEffect(() => {
    const w = window as unknown as { __bwmPorchFigures?: { mounted: string[]; failed: string[] } };
    w.__bwmPorchFigures ??= { mounted: [], failed: [] };
  }, []);
  /* The canvas is frameloop="demand": breath/sway/gaze need a pulse
     while the figures live (the KingRail ticker's pattern). */
  useEffect(() => {
    if (!animate) return;
    const id = window.setInterval(() => { if (!document.hidden) invalidate(); }, 50);
    return () => window.clearInterval(id);
  }, [animate, invalidate]);
  const anchors = useMemo(() => {
    const heads: Record<string, Vector3> = {};
    seats.forEach((id, seat) => {
      if (!id) return;
      const spot = CHAIR_SPOTS[SPOT_INDEX[positions[seat]!]]!;
      heads[id] = new Vector3(spot.x, 0.42, spot.z);
    });
    const humanSpot = CHAIR_SPOTS[SPOT_INDEX[positions[0]!]]!;
    return {
      trick: new Vector3(0, 0.02, 0),
      human: new Vector3(humanSpot.x, 0.42, humanSpot.z),
      heads,
    };
  }, [seats, positions]);
  return (
    <>
      {seats.map((id, seat) => {
        if (!id) return null;
        const reg = FIGURE_REGISTERS[id];
        const url = FIGURE_URLS[id];
        if (!reg || !url) return null;
        return (
          <FigureBoundary key={seat} id={id}>
            <Suspense fallback={null}>
              <Figure
                id={id}
                url={url}
                reg={reg}
                seatPos={positions[seat]!}
                n={n}
                count={handCounts[seat] ?? 0}
                active={activeSeat === seat}
                aspect={aspect}
                view={view}
                animate={animate}
                anchors={anchors}
              />
            </Suspense>
          </FigureBoundary>
        );
      })}
    </>
  );
}
