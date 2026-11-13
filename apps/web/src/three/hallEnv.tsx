import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { Color, DataUtils, EquirectangularReflectionMapping, HalfFloatType, LinearSRGBColorSpace, Mesh, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, PMREMGenerator, PlaneGeometry, Scene, SphereGeometry, Vector3, WebGLRenderTarget, type Material, type Texture, type WebGLRenderer } from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { nextFrame } from './shaderBudget';

const HDRI_URL = '/assets/hdri/billiard_hall_512.hdr';

/** Same axes three uses inside PMREMGenerator._applyPMREM, so a yielded blur matches a one-shot bake. */
const PHI = (1 + Math.sqrt(5)) / 2;
const INV_PHI = 1 / PHI;
const AXES = [
  new Vector3(-PHI, INV_PHI, 0),
  new Vector3(PHI, INV_PHI, 0),
  new Vector3(-INV_PHI, 0, PHI),
  new Vector3(INV_PHI, 0, PHI),
  new Vector3(0, PHI, -INV_PHI),
  new Vector3(0, PHI, INV_PHI),
  new Vector3(-1, 1, -1),
  new Vector3(1, 1, -1),
  new Vector3(-1, 1, 1),
  new Vector3(1, 1, 1),
];

type Steps = PMREMGenerator & {
  _setSize(n: number): void;
  _allocateTargets(): WebGLRenderTarget;
  _textureToCubeUV(texture: Texture, target: WebGLRenderTarget): void;
  _halfBlur(targetIn: WebGLRenderTarget, targetOut: WebGLRenderTarget, lodIn: number, lodOut: number, sigma: number, direction: string, poleAxis?: Vector3): void;
  _cleanup(target: WebGLRenderTarget): void;
  _lodPlanes: unknown[];
  _sigmas: number[];
  _pingPongRenderTarget: WebGLRenderTarget;
};

/**
 * The billiard-hall environment, filtered one mip at a time.
 * drei's <Environment> runs PMREMGenerator.fromEquirectangular inside a single frame: on a phone
 * that is a multi-second main-thread stall after the table is already up. The filtered map is the
 * same one three would build in one shot; only the scheduling changes.
 *
 * SHELL WHITEOUT GUARD (2026-11-10): in the iOS app shell (WKWebView) this private-internals
 * drive mis-baked on the owner's phone — the scene came up washed to white on every up-facing
 * surface while a second venue (no hall bake) rendered fine, and the same bake is correct in
 * Safari. The custom drive leans on PMREMGenerator internals whose state (render-target stack,
 * probe programs, half-float targets) is only ever exercised by three itself through the PUBLIC
 * entry points, so a platform whose WebGL2 behaves differently anywhere in that chain can hand
 * back a map full of blown values, and HallAttach would install it unchecked. The bake is now
 * VALIDATED before it can reach the scene (probeEnvMeanLuminance + assessBake below): a sane
 * bake passes untouched — same map, same look, one extra 16×16 probe render — a blown one is
 * retried once through the public fromEquirectangular path three supports, and if that is blown
 * too the bake is rejected outright, leaving the pre-bake default environment (the room lit by
 * its lights alone) instead of white light. White is the only outcome this guard can remove.
 */
export function ClassicHall({ active, onMap, url = HDRI_URL }: { active: boolean; onMap: (texture: Texture) => void; url?: string }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const loader = new RGBELoader();
    loader.load(url, (tex) => {
      tex.mapping = EquirectangularReflectionMapping;
      void filterHall(gl, tex, () => alive).then((map) => {
        if (!alive || !map) { tex.dispose(); return; }
        onMap(map);
        invalidate();
      });
    });
    return () => { alive = false; };
  }, [active, gl, invalidate, onMap, url]);
  return null;
}

/** PMREM draws into a linear target, so its programs are not the screen's tone-mapped ones. */
async function forceLinearProgram(gl: WebGLRenderer, material: Material): Promise<void> {
  await nextFrame();
  const rt = new WebGLRenderTarget(4, 4);
  const holder = new Scene();
  const geo = new PlaneGeometry(2, 2);
  holder.add(new Mesh(geo, material));
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = gl.getRenderTarget();
  try {
    gl.setRenderTarget(rt);
    gl.compile(holder, cam);
    gl.render(holder, cam);
  } finally {
    gl.setRenderTarget(prev);
    geo.dispose();
    rt.dispose();
  }
}

