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
 * Mean linear luminance a baked environment would actually deliver, measured — not assumed.
 * A roughness-1 sphere of known albedo (0.05) is rendered under the candidate map alone (no
 * lights) into a tiny linear target and read back: outgoing ≈ albedo × mean radiance, so the
 * readback ÷ albedo estimates the map's mean luminance on the same scale as the source HDR's.
 * Render targets skip tone mapping and output encoding, so the bytes are linear. Any failure
 * (no readback support, context trouble) returns null — "cannot measure", never a verdict.
 */
const PROBE_ALBEDO = 0.05;
const PROBE_SIZE = 16;

export async function probeEnvMeanLuminance(gl: WebGLRenderer, env: Texture): Promise<number | null> {
  const rt = new WebGLRenderTarget(PROBE_SIZE, PROBE_SIZE);
  const geo = new SphereGeometry(1, 24, 16);
  const mat = new MeshStandardMaterial({ roughness: 1, metalness: 0 });
  mat.color = new Color().setRGB(PROBE_ALBEDO, PROBE_ALBEDO, PROBE_ALBEDO, LinearSRGBColorSpace);
  const holder = new Scene();
  holder.environment = env;
  holder.add(new Mesh(geo, mat));
  const cam = new PerspectiveCamera(35, 1, 0.1, 10);
  cam.position.set(0, 0, 2.4);
  cam.lookAt(0, 0, 0);
  const prev = gl.getRenderTarget();
  try {
    await nextFrame();
    gl.setRenderTarget(rt);
    gl.render(holder, cam);
    const px = new Uint8Array(PROBE_SIZE * PROBE_SIZE * 4);
    gl.readRenderTargetPixels(rt, 0, 0, PROBE_SIZE, PROBE_SIZE, px);
    // The sphere overfills the frame at this distance, so the centre block is all surface.
    let sum = 0;
    let n = 0;
    const lo = PROBE_SIZE / 4;
    const hi = (PROBE_SIZE * 3) / 4;
    for (let y = lo; y < hi; y++) {
      for (let x = lo; x < hi; x++) {
        const i = (y * PROBE_SIZE + x) * 4;
        sum += (0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!) / 255;
        n++;
      }
    }
    if (!n) return null;
    return sum / n / PROBE_ALBEDO;
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
 * A real interior HDRI's mean luminance sits around 0.2–1.5. The cap is generous — a bake only
 * fails when it delivers several times the light its own source contains (or an absolute flood
 * from a dim source), which no correct PMREM of this hall can do: the filter conserves energy.
 */
export const HALL_ENV_MAX_MEAN = 3;

export function bakeLimit(sourceMean: number): number {
  return Number.isFinite(sourceMean) && sourceMean > 0 ? Math.max(HALL_ENV_MAX_MEAN, sourceMean * 4) : HALL_ENV_MAX_MEAN;
}

/** 'ok' also covers "cannot measure" — an unmeasurable bake is not evidence against a working platform. */
export function assessBake(sourceMean: number, probeLum: number | null): 'ok' | 'blown' {
  if (probeLum === null || !Number.isFinite(probeLum)) return 'ok';
  return probeLum > bakeLimit(sourceMean) ? 'blown' : 'ok';
}

async function filterHall(gl: WebGLRenderer, tex: Texture, alive: () => boolean): Promise<Texture | null> {
  const gen = new PMREMGenerator(gl) as Steps;
  const prevTarget = gl.getRenderTarget();
  try {
    if (!alive() || !tex.image) return null;
    const sourceMean = sourceMeanLuminance(tex);
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
    if (assessBake(sourceMean, probe) === 'ok') return target.texture;
    // Blown bake: never ship it. Retry once through the public path three supports, where the
    // generator manages its own state end to end, and validate that too.
    try { target.dispose(); } catch { /* already gone */ }
    if (!alive()) return null;
    const pub = new PMREMGenerator(gl);
    try {
      pub.compileEquirectangularShader();
      const rt2 = pub.fromEquirectangular(tex);
      const probe2 = await probeEnvMeanLuminance(gl, rt2.texture);
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
