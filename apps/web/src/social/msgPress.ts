/**
 * iMessage-style long-press for Social chat messages (global + DM threads).
 *
 * The visible ☺ / ↩ buttons are gone: a press-and-hold on a message bubble (or a
 * right-click with a mouse) opens one popover — reaction strip on top, Reply below.
 * This module holds the pure pieces (press state machine, click swallowing, popover
 * geometry) so they're unit-testable, plus the React hook that wires them to real
 * pointer events and timers.
 *
 * Gesture rules:
 *  - touch / pen: pointerdown starts a timer; firing at LONG_PRESS_MS opens the popover.
 *  - moving more than PRESS_SLOP_PX before it fires cancels (the gesture became a scroll);
 *    pointercancel cancels too (the browser took the gesture over for scrolling).
 *  - mouse: no hold timer — the contextmenu event opens the popover (native right-click).
 *  - the click a long-press leaves behind on release must never reach the message's own
 *    tap targets (the quote button), so firing arms a one-shot swallow window that the
 *    line's onClickCapture consults. A fixed backdrop also covers the lines while the
 *    popover is open, which is the second layer of the same defence.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** press-and-hold duration that counts as a long-press */
export const LONG_PRESS_MS = 450;
/** pointer travel (px) that turns a would-be long-press into a scroll */
export const PRESS_SLOP_PX = 10;
/** after a long-press fires (or the popover is dismissed by a backdrop tap), clicks
 *  landing within this window are the gesture's own tail and get swallowed once */
export const CLICK_SWALLOW_MS = 600;

export interface PressState {
  id: number;
  x: number;
  y: number;
  status: 'pending' | 'fired' | 'cancelled';
}

/** pointerdown: a press begins (pending until the timer fires or it cancels). */
export function beginPress(id: number, x: number, y: number): PressState {
  return { id, x, y, status: 'pending' };
}

/** pointermove: travelling past the slop radius cancels a pending press (scroll won). */
export function movePress(s: PressState, x: number, y: number): PressState {
  if (s.status !== 'pending') return s;
  return Math.hypot(x - s.x, y - s.y) > PRESS_SLOP_PX ? { ...s, status: 'cancelled' } : s;
}

/** the hold timer elapsed: a pending press fires; anything else is a no-op. */
export function firePress(s: PressState): PressState {
  return s.status === 'pending' ? { ...s, status: 'fired' } : s;
}

/** is a click at `now` the tail of the long-press that fired at `firedAt`? */
export function swallowClickAt(firedAt: number, now: number): boolean {
  return firedAt > 0 && now - firedAt >= 0 && now - firedAt <= CLICK_SWALLOW_MS;
}

/** the slice of a bubble's bounding rect the popover anchors to */
export interface AnchorRect { top: number; left: number; right: number; bottom: number }

export const POPOVER_W = 292;
export const POPOVER_H = 128;
/** viewport margin the popover never crosses */
const POP_EDGE = 8;
/** gap between the pressed bubble and the popover */
const POP_GAP = 10;

/**
 * Where the popover goes: above the pressed bubble when there's room, below it when
 * there isn't; horizontally it hugs the bubble's own side (left for other people's
 * messages, right edge for mine), clamped inside the viewport.
 */
export function popoverPos(rect: AnchorRect, vw: number, vh: number, mine: boolean): { left: number; top: number; below: boolean } {
  const maxLeft = Math.max(POP_EDGE, vw - POPOVER_W - POP_EDGE);
  const rawLeft = mine ? rect.right - POPOVER_W : rect.left;
  const left = Math.min(Math.max(rawLeft, POP_EDGE), maxLeft);
  const aboveTop = rect.top - POPOVER_H - POP_GAP;
  if (aboveTop >= POP_EDGE) return { left, top: aboveTop, below: false };
  const maxTop = Math.max(POP_EDGE, vh - POPOVER_H - POP_EDGE);
  return { left, top: Math.min(rect.bottom + POP_GAP, maxTop), below: true };
}

export interface MsgPressOpen { id: number; rect: AnchorRect }

interface PressHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export interface MsgPress {
  /** the open popover's target line + its bubble rect (null = closed) */
  open: MsgPressOpen | null;
  /** close the popover without arming the click swallow */
  close: () => void;
  /** a tap on the backdrop: arm the swallow (the tap's click lands on the lines once
   *  the backdrop unmounts) and close */
  backdropDown: () => void;
  /** spread onto a message bubble: long-press (touch/pen) + contextmenu (mouse) */
  bind: (id: number) => PressHandlers;
  /** put on the message line's onClickCapture: eats the one click a long-press leaves behind */
  onClickCapture: (e: React.SyntheticEvent) => void;
}

const rectOf = (el: HTMLElement): AnchorRect => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
};

export function useMsgPress(): MsgPress {
  const [open, setOpen] = useState<MsgPressOpen | null>(null);
  const stateRef = useRef<PressState | null>(null);
  const timerRef = useRef<number | null>(null);
  const firedAtRef = useRef(0);

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);
  useEffect(() => cancelTimer, [cancelTimer]);

  const openFor = useCallback((id: number, el: HTMLElement) => {
    firedAtRef.current = performance.now();
    setOpen({ id, rect: rectOf(el) });
  }, []);

  const close = useCallback(() => setOpen(null), []);
  const backdropDown = useCallback(() => {
    firedAtRef.current = performance.now();
    setOpen(null);
  }, []);

  const bind = useCallback((id: number): PressHandlers => ({
    onPointerDown: (e) => {
      // Mouse users get the popover from the context menu instead (a mouse hold
      // is how you select text everywhere else); touch + pen long-press.
      if (e.pointerType === 'mouse') return;
      const el = e.currentTarget as HTMLElement;
      stateRef.current = beginPress(id, e.clientX, e.clientY);
      cancelTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        const s = stateRef.current;
        if (!s || s.id !== id) return;
        const fired = firePress(s);
        stateRef.current = fired;
        if (fired.status === 'fired') openFor(id, el);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e) => {
      const s = stateRef.current;
      if (!s || s.id !== id || s.status !== 'pending') return;
      const next = movePress(s, e.clientX, e.clientY);
      stateRef.current = next;
      if (next.status === 'cancelled') cancelTimer();
    },
    onPointerUp: () => {
      // A fired press keeps its state (and swallow window) — the release click is
      // handled by the backdrop / onClickCapture. A pending press just dies.
      if (stateRef.current?.status !== 'fired') stateRef.current = null;
      cancelTimer();
    },
    onPointerCancel: () => {
      // The browser took the gesture (scroll): nothing may be left armed.
      stateRef.current = null;
      cancelTimer();
    },
    onContextMenu: (e) => {
      // Our own menu replaces the native one. On touch devices this can also arrive
      // as the tail of a long-press — openFor is idempotent for the same line.
      e.preventDefault();
      cancelTimer();
      stateRef.current = null;
      openFor(id, e.currentTarget as HTMLElement);
    },
  }), [cancelTimer, openFor]);

  const onClickCapture = useCallback((e: React.SyntheticEvent) => {
    if (swallowClickAt(firedAtRef.current, performance.now())) {
      firedAtRef.current = 0;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return { open, close, backdropDown, bind, onClickCapture };
}
