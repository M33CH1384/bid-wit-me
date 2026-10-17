import { describe, expect, it } from 'vitest';
import { DRAG_THRESHOLD_PX, dragStarted, dropResult } from '../src/dragPlay';

describe('drag-to-play', () => {
  it('a press under 10px is still a tap', () => {
    expect(DRAG_THRESHOLD_PX).toBe(10);
    expect(dragStarted(6, 6)).toBe(false);
    expect(dragStarted(8, 7)).toBe(true);
  });
  it('a legal card released over the felt plays; in the hand it snaps back; an illegal card shakes', () => {
    const base = { handTop: 560, screenH: 844 };
    expect(dropResult({ ...base, legal: true, y: 350 })).toBe('play');
    expect(dropResult({ ...base, legal: true, y: 600 })).toBe('snap');
    expect(dropResult({ ...base, legal: true, y: 40 })).toBe('snap');
    expect(dropResult({ ...base, legal: false, y: 350 })).toBe('shake');
  });
});
