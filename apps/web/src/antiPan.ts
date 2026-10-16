/**
 * In-game anti-pan: the table must never scroll, rubber-band or pan under a drag, wherever the finger starts
 * (on a card, in the gaps between strips, on a plate, anywhere along the bottom). Menus, sheets and the
 * score pad keep scrolling: a touch inside a scroller or a control is left alone.
 */
const SCROLLERS = 'input, textarea, select, [contenteditable], .scroll, .sheet, .sheet-body, .modal, [role="dialog"], .bid-panel, .bc-body, .hm-beats, .coach .basics, .chat-panel, .menu-panel, .score-pad, .modal-backdrop, .game-menu, .chat-list, [data-scroll]';

/** True when a touch on this element should be blocked from panning the page. */
export function blocksPan(target: Element | null, root: Element): boolean {
  if (!target || !root.contains(target)) return false;
  return !target.closest(SCROLLERS);
}

/** Body lock while a game is on screen; returns the undo. */
export function lockBody(doc: Document = document): () => void {
  const html = doc.documentElement;
  html.classList.add('bwm-in-game');
  return () => html.classList.remove('bwm-in-game');
}

/** Non-passive touch listeners on the game root. Returns the cleanup. */
export function guardTouches(root: HTMLElement): () => void {
  const onStart = (e: TouchEvent) => {
    const t = e.target as Element | null;
    // touchstart is only cancelled on the canvas / hand layer, so buttons and plates still get their clicks
    if (t && blocksPan(t, root) && t.closest('canvas, [data-testid="hand"], .hand-layer') && e.cancelable) e.preventDefault();
  };
  const onMove = (e: TouchEvent) => {
    if (blocksPan(e.target as Element | null, root) && e.cancelable) e.preventDefault();
  };
  root.addEventListener('touchstart', onStart, { passive: false });
  root.addEventListener('touchmove', onMove, { passive: false });
  return () => {
    root.removeEventListener('touchstart', onStart);
    root.removeEventListener('touchmove', onMove);
  };
}
