import { describe, expect, it } from 'vitest';
import { ShaderChunk } from 'three';
import { cardFaceFragment, placeCardSatUniform } from '../src/three/cardSat';

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
  it('declares uSat before the tone-mapping functions three puts ahead of the user shader', () => {
    placeCardSatUniform();
    const prefix = ShaderChunk.tonemapping_pars_fragment;
    const user = cardFaceFragment(FRAGMENT, false);
    const combined = `${prefix}\n${user}`;
    const uniformAt = combined.indexOf('uniform float uSat;');
    const toneFn = combined.indexOf('vec3 LinearToneMapping');
    const userFn = combined.indexOf('float punctualLightIntensityToIrradianceFactor');
    expect(uniformAt).toBe(0);
    expect(toneFn).toBeGreaterThan(uniformAt);
    expect(userFn).toBeGreaterThan(uniformAt);
    expect(user).not.toContain('uniform float uSat;');
    expect(user).not.toContain('uniform float uSat;\nvoid main()');
    expect(user).toContain('diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))), diffuseColor.rgb, uSat);');
    placeCardSatUniform();
    expect(ShaderChunk.tonemapping_pars_fragment.match(/uniform float uSat;/g)).toHaveLength(1);
    const again = cardFaceFragment(user, false);
    expect(again.match(/uniform float uSat;/g)).toBeNull();
  });

  it('declares uSat on the user shader only when the tone-mapping prefix is absent', () => {
    const out = cardFaceFragment(FRAGMENT, true);
    expect(out.startsWith('uniform float uSat;\n')).toBe(true);
    expect(out.indexOf('uniform float uSat;')).toBeLessThan(out.indexOf('void main()'));
    const twice = cardFaceFragment(out, true);
    expect(twice.match(/uniform float uSat;/g)).toHaveLength(1);
  });
});
