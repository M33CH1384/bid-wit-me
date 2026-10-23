import type { Camera, WebGLRenderer } from 'three';
import { sound } from '../audio';
import { importChunk } from '../chunkLoad';

/** How long a stuck effect may hold the loading screen. The 40s table give-up still applies on top. */
export const EFFECT_WARM_TIMEOUT_MS = 12000;

/** The loader stays up until the cloth is dressed and these effects have been warmed, unless we give up. */
export function tableStillLoading(dressed: boolean, effectsWarm: boolean, giveUp: boolean): boolean {
  return (!dressed || !effectsWarm) && !giveUp;
}

export const SHOT_IMAGE_URLS = ['/shot/hole.png', '/shot/tape.webp'] as const;

export interface FxWarmTimes {
  holeMs: number;
  tapeMs: number;
  audioMs: number;
  sheetMs: number;
  tornadoMs: number;
  chromeMs: number;
  totalMs: number;
  timedOut: boolean;
}

type Gpu = { gl: WebGLRenderer; camera: Camera; quality: 'high' | 'low' };
let gpu: Gpu | null = null;
const gpuWaiters: ((g: Gpu) => void)[] = [];

/** Called from the table canvas once its renderer exists. Shader compiles land on that context. */
export function offerTableRenderer(gl: WebGLRenderer, camera: Camera, quality: 'high' | 'low'): void {
  gpu = { gl, camera, quality };
  const waiters = gpuWaiters.splice(0);
  for (const waiter of waiters) waiter(gpu);
}

function rendererReady(): Promise<Gpu> {
  if (gpu) return Promise.resolve(gpu);
  return new Promise((resolve) => gpuWaiters.push(resolve));
}

function timed<T>(run: () => Promise<T> | T): Promise<{ ms: number; value: T }> {
  const t0 = performance.now();
  return Promise.resolve()
    .then(run)
    .then((value) => ({ ms: Math.round(performance.now() - t0), value }));
}

/** Decoded shot images stay in the document so the first bullet hole and tape paint from memory. */
let imageStash: HTMLElement | null = null;

/** Decode a DOM image and paint one pixel so the bitmap is ready before the recap asks for it. */
function warmDomImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.fetchPriority = 'low';
    img.alt = '';
    const done = () => {
      try {
        const scratch = document.createElement('canvas');
        scratch.width = 4;
        scratch.height = 4;
        scratch.getContext('2d')?.drawImage(img, 0, 0, 4, 4);
      } catch { /* decode still counts */ }
      if (!imageStash) {
        imageStash = document.createElement('div');
        imageStash.setAttribute('aria-hidden', 'true');
        imageStash.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
        document.body.appendChild(imageStash);
      }
      if (!imageStash.contains(img)) imageStash.appendChild(img);
      resolve();
    };
    img.onload = () => { void img.decode().then(done, done); };
    img.onerror = () => resolve();
    img.src = url;
  });
}

/** Police lights and the toe tag are CSS. One off-screen frame pays the first style and font use. */
function warmChrome(): Promise<void> {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  el.innerHTML = '<div class="police-rim" style="position:absolute;inset:auto;width:8px;height:8px"></div><p class="tod">Time of death: Hand 1</p>';
  document.body.appendChild(el);
  void el.offsetWidth;
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      el.remove();
      resolve();
    });
  });
}

let warming: Promise<FxWarmTimes> | null = null;

function within<T>(work: Promise<T>, fallback: T, timeoutMs: number): Promise<{ value: T; timedOut: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T, timedOut: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ value, timedOut });
    };
    const timer = setTimeout(() => finish(fallback, true), timeoutMs);
    work.then((value) => finish(value, false), () => finish(fallback, true));
  });
}

/**
 * Wait for `ready` first, then start the give-up clock around `compile`.
 * A renderer that is still downloading must not burn the budget before any shader runs.
 */
export function compileAfterReady<T>(
  ready: Promise<unknown>,
  compile: () => Promise<T>,
  fallback: T,
  timeoutMs = EFFECT_WARM_TIMEOUT_MS,
): Promise<{ value: T; ms: number; timedOut: boolean }> {
  return ready.then(() => {
    const t0 = performance.now();
    return within(Promise.resolve().then(compile), fallback, timeoutMs).then((result) => ({
      ...result,
      ms: Math.round(performance.now() - t0),
    }));
  });
}

/**
 * Warm every special effect while the loading screen is up.
 * Images stay at low fetch priority and settle on load or error; the 40s table give-up
 * covers a request that never answers. The shader clock starts when that compile starts,
 * after the table renderer exists and the decal image has decoded.
 */
export function warmTableEffects(): Promise<FxWarmTimes> {
  if (warming) return warming;
  const started = performance.now();
  warming = (async (): Promise<FxWarmTimes> => {
    const hole = timed(() => warmDomImage(SHOT_IMAGE_URLS[0]));
    const tape = timed(() => warmDomImage(SHOT_IMAGE_URLS[1]));
    const audio = timed(() => sound.warmEffects());
    const chrome = timed(() => warmChrome());
    const sheet = (async () => {
      const mod = await importChunk(() => import('../sheetClothSim'));
      await mod.loadRipImage().catch(() => undefined);
      return compileAfterReady(Promise.resolve(), () => mod.warmSheet(), undefined);
    })();
    const tornado = (async () => {
      const [ready, mod] = await Promise.all([rendererReady(), importChunk(() => import('../three/Tornado3D'))]);
      return compileAfterReady(Promise.resolve(), () => mod.warmTornado(ready.gl, ready.camera, ready.quality), undefined);
    })();
    const [holeR, tapeR, audioR, chromeR, sheetR, tornadoR] = await Promise.all([hole, tape, audio, chrome, sheet, tornado]);
    const times: FxWarmTimes = {
      holeMs: holeR.ms,
      tapeMs: tapeR.ms,
      audioMs: audioR.ms,
      sheetMs: sheetR.timedOut ? -1 : sheetR.ms,
      tornadoMs: tornadoR.timedOut ? -1 : tornadoR.ms,
      chromeMs: chromeR.ms,
      totalMs: Math.round(performance.now() - started),
      timedOut: sheetR.timedOut || tornadoR.timedOut,
    };
    const w = window as unknown as { __bwmFxWarm?: FxWarmTimes; __bwmEffectsAt?: number };
    w.__bwmFxWarm = times;
    w.__bwmEffectsAt ??= performance.now();
    return times;
  })();
  return warming;
}

/** Second pass, after the warm. Used to time a first play that should already be hot. */
export async function measureHotFire(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const lap = async (name: string, run: () => Promise<void> | void) => {
    const t0 = performance.now();
    await run();
    out[name] = Math.round(performance.now() - t0);
  };
  await lap('hole', () => warmDomImage('/shot/hole.png'));
  await lap('tape', () => warmDomImage('/shot/tape.webp'));
  await lap('rip', async () => {
    const mod = await importChunk(() => import('../sheetClothSim'));
    await mod.loadRipImage();
  });
  await lap('audio', () => sound.warmEffects());
  await lap('sheet', async () => {
    const mod = await importChunk(() => import('../sheetClothSim'));
    await mod.warmSheet();
  });
  if (gpu) {
    const ready = gpu;
    await lap('tornado', async () => {
      const mod = await importChunk(() => import('../three/Tornado3D'));
      await mod.warmTornado(ready.gl, ready.camera, ready.quality);
    });
  }
  await lap('chrome', () => warmChrome());
  return out;
}

if (typeof window !== 'undefined') {
  (window as unknown as { __bwmFxHot?: typeof measureHotFire }).__bwmFxHot = measureHotFire;
}
