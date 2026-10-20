/** Home Screen / PWA icons: the site logo (white spade on #0c0712) as PNGs.
 *  iOS ignores the SVG favicon for Home Screen installs, so index.html must
 *  carry an apple-touch-icon and the manifest must list real PNG icons —
 *  without these, an installed web app falls back to a screenshot tile. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const readBuf = (p: string) => readFileSync(new URL(p, import.meta.url));

/** Width/height from a PNG's IHDR chunk (bytes 16–23, big-endian). */
function pngSize(buf: Buffer): { w: number; h: number } {
  expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(buf.toString('ascii', 12, 16)).toBe('IHDR');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe('app icons', () => {
  it('index.html links the apple-touch-icon (180×180 PNG) next to the SVG favicon', () => {
    const html = read('../index.html');
    expect(html).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />');
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
  });

  it('manifest lists PNG icons (192 any, 512 any, 512 maskable) alongside the SVG', () => {
    const m = JSON.parse(read('../public/manifest.json'));
    const bySrc = new Map(m.icons.map((i: { src: string }) => [i.src, i]));
    expect(bySrc.get('/favicon.svg')).toMatchObject({ type: 'image/svg+xml', sizes: 'any' });
    expect(bySrc.get('/icon-192.png')).toMatchObject({ type: 'image/png', sizes: '192x192', purpose: 'any' });
    expect(bySrc.get('/icon-512.png')).toMatchObject({ type: 'image/png', sizes: '512x512', purpose: 'any' });
    expect(bySrc.get('/icon-512-maskable.png')).toMatchObject({ type: 'image/png', sizes: '512x512', purpose: 'maskable' });
    expect(m.theme_color).toBe('#0c0712');
    expect(m.background_color).toBe('#0c0712');
  });

  it('the icon PNGs exist at the promised sizes', () => {
    expect(pngSize(readBuf('../public/apple-touch-icon.png'))).toEqual({ w: 180, h: 180 });
    expect(pngSize(readBuf('../public/icon-192.png'))).toEqual({ w: 192, h: 192 });
    expect(pngSize(readBuf('../public/icon-512.png'))).toEqual({ w: 512, h: 512 });
    expect(pngSize(readBuf('../public/icon-512-maskable.png'))).toEqual({ w: 512, h: 512 });
  });
});
