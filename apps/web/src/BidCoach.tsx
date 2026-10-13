import { useEffect, useMemo, useRef, useState } from 'react';
import { type PlayerView, cardLabel, createRng, handSize } from '@spades/rules';
import { type BidAdvice, bidAdvice } from '@spades/bots';
import { topTrumps } from './glossary';

/** ~1½ style: books rounded to the nearest half. */
export function halves(v: number): string {
  const h = Math.round(v * 2) / 2;
  const whole = Math.floor(h);
  const frac = h - whole ? '½' : '';
  return whole === 0 && frac ? frac : `${whole}${frac}`;
}

const SHORT: Record<string, string> = { trumps: 'Top spades', aces: 'Aces', kings: 'Kings', length: 'Many spades', cutting: 'Cuts' };

interface Row { key: string; label: string; detail: string; value: number }

function rowsFor(a: BidAdvice['analysis']): Row[] {
  const rows: Row[] = [];
  const list = (items: { cards: string[]; note: string }[]) => items.map((x) => `${x.cards.map((c) => cardLabel(c as never)).join(' ')}${x.note === 'maybe' ? '?' : ''}`).join(' · ');
  const sum = (items: { value: number }[]) => items.reduce((s, x) => s + x.value, 0);
  if (a.sureTrumps.length) rows.push({ key: 'trumps', label: 'Top spades (trumps)', detail: list(a.sureTrumps), value: sum(a.sureTrumps) });
  const aces = a.sideWinners.filter((x) => x.note.startsWith('ace'));
  const rest = a.sideWinners.filter((x) => !x.note.startsWith('ace'));
  if (aces.length) rows.push({ key: 'aces', label: 'Aces (not spades)', detail: list(aces), value: sum(aces) });
  if (rest.length) rows.push({ key: 'kings', label: 'Kings & queens with backup', detail: rest.map((x) => `${cardLabel(x.cards[0]!)} (${x.note})`).join(' · '), value: sum(rest) });
  if (a.length) rows.push({ key: 'length', label: 'Lots of spades', detail: a.length.note, value: a.length.value });
  else rows.push({ key: 'length', label: 'Lots of spades', detail: `${a.trumpCount} spade${a.trumpCount === 1 ? '' : 's'} (trumps): not enough for extra books`, value: 0 });
  if (a.cutting) rows.push({ key: 'cutting', label: 'Short suits (cutting)', detail: a.cutting.note, value: a.cutting.value });
  return rows;
}

/**
 * The bid coach: teaches book counting with the player's actual hand — sure winners, spade length, cutting,
 * the partner adjustment and Nil — using the same count the bots bid from, then a suggested range.
 * `compact` = one line (expand with "Why?"); it starts expanded the first few times.
 */
export function BidCoach({ view, startOpen, onClose, title = 'BID COACH' }: { view: PlayerView; startOpen: boolean; onClose?: () => void; title?: string }) {
  const [open, setOpen] = useState(startOpen);
  const [how, setHow] = useState(false);
  const howRef = useRef<HTMLButtonElement>(null);
  // opening "How to count books" scrolls it into view inside the coach body
  useEffect(() => { if (how) requestAnimationFrame(() => howRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })); }, [how]);
  const adv = useMemo(() => {
    if (!view.hand) return null;
    const v: PlayerView = view.bidOptions ? view : { ...view, bidOptions: { min: 1, max: handSize(view.rules), nil: view.rules.nil.allowed, blindNil: false, blockReason: null, nilReason: null } };
    return bidAdvice(v, createRng(`${view.seat}:${view.handNo}:coach`));
  }, [view]);
  if (!adv) return null;
  const range = adv.low === adv.high ? `${adv.low}` : `${adv.low}–${adv.high}`;
  const rows = rowsFor(adv.analysis);
  return (
    <div className={`bid-coach ${open ? 'open' : ''}`} data-testid="bid-coach" data-suggest={range}>
      <div className="bc-head">
        <span className="coach-badge">{title}</span>
        <b className="bc-suggest" data-testid="bid-suggest">Suggested: {range}</b>
        <button type="button" className="link bc-why" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Why?'}</button>
        {onClose && <button type="button" className="icon-btn bc-close" aria-label="Close bid coach" onClick={onClose}>✕</button>}
      </div>
      {!open && (
        <div className="bc-chips">
          {rows.filter((r) => r.value > 0).map((r) => <span key={r.key} className="bc-chip">{SHORT[r.key] ?? r.label} <b>+{halves(r.value)}</b></span>)}
          <span className="bc-chip total">≈ {halves(adv.estimate)} books</span>
          {adv.partnerNote && typeof view.bids[(view.seat + 2) % 4] === 'number' && view.rules.partnerships && <span className="bc-chip partner">{adv.partnerNote.split('.')[0]}</span>}
        </div>
      )}
      {open && (
        <div className="bc-body">
          <p className="bc-count">Books you can probably win ≈ {halves(adv.estimate)}:</p>
          <ul className="bc-rows">
            {rows.map((r) => (
              <li key={r.key} className={r.value ? '' : 'zero'}>
                <span className="bc-label">{r.label}</span>
                <span className="bc-detail">{r.detail}</span>
                <span className="bc-val">{r.value ? `+${halves(r.value)}` : '0'}</span>
              </li>
            ))}
            {adv.analysis.factor !== 1 && <li><span className="bc-label">3 players</span><span className="bc-detail">big hands, only two opponents</span><span className="bc-val">×1.15</span></li>}
          </ul>
          {adv.partnerNote && <p className="bc-note"><b>Partner:</b> {adv.partnerNote}</p>}
          {adv.tableNote && <p className="bc-note"><b>Table:</b> {adv.tableNote}</p>}
          {adv.nil && <p className={`bc-note ${adv.nil.ok ? 'good' : ''}`}><b>Nil:</b> {adv.nil.note.replace(/^Nil\??:?\s*/, '')}</p>}
          <button type="button" ref={howRef} className="link bc-how" aria-expanded={how} onClick={() => setHow(!how)}>{how ? '▾' : '▸'} New to this? How to count books</button>
          {how && (
            <ol className="bc-how-list">
              <li><b>Count sure winners.</b> A book is one round where everyone plays a card and the best card takes them all. Your strongest spades (the trumps: {topTrumps(view.rules, 4)}) almost always win one each. So do aces of hearts, diamonds and clubs.</li>
              <li><b>Kings with backup.</b> A king plus at least one smaller card of the same suit often wins too: you play the small one while the ace comes out.</li>
              <li><b>Lots of spades.</b> If you hold more than 3–4 spades, the extra ones usually win near the end, when others have run out.</li>
              <li><b>Short suits.</b> With no cards (or just one or two) in a suit, you can soon play a spade on it: that's cutting, and it wins the book.</li>
              {view.rules.partnerships && <li><b>Add your partner.</b> Your bid plus theirs is the team's goal, and there are only {handSize(view.rules)} books. Together 10 or more is called <b>wheels</b> (a 10+ bid): big points, big risk. Unsure? Bid a little low: falling short (getting set) costs 10 points per book bid.</li>}
              {view.rules.nil.allowed && <li><b>Nil (zero).</b> Only with no aces, no high spades, and lots of low cards to play under everyone.</li>}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
