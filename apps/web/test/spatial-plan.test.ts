import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
describe('spatial audio phase 1 plan', () => {
  it('documents audit, architecture, library choice and phases', () => {
    const p = new URL('../../../docs/spatial-audio-plan.md', import.meta.url);
    expect(existsSync(p)).toBe(true);
    const doc = readFileSync(p, 'utf8');
    for (const t of ['PannerNode', 'video.ts', 'LiveKit', 'HRTF', 'Competitive Tournament', 'asset-licenses', 'Phase 8', 'Audio-quality setting', 'Per-player mute', 'Separate environment picker', 'Story Mode per-stop', 'GATED', 'convolver', 'randomised per game', 'Loading screen', 'One sound style PER ROOM', 'Yacht Deck', 'APPROVED by Demetrius', 'seeded by the host']) expect(doc).toContain(t);
  });
});
