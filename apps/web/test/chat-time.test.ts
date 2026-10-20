import { describe, expect, it } from 'vitest';
import { chatGroupInfo, chatNeedsSeparator, chatTimeLabel } from '../src/social/chatTime';

/** Local-time epoch for a given day/time, so labels are timezone-independent. */
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 10, 20, 12, 0); // Tue Oct 20 2026, noon

describe('chatTimeLabel (iMessage format)', () => {
  it('today shows "Today h:mm AM"', () => {
    expect(chatTimeLabel(at(2026, 10, 20, 7, 21), NOW)).toBe('Today 7:21 AM');
  });
  it('yesterday shows "Yesterday h:mm PM"', () => {
    expect(chatTimeLabel(at(2026, 10, 19, 21, 3), NOW)).toBe('Yesterday 9:03 PM');
  });
  it('older shows "Mon Oct 13 4:15 PM" style', () => {
    expect(chatTimeLabel(at(2026, 10, 13, 16, 15), NOW)).toBe('Tue Oct 13 4:15 PM');
  });
});

describe('chatNeedsSeparator', () => {
  it('the first line always opens a segment', () => {
    expect(chatNeedsSeparator(undefined, NOW)).toBe(true);
  });
  it('a short same-day gap needs none', () => {
    expect(chatNeedsSeparator(at(2026, 10, 20, 7, 0), at(2026, 10, 20, 7, 29))).toBe(false);
  });
  it('a 30-minute silence opens a new segment', () => {
    expect(chatNeedsSeparator(at(2026, 10, 20, 7, 0), at(2026, 10, 20, 7, 30))).toBe(true);
  });
  it('a day change opens a new segment even minutes apart', () => {
    expect(chatNeedsSeparator(at(2026, 10, 19, 23, 59), at(2026, 10, 20, 0, 1))).toBe(true);
  });
});

describe('chatGroupInfo', () => {
  const line = (from: string, t: number) => ({ from, at: t });
  const base = at(2026, 10, 20, 7, 0);

  it('consecutive same-sender lines group tight: one start, one end', () => {
    const lines = [line('a', base), line('a', base + 60_000), line('a', base + 120_000)];
    expect(chatGroupInfo(lines, 0)).toEqual({ separator: true, groupStart: true, groupEnd: false });
    expect(chatGroupInfo(lines, 1)).toEqual({ separator: false, groupStart: false, groupEnd: false });
    expect(chatGroupInfo(lines, 2)).toEqual({ separator: false, groupStart: false, groupEnd: true });
  });

  it('a sender change ends the group', () => {
    const lines = [line('a', base), line('b', base + 60_000)];
    expect(chatGroupInfo(lines, 0).groupEnd).toBe(true);
    expect(chatGroupInfo(lines, 1).groupStart).toBe(true);
  });

  it('a gap over the group window starts a new group without a separator', () => {
    const lines = [line('a', base), line('a', base + 6 * 60_000)];
    expect(chatGroupInfo(lines, 1)).toEqual({ separator: false, groupStart: true, groupEnd: true });
  });

  it('a separator always re-opens the group (name + avatar show again)', () => {
    const lines = [line('a', base), line('a', base + 45 * 60_000)];
    expect(chatGroupInfo(lines, 1)).toEqual({ separator: true, groupStart: true, groupEnd: true });
  });
});
