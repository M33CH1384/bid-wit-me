import { describe, expect, it } from 'vitest';
import { Texture } from 'three';
import { pooledCardMaterial } from '../src/three/Card3D';
import { texturesForRepaint } from '../src/three/cardTextures';

describe('deal and trick hitch', () => {
  it('reuploads only the canvas that was just repainted', () => {
    const a = {};
    const b = {};
    const textures = [{ image: a }, { image: b }, { image: a }];
    expect(texturesForRepaint(textures, a)).toEqual([textures[0], textures[2]]);
    expect(texturesForRepaint(textures, b)).toEqual([textures[1]]);
    expect(texturesForRepaint(textures, {})).toEqual([]);
    expect(texturesForRepaint(textures, null)).toEqual([]);
  });

  it('keeps one material per face so a later trick does not rebuild it', () => {
    const ace = new Texture();
    const king = new Texture();
    const first = pooledCardMaterial(ace, 'high', true, true);
    const again = pooledCardMaterial(ace, 'high', true, true);
    const other = pooledCardMaterial(king, 'high', true, true);
    const back = pooledCardMaterial(ace, 'high', true, false);
    expect(again).toBe(first);
    expect(other).not.toBe(first);
    expect(back).not.toBe(first);
  });
});
