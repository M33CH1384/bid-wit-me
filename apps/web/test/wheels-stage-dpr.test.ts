import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The Wheels car read COMPLETELY BLURRED on the owner's phone
// (2026-11-08, third report) after two texture rounds (2026-11-05
// un-squeeze + anisotropy; 2026-11-08 the restored supercar at a
// native 2048² bake) each measured "sharp" in sandbox rigs. Those
// rigs measured the render BUFFER at the app's own backing size and
// never the displayed frame: the results stage is its own small
// Canvas capped at dpr [1, 2], so on the owner's DPR-3 phone every
// stage frame — silhouette and surface alike — is upscaled 1.5x by
// the compositor before he sees it. The stage is a small isolated
// canvas (min(88vw, 540px) at 16:10), so its backing can match the
// display outright: the cap must reach DPR 3. Lane record and the
// device-class measurements (edge widths, today vs native) live in
// ~/workspace/_wheels-blur3-work/NOTES.md.
describe('wheels results stage — backing resolution reaches the display', () => {
  it('the stage Canvas dpr ceiling covers a DPR-3 phone (no compositor upscale)', () => {
    const src = readFileSync(new URL('../src/three/WheelsStage3D.tsx', import.meta.url), 'utf8');
    expect(src).toContain('dpr={[1, 3]}');
    expect(src).not.toContain('dpr={[1, 2]}');
  });
});
