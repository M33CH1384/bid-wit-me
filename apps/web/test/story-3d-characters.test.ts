import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHARACTER_ASSETS_BASE, CHARACTER_MORPHS, __resetCharacterIndex, characterUrl, fetchCharacterIndex, shouldPrefetch,
  stage3DCast, want3DCharacters, type CharacterIndex,
} from '../src/three/characters/manifest';
import { expressionForBeat, morphWeights } from '../src/three/characters/expressions';
import { __characterCache, acquireCharacter, bindSharedSkeleton, fixMaskMaterials, type LoadedGltf } from '../src/three/characters/loader';

const here = dirname(fileURLToPath(import.meta.url));

/** Placeholder cube rig: two skinned cubes (body + hair MASK) with separate-but-identical skeletons, 6 named morphs, an idle clip. */
function cubeRig(): LoadedGltf {
  const scene = new T.Group();
  const mkSkel = () => {
    const root = new T.Bone(); root.name = 'Hips';
    const head = new T.Bone(); head.name = 'Head'; head.position.y = 1; root.add(head);
    return new T.Skeleton([root, head]);
  };
  const mk = (name: string, mat: T.Material) => {
    const g = new T.BoxGeometry(1, 2, 1);
    const n = g.attributes.position!.count;
    g.setAttribute('skinIndex', new T.Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
    g.setAttribute('skinWeight', new T.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 ? 0 : 1)), 4));
    g.morphAttributes.position = CHARACTER_MORPHS.map(() => g.attributes.position!.clone());
    const m = new T.SkinnedMesh(g, mat); m.name = name;
    m.updateMorphTargets();
    m.morphTargetDictionary = Object.fromEntries(CHARACTER_MORPHS.map((k, i) => [k, i]));
    const sk = mkSkel(); m.add(sk.bones[0]!); m.bind(sk);
    scene.add(m);
    return m;
  };
  mk('body', new T.MeshStandardMaterial());
  mk('hair', new T.MeshStandardMaterial({ alphaTest: 0.5, transparent: true, depthWrite: false }));
  const idle = new T.AnimationClip('idle', 1, [new T.NumberKeyframeTrack('Head.position[y]', [0, 1], [1, 1.1])]);
  return { scene, animations: [idle] };
}
const index: CharacterIndex = { version: 1, count: 2, characters: {
  june: { glb: '/june/june.abc.glb' } as never, dee: { glb: '/dee/dee.def.glb' } as never,
} };

afterEach(() => { __characterCache.clear(); vi.useRealTimers(); });

describe('character manifest', () => {
  it('assets come from the configurable origin, never the repo', () => {
    expect(CHARACTER_ASSETS_BASE).toBe('https://bwm-characters.pages.dev');
    expect(characterUrl('/dee/dee.8f80fed4.glb')).toBe('https://bwm-characters.pages.dev/dee/dee.8f80fed4.glb');
  });
  it('index fetch is cached, failures are not', async () => {
    __resetCharacterIndex();
    const bad = vi.fn(async () => { throw new Error('x'); }) as unknown as typeof fetch;
    await expect(fetchCharacterIndex(bad)).rejects.toThrow();
    const ok = vi.fn(async () => new Response(JSON.stringify(index))) as unknown as typeof fetch;
    await fetchCharacterIndex(ok); await fetchCharacterIndex(ok);
    expect(ok).toHaveBeenCalledTimes(1);
    __resetCharacterIndex();
  });
  it('3D is only the stage pair + Dee', () => {
    expect(stage3DCast(['mrColeman', 'june'])).toEqual({ left: 'mrColeman', right: 'june', dee: 'dee' });
    expect(stage3DCast([])).toBeNull();
  });
  it('2D fallback gates', () => {
    expect(want3DCharacters({ deviceMemory: 2, webgl: true }).reason).toBe('low-memory');
    expect(want3DCharacters({ deviceMemory: 8, webgl: false }).reason).toBe('no-webgl');
    expect(want3DCharacters({ webgl: true, reducedMotion: true }).ok).toBe(false);
    expect(want3DCharacters({ webgl: true, reduceEffects: true }).ok).toBe(false);
    expect(want3DCharacters({ deviceMemory: 4, webgl: true }).ok).toBe(true);
  });
  it('prefetch only on fast, non-saver connections', () => {
    expect(shouldPrefetch({ effectiveType: '4g' })).toBe(true);
    expect(shouldPrefetch({ effectiveType: '4g', saveData: true })).toBe(false);
    expect(shouldPrefetch({ effectiveType: '3g' })).toBe(false);
    expect(shouldPrefetch(undefined)).toBe(false);
  });
});