/**
 * The brightest face of a baked environment, measured — not assumed: the mean linear luminance
 * it delivers to a surface, taken from six sides, largest returned.
 * A roughness-1 sphere of known albedo (0.05) is rendered under the candidate map alone (no
 * lights) into a tiny linear target and read back: outgoing ≈ albedo × mean radiance, so the
 * readback ÷ albedo estimates the map's mean luminance on the same scale as the source HDR's.
 * Render targets skip tone mapping and output encoding, so the bytes are linear. Any failure
 * (no readback support, context trouble) returns null — "cannot measure", never a verdict.
 */
const PROBE_ALBEDO = 0.05;
const PROBE_SIZE = 16;
/** Where the probe camera stands, as unit directions from the sphere: above first (the face that
 *  lights the table), then below and the four sides. */
export const PROBE_VIEWS: readonly (readonly [number, number, number])[] = [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]];

export async function probeEnvMeanLuminance(gl: WebGLRenderer, env: Texture): Promise<number | null> {
  const rt = new WebGLRenderTarget(PROBE_SIZE, PROBE_SIZE);
  const geo = new SphereGeometry(1, 24, 16);
  const mat = new MeshStandardMaterial({ roughness: 1, metalness: 0 });
  mat.color = new Color().setRGB(PROBE_ALBEDO, PROBE_ALBEDO, PROBE_ALBEDO, LinearSRGBColorSpace);
  const holder = new Scene();
  holder.environment = env;
  holder.add(new Mesh(geo, mat));
  const cam = new PerspectiveCamera(35, 1, 0.1, 10);
  const prev = gl.getRenderTarget();
  try {
    await nextFrame();
    gl.setRenderTarget(rt);
    const px = new Uint8Array(PROBE_SIZE * PROBE_SIZE * 4);
    let worst: number | null = null;
    // The centre of the frame only shows the part of the sphere that faces the camera, so one
    // view only measures the light arriving from one side. The whiteout this guards against
    // lands on UP-FACING surfaces (felt, cards on the table) — a single side-on view read a
    // normal value and passed a bake that was blown overhead (owner, 2026-11-12, Mansion on
    // iPhone, after the limit itself had been tightened). Look at the sphere from every side
    // and judge the bake by its brightest face.
    for (const [x, y, z] of PROBE_VIEWS) {
      cam.position.set(x * 2.4, y * 2.4, z * 2.4);
      cam.up.set(0, y === 0 ? 1 : 0, y === 0 ? 0 : -1);
      cam.lookAt(0, 0, 0);
      gl.render(holder, cam);
      gl.readRenderTargetPixels(rt, 0, 0, PROBE_SIZE, PROBE_SIZE, px);
      // The sphere overfills the frame at this distance, so the centre block is all surface.
      let sum = 0;
      let n = 0;
      const lo = PROBE_SIZE / 4;
      const hi = (PROBE_SIZE * 3) / 4;
      for (let py = lo; py < hi; py++) {
        for (let pxl = lo; pxl < hi; pxl++) {
          const i = (py * PROBE_SIZE + pxl) * 4;
          sum += (0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!) / 255;
          n++;
        }
      }
      if (!n) continue;
      const mean = sum / n / PROBE_ALBEDO;
      if (worst === null || mean > worst) worst = mean;
    }
    return worst;
  } catch {
    return null;
  } finally {
    gl.setRenderTarget(prev);
    geo.dispose();
    mat.dispose();
    rt.dispose();
  }
}

/** Mean linear luminance of the decoded equirect source, sampled from its texels (stride ~8k). */
export function sourceMeanLuminance(tex: Texture): number {
  const image = tex.image as { data?: ArrayLike<number> } | undefined;
  const data = image?.data;
  if (!data || data.length < 4) return NaN;
  const half = tex.type === HalfFloatType;
  const texels = Math.floor(data.length / 4);
  const step = Math.max(1, Math.floor(texels / 8192)) * 4;
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 2 < data.length; i += step) {
    const r = half ? DataUtils.fromHalfFloat(data[i]!) : data[i]!;
    const g = half ? DataUtils.fromHalfFloat(data[i + 1]!) : data[i + 1]!;
    const b = half ? DataUtils.fromHalfFloat(data[i + 2]!) : data[i + 2]!;
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) continue;
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    n++;
  }
  return n ? sum / n : NaN;
}

/**
 * What the probe SHOULD read on the brightest face of a correct bake: the source's own
 * cosine-weighted mean radiance toward each of the six axes, largest returned. A room is not
 * evenly lit — under the Mansion's chandelier the up face reads about three times the room's
 * mean — so the brightest face of the bake has to be judged against the brightest face of the
 * source, not against the average. Equirect rows run pole to pole and columns once around, so
 * whichever way up or round the file is stored, the six axes are the same six.
 */
