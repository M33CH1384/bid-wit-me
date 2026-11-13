import { useEffect, useState } from 'react';
import { type Card, type RenegeCall, type TableRules, type Trick, RENEGE_PENALTY_BOOKS } from '@spades/rules';
import { faceUrl } from './RunZoom';
import { isWildDeuce } from './cardFaces';

/**
 * Renege calls (owner, 2026-11-12) — the table surfaces of the "Renege calls"
 * house rule. With the rule on nobody is locked into following suit; these
 * three pieces are how the table polices itself:
 *
 *  - RenegeButton: the pill that opens the call sheet (only while this seat
 *    has a finished book it could still call).
 *  - RenegeSheet: this hand's finished books, face up. Tap the opponent's
 *    card that broke suit, confirm, and the engine rules on it.
 *  - RenegeVerdict: the ruling, shown to the whole table — with the proof on
 *    a correct call.
 *
 * One surface for both modes: offline the call is applied to the local
 * engine, online it goes to the room (the server is the judge).
 */

export function RenegeButton({ onOpen, recap = false }: { onOpen: () => void; recap?: boolean }) {
  // On the hand recap the call sits in the sheet's own footer row, beside Review the tricks.
  if (recap) return <button type="button" className="tt-tricks-show renege-recap" data-testid="renege-call" onClick={onOpen}>Call renege</button>;
  return (
    <div className="renege-wrap">
      <button type="button" className="renege-btn" data-testid="renege-call" onClick={onOpen}>Call renege</button>
    </div>
  );
}

function CardImg({ card, rules, className }: { card: Card; rules: TableRules; className: string }) {
  return <img src={faceUrl(card, isWildDeuce(card, rules))} alt={card} className={className} draggable={false} />;
}

export function RenegeSheet({ tricks, open, face, rules, onCall, onClose }: {
  tricks: readonly Trick[];
  /** the finished books this seat may still call, each with the seats it may name */
  open: readonly { trick: number; targets: number[] }[];
  face: (seat: number) => string;
  rules: TableRules;
  onCall: (target: number, trick: number) => void;
  onClose: () => void;
}) {
  const [pick, setPick] = useState<{ target: number; trick: number } | null>(null);
  const books = open.filter((b) => b.targets.length && tricks[b.trick]).slice().reverse();
  return (
    <div className="toss-overlay renege-overlay" data-testid="renege-sheet" role="dialog" aria-label="Call a renege">
      <div className="toss-sheet renege-sheet glass">
        <button type="button" className="toss-x" aria-label="Close" onClick={onClose}>×</button>
        <div className="toss-head renege-head">Call a renege</div>
        {pick ? (
          <>
            <div className="toss-sub" data-testid="renege-confirm">
              {face(pick.target)}, book {pick.trick + 1}. Right, you take {RENEGE_PENALTY_BOOKS} books. Wrong, you give up {RENEGE_PENALTY_BOOKS}.
            </div>
            <div className="renege-book solo">
              {tricks[pick.trick]!.plays.map((p) => (
                <div key={p.seat} className={`renege-play${p.seat === pick.target ? ' picked' : ''}`}>
                  <CardImg card={p.card} rules={rules} className="renege-card" />
                  <span className="renege-name">{face(p.seat)}</span>
                </div>
              ))}
            </div>
            <div className="toss-actions">
              <button type="button" className="toss-yes renege-yes" data-testid="renege-yes" onClick={() => onCall(pick.target, pick.trick)}>Call it</button>
              <button type="button" className="toss-no" data-testid="renege-back" onClick={() => setPick(null)}>Back</button>
            </div>
          </>
        ) : (
          <>
            <div className="toss-sub">Tap the card that broke suit.</div>
            <div className="renege-books">
              {books.map((b) => {
                const t = tricks[b.trick]!;
                return (
                  <div key={b.trick} className="renege-row" data-testid={`renege-book-${b.trick}`}>
                    <span className="renege-no">Book {b.trick + 1}</span>
                    <div className="renege-book">
                      {t.plays.map((p, i) => {
                        const can = b.targets.includes(p.seat);
                        const inner = (
                          <>
                            <CardImg card={p.card} rules={rules} className="renege-card" />
                            <span className="renege-name">{i === 0 ? `${face(p.seat)} led` : face(p.seat)}</span>
                          </>
                        );
                        return can ? (
                          <button key={p.seat} type="button" className="renege-play can" data-testid={`renege-pick-${b.trick}-${p.seat}`} onClick={() => setPick({ target: p.seat, trick: b.trick })}>{inner}</button>
                        ) : (
                          <div key={p.seat} className="renege-play">{inner}</div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** How long a ruling stays up before it clears itself (a tap clears it sooner). */
export const RENEGE_VERDICT_MS = 6500;

export function RenegeVerdict({ call, face, sideLabel, rules, onDone }: {
  call: RenegeCall;
  face: (seat: number) => string;
  sideLabel: (side: number) => string;
  rules: TableRules;
  onDone: () => void;
}) {
  useEffect(() => {
    const t = window.setTimeout(onDone, RENEGE_VERDICT_MS);
    return () => window.clearTimeout(t);
  }, [call, onDone]);
  const who = face(call.target);
  const caller = face(call.by);
  return (
    <div className="misdeal-reveal renege-verdict" data-testid="renege-verdict" data-correct={call.correct ? 'yes' : 'no'} role="status">
      <div className="misdeal-panel glass" onClick={onDone} title="Tap to dismiss">
        <div className={`misdeal-head renege-verdict-head${call.correct ? ' hit' : ' miss'}`}>{call.correct ? 'Renege!' : 'No renege'}</div>
        <div className="misdeal-sub">
          {call.correct
            ? `${caller} caught ${who === 'You' ? 'you' : who} in book ${call.trick + 1}`
            : `${caller} called ${who === 'You' ? 'you' : who} on book ${call.trick + 1} — ${who === 'You' ? 'you were' : `${who} was`} clean`}
        </div>
        {call.proof && (
          <div className="renege-proof">
            <div className="renege-play"><CardImg card={call.proof.led} rules={rules} className="renege-card" /><span className="renege-name">Led</span></div>
            <div className="renege-play picked"><CardImg card={call.proof.played} rules={rules} className="renege-card" /><span className="renege-name">Played</span></div>
            <div className="renege-play"><CardImg card={call.proof.held} rules={rules} className="renege-card" /><span className="renege-name">Was holding</span></div>
          </div>
        )}
        <div className="renege-penalty" data-testid="renege-penalty">{call.books} books to {sideLabel(call.to)}</div>
      </div>
    </div>
  );
}
