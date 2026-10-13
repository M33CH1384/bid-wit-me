import { type Card, cardLabel } from '@spades/rules';
import { useEffect, useRef } from 'react';
import { paintFace } from './cardArt';

/**
 * The saved hand, drawn with canvas (no WebGL) so a reload can be played before the 3D scene arrives.
 * Faces paint one card per frame. The buttons are live on the first frame, with the rank as a stand-in.
 */
export function FeltHand({ cards, trick, legal, selected, onCard, promoted }: {
  cards: Card[];
  trick: Card[];
  legal: Card[];
  selected: Card | null;
  onCard: (c: Card) => void;
  promoted: (c: Card) => boolean;
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
      <div className="felt-hand" data-testid="felt-hand" role="group" aria-label="Your hand">
        {cards.map((c, i) => {
          const red = c[1] === 'H' || c[1] === 'D' || c === 'BJ';
          const can = legal.includes(c);
          const n = cards.length;
          const mid = (n - 1) / 2;
          const rot = (i - mid) * 3.2;
          return (
            <button
              key={c}
              type="button"
              className={`${red ? 'red' : ''} ${can ? 'legal' : ''} ${selected === c ? 'sel' : ''}`}
              style={{ transform: `rotate(${rot}deg) translateY(${Math.abs(i - mid) * 3}px)`, zIndex: selected === c ? 20 : i }}
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
