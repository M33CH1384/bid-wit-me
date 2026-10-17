import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
describe('vision pro / vr spike doc', () => {
  it('covers platforms, library choice, input mapping, audio, reuse and risks with sources', () => {
    const p = new URL('../../../docs/visionpro-vr-spike.md', import.meta.url);
    expect(existsSync(p)).toBe(true);
    const d = readFileSync(p, 'utf8');
    for (const t of ['immersive-vr', 'transient-pointer', '@react-three/xr', 'WebXRManager', 'V-slam', 'spatial.ts', 'webkit.org', 'developers.meta.com', 'NO code']) expect(d).toContain(t);
  });
});
