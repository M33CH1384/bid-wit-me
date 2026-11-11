/**
 * Story character loader (three.js side; reached ONLY through dynamic import() once a story stop's stage mounts).
 * - three, GLTFLoader, MeshoptDecoder (three's bundled wasm build: WebAssembly.instantiate from an inline buffer,
 *   allowed by the existing script-src 'wasm-unsafe-eval'; no CDN, no extra CSP) and SkeletonUtils load lazily.
 * - One cached GLTF per asset URL with a refcount; every seat gets its own SkeletonUtils.clone; the last release
 *   disposes geometry, materials and textures.
 * - All 23 rigs share 163 joints but carry one skin per mesh: at load every SkinnedMesh is bound to ONE Skeleton.
 * - Hair is alphaMode MASK: alphaTest 0.12, depthWrite on, no blending.
 */
import type { AnimationClip, AnimationMixer, Material, Mesh, Object3D, Skeleton, SkinnedMesh, Texture } from 'three';
import { CHARACTER_MORPHS, CHARACTER_RIG, type CharacterExpression, characterUrl, type CharacterIndex } from './manifest';
import { morphWeights } from './expressions';

export interface LoadedGltf { scene: Object3D; animations: AnimationClip[] }
export type GltfLoadFn = (url: string) => Promise<LoadedGltf>;

export interface CharacterHandle {
  id: string;
  root: Object3D;
  mixer: AnimationMixer;
  clips: Record<string, AnimationClip>;
  triangles: number;
  meshes: number;
  setExpression(expr: CharacterExpression, k?: number): void;
  /** Raw weights in CHARACTER_MORPHS order (the stage cross-fades between expressions with this). */
  setWeights(w: readonly number[]): void;
  release(): void;
}

type Three = typeof import('three');
let threeP: Promise<{ T: Three; clone: (o: Object3D) => Object3D }> | null = null;
function libs() {
  threeP ??= Promise.all([import('three'), import('three/examples/jsm/utils/SkeletonUtils.js')]).then(([T, SU]) => ({ T, clone: SU.clone }));
  return threeP;
}

let defaultLoad: GltfLoadFn | null = null;
async function gltfLoader(): Promise<GltfLoadFn> {
  if (defaultLoad) return defaultLoad;
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js'),
  ]);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.setCrossOrigin('anonymous');
  defaultLoad = (url) => loader.loadAsync(url) as Promise<LoadedGltf>;
  return defaultLoad;
}

interface Entry { p: Promise<LoadedGltf>; refs: number; src?: LoadedGltf }
const cache = new Map<string, Entry>();
/** tests / debugging */
export const __characterCache = cache;

/** Bind every SkinnedMesh under `root` to the first one's Skeleton when their joints match (same names, same order). */
export function bindSharedSkeleton(root: Object3D): { shared: Skeleton | null; rebound: number } {
  const skinned: SkinnedMesh[] = [];
  root.traverse((o) => { if ((o as SkinnedMesh).isSkinnedMesh) skinned.push(o as SkinnedMesh); });
  if (!skinned.length) return { shared: null, rebound: 0 };
  const shared = skinned[0]!.skeleton;
  const names = shared.bones.map((b) => b.name).join('|');
  let rebound = 0;
  for (const m of skinned.slice(1)) {
    if (m.skeleton === shared) continue;
    if (m.skeleton.bones.length !== shared.bones.length || m.skeleton.bones.map((b) => b.name).join('|') !== names) continue;
    // same joints: identical inverse binds are required to share the bone texture; otherwise keep its own
    const same = m.skeleton.boneInverses.every((inv, i) => inv.equals(shared.boneInverses[i]!));
    if (!same) continue;
    m.bind(shared, m.bindMatrix);
    rebound++;
  }
  return { shared, rebound };
}

/** MASK hair (and any alpha-tested material): crisp cut-out, depth-writing, never sorted as transparent. */
/** Hair / beard card materials by name (the asset viewer's list, story-chars export/viewer.html). */
export const HAIR_CARD_MATERIALS = ['hair_cards', 'hair_puff', 'hair_beard', 'hair_vlayer', 'hair_vbase', 'hair_long', 'hair_locs'] as const;

/**
 * Hair and beard cards: alpha-test + blend WITH depth write (the viewer's settings — manifest note "three.js:
 * transparent=true, alphaTest=0.12, depthWrite=true"): the test discards the sparse texels that read as noise/dots,
 * the blend softens what survives, depth write keeps the cards sorted against the head. No alpha-to-coverage.
 * Applies to the named hair materials and to any other MASK material (alphaTest > 0).
 */
