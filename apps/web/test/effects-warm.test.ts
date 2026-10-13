import { describe, expect, it } from 'vitest';
import { EFFECT_NOISE_SECONDS } from '../src/audio';
import { EFFECT_WARM_TIMEOUT_MS, SHOT_IMAGE_URLS, compileAfterReady, tableStillLoading } from '../src/effects/warm';
import { readFileSync } from 'node:fs';

describe('effect warm', () => {
  it('holds the loading screen until the effects are warm, and gives up', () => {
    expect(tableStillLoading(true, false, false)).toBe(true);
    expect(tableStillLoading(false, true, false)).toBe(true);
    expect(tableStillLoading(true, true, false)).toBe(false);
    expect(tableStillLoading(false, false, true)).toBe(false);
    expect(EFFECT_WARM_TIMEOUT_MS).toBeGreaterThan(0);
    expect(EFFECT_WARM_TIMEOUT_MS).toBeLessThan(40000);
  });

  it('prebuilds the shot and tornado noise buffers and decodes the shot images', () => {
    expect(EFFECT_NOISE_SECONDS).toContain(2.7);
    expect(SHOT_IMAGE_URLS).toEqual(['/shot/hole.png', '/shot/tape.webp']);
    const sheet = readFileSync(new URL('../src/sheetClothSim.ts', import.meta.url), 'utf8');
    expect(sheet).toContain('/shot/rip.webp');
    expect(sheet).toContain('initTexture');
    expect(sheet).toContain('compileAsync');
    const tornado = readFileSync(new URL('../src/three/Tornado3D.tsx', import.meta.url), 'utf8');
    expect(tornado).toContain('compileAsync');
    expect(tornado).toContain('warmTornado');
  });

  it('starts the shader give-up only once the compile can run', async () => {
    const ready = new Promise((resolve) => { setTimeout(resolve, 40); });
    const result = await compileAfterReady(ready, async () => 'compiled', 'gave-up', 25);
    expect(result.timedOut).toBe(false);
    expect(result.value).toBe('compiled');
    expect(result.ms).toBeLessThan(25);
  });

  it('gives up when the compile itself stalls', async () => {
    const result = await compileAfterReady(Promise.resolve(), () => new Promise(() => {}), 'gave-up', 30);
    expect(result.timedOut).toBe(true);
    expect(result.value).toBe('gave-up');
  });
});