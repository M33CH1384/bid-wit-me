import { describe, expect, it } from 'vitest';
import { chatStartsOpen, overcutBannerTop, placeCallout } from '../src/chatLayout';

describe('chat layout', () => {
  it('starts collapsed on a phone and a narrow desktop', () => {
    expect(chatStartsOpen(390, 844)).toBe(false);
    expect(chatStartsOpen(1100, 800)).toBe(false);
    expect(chatStartsOpen(1280, 700)).toBe(true);
    expect(chatStartsOpen(1440, 600)).toBe(false);
  });

  it('parks an over-cut banner off the trick', () => {
    const trick = [{ x: 120, y: 280, w: 70, h: 98 }];
    const top = overcutBannerTop(trick, 844, 64);
    expect(top + 64).toBeLessThanOrEqual(280);
    expect(top).toBeGreaterThanOrEqual(96);
    const low = [{ x: 120, y: 80, w: 70, h: 98 }];
    expect(overcutBannerTop(low, 844, 64)).toBeGreaterThanOrEqual(80 + 98);
  });

  it('moves a callout off the trick when the plate sits on the felt', () => {
    const trick = { left: 80, top: 260, right: 310, bottom: 480 };
    const plate = { left: 8, top: 340, right: 120, bottom: 400 };
    const spot = placeCallout(plate, 'left', { w: 180, h: 48 }, { w: 390, h: 844 }, [trick]);
    const box = { left: spot.left, top: spot.top, right: spot.left + 180, bottom: spot.top + 48 };
    expect(box.right <= trick.left || box.left >= trick.right || box.bottom <= trick.top || box.top >= trick.bottom).toBe(true);
  });
});