import { type ReactNode } from 'react';
import { type GameState, bidLabel, isNilBid } from '@spades/rules';
import { resultChips, signed } from './ScorePad';
import { sideName } from './Modals';
import { handWinner, streakLabel, streakOf } from './fx';

/**
 * Hand recap between hands (online and offline).
 * Header (hand number + series chip), one card per side — two teams, or one card per player in Cutthroat —
 * then Score pad and Continue. Chat, the avatar strip, the shuffle animation, and the team-name editor
 * are not part of this screen. Chat opens from the corner button.
 */
export interface Callout { kind: 'shot' | 'gotShot' | 'streak' | 'nil' | 'bust'; text: string; side?: number; level?: number; /** shot pop-up: big headline + detail line */ title?: string; sub?: string }

/** What to shout about for the latest scored hand (also drives the fx pop-ups). */
export function calloutsFor(st: GameState, mySide: number, names: string[]): Callout[] {
  const r = st.rules;
  const rec = st.history[st.history.length - 1];
  if (!rec) return [];
  const out: Callout[] = [];
  for (const s of rec.sides) {
    if (s.contractMade === false) {
      // name who got shot: "BUCS GOT SHOT: bid 8, took 6" (team + its players in 2v2, the player in Cutthroat)
      const who = sideName(r, s.side, names);
      const players = r.partnerships ? s.seats.map((x) => names[x]).join(' & ') : '';
      const detail = `bid ${s.contract}, took ${s.contractTricks}`;
      out.push({
        kind: s.side === mySide ? 'gotShot' : 'shot', side: s.side,
        text: `${who} GOT SHOT: ${detail}${players && players !== who ? ` (${players})` : ''}`,
        title: `${who} GOT SHOT`.toUpperCase(),
        sub: `${detail}${players && players !== who ? ` · ${players}` : ''}`,
      });
    }
    for (const nl of s.nils) out.push({ kind: nl.made ? 'nil' : 'bust', side: s.side, text: `${names[nl.seat]} ${nl.made ? 'made' : 'busted'} ${rec.bids[nl.seat] === 'blindNil' ? 'Blind Nil' : 'Nil'}` });
  }
  const w = handWinner(rec.sides.map((s) => s.points));
  if (w !== null) {
    const n = streakOf(st.history, w);
    const label = streakLabel(n);
    if (label) out.push({ kind: 'streak', side: w, level: n, text: `${label} · ${sideName(r, w, names)} ${n} in a row` });
  }
  return out;
}

