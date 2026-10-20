/**
 * Chat auto-scroll policy (table chat + social chats): stick to the bottom while the user
 * is at/near it, and release the stick when they scroll up to read history — coming back
 * down re-engages it. iOS Safari perpetually restarts `scrollTo({ behavior: 'smooth' })`
 * while lines stream in (bids, trick results), so an open chat can look frozen; direct
 * `scrollTop = scrollHeight` assignment is the reliable primitive.
 */

/** px from the bottom within which the view counts as "at the bottom" */
export const CHAT_STICK_PX = 80;

export function chatStickToBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= CHAT_STICK_PX;
}
