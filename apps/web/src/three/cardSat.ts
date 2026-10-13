/**
 * Saturation for one card face. 1 leaves the texture alone; an illegal card eases toward grey.
 *
 * The uniform has to be the first line of the fragment shader. three's lighting chunks, which
 * sit above `main`, are full of functions. WebKit's GLSL compiler (iOS Safari) does not bind a
 * uniform declared after those functions, so `uSat` stays 0 and every face renders grey for the
 * whole hand. The gold ring is a different, unlit material, which is why a tap can still draw a
 * border on the selected card while the legal cards never come back to full colour.
 */
export function cardFaceFragment(fragmentShader: string): string {
  const declared = fragmentShader.startsWith('uniform float uSat;');
  const withUniform = declared ? fragmentShader : `uniform float uSat;\n${fragmentShader}`;
  const hook = '#include <map_fragment>';
  if (!withUniform.includes(hook) || withUniform.includes('uSat);')) return withUniform;
  return withUniform.replace(
    hook,
    `${hook}\n  diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))), diffuseColor.rgb, uSat);`,
  );
}
