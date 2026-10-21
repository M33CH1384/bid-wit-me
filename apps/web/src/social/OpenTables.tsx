/**
 * Release 10: "Open tables" in the online lobby (wizard 'table' step). Live from the Social hub (every
 * public table reports itself on each change): host, mode, venue, target, seats, status, spectators, Join / Watch.
 * Filters + mode names derive from the modes the wizard actually offers (offeredModes.ts) — the engine's
 * legacy 3-player cutthroat has no chip here (owner, 2026-10-20 lobby restructure).
 */
import { useEffect, useState } from 'react';
import type { OpenTable } from '@spades/protocol';
import { social, useSocial } from './store';
import { navigate } from '../online/nav';
import { type VenueChoice, venueLabel } from '../venues';
import { OFFERED_MODES, OFFERED_MODE_NAME, type OfferedMode, offeredKindOf, openTableModeName } from '../offeredModes';

type Filter = 'all' | OfferedMode;
const FILTERS: [Filter, string][] = [['all', 'All'], ...OFFERED_MODES.map((o) => [o.key, o.label] as [Filter, string])];
/** Back-compat for older imports: the offered kind of a table, or 'cutthroat3' for a legacy 3-player table. */
export const tableKind = (t: Pick<OpenTable, 'mode' | 'playerCount'>): Filter | 'cutthroat3' => offeredKindOf(t) ?? 'cutthroat3';
export const MODE_NAME: Record<string, string> = { ...OFFERED_MODE_NAME };

function venueName(id: string): string {
  try { return venueLabel(id as VenueChoice) || id; } catch { return id; }
}

export function OpenTables({ selected }: { selected: string }) {
  const s = useSocial();
  useEffect(() => { social.start(); }, []);
  const [filter, setFilter] = useState<Filter>(() => (FILTERS.some(([k]) => k === selected) ? (selected as Filter) : 'all'));
  const all = Object.values(s.tables);
  const list = all.filter((t) => filter === 'all' || offeredKindOf(t) === filter)
    .sort((a, b) => (a.status === 'waiting' ? 0 : 1) - (b.status === 'waiting' ? 0 : 1) || b.open - a.open || b.at - a.at);
  return (
    <section className="open-tables" data-testid="open-tables" aria-label="Open tables">
      <div className="ot-head">
        <h3>Open tables <span className="ot-live" aria-hidden />{all.length > 0 && <small>{all.length}</small>}</h3>
        <div className="ot-filters-wrap"><div className="ot-filters" role="tablist" aria-label="Filter by game">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} data-testid={`ot-filter-${k}`} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div></div>
      </div>
      {s.status !== 'open' && !all.length ? (
        <p className="ot-empty muted">Looking for tables…</p>
      ) : !list.length ? (
        <div className="ot-empty" data-testid="ot-empty">
          <p>No open {filter === 'all' ? '' : `${OFFERED_MODE_NAME[filter]} `}tables right now.</p>
          <p className="ot-hint">Tap “Create a table” above to start one.</p>
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
        <div className="ot-title"><b>{openTableModeName(t)}</b><span className={`ot-status ${t.status}`}>{status}</span></div>
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
