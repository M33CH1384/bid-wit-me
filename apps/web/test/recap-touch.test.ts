import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runReviewOverTable } from '../src/RunZoom';
import { rectsOverlap, speakerSlotBox } from '../src/SoundControls';

describe('recap touch', () => {
  it('does not put the Run it! portal over Table Talk or game over', () => {
    expect(runReviewOverTable('playing')).toBe(true);
    expect(runReviewOverTable('handOver')).toBe(false);
    expect(runReviewOverTable('gameOver')).toBe(false);
  });

  it('keeps the in-game speaker a square that cannot cover Save', () => {
    // A tall scorebug slot (wrapped scores, safe area) used to stretch the speaker down over Save.
    const slot = { top: 8, right: 384, width: 40, height: 120 };
    const box = speakerSlotBox(slot, 390, true);
    const speaker = { left: 390 - box.right - box.width, top: box.top, width: box.width, height: box.height };
    const save = { left: 310, top: 88, width: 60, height: 34 };
    expect(box).toEqual({ top: 8, right: 6, width: 40, height: 40 });
    expect(rectsOverlap(speaker, save)).toBe(false);
    expect(rectsOverlap({ left: 344, top: 8, width: 40, height: 120 }, save)).toBe(true);
  });

  it('leaves the idle nuke banner out of hit testing', () => {
    const hype = readFileSync(new URL('../src/Hype.tsx', import.meta.url), 'utf8');
    // The banner mounts only while a nuke is on screen, so an idle table has nothing to hit.
    expect(hype).toMatch(/\{nuke && \([\s\S]*className=\{`nuke-banner/);
    expect(hype).not.toMatch(/nuke-banner driven/);
  });
});
