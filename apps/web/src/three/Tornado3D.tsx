import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CircleGeometry, CylinderGeometry, DataTexture, ExtrudeGeometry, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, NormalBlending, Points, PointsMaterial, SRGBColorSpace, ShaderMaterial, Shape, SphereGeometry, Vector3, WebGLRenderTarget, type Camera, type WebGLRenderer } from 'three';
import { fx } from '../fx';
import { HAPTIC, cancelHaptics, haptic } from '../haptics';
import { COW_SPEC, cowLegFoot, cowPatch, cowPose } from './cowPath';
import { FELT } from './layout';
import { SENSOR_BALL_R, SENSOR_COUNT, SENSOR_FIN, SENSOR_LED_EVERY, sensorPose } from './sensorPath';
import { slipperPose } from './slipperPath';
import { TORNADO_PARAMS, TORNADO_POOL, lerpTornadoParams, tornadoDrawCounts, tornadoParams, type TornadoParams } from './tornadoLevel';

/**
 * 'Run it!' funnel over the table centre: swirling dust / wind streaks (grey-violet, normal blend) plus brighter
 * debris flecks (additive), rising and widening up the cone; it spins up, then bursts outward and fades with the fling.
 * Riding inside it: a pair of ruby slippers (see slipperPath), a cow (see cowPath) and a stream of little
 * tracker sensors (see sensorPath), all tumbling around the funnel wall on the funnel's own clock.
 * Reads fx.tornado every frame (no React state), hidden otherwise. Not drawn under Reduce effects.
 *
 * The funnel is ONE parametric system driven by the Run It ladder
 * (tornadoLevel.ts): fx.tornado's rung scales the group (height / mouth),
 * spins the dust faster or slower (uSpin), sizes and densifies the points,
 * gates the pool draw ranges, spreads the base dust ring, and — from the
 * storm rung up — darkens the room and flickers the light. The baseline
 * rung is this funnel exactly as it shipped before the ladder: unit
 * everything, full pools, no shells. The riders keep the funnel's own
 * unscaled clock (their path modules own their timing envelopes); because
 * they are children of the scaled group they travel with the wall at
 * every rung, and the rung gate hides them below the signature rung.
 */
