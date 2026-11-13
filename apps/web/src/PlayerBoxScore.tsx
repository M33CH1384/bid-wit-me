/**
 * The player box score sheet (playerBox.ts): every player's game on one screen, the teams side by
 * side on a wide screen and stacked on a narrow one, the winner first. Opened from the results.
 */
import { useEscapeClose } from './useEscapeClose';
import { diffText, ofText, type BoxLine, type BoxTeam } from './playerBox';
import './playerBox.css';

const COLS: { key: string; label: string; title: string }[] = [
  { key: 'bid', label: 'BID', title: 'Total bid' },
  { key: 'books', label: 'BKS', title: 'Books taken' },
  { key: 'diff', label: '+/−', title: 'Books over or under their own bids' },
  { key: 'made', label: 'MADE', title: 'Hands they covered their own bid' },
  { key: 'nil', label: 'NIL', title: 'Nils made of nils tried' },
  { key: 'run', label: 'RUN', title: 'Longest run of books in a row' },
];

function cells(l: Omit<BoxLine, 'seat'>): string[] {
  return [String(l.bid), String(l.books), diffText(l.diff), ofText(l.hitBid, l.bidHands), ofText(l.nilsMade, l.nilsTried), l.bestRun > 0 ? String(l.bestRun) : '—'];
}

export function PlayerBoxScore({ teams, winners, mvpSeat, playerName, teamName, teamColor, onClose }: {
  teams: BoxTeam[];
  winners: readonly number[];
  mvpSeat: number | null;
  playerName: (seat: number) => string;
  teamName: (side: number) => string;
  teamColor: (side: number) => string;
  onClose: () => void;
}) {
  const esc = useEscapeClose(onClose);
  const ordered = [...teams].sort((a, b) => Number(winners.includes(b.side)) - Number(winners.includes(a.side)) || b.score - a.score || a.side - b.side);
  return (
    <div className="modal-backdrop pbox-backdrop" ref={esc} onClick={onClose}>
      <div className="modal glass slant pbox" onClick={(e) => e.stopPropagation()} data-testid="player-box" role="dialog" aria-label="Box score">
        <header className="pbox-head">
          <div className="panel-title big">BOX SCORE</div>
          <button type="button" className="sheet-close" aria-label="Close box score" data-testid="player-box-close" onClick={onClose}>✕</button>
        </header>
        <div className="pbox-final" data-testid="player-box-final">
          {ordered.map((t) => (
            <span key={t.side} className={winners.includes(t.side) ? 'won' : ''} style={{ borderColor: teamColor(t.side) }}>
              <b>{teamName(t.side)}</b><i>{t.score}</i>
            </span>
          ))}
          <em>Final</em>
        </div>
        <div className="pbox-teams" style={{ ['--teams' as string]: Math.min(2, ordered.length) }}>
          {ordered.map((t) => (
            <section key={t.side} className="pbox-team" data-testid={`player-box-team-${t.side}`} style={{ ['--team' as string]: teamColor(t.side) }}>
              <h3><span>{teamName(t.side)}</span>{winners.includes(t.side) && <small>WIN</small>}</h3>
              <table>
                <thead>
                  <tr><th scope="col" className="who">Player</th>{COLS.map((c) => <th key={c.key} scope="col" title={c.title}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {t.players.map((p) => (
                    <tr key={p.seat} data-testid={`player-box-row-${p.seat}`}>
                      <th scope="row" className="who">{playerName(p.seat)}{mvpSeat === p.seat && <small className="pbox-mvp">MVP</small>}{p.nukes > 0 && <small className="pbox-nuke" title="Nukes">☢{p.nukes > 1 ? p.nukes : ''}</small>}</th>
                      {cells(p).map((v, i) => <td key={i}>{v}</td>)}
                    </tr>
                  ))}
                  {t.players.length > 1 && (
                    <tr className="total">
                      <th scope="row" className="who">TEAM</th>
                      {cells(t.total).map((v, i) => <td key={i}>{v}</td>)}
                    </tr>
                  )}
                </tbody>
              </table>
              <p className="pbox-foot">Set {t.sets} · Bags {t.bags}</p>
            </section>
          ))}
        </div>
        <p className="pbox-key">BKS books · +/− books over or under own bids · MADE hands the bid was covered (TEAM: contracts made) · RUN longest run</p>
      </div>
    </div>
  );
}