export function Intermission({
  st, names, mySide, secs, ready, onReady, online, onScorePad, series, chatOpen, unread, onChat,
}: {
  /** rematch series chip */
  series?: ReactNode;
  st: GameState;
  names: string[];
  mySide: number;
  /** countdown to the next hand (online), or null */
  secs: number | null;
  /** online: ready state ("2/4 ready") */
  ready?: { mine: boolean; count: number; of: number };
  onReady: () => void;
  online: boolean;
  onScorePad: () => void;
  /** corner chat: unread count while the sheet is closed */
  unread: number;
  chatOpen: boolean;
  onChat: () => void;
}) {
  const r = st.rules;
  const rec = st.history[st.history.length - 1]!;
  const callouts = calloutsFor(st, mySide, names);
  const sides = rec.sides;
  const target = r.targetScore;

  return (
    <div className="tt-backdrop" data-testid="table-talk" role="dialog" aria-label="Hand recap">
      <div className="tt glass slant">
        <header className="tt-head">
          <span className="tt-title">HAND {rec.handNo} RECAP</span>
          {series}
          {secs !== null && <span className={`tt-count ${secs <= 5 ? 'hot' : ''}`} data-testid="talk-count">Next deal {secs}s</span>}
        </header>
        <button
          type="button"
          className={`tt-chat-btn ${chatOpen ? 'on' : ''}`}
          data-testid="recap-chat"
          aria-expanded={chatOpen}
          aria-label={chatOpen ? 'Close chat' : 'Open chat'}
          onClick={onChat}
        >
          {chatOpen ? '✕' : '💬'}
          {!chatOpen && unread > 0 && <span className="unread" data-testid="recap-unread">{unread}</span>}
        </button>

        <div className="tt-body">
          {callouts.length > 0 && (
            <div className="tt-callouts">
              {callouts.map((c, i) => <span key={i} className={`tt-callout ${c.kind}`}>{c.kind === 'shot' ? 'SHOT! ' : c.kind === 'gotShot' ? 'GOT SHOT · ' : c.kind === 'streak' ? '🔥 ' : ''}{c.text}</span>)}
            </div>
          )}
          <div className={`tt-recap${sides.length > 2 ? ' crowded' : ''}`} data-testid="talk-recap">
            {sides.map((s) => {
              // same words as the score pad: "Bid 8 · Took 6 · SET · −80", then "You: bid 5, took 4" per player
              const books = s.seats.every((x) => rec.bids[x] === 'books');
              const pct = Math.max(0, Math.min(1, s.totalScore / target));
              const chips = resultChips(r, rec, s, st);
              const main = chips.find((c) => c.kind === 'made' || c.kind === 'set' || c.kind === 'books');
              const bidPart = books ? 'Books (hand 1)' : s.contract ? `Bid ${s.contract}` : `Bid ${s.seats.map((x) => bidLabel(rec.bids[x]!)).join(' + ')}`;
              return (
                <div key={s.side} className={`tt-team ${s.side === mySide ? 'mine' : ''}`} data-testid={`recap-side-${s.side}`}>
                  <div className="tt-team-name">
                    <b>{sideName(r, s.side, names)}</b>
                    <span className="tt-badges chips">
                      {chips.map((c) => <em key={c.text} className={`rchip ${c.kind}`}>{c.text}</em>)}
                      {!books && s.bagsAdded > 0 && <em className="rchip bags">+{s.bagsAdded} bag{s.bagsAdded === 1 ? '' : 's'}</em>}
                      {s.bagPenaltyCount > 0 && <em className="rchip set">Bag penalty {signed(s.bagPenaltyPoints)}</em>}
                    </span>
                  </div>
                  <div className="tt-line" data-testid={`recap-line-${s.side}`}>
                    <span>{bidPart}</span><i>·</i><span>Took {s.tricks}</span>
                    {main && main.kind !== 'books' && <><i>·</i><em className={`rchip ${main.kind}`}>{main.text}</em></>}
                    <i>·</i><b className={s.points < 0 ? 'neg' : 'pos'} data-testid={`recap-points-${s.side}`}>{signed(s.points)}</b>
                  </div>
                  <ul className="tt-players" data-testid={`recap-players-${s.side}`}>
                    {s.seats.map((x) => {
                      const bd = rec.bids[x]!;
                      const bid = bd === 'books' ? null : isNilBid(bd) ? bidLabel(bd) : `bid ${bd}`;
                      return <li key={x}><b>{names[x]}:</b> {bid ? `${bid}, took ${rec.tricksWon[x]}` : `took ${rec.tricksWon[x]}`}</li>;
                    })}
                  </ul>
                  <div className="tt-stat total">
                    <small>TOTAL</small>
                    <b data-testid={`recap-total-${s.side}`}>{s.totalScore}</b>
                    <span className="tt-bags">{s.totalBags} bag{s.totalBags === 1 ? '' : 's'}</span>
                  </div>
                  <div className="tt-bar" aria-label={`${s.totalScore} of ${target}`}><i style={{ width: `${pct * 100}%` }} /><small>to {target}</small></div>
                </div>
              );
            })}
          </div>
        </div>

        <footer className="tt-foot bid-row">
          <button type="button" onClick={onScorePad}>Score pad</button>
          {ready && <span className="muted" data-testid="talk-ready-count">{ready.count}/{ready.of} ready</span>}
          <button type="button" className="primary big" data-testid="talk-ready" disabled={!!ready?.mine} onClick={onReady}>
            {online ? (ready?.mine ? 'Waiting for the table…' : 'Ready') : 'Continue'}
          </button>
        </footer>
      </div>
    </div>
  );
}
