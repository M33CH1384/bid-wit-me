import { describe, expect, it } from 'vitest';
import { cardFaceFragment } from '../src/three/cardSat';

const FRAGMENT = `#include <lights_pars_begin>
float punctualLightIntensityToIrradianceFactor(const in float lightDistance, const in float cutoffDistance, const in float decayExponent) {
  return 1.0;
}
void main() {
  vec4 diffuseColor = vec4(diffuse, opacity);
  #include <map_fragment>
}
`;

describe('card face saturation', () => {
  it('declares uSat before any function so iOS binds it, and greys only through that uniform', () => {
    const out = cardFaceFragment(FRAGMENT);
    const uniformAt = out.indexOf('uniform float uSat;');
    const fnAt = out.indexOf('float punctualLightIntensityToIrradianceFactor');
    const mainAt = out.indexOf('void main()');
    expect(uniformAt).toBe(0);
    expect(uniformAt).toBeLessThan(fnAt);
    expect(uniformAt).toBeLessThan(mainAt);
    expect(out).not.toContain('uniform float uSat;\nvoid main()');
    expect(out).toContain('diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))), diffuseColor.rgb, uSat);');
    const again = cardFaceFragment(out);
    expect(again.match(/uniform float uSat;/g)).toHaveLength(1);
  });
});