export function fixMaskMaterials(root: Object3D): number {
  let n = 0;
  const seen = new Set<Material>();
  root.traverse((o) => {
    const mats = (o as Mesh).material;
    if (!mats) return;
    for (const m of (Array.isArray(mats) ? mats : [mats]) as Material[]) {
      if (seen.has(m)) continue;
      seen.add(m);
      if (m.alphaTest > 0 || (HAIR_CARD_MATERIALS as readonly string[]).includes(m.name)) {
        m.transparent = true; m.alphaTest = CHARACTER_RIG.hairAlphaTest; m.depthWrite = true; m.alphaToCoverage = false;
        m.needsUpdate = true; n++;
      }
    }
  });
  return n;
}

function countTriangles(root: Object3D): { triangles: number; meshes: number } {
  let triangles = 0, meshes = 0;
  root.traverse((o) => {
    const g = (o as Mesh).isMesh ? (o as Mesh).geometry : null;
    if (!g) return;
    meshes++;
    triangles += (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;
  });
  return { triangles: Math.round(triangles), meshes };
}

function disposeAll(root: Object3D) {
  const tex = new Set<Texture>();
  root.traverse((o) => {
    const m = o as Mesh;
    m.geometry?.dispose?.();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats as (Material & Record<string, unknown>)[]) {
      for (const v of Object.values(mat)) if (v && (v as Texture).isTexture) tex.add(v as Texture);
      mat.dispose();
    }
  });
  tex.forEach((t) => t.dispose());
}

/** Load (or reuse) one character and hand back a per-seat clone. Rejects on failure or timeout. */
export async function acquireCharacter(
  id: string, index: CharacterIndex,
  opts: { timeoutMs?: number; load?: GltfLoadFn } = {},
): Promise<CharacterHandle> {
  const entry = index.characters[id];
  if (!entry) throw new Error(`no character ${id}`);
  const url = characterUrl(entry.glb);
  const { T, clone } = await libs();
  let e = cache.get(url);
  if (!e) {
    const load = opts.load ?? (await gltfLoader());
    e = { p: load(url), refs: 0 };
    const ent = e;
    ent.p.then((g) => { ent.src = g; fixMaskMaterials(g.scene); bindSharedSkeleton(g.scene); }, () => { cache.delete(url); });
    cache.set(url, e);
  }
  e.refs++;
  const ent = e;
  let timer = 0 as unknown as ReturnType<typeof setTimeout>;
  let src: LoadedGltf;
  try {
    src = await Promise.race([
      ent.p,
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`character ${id} timed out`)), opts.timeoutMs ?? 15_000); }),
    ]);
  } catch (err) {
    clearTimeout(timer);
    releaseUrl(url);
    throw err;
  }
  clearTimeout(timer);
  fixMaskMaterials(src.scene);
  const root = clone(src.scene);
  root.name = `character-${id}`;
  bindSharedSkeleton(root);
  const mixer = new T.AnimationMixer(root);
  const clips = Object.fromEntries(src.animations.map((c) => [c.name, c]));
  const morphMeshes: Mesh[] = [];
  root.traverse((o) => { const m = o as Mesh; if (m.isMesh && m.morphTargetDictionary && m.morphTargetInfluences) morphMeshes.push(m); });
  const setWeights = (w: readonly number[]) => {
    for (const m of morphMeshes) {
      const dict = m.morphTargetDictionary!, inf = m.morphTargetInfluences!;
      CHARACTER_MORPHS.forEach((name, i) => { const ix = dict[name]; if (ix !== undefined) inf[ix] = w[i]!; });
    }
  };
  const setExpression = (expr: CharacterExpression, k = 1) => setWeights(morphWeights(expr, k));
  setExpression('neutral');
  const { triangles, meshes } = countTriangles(root);
  let released = false;
  return {
    id, root, mixer, clips, triangles, meshes, setExpression, setWeights,
    release() {
      if (released) return; released = true;
      mixer.stopAllAction(); mixer.uncacheRoot(root);
      root.removeFromParent();
      releaseUrl(url);
    },
  };
}

function releaseUrl(url: string) {
  const e = cache.get(url);
  if (!e) return;
  e.refs--;
  if (e.refs <= 0) { cache.delete(url); if (e.src) disposeAll(e.src.scene); }
}

/** Warm the HTTP cache for a character's GLB (no decode). */
export function prefetchCharacter(id: string, index: CharacterIndex): void {
  const entry = index.characters[id];
  if (!entry) return;
  void fetch(characterUrl(entry.glb), { mode: 'cors', credentials: 'omit' }).then((r) => r.arrayBuffer(), () => undefined).catch(() => undefined);
}
