import { ShaderChunk } from 'three';

/**
 * Saturation for one card face. 1 leaves the texture alone; an illegal card eases toward grey.
 *
 * WebKit's GLSL compiler does not bind a uniform declared after a function, and it leaves that
 * uniform at 0. three.js puts the tone-mapping functions in the prefix, ahead of anything
 * `onBeforeCompile` can prepend, so a declaration at `void main` (or at the top of the user
 * shader) still sits below those functions. Every face then renders fully grey, while the gold
 * ring — a different, unlit material — can still show on the one card pulled toward the camera.
 * The declaration therefore leads the tone-mapping chunk, which is the first function in that prefix.
 */
const SAT_DECL = 'uniform float uSat;';

export function placeCardSatUniform(): void {
  const chunk = ShaderChunk.tonemapping_pars_fragment;
  if (chunk.startsWith(SAT_DECL)) return;
  ShaderChunk.tonemapping_pars_fragment = `${SAT_DECL}\n${chunk}`;
}

placeCardSatUniform();

/** @param declare When the renderer has no tone mapping, the prefix chunk is absent and the user shader has to declare `uSat` itself. */
export function cardFaceFragment(fragmentShader: string, declare: boolean): string {
  const hasDecl = fragmentShader.startsWith(SAT_DECL);
  let src = fragmentShader;
  if (declare && !hasDecl) src = `${SAT_DECL}\n${src}`;
  if (!declare && hasDecl) src = src.slice(SAT_DECL.length).replace(/^\n/, '');
  const hook = '#include <map_fragment>';
  if (!src.includes(hook) || src.includes('uSat);')) return src;
  return src.replace(
    hook,
    `${hook}\n  diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))), diffuseColor.rgb, uSat);`,
  );
}
