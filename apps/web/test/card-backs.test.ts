import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { deckBackUrl } from '../src/three/cardTextures';

describe('per-deck card backs (founder-approved set)', () => {
  it('every deck id maps to its shipped back asset, Hip-hop included', () => {
    const want: Record<string, string> = { base: 'Base', classic: 'Classic', afrofuturist: 'Afrofuturist', harlem: 'Harlem', hiphop: 'Hip-hop', mali: 'Mali', egypt: 'Egypt', greek: 'Greek' };
    for (const [id, name] of Object.entries(want)) {
      expect(deckBackUrl(id)).toBe(`/assets/card-backs/${name}-back.png`);
      expect(existsSync(new URL(`../public/assets/card-backs/${name}-back.png`, import.meta.url))).toBe(true);
    }
  });
  it('story decks map to their shipped WebP backs', () => {
    const want: Record<string, string> = { porchlight: 'PorchLight', revolutionaries: 'Revolutionaries', blacktop: 'Blacktop', cookout: 'Cookout', corner: 'Corner', stainedglass: 'StainedGlass', rooftopdusk: 'RooftopDusk', penthouse: 'Penthouse', pjs: 'Pjs', legends: 'Legends', madeitout: 'MadeItOut' };
    for (const [id, name] of Object.entries(want)) {
      expect(deckBackUrl(id)).toBe(`/assets/card-backs/${name}-back.webp`);
      expect(existsSync(new URL(`../public/assets/card-backs/${name}-back.webp`, import.meta.url))).toBe(true);
    }
  });
  it('an unknown deck falls back to the Base back', () => {
    expect(deckBackUrl('nope')).toBe('/assets/card-backs/Base-back.png');
  });
  it('backTexture is cached per deck and driven by the active (Setup) deck, with the Base fallback in the paint path', () => {
    const src = readFileSync(new URL('../src/three/cardTextures.ts', import.meta.url), 'utf8');
    expect(src).toContain('`back:${deck}:${res}`');
    expect(src).toContain('getActiveDeck()');
    expect(src).toContain("loadDeckBack('base', paint)"); // load-failure fallback paints Base
    expect(src).toContain('backFailed'); // an errored back falls back instead of painting broken
  });
  it('Scene reads the back texture every render (no stale memo), so a deck change switches hand, opponents and pile together', () => {
    const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
    expect(scene).toContain('const back = backTexture(res, aniso);');
    expect(scene).not.toContain('useMemo(() => backTexture');
  });
});
