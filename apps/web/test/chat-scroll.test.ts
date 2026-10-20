import { describe, expect, it } from 'vitest';
import { CHAT_STICK_PX, chatStickToBottom } from '../src/chatScroll';

const el = (remainingPx: number, scrollHeight = 1000) => ({
  scrollHeight,
  clientHeight: 300,
  scrollTop: scrollHeight - 300 - remainingPx,
});

describe('chatStickToBottom', () => {
  it('is stuck when scrolled exactly to the bottom', () => {
    expect(chatStickToBottom(el(0))).toBe(true);
  });

  it('is stuck when within the threshold of the bottom', () => {
    expect(chatStickToBottom(el(CHAT_STICK_PX))).toBe(true);
  });

  it('releases when the user has scrolled up to read history', () => {
    expect(chatStickToBottom(el(CHAT_STICK_PX + 1))).toBe(false);
    expect(chatStickToBottom(el(500))).toBe(false);
  });

  it('is stuck when the content fits without scrolling', () => {
    expect(chatStickToBottom({ scrollHeight: 200, scrollTop: 0, clientHeight: 300 })).toBe(true);
  });
});