const vert = /* glsl */ `
  attribute vec3 aSeed;
  uniform float uTime, uScale, uSize, uFling, uGrow, uSpin;
  varying float vA; varying float vTint;
  void main() {
    float speed = 0.35 + 0.5 * aSeed.z;
    float h = fract(aSeed.x + uTime * speed);
    float y = h * 1.9 * uGrow;
    float r = (0.07 + 0.62 * h * h + 0.08 * h + aSeed.z * 0.06) * (1.0 + uFling * 4.0);
    float ang = aSeed.y * 6.2832 + uTime * uSpin * (8.5 - 4.5 * h) + h * 3.0;
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
      uTime: { value: 0 }, uScale: { value: 600 }, uSize: { value: opts.size }, uFling: { value: 0 }, uGrow: { value: 0 }, uAlpha: { value: opts.alpha }, uSpin: { value: 1 },
      uColA: { value: opts.a }, uColB: { value: opts.b },
    },
  });
}

/**
 * One stylised ruby slipper, built from primitives: an extruded pump silhouette (toe, vamp,
 * the foot opening, a kitten heel) with a little bow at the vamp, in glossy clearcoat red —
 * plus a pinch of sparkle points hovering just off the leather for the glint. Built in plan
 * units ~0.2 long so it reads as a shoe, not a blob, at table scale on a phone.
 */
function slipperGeometry(): ExtrudeGeometry {
  const s = new Shape();
  s.moveTo(-0.088, 0.0); // heel back, at the floor
  s.lineTo(-0.066, 0.0); // heel bottom
  s.quadraticCurveTo(-0.062, 0.016, -0.038, 0.022); // the arch / waist rising
  s.quadraticCurveTo(0.01, 0.026, 0.062, 0.008); // sole underside toward the toe
  s.quadraticCurveTo(0.09, 0.0, 0.104, 0.002); // toe spring to the tip
  s.quadraticCurveTo(0.108, 0.012, 0.098, 0.02); // rounded toe cap
  s.quadraticCurveTo(0.07, 0.034, 0.028, 0.042); // the vamp rising back
  s.quadraticCurveTo(0.004, 0.036, -0.02, 0.034); // the throat: the opening dips
  s.quadraticCurveTo(-0.052, 0.038, -0.07, 0.052); // the opening rising to the collar
  s.quadraticCurveTo(-0.084, 0.064, -0.086, 0.04); // collar back curve
  s.quadraticCurveTo(-0.088, 0.02, -0.088, 0.0); // back of the heel, down to the floor
  const g = new ExtrudeGeometry(s, { depth: 0.042, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 2, curveSegments: 12 });
  g.translate(0, 0, -0.021);
  return g;
}

interface SlipperRig { group: Group; body: MeshPhysicalMaterial; spark: PointsMaterial }

function buildSlipper(): SlipperRig {
  const body = new MeshPhysicalMaterial({
    color: 0xb3001f, metalness: 0.1, roughness: 0.27, clearcoat: 1, clearcoatRoughness: 0.22,
    emissive: 0x2a000a, transparent: true, opacity: 0,
  });
  // the shoe + bow sit in a sub-group centred on the shoe's middle, so the rig tumbles
  // around its heart instead of its sole
  const shoe = new Group();
  shoe.position.set(-0.01, -0.032, 0);
  shoe.add(new Mesh(slipperGeometry(), body));
  const loopGeo = new SphereGeometry(0.0135, 12, 8);
  for (const side of [-1, 1]) {
    const loop = new Mesh(loopGeo, body);
    loop.scale.set(1.45, 0.72, 0.5);
    loop.position.set(0.048 + side * 0.013, 0.046, side * 0.004);
    loop.rotation.set(0, side * 0.5, side * 0.55);
    shoe.add(loop);
  }
  const knot = new Mesh(new SphereGeometry(0.0085, 10, 8), body);
  knot.position.set(0.048, 0.045, 0);
  shoe.add(knot);
  // sparkle glints hovering just off the leather
  const n = 16;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = -0.1 + Math.random() * 0.21;
    pos[i * 3 + 1] = -0.035 + Math.random() * 0.08;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 0.11;
  }
  const sg = new BufferGeometry();
  sg.setAttribute('position', new BufferAttribute(pos, 3));
  const spark = new PointsMaterial({ color: 0xffd7de, size: 0.02, sizeAttenuation: true, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
  const sparks = new Points(sg, spark);
  sparks.frustumCulled = false;
  const group = new Group();
  group.add(shoe, sparks);
  group.visible = false;
  return { group, body, spark };
}

/** Kept alive so the slipper material's program stays in the table renderer's cache after the warm pass. */
const warmedSlippers: SlipperRig[] = [];

/** The cow's hide: a small procedural texture sampled from cowPatch — white with black blobs. */
function cowHideTexture(): DataTexture {
  const W = 128, H = 64;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const black = cowPatch(x / W, y / H) > 0.5;
      const o = (y * W + x) * 4;
      data[o] = black ? 24 : 247;
      data[o + 1] = black ? 21 : 243;
      data[o + 2] = black ? 21 : 238;
      data[o + 3] = 255;
    }
  }
  const t = new DataTexture(data, W, H);
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** A cylinder strut between two points (legs, tail) — axis along the strut, centred on its middle. */
function limb(from: readonly [number, number, number], to: readonly [number, number, number], r: number, mat: MeshStandardMaterial): Mesh {
  const a = new Vector3(from[0], from[1], from[2]);
  const b = new Vector3(to[0], to[1], to[2]);
  const dir = b.clone().sub(a);
  const mesh = new Mesh(new CylinderGeometry(r, r, dir.length(), 8), mat);
  mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

interface CowRig { group: Group; roll: Group; mats: MeshStandardMaterial[] }

/**
 * The cow, built from primitives to COW_SPEC: a patched ellipsoid body and head, a pink
 * muzzle and udder, four rigid legs stuck straight out (dark hooves at the ends), ears,
 * eyes, and a tail with a dark tuft. The parts sit in a roll group centred on the body,
 * so the slow tumble turns around the cow's spine, not its belly.
 */
function buildCow(): CowRig {
  const hide = new MeshStandardMaterial({ map: cowHideTexture(), roughness: 0.62, metalness: 0, transparent: true, opacity: 0 });
  const white = new MeshStandardMaterial({ color: 0xf7f3ec, roughness: 0.62, metalness: 0, transparent: true, opacity: 0 });
  const pink = new MeshStandardMaterial({ color: 0xd69aa0, roughness: 0.58, metalness: 0, transparent: true, opacity: 0 });
  const dark = new MeshStandardMaterial({ color: 0x211d1d, roughness: 0.55, metalness: 0, transparent: true, opacity: 0 });
  const ball = new SphereGeometry(1, 24, 18);
  const part = (c: readonly [number, number, number], r: readonly [number, number, number], mat: MeshStandardMaterial) => {
    const m = new Mesh(ball, mat);
    m.position.set(c[0], c[1], c[2]);
    m.scale.set(r[0], r[1], r[2]);
    return m;
  };
  const roll = new Group();
  roll.add(part(COW_SPEC.body.c, COW_SPEC.body.r, hide));
  roll.add(part(COW_SPEC.head.c, COW_SPEC.head.r, hide));
  roll.add(part(COW_SPEC.muzzle.c, COW_SPEC.muzzle.r, pink));
  roll.add(part(COW_SPEC.udder.c, COW_SPEC.udder.r, pink));
  for (const sz of [-1, 1]) {
    roll.add(part([COW_SPEC.ear.c[0], COW_SPEC.ear.c[1], sz * COW_SPEC.ear.c[2]], COW_SPEC.ear.r, white));
    const eye = new Mesh(ball, dark);
    eye.position.set(COW_SPEC.eye.c[0], COW_SPEC.eye.c[1], sz * COW_SPEC.eye.c[2]);
    eye.scale.setScalar(COW_SPEC.eye.r);
    roll.add(eye);
    for (const front of [true, false]) {
      const [footX, footY] = cowLegFoot(front);
      const ax = front ? COW_SPEC.leg.attach[0] : -COW_SPEC.leg.attach[0];
      const az = sz * COW_SPEC.leg.attach[2];
      roll.add(limb([ax, COW_SPEC.leg.attach[1], az], [footX, footY, az], COW_SPEC.leg.r, white));
      const hoof = new Mesh(ball, dark);
      hoof.position.set(footX, footY, az);
      hoof.scale.set(COW_SPEC.hoof.r, COW_SPEC.hoof.r * 0.62, COW_SPEC.hoof.r);
      roll.add(hoof);
    }
  }
  roll.add(limb(COW_SPEC.tail.base, COW_SPEC.tail.end, COW_SPEC.tail.r, white));
  const tuft = new Mesh(ball, dark);
  tuft.position.set(COW_SPEC.tail.end[0], COW_SPEC.tail.end[1], COW_SPEC.tail.end[2]);
  tuft.scale.setScalar(COW_SPEC.tail.tuft);
  roll.add(tuft);
  const group = new Group();
  group.add(roll);
  group.visible = false;
  return { group, roll, mats: [hide, white, pink, dark] };
}

/** Kept alive so the cow material programs stay in the table renderer's cache after the warm pass. */
const warmedCows: CowRig[] = [];

interface SensorRig { group: Group; fin: Group; mat: MeshStandardMaterial; led: MeshBasicMaterial | null }

/**
 * One tracker sensor: a small metallic ball with a finned cap — a short mast topped with
 * two crossed blades that whir as it climbs. Every few sensors carry a tiny blinking light.
 */
function buildSensor(i: number): SensorRig {
  const mat = new MeshStandardMaterial({ color: 0xd4dae1, metalness: 0.85, roughness: 0.35, transparent: true, opacity: 0 });
  const group = new Group();
  group.add(new Mesh(new SphereGeometry(SENSOR_BALL_R, 14, 10), mat));
  const fin = new Group();
  fin.position.y = SENSOR_BALL_R;
  const mast = new Mesh(new CylinderGeometry(SENSOR_FIN.mastR, SENSOR_FIN.mastR, SENSOR_FIN.mastH, 6), mat);
  mast.position.y = SENSOR_FIN.mastH / 2;
  fin.add(mast);
  const bladeGeo = new BoxGeometry(SENSOR_FIN.span, 0.003, 0.013);
  for (const rot of [0, Math.PI / 2]) {
    const blade = new Mesh(bladeGeo, mat);
    blade.position.y = SENSOR_FIN.bladeY;
    blade.rotation.y = rot;
    fin.add(blade);
  }
  group.add(fin);
  let led: MeshBasicMaterial | null = null;
  if (i % SENSOR_LED_EVERY === 0) {
    led = new MeshBasicMaterial({ color: 0xff5545, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
    const dot = new Mesh(new SphereGeometry(0.007, 8, 6), led);
    dot.position.set(SENSOR_BALL_R * 0.92, 0.006, 0);
    group.add(dot);
  }
  group.visible = false;
  return { group, fin, mat, led };
}

/** Kept alive so the sensor material programs stay in the table renderer's cache after the warm pass. */
const warmedSensors: SensorRig[] = [];

function tornadoParts(hi: boolean) {
  const pool = hi ? TORNADO_POOL.high : TORNADO_POOL.low;
  return {
    dust: cloud(pool.dust),
    debris: cloud(pool.debris),
    dustMat: mat({ size: 0.26, alpha: 0.72, a: [0.5, 0.48, 0.58], b: [0.36, 0.26, 0.55], additive: false }),
    debrisMat: mat({ size: 0.06, alpha: 1.0, a: [0.95, 0.85, 1.0], b: [0.6, 0.95, 0.7], additive: true }),
  };
}

/* ------------------------------------------------------- ladder dressing
 * One shared unit-circle geometry serves the base dust ring and the two
 * room shells, so a rung adds no new particle systems — just three flat
 * discs whose scale / opacity the frame loop drives from the rung. */
const discGeo = new CircleGeometry(1, 48);

interface TornadoShells { ring: Mesh<CircleGeometry, MeshBasicMaterial>; dark: Mesh<CircleGeometry, MeshBasicMaterial>; flash: Mesh<CircleGeometry, MeshBasicMaterial> }

function buildShells(): TornadoShells {
  const flat = (color: number, opacity: number) => {
    const m = new Mesh(discGeo, new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 4;
    m.visible = false;
    return m;
  };
  const shells = { ring: flat(0xb2a48a, 0), dark: flat(0x05070f, 0), flash: flat(0xe6eeff, 0) };
  // staggered a hair apart in height so the three flat discs never z-fight
  shells.dark.position.y = 0.001;
  shells.flash.position.y = 0.0025;
  shells.ring.position.y = 0.004;
  return shells;
}

/** Kept alive so the shells' basic-material program stays in the table renderer's cache after the warm pass. */
const warmedShells: TornadoShells[] = [];

/**
 * Deterministic 18 Hz flicker hash (the prototype ladder's storm light):
 * a pure function of the frame's time slice — no Math.random, so the
 * flicker is identical on every client watching the same funnel clock.
 */
function flickerHash(u: number): number {
  const x = Math.sin(Math.floor(u * 18) * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Room-shell strengths for a rung at funnel clock u: darkness that pulses
 *  with the flicker, and the faint light flash on the hash's peaks. */
function shellLevels(p: TornadoParams, u: number): { dark: number; flash: number } {
  const h = flickerHash(u);
  const pulse = p.flicker > 0 && h > 0.62 ? (h - 0.62) * 2.4 : 0;
  return {
    dark: p.dark * (0.55 + 0.3 * Math.min(1, pulse)),
    flash: p.flicker > 0 && h > 0.94 ? p.flicker * 0.16 : 0,
  };
}

/** Kept alive so the linked program stays in the table renderer's cache after the warm pass. */
const warmed: ReturnType<typeof tornadoParts>[] = [];

/**
 * Link the funnel shaders on the table's renderer, into a 4×4 target the player never sees.
 * The real Tornado3D draw later hits that cached program instead of compiling mid-spin.
 */
export async function warmTornado(gl: WebGLRenderer, camera: Camera, quality: 'high' | 'low'): Promise<void> {
  const parts = tornadoParts(quality === 'high');
  warmed.push(parts);
  const group = new Group();
  for (const [geo, material] of [[parts.dust, parts.dustMat], [parts.debris, parts.debrisMat]] as const) {
    const points = new Points(geo, material);
    points.frustumCulled = false;
    group.add(points);
  }
  // the slippers' clearcoat program links here too, not on the first run's first frame
  const warmSlip = buildSlipper();
  warmSlip.group.visible = true;
  warmSlip.body.opacity = 1;
  warmedSlippers.push(warmSlip);
  group.add(warmSlip.group);
  // …and the cow's and a sensor's standard-material programs
  const warmCow = buildCow();
  warmCow.group.visible = true;
  for (const m of warmCow.mats) m.opacity = 1;
  warmedCows.push(warmCow);
  group.add(warmCow.group);
  const warmSensor = buildSensor(0);
  warmSensor.group.visible = true;
  warmSensor.mat.opacity = 1;
  if (warmSensor.led) warmSensor.led.opacity = 1;
  warmedSensors.push(warmSensor);
  group.add(warmSensor.group);
  // …and the ladder's ring / room shells link here too
  const warmShells = buildShells();
  for (const m of [warmShells.ring, warmShells.dark, warmShells.flash]) { m.visible = true; m.material.opacity = 0.5; group.add(m); }
  warmedShells.push(warmShells);
  const target = new WebGLRenderTarget(4, 4);
  const prev = gl.getRenderTarget();
  try {
    gl.setRenderTarget(target);
    await gl.compileAsync(group, camera);
    gl.render(group, camera);
    gl.getContext().flush();
  } finally {
    gl.setRenderTarget(prev);
    target.dispose();
  }
}

export function Tornado3D({ quality }: { quality: 'high' | 'low' }) {
  const hi = quality === 'high';
  const parts = useMemo(() => tornadoParts(hi), [hi]);
  // the ruby slippers ride the funnel — same clock, same show flag, both run kinds
  const slippers = useMemo(() => [buildSlipper(), buildSlipper()], []);
  // …and so do the cow and the tracker sensors — same stage, same suppression
  const cow = useMemo(() => buildCow(), []);
  const sensors = useMemo(() => Array.from({ length: SENSOR_COUNT }, (_, i) => buildSensor(i)), []);
  // the ladder dressing: base dust ring + the dark / flicker room shells
  const shells = useMemo(() => buildShells(), []);
  const dust = useRef<Points>(null), debris = useRef<Points>(null);
  const funnel = useRef<Group>(null);
  const spun = useRef(false);
  const hit = useRef(false);
  const skipped = useRef(false);
  const size = useThree((s) => s.size);
  useFrame(({ invalidate }) => {
    const T = fx.tornado;
    const show = !!T && !T.reduced;
    if (dust.current) dust.current.visible = show;
    if (debris.current) debris.current.visible = show;
    // the funnel is suppressed (Reduce effects), so are the slippers — they have no life of their own
    if (!show) for (const s of slippers) s.group.visible = false;
    // …and the cow and the sensors are suppressed with it too
    if (!show) { cow.group.visible = false; for (const s of sensors) s.group.visible = false; }
    // …and the ladder dressing hides with the funnel it belongs to
    if (!show) for (const m of [shells.ring, shells.dark, shells.flash]) m.visible = false;
    // checks (e2e): the funnel is actually being drawn this frame
    (window as unknown as { __bwmTornadoDrawn?: boolean }).__bwmTornadoDrawn = show;
    (window as unknown as { __bwmSlippersDrawn?: boolean }).__bwmSlippersDrawn = false;
    (window as unknown as { __bwmCowDrawn?: boolean }).__bwmCowDrawn = false;
    (window as unknown as { __bwmSensorsDrawn?: boolean }).__bwmSensorsDrawn = false;
    (window as unknown as { __bwmTornadoLevel?: number }).__bwmTornadoLevel = T?.level ?? 2;
    if (!T) { spun.current = false; hit.current = false; skipped.current = false; return; }
    if (T.reduced) {
      if (!skipped.current) { skipped.current = true; cancelHaptics('tornado-skipped'); }
      return;
    }
    // starts winding up ~0.4 s before the pull, flings at 1.25 s, gone by ~1.9 s
    // u = 0 is the spin-up; u = 1.65 is the fling (t = 1.25s). Patterns fire as those marks are crossed.
    const u = (fx.warp !== null ? fx.warp : (performance.now() - T.start) / 1000) + 0.4;
    if (!spun.current && u >= 0) { spun.current = true; haptic(HAPTIC.tornadoSpin, 'tornado-spin'); }
    if (!hit.current && u >= 1.65) { hit.current = true; haptic(HAPTIC.tornadoImpact, 'tornado-impact'); }
    // the ladder: this funnel blends from the previous rung to its claimed
    // rung across its grow phase, so the escalation is seen arriving; an
    // unstamped tornado is the baseline rung, exactly as it always was
    const target = tornadoParams(T.level ?? 2);
    const prev = TORNADO_PARAMS[Math.max(0, target.level - 2)]!;
    const grow = Math.min(1, Math.max(0, u / 0.7));
    const P = lerpTornadoParams(prev, target, grow);
    const counts = tornadoDrawCounts(target.level, hi);
    parts.dust.setDrawRange(0, Math.round(counts.dust * (P.dustFrac / Math.max(target.dustFrac, 1e-6))));
    parts.debris.setDrawRange(0, Math.round(counts.debris * (P.debrisFrac / Math.max(target.debrisFrac, 1e-6))));
    if (funnel.current) funnel.current.scale.set(P.radiusX, P.height / 1.9, P.radiusX);
    for (const [m, base] of [[parts.dustMat, { size: 0.26, alpha: 0.72 }], [parts.debrisMat, { size: 0.06, alpha: 1.0 }]] as const) {
      m.uniforms.uTime!.value = u;
      m.uniforms.uScale!.value = size.height * 0.9;
      m.uniforms.uGrow!.value = grow;
      m.uniforms.uFling!.value = Math.min(1, Math.max(0, (u - 1.65) / 0.6));
      m.uniforms.uSpin!.value = P.spin;
      m.uniforms.uSize!.value = base.size * P.pointSize;
      m.uniforms.uAlpha!.value = base.alpha * P.body;
    }
    // the base dust ring spreads with the rung; the room shells come up
    // with the grow and die with the fling (renderOrder 4: over the room
    // and the cards, under the funnel points at 5/6 and the riders at 6,
    // so the funnel stays lit while the room goes down)
    const fling = Math.min(1, Math.max(0, (u - 1.65) / 0.6));
    const env = grow * (1 - fling);
    const sl = shellLevels(P, u);
    shells.ring.visible = env > 0.01;
    shells.ring.scale.setScalar(Math.max(0.001, P.ringR));
    shells.ring.material.opacity = 0.16 * P.body * env;
    shells.dark.visible = sl.dark > 0.004 && env > 0.01;
    shells.dark.scale.setScalar(Math.max(FELT.hx, FELT.hz) * 2.4);
    shells.dark.material.opacity = Math.min(0.62, sl.dark) * env;
    shells.flash.visible = sl.flash > 0.004 && env > 0.01;
    shells.flash.scale.copy(shells.dark.scale);
    shells.flash.material.opacity = sl.flash * env;
    let slipDrawn = false;
    slippers.forEach((s, i) => {
      const pose = slipperPose(u, i as 0 | 1);
      s.group.visible = P.signature && pose.alpha > 0.02;
      if (!s.group.visible) return;
      slipDrawn = true;
      s.group.position.set(pose.x, pose.y, pose.z);
      s.group.rotation.set(pose.rx, pose.ry, pose.rz);
      s.body.opacity = pose.alpha;
      s.spark.opacity = pose.glint;
    });
    (window as unknown as { __bwmSlippersDrawn?: boolean }).__bwmSlippersDrawn = slipDrawn;
    // the cow: one slow spine roll inside its heading — deadpan at funnel speed
    const cp = cowPose(u);
    cow.group.visible = P.signature && cp.alpha > 0.02;
    if (cow.group.visible) {
      cow.group.position.set(cp.x, cp.y, cp.z);
      cow.group.rotation.set(0, cp.ry, cp.rz);
      cow.roll.rotation.x = cp.rx;
      for (const m of cow.mats) m.opacity = cp.alpha;
    }
    (window as unknown as { __bwmCowDrawn?: boolean }).__bwmCowDrawn = cow.group.visible;
    // the sensors: a staggered stream spiralling up inside the wall
    let sensorsDrawn = false;
    sensors.forEach((s, i) => {
      const pose = sensorPose(u, i);
      s.group.visible = P.signature && pose.alpha > 0.02;
      if (!s.group.visible) return;
      sensorsDrawn = true;
      s.group.position.set(pose.x, pose.y, pose.z);
      s.group.rotation.set(pose.rx, pose.ry, pose.rz);
      s.fin.rotation.y = pose.fin;
      s.mat.opacity = pose.alpha;
      if (s.led) s.led.opacity = pose.blink;
    });
    (window as unknown as { __bwmSensorsDrawn?: boolean }).__bwmSensorsDrawn = sensorsDrawn;
    invalidate();
  });
  return (
    <group position={[0, 0.02, 0]}>
      <primitive object={shells.dark} />
      <primitive object={shells.flash} />
      <group ref={funnel}>
        <points ref={dust} geometry={parts.dust} material={parts.dustMat} frustumCulled={false} visible={false} renderOrder={5} />
        <points ref={debris} geometry={parts.debris} material={parts.debrisMat} frustumCulled={false} visible={false} renderOrder={6} />
        <primitive object={slippers[0]!.group} />
        <primitive object={slippers[1]!.group} />
        <primitive object={cow.group} />
        {sensors.map((s, i) => (
          <primitive key={i} object={s.group} />
        ))}
      </group>
      <primitive object={shells.ring} />
    </group>
  );
}
