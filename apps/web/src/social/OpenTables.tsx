/**
 * Release 10: "Open tables" under the game cards on the online "Pick a game" step. Live from the Social hub (every
 * public table reports itself on each change): host, mode, venue, target, seats, status, spectators, Join / Watch.
 */
import { useEffect, useState } from 'react';
import type { OpenTable } from '@spades/protocol';
import { social, useSocial } from './store';
import { navigate } from '../online/nav';
import { type VenueChoice, venueLabel } from '../venues';

type Filter = 'all' | 'joker' | 'cutthroat4' | 'cutthroat3' | 'aceDown';
const FILTERS: [Filter, string][] = [['all', 'All'], ['joker', 'Joker'], ['cutthroat4', 'Cutthroat'], ['cutthroat3', 'Cutthroat 3'], ['aceDown', 'Ace Down']];
export const tableKind = (t: Pick<OpenTable, 'mode' | 'playerCount'>): Filter => (t.mode === 'cutthroat' ? (t.playerCount === 3 ? 'cutthroat3' : 'cutthroat4') : (t.mode as Filter));
const MODE_NAME: Record<string, string> = { joker: 'Joker Spades', cutthroat4: 'Cutthroat', cutthroat3: 'Cutthroat 3', aceDown: 'Ace Down' };

function venueName(id: string): string {
  try { return venueLabel(id as VenueChoice) || id; } catch { return id; }
}

export function OpenTables({ selected, onCreate }: { selected: string; onCreate: () => void }) {
  const s = useSocial();
  useEffect(() => { social.start(); }, []);
  const [filter, setFilter] = useState<Filter>(() => (FILTERS.some(([k]) => k === selected) ? (selected as Filter) : 'all'));
  const all = Object.values(s.tables);
  const list = all.filter((t) => filter === 'all' || tableKind(t) === filter)
    .sort((a, b) => (a.status === 'waiting' ? 0 : 1) - (b.status === 'waiting' ? 0 : 1) || b.open - a.open || b.at - a.at);
  return (
    <section className="open-tables" data-testid="open-tables" aria-label="Open tables">
      <div className="ot-head">
        <h3>Open tables <span className="ot-live" aria-hidden />{all.length > 0 && <small>{all.length}</small>}</h3>
        <div className="ot-filters" role="tablist" aria-label="Filter by game">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} data-testid={`ot-filter-${k}`} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
      </div>
      {s.status !== 'open' && !all.length ? (
        <p className="ot-empty muted">Looking for tables…</p>
      ) : !list.length ? (
        <div className="ot-empty" data-testid="ot-empty">
          <p>No open {filter === 'all' ? '' : `${MODE_NAME[filter]} `}tables right now.</p>
          <button type="button" className="primary" data-testid="ot-create" onClick={onCreate}>Create a table</button>
        </div>
      ) : (
        <ul className="ot-list">
          {list.map((t) => <TableRow key={t.code} t={t} />)}
        </ul>
      )}
    </section>
  );
}

function TableRow({ t }: { t: OpenTable }) {
  const seated = t.humans + t.bots;
  const status = t.status === 'waiting' ? 'Waiting' : t.status === 'playing' ? `In progress · hand ${t.hand ?? 1}` : 'Between games';
  const canJoin = t.open > 0 && !t.tournament;
  return (
    <li className={`ot-row ${t.status}`} data-testid={`ot-row-${t.code}`}>
      <div className="ot-main">
        <div className="ot-title"><b>{MODE_NAME[tableKind(t)] ?? t.mode}</b><span className={`ot-status ${t.status}`}>{status}</span></div>
        <div className="ot-meta">
          <span>Host <b>{t.host || '—'}</b></span>
          <span>to {t.target}</span>
          <span>{venueName(t.venue)}</span>
          {t.tournament && <span className="ot-tour">🏆 {t.tournament}</span>}
        </div>
        <div className="ot-meta">
          <span data-testid={`ot-seats-${t.code}`}>{t.humans}/{t.playerCount} players{t.bots ? ` · ${t.bots} bot${t.bots > 1 ? 's' : ''}` : ''}{seated < t.playerCount || t.open ? ` · ${t.open} open` : ''}</span>
          <span>👁 {t.spectators}</span>
        </div>
      </div>
      <div className="ot-acts">
        {canJoin && <button type="button" className="primary" data-testid={`ot-join-${t.code}`} onClick={() => navigate(`/t/${t.code}${t.seat !== undefined ? `?seat=${t.seat}` : ''}`)}>Join</button>}
        <button type="button" data-testid={`ot-watch-${t.code}`} disabled={t.watchFull} onClick={() => navigate(`/t/${t.code}?watch=1`)}>{t.watchFull ? 'Full' : 'Watch'}</button>
      </div>
    </li>
  );
}
