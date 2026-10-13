import { type BufferGeometry, type Camera, type Material, type Scene, type WebGLRenderer, Mesh, PlaneGeometry, Scene as ThreeScene, WebGLRenderTarget, type WebGLRenderTarget as RenderTarget } from 'three';

/** Yield so a shader link, a texture upload, or a mip blur is its own turn on the main thread. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => { requestAnimationFrame(() => resolve()); });
}

/**
 * three's default shader check calls getProgramInfoLog on first use, which waits out the whole link
 * on the main thread. Programs still compile; the first draw just doesn't also format a log.
 */
export function quietShaderErrors(gl: WebGLRenderer): void {
  gl.debug.checkShaderErrors = false;
}

const plane = new PlaneGeometry(0.05, 0.07);
let scratch: RenderTarget | null = null;

/**
 * A 4×4 target that bakes the same tone-mapping and color space as the screen, so the program
 * cached here is the one the table draws. The warmup never touches the canvas the player sees.
 */
function screenLikeTarget(gl: WebGLRenderer): RenderTarget {
  if (!scratch) scratch = new WebGLRenderTarget(4, 4);
  scratch.texture.colorSpace = gl.outputColorSpace;
  (scratch as RenderTarget & { isXRRenderTarget?: boolean }).isXRRenderTarget = true;
  return scratch;
}

/**
 * Link one material and force its first use on its own frame. Without KHR_parallel_shader_compile the
 * driver finishes that one program inside getProgramParameter, so linking the whole table in a single
 * draw is a multi-second freeze. `lighting` supplies fog, lights, environment, and shadow state.
 * `prepare` may turn shadows on for this draw only; it returns the cleanup.
 */
export async function forceProgram(gl: WebGLRenderer, camera: Camera, material: Material, lighting: Scene, geometry?: BufferGeometry, prepare?: () => (() => void) | void): Promise<void> {
  await nextFrame();
  const mesh = new Mesh(geometry ?? plane, material);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const holder = new ThreeScene();
  holder.add(mesh);
  const hidden: Mesh[] = [];
  const target = screenLikeTarget(gl);
  const prev = gl.getRenderTarget();
  const release = prepare?.() ?? undefined;
  try {
    gl.setRenderTarget(target);
    gl.compile(holder, camera, lighting);
    gl.getContext().flush();
    lighting.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && m.visible) { hidden.push(m); m.visible = false; }
    });
    holder.remove(mesh);
    lighting.add(mesh);
    gl.render(lighting, camera);
  } catch {
    /* a failed warm compile just means the first real draw builds the program */
  } finally {
    lighting.remove(mesh);
    for (const m of hidden) m.visible = true;
    release?.();
    gl.setRenderTarget(prev);
  }
}
