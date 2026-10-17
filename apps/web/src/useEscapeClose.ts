import { useCallback, useEffect, useRef } from 'react';

/**
 * Escape dismisses the topmost overlay that opted in. A sheet opened on top of
 * another one takes the key; the one underneath waits for the next Escape.
 * The element attached to the returned ref is the overlay.
 */
const closers = new Map<HTMLElement, () => void>();
let listening = false;

function topmost(): HTMLElement | null {
  const live = [...closers.keys()].filter((n) => n.isConnected);
  if (!live.length) return null;
  return live.reduce((best, node) => {
    const pos = best.compareDocumentPosition(node);
    // A node inside another is the one on top. Otherwise the later sibling is.
    if (pos & Node.DOCUMENT_POSITION_CONTAINED_BY) return node;
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING && !(pos & Node.DOCUMENT_POSITION_CONTAINS)) return node;
    return best;
  });
}

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  const top = topmost();
  if (!top) return;
  e.preventDefault();
  e.stopPropagation();
  closers.get(top)?.();
}

function ensureListener() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('keydown', onKey, true);
}

export function useEscapeClose(onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const elRef = useRef<HTMLElement | null>(null);
  useEffect(() => () => {
    if (elRef.current) closers.delete(elRef.current);
  }, []);
  return useCallback((el: HTMLElement | null) => {
    if (elRef.current === el) return;
    if (elRef.current) closers.delete(elRef.current);
    elRef.current = el;
    if (!el) return;
    ensureListener();
    closers.set(el, () => closeRef.current());
  }, []);
}
