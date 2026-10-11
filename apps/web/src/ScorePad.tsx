/**
 * Score pad: one block per hand ("Hand 3 · Hana deals"), one row per team/player with labeled columns:
 * Bid (5 + 3 = 8 / Books (hand 1)), Took, Result (Made / SET / Nil made / Nil busted / SHOT…), Points (tap for the
 * breakdown), Bags (running), Total. Wide screens: a column grid with one header row. Phones: a stacked card per hand,
 * labels inside every cell, team names in the team colour. The last scored hand is highlighted; the hand being
 * played shows as "in progress" with the bids so far.
 */
import { type ReactNode, useEffect, useRef } from 'react';
import { type GameState, type HandRecord, type SideHandResult, type TableRules, bidLabel, firstHandMinOf, shotOutOn } from '@spades/rules';
import { SEAT_COLORS } from './overlay';

export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

export function sideColor(r: TableRules, side: number): string {
  if (!r.partnerships) return SEAT_COLORS[side] ?? '#ddd';
  return side === 0 ? SEAT_COLORS[0]! : '#ff6ad5';
}

export function rulesLine(r: TableRules): string {
  const parts = [`Playing to ${r.targetScore}`];
  if (r.losingFloor !== null) parts.push(`Lose at ${r.losingFloor}`);
  parts.push(`${r.bagsPerPenalty} bags = −${Math.abs(r.bagPenalty)}`);
  const min = firstHandMinOf(r);
  if (shotOutOn(r)) parts.push(`Shot = out${min ? ` · hand 1 needs ${min}+ books` : ''}`);
  return parts.join(' · ');
}

export function bidText(h: HandRecord, s: SideHandResult): string {
  const bids = s.seats.map((x) => h.bids[x]!);
  if (bids.every((b) => b === 'books')) return 'Books (hand 1)';
  const labels = bids.map((b) => bidLabel(b));
  if (bids.length === 1) return labels[0]!;
  const nums = bids.filter((b): b is number => typeof b === 'number');
  return nums.length ? `${labels.join(' + ')} = ${s.contract}` : labels.join(' + ');
}

export interface Chip { text: string; kind: 'made' | 'set' | 'nil-ok' | 'nil-bust' | 'shot' | 'books' | 'out' }
export function resultChips(r: TableRules, h: HandRecord, s: SideHandResult, st: Pick<GameState, 'result' | 'history'>): Chip[] {
  const out: Chip[] = [];
  const books = s.seats.every((x) => h.bids[x] === 'books');
  if (books) out.push({ text: `${s.tricks} books`, kind: 'books' });
  else if (s.contractMade === true) out.push({ text: 'Made', kind: 'made' });
  else if (s.contractMade === false) out.push({ text: 'SET', kind: 'set' });
  for (const n of s.nils) out.push({ text: `${n.kind === 'blindNil' ? 'Blind Nil' : 'Nil'} ${n.made ? 'made' : 'busted'}`, kind: n.made ? 'nil-ok' : 'nil-bust' });
  if (s.shot) {
    const lastHand = st.history[st.history.length - 1]?.handNo === h.handNo;
    const isOut = lastHand && st.result?.endReason === 'shotOut' && (st.result.shotOut ?? []).includes(s.side);
    out.push(isOut ? { text: 'SHOT OUT', kind: 'out' } : { text: `SHOT${lastHand && !st.result ? ' · ON NOTICE' : ''}`, kind: 'shot' });
  }
  void r;
  return out;
}

function breakdown(r: TableRules, s: SideHandResult): string[] {
  const lines: string[] = [];
  if (s.bookPoints) lines.push(`${s.bookPoints} for ${s.tricks} books (10 each)`);
  if (s.contractPoints) lines.push(s.contractPoints > 0 ? `+${s.contractPoints} for the bid of ${s.contract}` : `${s.contractPoints} set (bid ${s.contract})`);
  if (s.bagsAdded) lines.push(`+${s.bagsAdded} bag${s.bagsAdded === 1 ? '' : 's'}`);
  for (const n of s.nils) lines.push(`${signed(n.points)} ${n.kind === 'blindNil' ? 'Blind Nil' : 'Nil'} ${n.made ? 'made' : 'busted'}`);
  if (s.bagPenaltyPoints) lines.push(`${s.bagPenaltyPoints} bag penalty (${r.bagsPerPenalty} bags)`);
  if (!lines.length) lines.push('0');
  return lines;
}

