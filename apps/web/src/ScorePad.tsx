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

/** compact rule chips from the real table settings: "To 250", "10 bags = −100", "Hand 1: 4+ books"… */
export function rulesChips(r: TableRules): string[] {
  const out = [`To ${r.targetScore}`];
  if (r.losingFloor !== null) out.push(`Lose at ${r.losingFloor}`);
  if (r.bagPenalty) out.push(`${r.bagsPerPenalty} bags = −${Math.abs(r.bagPenalty)}`);
  const min = firstHandMinOf(r);
  if (shotOutOn(r)) { out.push('Shot = out'); if (min) out.push(`Hand 1: ${min}+ books`); }
  return out;
}

export function bidText(h: HandRecord, s: SideHandResult): string {
  const bids = s.seats.map((x) => h.bids[x]!);
  if (bids.every((b) => b === 'books')) return '—';
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

function Row({ color, name, bid, took, points, chips, total, bags, bagsAdded, details }: { color: string; name: string; bid: string; took: number; points: ReactNode; chips?: Chip[]; total: number; bags: number; bagsAdded?: number; details?: string[] }) {
  return (
    <div className="pad-row v2" style={{ ['--side' as string]: color }}>
      <i className="pad-bar" aria-hidden />
      <div className="pad-team">{name}{chips && chips.length > 0 && <span className="chips">{chips.map((c) => <em key={c.text} className={`rchip ${c.kind}`}>{c.text}</em>)}</span>}</div>
      <div className="pad-cell"><span className="lbl">Bid</span><b>{bid}</b></div>
      <div className="pad-cell"><span className="lbl">Took</span><b>{took}</b></div>
      <div className="pad-cell"><span className="lbl">Points</span>
        {details ? <details className="pts"><summary className={typeof points === 'string' && points.startsWith('−') ? 'neg' : 'pos'} title="Tap for the breakdown">{points}</summary><ul>{details.map((l) => <li key={l}>{l}</li>)}</ul></details> : <b>{points}</b>}
      </div>
      <div className="pad-cell pad-total"><span className="lbl">Total</span><b>{total}</b><small className="pad-bags">{bags} bag{bags === 1 ? '' : 's'}{bagsAdded ? ` (+${bagsAdded})` : ''}</small></div>
    </div>
  );
}

export function ScorePad({ st, names, onClose, onContinue, locked, sideName }: { st: GameState; names: string[]; onClose: () => void; onContinue?: () => void; locked?: ReactNode; sideName: (side: number) => string }) {
  const r = st.rules;
  const sides = Array.from({ length: st.scores.length }, (_, i) => i);
  const lastNo = st.history[st.history.length - 1]?.handNo;
  const inProgress = st.phase !== 'gameOver' && st.phase !== 'handOver' && !st.history.some((h) => h.handNo === st.handNo);
  const seatName = (s: number) => names[s] ?? `Seat ${s + 1}`;
  const lastRef = useRef<HTMLElement>(null);
  useEffect(() => { lastRef.current?.scrollIntoView({ block: 'end' }); }, []);
  const showLocked = locked && st.phase !== 'gameOver';
  return (
    <div className="modal-backdrop pad-backdrop" onClick={onClose}>
      <div className="modal glass slant score-pad v2" onClick={(e) => e.stopPropagation()} data-testid="score-pad" role="dialog" aria-label="Score pad">
        <div className="scroll pad2">
          <header className="pad-sticky">
            <button type="button" className="pad-x" aria-label="Close score pad" data-testid="pad-close" onClick={onClose}>✕</button>
            <div className="panel-title big">SCORE PAD</div>
            <p className="pad-playing" data-testid="pad-target">Playing to {r.targetScore}</p>
            <div className="pad-board" style={{ ['--sides' as string]: sides.length }} data-testid="pad-board">
              {sides.map((side) => (
                <div key={side} className="pad-board-side" style={{ ['--side' as string]: sideColor(r, side) }} data-testid="pad-board-side">
                  <i className="pad-bar" aria-hidden />
                  <span className="pad-board-name">{sideName(side)}</span>
                  <b className="pad-board-total">{st.scores[side]}</b>
                  <small className="pad-board-bags">{st.bags[side]} bag{st.bags[side] === 1 ? '' : 's'}</small>
                </div>
              ))}
            </div>
          </header>
          <div className="pad-cols v2" aria-hidden>
            <span>{r.partnerships ? 'Team' : 'Player'}</span><span>Bid</span><span>Took</span><span>Points</span><span>Total</span>
          </div>
          {st.history.length === 0 && !inProgress && <p className="muted">No hands scored yet.</p>}
          {st.history.map((h) => (
            <section key={h.handNo} ref={h.handNo === lastNo && !inProgress ? lastRef : undefined} className={`pad-hand ${h.handNo === lastNo ? 'last' : ''}`} data-testid={`pad-hand-${h.handNo}`}>
              <header className="pad-hand-head"><b>Hand {h.handNo}</b><span>{seatName(h.dealer)} dealt</span>{h.handNo === lastNo && <span className="pad-last">{st.phase === 'gameOver' ? 'FINAL' : 'LAST HAND'}</span>}</header>
              {h.sides.map((s) => (
                <Row key={s.side} color={sideColor(r, s.side)} name={sideName(s.side)} bid={bidText(h, s)} took={s.tricks}
                  points={signed(s.points)} details={breakdown(r, s)} chips={resultChips(r, h, s, st).filter((c) => c.kind !== 'books' && c.kind !== 'made')}
                  total={s.totalScore} bags={s.totalBags} bagsAdded={s.bagsAdded} />
              ))}
            </section>
          ))}
          {inProgress && (
            <section ref={lastRef} className="pad-hand current" data-testid="pad-hand-current">
              <header className="pad-hand-head"><b>Hand {st.handNo}</b><span>{seatName(st.dealer)} deals</span><span className="pad-last">IN PROGRESS</span></header>
              {sides.map((side) => {
                const seats = r.partnerships ? [side, side + 2] : [side];
                const bids = seats.map((x) => st.bids[x]);
                return <Row key={side} color={sideColor(r, side)} name={sideName(side)}
                  bid={bids.every((b) => b === 'books') ? '—' : bids.map((b) => (b === null ? '…' : bidLabel(b))).join(' + ')}
                  took={seats.reduce((a, x) => a + (st.tricksWon[x] ?? 0), 0)} points="–" total={st.scores[side]!} bags={st.bags[side]!} />;
              })}
            </section>
          )}
        </div>
        <details className="locked-details" data-testid="locked-rules-details">
          <summary>🔒 House rules for this game</summary>
          <div className="pad-rules chips" data-testid="pad-rules">{rulesChips(r).map((c) => <span key={c} className="rule-chip">{c}</span>)}</div>
          {showLocked ? locked : null}
        </details>
        <button type="button" className="primary big" data-testid="pad-continue" onClick={onContinue ?? onClose}>Continue</button>
      </div>
    </div>
  );
}
