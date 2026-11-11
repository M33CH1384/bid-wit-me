/**
 * Venue tables modelled in Blender (tools/blender/build_table.py). The GLB carries shapes only: mesh names are the
 * contract (cushion, rail, apron, inlay, base) and the game supplies the materials, so the shader warm-up still
 * owns every program. Baked ambient occlusion rides in the vertex colours.
 */
import { BufferAttribute, type BufferGeometry, type Mesh } from 'three';

export type TableParts = Partial<Record<'cushion' | 'rail' | 'apron' | 'inlay' | 'base', BufferGeometry>>;

const cache = new Map<string, Promise<TableParts>>();

export function tableModelUrl(id: string): string {
  return `/assets/models/table_${id}.glb`;
}

/** One fetch + parse per table. The loader is its own chunk, so it is never on the first paint. */
export function loadTableModel(id: string): Promise<TableParts> {
  let pending = cache.get(id);
  if (!pending) {
    pending = import('three/examples/jsm/loaders/GLTFLoader.js').then(({ GLTFLoader }) => new GLTFLoader().loadAsync(tableModelUrl(id))).then((gltf) => {
      const parts: TableParts = {};
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const name = (mesh.name || mesh.parent?.name || '').replace(/[._]\d+$/, '') as keyof TableParts;
        const geo = mesh.geometry.clone();
        geo.applyMatrix4(mesh.matrixWorld);
        parts[name] = withWhite(geo);
      });
      if (!parts.rail || !parts.apron) throw new Error(`table model ${id}: missing parts`);
      return parts;
    });
    pending.catch(() => cache.delete(id));
    cache.set(id, pending);
  }
  return pending;
}

/** Materials for a modelled table multiply by vertex colour. A mesh without one would draw black, so give it white. */
export function withWhite(geo: BufferGeometry): BufferGeometry {
  if (!geo.getAttribute('color')) {
    const n = geo.getAttribute('position').count;
    geo.setAttribute('color', new BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  }
  return geo;
}
