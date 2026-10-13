import { type Card, cardLabel } from '@spades/rules';
import { useEffect, useRef, useState } from 'react';
import { paintFace } from './cardArt';

/** How far a tapped card rises, in CSS pixels, on top of any playable lift. Same extra as the 3D selected pose. */
export const FELT_SELECT_LIFT_PX = 10;
/** How far a playable card rises when the hand is mixed. Same as the 3D legal pose. No ring. */
export const FELT_LEGAL_LIFT_PX = 12;
/** Exposed strip we aim for. A full 13- or 17-card row cannot reach it and still fit, so the card grows instead. */
export const FELT_EXPOSED_PX = 44;

/**
 * Quick-load card box. Bigger than the old 52×74, kept inside `screenW` with a few pixels for the outline.
 * The exposed strip is 44px when that still leaves a readable card; otherwise the row fits at about a third showing.
 */
export function feltCardBox(count: number, screenW: number): { width: number; height: number; margin: number; exposed: number } {
  const widthPx = Number.isFinite(screenW) && screenW >= 32 ? screenW : 390;
  const avail = Math.max(80, widthPx - 12);
  const gaps = Math.max(0, Math.max(1, count) - 1);
  let width: number;
  let exposed: number;
  if (gaps === 0) {
    width = Math.min(120, avail);
    exposed = width;
  } else {
    const widthAt44 = avail - gaps * FELT_EXPOSED_PX;
    if (widthAt44 >= 64) {
      width = Math.min(120, widthAt44);
      exposed = (avail - width) / gaps;
      if (exposed < width * 0.3) {
        width = avail / (1 + gaps * 0.3);
        exposed = width * 0.3;
      }
    } else {
      width = Math.min(120, avail / (1 + gaps * 0.32));
      exposed = (avail - width) / gaps;
      if (exposed < width * 0.3) {
        width = avail / (1 + gaps * 0.3);
        exposed = (avail - width) / gaps;
      }
    }
  }
  return { width, height: width * 1.4, margin: -(width - exposed) / 2, exposed };
}

/**
 * Fan pose for one quick-load card. The selected lift is a screen-up translate written to the
 * left of the rotation: an inline transform replaces any class transform, and a translate
 * inside the rotation would walk the end cards sideways.
 */
/** Flat cards keep fan order. A legal card clears every flat card; a selection clears the legal band too. */
export const FELT_LEGAL_Z = 200;
export const FELT_SELECT_Z = 400;

export function feltCardZ(index: number, legal: boolean, selected: boolean): number {
  if (selected) return FELT_SELECT_Z + index;
  if (legal) return FELT_LEGAL_Z + index;
  return index;
}

export function feltCardTransform(index: number, count: number, selected: boolean, raised = false): string {
  const mid = (count - 1) / 2;
  const rot = (index - mid) * 3.2;
  const sag = Math.abs(index - mid) * 3;
  const fan = `rotate(${rot}deg) translateY(${sag}px)`;
  const up = (raised ? FELT_LEGAL_LIFT_PX : 0) + (selected ? FELT_SELECT_LIFT_PX : 0);
  return up > 0 ? `translateY(-${up}px) ${fan}` : fan;
}

/**
 * The saved hand, drawn with canvas (no WebGL) so a reload can be played before the 3D scene arrives.
 * Faces paint one card per frame. The buttons are live on the first frame, with the rank as a stand-in.
 */
export function FeltHand({ cards, trick, legal, selected, onCard, promoted, visibleCount }: {
  cards: Card[];
  trick: Card[];
  legal: Card[];
  selected: Card | null;
  onCard: (c: Card) => void;
  promoted: (c: Card) => boolean;
  /** Fan slots that have left the deck. Omit to show the whole hand (a resumed deal is already finished). */
  visibleCount?: number;
}) {
  const slots = useRef(new Map<string, HTMLCanvasElement | null>());
  const key = `${cards.join(',')}|${trick.join(',')}`;
  const [screenW, setScreenW] = useState(() => (typeof window === 'undefined' ? 390 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setScreenW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const box = feltCardBox(cards.length, screenW);

  useEffect(() => {
    const queue = [...cards, ...trick];
    let i = 0;
    let raf = 0;
    const step = () => {
      if (i >= queue.length) return;
      const c = queue[i++]!;
      const el = slots.current.get(c);
      if (el) {
        const src = paintFace(c, 240, 336, promoted(c));
        const ctx = el.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, el.width, el.height);
          ctx.drawImage(src, 0, 0);
          el.parentElement?.classList.add('drawn');
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {trick.length > 0 && (
        <div className="felt-trick" aria-hidden>
          {trick.map((c) => (
            <canvas key={c} width={240} height={336} ref={(el) => { slots.current.set(c, el); }} />
          ))}
        </div>
      )}
      {/* Visual only. The screen-reader hand in Table is the one labeled control per card. */}
      <div className="felt-hand" data-testid="felt-hand" aria-hidden="true" style={{ height: box.height + 36 }}>
        {cards.map((c, i) => {
          if (i >= (visibleCount ?? cards.length)) return null;
          const red = c[1] === 'H' || c[1] === 'D' || c === 'BJ';
          const can = legal.includes(c);
          const picked = selected === c;
          const mixed = legal.length > 0 && legal.length < cards.length;
          return (
            <button
              key={c}
              type="button"
              tabIndex={-1}
              className={`${red ? 'red' : ''} ${can ? 'legal' : ''} ${picked ? 'sel' : ''}`}
              style={{
                transform: feltCardTransform(i, cards.length, picked, can && mixed),
                zIndex: feltCardZ(i, can, picked),
                width: box.width,
                height: box.height,
                margin: `0 ${box.margin}px`,
              }}
              disabled={!can}
              aria-pressed={selected === c}
              onClick={() => onCard(c)}
            >
              <canvas width={240} height={336} ref={(el) => { slots.current.set(c, el); }} />
              <span>{cardLabel(c)}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