export function sourceBrightestFace(tex: Texture): number {
  const image = tex.image as { data?: ArrayLike<number>; width?: number; height?: number } | undefined;
  const data = image?.data;
  const W = image?.width ?? 0;
  const H = image?.height ?? 0;
  if (!data || W < 2 || H < 2 || data.length < W * H * 4) return NaN;
  const half = tex.type === HalfFloatType;
  const sx = Math.max(1, Math.floor(W / 96));
  const sy = Math.max(1, Math.floor(H / 48));
  const face = [0, 0, 0, 0, 0, 0];
  const weight = [0, 0, 0, 0, 0, 0];
  for (let row = 0; row < H; row += sy) {
    const theta = ((row + 0.5) / H) * Math.PI; // 0 at one pole, π at the other
    const sinT = Math.sin(theta);
    const y = Math.cos(theta);
    for (let col = 0; col < W; col += sx) {
      const i = (row * W + col) * 4;
      const r = half ? DataUtils.fromHalfFloat(data[i]!) : data[i]!;
      const g = half ? DataUtils.fromHalfFloat(data[i + 1]!) : data[i + 1]!;
      const b = half ? DataUtils.fromHalfFloat(data[i + 2]!) : data[i + 2]!;
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) continue;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const phi = ((col + 0.5) / W) * Math.PI * 2;
      const x = sinT * Math.cos(phi);
      const z = sinT * Math.sin(phi);
      const dots = [y, -y, x, -x, z, -z];
      for (let k = 0; k < 6; k++) {
        const d = dots[k]!;
        if (d <= 0) continue;
        face[k]! += lum * d * sinT;
        weight[k]! += d * sinT;
      }
    }
  }
  let best = NaN;
  for (let k = 0; k < 6; k++) {
    if (!(weight[k]! > 0)) continue;
    const v = face[k]! / weight[k]!;
    if (!(best >= v)) best = v;
  }
  return best;
}

/** The scale a bake is held to: the source's mean, or its brightest face when that is brighter. */
export function sourceScale(tex: Texture): number {
  const mean = sourceMeanLuminance(tex);
  const face = sourceBrightestFace(tex);
  if (!Number.isFinite(mean)) return face;
  if (!Number.isFinite(face)) return mean;
  return Math.max(mean, face);
}

/**
 * How bright a bake may come out before it is called blown.
 *
 * PMREM conserves energy: a correct bake delivers about the light its source contains. So the
 * limit is RELATIVE to the source — four times its mean — with a small absolute floor, because
 * the probe reads back through 8 bits and cannot resolve a very dim map any finer than that.
 *
 * It used to be max(3, 4 × source): tuned for the old billiard-hall HDRI (mean ~0.6), and far
 * too loose for the rendered rooms that light the table now. Their sources are dim — Classic
 * Studio's is 0.087, the Speakeasy's 0.021 — so a bake thirty times too bright still measured
 * under 3 and shipped, flooding the felt and the cards white (owner, 2026-11-12, iPhone, mid
 * game). HALL_ENV_MAX_MEAN is now only the limit when the source cannot be measured at all.
 */
export const HALL_ENV_MAX_MEAN = 3;
export const HALL_ENV_MIN_LIMIT = 0.6;

export function bakeLimit(sourceMean: number): number {
  return Number.isFinite(sourceMean) && sourceMean > 0 ? Math.max(HALL_ENV_MIN_LIMIT, sourceMean * 4) : HALL_ENV_MAX_MEAN;
}

/** 'ok' also covers "cannot measure" — an unmeasurable bake is not evidence against a working platform. */
export function assessBake(sourceMean: number, probeLum: number | null): 'ok' | 'blown' {
  if (probeLum === null || !Number.isFinite(probeLum)) return 'ok';
  return probeLum > bakeLimit(sourceMean) ? 'blown' : 'ok';
}

/** QA: what the last bake measured, on window.__bwmHallEnv (source mean, limit, probe readings, which path shipped). */
function note(v: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __bwmHallEnv?: Record<string, unknown> };
  w.__bwmHallEnv = { ...(w.__bwmHallEnv ?? {}), ...v };
}

/** Ceiling for source texels on the retry bake (linear). */
export const RETRY_SOURCE_MAX = 4;

