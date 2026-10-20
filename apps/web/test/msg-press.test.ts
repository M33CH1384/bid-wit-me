import { describe, expect, it } from 'vitest';
import {
  CLICK_SWALLOW_MS, LONG_PRESS_MS, POPOVER_H, POPOVER_H_PALETTE, POPOVER_H_REPLY, POPOVER_W, PRESS_SLOP_PX,
  beginPress, firePress, movePress, popoverPos, swallowClickAt,
} from '../src/social/msgPress';

describe('long-press state machine', () => {
  it('a press starts pending at the touch point', () => {
    expect(beginPress(7, 100, 200)).toEqual({ id: 7, x: 100, y: 200, status: 'pending' });
    expect(LONG_PRESS_MS).toBe(450);
  });

  it('small jitter keeps the press pending; travel past the slop cancels it (scroll won)', () => {
    const s = beginPress(3, 50, 50);
    expect(movePress(s, 50 + PRESS_SLOP_PX - 1, 50).status).toBe('pending');
    expect(movePress(s, 50, 50 + PRESS_SLOP_PX + 1).status).toBe('cancelled');
    // diagonal travel counts by distance, not per-axis
    expect(movePress(s, 50 + PRESS_SLOP_PX, 50 + PRESS_SLOP_PX).status).toBe('cancelled');
  });

  it('a cancelled press stays cancelled and can never fire', () => {
    const s = movePress(beginPress(1, 0, 0), 999, 0);
    expect(s.status).toBe('cancelled');
    expect(movePress(s, 0, 0).status).toBe('cancelled');
    expect(firePress(s).status).toBe('cancelled');
  });

  it('only a pending press fires', () => {
    expect(firePress(beginPress(2, 10, 10)).status).toBe('fired');
    const fired = firePress(beginPress(2, 10, 10));
    expect(firePress(fired).status).toBe('fired'); // idempotent
  });
});

describe('click swallowing', () => {
  it('swallows the click that trails a long-press, inside the window only, once armed', () => {
    const t = 10_000;
    expect(swallowClickAt(t, t)).toBe(true);
    expect(swallowClickAt(t, t + CLICK_SWALLOW_MS)).toBe(true);
    expect(swallowClickAt(t, t + CLICK_SWALLOW_MS + 1)).toBe(false);
    expect(swallowClickAt(t, t - 1)).toBe(false); // never swallow the past
    expect(swallowClickAt(0, t)).toBe(false); // never armed
  });
});

describe('popover placement', () => {
  const vw = 400, vh = 800;
  it('sits above the bubble when there is room, hugging the bubble side', () => {
    const other = popoverPos({ top: 400, left: 48, right: 240, bottom: 440 }, vw, vh, false);
    expect(other.below).toBe(false);
    expect(other.top).toBe(400 - POPOVER_H - 10);
    expect(other.left).toBe(48);
    const mine = popoverPos({ top: 400, left: 160, right: 352, bottom: 440 }, vw, vh, true);
    expect(mine.left).toBe(352 - POPOVER_W); // right edge aligned for my bubbles
  });

  it('drops below a bubble near the top of the screen', () => {
    const pos = popoverPos({ top: 60, left: 40, right: 200, bottom: 100 }, vw, vh, false);
    expect(pos.below).toBe(true);
    expect(pos.top).toBe(110);
  });

  it('never leaves the viewport, however far right the bubble is', () => {
    const pos = popoverPos({ top: 400, left: 390, right: 398, bottom: 440 }, vw, vh, false);
    expect(pos.left).toBe(vw - POPOVER_W - 8);
    const low = popoverPos({ top: 30, left: 8, right: 100, bottom: 795 }, vw, vh, false);
    expect(low.top).toBeLessThanOrEqual(vh - POPOVER_H - 8);
  });

  it('the expanded palette needs more headroom than the plain menu', () => {
    expect(POPOVER_H_PALETTE).toBeGreaterThan(POPOVER_H);
    // a bubble the plain menu fits above (room for 128, not for 378) …
    const rect = { top: 300, left: 48, right: 240, bottom: 340 };
    expect(popoverPos(rect, vw, vh, false).below).toBe(false);
    // … flips below once the palette expands it
    const tall = popoverPos(rect, vw, vh, false, POPOVER_H_PALETTE);
    expect(tall.below).toBe(true);
    expect(tall.top).toBe(350);
    // and with real headroom the tall popover still anchors above by its own height
    const high = popoverPos({ top: 500, left: 48, right: 240, bottom: 540 }, vw, vh, false, POPOVER_H_PALETTE);
    expect(high.below).toBe(false);
    expect(high.top).toBe(500 - POPOVER_H_PALETTE - 10);
  });

  it('a tall popover below a top bubble still clamps inside the viewport', () => {
    const low = popoverPos({ top: 30, left: 8, right: 100, bottom: 795 }, vw, vh, false, POPOVER_H_PALETTE);
    expect(low.top).toBeLessThanOrEqual(vh - POPOVER_H_PALETTE - 8);
  });

  it('the reply editor height sits between menu and palette heights', () => {
    expect(POPOVER_H_REPLY).toBeGreaterThan(POPOVER_H);
    expect(POPOVER_H_REPLY).toBeLessThan(POPOVER_H_PALETTE);
  });
});
