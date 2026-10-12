import { useMemo } from 'react';
import { type Card, type TableRules, sortHand } from '@spades/rules';
import { drawFace } from './three/cardTextures';
import { isPromoted } from './cardFaces';

const urls = new Map<string, string>();
/** the same face art as the 3D cards, as an image (cached) */
export function faceUrl(c: Card, badge: boolean): string {
  const k = `${c}:${badge ? 1 : 0}`;
  let u = urls.get(k);
  if (!u) { u = drawFace(c, 240, 336, badge).toDataURL('image/png'); urls.set(k, u); }
  return u;
}

/**
 * 'Run it!' step 1: the claimer's remaining cards, big and face up in a row at the centre (~1.5 s) so everyone can see
 * them, with the claimer's line in a big speech bubble. Two rows when there are many (phones stay readable).
 */
export function RunZoom({ cards, who, line, r }: { cards: Card[]; who: string; line: string | null; r: TableRules }) {
  const imgs = useMemo(() => cards.map((c) => ({ c, src: faceUrl(c, isPromoted(c, r)) })), [cards, r]);
  const rows = cards.length > 7 ? 2 : 1;
  const perRow = Math.ceil(cards.length / rows);
  return (
    <div className="run-zoom" data-testid="run-zoom" style={{ ['--per-row' as string]: perRow }} aria-live="polite">
      <div className="run-zoom-who"><span className="run-zoom-tag">RUN IT!</span> {who} {who === 'You' ? 'have' : 'has'} the rest</div>
      {line && <div className="run-bubble" data-testid="run-line">{line}</div>}
      <div className="run-zoom-cards">
        {imgs.map(({ c, src }, i) => <img key={c} src={src} alt={c} className="run-zoom-card" style={{ ['--i' as string]: i }} />)}
      </div>
    </div>
  );
}

/**
 * After a resolved 'Run it!': every hand the tornado cleared, labeled by player, so the table can check the claim.
 * `hands` is already in local seat order (seat 0 is the viewer, or the anchor for a spectator).
 */
export function RunItReview({ hands, claimer, labels, r, onClose }: {
  hands: Card[][];
  claimer: number;
  labels: string[];
  r: TableRules;
  onClose: () => void;
}) {
  const rows = useMemo(() => hands.map((cards) => cards.map((c) => ({ c, src: faceUrl(c, isPromoted(c, r)) }))), [hands, r]);
  const who = labels[claimer] ?? 'Someone';
  return (
    <div className="run-review" data-testid="run-it-view" role="dialog" aria-label="Run it" onClick={(e) => e.stopPropagation()}>
      <div className="run-review-head">
        <span className="lt-label">RUN IT!</span>
        <button type="button" className="run-review-x" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      <p className="run-review-sub">{who} ran the rest. Every hand the tornado cleared.</p>
      {rows.map((cards, seat) => (
        <div key={seat} className={`run-hand${seat === claimer ? ' claimer' : ''}`} data-testid={`run-hand-${seat}`}>
          <b title={labels[seat]}>{labels[seat]}</b>
          <div className="run-hand-cards">
            {sortHand(cards.map((x) => x.c), r).map((c) => {
              const src = cards.find((x) => x.c === c)!.src;
              return <img key={c} src={src} alt={c} data-card={c} />;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
