import { useState } from 'react';
import { type Card, type Trick, cardLabel } from '@spades/rules';
import { browsedTrick, stepTrickIndex, trickPositionLabel } from './lastTrickBrowse';

/**
 * The trick browser — the same browser the table's LAST TRICK readout opens
 * (cc6a5d84): ‹ / › step a hand's completed tricks on an ABSOLUTE index (a
 * trick landing mid-browse never moves the one on show), clamped at both
 * ends with no wrap, the winner lit, leader and winner named, cards at the
 * readout's glanceable size. There is ONE stepping implementation —
 * lastTrickBrowse.ts — behind both doors: the table chip renders it in
 * place on the felt; the hand recap (the score card) renders this panel in
 * its flow. Review only: the state is local, and no game action is ever
 * taken from here — closing returns the player exactly where they were.
 */
export function TrickBrowserPanel({ tricks, face, onClose }: {
  tricks: readonly Trick[];
  /** seat → display name, the table's own facing names */
  face: (seat: number) => string;
  onClose?: () => void;
}) {
  // null = pinned to the newest trick; a selection is an absolute index
  const [sel, setSel] = useState<number | null>(null);
  const browsed = browsedTrick(tricks, sel);
  if (!browsed) return null;
  const { trick: t, index } = browsed;
  const short = (c: Card) => (c === 'BJ' ? 'BJ' : c === 'LJ' ? 'LJ' : cardLabel(c));
  return (
    <div className="trick-browser" data-testid="trick-browser">
      <div className="tb-head">
        <span className="lt-label">{trickPositionLabel(index, tricks.length)}</span>
        {onClose && <button type="button" className="tb-x" data-testid="trick-browser-close" aria-label="Close trick review" onClick={onClose}>✕</button>}
      </div>
      <div className="tb-cards">
        {t.plays.map((pl) => (
          <span key={pl.card} className={`lt-card ${pl.seat === t.winner ? 'win' : ''} ${pl.card[1] === 'H' || pl.card[1] === 'D' || pl.card === 'BJ' ? 'red' : ''}`}>
            <small>{face(pl.seat).slice(0, 3)}</small>{short(pl.card)}
          </span>
        ))}
      </div>
      <span className="lt-navrow">
        <button type="button" className="lt-nav" data-testid="trick-prev" aria-label="Previous trick" disabled={index <= 0}
          onClick={() => setSel(stepTrickIndex(index, -1, tricks.length))}>‹</button>
        <span className="lt-meta" data-testid="trick-meta">{face(t.leader)} led{t.winner !== null && <> · {face(t.winner)} took it</>}</span>
        <button type="button" className="lt-nav" data-testid="trick-next" aria-label="Next trick" disabled={index >= tricks.length - 1}
          onClick={() => setSel(stepTrickIndex(index, 1, tricks.length))}>›</button>
      </span>
    </div>
  );
}

/**
 * The score-card door (owner, 2026-10-24: the recap's review control "should
 * allow u to use forward and back buttons to see previous tricks").
 * Collapsed it is a pill in the recap's flow — the Run It review's idiom —
 * and open it is the trick browser over the hand just played: back through
 * every trick of that hand to the first, forward again to the last. The
 * range is that hand only: completed hands keep no play-by-play anywhere
 * (HandRecord holds counts, not plays), so there is nothing older to show.
 * Renders nothing when the hand completed no tricks.
 */
export function RecapTrickReview({ tricks, face }: { tricks: readonly Trick[]; face: (seat: number) => string }) {
  const [open, setOpen] = useState(false);
  if (tricks.length === 0) return null;
  if (!open) {
    return (
      <button type="button" className="tt-tricks-show" data-testid="recap-tricks-show" onClick={() => setOpen(true)}>
        Review the tricks ‹ ›
      </button>
    );
  }
  return (
    <div className="tt-tricks" data-testid="recap-tricks">
      <TrickBrowserPanel tricks={tricks} face={face} onClose={() => setOpen(false)} />
    </div>
  );
}
