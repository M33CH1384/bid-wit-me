import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { EquirectangularReflectionMapping, Mesh, OrthographicCamera, PMREMGenerator, PlaneGeometry, Scene, Vector3, WebGLRenderTarget, type Material, type Texture, type WebGLRenderer } from 'three';
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
 */
export function ClassicHall({ active, onMap }: { active: boolean; onMap: (texture: Texture) => void }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const loader = new RGBELoader();
    loader.load(HDRI_URL, (tex) => {
      tex.mapping = EquirectangularReflectionMapping;
      void filterHall(gl, tex, () => alive).then((map) => {
        if (!alive || !map) { tex.dispose(); return; }
        onMap(map);
        invalidate();
      });
    });
    return () => { alive = false; };
  }, [active, gl, invalidate, onMap]);
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

async function filterHall(gl: WebGLRenderer, tex: Texture, alive: () => boolean): Promise<Texture | null> {
  const gen = new PMREMGenerator(gl) as Steps;
  try {
    if (!alive() || !tex.image) return null;
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
    tex.dispose();
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
    return target.texture;
  } catch {
    return null;
  }
}
