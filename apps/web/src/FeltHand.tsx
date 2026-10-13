import { type Card, cardLabel } from '@spades/rules';
import { useEffect, useRef } from 'react';
import { paintFace } from './cardArt';

/** How far a tapped card rises, in CSS pixels. Same extra as the 3D selected pose. */
export const FELT_SELECT_LIFT_PX = 10;

/**
 * Fan pose for one quick-load card. The selected lift is a screen-up translate written to the
 * left of the rotation: an inline transform replaces any class transform, and a translate
 * inside the rotation would walk the end cards sideways.
 */
export function feltCardTransform(index: number, count: number, selected: boolean): string {
  const mid = (count - 1) / 2;
  const rot = (index - mid) * 3.2;
  const sag = Math.abs(index - mid) * 3;
  const fan = `rotate(${rot}deg) translateY(${sag}px)`;
  return selected ? `translateY(-${FELT_SELECT_LIFT_PX}px) ${fan}` : fan;
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
      <div className="felt-hand" data-testid="felt-hand" aria-hidden="true">
        {cards.map((c, i) => {
          if (i >= (visibleCount ?? cards.length)) return null;
          const red = c[1] === 'H' || c[1] === 'D' || c === 'BJ';
          const can = legal.includes(c);
          const picked = selected === c;
          return (
            <button
              key={c}
              type="button"
              tabIndex={-1}
              className={`${red ? 'red' : ''} ${can ? 'legal' : ''} ${picked ? 'sel' : ''}`}
              style={{ transform: feltCardTransform(i, cards.length, picked), zIndex: picked ? 20 : i }}
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
