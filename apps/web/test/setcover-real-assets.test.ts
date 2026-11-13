import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// setcoverReal.css re-dresses the set covers with rendered textures. A missing
// file would silently fall back to an empty box, so every url() must resolve.
const css = readFileSync(fileURLToPath(new URL('../src/animfx/setcoverReal.css', import.meta.url)), 'utf8');
const pub = fileURLToPath(new URL('../public', import.meta.url));

describe('set cover rendered materials', () => {
  const urls = [...css.matchAll(/url\((\/assets\/setcovers\/[^)]+)\)/g)].map((m) => m[1]!);

  it('references rendered textures', () => {
    expect(new Set(urls).size).toBeGreaterThan(15);
  });

  it('every referenced texture ships in public/', () => {
    for (const u of new Set(urls)) expect(existsSync(pub + u), u).toBe(true);
  });

  it('is loaded after the base cover sheet', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/animfx/SetCover.tsx', import.meta.url)), 'utf8');
    expect(src.indexOf("'./setcoverReal.css'")).toBeGreaterThan(src.indexOf("'./animfx.css'"));
  });
});