describe('expressions', () => {
  it('maps onto the 6 morphs, neutral at rest', () => {
    expect(morphWeights('neutral')).toEqual([1, 0, 0, 0, 0, 0]);
    const w = morphWeights('angry'); expect(w).toHaveLength(6); expect(w[5]).toBeGreaterThan(0);
    expect(expressionForBeat('june', { speaker: 'pat', line: 'Ha!' })).toBe('neutral');
  });
});

describe('character loader (cube rig)', () => {
  it('binds one skeleton, fixes the hair mask, clones per seat, refcounts and disposes', async () => {
    const g = cubeRig();
    const load = vi.fn(async () => g);
    const a = await acquireCharacter('june', index, { load });
    const b = await acquireCharacter('june', index, { load });
    expect(load).toHaveBeenCalledTimes(1);
    expect(a.root).not.toBe(b.root);
    const skins: T.SkinnedMesh[] = []; a.root.traverse((o) => { if ((o as T.SkinnedMesh).isSkinnedMesh) skins.push(o as T.SkinnedMesh); });
    expect(skins).toHaveLength(2);
    expect(skins[0]!.skeleton).toBe(skins[1]!.skeleton);
    const hair = skins.find((s) => s.name === 'hair')!.material as T.Material;
    expect([hair.alphaTest, hair.depthWrite, hair.transparent]).toEqual([0.12, true, false]);
    expect(a.clips.idle).toBeDefined();
    expect(a.triangles).toBe(24);
    a.setExpression('smile');
    expect(skins[0]!.morphTargetInfluences![1]).toBe(1);
    const spy = vi.spyOn((g.scene.children[0] as T.Mesh).geometry, 'dispose');
    a.release(); expect(spy).not.toHaveBeenCalled();
    b.release(); expect(spy).toHaveBeenCalled();
    expect(__characterCache.size).toBe(0);
  });
  it('fixMaskMaterials / bindSharedSkeleton are standalone', () => {
    const g = cubeRig();
    expect(fixMaskMaterials(g.scene)).toBe(1);
    expect(bindSharedSkeleton(g.scene).rebound).toBe(1);
  });
  it('load failure rejects and is not cached (2D stays)', async () => {
    await expect(acquireCharacter('dee', index, { load: async () => { throw new Error('404'); } })).rejects.toThrow();
    await Promise.resolve();
    expect(__characterCache.size).toBe(0);
    await expect(acquireCharacter('nobody', index)).rejects.toThrow();
  });
  it('times out', async () => {
    await expect(acquireCharacter('dee', index, { load: () => new Promise(() => {}), timeoutMs: 20 })).rejects.toThrow(/timed out/);
  });
});

describe('CSP for character assets', () => {
  const cfg = readFileSync(join(here, '../vite.config.ts'), 'utf8');
  it('adds only the assets origin, to connect-src and img-src', () => {
    expect(cfg).toContain("`img-src 'self' data: blob: ${CHARACTERS_ORIGIN}`");
    expect(cfg).toContain('`connect-src \'self\' data: blob: ${server} ${ws} ${CHARACTERS_ORIGIN}`');
    expect(cfg).toContain("\"script-src 'self' 'wasm-unsafe-eval'\""); // meshopt WASM: already allowed, unchanged
    expect(cfg.match(/(?<!_)CHARACTERS_ORIGIN\b/g)).toHaveLength(3) // const + two uses;
    expect(cfg).not.toContain("'unsafe-eval'");
  });
});
