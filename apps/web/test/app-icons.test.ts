/** Home Screen / PWA icons: since 2026-10-26 (owner: "use that image as
 *  the app icon") the PNGs are crops of the Neon spade-emblem artwork —
 *  the same image the home backdrop paints (public/assets/neon/
 *  spade-emblem.webp) — full-bleed on the art's own dark ground, fully
 *  opaque (iOS renders transparency as black). favicon.svg (the white
 *  spade mark) stays as the vector favicon and the spray's geometry
 *  source; index.html additionally links the PNG so the emblem is the
 *  tab icon wherever PNG wins. iOS ignores the SVG favicon for Home
 *  Screen installs, so index.html must carry an apple-touch-icon and
 *  the manifest must list real PNG icons — without these, an installed
 *  web app falls back to a screenshot tile. */
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
    // the emblem PNG is a favicon too — the app icon is the tab icon
    expect(html).toContain('<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />');
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

  it('the icon PNGs are fully opaque (IHDR color type 2 = RGB, no alpha)', () => {
    // iOS shows a transparent Home Screen icon on black — the emblem
    // icons are composed full-bleed on the art's own dark ground, so
    // none of them may carry an alpha channel (color type 6 = RGBA).
    for (const p of ['../public/apple-touch-icon.png', '../public/icon-192.png', '../public/icon-512.png', '../public/icon-512-maskable.png']) {
      const buf = readBuf(p);
      pngSize(buf); // asserts the PNG signature + IHDR framing
      expect(buf[25], p).toBe(2);
    }
  });
});