/** Cap every colour channel of a decoded HDR source in place. Returns how many values it changed. */
export function clampSource(tex: Texture, max: number): number {
  const image = tex.image as { data?: { length: number; [i: number]: number } } | undefined;
  const data = image?.data;
  if (!data || data.length < 4) return 0;
  const half = tex.type === HalfFloatType;
  const cap = half ? DataUtils.toHalfFloat(max) : max;
  let changed = 0;
  for (let i = 0; i < data.length; i++) {
    if (i % 4 === 3) continue; // alpha
    const v = half ? DataUtils.fromHalfFloat(data[i]!) : data[i]!;
    if (!(v <= max)) { data[i] = cap; changed++; } // also catches NaN and Infinity
  }
  if (changed) tex.needsUpdate = true;
  return changed;
}

async function filterHall(gl: WebGLRenderer, tex: Texture, alive: () => boolean): Promise<Texture | null> {
  const gen = new PMREMGenerator(gl) as Steps;
  const prevTarget = gl.getRenderTarget();
  try {
    if (!alive() || !tex.image) return null;
    // Named for the mean it used to be: now the source's brightest face (see sourceScale).
    const sourceMean = sourceScale(tex);
    const image = tex.image as { width?: number };
    gen._setSize((image.width ?? 512) / 4);
    const target = gen._allocateTargets();
    await nextFrame();
    if (!alive()) return null;
    gen.compileEquirectangularShader();
    const equirect = (gen as unknown as { _equirectMaterial: Material | null })._equirectMaterial;
    if (equirect) { equirect.name = 'pmrem-equirect'; await forceLinearProgram(gl, equirect); }
    const blurMat = (gen as unknown as { _blurMaterial: Material | null })._blurMaterial;
    if (blurMat) { blurMat.name = 'pmrem-blur'; await forceLinearProgram(gl, blurMat); }
    await nextFrame();
    if (!alive()) return null;
    gen._textureToCubeUV(tex, target);
    await nextFrame();
    const n = gen._lodPlanes.length;
    const autoClear = gl.autoClear;
    gl.autoClear = false;
    for (let i = 1; i < n; i++) {
      if (!alive()) { gl.autoClear = autoClear; return null; }
      const sigma = Math.sqrt(gen._sigmas[i]! ** 2 - gen._sigmas[i - 1]! ** 2);
      const pole = AXES[(n - i - 1) % AXES.length];
      gen._halfBlur(target, gen._pingPongRenderTarget, i - 1, i, sigma, 'latitudinal', pole);
      await nextFrame();
      if (!alive()) { gl.autoClear = autoClear; return null; }
      gen._halfBlur(gen._pingPongRenderTarget, target, i, i, sigma, 'longitudinal', pole);
      await nextFrame();
    }
    gl.autoClear = autoClear;
    gen._cleanup(target);
    // _cleanup restores the module statics captured by whichever PMREM ran last through the
    // public entry points — possibly another consumer's target. Put back the one this renderer
    // actually had bound when the bake started.
    if (gl.getRenderTarget() !== prevTarget) gl.setRenderTarget(prevTarget);
    const probe = await probeEnvMeanLuminance(gl, target.texture);
    note({ source: sourceMean, limit: bakeLimit(sourceMean), probe, path: 'stepped' });
    if (assessBake(sourceMean, probe) === 'ok') return target.texture;
    // Blown bake: never ship it. Retry once through the public path three supports, where the
    // generator manages its own state end to end, and validate that too.
    try { target.dispose(); } catch { /* already gone */ }
    if (!alive()) return null;
    // Tame the source first. Whatever goes wrong on the device, it goes wrong around the very
    // bright texels (a chandelier, a streetlight, the sun: tens to thousands of times the room's
    // mean). Capped, the retry has nothing extreme left to blow up, and the room still lights
    // the table; only the hottest glints in reflections are lost.
    clampSource(tex, RETRY_SOURCE_MAX);
    const pub = new PMREMGenerator(gl);
    try {
      pub.compileEquirectangularShader();
      const rt2 = pub.fromEquirectangular(tex);
      const probe2 = await probeEnvMeanLuminance(gl, rt2.texture);
      note({ probe2, path: assessBake(sourceMean, probe2) === 'ok' ? 'retry' : 'rejected' });
      if (assessBake(sourceMean, probe2) === 'ok') return rt2.texture;
      try { rt2.dispose(); } catch { /* already gone */ }
    } catch { /* public path failed too — fall through to no environment */ }
    finally { try { pub.dispose(); } catch { /* already gone */ } }
    return null;
  } catch {
    return null;
  } finally {
    // The source used to be disposed right after _textureToCubeUV; the public-path retry needs
    // it alive, so disposal now happens once, here, on every exit.
    try { tex.dispose(); } catch { /* already gone */ }
    try { gen.dispose(); } catch { /* already gone */ }
  }
}
