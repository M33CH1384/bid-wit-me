import { afterEach, describe, expect, it, vi } from 'vitest';
import { tableTextureUrls } from '../src/tableAssets';

const assigned: string[] = [];

/** Enough of HTMLImageElement for loadTableImage to assign src. */
class FakeImage {
  decoding = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(value: string) { assigned.push(value); }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  assigned.length = 0;
});

describe('table texture prefetch', () => {
  it('starts the felt and wood maps before the Scene chunk is asked for', async () => {
    vi.resetModules();
    vi.stubGlobal('Image', FakeImage);
    const idle = vi.fn();
    vi.stubGlobal('window', { requestIdleCallback: idle });
    const { preloadTable } = await import('../src/three/preload');
    preloadTable('high', 'classic');
    expect(assigned).toEqual(tableTextureUrls('high'));
    expect(idle).toHaveBeenCalledOnce();
    expect(assigned.every((url) => url.endsWith('.jpg'))).toBe(true);
  });

  it('a named venue adds its rail image beside the cloth maps', async () => {
    vi.resetModules();
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('window', { requestIdleCallback: () => {} });
    const { preloadTable } = await import('../src/three/preload');
    preloadTable('high', 'beach');
    const cloth = tableTextureUrls('high');
    expect(assigned.slice(0, cloth.length)).toEqual(cloth);
    expect(assigned.at(-1)).toBe('/assets/venues/tex/bamboo_veneer_512.jpg');
  });
});
