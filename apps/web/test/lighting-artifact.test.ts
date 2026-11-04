import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Owner device report 2026-11-04: at the Classic Studio table (south seat,
 * sitting view) the south felt showed a rippled watery shimmer, the parquet
 * in front of his seat read wet/white-streaked, and a saturated orange band
 * sat on the apron. Two convicted sources, pinned here:
 *
 * 1. The table's streamed maps (felt/wood normal + roughness) were the only
 *    textured surfaces in the game whose loader never set anisotropy — the
 *    three.js default of 1 — so the felt's fine suede normal map aliases
 *    into wavy strand moiré at grazing angles (the whole south felt from
 *    the sitting camera). Every room loader sets 4–8; PersonaFigures
 *    carries the standing rule (raise to the device cap, <= 8).
 * 2. The Classic Studio floor's shipped roughnessMap measures ~0.10 mean,
 *    so with material roughness 1 the parquet was a near-mirror and threw
 *    a streaky white specular patch in front of the south seat. The floor
 *    now takes a scalar satin roughness; the map no longer drives it.
 *    (KingLoungeRoom copies the studio floor treatment verbatim — same fix.)
 */
const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
const classic = readFileSync(new URL('../src/three/ClassicStudio.tsx', import.meta.url), 'utf8');
const king = readFileSync(new URL('../src/three/KingLoungeRoom.tsx', import.meta.url), 'utf8');

describe('lighting artifact (owner 2026-11-04)', () => {
  it('streamed table maps are raised to the device anisotropy cap (<= 8), not left at the default 1', () => {
    const hook = scene.slice(scene.indexOf('function useStreamedMaps'), scene.indexOf('type TableGeos'));
    expect(hook).toContain('getMaxAnisotropy');
    expect(hook).toContain('tex.anisotropy = maxAniso');
    expect(hook).toContain('Math.min(8');
  });

  it('classic studio floor roughness is a scalar satin value, not the ~0.10 mirror map', () => {
    expect(classic).not.toContain('m.roughnessMap = roughnessMap');
    expect(classic).toContain('m.roughness = 0.6');
  });

  it('king lounge floor (same studio treatment, copied verbatim) gets the same fix', () => {
    expect(king).not.toContain('m.roughnessMap = roughnessMap');
    expect(king).toContain('m.roughness = 0.6');
  });
});
