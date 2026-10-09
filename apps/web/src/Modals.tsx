import { type GameState, type HandRecord, type TableRules, bidLabel } from '@spades/rules';
import { HUMAN } from './useGame';

export function sideName(rules: TableRules, side: number, names: string[]): string {
  if (!rules.partnerships) return names[side]!;
  return side === 0 ? `${names[0]} & ${names[2]}` : `${names[1]} & ${names[3]}`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function HandSummary({ rec, rules, names }: { rec: HandRecord; rules: TableRules; names: string[] }) {
  return (
    <table className="summary-table">
      <thead>
        <tr><th /><th>Bid</th><th>Took</th><th>Contract</th><th>Nil</th><th>Bags</th><th>Hand</th><th>Total</th></tr>
      </thead>
      <tbody>
        {rec.sides.map((s) => (
          <tr key={s.side} className={s.seats.includes(HUMAN) ? 'mine' : ''}>
            <td className="who">{sideName(rules, s.side, names)}</td>
            <td>{s.seats.map((x) => bidLabel(rec.bids[x])).join(' + ')}</td>
            <td>{s.seats.map((x) => rec.tricksWon[x]).join(' + ')}</td>
            <td className={s.contractMade === false ? 'neg' : ''}>{s.contract ? signed(s.contractPoints) : '—'}</td>
            <td>{s.nils.length ? s.nils.map((n) => <span key={n.seat} className={n.made ? 'pos' : 'neg'}>{signed(n.points)} </span>) : '—'}</td>
            <td>{s.bagsAdded ? `+${s.bagsAdded}` : 0}{s.bagPenaltyCount ? <span className="neg"> ({s.bagPenaltyPoints})</span> : null}</td>
            <td className={s.points < 0 ? 'neg' : 'pos'}>{signed(s.points)}</td>
            <td><b>{s.totalScore}</b> <small>({s.totalBags} bags)</small></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ScorePad({ st, names, onClose }: { st: GameState; names: string[]; onClose: () => void }) {
  const r = st.rules;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Score pad</h2>
        {st.history.length === 0 ? <p className="muted">No hands scored yet.</p> : (
          <div className="scroll">
            <table className="pad">
              <thead>
                <tr><th>#</th>{Array.from({ length: st.scores.length }, (_, i) => <th key={i}>{sideName(r, i, names)}</th>)}</tr>
              </thead>
              <tbody>
                {st.history.map((h) => (
                  <tr key={h.handNo}>
                    <td>{h.handNo}</td>
                    {h.sides.map((s) => (
                      <td key={s.side}>
                        <span className="pad-bid">{s.seats.map((x) => bidLabel(h.bids[x])).join('+')} / {s.tricks}</span>
                        <span className={s.points < 0 ? 'neg' : 'pos'}>{signed(s.points)}</span>
                        <b>{s.totalScore}</b>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">Target {r.targetScore}{r.losingFloor !== null ? `, losing floor ${r.losingFloor}` : ''}. Every {r.bagsPerPenalty} bags costs {r.bagPenalty}.</p>
        <button type="button" className="primary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