export function ScorePad({ st, names, onClose, locked, sideName }: { st: GameState; names: string[]; onClose: () => void; locked?: ReactNode; sideName: (side: number) => string }) {
  const r = st.rules;
  const sides = Array.from({ length: st.scores.length }, (_, i) => i);
  const lastNo = st.history[st.history.length - 1]?.handNo;
  const inProgress = st.phase !== 'gameOver' && st.phase !== 'handOver' && !st.history.some((h) => h.handNo === st.handNo);
  const seatName = (s: number) => names[s] ?? `Seat ${s + 1}`;
  // open on the latest hand (the last scored one, or the one being played)
  const lastRef = useRef<HTMLElement>(null);
  useEffect(() => { lastRef.current?.scrollIntoView({ block: 'end' }); }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal glass slant score-pad" onClick={(e) => e.stopPropagation()} data-testid="score-pad">
        <div className="panel-title big">SCORE PAD</div>
        <p className="pad-rules" data-testid="pad-rules">{rulesLine(r)}</p>
        <div className="scroll pad2">
          <div className="pad-cols" aria-hidden>
            <span>{r.partnerships ? 'Team' : 'Player'}</span><span>Bid</span><span>Took</span><span>Result</span><span>Points</span><span>Bags</span><span>Total</span>
          </div>
          {st.history.length === 0 && !inProgress && <p className="muted">No hands scored yet.</p>}
          {st.history.map((h) => (
            <section key={h.handNo} ref={h.handNo === lastNo && !inProgress ? lastRef : undefined} className={`pad-hand ${h.handNo === lastNo ? 'last' : ''}`} data-testid={`pad-hand-${h.handNo}`}>
              <header className="pad-hand-head"><b>Hand {h.handNo}</b><span>{seatName(h.dealer)} dealt</span>{h.handNo === 1 && firstHandMinOf(r) && shotOutOn(r) ? <span className="pad-min">needs {firstHandMinOf(r)}+ books</span> : null}{h.handNo === lastNo && <span className="pad-last">{st.phase === 'gameOver' ? 'FINAL' : 'LAST HAND'}</span>}</header>
              {h.sides.map((s) => (
                <div key={s.side} className="pad-row" style={{ ['--side' as string]: sideColor(r, s.side) }}>
                  <div className="pad-team">{sideName(s.side)}</div>
                  <div className="pad-cell"><span className="lbl">Bid</span><b>{bidText(h, s)}</b></div>
                  <div className="pad-cell"><span className="lbl">Took</span><b>{s.tricks}</b></div>
                  <div className="pad-cell pad-result"><span className="lbl">Result</span><span className="chips">{resultChips(r, h, s, st).map((c) => <em key={c.text} className={`rchip ${c.kind}`}>{c.text}</em>)}</span></div>
                  <div className="pad-cell"><span className="lbl">Points</span>
                    <details className="pts"><summary className={s.points < 0 ? 'neg' : 'pos'} title="Tap for the breakdown">{signed(s.points)}</summary>
                      <ul>{breakdown(r, s).map((l) => <li key={l}>{l}</li>)}</ul>
                    </details>
                  </div>
                  <div className="pad-cell"><span className="lbl">Bags</span><b>{s.totalBags}{s.bagsAdded ? <small> (+{s.bagsAdded})</small> : null}</b></div>
                  <div className="pad-cell pad-total"><span className="lbl">Total</span><b>{s.totalScore}</b></div>
                </div>
              ))}
            </section>
          ))}
          {inProgress && (
            <section ref={lastRef} className="pad-hand current" data-testid="pad-hand-current">
              <header className="pad-hand-head"><b>Hand {st.handNo}</b><span>{seatName(st.dealer)} deals</span><span className="pad-last">IN PROGRESS</span></header>
              {sides.map((side) => {
                const seats = r.partnerships ? [side, side + 2] : [side];
                const bids = seats.map((x) => st.bids[x]);
                return (
                  <div key={side} className="pad-row" style={{ ['--side' as string]: sideColor(r, side) }}>
                    <div className="pad-team">{sideName(side)}</div>
                    <div className="pad-cell"><span className="lbl">Bid</span><b>{bids.every((b) => b === 'books') ? 'Books (hand 1)' : bids.map((b) => (b === null ? '…' : bidLabel(b))).join(' + ')}</b></div>
                    <div className="pad-cell"><span className="lbl">Took</span><b>{seats.reduce((a, x) => a + (st.tricksWon[x] ?? 0), 0)}</b></div>
                    <div className="pad-cell pad-result"><span className="lbl">Result</span><span className="muted">playing…</span></div>
                    <div className="pad-cell"><span className="lbl">Points</span><b>–</b></div>
                    <div className="pad-cell"><span className="lbl">Bags</span><b>{st.bags[side]}</b></div>
                    <div className="pad-cell pad-total"><span className="lbl">Total</span><b>{st.scores[side]}</b></div>
                  </div>
                );
              })}
            </section>
          )}
        </div>
        {locked && st.phase !== 'gameOver' && <details className="locked-details" data-testid="locked-rules-details"><summary>🔒 House rules for this game</summary>{locked}</details>}
        <button type="button" className="primary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
