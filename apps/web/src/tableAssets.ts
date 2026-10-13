/**
 * Table image URLs with no WebGL imports, so a resumed game can start the downloads from the first script.
 * High quality keeps the 1k colour and normal maps. Roughness stays 512 (it does not read at table distance).
 */

const images = new Map<string, Promise<HTMLImageElement>>();

export function tableTextureUrls(quality: 'high' | 'low'): string[] {
  const res = quality === 'high' ? '1k' : '512';
  return [
    `/assets/textures/scuba_suede_nor_gl_${res}.jpg`,
    '/assets/textures/scuba_suede_rough_512.jpg',
    `/assets/textures/dark_wood_diff_${res}.jpg`,
    `/assets/textures/dark_wood_nor_gl_${res}.jpg`,
    '/assets/textures/dark_wood_rough_512.jpg',
  ];
}

/** One shared decode per URL. Later Texture uploads reuse the same element, so nothing is fetched twice. */
export function loadTableImage(url: string, priority?: 'high' | 'low' | 'auto'): Promise<HTMLImageElement> {
  let pending = images.get(url);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      // Prefetch stays behind the Scene chunk. Once that script is done the pipe is free and these finish.
      if (priority) img.fetchPriority = priority;
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`texture ${url}`));
      img.src = url;
    });
    images.set(url, pending);
  }
  return pending;
}

export function prefetchTableTextures(quality: 'high' | 'low', extra: string[] = []): void {
  for (const url of [...tableTextureUrls(quality), ...extra]) void loadTableImage(url, 'low').catch(() => undefined);
}
