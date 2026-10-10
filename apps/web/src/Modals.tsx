import { type GameState, type HandRecord, type TableRules, bidLabel } from '@spades/rules';
import { HUMAN } from './useGame';

/** Team names for the mounted table (local side order; null = default partner names). Set by Table each render. */
let TEAM_NAMES: (string | null)[] | null = null;
export function setTeamNames(t: (string | null)[] | null): void { TEAM_NAMES = t; }

export function defaultSideName(rules: TableRules, side: number, names: string[]): string {
  if (!rules.partnerships) return names[side]!;
  return side === 0 ? `${names[0]} & ${names[2]}` : `${names[1]} & ${names[3]}`;
}

export function sideName(rules: TableRules, side: number, names: string[]): string {
  if (!rules.partnerships) return names[side]!;
  return TEAM_NAMES?.[side] || defaultSideName(rules, side, names);
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function ScorePad({ st, names, onClose }: { st: GameState; names: string[]; onClose: () => void }) {
  const r = st.rules;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal glass slant" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title big">SCORE PAD</div>
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
