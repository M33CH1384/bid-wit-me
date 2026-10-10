/**
 * Rematch series UI: a compact "SERIES 3–1" chip (scorebug, Victory, Table Talk) that opens a sheet listing every game
 * (final scores, winner, hands, highlights) with an expandable hand-by-hand score table.
 * Offline the series lives in localStorage (kept with the game; reset when a new game starts from the menu).
 */
import { useState } from 'react';
import { type Series, seriesTally } from '@spades/rules';

const KEY = 'bwm.series.v1';
export function loadSeries(): Series | null {
  try { const j = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return j && j.v === 1 ? (j as Series) : null; } catch { return null; }
}
export function saveSeries(s: Series | null): void {
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function SeriesChip({ series, onOpen, className = '' }: { series: Series | null | undefined; onOpen: () => void; className?: string }) {
  if (!series || (!series.games.length && !series.note)) return null;
  return (
    <button type="button" className={`series-chip ${className}`} data-testid="series-chip" onClick={onOpen} title={series.note ?? 'Rematch series: tap for every game'}>
      <small>SERIES</small> <b>{seriesTally(series)}</b>
    </button>
  );
}

const hl = (n: number, label: string) => (n ? `${n > 1 ? `${n}× ` : ''}${label}` : null);

export function SeriesSheet({ series, mine, onClose }: { series: Series; mine: number; onClose: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const names = series.sides.map((s) => s.name);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal glass slant sheet series-sheet" role="dialog" aria-label="Rematch series" data-testid="series-sheet" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>✕</button>
        <h2>SERIES <span className="series-big">{seriesTally(series)}</span></h2>
        <div className="series-sides">
          {series.sides.map((s, i) => (
            <span key={s.key} className={`series-side ${i === mine ? 'mine' : ''}`}><b>{series.wins[i] ?? 0}</b> {s.name}</span>
          ))}
        </div>
        {series.note && <p className="series-note" data-testid="series-note">{series.note}</p>}
        {!series.games.length && <p className="muted">No games finished yet in this series.</p>}
        <ol className="series-games">
          {[...series.games].reverse().map((g) => {
            const marks = g.final.map((_, i) => [hl(g.sets[i] ?? 0, 'set'), hl(g.wheels[i] ?? 0, 'wheels'), hl(g.nukes[i] ?? 0, 'nuke'), hl(g.nilsMade[i] ?? 0, 'nil'), hl(g.nilsBusted[i] ?? 0, 'nil busted')].filter(Boolean).join(' · '));
            return (
              <li key={g.no} className="series-game" data-testid={`series-game-${g.no}`}>
                <button type="button" className="sg-head" aria-expanded={open === g.no} onClick={() => setOpen(open === g.no ? null : g.no)}>
                  <span className="sg-no">#{g.no}</span>
                  <span className="sg-scores">
                    {g.final.map((sc, i) => (
                      <span key={i} className={`${g.winners.includes(i) ? 'won' : ''} ${i === mine ? 'mine' : ''}`}>{g.names[i] ?? names[i]} <b>{sc}</b>{g.winners.includes(i) && ' 🏆'}</span>
                    ))}
                  </span>
                  <span className="sg-meta">{g.hands} hands {open === g.no ? '▾' : '▸'}</span>
                </button>
                {marks.some(Boolean) && (
                  <div className="sg-hl">{marks.map((m, i) => (m ? <span key={i}><em>{g.names[i] ?? names[i]}:</em> {m}</span> : null))}</div>
                )}
                {open === g.no && (
                  <table className="sg-hands" data-testid={`series-hands-${g.no}`}>
                    <thead><tr><th>Hand</th>{g.names.map((nm, i) => <th key={i}>{nm}</th>)}</tr></thead>
                    <tbody>{g.totals.map((row, h) => <tr key={h}><td>{h + 1}</td>{row.map((v, i) => <td key={i}>{v}</td>)}</tr>)}</tbody>
                  </table>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
