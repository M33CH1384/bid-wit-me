/**
 * "Chat is a stable place" (owner, 2026-10-20): chat UI state survives a page refresh, so a
 * player who was in a chat comes back to that same chat instead of being dumped on the home
 * wizard / Open tables. State lives in sessionStorage: a refresh in the same tab restores it,
 * a new tab or a visit tomorrow starts clean. Leaving a table clears the table-chat flag, so
 * it never leaks into the next game.
 */

/** In-game table chat open flag (one table per tab). */
const TABLE_CHAT_KEY = 'bwm.tablechat.open';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
function ss(): Store | null { try { return sessionStorage; } catch { return null; } }

export function loadTableChatOpen(fallback: boolean, storage: Store | null = ss()): boolean {
  try {
    const v = storage?.getItem(TABLE_CHAT_KEY);
    if (v !== null && v !== undefined) return v === '1';
  } catch { /* private mode */ }
  return fallback;
}

export function saveTableChatOpen(open: boolean, storage: Store | null = ss()): void {
  try { storage?.setItem(TABLE_CHAT_KEY, open ? '1' : '0'); } catch { /* private mode */ }
}

export function clearTableChatOpen(storage: Store | null = ss()): void {
  try { storage?.removeItem(TABLE_CHAT_KEY); } catch { /* private mode */ }
}
